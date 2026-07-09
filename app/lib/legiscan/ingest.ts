import { createAdminClient } from '@/app/lib/supabase/admin'
import { getBill, getMasterListRaw, getSessionList, pickActiveSession } from './api'
import { mapToCard } from './transform'
import type { LegiscanIngestResult, MasterListItem } from './types'

const JOB_PREFIX = 'ingest:legiscan:'

// All 50 US states. LegiScan uses standard 2-letter USPS codes.
const STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA',
  'HI','ID','IL','IN','IA','KS','KY','LA','ME','MD',
  'MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC',
  'SD','TN','TX','UT','VT','VA','WA','WV','WI','WY',
] as const

// Small courtesy delay between API calls — LegiScan is unmetered per-request
// but has a 30k/month budget; this keeps burst load low.
const CALL_DELAY_MS = 250
/** Soft stop before Hobby's 300s function ceiling (states route maxDuration). */
const WALL_CLOCK_BUDGET_MS = 270_000
/** 4 shards × 6h cadence → each state once/day; keeps catch-up under maxDuration. */
const SHARD_COUNT = 4

function currentIsoHour(): string {
  return new Date().toISOString().slice(0, 13)
}

function currentShard(now = new Date()): number {
  return Math.floor(now.getUTCHours() / 6) % SHARD_COUNT
}

function statesForShard(shard: number): string[] {
  return STATES.filter((_, i) => i % SHARD_COUNT === shard)
}

async function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

// Fetch the stored change_hashes for all legiscan bills in a state.
// Uses PostgREST JSON extraction so only the hash string is transferred,
// not the full raw object.
async function getStoredHashes(
  supabase: ReturnType<typeof createAdminClient>,
  state: string
): Promise<Map<string, string>> {
  const { data, error } = await supabase
    .from('cards')
    .select('external_id, raw->change_hash')
    .eq('source', 'legiscan')
    .eq('region', state)

  if (error || !data) return new Map()

  return new Map(
    (data as Array<Record<string, unknown>>).map((row) => {
      const hash = row['change_hash']
      // PostgREST may return JSON string as "abc123" (with quotes) or abc123 (plain).
      const hashStr =
        typeof hash === 'string'
          ? hash.replace(/^"|"$/g, '')
          : hash != null
            ? String(hash)
            : ''
      return [String(row.external_id), hashStr]
    })
  )
}

async function processState(
  state: string,
  supabase: ReturnType<typeof createAdminClient>
): Promise<{ written: number; skipped: number; failed: number }> {
  // 1. Resolve the active session for this state.
  const sessionRes = await getSessionList(state)
  await delay(CALL_DELAY_MS)

  const sessionId = pickActiveSession(sessionRes.sessions)
  if (!sessionId) {
    console.warn(`[legiscan] no active session for ${state}`)
    return { written: 0, skipped: 0, failed: 0 }
  }

  // 2. Get the full masterlist for this session in one call.
  const masterRes = await getMasterListRaw(sessionId)
  await delay(CALL_DELAY_MS)

  // 3. Build bill list (skip the "0" metadata key).
  const billEntries = Object.entries(masterRes.masterlist).filter(([k]) => k !== '0') as [
    string,
    MasterListItem,
  ][]

  if (billEntries.length === 0) return { written: 0, skipped: 0, failed: 0 }

  // 4. Fetch stored change_hashes for this state in one DB query.
  const storedHashes = await getStoredHashes(supabase, state)

  let written = 0
  let skipped = 0
  let failed = 0

  for (const [billIdStr, item] of billEntries) {
    const externalId = billIdStr
    const storedHash = storedHashes.get(externalId)

    // Skip if the hash hasn't changed — no DB write needed.
    if (storedHash && storedHash === item.change_hash) {
      skipped++
      continue
    }

    try {
      await delay(CALL_DELAY_MS)
      const billRes = await getBill(parseInt(billIdStr, 10))
      const card = mapToCard(billRes.bill)

      const { error: upsertError } = await supabase.from('cards').upsert(card, {
        onConflict: 'source,external_id',
        ignoreDuplicates: false,
      })

      if (upsertError) throw new Error(upsertError.message)
      written++
    } catch (err) {
      console.warn(
        `[legiscan] skipped bill ${billIdStr} (${state}):`,
        err instanceof Error ? err.message : err
      )
      failed++
    }
  }

  return { written, skipped, failed }
}

export async function runLegiscanIngest(): Promise<LegiscanIngestResult> {
  const started = Date.now()
  const supabase = createAdminClient()
  const shard = currentShard()
  const planned = statesForShard(shard)
  // Include shard so re-runs of the same hour don't collide across manual triggers,
  // and so each 6h window's shard is independently idempotent.
  const jobKey = `${JOB_PREFIX}${currentIsoHour()}:s${shard}`

  const { error: insertError } = await supabase
    .from('job_log')
    .insert({ job_key: jobKey, status: 'running', detail: { shard, states_planned: planned } })

  if (insertError) {
    if (insertError.code === '23505') {
      const { data: existing } = await supabase
        .from('job_log')
        .select('status')
        .eq('job_key', jobKey)
        .single()
      if (existing?.status === 'done') {
        return { skipped: true, written: 0, skippedBills: 0, states: 0, shard }
      }
      await supabase
        .from('job_log')
        .update({
          status: 'running',
          detail: { shard, states_planned: planned },
          ran_at: new Date().toISOString(),
        })
        .eq('job_key', jobKey)
    } else {
      throw new Error(`Failed to claim job_log slot: ${insertError.message}`)
    }
  }

  let totalWritten = 0
  let totalSkipped = 0
  let failedStates = 0
  let statesDone = 0
  let truncated = false
  const statesCompleted: string[] = []

  try {
    for (const state of planned) {
      if (Date.now() - started > WALL_CLOCK_BUDGET_MS) {
        truncated = true
        console.warn(`[legiscan] wall-clock budget hit after ${statesDone}/${planned.length} states (shard ${shard})`)
        break
      }
      try {
        const result = await processState(state, supabase)
        totalWritten += result.written
        totalSkipped += result.skipped
        failedStates += result.failed > 0 ? 1 : 0
        statesDone++
        statesCompleted.push(state)
      } catch (err) {
        console.warn(`[legiscan] failed state ${state}:`, err instanceof Error ? err.message : err)
        failedStates++
        statesDone++
        statesCompleted.push(state)
      }
    }

    await supabase
      .from('job_log')
      .update({
        status: 'done',
        detail: {
          written: totalWritten,
          skippedBills: totalSkipped,
          failedStates,
          states: statesDone,
          states_planned: planned.length,
          shard,
          states_completed: statesCompleted,
          ...(truncated ? { truncated: true } : {}),
        },
      })
      .eq('job_key', jobKey)
  } catch (err) {
    await supabase
      .from('job_log')
      .update({ status: 'failed', detail: { error: String(err), shard } })
      .eq('job_key', jobKey)
    throw err
  }

  return {
    written: totalWritten,
    skippedBills: totalSkipped,
    states: statesDone,
    shard,
    states_planned: planned.length,
    truncated,
  }
}
