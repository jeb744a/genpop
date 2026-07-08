# SPEC — LegiScan bill-text PDF acquisition (Phase 2)

Acquires the actual **bill text** for state legislative cards (`source='legiscan'`)
so AI Insight has real substance. Per `SPEC_ai_insight.md` §0, `cards.raw` stores
only *links* to the text — the text itself lives in `raw.texts[].state_link` PDFs.
This step fetches, parses, caches, and hands plain text to the Insight generator.
If it can't get text, Insight degrades to metadata-only (§0).

Grounded in the real `cards` row `2101665` (Alabama `HB363`), whose
`raw.texts[]` held two versions:

```json
[
  { "doc_id": 3340944, "type": "Introduced", "type_id": 1, "date": "2026-01-29",
    "mime": "application/pdf", "text_size": 496314,
    "text_hash": "7a1828aeacf36631e765e33cce2d2418",
    "state_link": "https://alison.legislature.state.al.us/files/pdf/SearchableInstruments/2026RS/HB363-int.pdf" },
  { "doc_id": 3374103, "type": "Engrossed", "type_id": 4, "date": "2026-02-24",
    "mime": "application/pdf", "text_size": 80002,
    "text_hash": "4cfc75eff3cd59425b55ae8ef2c36eed",
    "state_link": "https://alison.legislature.state.al.us/files/pdf/SearchableInstruments/2026RS/HB363-eng.pdf" }
]
```

Scope: text-based PDFs only. OCR of scanned PDFs is **out of scope for launch**
(documented limitation, §2).

---

## 1. Which `raw.texts[]` version to fetch

A bill has 0…N text versions across its life (Introduced → Committee Substitute →
Amended → Engrossed → Enrolled → Chaptered). We want **the version that represents
the bill's current operative text** — the most advanced stage reached so far.

### LegiScan text `type_id` reference (bill-text types vs. attachments)

| `type_id` | `type` | bill text? |
|---|---|---|
| 1 | Introduced | ✅ |
| 2 | Committee Substitute | ✅ |
| 3 | Amended | ✅ |
| 4 | Engrossed | ✅ |
| 5 | Enrolled | ✅ |
| 6 | Chaptered | ✅ |
| 10 | Conference Substitute | ✅ |
| 11 | Prefiled | ✅ |
| 7 Fiscal Note · 8 Analysis · 9 Draft · 12 Veto Message | — | ❌ exclude (not bill text) |

(Fiscal notes etc. also arrive via `raw.supplements[]`, not `texts[]`, but guard
anyway by `type_id`.)

### Selection rule

1. **Filter** `raw.texts[]` to bill-text types (`type_id ∈ {1,2,3,4,5,6,10,11}`)
   with `mime = "application/pdf"`.
2. **Pick the most advanced current version:** sort by `date` descending, then by
   `type_id` descending as the tie-breaker; take the first. This yields the latest
   substantive text and naturally tracks `cards.status`.
   - For real `HB363`: latest `date` is `2026-02-24` (Engrossed, `type_id 4`) →
     **chosen `doc_id = 3374103`**, which matches `cards.status = PASSED_CHAMBER`
     (Engrossed). Correct.
3. **Edge cases:**
   - **Zero bill-text versions:** no fetch. Insight degrades to metadata-only;
     record `extraction_status='no_text_version'`.
   - **Only Introduced exists:** use it (early-stage bills are expected).
   - **Multiple same-date versions:** highest `type_id` wins (most advanced);
     if still tied, highest `doc_id` (latest published).
   - We acquire **one** version per card (the current one) — not all versions.
     When the bill advances and a newer text appears, the selection re-resolves and
     a new version is fetched (see §3 caching).

> Don't trust `type` strings for logic (states vary in casing/wording); key on
> `type_id`. Keep `type` only for display.

---

## 2. Fetch + parse approach (Next.js / Node on Vercel)

### Fetch
- `GET` the chosen version's `state_link` (the official state-legislature PDF).
- Stream with a hard **size cap** (§4) and **timeout** (§4); set a descriptive
  `User-Agent` (§5).
- Verify `Content-Type` is a PDF (`application/pdf` or `application/octet-stream`
  with `%PDF` magic bytes); reject HTML error pages that return 200.

