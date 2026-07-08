# SPEC — Federal Register ingestion (`source='fedreg'`)

Federal executive cards (executive orders, proclamations, presidential
determinations). Cron route: `/api/ingest/fedreg`.
Target table: `cards`. Verified 2026-06-15 against
<https://www.federalregister.gov/developers/documentation/api/v1>.

Constants for every row:
`card_type='executive'`, `sphere='federal'`, `source='fedreg'`.

> **Reconciled 2026-06-16 against a real ingested row** (`2026-11741`). Corrections
> from the first draft: the response subtype field is **`subtype`** (not
> `presidential_document_type`, which is only a query filter); `president` is an
> **object** `{name, identifier}`; status keys off `subtype` (real value
> `PROCLAMATION` confirmed); `executive_order_number` is `null` for non-EOs; the
> worked example is now the real row. Everything else in the mapping
> (`external_id`=`document_number`, `summary`=`abstract`, `occurred_at`=`signing_date`,
> `last_action_at`=`publication_date`, `source_url`=`html_url`) matched the real
> data and is unchanged.

---

## 1. Endpoints used

Base: `https://www.federalregister.gov/api/v1`  ·  Auth: **none** (no key).

| Purpose | Endpoint | Required params |
|---|---|---|
| List recent presidential docs | `GET /documents.json` | `conditions[type][]=PRESDOCU`, `order=newest`, `per_page` (≤1000), `page`, and `fields[]=...` (see below); narrow by `conditions[presidential_document_type][]=executive_order` (or `proclamation`, `presidential_determination`) |
| Single document detail | `GET /documents/{document_number}.json` | `fields[]=...` |
| Freshness window | add `conditions[publication_date][gte]=YYYY-MM-DD` | bounds the list to recent docs |

Request these fields explicitly (they are omitted from the default payload):
`fields[]=document_number&fields[]=type&fields[]=subtype&fields[]=title&fields[]=abstract&fields[]=publication_date&fields[]=signing_date&fields[]=executive_order_number&fields[]=president&fields[]=agencies&fields[]=html_url&fields[]=pdf_url&fields[]=body_html_url&fields[]=raw_text_url`

Use `conditions[type][]=PRESDOCU` to capture all presidential document subtypes in
one job (EO + proclamation + determination), then branch on the **`subtype`**
field of each returned document.

> ⚠️ **API field-name quirk (confirmed against real ingested rows, 2026-06-16):**
> the request **filter** parameter is `conditions[presidential_document_type][]`
> (e.g. `=executive_order`), but the returned/stored document object does **not**
> contain a `presidential_document_type` field. The document subtype comes back in
> **`subtype`** (title-case string, e.g. `"Proclamation"`, `"Executive Order"`),
> and `type` is the broad class (`"Presidential Document"`). Request `fields[]=subtype`
> to receive it. Earlier drafts of this spec used `presidential_document_type` for
> the response field — that was wrong; it's only a filter param.
>
> Verified: **no key required**; `abstract` is frequently `null` for presidential
> documents; `signing_date`, `subtype`, `president`, and `raw_text_url` are only
> returned when explicitly requested via `fields[]`. `executive_order_number` is
> `null` for non-EO subtypes (e.g. proclamations).

---

## 2. Field mapping table

| `cards` column | source field (JSON path) | transform | notes |
|---|---|---|---|
| `card_type` | — | constant `'executive'` | |
| `sphere` | — | constant `'federal'` | |
| `source` | — | constant `'fedreg'` | |
| `external_id` | `document_number` | use as-is, e.g. `"2026-11595"` | **stable unique id**, FR's own document number. |
| `title` | `title` | trim | |
| `summary` | `abstract` | use as-is; if `null`, leave `null` (do **not** fabricate) | source-provided, not AI. Presidential docs usually have no abstract → AI Insight fills the gap downstream. |
| `status` | `subtype` | map → label | see status map. (Response field is `subtype`, **not** `presidential_document_type`.) |
| `region` | — | `null` | federal. |
| `occurred_at` | `signing_date` ?? `publication_date` | date → timestamptz | prefer signing date; fall back to publication date when signing date absent. |
| `last_action_at` | `publication_date` | date → timestamptz | FR docs are published once and rarely revised → usually equals `occurred_at`. |
| `source_url` | `html_url` | use as-is | canonical FR page. |
| `raw` | entire document object | store as-is jsonb | observed keys in real rows: `type`, `subtype`, `title`, `abstract`, `document_number`, `publication_date`, `signing_date`, `executive_order_number` (null for non-EOs), `html_url`, `pdf_url`, `body_html_url`, `raw_text_url`, `agencies[]`, and `president` (an **object** `{name, identifier}`, e.g. `{"name":"Donald Trump","identifier":"donald-trump"}`). |
| `topics` | — | `'{}'` | tagged later; empty at ingestion. |
| `news_audit` | — | `null` | news source only. |

### Status derivation → short labels

