/**
 * Token-overlap clustering (SPEC_news_threshold.md §3.2).
 * Pure functions — fully deterministic and unit-testable.
 */
import {
  ANCHOR_SHARED_MIN,
  SEED_ANCHOR_MIN,
  SIM_THRESHOLD,
  SOAK_SIM_HIGH,
  SOAK_SIM_LOW,
} from '@/app/lib/newsThreshold'

const STOPWORDS = new Set([
  // English
  'a',
  'an',
  'the',
  'and',
  'or',
  'but',
  'if',
  'then',
  'else',
  'when',
  'at',
  'by',
  'for',
  'with',
  'about',
  'against',
  'between',
  'into',
  'through',
  'during',
  'before',
  'after',
  'above',
  'below',
  'to',
  'from',
  'up',
  'down',
  'in',
  'out',
  'on',
  'off',
  'over',
  'under',
  'again',
  'further',
  'once',
  'here',
  'there',
  'all',
  'any',
  'both',
  'each',
  'few',
  'more',
  'most',
  'other',
  'some',
  'such',
  'no',
  'nor',
  'not',
  'only',
  'own',
  'same',
  'so',
  'than',
  'too',
  'very',
  'can',
  'will',
  'just',
  'don',
  'should',
  'now',
  'of',
  'as',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'being',
  'have',
  'has',
  'had',
  'do',
  'does',
  'did',
  'this',
  'that',
  'these',
  'those',
  'he',
  'she',
  'it',
  'they',
  'them',
  'their',
  'his',
  'her',
  'its',
  'we',
  'you',
  'your',
  'i',
  'me',
  'my',
  'who',
  'whom',
  'what',
  'which',
  'where',
  'why',
  'how',
  // News-specific (SPEC §3.2)
  'live',
  'updates',
  'watch',
  'video',
  'breaking',
  'exclusive',
  'report',
  'analysis',
  'opinion',
  'explained',
  'explainer',
  'latest',
  'news',
  'today',
  'week',
  'new',
])

const OUTLET_BOILERPLATE = [
  'the new york times',
  'new york times',
  'washington post',
  'associated press',
  'wall street journal',
  'national review',
  'washington examiner',
  'fox news',
  'the hill',
  'the dispatch',
  'bbc news',
  'reuters',
  'npr',
  'nbc news',
]

export interface NormalizedItem {
  tokens: Set<string>
  anchors: Set<string>
}

function nfkcLower(s: string): string {
  return s.normalize('NFKC').toLowerCase()
}

function stripBoilerplate(text: string): string {
  let t = text
  t = t.replace(/^\s*\([^)]{1,30}\)\s*[—–\-:]?\s*/i, '')
  t = t.replace(/^\s*(exclusive|breaking)\s*[:—–\-]\s*/i, '')
  t = t.replace(/\s*[—–\-|:]\s*(live updates|live blog|live)\s*$/i, '')
  for (const name of OUTLET_BOILERPLATE) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    t = t.replace(new RegExp(`\\s*[—–\\-|]\\s*${escaped}\\s*$`, 'i'), '')
  }
  return t
}

function lightStem(token: string): string {
  if (token.length <= 3) return token
  if (token.endsWith('es') && token.length > 4) return token.slice(0, -2)
  if (token.endsWith('s') && !token.endsWith('ss')) return token.slice(0, -1)
  return token
}