### Parse — library choice
- **Use `unpdf`** (pure-JS/WASM wrapper around a serverless build of pdf.js,
  maintained by the Nuxt team). It runs in Vercel Node serverless functions with
  **no native binaries** and exposes `extractText(pdf, { mergePages: true })`.
- **Do NOT use** poppler / `pdftotext` / `pdfimages` — those are system binaries
  not available on Vercel serverless.
- Acceptable fallback: `pdfjs-dist` directly (`getDocument` → per-page
  `getTextContent()` → join `items[].str`). `pdf-parse` is **not** recommended
  (bundles an old pdf.js, flaky on Vercel, opens test files on import).

### Where it runs
- Run acquisition **server-side as a step that feeds Insight generation**, not in
  the user's first-view request path (PDF parse can take seconds). Two acceptable
  triggers:
  - **Preferred:** during state ingestion, when a card's chosen text version is
    new/changed, enqueue acquisition so text is ready before first view.
  - **Or:** lazily inside the Insight service on cache miss, but behind the
    Insight daily cap and with the result cached (§3) so it happens at most once
    per version.
- Set the route/function `maxDuration` to cover fetch + parse (≈45–60s headroom;
  Vercel Hobby allows up to 60s).

### Scanned / image-only PDFs
- After extraction, compute `char_count`. If it's implausibly low for the page
  count (heuristic: `< 200` chars total, or `< 100` chars/page), classify as
  **image-only**.
- **OCR is out of scope for launch.** Do not ship `tesseract.js` in the serverless
  path (heavy WASM, slow, memory-hungry — unreliable inside function limits).
  On image-only: record `extraction_status='image_only'`, store no text → Insight
  degrades to metadata-only (§0). Capture these in a report so an offline OCR
  pipeline can be added later as a known follow-up.

---

## 3. Storage & caching (avoid re-fetching)

New table (later Supabase migration — **not** in the current `schema.sql`):

```sql
create type bill_text_status as enum
  ('ok','image_only','no_text_version','too_large','fetch_failed','parse_failed');

create table bill_texts (
  doc_id        bigint primary key,          -- LegiScan text doc_id (globally unique per version)
  card_id       uuid not null references cards(id) on delete cascade,
  text_hash     text not null,               -- LegiScan raw.texts[].text_hash for this version
  type_id       int  not null,
  type          text,
  version_date  date,
  state_link    text,
  extracted_text text,                        -- null unless status='ok'
  char_count    int,
  page_count    int,
  status        bill_text_status not null,
  fetched_at    timestamptz not null default now()
);
create index bill_texts_card_idx on bill_texts (card_id);

alter table bill_texts enable row level security;
-- service role only (acquisition job + Insight generator read/write). No public read.
```

- **Key to the card:** `card_id` (FK) plus `doc_id` (PK). The Insight generator
  resolves the chosen `doc_id` from `cards.raw.texts[]` (per §1) and looks up
  `bill_texts` by `doc_id`.
- **Re-fetch tied to `text_hash`:** before fetching, compare the chosen version's
  `raw.texts[].text_hash` to the stored `bill_texts.text_hash` for that `doc_id`.
  - Same hash + `status='ok'` → **reuse cached text, no fetch, no parse.**
  - Missing row, or `text_hash` differs (LegiScan re-published the document) →
    fetch + parse + upsert.
- Because a bill advancing produces a **new `doc_id`** (new version), advancement
  naturally creates a new `bill_texts` row; the old version's text stays cached but
  is simply no longer the "chosen" one.
- Feed into Insight's `input_hash` (`SPEC_ai_insight.md` §5): for `legiscan`,
  include the chosen version's `text_hash` so Insight regenerates when the operative
  text changes — already aligned with using `raw.change_hash`.

---

## 4. Failure & cost handling (PDFs can be large)

Real `HB363` Introduced version was **496,314 bytes (~485 KB)** — modest, but bill
texts can run to many MB. Bound everything:

