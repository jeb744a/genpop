# GenPop — DATA_SOURCES.md

Reference for how GenPop ingests from the free government/news data sources behind
the four card types, plus the cross-spectrum news outlet list. Values were verified
against official docs on the dates noted. Where a value is not documented, it is
marked **"unverified — confirm in code."**

This doc is aligned to `schema.sql` (the `cards` table) and `REBUILD_PLAN.md`
§3 / §3a / §3.6. It documents ingestion only; it does not write app code.

## How sources map to `cards`

Every source upserts into the single `cards` table via a Vercel Cron route
(`/api/ingest/{congress,fedreg,courts,news}`, plus a state-legislation route),
keyed on `unique (source, external_id)`. The feed never calls these APIs at
request time. Idempotency via `job_log`.

Target columns (from `schema.sql`):

| `cards` column | Meaning at ingestion |
|---|---|
| `card_type` | enum `legislative` \| `executive` \| `judicial` \| `live` |
| `sphere` | enum `federal` \| `state` \| `city` |
| `source` | `'congress'` \| `'fedreg'` \| `'courtlistener'` \| `'news'` (+ `'legiscan'`/`'openstates'` for state — see note) |
| `external_id` | bill id / EO doc number / docket-or-cluster id / news-cluster id |
| `title` | source title |
| `summary` | **source-provided** short summary (CRS summary / FR abstract) — **never AI**; AI Insight lives in `card_ai` |
| `status` | normalized app vocab, e.g. `PENDING` \| `PASSED` \| `ARGUED` \| `DECIDED` |
| `region` | state code when `sphere='state'` |
| `occurred_at` | introduced / signed / argued / published |
| `last_action_at` | latest action timestamp (drives the feed sort) |
| `source_url` | canonical public link to the item |
| `raw` | full upstream JSON payload (sponsors, full-text URLs, etc. that have no dedicated column live here) |
| `topics` | shared `app/lib/topics.ts` taxonomy, Gemini-tagged at ingestion |
| `news_audit` | live cards only: `{outlets:[...], cleared_at}` |

Source → card mapping:

- **Congress.gov** → `card_type='legislative'`, `sphere='federal'`, `source='congress'`
- **Federal Register** → `card_type='executive'`, `sphere='federal'`, `source='fedreg'`
- **CourtListener** → `card_type='judicial'`, `sphere='federal'`, `source='courtlistener'`
- **LegiScan / OpenStates** → `card_type='legislative'`, `sphere='state'`, `region=<state>`, `source='legiscan'` (or `'openstates'`)
- **News threshold feed** → `card_type='live'`, `source='news'`

> Note: the `cards.source` comment in `schema.sql` lists only the four federal
> sources. State legislation needs a fifth source value (`'legiscan'`/`'openstates'`)
> and its own ingest route — **confirm the route name + source string in code.**

---

## 1. Congress.gov API (federal legislation) — `source='congress'`

**last verified: 2026-06-14**

- **Base URL:** `https://api.congress.gov/v3`
- **Version:** `v3`
- **Auth:** api.data.gov key, passed as `?api_key=[KEY]` (an `X-Api-Key` header also
  works since it runs behind api.data.gov).
- **Get a free key:** sign up at <https://api.congress.gov/sign-up/> (the GPO mirror
  <https://gpo.congress.gov/sign-up/> issues the same api.data.gov key).
  Stored as `CONGRESS_GOV_API_KEY` in `.env.local`. ✓ obtained.
- **Rate limit:** **5,000 requests/hour** per key (raised from the old 1,000/hr default).
- **Format:** default is XML; pass `?format=json`. Pagination via `limit`
  (max **250**) and `offset`. Recency via `sort=updateDate+desc`.
- **Current Congress:** 119th (2025–2026), used in examples.
- Per REBUILD_PLAN §3.1, Congress.gov **replaces LegiScan for the federal layer**
  (richer: CRS summaries, committee referrals, full-text links).

### Endpoints

| Need | Method + pattern | Key params |
|---|---|---|
| List recent bills | `GET /bill` | `format`, `limit`, `offset`, `sort=updateDate+desc`, `fromDateTime`, `toDateTime` (ISO 8601); narrow with `/bill/{congress}` or `/bill/{congress}/{billType}` |
| Single bill detail | `GET /bill/{congress}/{billType}/{billNumber}` | path only |
| Bill actions | `GET /bill/{congress}/{billType}/{billNumber}/actions` | `limit`, `offset` |
| Bill sponsors | in bill-detail payload (`bill.sponsors[]`); cosponsors at `.../cosponsors` | — |
| CRS summary | `GET /bill/{congress}/{billType}/{billNumber}/summaries` | `summaries[].text` (HTML/CDATA) + `actionDesc`, `actionDate` |
| Full bill text link | `GET /bill/{congress}/{billType}/{billNumber}/text` | `textVersions[].formats[].url` (Formatted Text / PDF / XML) |

