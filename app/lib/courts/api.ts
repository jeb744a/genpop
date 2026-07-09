import type { DocketListResponse } from './types'

const BASE_URL = 'https://www.courtlistener.com/api/rest/v4'

// Fields kept small — opinion text is huge and not needed at ingest time.
const DOCKET_FIELDS =
  'id,case_name,court_id,docket_number,date_filed,date_argued,date_terminated,date_modified,absolute_url,clusters'

/** Free-tier default (post-2026-05-07): 5/min, 50/hr, 125/day. Pace for the tightest. */
export const CL_MIN_INTERVAL_MS = 13_000
const CL_429_BACKOFF_MS = 60_000

function authHeader(): Record<string, string> {
  const token = process.env.COURTLISTENER_API_TOKEN
  if (!token) throw new Error('COURTLISTENER_API_TOKEN is not set')
  return { Authorization: `Token ${token}` }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

function parseRetryAfterMs(res: Response): number {
  const header = res.headers.get('retry-after')
  if (!header) return CL_429_BACKOFF_MS
  const asInt = parseInt(header, 10)
  if (!Number.isNaN(asInt)) return Math.max(asInt, 1) * 1000
  const asDate = Date.parse(header)
  if (!Number.isNaN(asDate)) return Math.max(asDate - Date.now(), 1_000)
  return CL_429_BACKOFF_MS
}

async function fetchCL<T>(url: string, retried = false): Promise<T> {
  const res = await fetch(url, { headers: authHeader() })

  if (res.status === 429) {
    if (!retried) {
      const waitMs = Math.min(parseRetryAfterMs(res), 120_000)
      console.warn(`[courts] CourtListener 429 — backing off ${Math.round(waitMs / 1000)}s then retrying once`)
      await sleep(waitMs)
      return fetchCL<T>(url, true)
    }
    throw new Error('CourtListener rate limit (429) — aborting run')
  }
  if (!res.ok) {
    throw new Error(`CourtListener API ${res.status} on ${url}`)
  }

  return res.json() as Promise<T>
}

export function buildDocketListUrl(watermarkMinus1h: string): string {
  const params = new URLSearchParams({
    court__jurisdiction: 'F',
    // Ascending so truncated catch-up advances the watermark through the backlog.
    order_by: 'date_modified',
    date_modified__gte: watermarkMinus1h,
    fields: DOCKET_FIELDS,
    page_size: '100',
  })
  return `${BASE_URL}/dockets/?${params}`
}

export async function fetchDocketPage(url: string): Promise<DocketListResponse> {
  return fetchCL<DocketListResponse>(url)
}

// fetchCluster is intentionally omitted here — cluster content is fetched lazily
// by Phase 2 AI Insight, not at ingest time, to stay within the free-tier quota.
