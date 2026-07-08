import type { Bill } from './types'

// LegiScan numeric status codes → shared label set (identical to Congress labels).
const STATUS_MAP: Record<number, string> = {
  1: 'INTRODUCED',
  2: 'PASSED_CHAMBER', // Engrossed = passed one chamber
  3: 'PASSED',         // Enrolled = passed both, awaiting signature
  4: 'ENACTED',        // Passed = chaptered/signed into law
  5: 'VETOED',
  6: 'FAILED',
}

function dateToTimestamptz(date: string | null | undefined): string | null {
  if (!date || date === '0000-00-00') return null
  return `${date}T00:00:00Z`
}

function earliestHistoryDate(bill: Bill): string | null {
  if (!bill.history?.length) return null
  const sorted = [...bill.history]
    .filter((h) => h.date && h.date !== '0000-00-00')
    .sort((a, b) => a.date.localeCompare(b.date))
  return sorted[0]?.date ?? null
}

export function mapToCard(bill: Bill) {
  const summary = bill.description?.trim() || null
  const sourceUrl = bill.state_link || bill.url

  return {
    card_type: 'legislative' as const,
    sphere: 'state' as const,
    source: 'legiscan',
    external_id: String(bill.bill_id),
    title: bill.title.trim(),
    summary,
    status: STATUS_MAP[bill.status] ?? 'INTRODUCED',
    region: bill.state,
    occurred_at: dateToTimestamptz(earliestHistoryDate(bill)),
    last_action_at: dateToTimestamptz(bill.status_date),
    source_url: sourceUrl,
    raw: bill as unknown as Record<string, unknown>,
    topics: [] as string[],
    news_audit: null,
  }
}
