# SPEC — Congress.gov ingestion (`source='congress'`)

Federal legislative cards. Cron route: `/api/ingest/congress`.
Target table: `cards` (see `schema.sql`). Verified 2026-06-15 against
<https://api.congress.gov/v3> docs.

Constants for every row this job writes:
`card_type='legislative'`, `sphere='federal'`, `source='congress'`.

---

## 1. Endpoints used

Base: `https://api.congress.gov/v3`  ·  Auth: query param
`?api_key=${CONGRESS_GOV_API_KEY}` (5,000 req/hr).  Always pass `&format=json`.

| Purpose | Endpoint | Required params |
|---|---|---|
| List recently-updated bills | `GET /bill` | `api_key`, `format=json`, `sort=updateDate+desc`, `fromDateTime`, `toDateTime` (ISO 8601 `YYYY-MM-DDT00:00:00Z`), `limit` (≤250), `offset` |
| Bill detail | `GET /bill/{congress}/{billType}/{billNumber}` | `api_key`, `format=json` |
| CRS summaries | `GET /bill/{congress}/{billType}/{billNumber}/summaries` | `api_key`, `format=json` |
| Full-text versions | `GET /bill/{congress}/{billType}/{billNumber}/text` | `api_key`, `format=json` |

`billType` ∈ `hr, s, hjres, sjres, hconres, sconres, hres, sres`. Current
Congress = 119.

Per-card flow: page `/bill` for changed bills → for each, call detail +
summaries + text to fill `summary` and the full-text URL. (Sponsors arrive in
the detail payload, no extra call.)

> Verified now (was "confirm in code"): rate limit is **5,000/hr** per key;
> there is **no native status enum** — status must be derived (see §2).

---

## 2. Field mapping table

| `cards` column | source field (JSON path) | transform | notes |
|---|---|---|---|
| `card_type` | — | constant `'legislative'` | |
| `sphere` | — | constant `'federal'` | |
| `source` | — | constant `'congress'` | |
| `external_id` | `bill.congress` + `bill.type` + `bill.number` | lowercase-join → `"{congress}-{type}-{number}"`, e.g. `119-hr-1` | **stable unique id.** Bill number is unique only within a (congress, type); the composite is the stable key. |
| `title` | `bill.title` | trim | |
| `summary` | `summaries[]` → latest by `actionDate` → `.text` | strip CDATA + HTML tags → plain text | source-provided CRS summary, **not AI**. May be absent for brand-new bills → leave `null`. |
| `status` | derived | see status map below | no native field. |
| `region` | — | `null` | federal sphere has no region. |
| `occurred_at` | `bill.introducedDate` | date → timestamptz | when the bill first appeared. |
| `last_action_at` | `bill.latestAction.actionDate` | date → timestamptz | drives the feed sort; refreshed on re-runs. |
| `source_url` | `bill.url` (API) → public page | rewrite to congress.gov bill page; fallback to API url | |
| `raw` | entire merged bill object (detail + sponsors + text formats) | store as-is jsonb | full payload incl. `sponsors[]`, `laws[]`, `textVersions[].formats[].url`, `congress`. |
| `topics` | — | `'{}'` (empty) | tagged later by the Gemini topic pass; **left empty at ingestion**. |
| `news_audit` | — | `null` | live/news source only. |

### Status derivation → short labels (shared with state legislative)

Derive from `bill.laws[]`, then `bill.latestAction.text`, then action `type`:

| Condition (first match wins) | `status` |
|---|---|
| `laws[]` present **or** latestAction text contains "Became Public Law" | `ENACTED` |
| latestAction text contains "Vetoed" | `VETOED` |
| latestAction text contains "Failed" / "rejected" | `FAILED` |
| text contains "Presented to President" | `TO_PRESIDENT` |
| passed both chambers (text "Passed/agreed to in Senate" after House, or enrolled) | `PASSED` |
| passed one chamber (text "Passed House"/"Passed Senate") | `PASSED_CHAMBER` |
| referred to committee / introduced | `INTRODUCED` |

