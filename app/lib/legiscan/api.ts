import type {
  GetBillResponse,
  GetMasterListRawResponse,
  GetSessionListResponse,
} from './types'
import type { GetBillTextApiResponse } from './billTextTypes'

const BASE_URL = 'https://api.legiscan.com/'

async function fetchLegiscan<T>(op: string, params: Record<string, string> = {}): Promise<T> {
  const apiKey = process.env.LEGISCAN_API_KEY
  if (!apiKey) throw new Error('LEGISCAN_API_KEY is not set')

  const url = new URL(BASE_URL)
  url.searchParams.set('key', apiKey)
  url.searchParams.set('op', op)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)

  const res = await fetch(url.toString())
  if (!res.ok) throw new Error(`LegiScan API ${res.status} on op=${op}`)

  const json = (await res.json()) as { status: string } & T
  if (json.status !== 'OK') {
    throw new Error(`LegiScan op=${op} returned status="${json.status}"`)
  }

  return json
}

export async function getSessionList(state: string): Promise<GetSessionListResponse> {
  return fetchLegiscan<GetSessionListResponse>('getSessionList', { state })
}

export async function getMasterListRaw(sessionId: number): Promise<GetMasterListRawResponse> {
  return fetchLegiscan<GetMasterListRawResponse>('getMasterListRaw', {
    id: String(sessionId),
  })
}

export async function getBill(billId: number): Promise<GetBillResponse> {
  return fetchLegiscan<GetBillResponse>('getBill', { id: String(billId) })
}

/** Fallback PDF source — costs one LegiScan API query (SPEC_legiscan_pdf.md §5). */
export async function getBillText(docId: number): Promise<GetBillTextApiResponse> {
  return fetchLegiscan<GetBillTextApiResponse>('getBillText', { id: String(docId) })
}

export function pickActiveSession(
  sessions: GetSessionListResponse['sessions'],
  nowYear = new Date().getFullYear()
): number | null {
  // Prefer active (sine_die=0) regular (special=0) session in the current biennium.
  // Fall back to most recent non-prior regular session.
  const candidates = sessions
    .filter((s) => s.prior === 0 && s.special === 0)
    .sort((a, b) => b.year_start - a.year_start)

  // Active session overlapping now
  const active = candidates.find(
    (s) => s.sine_die === 0 && s.year_start <= nowYear && s.year_end >= nowYear
  )
  if (active) return active.session_id

  // Most recently started regular session
  return candidates[0]?.session_id ?? null
}
