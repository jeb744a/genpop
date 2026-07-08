# SPEC — News Threshold Feed (`card_type='live'`, `source='news'`)

Implements REBUILD_PLAN §3.4 (Phase 3). A story becomes a live card **only when
≥N qualifying outlets across a published cross-spectrum list cover it within a
time window**. The spectrum is the gate, not the product. The audit trail
(which outlets, when the threshold cleared) is stored on the card in
`cards.news_audit` and shown to users.

Aligned to `schema.sql` (`cards`, `job_log`) and `DATA_SOURCES.md` §5 (starting
outlet list — superseded by §1 below where they differ). Feed URLs and lean
labels verified **2026-07-06**; verification method noted per row.

Everything tunable in this spec (N, window, similarity threshold, outlet list)
is a named constant in `app/lib/newsThreshold.ts` and carries a version string
(`rule_version`, `outlet_list_version`) that is written into every card's
audit trail. Changing any of them bumps the version.

---

## 1. The outlet list (published)

### 1.1 Methodology (this is the defensible part — publish it verbatim)

- **Primary rating source: AllSides Media Bias Chart™ v11** (allsides.com,
  ratings retrieved 2026-07-06). Each outlet's **news** rating is used, never
  its opinion rating. Bucket assignment (L / C / R) follows the AllSides
  category mechanically: Left or Lean Left → **L**; Center → **C**; Lean Right
  or Right → **R**. No GenPop editorial overrides — if AllSides moves an
  outlet across a bucket boundary, the list updates and
  `outlet_list_version` bumps.
- **Secondary source: Ad Fontes Media Bias Chart** (adfontesmedia.com, flagship
  chart, Jan 2026 edition). Used as a cross-check only. Where Ad Fontes
  disagrees with AllSides by category, the outlet is flagged **contested**
  below; the AllSides bucket still governs.
- Lean labels are third-party assessments, **not GenPop's judgment**. The
  published methodology page must cite chart source + version + retrieval date,
  and link each outlet's AllSides source page.
- List changes are public: every change is a dated entry on the methodology
  page (same correction-log discipline as REBUILD_PLAN §4).

### 1.2 The list — 12 outlets, 4 per bucket

