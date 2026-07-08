import type { FRDocument } from './types'

function deriveStatus(doc: FRDocument): string {
  switch (doc.subtype) {
    case 'Executive Order':
      return 'EO_ISSUED'
    case 'Proclamation':
      return 'PROCLAMATION'
    default:
      return 'PRES_ACTION'
  }
}

function dateToTimestamptz(date: string | null | undefined): string | null {
  if (!date) return null
  return `${date}T00:00:00Z`
}

export function mapToCard(doc: FRDocument) {
  return {
    card_type: 'executive' as const,
    sphere: 'federal' as const,
    source: 'fedreg',
    external_id: doc.document_number,
    title: doc.title.trim(),
    summary: doc.abstract ?? null,
    status: deriveStatus(doc),
    region: null,
    occurred_at: dateToTimestamptz(doc.signing_date ?? doc.publication_date),
    last_action_at: dateToTimestamptz(doc.publication_date),
    source_url: doc.html_url,
    raw: doc as unknown as Record<string, unknown>,
    topics: [] as string[],
    news_audit: null,
  }
}
