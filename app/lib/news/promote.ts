import { createAdminClient } from '@/app/lib/supabase/admin'
import {
  BUCKETS_REQUIRED,
  CLUSTERING_VERSION,
  OUTLET_LIST_VERSION,
  RULE_VERSION,
  THRESHOLD_N,
  WINDOW_HOURS,
} from '@/app/lib/newsThreshold'
import { bucketForOutlet, outletById, resolveCanonicalUrl } from './fetch'
import { isCivicTopics, tagNewsTopics } from './topics'
import { stripTitleBoilerplateKeepCase } from './clustering'
import type { NewsAudit, NewsAuditOutlet, NewsItemRow } from './types'

export interface PromotionResult {
  promoted: boolean
  card_id?: string
  held_non_civic?: boolean
  gemini_calls: number
  redirects_resolved: number
}

function iso(d: Date | string | null | undefined): string | null {
  if (!d) return null
  return typeof d === 'string' ? new Date(d).toISOString() : d.toISOString()
}

/** Distinct effective outlets in cluster (post wire-collapse). */
export function countThreshold(items: NewsItemRow[]): {
  outlets: Map<string, NewsItemRow>
  buckets: Set<string>
} {
  const outlets = new Map<string, NewsItemRow>()
  for (const item of items) {
    const existing = outlets.get(item.outlet_id)
    if (!existing) {
      outlets.set(item.outlet_id, item)
      continue
    }
    const a = existing.first_seen_at
    const b = item.first_seen_at
    if (b < a) outlets.set(item.outlet_id, item)
  }
  const buckets = new Set<string>()
  for (const id of outlets.keys()) {
    const b = bucketForOutlet(id)
    if (b) buckets.add(b)
  }
  return { outlets, buckets }
}

export function meetsThreshold(items: NewsItemRow[], firstSeenAt: string, now = new Date()): boolean {
  const windowEnd = new Date(firstSeenAt).getTime() + WINDOW_HOURS * 3600_000
  if (now.getTime() > windowEnd) return false
  const within = items.filter((i) => {
    const t = new Date(i.first_seen_at).getTime()
    return t <= windowEnd
  })
  const { outlets, buckets } = countThreshold(within)
  if (outlets.size < THRESHOLD_N) return false
  for (const req of BUCKETS_REQUIRED) {
    if (!buckets.has(req)) return false
  }
  return true
}

function pickCenterTitleSource(items: NewsItemRow[]): NewsItemRow {
  const center = items
    .filter((i) => bucketForOutlet(i.outlet_id) === 'center')
    .sort((a, b) => {
      const ap = a.published_at ?? a.first_seen_at
      const bp = b.published_at ?? b.first_seen_at
      return ap.localeCompare(bp)
    })
  if (center[0]) return center[0]
  return [...items].sort((a, b) =>
    (a.published_at ?? a.first_seen_at).localeCompare(b.published_at ?? b.first_seen_at)
  )[0]
}

