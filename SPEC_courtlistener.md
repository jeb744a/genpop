# SPEC — CourtListener ingestion (`source='courtlistener'`)

Federal judicial cards. Cron route: `/api/ingest/courts`.
Target table: `cards`. Verified 2026-06-15 against
<https://www.courtlistener.com/help/api/rest/v4/> and the jurisdictions list.

Constants for every row:
`card_type='judicial'`, `sphere='federal'`, `source='courtlistener'`.

---

## 1. Endpoints used

Base: `https://www.courtlistener.com/api/rest/v4/`  ·  Auth: header
`Authorization: Token ${COURTLISTENER_API_TOKEN}`.

| Purpose | Endpoint | Required params |
|---|---|---|
| List recent high-signal dockets | `GET /dockets/` | `court__jurisdiction=F`, `order_by=-date_modified`, `date_modified__gte=<watermark>`, `fields=...` |
| Docket detail | `GET /dockets/{id}/` | token only |
| Cluster (case + citations) | `GET /clusters/{id}/` | token only — `clusters[]` URLs come from the docket |
| Opinion text (for AI Insight later) | `GET /opinions/{id}/` | token; prefer `html_with_citations`; not needed at card-ingest time |

### Higher-signal court filter (SCOTUS + circuit only) — required at launch

Filter on **`court__jurisdiction=F`** (jurisdiction code **`F` = "Federal
Appellate"**). Verified: SCOTUS (`court_id='scotus'`) and all 13 courts of appeals
(`ca1`…`ca11`, `cadc`, `cafc`) carry jurisdiction `F`. District courts are **`FD`**
and are **excluded** by this filter — so we do **not** ingest every minor district
entry at launch.

```
GET /dockets/?court__jurisdiction=F&order_by=-date_modified
    Header: Authorization: Token ${COURTLISTENER_API_TOKEN}
```

(Alternative if `F` proves too broad — it also includes a few federal appellate
special bodies: enumerate `court__in=scotus,ca1,ca2,ca3,ca4,ca5,ca6,ca7,ca8,ca9,ca10,ca11,cadc,cafc`.
Prefer `court__jurisdiction=F` for simplicity; switch only if noise appears.)

> Verified now (was "confirm in code"): jurisdiction codes `F`=Federal Appellate,
> `FD`=Federal District; SCOTUS jurisdiction is `F`. **Rate limit:** docs say
> 5,000/hr but the post-2026-05-07 default for new accounts is unpublished — treat
> as low and measure from the profile (see §5).

---

## 2. Field mapping table

The **docket** is the card's anchor object. (Cluster/opinion are fetched for
citations + text but the card keys off the docket.)

