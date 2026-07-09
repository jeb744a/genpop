import { createAdminClient } from '@/app/lib/supabase/admin'
import { buildDocketListUrl, CL_MIN_INTERVAL_MS, fetchDocketPage } from './api'
import { mapToCard } from './transform'
import type { CourtsIngestResult } from './types'

const JOB_PREFIX = 'ingest:courts:'
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000
/**
 * Free-tier CourtListener: 5 req/min, 50/hr, 125/day (SPEC / DATA_SOURCES).
 * Cap pages so one hourly run cannot exhaust the hour budget even on catch-up.
 * With 13s pacing, 20 pages ≈ 4+ minutes — fits maxDuration=300 with headroom.
 */
const MAX_PAGES = 20

function currentIsoHour(): string {
  return new Date().toISOString().slice(0, 13)
}

function subtractHours(iso: string, hours: number): string {
  return new Date(new Date(iso).getTime() - hours * 60 * 60 * 1000).toISOString()
}

async function getWatermark(supabase: ReturnType<typeof createAdminClient>): Promise<string> {
  // Only advance from successful runs — failed/running rows have no usable watermark
  // and must not reset us to a 7-day catch-up that burns the free-tier quota.
  const { data } = await supabase
    .from('job_log')
    .select('detail')
    .like('job_key', `${JOB_PREFIX}%`)
    .eq('status', 'done')
    .order('ran_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const watermark = (data?.detail as Record<string, string> | null)?.watermark
  if (watermark) return watermark

  return new Date(Date.now() - SEVEN_DAYS_MS).toISOString()
}

export async function runCourtsIngest(): Promise<CourtsIngestResult> {
  const supabase = createAdminClient()
  const jobKey = `${JOB_PREFIX}${currentIsoHour()}`

  const { error: insertError } = await supabase
    .from('job_log')
    .insert({ job_key: jobKey, status: 'running', detail: {} })

  if (insertError) {
    if (insertError.code === '23505') {
      const { data: existing } = await supabase
        .from('job_log')
        .select('status')
        .eq('job_key', jobKey)
        .single()
      if (existing?.status === 'done') return { skipped: true }
      await supabase
        .from('job_log')
        .update({ status: 'running', detail: {}, ran_at: new Date().toISOString() })
        .eq('job_key', jobKey)
    } else {
      throw new Error(`Failed to claim job_log slot: ${insertError.message}`)
    }
  }

  const watermark = await getWatermark(supabase)
  const fromIso = subtractHours(watermark, 1)

  let written = 0
  let skippedDockets = 0
  let maxDateModified = watermark
  let nextUrl: string | null = buildDocketListUrl(fromIso)
  let pages = 0
  let truncated = false

  try {
    while (nextUrl && pages < MAX_PAGES) {
      if (pages > 0) await new Promise((r) => setTimeout(r, CL_MIN_INTERVAL_MS))
      pages++

      const page = await fetchDocketPage(nextUrl)
      const dockets = page.results ?? []

      if (dockets.length === 0) break

      let stopPaging = false
      for (const docket of dockets) {
        if (new Date(docket.date_modified) < new Date(watermark)) {
          stopPaging = true
          break
        }

        try {
          // Store the docket directly; cluster URLs are in raw.clusters for Phase 2.
          const raw: Record<string, unknown> = { ...docket }
          const card = mapToCard(docket, raw)

          const { error: upsertError } = await supabase.from('cards').upsert(card, {
            onConflict: 'source,external_id',
            ignoreDuplicates: false,
          })

          if (upsertError) throw new Error(upsertError.message)

          written++
          if (new Date(docket.date_modified) > new Date(maxDateModified)) {
            maxDateModified = docket.date_modified
          }
        } catch (err) {
          if (err instanceof Error && err.message.includes('429')) throw err
          console.warn(
            `[courts] skipped docket-${docket.id}:`,
            err instanceof Error ? err.message : err
          )
          skippedDockets++
        }
      }

      if (stopPaging) break
      nextUrl = page.next
      if (nextUrl && pages >= MAX_PAGES) truncated = true
    }

    await supabase
      .from('job_log')
      .update({
        status: 'done',
        detail: {
          watermark: maxDateModified,
          written,
          skippedDockets,
          pages,
          ...(truncated ? { truncated: true } : {}),
        },
      })
      .eq('job_key', jobKey)
  } catch (err) {
    // SPEC §5: on 429 abort without advancing watermark (failed detail has no watermark).
    await supabase
      .from('job_log')
      .update({ status: 'failed', detail: { error: String(err) } })
      .eq('job_key', jobKey)
    throw err
  }

  return { written, skippedDockets, watermark: maxDateModified }
}
