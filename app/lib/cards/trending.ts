import type { CardRow } from './types'

/** Statuses that represent real procedural advancement (not mere introduction). */
export const ADVANCED_STATUSES = new Set([
  'PASSED_CHAMBER',
  'PASSED',
  'ENACTED',
  'TO_PRESIDENT',
  'DECIDED',
  'EO_ISSUED',
  'PROCLAMATION',
  'PRES_ACTION',
])

export const TRENDING_WEIGHTS = {
  /** Federal (national-scope) cards outrank state/local for the default blended feed. */
  nationalScope: 2.0,
  /** Bills/orders that have moved past introduction / filing. */
  statusAdvancement: 1.5,
  /** Shared policy topics with currently-live news cards (0 when topics are empty). */
  newsTopicOverlap: 3.0,
} as const

export interface TrendingScoreBreakdown {
  score: number
  recency: number
  nationalScope: number
  statusAdvancement: number
  newsTopicOverlap: number
  reasons: string[]
}

export type ScoredCard = CardRow & {
  topics?: string[] | null
  trending?: TrendingScoreBreakdown
}

function ageHours(iso: string | null): number {
  if (!iso) return 24 * 365
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return 24 * 365
  return Math.max(0, (Date.now() - t) / 3_600_000)
}

/** Recency component — primary magnitude; other boosts are additives on top. */
export function recencyScore(lastActionAt: string | null): number {
  // Same shape as REBUILD_PLAN forum hot score denominator: (age + 2)^1.5
  return 1 / Math.pow(ageHours(lastActionAt) + 2, 1.5)
}

function topicOverlapRatio(cardTopics: string[] | null | undefined, newsTopics: Set<string>): number {
  if (!cardTopics?.length || newsTopics.size === 0) return 0
  let hits = 0
  for (const t of cardTopics) {
    if (newsTopics.has(t)) hits++
  }
  return hits / cardTopics.length
}

/**
 * Query-layer Trending score for government-action cards.
 * Recency is the base + tiebreaker; boosts are additive and belief-agnostic.
 */
export function scoreTrendingCard(
  card: CardRow & { topics?: string[] | null },
  newsTopics: Set<string>
): TrendingScoreBreakdown {
  const reasons: string[] = []
  const recency = recencyScore(card.last_action_at)

  const national =
    card.sphere === 'federal' ? TRENDING_WEIGHTS.nationalScope : 0
  if (national > 0) reasons.push('national scope (federal)')

  const advanced =
    card.status != null && ADVANCED_STATUSES.has(card.status)
      ? TRENDING_WEIGHTS.statusAdvancement
      : 0
  if (advanced > 0) reasons.push(`status advancement (${card.status})`)

  const overlapRatio = topicOverlapRatio(card.topics, newsTopics)
  const newsOverlap = overlapRatio * TRENDING_WEIGHTS.newsTopicOverlap
  if (newsOverlap > 0) {
    reasons.push(`news topic overlap (${(overlapRatio * 100).toFixed(0)}%)`)
  }

  const age = ageHours(card.last_action_at)
  reasons.push(
    age < 48
      ? `recent activity (${age.toFixed(0)}h ago)`
      : `recency tiebreaker (${(age / 24).toFixed(1)}d ago)`
  )

  return {
    score: recency + national + advanced + newsOverlap,
    recency,
    nationalScope: national,
    statusAdvancement: advanced,
    newsTopicOverlap: newsOverlap,
    reasons,
  }
}

export function rankTrending(
  cards: Array<CardRow & { topics?: string[] | null }>,
  newsTopics: Set<string>
): ScoredCard[] {
  return cards
    .map((card) => ({
      ...card,
      trending: scoreTrendingCard(card, newsTopics),
    }))
    .sort((a, b) => {
      const diff = (b.trending?.score ?? 0) - (a.trending?.score ?? 0)
      if (diff !== 0) return diff
      // Explicit recency tiebreaker when composite scores match.
      return (b.trending?.recency ?? 0) - (a.trending?.recency ?? 0)
    })
}