function tokenizeNormalized(text: string): string[] {
  const stripped = stripBoilerplate(nfkcLower(text))
  const noPossessive = stripped.replace(/'s\b/g, '')
  const punctToSpace = noPossessive.replace(/[^\p{L}\p{N}]+/gu, ' ')
  return punctToSpace
    .split(/\s+/)
    .filter(Boolean)
    .filter((t) => !STOPWORDS.has(t))
    .map(lightStem)
    .filter((t) => t.length > 0)
}

/** Proper-noun proxy: capitalized tokens not at sentence start, plus any numeric tokens. */
function extractAnchorCandidates(original: string): Set<string> {
  const anchors = new Set<string>()
  // Split into sentences roughly; first word of each sentence is not an anchor.
  const sentenceStarts = new Set<number>()
  let idx = 0
  for (const part of original.normalize('NFKC').split(/([.!?]\s+)/)) {
    if (/^[.!?]\s+$/.test(part)) {
      idx += part.length
      continue
    }
    sentenceStarts.add(idx)
    idx += part.length
  }

  const wordRe = /[A-Za-z0-9][A-Za-z0-9'’-]*/g
  let m: RegExpExecArray | null
  const text = original.normalize('NFKC')
  while ((m = wordRe.exec(text)) !== null) {
    const raw = m[0]
    const at = m.index
    const isSentenceStart = sentenceStarts.has(at) || at === 0
    const cleaned = raw.replace(/['’-]/g, '')
    if (!cleaned) continue

    if (/\d/.test(cleaned)) {
      const tok = lightStem(cleaned.toLowerCase())
      if (tok) anchors.add(tok)
      continue
    }

    if (!isSentenceStart && /^[A-Z]/.test(raw)) {
      const tok = lightStem(cleaned.toLowerCase())
      if (tok && tok.length > 1 && !STOPWORDS.has(tok)) anchors.add(tok)
    }
  }
  return anchors
}

export function normalizeItem(title: string, description?: string | null): NormalizedItem {
  const descWords = (description ?? '').split(/\s+/).slice(0, 40).join(' ')
  const titleTokens = tokenizeNormalized(title)
  const descTokens = tokenizeNormalized(descWords)
  const tokens = new Set([...titleTokens, ...descTokens])

  const anchors = new Set<string>()
  for (const a of extractAnchorCandidates(title)) {
    if (tokens.has(a)) anchors.add(a)
  }
  for (const a of extractAnchorCandidates(descWords)) {
    if (tokens.has(a)) anchors.add(a)
  }
  for (const t of tokens) {
    if (/\d/.test(t)) anchors.add(t)
  }

  return { tokens, anchors }
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0
  let intersection = 0
  for (const t of a) {
    if (b.has(t)) intersection++
  }
  const union = a.size + b.size - intersection
  return union === 0 ? 0 : intersection / union
}

export function sharedAnchors(a: Set<string>, b: Set<string>): number {
  let n = 0
  for (const t of a) {
    if (b.has(t)) n++
  }
  return n
}

export function shouldLogSoakPair(sim: number): boolean {
  return sim >= SOAK_SIM_LOW && sim < SOAK_SIM_HIGH
}

export interface ClusterMemberView {
  identity_key: string
  tokens: Set<string>
  anchors: Set<string>
}

export interface OpenClusterView {
  cluster_key: string
  seed_identity: string
  seed_anchors: Set<string>
  members: ClusterMemberView[]
}

export interface JoinDecision {
  join: boolean
  cluster_key: string | null
  maxSim: number
  partner_identity: string | null
}

/**
 * Pick cluster to join for item x, or none (seed new).
 * Multiple clusters → highest max-sim wins.
 */
export function decideJoin(
  item: ClusterMemberView,
  clusters: OpenClusterView[],
  simThreshold = SIM_THRESHOLD
): JoinDecision {
  let best: JoinDecision = {
    join: false,
    cluster_key: null,
    maxSim: 0,
    partner_identity: null,
  }

  for (const cluster of clusters) {
    let localMax = 0
    let localPartner: ClusterMemberView | null = null
    for (const m of cluster.members) {
      const sim = jaccard(item.tokens, m.tokens)
      if (sim > localMax) {
        localMax = sim
        localPartner = m
      }
    }
    if (!localPartner) continue
    if (localMax < simThreshold) continue
    if (sharedAnchors(item.anchors, localPartner.anchors) < ANCHOR_SHARED_MIN) continue
    if (sharedAnchors(item.anchors, cluster.seed_anchors) < SEED_ANCHOR_MIN) continue

    if (localMax > best.maxSim) {
      best = {
        join: true,
        cluster_key: cluster.cluster_key,
        maxSim: localMax,
        partner_identity: localPartner.identity_key,
      }
    }
  }

  return best
}

export function identityKey(guid: string | undefined, link: string): string {
  const g = guid?.trim()
  if (g) return g
  return canonicalizeUrl(link)
}

export function canonicalizeUrl(url: string): string {
  try {
    const u = new URL(url)
    u.hash = ''
    // Strip common tracking params
    ;['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'].forEach((p) =>
      u.searchParams.delete(p)
    )
    return u.toString()
  } catch {
    return url.trim()
  }
}

export function stripTitleBoilerplateKeepCase(title: string): string {
  return stripBoilerplate(title).trim()
}