> ⚠️ Lossy: Congress.gov gives free-text actions, not a code. This regex/keyword
> map is a pragmatic approximation — see chat summary; finalize the label set with
> the developer. Store the raw `latestAction` in `raw` so the mapping can be
> re-derived if the label set changes.

---

## 3. Pagination & freshness strategy

- **Page:** `/bill?sort=updateDate+desc&limit=250&offset=N`, increment `offset`
  by 250 until the page's items are all older than the watermark (or results
  exhausted).
- **Bound to recent:** pass `fromDateTime = <last successful run's max updateDate
  minus 1h safety overlap>` and `toDateTime = now`. The **watermark** (max
  `updateDate` seen) is stored in `job_log.detail->>'watermark'` for the most
  recent successful `ingest:congress:*` row; on first run, default to `now − 7d`.
- **Cadence:** hourly (`0 * * * *`). A typical hour touches only a few dozen
  changed bills → well within budget.

---

## 4. Dedup & idempotency

- **Upsert key:** `(source, external_id)` → `ON CONFLICT (source, external_id) DO UPDATE`.
- **`job_log` key:** `ingest:congress:<ISO-hour>`, e.g. `ingest:congress:2026-06-15T18`.
  Insert with `ON CONFLICT (job_key) DO NOTHING` to make a re-run within the hour
  a no-op at the job level.
- **Re-run on an already-stored bill → UPDATE**, refreshing:
  `status`, `last_action_at`, `summary`, `source_url`, `raw`, `updated_at`.
  **Never overwrite:** `id`, `created_at`, `topics` (preserve later tagging),
  `external_id`, `source`. `occurred_at` is stable (introduced date) — write once.

---

## 5. Rate-limit & failure notes

- **Limit:** 5,000 req/hr. Worst case per hourly run ≈ (1 list page) + 3 calls ×
  changed bills. Even 200 changed bills = ~600 calls/hr → safe.
- **Partial failure = log + continue.** Process bills independently; a failed
  detail/summary fetch logs a warning and skips that bill (it'll be picked up next
  run because its `updateDate` is still ≥ watermark). Only advance the stored
  watermark to the max `updateDate` **successfully** written, so nothing is
  skipped permanently. The whole job is safe to re-run.
- On HTTP 429, exponential backoff; on repeated failure, abort **without**
  advancing the watermark.

---

## 6. Worked example (acceptance test)

Upstream (trimmed `GET /bill/119/hr/1?format=json`):

```json
{ "bill": {
  "congress": 119, "type": "HR", "number": "1",
  "title": "One Big Beautiful Bill Act",
  "introducedDate": "2025-01-03",
  "latestAction": { "actionDate": "2025-07-04", "text": "Became Public Law No: 119-21." },
  "sponsors": [ { "bioguideId": "A000148", "fullName": "Rep. Arrington, Jodey [R-TX-19]", "party": "R", "state": "TX" } ],
  "laws": [ { "type": "Public Law", "number": "119-21" } ],
  "url": "https://api.congress.gov/v3/bill/119/hr/1"
} }
```

Becomes the `cards` row:

| column | value |
|---|---|
| `card_type` | `legislative` |
| `sphere` | `federal` |
| `source` | `congress` |
| `external_id` | `119-hr-1` |
| `title` | `One Big Beautiful Bill Act` |
| `summary` | *(latest CRS summary text, CDATA/HTML stripped)* |
| `status` | `ENACTED` *(laws[] present)* |
| `region` | `null` |
| `occurred_at` | `2025-01-03T00:00:00Z` |
| `last_action_at` | `2025-07-04T00:00:00Z` |
| `source_url` | `https://www.congress.gov/bill/119th-congress/house-bill/1` |
| `raw` | *(full merged bill JSON)* |
| `topics` | `{}` |
| `news_audit` | `null` |