Key off the **`subtype`** string (title-case as returned by FR), case-insensitively:

| `subtype` value | `status` |
|---|---|
| `Executive Order` | `EO_ISSUED` |
| `Proclamation` | `PROCLAMATION` ✓ confirmed from real row `2026-11741` |
| `Presidential Determination` / `Memorandum` / `Notice` / other | `PRES_ACTION` |

> Only `PROCLAMATION` is confirmed against a real ingested row so far. `EO_ISSUED`
> and `PRES_ACTION` are the spec's intended labels — verify them against a real
> executive-order / memorandum row when one is ingested. Do not change ingestion
> behavior to match this table; this table documents what the ingester is expected
> to produce.
>
> Note: executive actions don't have a lifecycle the way bills/cases do — a
> published EO is simply in effect. The `status` here encodes **document subtype**,
> the most useful single label for the card; the source has no real status
> vocabulary.

---

## 3. Pagination & freshness strategy

- **Page:** `order=newest`, `per_page=100`, increment `page=1,2,…` until items fall
  before the watermark or results exhaust. (For presidential docs the daily volume
  is tiny; one page almost always suffices.)
- **Bound to recent:** `conditions[publication_date][gte] = <watermark date − 1
  day overlap>`. **Watermark** = max `publication_date` from the last successful
  `ingest:fedreg:*` run, stored in `job_log.detail->>'watermark'`. First run:
  default `now − 30d`.
- **Cadence:** hourly is fine and cheap (no key, unmetered), though the FR only
  publishes on business mornings — most hourly runs will be no-ops. Hourly keeps
  latency low when documents do post.

---

## 4. Dedup & idempotency

- **Upsert key:** `(source, external_id)` where `external_id = document_number`.
- **`job_log` key:** `ingest:fedreg:<ISO-hour>`, e.g. `ingest:fedreg:2026-06-15T13`.
- **Re-run on a stored document → UPDATE**, refreshing `status`, `last_action_at`,
  `summary`, `source_url`, `raw`, `updated_at`. Preserve `id`, `created_at`,
  `occurred_at`, `topics`. In practice FR documents are immutable, so re-runs are
  usually true no-ops — the upsert just confirms unchanged data.

---

## 5. Rate-limit & failure notes

- **Limit:** none documented / unmetered. The only practical limit is courtesy;
  hourly polling with `per_page≤100` is trivial load. No key to exhaust.
- **Partial failure = log + continue.** Each document is independent; a failed
  detail fetch logs and skips, and the item reappears next run because its
  `publication_date` is still ≥ watermark. Advance the watermark only to the max
  `publication_date` successfully written. Safe to re-run.

---

## 6. Worked example (acceptance test)

Real ingested `raw` (proclamation `2026-11741`, pasted from the live `cards` table
2026-06-16 — trimmed):

```json
{
  "type": "Presidential Document",
  "subtype": "Proclamation",
  "title": "Granting Pardon to Stephen E. Buyer",
  "abstract": null,
  "document_number": "2026-11741",
  "publication_date": "2026-06-10",
  "signing_date": "2026-06-04",
  "executive_order_number": null,
  "html_url": "https://www.federalregister.gov/documents/2026/06/10/2026-11741/granting-pardon-to-stephen-e-buyer",
  "pdf_url": "https://www.govinfo.gov/content/pkg/FR-2026-06-10/pdf/2026-11741.pdf",
  "body_html_url": "https://www.federalregister.gov/documents/full_text/html/2026/06/10/2026-11741.html",
  "raw_text_url": "https://www.federalregister.gov/documents/full_text/text/2026/06/10/2026-11741.txt",
  "president": { "name": "Donald Trump", "identifier": "donald-trump" },
  "agencies": [ { "id": 538, "name": "Executive Office of the President" } ]
}
```

Becomes the `cards` row (matches the real stored row exactly):

| column | value |
|---|---|
| `card_type` | `executive` |
| `sphere` | `federal` |
| `source` | `fedreg` |
| `external_id` | `2026-11741` |
| `title` | `Granting Pardon to Stephen E. Buyer` |
| `summary` | `null` *(abstract was null)* |
| `status` | `PROCLAMATION` *(from `subtype = "Proclamation"`)* |
| `region` | `null` |
| `occurred_at` | `2026-06-04T00:00:00Z` *(signing_date)* |
| `last_action_at` | `2026-06-10T00:00:00Z` *(publication_date)* |
| `source_url` | `https://www.federalregister.gov/documents/2026/06/10/2026-11741/granting-pardon-to-stephen-e-buyer` |
| `raw` | *(full FR document JSON above)* |
| `topics` | `[]` *(empty `text[]`)* |
| `news_audit` | `null` |

> `subtype`, `signing_date`, `president`, and `raw_text_url` appear only because the
> request asked for them via `fields[]`; omit those fields and they vanish. Note
> `executive_order_number` is `null` for proclamations (only populated for EOs).