`billType` ∈ `hr, s, hjres, sjres, hconres, sconres, hres, sres`.

### Field mapping → `cards`

| `cards` column | Congress.gov source |
|---|---|
| `external_id` | `{congress}-{type}-{number}` (e.g. `119-hr-1`) |
| `title` | `bill.title` |
| `summary` | latest CRS `summaries[].text` (by `actionDate`) — strip CDATA/HTML |
| `status` | derive → `PENDING`/`PASSED`/… from `latestAction.text`, action `type` (`IntroReferral`,`Floor`,`BecameLaw`,`Veto`), and `laws[]` (no native status enum) |
| `occurred_at` | `bill.introducedDate` |
| `last_action_at` | `bill.latestAction.actionDate` |
| `source_url` | Congress.gov bill page (or the API `bill.url`) |
| `raw` | full bill JSON + `sponsors[]`, full-text `formats[].url`, `congress` |

### Example request

```
GET https://api.congress.gov/v3/bill/119/hr/1?format=json&api_key=[KEY]
```

```json
{
  "bill": {
    "congress": 119, "type": "HR", "number": "1",
    "title": "...Act of 2025",
    "introducedDate": "2025-01-03",
    "latestAction": { "actionDate": "2025-07-04", "text": "Became Public Law No: 119-21." },
    "sponsors": [ { "bioguideId": "A000000", "fullName": "Rep. Smith, Jane [R-TX-1]", "party": "R", "state": "TX" } ],
    "laws": [ { "type": "Public Law", "number": "119-21" } ],
    "summaries": { "url": ".../v3/bill/119/hr/1/summaries" },
    "textVersions": { "url": ".../v3/bill/119/hr/1/text" }
  }
}
```

---

## 2. Federal Register API (executive actions) — `source='fedreg'`

**last verified: 2026-06-14**

- **Base URL:** `https://www.federalregister.gov/api/v1`
- **Version:** `v1`
- **Key:** **none required** (confirmed in official docs). Effectively unmetered
  for hourly ingestion.
- **Format:** JSON by default (`/documents.json`).

### Endpoints

| Need | Method + pattern | Key params |
|---|---|---|
| List recent EOs / presidential docs | `GET /documents.json` | `conditions[presidential_document_type][]=executive_order` (or `proclamation`, `determination`); broader: `conditions[type][]=PRESDOCU`; `order=newest`, `per_page` (max 1000), `page`, `fields[]=...` |
| Single document detail | `GET /documents/{document_number}.json` | `fields[]=...` |

Request fields explicitly (omitted from default list payload):
`fields[]=document_number&fields[]=type&fields[]=presidential_document_type&fields[]=title&fields[]=abstract&fields[]=publication_date&fields[]=signing_date&fields[]=executive_order_number&fields[]=agencies&fields[]=pdf_url&fields[]=html_url&fields[]=body_html_url`

### Field mapping → `cards`

| `cards` column | Federal Register source |
|---|---|
| `external_id` | `document_number` (e.g. `2026-11595`) |
| `title` | `title` |
| `summary` | `abstract` (often `null` for presidential docs — fall back to first body lines or leave null) |
| `status` | derive (`SIGNED`/`PUBLISHED`); EOs are typically `signing_date` + published |
| `occurred_at` | `signing_date` if present, else `publication_date` |
| `last_action_at` | `publication_date` |
| `source_url` | `html_url` |
| `raw` | full doc + `presidential_document_type`, `executive_order_number`, `agencies[]`, `pdf_url`, `body_html_url` |

### Example request

```
GET https://www.federalregister.gov/api/v1/documents.json?conditions[presidential_document_type][]=executive_order&order=newest&per_page=20
```

Trimmed real response (2026-06-14):

