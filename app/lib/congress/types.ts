export interface BillListItem {
  congress: number
  type: string
  number: string
  title: string
  url: string
  updateDate: string
  latestAction?: { actionDate: string; text: string }
}

export interface BillDetail extends BillListItem {
  introducedDate: string
  sponsors?: Array<{
    bioguideId: string
    fullName: string
    party: string
    state: string
  }>
  laws?: Array<{ type: string; number: string }>
  textVersions?: Array<{
    type: string
    formats: Array<{ url: string; type: string }>
  }>
}

export interface Summary {
  actionDate: string
  text: string
  actionDesc: string
}

export interface TextVersion {
  type: string
  formats: Array<{ url: string; type: string }>
}

export interface BillListResponse {
  bills: BillListItem[]
  pagination: { count: number; next?: string }
}

export interface BillDetailResponse {
  bill: BillDetail
}

export interface SummariesResponse {
  summaries: Summary[]
}

export interface TextVersionsResponse {
  textVersions: TextVersion[]
}

export interface IngestResult {
  skipped?: boolean
  written?: number
  skippedBills?: number
  watermark?: string
}
