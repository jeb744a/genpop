export interface Session {
  session_id: number
  year_start: number
  year_end: number
  special: number   // 0 = regular, 1 = special
  sine_die: number  // 0 = active, 1 = adjourned
  prior: number     // 0 = current, 1 = archived
}

export interface MasterListItem {
  // bill_id is the map KEY in getMasterListRaw, not a field in the value object.
  number: string
  change_hash: string
  url: string
  status_date: string
  last_action_date: string
  last_action: string
  title: string
  status: number
}

// getMasterListRaw: key "0" = metadata, remaining keys = bill_id strings
export type MasterList = Record<string, MasterListItem | { session_id: number }>

export interface HistoryEntry {
  date: string
  action: string
  chamber: string
  importance: number
}

export interface Bill {
  bill_id: number
  change_hash: string
  state: string
  bill_number: string
  title: string
  description: string
  status: number
  status_date: string
  url: string
  state_link: string
  history: HistoryEntry[]
  sponsors: Array<{ name: string; party: string; role: string }>
  texts: unknown[]
  progress: unknown[]
  session: { session_id: number; year_start: number; year_end: number }
}

export interface GetSessionListResponse {
  status: string
  sessions: Session[]
}

export interface GetMasterListRawResponse {
  status: string
  masterlist: MasterList
}

export interface GetBillResponse {
  status: string
  bill: Bill
}

export interface LegiscanIngestResult {
  skipped?: boolean
  written: number
  skippedBills: number
  states: number
  shard?: number
  states_planned?: number
  truncated?: boolean
}