```json
{
  "count": 1547,
  "results": [
    {
      "document_number": "2026-11595",
      "type": "Presidential Document",
      "title": "Strengthening Customs Enforcement",
      "abstract": null,
      "publication_date": "2026-06-10",
      "pdf_url": "https://www.govinfo.gov/content/pkg/FR-2026-06-10/pdf/2026-11595.pdf",
      "html_url": "https://www.federalregister.gov/documents/2026/06/10/2026-11595/strengthening-customs-enforcement",
      "agencies": [ { "id": 538, "name": "Executive Office of the President" } ]
    }
  ]
}
```

---

## 3. CourtListener API v4 (judicial) — `source='courtlistener'`

**last verified: 2026-06-14**  ·  ingest route `/api/ingest/courts`

- **Base URL:** `https://www.courtlistener.com/api/rest/v4/`
- **Auth:** token header — `Authorization: Token ${COURTLISTENER_API_TOKEN}`.
- **Get a free token (TODO — not yet obtained):** create a free CourtListener
  account at <https://www.courtlistener.com/sign-in/>, then copy the token from
  <https://www.courtlistener.com/profile/api-token/> and paste it into
  `.env.local` as `COURTLISTENER_API_TOKEN`. The **REST API** (option 3 on the
  "Legal APIs and Data" page) is the right service for GenPop — not bulk/replication.
  If you're a student/academic, also apply for the **free EDU membership** for a
  higher rate tier.
- **Rate limit — changed recently, read carefully:** docs still state **5,000
  queries/hour for authenticated users**, but a **2026-05-07 policy change**
  lowered the *default* for new accounts (new number **not published — confirm in
  code/profile**). Accounts that ever made ≥1,000 requests are grandfathered;
  higher tiers come with paid membership, and a **free EDU membership** offers a
  generous tier. PACER/RECAP endpoints are now open to all accounts.
  → **Least stable** documentation of the sources (see open questions).

### Data model

`Court` → `Docket` → `Cluster` (group of opinions) → `Opinion`. Metadata lives at
the lowest object where it isn't repeated: docket number on the **docket**, case
name on docket & cluster, decision text on the **opinion**.

### Endpoints

| Need | Method + pattern |
|---|---|
| List recent dockets | `GET /dockets/?order_by=-date_modified` (or `-date_filed`) |
| List recent opinions | `GET /opinions/?order_by=-date_created` |
| Opinion clusters | `GET /clusters/` |
| Single docket / cluster / opinion | `GET /dockets/{id}/`, `/clusters/{id}/`, `/opinions/{id}/` |
| Court list (cache it) | `GET /courts/` |

### Filtering to higher-signal courts (don't ingest every district entry at launch)

- **SCOTUS only:** `?court=scotus` (dockets) / `?docket__court=scotus` (clusters) /
  `?cluster__docket__court=scotus` (opinions).
- **Federal appellate (circuits):** jurisdiction code **`F`** →
  `?court__jurisdiction=F`. District courts are **`FD`**; exclude with the `!`
  prefix → `?court__jurisdiction!=FD`. Verify jurisdiction codes via an `OPTIONS`
  request on `/courts/`.
- Add recency + tie-breaker: `&date_filed__gte=2026-01-01&order_by=-date_filed,id`.

### Field mapping → `cards`

| `cards` column | CourtListener source (object) |
|---|---|
| `external_id` | docket `id` (or cluster `id` when ingesting opinions) |
| `title` | `case_name` (docket/cluster) |
| `summary` | none provided → leave null; AI Insight summarizes the opinion (`card_ai`) |
| `status` | derive → `ARGUED`/`DECIDED` from `date_argued` / `date_filed` / `date_terminated` |
| `occurred_at` | `date_argued` or `date_filed` |
| `last_action_at` | `date_modified` (or `date_filed`) |
| `source_url` | `https://www.courtlistener.com` + `absolute_url` |
| `region` | n/a at federal launch (`sphere='federal'`) |
| `raw` | docket/cluster JSON + `court_id`, `docket_number`, `sub_opinions[]` |

### Example request

```
GET https://www.courtlistener.com/api/rest/v4/dockets/?court=scotus&order_by=-date_filed
  Header: Authorization: Token [TOKEN]
```

```json
{
  "next": "https://www.courtlistener.com/api/rest/v4/dockets/?court=scotus&cursor=...",
  "results": [
    {
      "id": 4214664, "court_id": "scotus",
      "case_name": "Petroleum Co. v. Regan",
      "docket_number": "23A994",
      "date_filed": "2026-04-21", "date_argued": null, "date_terminated": null,
      "absolute_url": "/docket/4214664/petroleum-co-v-regan/",
      "clusters": ["https://www.courtlistener.com/api/rest/v4/clusters/9502621/"]
    }
  ]
}
```

