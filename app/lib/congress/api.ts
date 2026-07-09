import type {
  BillDetailResponse,
  BillListResponse,
  SummariesResponse,
  TextVersionsResponse,
} from './types'

const BASE_URL = 'https://api.congress.gov/v3'

// Congress API requires dates in YYYY-MM-DDT00:00:00Z without milliseconds.
export function toCongressDate(iso: string): string {
  return iso.slice(0, 10) + 'T00:00:00Z'
}

async function fetchCongress<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const apiKey = process.env.CONGRESS_GOV_API_KEY
  if (!apiKey) throw new Error('CONGRESS_GOV_API_KEY is not set')

  // Build the URL manually so sort=updateDate desc is encoded as sort=updateDate+desc,
  // not sort=updateDate%2Bdesc (URLSearchParams encodes space as +, + as %2B).
  const base = `${BASE_URL}${path}?api_key=${encodeURIComponent(apiKey)}&format=json`
  const extra = Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&')
  const fullUrl = extra ? `${base}&${extra}` : base

  let lastError: Error | null = null
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(fullUrl)

    if (res.status === 429) {
      const delay = 1000 * Math.pow(2, attempt)
      await new Promise((r) => setTimeout(r, delay))
      lastError = new Error('Rate limited (429)')
      continue
    }

    if (!res.ok) {
      throw new Error(`Congress API ${res.status} on ${path}`)
    }

    return res.json() as Promise<T>
  }

  throw lastError ?? new Error('Fetch failed after retries')
}

export async function fetchBillPage(
  fromDateTime: string,
  toDateTime: string,
  offset: number,
  limit = 250,
  /** Ascending so truncated catch-up can advance the watermark safely. */
  sort: 'updateDate asc' | 'updateDate desc' = 'updateDate asc'
): Promise<BillListResponse> {
  return fetchCongress<BillListResponse>('/bill', {
    sort,
    fromDateTime,
    toDateTime,
    limit: String(limit),
    offset: String(offset),
  })
}

export async function fetchBillDetail(
  congress: number,
  type: string,
  number: string
): Promise<BillDetailResponse> {
  return fetchCongress<BillDetailResponse>(
    `/bill/${congress}/${type.toLowerCase()}/${number}`
  )
}

export async function fetchSummaries(
  congress: number,
  type: string,
  number: string
): Promise<SummariesResponse> {
  return fetchCongress<SummariesResponse>(
    `/bill/${congress}/${type.toLowerCase()}/${number}/summaries`
  )
}

export async function fetchTextVersions(
  congress: number,
  type: string,
  number: string
): Promise<TextVersionsResponse> {
  return fetchCongress<TextVersionsResponse>(
    `/bill/${congress}/${type.toLowerCase()}/${number}/text`
  )
}