| `cards` column | source field (JSON path) | transform | notes |
|---|---|---|---|
| `card_type` | — | constant `'judicial'` | |
| `sphere` | — | constant `'federal'` | |
| `source` | — | constant `'courtlistener'` | |
| `external_id` | docket `id` | stringify, prefix for clarity → `"docket-{id}"` | **stable unique id.** Pick docket-id and keep it consistent (don't mix docket and cluster ids in the same source). |
| `title` | `case_name` (docket) | trim; fall back to cluster `case_name` if blank | |
| `summary` | — | `null` at ingestion | CourtListener provides no short summary; AI Insight summarizes `opinion.html_with_citations` later into `card_ai`. |
| `status` | derived from docket dates | see status map | |
| `region` | — | `null` | federal. |
| `occurred_at` | `date_argued` ?? `date_filed` (docket) | date → timestamptz | when the case event happened. |
| `last_action_at` | `date_modified` (docket) | timestamptz | drives feed sort; refreshed each run. |
| `source_url` | `absolute_url` (docket) | prefix `https://www.courtlistener.com` | |
| `raw` | merged docket (+ cluster citations) object | jsonb as-is | incl. `court_id`, `docket_number`, `clusters[]`, `sub_opinions[]`. |
| `topics` | — | `'{}'` | tagged later; empty at ingestion. |
| `news_audit` | — | `null` | news source only. |

### Status derivation → short labels

| Condition (first match wins) | `status` |
|---|---|
| `date_terminated` is set | `DECIDED` |
| `date_argued` is set, not terminated | `ARGUED` |
| `date_filed` set, no argument/termination | `PENDING` |

> Note: dockets have no explicit status field; these three labels are derived from
> the date fields and cover the SCOTUS/circuit lifecycle adequately. A cluster with
> a published opinion is effectively `DECIDED` even if `date_terminated` is null —
> if precision matters, also treat "has a cluster with `date_filed`" as `DECIDED`.
> Flagged in chat.

---

## 3. Pagination & freshness strategy

- **Page:** cursor pagination. With `order_by=-date_modified` the response `next`
  URL carries the cursor; follow `next` until items predate the watermark or `next`
  is null. (The `page` param caps at 100 pages and is disabled for deep cursor
  ordering — use `next`.)
- **Bound to recent:** `date_modified__gte = <watermark − 1h overlap>`.
  **Watermark** = max `date_modified` from the last successful `ingest:courts:*`
  run, in `job_log.detail->>'watermark'`. First run: `now − 30d`.
- **Field selection:** always pass `fields=id,case_name,court_id,docket_number,date_filed,date_argued,date_terminated,date_modified,absolute_url,clusters`
  to keep payloads small (opinion text fields are huge).
- **Cadence:** hourly (`0 * * * *`). Federal-appellate docket churn is modest, so
  each run handles a small set.

---

## 4. Dedup & idempotency

- **Upsert key:** `(source, external_id)`, `external_id = "docket-{id}"`.
- **`job_log` key:** `ingest:courts:<ISO-hour>`, e.g. `ingest:courts:2026-06-15T18`.
- **Re-run on a stored docket → UPDATE**, refreshing `status`, `last_action_at`
  (`date_modified` moves often), `title`, `source_url`, `raw`, `updated_at`.
  Preserve `id`, `created_at`, `occurred_at`, `topics`. Because `date_modified`
  changes on any docket update, the same docket legitimately re-updates over its
  life — that's expected, not a duplicate.

---

## 5. Rate-limit & failure notes

- **Limit:** historically 5,000/hr; **new default unknown post-2026-05-07.** Keep
  usage tiny: one list call + at most a few cluster fetches per changed docket. With
  field selection and the `F`-jurisdiction filter, an hourly run is a handful of
  requests. Check the real ceiling at
  <https://www.courtlistener.com/profile/api/#usage>; if hit, a **free EDU
  membership** raises it.
- **Partial failure = log + continue.** Each docket independent; failed
  cluster/detail fetch logs and skips, reappears next run (its `date_modified` ≥
  watermark). Advance watermark only to the max `date_modified` successfully
  written. On HTTP 429, back off and abort the run **without** advancing the
  watermark. Safe to re-run.

---

## 6. Worked example (acceptance test)

Upstream (trimmed `GET /dockets/?court__jurisdiction=F&order_by=-date_modified`,
representative SCOTUS docket — field names verified against the real docket payload):

```json
{
  "id": 69887412,
  "court_id": "scotus",
  "case_name": "Loper Bright Enterprises v. Raimondo",
  "docket_number": "22-451",
  "date_filed": "2023-11-10",
  "date_argued": "2024-01-17",
  "date_terminated": "2024-06-28",
  "date_modified": "2026-06-14T03:59:23.387426-07:00",
  "absolute_url": "/docket/69887412/loper-bright-enterprises-v-raimondo/",
  "clusters": ["https://www.courtlistener.com/api/rest/v4/clusters/9502621/"]
}
```

Becomes the `cards` row:

| column | value |
|---|---|
| `card_type` | `judicial` |
| `sphere` | `federal` |
| `source` | `courtlistener` |
| `external_id` | `docket-69887412` |
| `title` | `Loper Bright Enterprises v. Raimondo` |
| `summary` | `null` |
| `status` | `DECIDED` *(date_terminated set)* |
| `region` | `null` |
| `occurred_at` | `2024-01-17T00:00:00Z` *(date_argued)* |
| `last_action_at` | `2026-06-14T10:59:23Z` *(date_modified, normalized to UTC)* |
| `source_url` | `https://www.courtlistener.com/docket/69887412/loper-bright-enterprises-v-raimondo/` |
| `raw` | *(full docket + cluster citations JSON)* |
| `topics` | `{}` |
| `news_audit` | `null` |
