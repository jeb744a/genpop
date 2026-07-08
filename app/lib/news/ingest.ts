import { createAdminClient } from '@/app/lib/supabase/admin'
import {
  EXPIRED_ITEM_RETENTION_DAYS,
  HARD_CAP_DAYS,
  JOB_PREFIX,
  MAX_PROMOTIONS_PER_RUN,
  MAX_REDIRECT_RESOLUTIONS,
  STALE_RUNNING_HOURS,
  WALL_CLOCK_BUDGET_MS,
  WINDOW_HOURS,
} from '@/app/lib/newsThreshold'
import { buildClusterKeyFromNormalized } from './clusterKey'
import {
  decideJoin,
  identityKey,
  jaccard,
  normalizeItem,
  shouldLogSoakPair,
  type OpenClusterView,
} from './clustering'
import { fetchAllOutletFeeds } from './fetch'
import { appendOutletToPromotedCard, countThreshold, meetsThreshold, promoteCluster } from './promote'
import type { NearMiss, NewsIngestDetail, NewsItemRow } from './types'
import { effectiveOutletId } from './wire'
import { BUCKETS_REQUIRED, THRESHOLD_N } from '@/app/lib/newsThreshold'

function currentIsoHour(): string {
  return new Date().toISOString().slice(0, 13)
}

function windowOpenCutoff(now = new Date()): Date {
  return new Date(now.getTime() - WINDOW_HOURS * 3600_000)
}

async function claimJob(): Promise<{
  claimed: boolean
  skipped?: boolean
  jobKey: string
}> {
  const supabase = createAdminClient()
  const jobKey = `${JOB_PREFIX}${currentIsoHour()}`

  const { data: existing } = await supabase
    .from('job_log')
    .select('status, ran_at')
    .eq('job_key', jobKey)
    .maybeSingle()

  if (existing?.status === 'done') {
    return { claimed: false, skipped: true, jobKey }
  }

  if (existing?.status === 'running') {
    const ranAt = new Date(existing.ran_at).getTime()
    const staleMs = STALE_RUNNING_HOURS * 3600_000
    if (Date.now() - ranAt < staleMs) {
      return { claimed: false, skipped: true, jobKey }
    }
    await supabase
      .from('job_log')
      .update({ status: 'running', detail: {}, ran_at: new Date().toISOString() })
      .eq('job_key', jobKey)
    return { claimed: true, jobKey }
  }

  const { error } = await supabase
    .from('job_log')
    .insert({ job_key: jobKey, status: 'running', detail: {} })

  if (error) {
    if (error.code === '23505') {
      return { claimed: false, skipped: true, jobKey }
    }
    throw new Error(`Failed to claim job: ${error.message}`)
  }
  return { claimed: true, jobKey }
}

async function finishJob(jobKey: string, detail: NewsIngestDetail): Promise<void> {
  const supabase = createAdminClient()
  await supabase
    .from('job_log')
    .update({ status: 'done', detail })
    .eq('job_key', jobKey)
}

async function loadOpenClusters(): Promise<OpenClusterView[]> {
  const supabase = createAdminClient()
  const cutoff = windowOpenCutoff().toISOString()
  const { data: clusters } = await supabase
    .from('news_clusters')
    .select('cluster_key, seed_identity, first_seen_at, status')
    .in('status', ['open', 'promoted'])
    .gte('first_seen_at', cutoff)

  if (!clusters?.length) return []

  const keys = clusters.map((c) => c.cluster_key)
  const { data: items } = await supabase
    .from('news_items')
    .select('*')
    .in('cluster_key', keys)

  const byCluster = new Map<string, NewsItemRow[]>()
  for (const item of (items ?? []) as NewsItemRow[]) {
    if (!item.cluster_key) continue
    const list = byCluster.get(item.cluster_key) ?? []
    list.push(item)
    byCluster.set(item.cluster_key, list)
  }

  const views: OpenClusterView[] = []
  for (const c of clusters) {
    const members = byCluster.get(c.cluster_key) ?? []
    const seed = members.find((m) => m.identity_key === c.seed_identity) ?? members[0]
    if (!seed) continue
    const seedNorm = normalizeItem(seed.title, seed.description)
    views.push({
      cluster_key: c.cluster_key,
      seed_identity: c.seed_identity,
      seed_anchors: seedNorm.anchors,
      members: members.map((m) => {
        const n = normalizeItem(m.title, m.description)
        return { identity_key: m.identity_key, tokens: n.tokens, anchors: n.anchors }
      }),
    })
  }
  return views
}

async function logSoakPairs(
  identity: string,
  title: string,
  tokens: Set<string>,
  clusters: OpenClusterView[],
  joinedKey: string | null
): Promise<number> {
  const supabase = createAdminClient()
  let logged = 0
  const rows: Array<{
    identity_a: string
    identity_b: string
    title_a: string
    title_b: string
    sim: number
    joined: boolean
    cluster_key: string | null
  }> = []

  for (const cluster of clusters) {
    for (const m of cluster.members) {
      const sim = jaccard(tokens, m.tokens)
      if (!shouldLogSoakPair(sim)) continue
      rows.push({
        identity_a: identity,
        identity_b: m.identity_key,
        title_a: title.slice(0, 200),
        title_b: '',
        sim,
        joined: joinedKey === cluster.cluster_key,
        cluster_key: joinedKey === cluster.cluster_key ? joinedKey : null,
      })
    }
  }

  if (rows.length === 0) return 0
  const { error } = await supabase.from('news_cluster_pairs_log').insert(rows.slice(0, 50))
  if (!error) logged = rows.length
  return logged
}