export async function promoteCluster(
  clusterKey: string,
  items: NewsItemRow[],
  firstSeenAt: string,
  redirectBudget: { remaining: number }
): Promise<PromotionResult> {
  const supabase = createAdminClient()
  const { outlets } = countThreshold(items)
  const outletItems = Array.from(outlets.values()).sort((a, b) =>
    a.first_seen_at.localeCompare(b.first_seen_at)
  )

  const chosen = pickCenterTitleSource(items)
  let chosenUrl = chosen.url
  if (redirectBudget.remaining > 0 && chosenUrl.includes('news.google.com')) {
    chosenUrl = await resolveCanonicalUrl(chosenUrl)
    redirectBudget.remaining -= 1
  }

  const title = stripTitleBoilerplateKeepCase(chosen.title)
  const summary = chosen.description
    ? chosen.description.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 1000)
    : null

  let gemini_calls = 0
  const topics = await tagNewsTopics(title, summary)
  gemini_calls = 1

  if (!isCivicTopics(topics)) {
    return { promoted: false, held_non_civic: true, gemini_calls, redirects_resolved: 0 }
  }

  const clearedAt = new Date().toISOString()
  const redirects_resolved_start = redirectBudget.remaining

  const auditOutlets: NewsAuditOutlet[] = []
  for (const item of outletItems) {
    let itemUrl = item.url
    if (redirectBudget.remaining > 0 && itemUrl.includes('news.google.com')) {
      itemUrl = await resolveCanonicalUrl(itemUrl)
      redirectBudget.remaining -= 1
    }
    const def = outletById(item.outlet_id)
    auditOutlets.push({
      outlet_id: item.outlet_id,
      name: def?.name ?? item.outlet_id,
      bucket: def?.bucket ?? 'center',
      item_title: stripTitleBoilerplateKeepCase(item.title),
      item_url: itemUrl,
      published_at: iso(item.published_at),
      first_seen_at: item.first_seen_at,
      via_wire: item.via_wire,
    })
  }

  const audit: NewsAudit = {
    rule_version: RULE_VERSION,
    clustering_version: CLUSTERING_VERSION,
    outlet_list_version: OUTLET_LIST_VERSION,
    rule: {
      n: THRESHOLD_N,
      window_hours: WINDOW_HOURS,
      buckets_required: [...BUCKETS_REQUIRED],
    },
    cluster_key: clusterKey,
    first_seen_at: firstSeenAt,
    cleared_at: clearedAt,
    outlets: auditOutlets,
  }

  const occurredAt = items
    .map((i) => i.published_at)
    .filter(Boolean)
    .sort()[0] ?? firstSeenAt

  const lastActionAt = outletItems[outletItems.length - 1]?.first_seen_at ?? clearedAt

  const raw = {
    members: items.map((i) => ({
      identity_key: i.identity_key,
      outlet_id: i.outlet_id,
      title: i.title,
      url: i.url,
      published_at: i.published_at,
      via_wire: i.via_wire,
    })),
    constants: {
      rule_version: RULE_VERSION,
      clustering_version: CLUSTERING_VERSION,
      outlet_list_version: OUTLET_LIST_VERSION,
    },
  }

  const { data: card, error } = await supabase
    .from('cards')
    .upsert(
      {
        card_type: 'live',
        sphere: 'federal',
        source: 'news',
        external_id: clusterKey,
        title,
        summary,
        status: 'DEVELOPING',
        region: null,
        occurred_at: occurredAt,
        last_action_at: lastActionAt,
        source_url: chosenUrl,
        raw,
        topics,
        news_audit: audit,
      },
      { onConflict: 'source,external_id' }
    )
    .select('id')
    .single()

  if (error || !card) {
    console.error('[news] promote upsert failed:', error?.message)
    return {
      promoted: false,
      gemini_calls,
      redirects_resolved: redirects_resolved_start - redirectBudget.remaining,
    }
  }

  await supabase
    .from('news_clusters')
    .update({
      status: 'promoted',
      promoted_card_id: card.id,
      cleared_at: clearedAt,
    })
    .eq('cluster_key', clusterKey)

  return {
    promoted: true,
    card_id: card.id,
    gemini_calls,
    redirects_resolved: redirects_resolved_start - redirectBudget.remaining,
  }
}

/** Append new outlet to an already-promoted cluster's audit (SPEC §5.1). */
export async function appendOutletToPromotedCard(
  cardId: string,
  clusterKey: string,
  item: NewsItemRow,
  redirectBudget: { remaining: number }
): Promise<{ redirects_resolved: number }> {
  const supabase = createAdminClient()
  const { data: card } = await supabase
    .from('cards')
    .select('news_audit')
    .eq('id', cardId)
    .single()

  if (!card?.news_audit) return { redirects_resolved: 0 }

  const audit = card.news_audit as NewsAudit
  if (audit.outlets.some((o) => o.outlet_id === item.outlet_id)) {
    return { redirects_resolved: 0 }
  }

  let itemUrl = item.url
  let redirects = 0
  if (redirectBudget.remaining > 0 && itemUrl.includes('news.google.com')) {
    itemUrl = await resolveCanonicalUrl(itemUrl)
    redirectBudget.remaining -= 1
    redirects = 1
  }

  const def = outletById(item.outlet_id)
  const entry: NewsAuditOutlet = {
    outlet_id: item.outlet_id,
    name: def?.name ?? item.outlet_id,
    bucket: def?.bucket ?? 'center',
    item_title: stripTitleBoilerplateKeepCase(item.title),
    item_url: itemUrl,
    published_at: iso(item.published_at),
    first_seen_at: item.first_seen_at,
    via_wire: item.via_wire,
  }

  const outlets = [...audit.outlets, entry]
  await supabase
    .from('cards')
    .update({
      news_audit: { ...audit, outlets },
      last_action_at: item.first_seen_at,
      updated_at: new Date().toISOString(),
    })
    .eq('id', cardId)

  return { redirects_resolved: redirects }
}
