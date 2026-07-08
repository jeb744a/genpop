# GenPop v2 — Rebuild Plan

Clean rebuild for deployment. Two source documents inform this plan:
`GenPop_Plan_v4.pdf` (the original master plan — "the Plan") and the strategic
refinements worked out after it. Where this document and the Plan disagree,
**this document wins** — it reflects deliberate decisions to resequence the
Plan's vision around a more buildable, lower-risk path to the same endgame.

The endgame is unchanged (Plan §9): GenPop as essential civic infrastructure —
a continuous, neutral record of what government does and how citizens respond.
What changed is the *order of operations* to get there.

---

## 0. The strategic thesis (read this first)

The Plan is built around **participation** — verify, pay, react, discuss. But
participation has a brutal cold-start problem (Plan §5.1): consensus data is
worthless until thousands of verified users exist, and the Plan deliberately
strips out the friend-graph network effects that bootstrap normal social apps.

The refinement: **lead with consumption, gate participation behind it.**

GenPop's core asset is something that does not currently exist anywhere:

> **A complete, real-time, plain-language record of every action the federal
> government takes — legislative, executive, and judicial — in one place, with
> the source document one tap away.**

The data is all public (Congress.gov, the Federal Register, CourtListener), but
it lives on three disconnected government sites, each in its own bureaucratic
dialect, none written for a human, with no unified surface. Filling that hole is
a **reference utility**, and a reference utility has none of participation's
problems: it's valuable at N=1, retains without network effects, and is
SEO-discoverable (bills/rulings/EOs are durable, searchable, evergreen objects).

This reframes the whole product into three layers:

1. **The core (the wedge):** the complete neutral record of federal government
   action across all three branches, in plain English. *This doesn't exist. It
   is the thing we build first, lead with, and define ourselves by.*
2. **Wrapped around it:** a cross-spectrum news feed (Ground-News-adjacent, but
   neutrality-as-filter, not spectrum-as-product — see §3.4) that contextualizes
   government actions with what's happening and how it's covered.
3. **Built on top, gated by verification:** the participation layer — verified
   real humans reacting and discussing — which turns the reference utility into
   the consensus/audit engine of the Plan's §9 vision.

### Positioning stack
Three claims, each backable by the architecture, none readable as partisan:

1. **What it is:** the complete record of what your government actually does —
   neutral, plain-language, current, all in one place.
