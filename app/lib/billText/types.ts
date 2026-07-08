/** LegiScan bill-text version from raw.texts[] */
export interface BillTextVersion {
  doc_id: number
  type: string
  type_id: number
  date: string
  mime: string
  text_size: number
  text_hash: string
  state_link: string
}

export type BillTextStatus =
  | 'ok'
  | 'image_only'
  | 'no_text_version'
  | 'too_large'
  | 'fetch_failed'
  | 'parse_failed'
  | 'low_quality'

export interface BillTextRow {
  doc_id: number
  card_id: string
  text_hash: string
  type_id: number
  type: string | null
  version_date: string | null
  state_link: string | null
  extracted_text: string | null
  char_count: number | null
  page_count: number | null
  status: BillTextStatus
  fetched_at: string
}

export interface QualityMetrics {
  char_count: number
  dictionary_ratio: number | null
  avg_token_length: number | null
  has_legislative_marker: boolean
  failure_reason?: string
}

export interface AcquireResult {
  status: BillTextStatus
  text: string | null
  doc_id: number | null
  version: BillTextVersion | null
  from_cache: boolean
  network_fetches: number
  quality?: QualityMetrics
}

export interface ValidationRow {
  card_id: string
  bill_number: string
  doc_id: number | null
  version_type: string | null
  status: BillTextStatus
  char_count: number | null
  dictionary_ratio: number | null
  text_preview: string
}

/** Statuses that should not be retried on subsequent passes. */
export const NON_RETRYABLE_STATUSES: ReadonlySet<BillTextStatus> = new Set([
  'ok',
  'image_only',
  'too_large',
  'low_quality',
  'no_text_version',
])
