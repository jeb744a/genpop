import type { Docket } from './types'

const CL_BASE = 'https://www.courtlistener.com'

function deriveStatus(docket: Docket): string {
  if (docket.date_terminated) return 'DECIDED'
  if (docket.date_argued) return 'ARGUED'
  return 'PENDING'
}

function dateToTimestamptz(date: string | null | undefined): string | null {
  if (!date) return null
  // date_argued / date_filed are plain dates (YYYY-MM-DD); date_modified is full ISO.
  if (date.length === 10) return `${date}T00:00:00Z`
  return new Date(date).toISOString()
}

// Cluster content is NOT fetched at ingest time (50 req/hr limit on free accounts).
// raw.clusters holds the cluster API URLs; Phase 2 AI Insight fetches content lazily.
export function mapToCard(docket: Docket, raw: Record<string, unknown>) {
  const title = docket.case_name.trim()

  return {
    card_type: 'judicial' as const,
    sphere: 'federal' as const,
    source: 'courtlistener',
    external_id: `docket-${docket.id}`,
    title,
    summary: null,
    status: deriveStatus(docket),
    region: null,
    occurred_at: dateToTimestamptz(docket.date_argued ?? docket.date_filed),
    last_action_at: dateToTimestamptz(docket.date_modified),
    source_url: `${CL_BASE}${docket.absolute_url}`,
    raw,
    topics: [] as string[],
    news_audit: null,
  }
}
