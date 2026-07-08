import type { BillDetail, Summary } from './types'

const BILL_TYPE_TO_PATH: Record<string, string> = {
  hr: 'house-bill',
  s: 'senate-bill',
  hjres: 'house-joint-resolution',
  sjres: 'senate-joint-resolution',
  hconres: 'house-concurrent-resolution',
  sconres: 'senate-concurrent-resolution',
  hres: 'house-resolution',
  sres: 'senate-resolution',
}

function ordinal(n: number): string {
  const mod100 = n % 100
  const mod10 = n % 10
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`
  if (mod10 === 1) return `${n}st`
  if (mod10 === 2) return `${n}nd`
  if (mod10 === 3) return `${n}rd`
  return `${n}th`
}

export function buildExternalId(congress: number, type: string, number: string): string {
  return `${congress}-${type.toLowerCase()}-${number}`
}

export function buildSourceUrl(congress: number, type: string, number: string): string {
  const congressPath = `${ordinal(congress)}-congress`
  const typePath = BILL_TYPE_TO_PATH[type.toLowerCase()] ?? `${type.toLowerCase()}-bill`
  return `https://www.congress.gov/bill/${congressPath}/${typePath}/${number}`
}

export function stripSummaryHtml(text: string): string {
  return text
    .replace(/^<!\[CDATA\[/, '')
    .replace(/\]\]>$/, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function pickLatestSummary(summaries: Summary[]): string | null {
  if (!summaries.length) return null
  const sorted = [...summaries].sort(
    (a, b) => new Date(b.actionDate).getTime() - new Date(a.actionDate).getTime()
  )
  return stripSummaryHtml(sorted[0].text)
}

export function deriveStatus(bill: BillDetail): string {
  const actionText = bill.latestAction?.text ?? ''

  if ((bill.laws && bill.laws.length > 0) || actionText.includes('Became Public Law')) {
    return 'ENACTED'
  }
  if (/vetoed/i.test(actionText)) return 'VETOED'
  if (/failed|rejected/i.test(actionText)) return 'FAILED'
  if (/presented to the president/i.test(actionText)) return 'TO_PRESIDENT'
  if (/enrolled/i.test(actionText)) return 'PASSED'
  if (/passed (?:the )?(?:house|senate)|passed\/agreed to/i.test(actionText)) {
    return 'PASSED_CHAMBER'
  }
  return 'INTRODUCED'
}

function dateToTimestamptz(date: string | undefined): string | null {
  if (!date) return null
  return `${date}T00:00:00Z`
}

export function mapToCard(
  bill: BillDetail,
  summary: string | null,
  raw: Record<string, unknown>
) {
  return {
    card_type: 'legislative' as const,
    sphere: 'federal' as const,
    source: 'congress',
    external_id: buildExternalId(bill.congress, bill.type, bill.number),
    title: bill.title.trim(),
    summary,
    status: deriveStatus(bill),
    region: null,
    occurred_at: dateToTimestamptz(bill.introducedDate),
    last_action_at: dateToTimestamptz(bill.latestAction?.actionDate),
    source_url: buildSourceUrl(bill.congress, bill.type, bill.number),
    raw,
    topics: [] as string[],
    news_audit: null,
  }
}
