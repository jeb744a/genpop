# SPEC — State legislation ingestion (`source='legiscan'`)

State legislative cards, all 50 states. Cron route: `/api/ingest/states`.
Target table: `cards`. Provider = **LegiScan** (DATA_SOURCES.md recommendation:
cleaner all-50 coverage, uniform schema, `change_hash` for cheap diffing, 30k/mo
free tier). Verified 2026-06-15 against
<https://legiscan.com/gaits/documentation/legiscan> and the API user manual.

Constants for every row:
`card_type='legislative'`, `sphere='state'`, `source='legiscan'`,
`region=<2-letter state code>`.

> Goal: state legislative cards are **structurally identical** to Congress.gov
> cards — same columns, same status labels — differing only in `sphere`, `source`,
> and a populated `region`.

---

## 1. Endpoints used

Base: `https://api.legiscan.com/`  ·  Auth: query param `?key=${LEGISCAN_API_KEY}`.
Single base URL, operation selected by `op=`.

| Purpose | Call | Notes |
|---|---|---|
| Find current session per state | `?key=…&op=getSessionList&state=CA` | returns `sessions[]` with `session_id`, `year_start/end`, `special`. Pick the active regular session. Cache per run. |
| Cheap change snapshot | `?key=…&op=getMasterListRaw&id={session_id}` | returns `masterlist` map of `bill_id → { number, change_hash, url, last_action_date, last_action, status }`. **1 call per state**, no per-bill cost. |
| Bill detail (only when changed) | `?key=…&op=getBill&id={bill_id}` | full record: `title`, `description`, `status`, `status_date`, `history[]`, `progress[]`, `sponsors[]`, `texts[]`, `state`, `state_link`, `url`. |

Flow per state: resolve `session_id` → `getMasterListRaw` → diff `change_hash`
against stored values → `getBill` only for new/changed bills → upsert.

> Verified now: status codes are **1=Introduced, 2=Engrossed, 3=Enrolled,
> 4=Passed, 5=Vetoed, 6=Failed/Dead** (LegiScan aggregate `status`); free public
> key limit **30,000 queries/month** (this drives the cadence in §3/§5).

---

## 2. Field mapping table

