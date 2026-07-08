export interface Docket {
  id: number
  court_id: string
  case_name: string
  docket_number: string
  date_filed: string | null
  date_argued: string | null
  date_terminated: string | null
  date_modified: string  // ISO 8601 with timezone offset
  absolute_url: string
  clusters: string[]     // cluster API URLs
}

export interface Cluster {
  id: number
  case_name: string
  date_filed: string | null
  citations: Array<{ volume: number; reporter: string; page: number; type: number }>
  sub_opinions: string[]
}

export interface DocketListResponse {
  count: string | number  // CL returns count as a URL string, not a number
  next: string | null
  results: Docket[]
}

export interface CourtsIngestResult {
  skipped?: boolean
  written?: number
  skippedDockets?: number
  watermark?: string
}