async function expireAndClose(): Promise<void> {
  const supabase = createAdminClient()
  const now = Date.now()
  const windowMs = WINDOW_HOURS * 3600_000
  const hardCapMs = HARD_CAP_DAYS * 24 * 3600_000

  // Unpromoted open clusters past window
  const { data: opens } = await supabase
    .from('news_clusters')
    .select('cluster_key, first_seen_at')
    .eq('status', 'open')

  for (const c of opens ?? []) {
    if (now - new Date(c.first_seen_at).getTime() > windowMs) {
      await supabase
        .from('news_clusters')
        .update({ status: 'expired' })
        .eq('cluster_key', c.cluster_key)
    }
  }

  // Promoted: close when quiet 48h OR hard 7-day cap
  const { data: promoted } = await supabase
    .from('news_clusters')
    .select('cluster_key, last_item_at, cleared_at, promoted_card_id')
    .eq('status', 'promoted')

  for (const c of promoted ?? []) {
    const quiet = now - new Date(c.last_item_at).getTime() > windowMs
    const hard =
      c.cleared_at != null && now - new Date(c.cleared_at).getTime() > hardCapMs
    if (quiet || hard) {
      await supabase
        .from('news_clusters')
        .update({ status: 'closed' })
        .eq('cluster_key', c.cluster_key)
      if (c.promoted_card_id) {
        await supabase
          .from('cards')
          .update({ status: 'CONCLUDED' })
          .eq('id', c.promoted_card_id)
      }
    }
  }

  // Delete items from expired clusters older than retention
  const retentionCutoff = new Date(
    now - (WINDOW_HOURS + EXPIRED_ITEM_RETENTION_DAYS * 24) * 3600_000
  ).toISOString()
  const { data: expired } = await supabase
    .from('news_clusters')
    .select('cluster_key, first_seen_at')
    .eq('status', 'expired')
    .lt('first_seen_at', retentionCutoff)

  for (const c of expired ?? []) {
    await supabase.from('news_items').delete().eq('cluster_key', c.cluster_key)
  }
}

function nearMissForCluster(
  clusterKey: string,
  items: NewsItemRow[],
  firstSeenAt: string
): NearMiss | null {
  if (meetsThreshold(items, firstSeenAt)) return null
  const { outlets, buckets } = countThreshold(items)
  const missing = BUCKETS_REQUIRED.filter((b) => !buckets.has(b))
  if (outlets.size >= THRESHOLD_N - 1 || missing.length === 1) {
    return {
      cluster_key: clusterKey,
      outlet_count: outlets.size,
      buckets: Array.from(buckets),
      missing_buckets: missing,
      reason:
        outlets.size < THRESHOLD_N
          ? `N=${outlets.size} (need ${THRESHOLD_N})`
          : `missing bucket(s): ${missing.join(',')}`,
    }
  }
  return null
}