| Guard | Value | Behavior on breach |
|---|---|---|
| Pre-screen size | skip if `raw.texts[].text_size` > **8 MB** | `status='too_large'`, no fetch |
| Download cap | abort stream at **8 MB** actual bytes | `status='too_large'` |
| Fetch timeout | **15 s** | `status='fetch_failed'` |
| Parse timeout | **20 s** | `status='parse_failed'` |
| HTTP ≥ 400 / non-PDF body | — | `status='fetch_failed'` |
| Extracted text below threshold | `< 200` chars | `status='image_only'` |

- **Every non-`ok` status → Insight degrades to metadata-only** (`SPEC_ai_insight.md`
  §0: substance slots become `"Not specified in the source"`,
  `meta.source_text="unavailable"`). Never block or fail the card.
- **Safe to retry:** a failed acquisition stores the failure status but **no text**;
  the next ingestion/Insight pass may retry. Use a small retry budget (e.g. don't
  retry `too_large` or `image_only`; do retry `fetch_failed`/`parse_failed` up to 2×
  with backoff). A transient state-server outage thus self-heals.
- Token bound for Insight: very long texts (e.g. omnibus bills) should be trimmed
  before sending to Gemini (Insight cares about the operative sections); store the
  full extracted text but pass a bounded slice.

---

## 5. Rate-limiting & politeness (fetching state servers, not LegiScan)

These PDFs come from **50 different state-legislature web servers**
(`alison.legislature.state.al.us`, `leginfo.legislature.ca.gov`, …), not the
LegiScan API — so normal API budgets don't apply, but web-crawl courtesy does:

- **Descriptive `User-Agent`** with contact + purpose, e.g.
  `GenPopBot/1.0 (+https://genpop.example/about; civic data; contact@genpop.example)`.
- **Per-host throttle:** at most 1 concurrent request per host and a short delay
  (≈1–2 s) between requests to the same host. Acquisition is **change-driven, not
  bulk** (only when a card's chosen version is new), so steady-state volume is low.
- **Cache is the politeness mechanism:** `bill_texts` + `text_hash` guarantees each
  version is fetched **once**. Honor `ETag`/`Last-Modified` if a host sends them.
- Respect `robots.txt` for the host where feasible; back off on `429`/`503`.
- **Fallback that avoids state servers:** if `state_link` fails (dead link, blocked
  UA, oversize HTML), fall back to LegiScan's `op=getBillText&id={doc_id}`, which
  returns the document base64-encoded from LegiScan's own infrastructure. This is
  more uniform and avoids hammering state sites, but **costs one call against the
  30,000/month LegiScan budget** (`SPEC_state.md` §5) — so use it as a fallback,
  not the primary path. Decode base64 → same parse pipeline.

---

## 6. End-to-end (worked, real `HB363`)

1. Card `2101665`, `status=PASSED_CHAMBER`. Filter `raw.texts[]` → 2 PDF bill-text
   versions.
2. Select: latest date `2026-02-24`, `type_id 4` (Engrossed) → `doc_id 3374103`,
   `text_hash 4cfc75…`, `text_size 80002` (~78 KB, under 8 MB).
3. Check `bill_texts` for `doc_id 3374103`: absent → fetch
   `…/HB363-eng.pdf`, parse with `unpdf`.
4. Extract text, `char_count` well above 200 → `status='ok'`; upsert `bill_texts`
   row (text_hash `4cfc75…`, type "Engrossed", version_date 2026-02-24).
5. Insight generator reads `bill_texts.extracted_text` for `doc_id 3374103`, fills
   substance slots with provenance/snippets; Insight `input_hash` folds in
   `text_hash 4cfc75…`.
6. Bill later Enrolled → new `doc_id`/`text_hash` in `raw.texts[]` → selection picks
   the Enrolled version → new fetch → Insight regenerates. The Engrossed row stays
   cached, unused.

---

## Acceptance checks
1. Given `HB363`'s two versions, the selector returns `doc_id 3374103` (Engrossed),
   not the Introduced one.
2. A second run with unchanged `text_hash` performs **zero** network fetches.
3. An image-only PDF yields `status='image_only'`, no text, and a metadata-only
   Insight — not a crash and not a hallucinated summary.
4. A 20 MB bill is skipped via `text_size` pre-screen (`status='too_large'`) with no
   download.
5. Every fetch carries the GenPop `User-Agent`; repeat versions are served from
   `bill_texts`, not re-downloaded.