2. **Why you can trust it:** every participating account is a verified real
   human — one government ID, one account, no bots, no farms. (This is the
   *durable* differentiator: as the internet fills with AI-generated noise and
   >50% of traffic is automated, a guaranteed-human civic space gets more
   valuable over time, not less. The $5 stake is part of the mechanism — bots
   don't pay per-identity to scale.)
3. **What it does for you:** you form your own opinions from sources, instead of
   being fed them by algorithms and partisans.

Positioning guardrails (encoded in `.cursorrules`):
- The headline is **bot-free verified humanity**, not nationality. US-ID is a
  *launch scope*, not an identity claim — it keeps the Plan §9 international
  roadmap open. Do not market "American citizens only": government ID proves
  real-person/residency, not citizenship, and a nationality claim reads as
  partisan to a brand whose entire asset is cross-spectrum trust.
- Avoid the phrase "free thinkers" in brand copy — the concept (form your own
  opinion) is core, but the specific phrase has picked up a contrarian-tribe
  connotation that cuts against neutrality. Use "form your own opinions,"
  "think for yourself," "informed by sources, not influencers."
- Claim exactly the completeness we can deliver (see §3a coverage scope). Over-
  claiming completeness is the one thing that breaks a reference utility.

### Two-tier model (both live at launch)
- **Free / read-only:** sees *everything* — all government-action cards,
  explainers, news feed, consensus bars, and all discussion. Contributes
  nothing. The free tier seeing all readable content is what makes the model
  honest: users don't pay to *see*, they pay to *be counted*. Never hide
  readable content behind the wall to juice conversions — that recreates the
  toll-booth-at-the-entrance problem this strategy exists to escape.
- **Verified:** government-ID verified; unlocks participation (reactions +
  discussion). Ships at launch. The wall goes around *writing*, not *reading*.

The verified tier is the *only* source of every reaction and comment from day
one, so the consensus data is clean from the first row — no messy migration of
unverified contributions later.

### The $5 fee — timing is a deliberate choice, not a default
The Plan §4.2 argues for launching at $5. The refinement: launch verification
**free for a founder window**, framed as "free for founders, $5 after," and
turn on the fee at a **pre-decided trigger** (a verified-user count or retention
threshold — decide the number before launch). Rationale: it's far easier to ask
people to verify into thin early threads when it's free; pricing entry into an
empty room is the worst version of the fee. The Plan's own "introductory pricing
window" framing (§4.2) supports this. When the fee turns on, it converts
believers who already value the place rather than filtering strangers at the door.

### What is condition-gated, not roadmapped to dates
These can't work until earlier things are true, so they sequence to last by
necessity, not preference:
- **Paid verification** is gated on demonstrated *readership retention* (people
  return to read without participating).
- **The Earn mechanic** is gated at 10,000 verified users (Plan §4.4) *and* on a
  functioning enterprise data business (an Earn marketplace with no buyers and
  200 users is an empty store).
- **The enterprise data business** is gated on a verified base large enough that
  the data is worth buying — and honest about representativeness limits (see
  §7 risks).

### The one discipline to hold
The risk of consumption-first is *never making the leap to participation* — a
pure information product is fine but it's GovTrack-with-better-writing, not the
§9 vision. The moat and upside are in the participation/data layer. So the
verification trigger above is **pre-committed**: decide the readership/retention
number now, so "ship the easy useful thing" doesn't quietly become "never ship
the hard valuable thing."

---

## 1. What we learned from v1 (keep / cut / fix)

### Keep (port the *design*, rewrite the code)
| v1 concept | Why it stays |
|---|---|
| Didit verification + nullifier hash (`HMAC-SHA256(doc#, salt)`, never store plaintext) | Core of the bot-free guarantee. Design was right; port it cleanly. |
| `card_reactions` with per-card-type response sets | Matches Plan §3.4 structured reactions. |
| Anonymous daily handles + `#1`/`#1a` ordinal comment labels | Matches Plan §2.2 anonymity-by-design. |
| Civic Slate theme tokens (CSS variables, `data-theme`) | Working, cheap to port. |
| Webhook-driven Didit finalization with HMAC signature check | Production-correct pattern. |
| React-before-discussion-unlocks mechanic | Anti-anchoring: register your own read before seeing the crowd's. Serves the "form your own opinion" positioning directly. |

### Cut (bloat, scope creep, or now out of sequence)
- **The user-ranking / Standing ledger as a launch feature.** A visible (or even
  hidden-but-computed) karma/standing system is useless for a consumption-first
  reference utility and adds complexity with no launch payoff. Standing is cut
  from launch entirely. (If a contribution-quality signal is ever needed — e.g.
  for the Plan §3.6 Delegated Reactions "earned eligibility" path — reintroduce
  it then, deliberately. It must never become a ranking input or a public proxy
  profile; that was the Plan's §2.2 own warning.)
- **All v1 mock layers**: `app/mocks/`, `app/lib/mock/`, `feedNonLegislativeStories`,
  seeded comment threads, mock thinking-profile, `generate-live-events`. All
  card types are real from day one (see §3).
- **Dual AI providers.** Gemini only (free tier). One SDK, one key.
- **The general-topic forum tags** (sports/culture/entertainment/tech). v2 has a
  politics-only forum (§5) kept on-topic by an AI gate, not off-topic tags.
- **Legacy survey scoring/payout, Earn UI, points redemption, B2B dashboard,
  Stripe, Tremendous** — all deferred to condition-gated later milestones (§0).
  Not built at launch.
- **Empty scaffolded routes, `@simplewebauthn/*`, `ProfileModal` localStorage,
  dual news providers** — gone.
- **`points_ledger` at launch** — no points economy at launch, so no ledger.
  (Created later with the Earn milestone.)

### Fix (v1's known failure points)
1. **One auth funnel.** v1 had two competing paths and repeated "tried to fix
   auth" commits. v2 has exactly one: `/onboarding` → email account → handle →
   Didit verify → (optional demographics). Reads are public; verification gates
   *writes* via RLS, not a client-side wrapper. No `RequireVerified` around the
   whole app.
2. **Real migrations** via Supabase CLI (`supabase/migrations/*`). No loose SQL.
3. **No mock/real split in the feed pipeline.** A single `cards` table is the
   feed's source of truth; ingestion jobs populate it from real APIs.
4. **Comments live from day one** — no hardcoded threads.

---

## 2. v2 Tech stack

| Layer | Choice | Cost |
|---|---|---|
| Framework | Next.js 15 (App Router) + React 19 + TS + Tailwind v4 | free |
| DB / Auth / Storage | Supabase (Postgres + RLS + Auth) | free tier |
| Hosting | Vercel (Hobby to start) | free tier |
| Identity verification | Didit (free core ID-verification plan) | free tier |
| AI | Google Gemini 2.5 Flash (`@google/generative-ai`) | free tier |
| Jobs | Vercel Cron → idempotent route handlers + `job_log` (no BullMQ/Redis) | free |
| Payments (deferred) | Stripe (B2B), Tremendous (payouts) | per-txn, later |

Dropping BullMQ/Upstash: a cron route scanning Postgres for due work, idempotent
via a `job_log` unique key, replaces v1's queue with two fewer services.

---

## 3. Data sources — all free

This is the biggest upgrade over v1, which mocked three of four card types.

### 3.1 Legislative — Congress.gov API
`https://api.congress.gov/v3/`. Free key from api.data.gov, 5,000 req/hr. Bills,
actions, sponsors, official CRS summaries, full-text links, committee referrals.
Replaces LegiScan for federal and is richer.

### 3.2 Executive — Federal Register API
`https://www.federalregister.gov/api/v1/`. No key required. Executive orders,
presidential documents, proposed/final agency rules, with abstracts and
full-text/PDF links.

### 3.3 Judicial — CourtListener REST API (Free Law Project)
`https://www.courtlistener.com/api/rest/v4/`. Free key. Opinions, dockets, oral
arguments across SCOTUS, circuit, and district courts.

### 3.4 Live news — threshold feed (the neutrality-as-filter layer)
Fetch layer: per-outlet Google News RSS (free, no key) for a **published
cross-spectrum outlet list**. A story becomes a card only when ≥N qualifying
outlets across the spectrum cover it within a time window (Plan §3.2). Cluster
by title similarity, promote clusters that clear the threshold, store the audit
trail (which outlets, when) on the card — auditability is a user-facing feature.

Distinction from Ground News/AllSides: they make the bias *spectrum* the product
("here's how left vs. right covered this"). GenPop makes the spectrum the *gate*
and then gets out of the way — show the event, you decide. Optional GDELT 2.0
(free) for clustering signal; NewsData.io free tier as fallback fetcher only.

### 3.5 AI layers (Plan §3.3) — see §4 for the neutrality architecture
- **AI Insight** (objective explainer per card): Gemini, generated on first
  view, cached in `card_ai` keyed by card + source-content hash.
- **AI Outlook** (synthesis of verified-user reactions/discussion): Gemini,
  regenerated on a cadence/threshold, cached with input-snapshot hash.

### 3.6 Ingestion architecture
A Vercel Cron route per source (`/api/ingest/{congress,fedreg,courts,news}`),
each upserting into the single `cards` table keyed on `(source, external_id)`.
The feed reads only from `cards` — never calls upstream APIs at request time.
This kills v1's per-request LegiScan calls, the mock overlay, and `isMockFeedId`.

---

## 3a. Coverage scope — claim exactly what we deliver

Completeness is where a reference utility lives or dies. Scope the *claim* to
match the *delivery*, and show coverage boundaries rather than hide them.

- **Launch — Federal, complete, all three branches.** Congress.gov + Federal
  Register + CourtListener give a genuinely complete, bounded, deliverable
  federal record. This alone is the unique, doesn't-exist-yet wedge.
- **Launch — State legislation, all 50.** LegiScan/OpenStates aggregate every
  legislature into one API with consistent structure. Deliverable at launch.
- **Near expansion — State executive & judicial, rolling.** No Federal Register
  equivalent for governors' EOs (state-by-state, often unstructured); state
  trial-court data is uneven. Do *not* claim "complete state coverage." Show a
  visible coverage-status surface ("Federal: complete · State legislation: all
  50 · State executive/judicial: rolling, here's where we are"). The honesty is
  itself a trust feature, mirroring the news audit trail.
- **Density-driven expansion — localities.** Follow the Plan's §5.3 density
  principle: add localities where *user density* justifies the per-locality
  ingestion cost (every locality is a bespoke data-availability problem). Never
  add localities by population or alphabetically. Condition-gated ("where are
  our users?"), not date-roadmapped.

Launch claim, fully truthful and still unique: **"the complete record of federal
government action — all three branches — plus all state legislation, in plain
English, in one place."**

---

## 4. AI Insight — neutrality as architecture, not just prompting

AI Insight is now the **reputation-bearing front door** (it's the consumption
product's core), so it gets more than v1's "prompt Gemini and cache." The first
slanted summary that gets screenshotted damages the neutral brand, so constrain
the model structurally — apply the Plan §3.2 philosophy (rules + audit trails,
not trusted judgment) to the explainer itself.

What objective-register prompting fixes: **tone bias** — loaded adjectives,
editorializing, framing verbs. Prompt for statutory register: report what
changes, from what to what, not whether it's good. This is necessary and puts us
ahead of every partisan outlet, but it does *not* fix selection bias (which of N
provisions you summarize), structural framing (order, emphasis), or false
balance. Architecture covers what prose can't:

- **Fixed extraction schema, not freeform summary.** Force the model to fill the
  same slots for every card (what changes · from what → to what · who's affected
  · effective date · sunset if any · cost if scored · source section). A
  consistent skeleton fights selection bias because the structure decides
  inclusion, not per-card model judgment. Also reads more statute-like than prose.
- **Source alongside summary, never instead of it.** Render the explainer *next
  to* the primary text; quote actual statutory/opinion language for key
  provisions and point at it. The less the AI stands between user and document,
  the less the brand rides on Gemini getting every call right. This *is* the
  mechanic of "form your own opinion."
- **Provenance per claim.** Each summary line traceable to a source section.
  Trust feature + forcing function (a model that must cite smuggles less framing).
- **Determinism + consistency checks.** Temperature ~0; periodically regenerate
  the same card and diff — a neutral source that says different things about the
  same bill on different days has a credibility problem independent of bias.
- **Visible correction log.** A user-flag path and a public record of
  corrections. "We're objective, we show our work, here's every correction"
  survives a bad screenshot; "we're never wrong" shatters on the first one.

---

## 5. The Forum — anonymous political posting (verified-gated)

A standalone `/forum` (Twitter mechanics, YikYak identity) where verified users
post short freestanding takes. *Visible to all (free tier reads everything),
writable only by verified users.* In addition to card-attached discussion.

- **Politics-only by AI gate, not tags.** Every post passes one Gemini call
  (relevance + baseline moderation + topic tagging, combined). Borderline posts
  publish at reduced distribution (`status='reduced'`), not hard-rejected.
- **Anonymous, no ethos.** Daily anonymous handle; ordinal labels in threads. No
  follower graph, no reposts, no quote-posts — nothing to follow.
- **Dilute, don't amplify (Plan §2.3).** Net −5 votes auto-hides a post
  (appealable). The moderate majority is the first moderation layer. A
  polarization monitor (reaction-split heuristic + Gemini pass on flagged
  threads) queues outliers.
- **Posts:** 1–280 chars, text-only at launch, optional `cards` attachment (a
  compact card chip that funnels forum energy back to the civic surface).
  Replies one level deep, 70–280 chars.
- **Topic tagging** from one fixed policy taxonomy (`app/lib/topics.ts`), applied
  to both posts (at publish) and cards (at ingestion) — one shared topic space.

### Three feed modes
- **Latest** — pure reverse-chronological, no algorithm (an always-available
  unranked view is itself a trust feature).
- **Trending** — cron-computed time-decay hot score:
  `hot = (up − down) / (age_hours + 2)^1.5`, small boost for unique repliers.
  Stored on the row, not computed at query time.
- **For You (relevance)** — personalized from data we already hold.

### Relevance ranking — the one hard rule
Personalize on **what you engage with, never what you believe.** This is the line
between "relevant" and "echo chamber," and it's a hard invariant.
- **Allowed signals:** per-topic *engagement volume* (which policy topics you
  react/save/reply in — direction of reaction ignored), region match (state, the
  YikYak locality mechanic), sector match, recency, global quality.
- **Forbidden signals:** direction/stance of any reaction or vote, inferred
  ideology, agreement-likelihood, collaborative filtering on opinion. A
  progressive and a conservative who both engage with healthcare see
  substantially the same healthcare posts.

Implementation: a cron-maintained `user_topic_affinity` table (user × topic,
exponentially decayed, built from engagement *volume* only). For-You score ≈
`affinity · recency_decay · quality + region_boost + sector_boost`, as a scored
Postgres query over a 72h candidate window. No vector DB, no ML infra. This same
table later powers survey targeting and delegate matching, so it earns its place.

---

## 6. The GenPop Report — weekly published digest

A recurring report (weekly to start) generated from the data on the platform,
published to users in-app and externally (web page, shareable, eventually a
newsletter / press-facing primary source). This is the Plan §9.3 "editorial
output" and §9.2 "government audit" vision, started small and early — and it
doubles as a **growth and credibility engine**: a neutral weekly artifact is
linkable, quotable, and SEO-friendly, and it gives press a reason to cite GenPop
as a source (Plan §5.3 targets exactly this kind of coverage).

What it contains, scaled to available data:
- **What government did this week** — a digest of the week's notable federal
  actions across all three branches (drawn straight from `cards`), in the same
  neutral extraction register as AI Insight. This part works *from day one*,
  before there's any meaningful user base, because it's built from the
  government-action record, not from user opinion. So the Report launches as a
  pure-consumption artifact and *grows* an opinion layer as participation scales.
- **What citizens thought** (once verified base supports it) — aggregated
  reaction/consensus on the week's top cards, with demographic breakdowns where
  cell sizes allow (small-cell suppression, <5 authors hidden). Direct vs.
  delegated reactions reported separately once delegation exists (Plan §3.6).
- **The gap** (the §9.2 audit, longer-term) — where citizen preference and
  government action diverge, surfaced as a recurring feature once both signals
  are rich enough.

Build approach:
- A `reports` table storing each issue (period, generated content, snapshot of
  the inputs for reproducibility/audit).
- A weekly cron (`/api/cron/generate-report`) that assembles the government-
  action digest from `cards` and (later) the opinion layer from reactions, runs
  it through Gemini in the fixed neutral register, and stores the issue.
- A public `/report` route rendering the latest + an archive; in-app surfacing
  in the feed/sidebar; export-friendly markup for a newsletter later.
- Same neutrality discipline as §4: extraction schema, provenance back to the
  source cards, consistency, correction log. The Report carries the brand's
  neutrality reputation publicly, so it gets the same architectural guardrails,
  not looser ones.

Launch scope: ship the **government-action digest** half of the Report at launch
(it needs no users). Add the citizen-opinion half when the verified base makes
the numbers meaningful. The audit/"gap" feature is the long-term §9.2 payoff.

---

## 7. Gaps & risks (eyes open)

These are adoption/representativeness risks, not feasibility risks — the build is
the easy part. Listed so they're designed-against, not discovered late.

1. **Consumption product must be genuinely differentiated, not just prettier.**
   "Bills with AI summaries" already exists (Congress.gov, GovTrack). The wedge
   is the *unique* combination: complete cross-branch record + neutral extraction
   register + cross-spectrum news threshold feed + the weekly Report. If a reader
   can't say why GenPop beats GovTrack-plus-their-news-app, the launch fails on
   positioning. Test cheaply: do unverified readers *return to read*? If retention
   among non-political-junkies is near zero, no clean code saves it.
2. **The leap to participation.** (See §0's pre-committed trigger.) The danger is
   getting comfortable as a pure info product and never building the moat.
3. **Representativeness of the data business.** A self-selected, ID-verified,
   fee-paying panel is *not* a representative electorate sample, and sophisticated
   buyers know opt-in panels are biased. "Verified" fixes per-respondent integrity,
   not sampling bias. Be honest with buyers; lean on direct-vs-delegated filtering
   (Plan §3.6) as a real feature, not a fix for the underlying sampling reality.
4. **AI neutrality is load-bearing** now that it's the front door — hence §4's
   architecture. This risk is mitigated by design, not eliminated.
5. **Moderation & legal exposure** of anonymous-but-real-identity political speech
   (defamation, harassment, subpoena/deanonymization pressure). Plan §8 covers the
   regulatory regimes; budget counsel from day one. Lower at launch because the
   free tier generates no UGC and the verified base starts small.
6. **Single-founder operational load** across many vendors and regimes. Sequencing
   consumption-first deliberately minimizes how much of this is live at launch
   (no payments, no payouts, no B2B, minimal moderation surface).

---

## 8. Build order (work through in Cursor sequentially)

**Phase 0 — Skeleton (day 1)**
- `create-next-app` (TS, App Router, Tailwind). Port Civic Slate tokens.
- Supabase project + CLI init; apply `schema.sql` as the first migration.
- `.env.example` checked in; envs set in Vercel from the start. Add `/api/health`
  asserting required env presence + DB connectivity (replaces v1 diagnostics).

**Phase 1 — The government-action record (the wedge — build this first)**
- `cards` table + ingestion cron routes: Congress.gov, Federal Register,
  CourtListener (federal, all three branches). Then LegiScan/OpenStates for
  state legislation.
- Feed page: filters (branch/sphere), one `Card` component with per-type render
  branches, detail page per card, coverage-status surface (§3a).
- This phase alone is a shippable, useful, unique read-only product.

**Phase 2 — AI Insight (neutrality architecture, §4)**
- Fixed extraction schema, objective register, source-alongside-summary,
  provenance, determinism, cached in `card_ai`, correction-log scaffold.

**Phase 3 — News threshold feed (§3.4)**
- Cross-spectrum outlet list, RSS fetch, clustering, threshold promotion, audit
  trail on the card.

**Phase 4 — The GenPop Report, v1 (§6, government-action half)**
- `reports` table, weekly cron assembling the cross-branch digest, public
  `/report` route + archive. Works with zero users — ship it early as a growth
  and credibility artifact.

> Phases 1–4 are the complete **free consumption product**. It can launch here
> and start earning readership before any participation code exists. Measure the
> §7.1 retention test before proceeding.

**Phase 5 — Identity (the part v1 got wrong; do it slowly)**
- Supabase email auth, single `/onboarding` funnel, no modal path.
- Didit v3: create-session → hosted flow → webhook finalization (HMAC verify,
  timestamp window) → persist `verified_identities` (+ optional
  `user_demographics`). Nullifier-hash dedup → recovery on collision.
- Write-gating via RLS (`is_verified()`); reads stay public. No client wrapper.
- **Verification launches free** (founder window); fee turns on at the
  pre-decided trigger (§0).
- Acceptance test before moving on: fresh email → verified → react, on a clean
  browser profile *and* mobile Safari.

**Phase 6 — Reactions + consensus**
- `card_reactions` upsert on `(user_id, card_id)`, optimistic UI, consensus bar,
  conviction toggle, react-to-unlock. AI Outlook (§3.5) with caching.

**Phase 7 — Card discussion**
- Takes + one-level replies + votes, ordinal anonymous labels, daily handles.
- Wire the citizen-opinion half of the GenPop Report (§6) now that reactions
  exist.

**Phase 8 — The Forum (§5)**
- `posts` + `post_votes`, Gemini relevance/moderation/tagging gate, topic tagging
  on cards too. Latest + Trending + For-You feeds; `user_topic_affinity` cron;
  −5 auto-hide; optional card-attachment chip.

**Phase 9 — Shell polish + invite + locked Earn teaser**
- Mobile chrome, dark/light, invite panel, feedback drawer. "Earn unlocks at
  10,000 verified users" teaser (Plan §4.4) — the locked page as acquisition
  mechanic; the real Earn build is a later condition-gated milestone.

**Phase 10 — Deploy hardening**
- Write-endpoint rate limiting, Didit webhook replay protection, RLS audit
  (every table, default deny), observability, OG metadata, privacy/ToS stubs
  (Plan §8 needs counsel-reviewed text before real launch).

### Condition-gated later milestones (not dated)
- **M-Earn:** consumer surveys + points ledger + redemption (Tremendous). Gated
  at 10k verified + enterprise demand.
- **M-B2B:** dashboard + Stripe tiers + small-cell-suppressed result sets.
- **M-Delegation:** Delegated Reactions (Plan §3.6) — needs the credentialing
  vendor decision first; reuses `user_topic_affinity`.
- **M-Audit:** the GenPop Report "gap" feature (Plan §9.2).

---

## 9. Free-tier budget sanity check

- Supabase free (500MB / 50k MAU) — fine through seed (10k users).
- Vercel Hobby cron is limited (2 jobs, daily granularity). For minute-level
  ingestion before upgrading: one fan-out cron route, or a GitHub Actions
  schedule hitting routes with `CRON_SECRET`.
- Congress.gov 5k/hr, Federal Register unmetered, CourtListener free, LegiScan
  30k/mo — all above hourly ingestion needs.
- Gemini free tier — fine with aggressive caching (Insight/Outlook/Report all
  cached). Forum adds one small classify call per post; add a per-day generation
  cap as a safety valve and batch polarization passes.
- Didit free plan covers core ID verification; the $5 fee is layered on later via
  Stripe at the trigger — don't build fee payment at launch.

> Verify every API's current free-tier terms on first contact — limits and
> endpoints change; don't trust numbers in this doc over the provider's signup
> page.

---

## 10. Repo conventions

See `.cursorrules` at repo root — it encodes these decisions so Cursor's agent
doesn't reintroduce v1 patterns (mock layers, second auth path, standing/ranking,
off-topic forum tags, stance-based personalization, etc.).