| # | Outlet | Bucket | AllSides rating (cited) | RSS URL | Feed status 2026-07-06 | Rationale |
|---|--------|--------|------------------------|---------|------------------------|-----------|
| 1 | The New York Times (News) | L | Lean Left — high confidence, May 2026 review ([source](https://www.allsides.com/news-source/new-york-times-news-media-bias)) | `https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml` | ⚠ not testable from build env (fetch blocked); long-documented official feed — **confirm in code** | Largest US newsroom; national paper of record. |
| 2 | The Washington Post | L | Lean Left — high confidence, Jul 2026 ([source](https://www.allsides.com/news-source/washington-post-media-bias)) | `https://feeds.washingtonpost.com/rss/politics` | ⚠ HTTP 200 but empty body via test client (likely UA-sensitive) — **confirm in code** with real UA | DC-native politics desk; deepest federal-government coverage. |
| 3 | NPR | L | Lean Left ([source](https://www.allsides.com/news-source/npr-media-bias)) — **contested**: NPR disputes the label; Ad Fontes places NPR near middle, high reliability | `https://feeds.npr.org/1001/rss.xml` | ✓ fetched live, valid RSS, items parsed | Public broadcaster, high Ad Fontes reliability; politics feed `1014` also available. |
| 4 | Associated Press | L | Lean Left (−2.93) — medium confidence, May 2026 review ([source](https://www.allsides.com/news-source/associated-press-media-bias)) — **contested**: AllSides itself calls AP borderline Left/Lean Left; Ad Fontes rates AP middle (bias −1.06, reliability 51.98) | Google News per-outlet RSS: `https://news.google.com/rss/search?q=site:apnews.com+when:1d&hl=en-US&gl=US&ceid=US:en` (no reliable native feed) | ⚠ Google News RSS not testable from build env — **confirm in code** | The primary US wire; fastest to file. **Note:** DATA_SOURCES.md §5 listed AP as "Center (AllSides)" — that is stale; AllSides has rated AP left-of-center since 2021. Bucketing follows the primary source mechanically, so AP sits in L. |
| 5 | Reuters | C | Center (−0.47) — high confidence, Jul 2026; blind survey Mar/Apr 2026 ([source](https://www.allsides.com/news-source/reuters-media-bias)) | Google News per-outlet RSS: `https://news.google.com/rss/search?q=site:reuters.com+when:1d&hl=en-US&gl=US&ceid=US:en` (native feeds retired) | ⚠ **confirm in code** | Global wire; the strongest Center anchor. |
| 6 | BBC News | C | Center (−0.8, panel override of a −0.94 numeric result) ([source](https://www.allsides.com/news-source/bbc-news-media-bias)) — **contested**: reviews have fluctuated Center/Lean Left for years | `https://feeds.bbci.co.uk/news/rss.xml` | ✓ fetched live, valid RSS, items parsed | Non-US vantage on US stories; consider `news/world/us_and_canada/rss.xml` for tighter scope (untested). |
| 7 | The Hill | C | Center — blind survey Dec 2025 ([source](https://www.allsides.com/news-source/hill-media-bias)) | `https://thehill.com/news/feed/` | ✓ HTTP 200, `application/rss+xml` (gzip; body not decoded by test client) | Congress-focused trade press; closest fit to GenPop's subject matter. |
| 8 | The Wall Street Journal (News) | C | Center — Feb 2025 review ([source](https://www.allsides.com/news-source/wall-street-journal-media-bias)) — **contested**: WSJ Opinion is rated separately (Lean Right/Right); news desk only | `https://feeds.a.dj.com/rss/RSSWorldNews.xml` | ✓ HTTP 200, `application/rss+xml` | Business/econ depth; `RSSPoliticsAndPolicy.xml` variant exists (untested). |
| 9 | Fox News | R | Right — reviewed Jul 2025 ([source](https://www.allsides.com/news-source/fox-news-media-bias)) — **contested**: online news desk rated separately from opinion/TV; Ad Fontes rates the website more reliable than the TV network | `https://moxie.foxnews.com/google-publisher/latest.xml` | ✓ fetched live, valid RSS, 12 items parsed | Largest right-of-center audience; `politics.xml` variant exists (untested). |
| 10 | National Review (News) | R | Lean Right — high confidence, Jul 2026 ([source](https://www.allsides.com/news-source/national-review-news-media-bias)); Opinion rated Right separately | `https://www.nationalreview.com/feed/` | ✓ HTTP 200, `application/rss+xml` | Flagship conservative outlet with a distinct news desk. Caveat: feed mixes news and opinion items — filter by URL path if the split matters. |
| 11 | Washington Examiner | R | Lean Right — high confidence, Jul 2026 ([source](https://www.allsides.com/news-source/washington-examiner-media-bias)) | `https://www.washingtonexaminer.com/feed/` | ✓ HTTP 200, `application/rss+xml` | DC-focused conservative daily; high story volume on federal action. |
| 12 | The Dispatch | R | Lean Right — blind survey Feb 2024 ([source](https://www.allsides.com/news-source/dispatch-media-bias)) | `https://thedispatch.com/feed/` | ✓ HTTP 200, `application/rss+xml` | High Ad Fontes reliability; fact-driven conservative reporting. Caveat: some items paywalled — audit links may hit a paywall (acceptable: the audit proves coverage, not free access). |

**Balance: 4 L / 4 C / 4 R.**

### 1.3 Changes from the DATA_SOURCES.md §5 starting list

- **AP moved C → L.** The repo's "Center (AllSides)" label is stale (see row 4).
  This is the single most important correction — a published list carrying a
  wrong label is exactly the attack surface the methodology exists to close.
- **The Guardian dropped.** AllSides rates it **Left** (outermost category,
  2025); it was the only outlet outside the Lean band, it duplicated the UK
  vantage BBC already provides, and its feed could not be verified from the
  build environment. Dropping it is also what rebalances the buckets to 4/4/4.
- **The Dispatch and Washington Examiner added** to bring R to parity
  (starting list had only 3 right-of-center outlets).
- **Alternates (documented, not on the list):** NBC News — Lean Left, medium
  confidence Jul 2026 ([source](https://www.allsides.com/news-source/nbc-news-media-bias)),
  feed `https://feeds.nbcnews.com/nbcnews/public/news` **verified live
  2026-07-06** — first substitute if NYT/WaPo feeds fail in code, since it is
  the only L-bucket alternate with a build-env-verified feed. New York Post is
  *not* a candidate (moved Lean Right → Right, Jun 2026).

### 1.4 Fetch-layer decision (revises DATA_SOURCES.md §5 default)

Native feeds are **primary** where they exist (9 of 12 verified working);
Google News per-outlet RSS is the fetch layer **only** for AP and Reuters
(no native feeds) and the **fallback** for any native feed that breaks.
Reasons: native feeds give canonical article URLs (Google News wraps links in
redirects, which pollutes the user-facing audit trail), carry
ETag/Last-Modified for polite conditional GETs, and avoid a single upstream
dependency on Google. Google News items' redirect URLs must be resolved to the
canonical outlet URL before being written to `news_audit` (§4.2).

---

## 2. The threshold rule

A cluster is **promoted** to a live card the moment all three hold:

1. **N = 4** distinct qualifying outlets have ≥1 item in the cluster.
2. All items counted arrived within the **window: 48 hours** of the cluster's
   `first_seen_at`.
3. The counted outlets span **all three buckets**: at least one L, one C, and
   one R outlet.

Constants: `THRESHOLD_N = 4`, `WINDOW_HOURS = 48`,
`BUCKETS_REQUIRED = ['left','center','right']`, `RULE_VERSION = '1.0'`.

**Counting rules (anti-gaming, part of the published rule):**

- Each outlet counts **once** per cluster, no matter how many items it runs.
- **Wire-syndication collapse:** an item whose byline/credit attributes it to a
  wire service on the list (e.g. `dc:creator`/`dc:contributor` = "The
  Associated Press", or "(AP)" / "(Reuters)" lead) counts as the **wire
  outlet**, not the republishing outlet. Without this, one AP story
  republished verbatim by three others would fake four independent editorial
  decisions.
- A cluster is only promoted if it passes the civic topic gate (§7, item 1).

**Why N=4:** N=3 is the minimum that can satisfy the cross-spectrum
requirement — exactly one outlet per bucket — so a single wire story plus
minimal pickup would clear it; it makes the gate only as strong as its weakest
single outlet per bucket. N=4 forces a second outlet in some bucket, i.e. at
least one *redundant* editorial decision. N=5 was rejected for launch: with
only 12 outlets, topic gating, and real-world feed flakiness (2 of 12 feeds
are already confirm-in-code), N=5 measurably risks missing legitimate
mid-size stories on slow days. Revisit after two weeks of promotion-rate data
(`job_log.detail` records near-misses; §6.4).

**Why 48h:** the practical RSS horizon is 24–72h (feeds carry a rolling tail;
BBC's TTL is 15 min but items persist ~2 days). 24h is too tight for the
documented cross-spectrum pickup lag — a story broken by one side's outlets
is often matched by the other side's the following morning. 72h keeps stale
clusters open, increasing false merges (§3) and letting slow trickle
masquerade as convergent coverage. 48h is the launch default.

---

## 3. Story clustering — deciding two RSS items are "the same story"

### 3.1 Decision: title/description token overlap at launch, not embeddings

| | Token overlap | Gemini embeddings |
|---|---|---|
| Quota | zero | Batched: ~24–48 req/day (hourly runs × 1–2 batch calls). Technically fits, **but** the free tier ~250 req/day is shared with AI Insight (~150/day), topic tagging (§5.3), and future features (Outlook, forum gate). News clustering would be the only *hard-realtime hourly* consumer — the first thing to break when the shared budget runs dry, and a quota failure would silently stop story promotion. |
| Determinism | fully deterministic, replayable | model-versioned, non-replayable if the embedding model changes |
| Auditability | the join rule can be published and hand-checked against any two headlines | "cosine ≥ 0.82" is not explainable to a user disputing a promotion |
| Infra | none | pgvector + index + tuned threshold |
| Recall | weaker on divergent headlines (mitigated below) | stronger |

The deciding argument is not just quota — it is REBUILD_PLAN §3.2's own
philosophy: **rules + audit trails, not trusted judgment.** A published gate
should be checkable by the public it is published to. Embeddings are the
documented upgrade path (`CLUSTERING_VERSION = 'token-overlap-1'` in the audit
trail makes the switch visible) once the platform is off the shared free tier.

### 3.2 Token-overlap design (concrete)

**Normalization** (in order, pure function `normalizeItem(title, description)`):

1. Unicode NFKC; lowercase.
2. Strip outlet boilerplate: trailing ` — Outlet Name`, ` | Outlet Name`,
   leading wire tags (`(ap) —`, `exclusive:`, `breaking:`), and trailing
   live-blog suffixes (`— live updates`, `: live`, `| live blog`).
3. Strip possessives (`'s` → ``), then all punctuation → spaces; collapse
   whitespace; tokenize on spaces.
4. Drop stopwords: a standard English list **plus** a news-stopword list
   (`live, updates, watch, video, breaking, exclusive, report, analysis,
   opinion, explained, explainer, latest, news, today, week, new`).
5. Light suffix trim only (trailing `s`/`es` when token length > 3). No
   stemmer dependency — determinism and replayability beat marginal recall.
6. Keep numeric tokens verbatim (bill numbers, vote counts, dollar figures
   are the strongest story anchors in this domain).

**Token sets per item:**

- `T(item)` = tokens(title) ∪ tokens(first 40 words of RSS description).
  Including the description is the recall mitigation for divergent headlines —
  two different headlines about the same event usually share entities in the
  first sentence of the lede.
- `A(item)` ⊂ `T(item)` = **anchor tokens**: numeric tokens plus tokens that
  were capitalized in the *original* (pre-lowercase) title/description at a
  non-sentence-initial position — a cheap deterministic proper-noun proxy.

**Similarity and join rule:**

- `sim(a, b) = |T(a) ∩ T(b)| / |T(a) ∪ T(b)|` (Jaccard).
- Item `x` joins open cluster `K` iff:
  - `max over m ∈ K of sim(x, m) ≥ 0.35` (single linkage), and
  - `|A(x) ∩ A(m)| ≥ 2` for that maximizing member `m` (two shared anchors —
    blocks joins driven by generic vocabulary), and
  - `|A(x) ∩ A(seed(K))| ≥ 1` (drift guard: every member shares at least one
    anchor with the cluster's first item, so single-linkage chains can't walk
    the cluster onto a different story).
- If multiple clusters qualify, join the one with the highest max-sim. If
  none, `x` seeds a new cluster.
- Only clusters with `first_seen_at` within the last `WINDOW_HOURS` are open
  for joining.

`SIM_THRESHOLD = 0.35` is a reasoned prior, not a measured one. **Soak
requirement:** run the pipeline for ≥1 week before launch logging every
candidate pair with `0.20 ≤ sim < 0.50` (pair, score, joined?) to
`news_cluster_pairs_log`, hand-label ~200 pairs, and adjust. This is a launch
gate, not a nice-to-have.

**Item identity / dedup:** an item's identity key is `guid` if present else
canonical `link`. Re-seeing a known key is a no-op (idempotent re-runs).

### 3.3 Cluster key (= `cards.external_id`)

`news:{YYYYMMDD}-{slug}-{hash6}` where `YYYYMMDD` is `first_seen_at` (UTC),
`slug` = first 3 anchor tokens of the seed item joined by `-` (≤ 24 chars),
`hash6` = first 6 hex chars of SHA-256 of the seed item's identity key.
Example: `news:20260706-scotus-hr1-immigration-4f2a9c`. Stable for the
cluster's life; unique via the hash; human-readable in the audit trail.

---

## 4. Cards mapping

### 4.1 The `cards` row written at promotion

| column | value |
|---|---|
| `card_type` | `'live'` |
| `sphere` | `'federal'` (schema default; live news is not sphere-scoped at launch) |
| `source` | `'news'` |
| `external_id` | cluster key (§3.3) — upsert key with `source` |
| `title` | **Title choice rule:** the title (normalized per §3.2 step 2 — boilerplate stripped, original casing kept) of the **earliest-published item from a Center-bucket outlet** in the cluster. The cross-spectrum requirement guarantees ≥1 C item exists at promotion time. Rationale: mechanical, defensible, and avoids GenPop writing headlines. |
| `summary` | the RSS `description` of the same chosen item (source-provided, never AI — per schema comment) |
| `status` | `'DEVELOPING'` at promotion; `'CONCLUDED'` when the cluster closes (§5.2) |
| `region` | null |
| `occurred_at` | earliest `pubDate` across cluster items |
| `last_action_at` | timestamp of the most recent outlet added to the audit (drives feed sort) |
| `source_url` | canonical URL of the same chosen item (Google News redirects resolved, §4.2) |
| `raw` | cluster internals: all member items (identity key, outlet, title, url, pubDate, sim score at join), constants snapshot |
| `topics` | Gemini-tagged at promotion from title+summary (one call per promoted cluster — a handful/day, fits the shared budget; same taxonomy as all cards) |
| `news_audit` | §4.2 |

### 4.2 `news_audit` JSON shape (user-facing; exact)

```json
{
  "rule_version": "1.0",
  "clustering_version": "token-overlap-1",
  "outlet_list_version": "2026-07-06",
  "rule": { "n": 4, "window_hours": 48, "buckets_required": ["left", "center", "right"] },
  "cluster_key": "news:20260706-scotus-hr1-immigration-4f2a9c",
  "first_seen_at": "2026-07-06T09:12:40Z",
  "cleared_at": "2026-07-06T15:00:12Z",
  "outlets": [
    {
      "outlet_id": "reuters",
      "name": "Reuters",
      "bucket": "center",
      "item_title": "Supreme Court to hear challenge to ...",
      "item_url": "https://www.reuters.com/legal/...",
      "published_at": "2026-07-06T09:05:00Z",
      "first_seen_at": "2026-07-06T09:12:40Z",
      "via_wire": null
    }
  ]
}
```

- `outlets[]` is ordered by `first_seen_at`; one entry per outlet (its
  earliest counted item). `via_wire` names the wire outlet when the
  syndication-collapse rule (§2) reassigned the entry, else null.
- `item_url` is always the **canonical outlet URL** — items fetched via
  Google News RSS have their redirect resolved (one HEAD/GET, at
  audit-write time only, bounded per §6.2) before writing.
- `cleared_at` and the `rule`/version fields are **immutable** after
  promotion. `outlets[]` is **append-only** (§5.1).
- Everything here renders on the card: this is the user-facing proof of why
  the story is on the platform.

### 4.3 Staging tables (schema addition — new migration required)

`schema.sql` has no home for pre-promotion state; two service-role-only
tables (default-deny RLS, no public policies):

```sql
create table news_items (
  identity_key text primary key,          -- guid or canonical link
  outlet_id    text not null,
  title        text not null,
  description  text,
  url          text not null,
  published_at timestamptz,
  first_seen_at timestamptz not null default now(),
  cluster_key  text                        -- null until clustered
);
create index news_items_cluster_idx on news_items (cluster_key);

create table news_clusters (
  cluster_key   text primary key,
  seed_identity text not null references news_items(identity_key),
  first_seen_at timestamptz not null,
  status        text not null default 'open',  -- open | promoted | expired | closed
  promoted_card_id uuid references cards(id),
  last_item_at  timestamptz not null
);
```

Plus `news_cluster_pairs_log` during the soak week (droppable after tuning),
and per-outlet fetch state (`etag`, `last_modified`, `last_status`) — a small
`news_feed_state` table keyed on `outlet_id`.

---

## 5. Lifecycle

### 5.1 After promotion (live card updates)

Each cron run, items still cluster as in §3. When a **new outlet** (post
wire-collapse) joins a promoted cluster:

- Append its entry to `news_audit.outlets`.
- Bump `cards.last_action_at` (resurfaces the card in the feed) and
  `updated_at`.
- `title`, `summary`, `source_url`, `cleared_at` are **never** rewritten —
  a neutral record shouldn't have shifting headlines, and immutability keeps
  the audit trail trustworthy. (A later "developments" feature can render
  newer audit entries; not in scope.)

New items from an *already-counted* outlet update nothing user-facing (logged
in `raw` only).

### 5.2 When tracking stops

- **Unpromoted cluster:** expires when `now() - first_seen_at > 48h`
  (`status='expired'`). Its `news_items` rows are deleted after a further 7
  days (storage hygiene; the pairs log keeps tuning data during soak).
- **Promoted cluster:** closes when `now() - last_item_at > 48h` — i.e. the
  window slides with activity after promotion, so a story that keeps drawing
  new coverage keeps its audit growing, and a story that goes quiet for 48h
  is done (`status='closed'`, `cards.status='CONCLUDED'`). Hard cap: 7 days
  after `cleared_at`, close regardless (bounds work; prevents zombie
  mega-clusters). The **card row persists forever** — only tracking stops.
- Closed/expired clusters are never reopened. Renewed coverage after closure
  (e.g. a verdict weeks after the arrest) is a *new story*, new cluster, new
  card — correct behavior for a record of discrete events.

---

## 6. Cron design — `/api/ingest/news`

### 6.1 Cadence

**Hourly.** Vercel Hobby cron allows only daily granularity / 2 jobs, so per
REBUILD_PLAN §9: hourly via the single fan-out cron route or a GitHub Actions
schedule hitting the route with `CRON_SECRET`. Hourly is polite to publishers
(≪ their own TTLs; BBC advertises 15 min), well within every feed's tolerance,
and fast enough for a 48h threshold window. Do not exceed 4×/hour without
revisiting §6.3.

### 6.2 Per-run bounds (hard caps, enforced in code)

- ≤ 12 native-feed fetches + ≤ 2 Google News fetches (AP, Reuters); 10s
  timeout each; ≤ 1 retry, only on network error (not on HTTP error status).
- ≤ 50 items parsed per feed per run (feeds are top-N anyway).
- ≤ 25 Google News redirect resolutions per run (only for audit-bound items).
- ≤ 10 cluster promotions per run — a circuit breaker: the 11th+ promotion
  defers to the next run and logs loudly. Normal volume is 0–3/run; hitting
  the cap is itself an anomaly signal (feed poisoning, clustering bug, or a
  genuinely historic news day — all worth a human look).
- ≤ 1 Gemini call per promotion (topic tagging), so ≤ 10/run, ≤ ~30/day
  typical — bounded share of the 250/day budget.
- Whole run wrapped in a wall-clock budget (e.g. 60s) — partial progress is
  fine because every step is idempotent.

### 6.3 Politeness

- UA: `GenPopBot/1.0 (+https://<domain>/methodology; news threshold ingest;
  contact: <email>)` on every request.
- **Conditional GET:** store `ETag`/`Last-Modified` per outlet in
  `news_feed_state`; send `If-None-Match`/`If-Modified-Since`; a 304 costs
  the publisher nothing.
- `Accept-Encoding: gzip`. One fetch per feed per run, serial with jitter
  (100–500ms between outlets), never parallel-hammering one host.
- On 429/5xx: skip the outlet this run, record in `news_feed_state`; after 3
  consecutive failures surface in the health endpoint (a dead feed silently
  shrinks the gate's denominator — that's a threshold-integrity issue, not
  just an ops issue).
- Respect permanent redirects by updating the stored feed URL (log the
  change; a hijacked redirect is an attack vector — see chat notes).

### 6.4 Idempotency (`job_log`)

- Job key: `ingest:news:{YYYY-MM-DDTHH}` (UTC hour) — same convention as the
  other ingest routes. If the key exists with `status='done'`, exit.
- Write the key with `status='running'` at start, flip to `done` at end;
  a `running` row older than 2h is treated as crashed and may be re-run
  (every underlying step is idempotent: item upserts on `identity_key`,
  cluster joins are deterministic, card upsert on `(source, external_id)`,
  audit appends are keyed by `outlet_id` presence).
- `detail` jsonb per run: items fetched/new, clusters opened/joined,
  promotions, near-misses (clusters at N−1 or missing one bucket at expiry —
  the tuning signal for §2), per-feed status, quota use.

---

## 7. Reaction prompt fit (`live`: `under_control | developing | out_of_control`)

The reactionConfig vocabulary presumes the card describes a **situation with
a current state** — something that can plausibly be "under control" or not.
Requirements this places on card content:

1. **Topic gate doubles as situation gate.** Only clusters whose Gemini topic
   tags land in the civic/policy taxonomy (`app/lib/topics.ts`) are promoted
   (the same call that fills §4.1 `topics`, made when a cluster first reaches
   the threshold); a cluster tagged only outside the taxonomy is held
   unpromoted (counts toward nothing) even at N=4. This keeps sports/celebrity
   stories — where the prompt reads as nonsense — off the live feed entirely,
   and keeps GenPop's news layer scoped to its civic mission.
2. **The card must show recency and momentum**, or "developing" is
   unanswerable: render `cleared_at`, `last_action_at`, and the outlet count
   from `news_audit` on the card ("Cleared threshold 6h ago · 7 outlets ·
   last new outlet 40m ago").
3. **The title must be an event statement, not a take** — guaranteed
   structurally by the Center-outlet title rule (§4.1), which is another
   reason that rule exists.
4. `status` `'DEVELOPING'`/`'CONCLUDED'` (§5.2) should render as a chip; users
   reacting to a concluded situation are answering "how was it handled,"
   which still parses for this vocabulary.
5. **Known residual mismatch:** discrete announcements (a ruling, a result,
   an appointment) clear the gate but fit the scale awkwardly — "developing"
   covers most, but expect some semantic strain. Most such events also arrive
   as legislative/executive/judicial cards with better-fitted prompts, which
   caps the damage. Flag for a post-launch review of per-subtype prompts;
   **do not** add subtypes at launch (reactionConfig churn breaks consensus
   comparability).

---

## 8. Open items / launch gates

1. **Confirm in code (real UA, from the deploy environment):** NYT feed, WaPo
   feed (try `/rss/politics` and `/rss/national`), Google News RSS pattern for
   AP + Reuters (and redirect resolution). All four are flagged in §1.2; three
   of them are the L bucket, so this is launch-blocking.
2. **Soak week** (§3.2): tune `SIM_THRESHOLD` on logged pairs before launch.
3. **Migration** for `news_items`, `news_clusters`, `news_feed_state` (§4.3);
   RLS default-deny, service-role writes only.
4. Publish the **methodology page** (outlet table of §1.2 incl. contested
   flags, the rule of §2, versions, change log) — the list is only defensible
   if it is actually published with its sources.
5. Re-pull AllSides ratings at launch and quarterly; store retrieval date;
   bump `outlet_list_version` on any change. (AP just demonstrated why: it
   moved categories between DATA_SOURCES.md's writing and this spec.)
