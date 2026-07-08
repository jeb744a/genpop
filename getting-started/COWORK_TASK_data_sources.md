# Cowork task brief — GenPop data-source reference

Paste this into Claude Cowork (desktop app, with a folder you've created for
GenPop docs given as the working folder). This produces a reference doc your
Cursor build will consume — it does NOT write app code.

> Safety note: this task only READS public API docs and WRITES one markdown
> file into the folder. Don't grant broader access than the docs folder.

---

## Task

Produce a single file `DATA_SOURCES.md` in this folder that documents exactly
how GenPop will ingest from four free government/news data sources. For each
source, find and record the real, current details — do not guess; verify
against the official docs and note the date you checked. Where a value isn't
documented, say "unverified — confirm in code."

Build a section for each of these, in this order:

### 1. Congress.gov API (federal legislation)
- Base URL and current API version.
- How to get a free key (the api.data.gov signup), and the current rate limit.
- The endpoints needed to: list recent bills, get a single bill's detail,
  get a bill's actions, get a bill's sponsors, get the official CRS summary,
  and get the link to full bill text.
- For each endpoint: the URL pattern, required params, and the JSON fields
  GenPop needs (bill id/number, title, latest action + date, sponsor, status,
  congress number, summary text, full-text URL).
- A real example request URL (with `[KEY]` as a placeholder) and a trimmed
  sample of the response shape.

### 2. Federal Register API (executive actions)
- Base URL, version, and confirm no key is required.
- Endpoints to list recent presidential documents / executive orders and to
  get a single document's detail.
- Fields GenPop needs: document number, type (EO / proclamation / rule),
  title, abstract, publication date, signing date if present, agency,
  PDF/full-text URL.
- Example request URL + trimmed sample response.

### 3. CourtListener API v4 (judicial)
- Base URL, how to get a free API token, current rate limits.
- Endpoints to list recent opinions/dockets and to get a single one.
- How to filter to higher-signal courts (SCOTUS, circuit) so we don't ingest
  every minor district entry at launch.
- Fields GenPop needs: docket id/number, case name, court, date filed/argued,
  status, opinion/source URL.
- Example request URL (with `[TOKEN]`) + trimmed sample response.

### 4. State legislation — LegiScan AND OpenStates (compare)
- For each: base URL, how to get a free key, current free-tier query limits.
- Which one gives cleaner "all 50 states' recent bills" coverage with less
  effort. Give a recommendation with a one-paragraph rationale.
- The endpoints + fields needed to list recent bills per state and get bill
  detail. Same field set as Congress.gov where possible (so they map to the
  same `cards` shape).

### 5. Cross-spectrum news outlet list (for the threshold feed)
- Propose a balanced starting list of 8–12 well-known national news outlets
  spanning left / center / right, each with its working RSS feed URL (or a
  Google News RSS query URL per outlet if no native feed).
- For each outlet, note a rough, sourced left/center/right lean label (cite
  where the lean assessment comes from, e.g. AllSides/Ad Fontes — note these
  are third-party assessments, not GenPop's judgment).
- This list must be defensible and published; flag any outlet whose lean is
  contested.

---

## Output format
One markdown file, `DATA_SOURCES.md`, with a section per source, a
"last verified: YYYY-MM-DD" line per source, and a short "open questions /
confirm in code" list at the bottom. Keep sample responses trimmed to the
fields GenPop uses — not full dumps.

When done, summarize in chat: which limits might bite at scale, and which
source had the least reliable documentation.
