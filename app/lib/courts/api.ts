import type { DocketListResponse } from './types'

const BASE_URL = 'https://www.courtlistener.com/api/rest/v4'

// Fields kept small — opinion text is huge and not needed at ingest time.
const DOCKET_FIELDS =
  'id,case_name,court_id,docket_number,date_filed,date_argued,date_terminated,date_modified,absolute_url,clusters'

function authHeader(): Record<string, string> {
  const token = process.env.COURTLISTENER_API_TOKEN
  if (!token) throw new Error('COURTLISTENER_API_TOKEN is not set')
  return { Authorization: `Token ${token}` }
}

async function fetchCL<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: authHeader() })

  if (res.status === 429) {
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
    order_by: '-date_modified',
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
// by Phase 2 AI Insight, not at ingest time, to stay within the 50 req/hr quota.