| `cards` column | source field (JSON path, from `getBill`) | transform | notes |
|---|---|---|---|
| `card_type` | — | constant `'legislative'` | same as Congress. |
| `sphere` | — | constant `'state'` | |
| `source` | — | constant `'legiscan'` | the 5th source value (extends the schema's federal list). |
| `external_id` | `bill.bill_id` | stringify | **stable unique id** — LegiScan `bill_id` is globally unique across all states/sessions. |
| `title` | `bill.title` | trim | maps to Congress `title`. |
| `summary` | `bill.description` | trim; if empty → `null` | LegiScan's plain-language description ≈ a source summary (not AI). |
| `status` | `bill.status` (numeric) | map 1–6 → label | see status map — **same label set as Congress**. |
| `region` | `bill.state` | 2-letter code, e.g. `CA` | **state code**, per schema's `region` rule for `sphere='state'`. |
| `occurred_at` | earliest `bill.history[].date` (introduced) | date → timestamptz | = Congress `introducedDate` analog. |
| `last_action_at` | `bill.status_date` (or masterlist `last_action_date`) | date → timestamptz | = Congress `latestAction.actionDate` analog; drives feed sort. |
| `source_url` | `bill.state_link` ?? `bill.url` | prefer official legislature link; fall back to LegiScan page | |
| `raw` | entire `getBill` object | jsonb as-is | **store `change_hash` here** (`raw->>'change_hash'`) — it's the diff watermark. Incl. `sponsors[]`, `texts[]`, `progress[]`, `history[]`. |
| `topics` | — | `'{}'` | tagged later; empty at ingestion. |
| `news_audit` | — | `null` | news source only. |

### Status derivation → short labels (identical to Congress)

| LegiScan `status` | label | Congress equivalent |
|---|---|---|
| 1 Introduced | `INTRODUCED` | INTRODUCED |
| 2 Engrossed | `PASSED_CHAMBER` | PASSED_CHAMBER |
| 3 Enrolled | `PASSED` | PASSED (awaiting executive) |
| 4 Passed | `ENACTED` | ENACTED |
| 5 Vetoed | `VETOED` | VETOED |
| 6 Failed/Dead | `FAILED` | FAILED |

> Clean 1:1 map — LegiScan's numeric status is the **least ambiguous** of the four
> sources (this is why it's the recommended state provider). Note one nuance:
> LegiScan code 4 "Passed" means fully enacted/chaptered, so it maps to `ENACTED`,
> while code 3 "Enrolled" is the "passed both chambers, awaiting signature" stage →
> `PASSED`. Confirm this reading suits the UI copy.

---

## 3. Pagination & freshness strategy

- **No offset paging needed:** `getMasterListRaw` returns the **entire** session's
  bill list in one call per state. There is no page cursor.
- **Bound to changed items via `change_hash`:** for each `bill_id` in the
  masterlist, compare its `change_hash` to the stored `cards.raw->>'change_hash'`
  for `(source='legiscan', external_id=bill_id)`. Call `getBill` **only** when the
  hash is new or differs. This is the watermark mechanism — per-bill, not time-based
  — and needs no separate state store.
- **Active-session bound:** ingest only the current regular (and active special)
  session per state; ignore archived sessions.
- **Cadence:** **every 6 hours** (`0 */6 * * *`), not hourly — see §5 budget. Run
  all 50 states each pass (optionally stagger states across the window to smooth
  load).

---

## 4. Dedup & idempotency

- **Upsert key:** `(source, external_id)` with `source='legiscan'`,
  `external_id = bill_id`.
- **`job_log` key:** `ingest:legiscan:<ISO-hour>` for the overall run, e.g.
  `ingest:legiscan:2026-06-15T18`. (Optional per-state sub-keys
  `ingest:legiscan:CA:<ISO-date>` if states are staggered.)
- **Re-run on a stored bill:** the `change_hash` diff makes most re-runs **skip**
  (no `getBill`, no write) — that's the cost-saver. When a hash *did* change → UPDATE
  refreshing `status`, `last_action_at`, `summary`, `title`, `source_url`, `raw`
  (incl. new `change_hash`), `updated_at`. Preserve `id`, `created_at`,
  `occurred_at`, `topics`.

---

## 5. Rate-limit & failure notes

- **Limit:** 30,000 queries/month on the free public key. Budget math:
  - `getMasterListRaw`: 50 states × 4 runs/day × 30 days = **6,000/mo**.
  - `getSessionList`: cache daily → 50 × 30 = **1,500/mo** (or fewer).
  - `getBill`: only changed bills — during active sessions a few hundred/day across
    all states; even 600/day = ~18,000/mo. **Total ≈ 25k/mo → under 30k.**
  - ⚠️ **Hourly would break the budget:** 50 × 24 × 30 = 36,000 masterlist calls
    alone, before any `getBill`. Hence the 6-hour cadence. If volume grows, drop to
    daily or request a higher LegiScan tier.
- **Partial failure = log + continue.** States and bills are independent; a failed
  `getBill` logs and skips, and because its `change_hash` was **not** persisted, the
  bill is retried next run. Only write `change_hash` to `raw` on a successful
  upsert. Safe to re-run.

---

## 6. Worked example (acceptance test)

Upstream (trimmed `op=getBill&id=1764530`):

```json
{ "bill": {
  "bill_id": 1764530,
  "change_hash": "a1b2c3d4e5f60718293a4b5c6d7e8f90",
  "state": "CA",
  "bill_number": "AB 1234",
  "title": "Public records: state agencies.",
  "description": "An act to amend Section 7920 of the Government Code, relating to public records.",
  "status": 2,
  "status_date": "2026-05-28",
  "url": "https://legiscan.com/CA/bill/AB1234/2025",
  "state_link": "https://leginfo.legislature.ca.gov/faces/billNavClient.xhtml?bill_id=202520260AB1234",
  "session": { "session_id": 2172, "year_start": 2025, "year_end": 2026 },
  "history": [ { "date": "2026-02-14", "action": "Introduced", "chamber": "A" },
               { "date": "2026-05-28", "action": "Engrossed and ordered to the Senate", "chamber": "A" } ],
  "sponsors": [ { "name": "Asm. Jane Doe", "party": "D", "role": "Rep" } ]
} }
```

Becomes the `cards` row:

| column | value |
|---|---|
| `card_type` | `legislative` |
| `sphere` | `state` |
| `source` | `legiscan` |
| `external_id` | `1764530` |
| `title` | `Public records: state agencies.` |
| `summary` | `An act to amend Section 7920 of the Government Code, relating to public records.` |
| `status` | `PASSED_CHAMBER` *(LegiScan status 2 = Engrossed)* |
| `region` | `CA` |
| `occurred_at` | `2026-02-14T00:00:00Z` *(earliest history date = introduced)* |
| `last_action_at` | `2026-05-28T00:00:00Z` *(status_date)* |
| `source_url` | `https://leginfo.legislature.ca.gov/faces/billNavClient.xhtml?bill_id=202520260AB1234` *(state_link)* |
| `raw` | *(full getBill JSON, incl. `change_hash`)* |
| `topics` | `{}` |
| `news_audit` | `null` |
