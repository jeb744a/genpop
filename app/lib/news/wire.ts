/**
 * Wire-syndication collapse (SPEC_news_threshold.md §2).
 * Items attributed to a wire on the list count as the wire outlet.
 */
import { NEWS_OUTLETS } from '@/app/lib/newsFeeds/outlets'

const WIRE_OUTLETS = NEWS_OUTLETS.filter((o) => o.id === 'ap' || o.id === 'reuters')

const WIRE_PATTERNS: Array<{ outlet_id: string; patterns: RegExp[] }> = [
  {
    outlet_id: 'ap',
    patterns: [
      /\bthe associated press\b/i,
      /\bassociated press\b/i,
      /^\(ap\)/i,
      /\(ap\)\s*[—–\-]/,
      /\bAP\b/,
    ],
  },
  {
    outlet_id: 'reuters',
    patterns: [/\breuters\b/i, /^\(reuters\)/i, /\(reuters\)\s*[—–\-]/i],
  },
]

export function detectWireAttribution(
  title: string,
  description: string | null | undefined,
  creator: string | null | undefined
): string | null {
  const haystack = [creator ?? '', title, description ?? ''].join('\n')
  for (const wire of WIRE_PATTERNS) {
    if (!WIRE_OUTLETS.some((w) => w.id === wire.outlet_id)) continue
    for (const re of wire.patterns) {
      if (re.test(haystack)) return wire.outlet_id
    }
  }
  return null
}

/** Effective outlet for threshold counting after wire collapse. */
export function effectiveOutletId(
  publishingOutletId: string,
  title: string,
  description: string | null | undefined,
  creator: string | null | undefined
): { outlet_id: string; via_wire: string | null } {
  const wire = detectWireAttribution(title, description, creator)
  if (wire && wire !== publishingOutletId) {
    return { outlet_id: wire, via_wire: wire }
  }
  // Publisher is the wire itself
  if (wire === publishingOutletId) {
    return { outlet_id: publishingOutletId, via_wire: null }
  }
  return { outlet_id: publishingOutletId, via_wire: null }
}