> Use **field selection** (`?fields=...` / `?omit=...`); opinion-text fields are huge.

---

## 4. State legislation — LegiScan vs OpenStates — `sphere='state'`

**last verified: 2026-06-14**

Federal legislation comes from Congress.gov (§1). This source covers **state
legislation, all 50** (`card_type='legislative'`, `sphere='state'`, `region=<state>`).

### LegiScan — `source='legiscan'`

- **Base URL:** `https://api.legiscan.com/`
- **Key:** free; register at <https://legiscan.com/legiscan-register>, pass as
  `?key=${LEGISCAN_API_KEY}`. Docs: <https://legiscan.com/gaits/documentation/legiscan>.
  ✓ obtained (`LEGISCAN_API_KEY` in `.env.local`).
- **Free-tier limit:** **30,000 queries/month** on a public service key.
- **Convention:** single base URL with an `op` parameter.

| Need | Call |
|---|---|
| Sessions per state | `?key=[KEY]&op=getSessionList&state=CA` |
| Recent bills per state | `?key=[KEY]&op=getMasterList&state=CA` (or `&id={session_id}`); `getMasterListRaw` returns `bill_id`+`change_hash` only (cheap change detection) |
| Bill detail | `?key=[KEY]&op=getBill&id={bill_id}` |
| Bill text | `?key=[KEY]&op=getBillText&id={doc_id}` |

### OpenStates (v3) — `source='openstates'`

- **Base URL:** `https://v3.openstates.org/`
- **Key:** free; register at <https://open.pluralpolicy.com/accounts/profile/>.
  Pass via `X-API-KEY: ${OPENSTATES_API_KEY}` header or `?apikey=`. Docs:
  <https://v3.openstates.org/docs/>. ✓ obtained (`OPENSTATES_API_KEY` in `.env.local`).
- **Free-tier limit:** tight — commonly cited **~250 requests/day, ~10/min** on
  the default tier; current exact numbers **unverified — confirm in code**.

| Need | Call |
|---|---|
| Recent bills per state | `GET /bills?jurisdiction=California&sort=latest_action_date&updated_since=YYYY-MM-DD` |
| Bill detail | `GET /bills/{jurisdiction}/{session}/{id}` or `GET /bills/ocd-bill/{uuid}` |

### Field mapping → `cards` (same shape for both; map to Congress.gov where possible)

| `cards` column | LegiScan | OpenStates |
|---|---|---|
| `external_id` | `bill_id` | `id` (ocd-bill UUID) |
| `title` | `title` | `title` |
| `summary` | `description` | `abstracts[]` / `title` |
| `status` | derive from numeric `status` enum + `status_date` | derive from `latest_action_description` |
| `occurred_at` | bill intro date (in `getBill`) | `first_action_date` |
| `last_action_at` | `last_action_date` | `latest_action_date` |
| `region` | `state` | `jurisdiction.name` → state code |
| `source_url` | `url` | `openstates_url` |
| `raw` | full bill + `sponsors[]`, `texts[]` | full bill + `sponsorships[]`, `sources[]` |

### Recommendation → **LegiScan as primary, OpenStates as supplement**

LegiScan gives cleaner "all 50 states' recent bills" coverage with less effort. A
single `getMasterList`/`getMasterListRaw` call returns a uniform, normalized
snapshot per state/session — identical schema for every state, with a built-in
`change_hash` for cheap incremental syncing — and 30,000/month comfortably covers
polling all 50 states on the hourly cron cadence. OpenStates v3 has a nicer REST
shape but its free tier (~250 req/day) is far too small to sweep 50 states at any
useful frequency, and recent-bill coverage varies by state with scraper health.
Use OpenStates as fallback/enrichment (geo lookups, committee/people data), not the
bulk-ingest path. This is the one quota that genuinely constrains the design.

---

## 5. Cross-spectrum news outlet list (threshold feed) — `card_type='live'`, `source='news'`

**last verified: 2026-06-14**

Per REBUILD_PLAN §3.4: the **fetch layer is per-outlet Google News RSS** (free, no
key) over this published cross-spectrum list. A story becomes a card only when
**≥N qualifying outlets across the spectrum** cover it within a time window (N and
window decided before launch, §3.2); cluster by title similarity, promote clusters
that clear the threshold, and store the audit trail in
`cards.news_audit = {outlets:[...], cleared_at}`. The spectrum is the **gate**, not
the product — no editorial overrides. Optional GDELT 2.0 for clustering signal;
NewsData.io free tier as fallback fetcher only.

