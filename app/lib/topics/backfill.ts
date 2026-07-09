import { createAdminClient } from '@/app/lib/supabase/admin'
import { ADVANCED_STATUSES, recencyScore } from '@/app/lib/cards/trending'
import {
  DAILY_CARD_TOPIC_CAP,
  MAX_TOPIC_TAGS_PER_RUN,
  TOPIC_CANDIDATE_WINDOW,
  tagGovernmentCardTopics,
} from './tagCard'

const JOB_PREFIX = 'ingest:topics:'

export type TopicBackfillDetail = {
  attempted: number
  tagged: number
  skipped_empty: number
  budget_exhausted: boolean
  gemini_calls: number
  heuristic_only: number
  daily_cap: number
  max_per_run: number
  sample: Array<{ id: string; title: string; topics: string[]; priority: number }>
}

function currentIsoHour(): string {
  return new Date().toISOString().slice(0, 13)
}

/**
 * Priority for which untagged cards get topics first.
 * Primary: recent last_action_at (via recencyScore).
 * Secondary: federal sphere + advanced statuses (PASSED/ENACTED/DECIDED/…).
 * Aligns with Trending so we tag cards most likely to surface soon.
 */
export function topicBackfillPriority(card: {
  last_action_at: string | null
  sphere: string | null
  status: string | null
}): number {
  const recency = recencyScore(card.last_action_at)
  const national = card.sphere === 'federal' ? 2.0 : 0
  const advanced =
    card.status != null && ADVANCED_STATUSES.has(card.status) ? 1.5 : 0
  return recency + national + advanced
}

function emptyDetail(): TopicBackfillDetail {
  return {
    attempted: 0,
    tagged: 0,
    skipped_empty: 0,
    budget_exhausted: false,
    gemini_calls: 0,
    heuristic_only: 0,
    daily_cap: DAILY_CARD_TOPIC_CAP,
    max_per_run: MAX_TOPIC_TAGS_PER_RUN,
    sample: [],
  }
}

async function claimJob(): Promise<{ claimed: boolean; skipped?: boolean; jobKey: string }> {
  const supabase = createAdminClient()
  const jobKey = `${JOB_PREFIX}${currentIsoHour()}`

  const { error } = await supabase
    .from('job_log')
    .insert({ job_key: jobKey, status: 'running', detail: {} })

  if (error) {
    if (error.code === '23505') {
      const { data: existing } = await supabase
        .from('job_log')
        .select('status')
        .eq('job_key', jobKey)
        .maybeSingle()
      if (existing?.status === 'done') return { claimed: false, skipped: true, jobKey }
      await supabase
        .from('job_log')
        .update({ status: 'running', detail: {}, ran_at: new Date().toISOString() })
        .eq('job_key', jobKey)
      return { claimed: true, jobKey }
    }
    throw new Error(`Failed to claim topics job: ${error.message}`)
  }
  return { claimed: true, jobKey }
}

async function finishJob(jobKey: string, detail: TopicBackfillDetail): Promise<void> {
  const supabase = createAdminClient()
  await supabase.from('job_log').update({ status: 'done', detail }).eq('job_key', jobKey)
}

/**
 * Lazy topic backfill for non-live cards.
 * Selects untagged cards most likely to appear in Trending soon:
 * recent last_action_at first, preferring federal + advanced statuses.
 */
export async function runTopicBackfill(): Promise<TopicBackfillDetail & { skipped?: boolean }> {
  const claim = await claimJob()
  if (!claim.claimed) {
    return { ...emptyDetail(), skipped: true }
  }

  const detail = emptyDetail()

  try {
    const supabase = createAdminClient()

    // Recent-first candidate window, then re-rank with federal/advanced preference.
    const { data, error } = await supabase
      .from('cards')
      .select('id, title, summary, sphere, status, last_action_at, topics')
      .neq('card_type', 'live')
      .eq('topics', '{}')
      .order('last_action_at', { ascending: false, nullsFirst: false })
      .limit(TOPIC_CANDIDATE_WINDOW)

    if (error) throw new Error(error.message)

    const ranked = (data ?? [])
      .filter((row) => !Array.isArray(row.topics) || row.topics.length === 0)
      .map((row) => ({
        ...row,
        priority: topicBackfillPriority(row),
      }))
      .sort((a, b) => {
        if (b.priority !== a.priority) return b.priority - a.priority
        const ta = a.last_action_at ? new Date(a.last_action_at).getTime() : 0
        const tb = b.last_action_at ? new Date(b.last_action_at).getTime() : 0
        return tb - ta
      })
      .slice(0, MAX_TOPIC_TAGS_PER_RUN)

    for (const card of ranked) {
      detail.attempted++
      const result = await tagGovernmentCardTopics(card.title, card.summary)

      if (result.budgetDenied) {
        detail.budget_exhausted = true
        break
      }

      if (result.usedGemini) detail.gemini_calls++
      else detail.heuristic_only++

      const topics =
        result.topics.length > 0 ? result.topics : (['other_civic'] as const)

      if (result.topics.length === 0) detail.skipped_empty++

      const { error: upErr } = await supabase
        .from('cards')
        .update({ topics: [...topics] })
        .eq('id', card.id)
      if (upErr) {
        console.warn('[topics] failed to write topics for', card.id, upErr.message)
        continue
      }

      detail.tagged++
      if (detail.sample.length < 5) {
        detail.sample.push({
          id: card.id,
          title: card.title.slice(0, 80),
          topics: [...topics],
          priority: Number(card.priority.toFixed(4)),
        })
      }
    }

    await finishJob(claim.jobKey, detail)
    return detail
  } catch (err) {
    const supabase = createAdminClient()
    await supabase
      .from('job_log')
      .update({ status: 'failed', detail: { ...detail, error: String(err) } })
      .eq('job_key', claim.jobKey)
    throw err
  }
}
