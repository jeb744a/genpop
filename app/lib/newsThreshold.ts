/**
 * Named tunables for the news threshold feed (SPEC_news_threshold.md).
 * Changing any of these bumps RULE_VERSION / OUTLET_LIST_VERSION /
 * CLUSTERING_VERSION as appropriate; versions are written into news_audit.
 */
import { OUTLET_LIST_VERSION as LIST_VERSION } from '@/app/lib/newsFeeds/outlets'

export const RULE_VERSION = '1.0'
export const CLUSTERING_VERSION = 'token-overlap-1'
export const OUTLET_LIST_VERSION = LIST_VERSION

export const THRESHOLD_N = 4
export const WINDOW_HOURS = 48
export const BUCKETS_REQUIRED = ['left', 'center', 'right'] as const

export const SIM_THRESHOLD = 0.35
/** Soak logging band: log candidate pairs in this range. */
export const SOAK_SIM_LOW = 0.2
export const SOAK_SIM_HIGH = 0.5
export const ANCHOR_SHARED_MIN = 2
export const SEED_ANCHOR_MIN = 1

export const MAX_ITEMS_PER_FEED = 50
export const MAX_REDIRECT_RESOLUTIONS = 25
export const MAX_PROMOTIONS_PER_RUN = 10
export const FETCH_TIMEOUT_MS = 10_000
/** Soft stop before Hobby's 300s function ceiling (see news route maxDuration). */
export const WALL_CLOCK_BUDGET_MS = 270_000
export const JITTER_MIN_MS = 100
export const JITTER_MAX_MS = 500
export const CONSECUTIVE_FAIL_ALARM = 3
export const HARD_CAP_DAYS = 7
export const EXPIRED_ITEM_RETENTION_DAYS = 7
export const STALE_RUNNING_HOURS = 2

export const JOB_PREFIX = 'ingest:news:'
