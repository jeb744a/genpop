export interface FRDocument {
  document_number: string
  type: string
  subtype: string | null
  title: string
  abstract: string | null
  publication_date: string   // YYYY-MM-DD
  signing_date: string | null
  executive_order_number: string | null
  president: { name: string } | null
  agencies: Array<{ id: number; name: string }>
  html_url: string
  pdf_url: string | null
  body_html_url: string | null
  raw_text_url: string | null
}

export interface FRDocumentListResponse {
  count: number
  total_pages: number
  results: FRDocument[]
}

export interface FRIngestResult {
  skipped?: boolean
  written?: number
  skippedDocs?: number
  watermark?: string
}
