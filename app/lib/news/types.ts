import type { NewsBucket } from '@/app/lib/newsFeeds/outlets'
import type { RULE_VERSION, CLUSTERING_VERSION, OUTLET_LIST_VERSION } from '@/app/lib/newsThreshold'

export interface NewsAuditOutlet {
  outlet_id: string
  name: string
  bucket: NewsBucket
  item_title: string
  item_url: string
  published_at: string | null
  first_seen_at: string
  via_wire: string | null
}

export interface NewsAudit {
  rule_version: string
  clustering_version: string
  outlet_list_version: string
  rule: {
    n: number
    window_hours: number
    buckets_required: string[]
  }
  cluster_key: string
  first_seen_at: string
  cleared_at: string
  outlets: NewsAuditOutlet[]
}

export interface NewsItemRow {
  identity_key: string
  outlet_id: string
  title: string
  description: string | null
  url: string
  published_at: string | null
  first_seen_at: string
  cluster_key: string | null
  via_wire: string | null
  creator: string | null
}

export interface NewsClusterRow {
  cluster_key: string
  seed_identity: string
  first_seen_at: string
  status: 'open' | 'promoted' | 'expired' | 'closed'
  promoted_card_id: string | null
  last_item_at: string
  cleared_at: string | null
}

export interface NearMiss {
  cluster_key: string
  outlet_count: number
  buckets: string[]
  missing_buckets: string[]
  reason: string
}

export interface NewsIngestDetail {
  items_fetched: number
  items_new: number
  clusters_opened: number
  clusters_joined: number
  promotions: number
  promotions_deferred: number
  near_misses: NearMiss[]
  feed_status: Array<{
    outlet_id: string
    http_status: number | null
    items: number
    not_modified: boolean
    error?: string
  }>
  soak_pairs_logged: number
  redirects_resolved: number
  gemini_calls: number
  skipped?: boolean
}

// Keep versions importable for audit construction
export type Versions = {
  rule_version: typeof RULE_VERSION
  clustering_version: typeof CLUSTERING_VERSION
  outlet_list_version: typeof OUTLET_LIST_VERSION
}
