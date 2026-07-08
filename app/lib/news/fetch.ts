import { NEWS_OUTLETS, type NewsBucket, type OutletDefinition } from '@/app/lib/newsFeeds/outlets'
import { parseFeedItems, type RssItem } from '@/app/lib/newsFeeds/rss'
import { newsFeedUserAgent } from '@/app/lib/newsFeeds/userAgent'
import {
  FETCH_TIMEOUT_MS,
  JITTER_MAX_MS,
  JITTER_MIN_MS,
  MAX_ITEMS_PER_FEED,
} from '@/app/lib/newsThreshold'
import { createAdminClient } from '@/app/lib/supabase/admin'

export interface FetchedFeedItem extends RssItem {
  outlet_id: string
  creator?: string
}

export interface FeedFetchResult {
  outlet_id: string
  feed_url: string
  http_status: number | null
  not_modified: boolean
  items: FetchedFeedItem[]
  error?: string
  permanent_redirect_to?: string
}

function jitterMs(): number {
  return JITTER_MIN_MS + Math.random() * (JITTER_MAX_MS - JITTER_MIN_MS)
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

function extractCreator(rawXmlBlock: string): string | undefined {
  const m =
    rawXmlBlock.match(/<dc:creator[^>]*>([\s\S]*?)<\/dc:creator>/i) ??
    rawXmlBlock.match(/<author[^>]*>([\s\S]*?)<\/author>/i)
  return m?.[1]?.replace(/<!\[CDATA\[|\]\]>/g, '').trim()
}

async function loadFeedState(outletId: string) {
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('news_feed_state')
    .select('*')
    .eq('outlet_id', outletId)
    .maybeSingle()
  return data as {
    outlet_id: string
    feed_url: string
    etag: string | null
    last_modified: string | null
    consecutive_fails: number
  } | null
}

async function saveFeedState(row: {
  outlet_id: string
  feed_url: string
  etag?: string | null
  last_modified?: string | null
  last_status: number | null
  consecutive_fails: number
  ok: boolean
}): Promise<void> {
  const supabase = createAdminClient()
  const now = new Date().toISOString()
  await supabase.from('news_feed_state').upsert(
    {
      outlet_id: row.outlet_id,
      feed_url: row.feed_url,
      etag: row.etag ?? null,
      last_modified: row.last_modified ?? null,
      last_status: row.last_status,
      consecutive_fails: row.consecutive_fails,
      last_fetched_at: now,
      last_ok_at: row.ok ? now : undefined,
      updated_at: now,
    },
    { onConflict: 'outlet_id' }
  )
}

/**
 * Resolve Google News article URL to a canonical outlet URL when possible.
 * Decodes google redirect `url=` param; falls back to followed Location.
 */
export async function resolveCanonicalUrl(url: string): Promise<string> {
  try {
    const u = new URL(url)
    if (u.hostname.includes('news.google.com')) {
      const embedded = u.searchParams.get('url')
      if (embedded) return embedded
      // Article links often encode destination in path — try follow
    }
  } catch {
    return url
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'User-Agent': newsFeedUserAgent() },
      redirect: 'follow',
      signal: controller.signal,
    })
    const finalUrl = res.url
    if (finalUrl && !finalUrl.includes('news.google.com')) return finalUrl

    // Parse HTML for data-n-au / canonical link when still on Google
    const html = await res.text()
    const dataAu = html.match(/data-n-au="([^"]+)"/)
    if (dataAu?.[1]) return dataAu[1].replace(/&amp;/g, '&')
    const canonical = html.match(/<link[^>]+rel="canonical"[^>]+href="([^"]+)"/i)
    if (canonical?.[1] && !canonical[1].includes('news.google.com')) return canonical[1]
    return finalUrl || url
  } catch {
    return url
  } finally {
    clearTimeout(timer)
  }
}

