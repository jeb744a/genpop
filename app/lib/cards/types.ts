// Columns selected for feed display (excludes raw, topics).
export interface CardRow {
  id: string
  card_type: 'legislative' | 'executive' | 'judicial' | 'live'
  sphere: 'federal' | 'state' | 'city'
  source: string
  external_id: string
  title: string
  summary: string | null
  status: string | null
  region: string | null
  occurred_at: string | null
  last_action_at: string | null
  source_url: string | null
  news_audit?: NewsAuditSummary | null
}

export interface NewsAuditOutletSummary {
  outlet_id: string
  name: string
  bucket: string
  item_title: string
  item_url: string
  published_at: string | null
  first_seen_at: string
  via_wire: string | null
}

export interface NewsAuditSummary {
  rule_version: string
  clustering_version: string
  outlet_list_version: string
  rule: { n: number; window_hours: number; buckets_required: string[] }
  cluster_key: string
  first_seen_at: string
  cleared_at: string
  outlets: NewsAuditOutletSummary[]
}

// CardRow + raw, for the detail page only.
export interface CardDetail extends CardRow {
  raw: Record<string, unknown>
}

export type SortMode = 'recent' | 'trending' | 'passed'

export interface FeedParams {
  sort: SortMode
  branches: string[]  // [] = all card_types
  spheres: string[]   // [] = all spheres
  page: number
}
