/**
 * Unit tests for token-overlap clustering + wire collapse (SPEC §3.2, §2).
 * Run: npx tsx scripts/test-news-clustering.ts
 */
import {
  decideJoin,
  jaccard,
  normalizeItem,
  shouldLogSoakPair,
} from '../app/lib/news/clustering'
import { detectWireAttribution, effectiveOutletId } from '../app/lib/news/wire'
import { SIM_THRESHOLD } from '../app/lib/newsThreshold'

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg)
}

function main() {
  const a = normalizeItem(
    'Breaking: Supreme Court to Hear Challenge to Immigration Ban — The New York Times',
    'The justices said they will review the federal order next month.'
  )
  assert(a.tokens.has('supreme'), 'token supreme')
  assert(!a.tokens.has('breaking'), 'breaking stopword removed')
  assert(a.anchors.size >= 1, 'anchors extracted')

  const b = normalizeItem(
    'Supreme Court hears immigration challenge',
    'Justices review federal order'
  )
  const sim = jaccard(a.tokens, b.tokens)
  assert(sim >= SIM_THRESHOLD, `similar stories join: sim=${sim}`)

  const c = normalizeItem(
    'Local sports team wins championship game',
    'Athletes celebrate after overtime victory'
  )
  const simLow = jaccard(a.tokens, c.tokens)
  assert(simLow < SIM_THRESHOLD, `unrelated low sim: ${simLow}`)

  assert(shouldLogSoakPair(0.25) === true, 'soak mid')
  assert(shouldLogSoakPair(0.15) === false, 'soak below')
  assert(shouldLogSoakPair(0.5) === false, 'soak at high exclusive')

  const seed = normalizeItem(
    'House plans HR1 immigration reform vote in Washington',
    'Lawmakers to vote on HR1 border bill Tuesday in Washington'
  )
  const cluster = {
    cluster_key: 'news:test',
    seed_identity: 'seed1',
    seed_anchors: seed.anchors,
    members: [{ identity_key: 'seed1', tokens: seed.tokens, anchors: seed.anchors }],
  }
  const joinNorm = normalizeItem(
    'House advances HR1 immigration border bill in Washington',
    'Washington HR1 reform vote scheduled on border measure'
  )
  const decision = decideJoin(
    { identity_key: 'item2', tokens: joinNorm.tokens, anchors: joinNorm.anchors },
    [cluster]
  )
  assert(decision.join === true, `should join: sim=${decision.maxSim}`)

  const wire = detectWireAttribution(
    '(AP) — Senate passes bill',
    'WASHINGTON (AP) — The Senate voted…',
    null
  )
  assert(wire === 'ap', `wire detect: ${wire}`)

  const collapsed = effectiveOutletId(
    'fox-news',
    'Senate passes bill',
    'WASHINGTON (AP) — The Senate voted Tuesday.',
    'The Associated Press'
  )
  assert(collapsed.outlet_id === 'ap', `collapse to ap got ${collapsed.outlet_id}`)
  assert(collapsed.via_wire === 'ap', 'via_wire set')

  const noCollapse = effectiveOutletId(
    'fox-news',
    'Fox exclusive on border',
    'Fox News reporting',
    null
  )
  assert(noCollapse.outlet_id === 'fox-news', 'no false collapse')

  console.log('All clustering unit tests passed.')
}

main()