export async function fetchOutletFeed(outlet: OutletDefinition): Promise<FeedFetchResult> {
  const state = await loadFeedState(outlet.id)
  const feedUrl = state?.feed_url || outlet.urls[0]

  const headers: Record<string, string> = {
    'User-Agent': newsFeedUserAgent(),
    Accept: 'application/rss+xml, application/xml, text/xml, */*',
    'Accept-Encoding': 'gzip, deflate, br',
  }
  if (state?.etag) headers['If-None-Match'] = state.etag
  if (state?.last_modified) headers['If-Modified-Since'] = state.last_modified

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

  try {
    let res = await fetch(feedUrl, { headers, signal: controller.signal, redirect: 'manual' })

    // Permanent redirect → update stored URL (SPEC §6.3)
    if (res.status === 301 || res.status === 308) {
      const location = res.headers.get('location')
      if (location) {
        console.warn(`[news] permanent redirect for ${outlet.id}: ${feedUrl} → ${location}`)
        const abs = new URL(location, feedUrl).toString()
        res = await fetch(abs, {
          headers: {
            'User-Agent': newsFeedUserAgent(),
            Accept: headers.Accept,
            'Accept-Encoding': headers['Accept-Encoding'],
          },
          signal: controller.signal,
          redirect: 'follow',
        })
        await saveFeedState({
          outlet_id: outlet.id,
          feed_url: abs,
          etag: res.headers.get('etag'),
          last_modified: res.headers.get('last-modified'),
          last_status: res.status,
          consecutive_fails: res.ok ? 0 : (state?.consecutive_fails ?? 0) + 1,
          ok: res.ok,
        })
        if (!res.ok) {
          return {
            outlet_id: outlet.id,
            feed_url: abs,
            http_status: res.status,
            not_modified: false,
            items: [],
            error: `HTTP ${res.status}`,
            permanent_redirect_to: abs,
          }
        }
        const body = await res.text()
        const items = parseFeedItems(body)
          .slice(0, MAX_ITEMS_PER_FEED)
          .map((it) => ({ ...it, outlet_id: outlet.id }))
        return {
          outlet_id: outlet.id,
          feed_url: abs,
          http_status: res.status,
          not_modified: false,
          items,
          permanent_redirect_to: abs,
        }
      }
    }

    // Follow normal redirects
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location')
      if (location) {
        res = await fetch(new URL(location, feedUrl).toString(), {
          headers: {
            'User-Agent': newsFeedUserAgent(),
            Accept: headers.Accept,
            'Accept-Encoding': headers['Accept-Encoding'],
            ...(state?.etag ? { 'If-None-Match': state.etag } : {}),
            ...(state?.last_modified ? { 'If-Modified-Since': state.last_modified } : {}),
          },
          signal: controller.signal,
          redirect: 'follow',
        })
      }
    }

    if (res.status === 304) {
      await saveFeedState({
        outlet_id: outlet.id,
        feed_url: feedUrl,
        etag: state?.etag,
        last_modified: state?.last_modified,
        last_status: 304,
        consecutive_fails: 0,
        ok: true,
      })
      return {
        outlet_id: outlet.id,
        feed_url: feedUrl,
        http_status: 304,
        not_modified: true,
        items: [],
      }
    }

    if (!res.ok) {
      const fails = (state?.consecutive_fails ?? 0) + 1
      await saveFeedState({
        outlet_id: outlet.id,
        feed_url: feedUrl,
        etag: state?.etag,
        last_modified: state?.last_modified,
        last_status: res.status,
        consecutive_fails: fails,
        ok: false,
      })
      return {
        outlet_id: outlet.id,
        feed_url: feedUrl,
        http_status: res.status,
        not_modified: false,
        items: [],
        error: `HTTP ${res.status}`,
      }
    }

    const body = await res.text()
    const items = parseFeedItems(body)
      .slice(0, MAX_ITEMS_PER_FEED)
      .map((it) => ({ ...it, outlet_id: outlet.id, creator: undefined }))

    await saveFeedState({
      outlet_id: outlet.id,
      feed_url: feedUrl,
      etag: res.headers.get('etag'),
      last_modified: res.headers.get('last-modified'),
      last_status: res.status,
      consecutive_fails: 0,
      ok: true,
    })

    return {
      outlet_id: outlet.id,
      feed_url: feedUrl,
      http_status: res.status,
      not_modified: false,
      items,
    }
  } catch (err) {
    const fails = (state?.consecutive_fails ?? 0) + 1
    await saveFeedState({
      outlet_id: outlet.id,
      feed_url: feedUrl,
      etag: state?.etag,
      last_modified: state?.last_modified,
      last_status: 0,
      consecutive_fails: fails,
      ok: false,
    })
    return {
      outlet_id: outlet.id,
      feed_url: feedUrl,
      http_status: null,
      not_modified: false,
      items: [],
      error: err instanceof Error ? err.message : String(err),
    }
  } finally {
    clearTimeout(timer)
  }
}

export async function fetchAllOutletFeeds(): Promise<{
  results: FeedFetchResult[]
  items: FetchedFeedItem[]
}> {
  const results: FeedFetchResult[] = []
  const items: FetchedFeedItem[] = []

  for (let i = 0; i < NEWS_OUTLETS.length; i++) {
    if (i > 0) await delay(jitterMs())
    const result = await fetchOutletFeed(NEWS_OUTLETS[i])
    results.push(result)
    items.push(...result.items)
  }

  return { results, items }
}

export function outletById(id: string): OutletDefinition | undefined {
  return NEWS_OUTLETS.find((o) => o.id === id)
}

export function bucketForOutlet(id: string): NewsBucket | null {
  return outletById(id)?.bucket ?? null
}

// silence unused helper warning in case creator extraction unused in this path
void extractCreator