export async function runNewsIngest(): Promise<NewsIngestDetail & { skipped?: boolean }> {
  const started = Date.now()
  const claim = await claimJob()
  if (!claim.claimed) {
    return {
      skipped: true,
      items_fetched: 0,
      items_new: 0,
      clusters_opened: 0,
      clusters_joined: 0,
      promotions: 0,
      promotions_deferred: 0,
      near_misses: [],
      feed_status: [],
      soak_pairs_logged: 0,
      redirects_resolved: 0,
      gemini_calls: 0,
    }
  }
  const jobKey = claim.jobKey

  const detail: NewsIngestDetail = {
    items_fetched: 0,
    items_new: 0,
    clusters_opened: 0,
    clusters_joined: 0,
    promotions: 0,
    promotions_deferred: 0,
    near_misses: [],
    feed_status: [],
    soak_pairs_logged: 0,
    redirects_resolved: 0,
    gemini_calls: 0,
  }

  try {
    const { results, items: fetched } = await fetchAllOutletFeeds()
    detail.feed_status = results.map((r) => ({
      outlet_id: r.outlet_id,
      http_status: r.http_status,
      items: r.items.length,
      not_modified: r.not_modified,
      error: r.error,
    }))
    detail.items_fetched = fetched.length

    const supabase = createAdminClient()
    const openClusters = await loadOpenClusters()
    const redirectBudget = { remaining: MAX_REDIRECT_RESOLUTIONS }

    for (const raw of fetched) {
      if (Date.now() - started > WALL_CLOCK_BUDGET_MS) break

      const key = identityKey(raw.guid, raw.link)
      const { data: existing } = await supabase
        .from('news_items')
        .select('identity_key')
        .eq('identity_key', key)
        .maybeSingle()
      if (existing) continue

      const { outlet_id, via_wire } = effectiveOutletId(
        raw.outlet_id,
        raw.title,
        raw.description,
        raw.creator
      )

      const published_at = raw.pubDate ? new Date(raw.pubDate).toISOString() : null
      const first_seen_at = new Date().toISOString()
      const normalized = normalizeItem(raw.title, raw.description)
      const memberView = {
        identity_key: key,
        tokens: normalized.tokens,
        anchors: normalized.anchors,
      }

      // Soak: compare to all open members before join
      const decision = decideJoin(memberView, openClusters)
      detail.soak_pairs_logged += await logSoakPairs(
        key,
        raw.title,
        normalized.tokens,
        openClusters,
        decision.join ? decision.cluster_key : null
      )

      let cluster_key: string
      if (decision.join && decision.cluster_key) {
        cluster_key = decision.cluster_key
        detail.clusters_joined += 1
      } else {
        cluster_key = buildClusterKeyFromNormalized(first_seen_at, normalized, key)
        await supabase.from('news_items').insert({
          identity_key: key,
          outlet_id,
          title: raw.title,
          description: raw.description ?? null,
          url: raw.link,
          published_at,
          first_seen_at,
          cluster_key: null,
          via_wire,
          creator: raw.creator ?? null,
        })
        await supabase.from('news_clusters').insert({
          cluster_key,
          seed_identity: key,
          first_seen_at,
          status: 'open',
          last_item_at: first_seen_at,
        })
        await supabase
          .from('news_items')
          .update({ cluster_key })
          .eq('identity_key', key)
        detail.clusters_opened += 1
        detail.items_new += 1

        const seedAnchors = normalized.anchors
        openClusters.push({
          cluster_key,
          seed_identity: key,
          seed_anchors: seedAnchors,
          members: [memberView],
        })
        continue
      }

      await supabase.from('news_items').insert({
        identity_key: key,
        outlet_id,
        title: raw.title,
        description: raw.description ?? null,
        url: raw.link,
        published_at,
        first_seen_at,
        cluster_key,
        via_wire,
        creator: raw.creator ?? null,
      })
      detail.items_new += 1

      await supabase
        .from('news_clusters')
        .update({ last_item_at: first_seen_at })
        .eq('cluster_key', cluster_key)

      const clusterView = openClusters.find((c) => c.cluster_key === cluster_key)
      if (clusterView) clusterView.members.push(memberView)

      // Load cluster items for threshold / append
      const { data: clusterItems } = await supabase
        .from('news_items')
        .select('*')
        .eq('cluster_key', cluster_key)
      const items = (clusterItems ?? []) as NewsItemRow[]

      const { data: clusterRow } = await supabase
        .from('news_clusters')
        .select('*')
        .eq('cluster_key', cluster_key)
        .single()

      if (!clusterRow) continue

      if (clusterRow.status === 'promoted' && clusterRow.promoted_card_id) {
        const before = countThreshold(items.filter((i) => i.identity_key !== key))
        if (!before.outlets.has(outlet_id)) {
          const append = await appendOutletToPromotedCard(
            clusterRow.promoted_card_id,
            cluster_key,
            items.find((i) => i.identity_key === key)!,
            redirectBudget
          )
          detail.redirects_resolved += append.redirects_resolved
        }
        continue
      }

      if (clusterRow.status === 'open' && meetsThreshold(items, clusterRow.first_seen_at)) {
        if (detail.promotions >= MAX_PROMOTIONS_PER_RUN) {
          detail.promotions_deferred += 1
          console.warn('[news] promotion circuit breaker — deferring', cluster_key)
          continue
        }
        const result = await promoteCluster(
          cluster_key,
          items,
          clusterRow.first_seen_at,
          redirectBudget
        )
        detail.gemini_calls += result.gemini_calls
        detail.redirects_resolved += result.redirects_resolved
        if (result.promoted) {
          detail.promotions += 1
          const view = openClusters.find((c) => c.cluster_key === cluster_key)
          // keep in openClusters as promoted for further joins this run
          void view
        }
      }
    }

    // Near-miss scan on open clusters approaching expiry
    for (const c of openClusters) {
      const { data: clusterRow } = await supabase
        .from('news_clusters')
        .select('status, first_seen_at')
        .eq('cluster_key', c.cluster_key)
        .single()
      if (!clusterRow || clusterRow.status !== 'open') continue
      const age = Date.now() - new Date(clusterRow.first_seen_at).getTime()
      if (age < (WINDOW_HOURS - 2) * 3600_000) continue
      const { data: items } = await supabase
        .from('news_items')
        .select('*')
        .eq('cluster_key', c.cluster_key)
      const nm = nearMissForCluster(
        c.cluster_key,
        (items ?? []) as NewsItemRow[],
        clusterRow.first_seen_at
      )
      if (nm) detail.near_misses.push(nm)
    }

    await expireAndClose()
    await finishJob(jobKey, detail)
    return detail
  } catch (err) {
    console.error('[news] ingest fatal:', err)
    await finishJob(jobKey, { ...detail, near_misses: detail.near_misses })
    throw err
  }
}
