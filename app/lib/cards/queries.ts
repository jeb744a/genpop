import { createClient } from '@/app/lib/supabase/server'
import type { CardDetail, CardRow, FeedParams } from './types'

export const PAGE_SIZE = 25

// Statuses that count as "passed/decided" for the Passed sort.
// Legislative: PASSED, ENACTED. Judicial: DECIDED.
// Executive actions (EO_ISSUED, PROCLAMATION, PRES_ACTION) are excluded —
// they're live-actions, not legislative outcomes.
// Adjust this array here; it's the single source of truth for the Passed filter.
const PASSED_STATUSES = ['PASSED', 'ENACTED', 'DECIDED']

const FEED_SELECT =
  'id, card_type, sphere, source, external_id, title, summary, status, region, occurred_at, last_action_at, source_url, news_audit'

export async function fetchFeedCards(params: FeedParams): Promise<{
  cards: CardRow[]
  hasMore: boolean
}> {
  const supabase = await createClient()
  const offset = (params.page - 1) * PAGE_SIZE

  let query = supabase
    .from('cards')
    .select(FEED_SELECT)

  if (params.branches.length > 0) {
    query = query.in('card_type', params.branches)
  }
  if (params.spheres.length > 0) {
    query = query.in('sphere', params.spheres)
  }
  if (params.sort === 'passed') {
    query = query.in('status', PASSED_STATUSES)
  }

  // SEAM: replace this with cron-computed hot_score once engagement signals exist.
  // For now, trending = recency. When a hot_score column is added to cards,
  // the trending branch becomes: .order('hot_score', { ascending: false, nullsFirst: false })
  query = query.order('last_action_at', { ascending: false, nullsFirst: false })

  // Fetch one extra to detect whether a next page exists.
  query = query.range(offset, offset + PAGE_SIZE)

  const { data, error } = await query

  if (error) {
    console.error('[cards] fetchFeedCards error:', error.message)
    return { cards: [], hasMore: false }
  }

  const rows = (data ?? []) as CardRow[]
  const hasMore = rows.length > PAGE_SIZE
  return { cards: hasMore ? rows.slice(0, PAGE_SIZE) : rows, hasMore }
}

export async function fetchCardById(id: string): Promise<CardDetail | null> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('cards')
    .select('*')
    .eq('id', id)
    .single()

  if (error || !data) return null
  return data as CardDetail
}
