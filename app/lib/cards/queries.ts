import { createClient } from '@/app/lib/supabase/server'
import { createAdminClient } from '@/app/lib/supabase/admin'
import type { CardDetail, CardRow, FeedParams } from './types'
import { rankTrending, type ScoredCard } from './trending'

export const PAGE_SIZE = 25

/** How many recent candidates to score for Trending before paging. */
const TRENDING_CANDIDATE_WINDOW = 400

// Statuses that count as "passed/decided" for the Passed sort.
// Legislative: PASSED, ENACTED. Judicial: DECIDED.
// Executive actions (EO_ISSUED, PROCLAMATION, PRES_ACTION) are excluded —
// they're live-actions, not legislative outcomes.
// Adjust this array here; it's the single source of truth for the Passed filter.
const PASSED_STATUSES = ['PASSED', 'ENACTED', 'DECIDED']

const FEED_SELECT =
  'id, card_type, sphere, source, external_id, title, summary, status, region, occurred_at, last_action_at, source_url, news_audit'

const TRENDING_SELECT = `${FEED_SELECT}, topics`

export async function fetchLiveNewsTopics(): Promise<{
  topics: Set<string>
  liveCardCount: number
  /** True when no non-empty topics exist on live cards (overlap boost is inert). */
  topicsUnavailable: boolean
}> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('cards')
    .select('topics')
    .eq('card_type', 'live')
    .order('last_action_at', { ascending: false, nullsFirst: false })
    .limit(100)

  const topics = new Set<string>()
  let liveCardCount = 0
  for (const row of data ?? []) {
    liveCardCount++
    const t = row.topics
    if (Array.isArray(t)) {
      for (const item of t) {
        if (typeof item === 'string' && item) topics.add(item)
      }
    }
  }

  return {
    topics,
    liveCardCount,
    topicsUnavailable: topics.size === 0,
  }
}

export async function fetchFeedCards(params: FeedParams): Promise<{
  cards: CardRow[]
  hasMore: boolean
  trendingMeta?: {
    topicsUnavailable: boolean
    liveCardCount: number
    newsTopicCount: number
  }
}> {
  if (params.sort === 'trending') {
    return fetchTrendingFeed(params)
  }

  const supabase = await createClient()
  const offset = (params.page - 1) * PAGE_SIZE

  let query = supabase.from('cards').select(FEED_SELECT)

  if (params.branches.length > 0) {
    query = query.in('card_type', params.branches)
  }
  if (params.spheres.length > 0) {
    query = query.in('sphere', params.spheres)
  }
  if (params.sort === 'passed') {
    query = query.in('status', PASSED_STATUSES)
  }

  query = query.order('last_action_at', { ascending: false, nullsFirst: false })
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

async function fetchTrendingFeed(params: FeedParams): Promise<{
  cards: ScoredCard[]
  hasMore: boolean
  trendingMeta: {
    topicsUnavailable: boolean
    liveCardCount: number
    newsTopicCount: number
  }
}> {
  const supabase = await createClient()
  const { topics: newsTopics, liveCardCount, topicsUnavailable } =
    await fetchLiveNewsTopics()

  let query = supabase
    .from('cards')
    .select(TRENDING_SELECT)
    .neq('card_type', 'live')

  if (params.branches.length > 0) {
    query = query.in('card_type', params.branches)
  }
  if (params.spheres.length > 0) {
    query = query.in('sphere', params.spheres)
  }

  // Candidate window: recent enough to be "trending," then score in-process.
  query = query
    .order('last_action_at', { ascending: false, nullsFirst: false })
    .limit(TRENDING_CANDIDATE_WINDOW)

  const { data, error } = await query
  if (error) {
    console.error('[cards] fetchTrendingFeed error:', error.message)
    return {
      cards: [],
      hasMore: false,
      trendingMeta: {
        topicsUnavailable,
        liveCardCount,
        newsTopicCount: newsTopics.size,
      },
    }
  }

  const ranked = rankTrending(
    (data ?? []) as Array<CardRow & { topics?: string[] | null }>,
    newsTopics
  )

  const offset = (params.page - 1) * PAGE_SIZE
  const page = ranked.slice(offset, offset + PAGE_SIZE + 1)
  const hasMore = page.length > PAGE_SIZE
  const cards = (hasMore ? page.slice(0, PAGE_SIZE) : page).map(
    ({ topics: _topics, ...rest }) => rest as ScoredCard
  )

  return {
    cards,
    hasMore,
    trendingMeta: {
      topicsUnavailable,
      liveCardCount,
      newsTopicCount: newsTopics.size,
    },
  }
}

/** Admin/script helper: top N trending with full score breakdown (service role). */
export async function fetchTopTrendingForReport(limit = 10): Promise<{
  cards: ScoredCard[]
  topicsUnavailable: boolean
  liveCardCount: number
  newsTopicCount: number
  nonLiveTopicsPopulated: boolean
}> {
  const supabase = createAdminClient()

  const { data: liveRows } = await supabase
    .from('cards')
    .select('topics')
    .eq('card_type', 'live')
    .limit(100)

  const newsTopics = new Set<string>()
  let liveCardCount = 0
  for (const row of liveRows ?? []) {
    liveCardCount++
    if (Array.isArray(row.topics)) {
      for (const t of row.topics) {
        if (typeof t === 'string' && t) newsTopics.add(t)
      }
    }
  }

  const { data } = await supabase
    .from('cards')
    .select(TRENDING_SELECT)
    .neq('card_type', 'live')
    .order('last_action_at', { ascending: false, nullsFirst: false })
    .limit(TRENDING_CANDIDATE_WINDOW)

  const rows = (data ?? []) as Array<CardRow & { topics?: string[] | null }>
  const nonLiveTopicsPopulated = rows.some(
    (r) => Array.isArray(r.topics) && r.topics.length > 0
  )

  const ranked = rankTrending(rows, newsTopics).slice(0, limit)

  return {
    cards: ranked,
    topicsUnavailable: newsTopics.size === 0,
    liveCardCount,
    newsTopicCount: newsTopics.size,
    nonLiveTopicsPopulated,
  }
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