Lean labels are **third-party assessments from AllSides / Ad Fontes Media — not
GenPop's judgment.** Canonical fetch = Google News RSS per outlet
(`https://news.google.com/rss/search?q=site:DOMAIN+when:1d&hl=en-US&gl=US&ceid=US:en`).
Native feeds (where they exist) are an optional richer alternative; NPR and Fox
feeds were fetched live and confirmed working on 2026-06-14.

| Outlet | Domain (Google News `site:`) | Lean (source) | Native RSS (optional) |
|---|---|---|---|
| The Guardian (US) | `theguardian.com` | Lean Left (AllSides) | `https://www.theguardian.com/us-news/rss` |
| The New York Times | `nytimes.com` | Lean Left (AllSides) | `https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml` |
| The Washington Post | `washingtonpost.com` | Lean Left (AllSides) | `https://feeds.washingtonpost.com/rss/national` |
| NPR | `npr.org` | Lean Left / Center — **contested** | `https://feeds.npr.org/1001/rss.xml` ✓ live |
| Associated Press | `apnews.com` | Center (AllSides) | none reliable → Google News |
| Reuters | `reuters.com` | Center (AllSides) | native feeds retired → Google News |
| BBC News | `bbc.com` | Center — **contested** | `https://feeds.bbci.co.uk/news/rss.xml` |
| The Hill | `thehill.com` | Center (AllSides) | `https://thehill.com/news/feed/` |
| The Wall Street Journal | `wsj.com` | Center news / Lean Right opinion — **contested** | `https://feeds.a.dj.com/rss/RSSWorldNews.xml` |
| Fox News | `foxnews.com` | Lean Right / Right — **contested** | `https://moxie.foxnews.com/google-publisher/latest.xml` ✓ live |
| National Review | `nationalreview.com` | Right (AllSides) | `https://www.nationalreview.com/feed/` |

Rough spread: 4 left-of-center, 4 center, 3 right-of-center. **Contested** flags
outlets where the news desk and opinion section are rated differently, or where the
rating draws public dispute (NPR, BBC, WSJ, Fox). For a defensible *published*
methodology, cite the specific AllSides Media Bias Chart / Ad Fontes Interactive
Media Bias Chart version + date, prefer the outlet-level **news** rating over the
opinion rating, and keep each outlet's "spectrum bucket" (L / C / R) explicit so the
threshold gate can require coverage from ≥1 of each bucket.

---

## Open questions / confirm in code

- **`cards.source` for state:** schema comment lists only the four federal sources;
  add `'legiscan'`/`'openstates'` + a state ingest route (route name TBD — §3.6
  names only `{congress,fedreg,courts,news}`).
- **Congress.gov:** no native status enum — normalize `latestAction`/action
  `type`/`laws[]` into the app `status` vocab. Confirm `sort=updateDate+desc` order.
- **Federal Register:** `abstract` frequently `null` for presidential docs;
  `signing_date`/`executive_order_number` appear only when requested via `fields[]`.
- **CourtListener:** **new default rate limit is unpublished** — measure the real
  ceiling from the profile; consider a free EDU membership. Confirm court
  `jurisdiction` codes (`F` appellate, `FD` district, `scotus`) via `OPTIONS` on
  `/courts/`. Decide whether `external_id` is the docket id or cluster id and keep
  it consistent. Always use field selection.
- **LegiScan:** confirm the numeric `status` enum → app vocab mapping; use
  `getMasterListRaw` + `change_hash` for incremental syncing.
- **OpenStates:** **exact free-tier limits unverified** (~250/day, ~10/min cited) —
  confirm before relying on it for any sweep.
- **News:** decide **N and the time window** for the threshold (§3.2). AP/Reuters
  have no reliable native RSS → Google News query fallback. Validate each feed
  returns parseable XML; re-pull lean labels from a dated AllSides/Ad Fontes
  snapshot and store source + version. Persist the spectrum bucket per outlet so the
  gate can enforce cross-spectrum coverage.
- **Rate limits at the planned hourly cron cadence:** Congress.gov (5k/hr),
  Federal Register (unmetered), CourtListener (free tier), and LegiScan (30k/mo) all
  sit comfortably above hourly ingestion needs. The only real constraint is
  **OpenStates' ~250/day**, which is why LegiScan is the state primary.
```
