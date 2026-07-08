import { createHash } from 'crypto'
import type { NormalizedItem } from './clustering'

/**
 * Cluster key = cards.external_id (SPEC §3.3):
 * news:{YYYYMMDD}-{slug}-{hash6}
 */
export function buildClusterKey(
  firstSeenAt: Date | string,
  seedAnchors: Set<string> | string[],
  seedIdentityKey: string
): string {
  const d = typeof firstSeenAt === 'string' ? new Date(firstSeenAt) : firstSeenAt
  const yyyymmdd = d.toISOString().slice(0, 10).replace(/-/g, '')
  const anchors = Array.from(seedAnchors).slice(0, 3)
  let slug = anchors.join('-').replace(/[^a-z0-9-]/gi, '').toLowerCase()
  if (!slug) slug = 'story'
  if (slug.length > 24) slug = slug.slice(0, 24).replace(/-$/, '')
  const hash6 = createHash('sha256').update(seedIdentityKey).digest('hex').slice(0, 6)
  return `news:${yyyymmdd}-${slug}-${hash6}`
}

export function buildClusterKeyFromNormalized(
  firstSeenAt: Date | string,
  normalized: NormalizedItem,
  seedIdentityKey: string
): string {
  return buildClusterKey(firstSeenAt, normalized.anchors, seedIdentityKey)
}
