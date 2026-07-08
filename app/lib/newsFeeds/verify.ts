import { NBC_NEWS_SUBSTITUTE, NEWS_OUTLETS, type NewsBucket, type OutletDefinition } from './outlets'
import { parseFeedItems } from './rss'
import { newsFeedUserAgent } from './userAgent'

const FETCH_TIMEOUT_MS = 10_000
const GOOGLE_NEWS_REDIRECT_SAMPLES = 3

export interface RedirectSample {
  original_url: string
  resolved_url: string
  http_status: number | null
  error?: string
}

export interface FeedVerifyRow {
  outlet_id: string
  outlet: string
  bucket: NewsBucket
  url: string
  http_status: number | null
  item_count: number
  first_item_title: string | null
  ok: boolean
  variants_tried?: string[]
  substituted?: boolean
  substituted_for?: string
  redirect_samples?: RedirectSample[]
  notes?: string
}

export interface FeedVerifyReport {
  verified_at: string
  rows: FeedVerifyRow[]
  bucket_summary: Record<NewsBucket, { working: number; total: number; ok: boolean }>
  all_buckets_ok: boolean
}

async function fetchFeedBody(url: string): Promise<{
  status: number
  body: string
  error?: string
}> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': newsFeedUserAgent(),
        Accept: 'application/rss+xml, application/xml, text/xml, */*',
        'Accept-Encoding': 'gzip, deflate, br',
      },
      signal: controller.signal,
      redirect: 'follow',
    })
    const body = await res.text()
    return { status: res.status, body }
  } catch (err) {
    return {
      status: 0,
      body: '',
      error: err instanceof Error ? err.message : String(err),
    }
  } finally {
    clearTimeout(timer)
  }
}

function isFeedOk(status: number, body: string, items: ReturnType<typeof parseFeedItems>): boolean {
  return status >= 200 && status < 300 && body.length > 0 && items.length > 0
}

async function resolveRedirect(url: string): Promise<RedirectSample> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    let res = await fetch(url, {
      method: 'HEAD',
      headers: { 'User-Agent': newsFeedUserAgent() },
      redirect: 'follow',
      signal: controller.signal,
    })
    if (res.status === 405 || res.status === 403 || res.status === 501) {
      res = await fetch(url, {
        method: 'GET',
        headers: { 'User-Agent': newsFeedUserAgent() },
        redirect: 'follow',
        signal: controller.signal,
      })
    }
    return {
      original_url: url,
      resolved_url: res.url,
      http_status: res.status,
    }
  } catch (err) {
    return {
      original_url: url,
      resolved_url: url,
      http_status: null,
      error: err instanceof Error ? err.message : String(err),
    }
  } finally {
    clearTimeout(timer)
  }
}

async function verifyUrl(
  outlet: OutletDefinition,
  url: string,
  extra?: Partial<FeedVerifyRow>
): Promise<FeedVerifyRow> {
  const { status, body, error } = await fetchFeedBody(url)
  const items = body ? parseFeedItems(body) : []
  const ok = isFeedOk(status, body, items)

  let redirect_samples: RedirectSample[] | undefined
  if (outlet.googleNews && ok && items.length > 0) {
    redirect_samples = []
    for (const item of items.slice(0, GOOGLE_NEWS_REDIRECT_SAMPLES)) {
      redirect_samples.push(await resolveRedirect(item.link))
    }
  }

  return {
    outlet_id: outlet.id,
    outlet: outlet.name,
    bucket: outlet.bucket,
    url,
    http_status: status || null,
    item_count: items.length,
    first_item_title: items[0]?.title ?? null,
    ok,
    redirect_samples,
    notes: error ?? (ok ? undefined : body.length === 0 ? 'empty body' : 'no items parsed'),
    ...extra,
  }
}

async function verifyOutlet(outlet: OutletDefinition): Promise<FeedVerifyRow[]> {
  const variants_tried: string[] = []

  for (let i = 0; i < outlet.urls.length; i++) {
    const url = outlet.urls[i]
    variants_tried.push(url)
    const row = await verifyUrl(outlet, url, { variants_tried: [...variants_tried] })
    if (row.ok) return [row]
  }

  const failedUrl = outlet.urls[outlet.urls.length - 1]
  const failedRow = await verifyUrl(outlet, failedUrl, {
    variants_tried: [...variants_tried],
    notes: `All ${variants_tried.length} URL(s) failed`,
  })

  if (outlet.bucket === 'left') {
    const subUrl = NBC_NEWS_SUBSTITUTE.urls[0]
    const subRow = await verifyUrl(NBC_NEWS_SUBSTITUTE, subUrl, {
      substituted: true,
      substituted_for: outlet.id,
      notes: `L feed failed after variants; substituted NBC News (${subUrl})`,
    })
    return [
      { ...failedRow, notes: `${failedRow.notes}; see NBC substitution row` },
      {
        ...subRow,
        outlet_id: outlet.id,
        outlet: `${outlet.name} → NBC News (substitute)`,
      },
    ]
  }

  return [failedRow]
}

export async function verifyAllNewsFeeds(): Promise<FeedVerifyReport> {
  const rows: FeedVerifyRow[] = []

  for (const outlet of NEWS_OUTLETS) {
    const result = await verifyOutlet(outlet)
    rows.push(...result)
  }

  const bucket_summary: FeedVerifyReport['bucket_summary'] = {
    left: { working: 0, total: 0, ok: false },
    center: { working: 0, total: 0, ok: false },
    right: { working: 0, total: 0, ok: false },
  }

  for (const outlet of NEWS_OUTLETS) {
    bucket_summary[outlet.bucket].total += 1
    const primary = rows.find((r) => r.outlet_id === outlet.id && r.ok && !r.substituted)
    const substituted = rows.find(
      (r) => r.outlet_id === outlet.id && r.ok && r.substituted_for === outlet.id
    )
    if (primary || substituted) {
      bucket_summary[outlet.bucket].working += 1
    }
  }

  for (const bucket of Object.keys(bucket_summary) as NewsBucket[]) {
    bucket_summary[bucket].ok = bucket_summary[bucket].working >= 1
  }

  return {
    verified_at: new Date().toISOString(),
    rows,
    bucket_summary,
    all_buckets_ok: Object.values(bucket_summary).every((b) => b.ok),
  }
}

export function formatVerifyTable(report: FeedVerifyReport): string {
  const lines: string[] = []
  lines.push('')
  lines.push(
    '| Outlet | Bucket | URL | HTTP | Items | First title | Notes |'
  )
  lines.push('|--------|--------|-----|------|-------|-------------|-------|')

  for (const r of report.rows) {
    const title = (r.first_item_title ?? '—').replace(/\|/g, '/').slice(0, 60)
    const url = r.url.length > 50 ? r.url.slice(0, 47) + '…' : r.url
    const notes = [
      r.substituted ? 'SUBSTITUTED' : null,
      r.notes,
      r.redirect_samples?.length
        ? `redirects: ${r.redirect_samples.map((s) => `${s.http_status}→${new URL(s.resolved_url).hostname}`).join('; ')}`
        : null,
    ]
      .filter(Boolean)
      .join('; ')
      .replace(/\|/g, '/')
      .slice(0, 80)

    lines.push(
      `| ${r.outlet} | ${r.bucket} | ${url} | ${r.http_status ?? '—'} | ${r.item_count} | ${title} | ${notes || '—'} |`
    )
  }

  lines.push('')
  lines.push('Bucket summary:')
  for (const [bucket, s] of Object.entries(report.bucket_summary)) {
    lines.push(`  ${bucket}: ${s.working}/${s.total} working ${s.ok ? '✓' : '✗'}`)
  }
  lines.push(`All buckets OK: ${report.all_buckets_ok ? 'YES' : 'NO'}`)
  lines.push('')

  return lines.join('\n')
}
