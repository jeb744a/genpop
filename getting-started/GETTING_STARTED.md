# GenPop — Getting Started (Cursor + Cowork)

Your tools, divided by job:
- **Cursor + Claude Code** → writes and runs the app. The codebase lives here.
- **Cowork (Claude desktop)** → research, data-source recon, config compilation,
  and document drafting that *feeds* the build. Never edits app source while
  Cursor is working in it.

Work the phases in `REBUILD_PLAN.md` §8 in order. Below is how to actually
start — the first concrete moves, not a re-description of the plan.

---

## Step 0 — Set up the folder both tools share

1. Create the project folder, e.g. `~/code/genpop`.
2. Drop these files in at the root:
   - `REBUILD_PLAN.md`
   - `schema.sql`
   - `.env.example`
   - `cursorrules.txt` → **rename to `.cursorrules`**
   - this `getting-started/` folder
3. Open the folder in Cursor. Open the *same* folder in Cowork (point Cowork at
   `~/code/genpop`, or at a `~/code/genpop/docs` subfolder if you'd rather keep
   Cowork out of the source tree).

Rule of thumb: Cowork lives in docs/config; Cursor lives in app source. Don't
have both editing the same file at once.

---

## Step 1 — Cowork first (unblocks everything): the data-source reference

Before writing ingestion code, you need the real endpoints and limits. Paste
`getting-started/COWORK_TASK_data_sources.md` into Cowork. It returns a
`DATA_SOURCES.md` you'll feed Cursor in Phase 1.

Do this first because it's tedious in a code editor and natural for an agent,
and because the plan tells you to verify every API's free-tier terms on first
contact rather than trust numbers in the plan.

While Cowork runs, go get the free keys yourself (you'll need them regardless):
- Congress.gov key: https://api.congress.gov/sign-up/
- CourtListener token: https://www.courtlistener.com/help/api/
- LegiScan or OpenStates key (whichever Cowork recommends)
- Federal Register + Google News RSS: no key needed
Put them in `.env.local` (copy from `.env.example`).

---

## Step 2 — Cursor: Phase 0 skeleton

Give Claude Code this as the task (it has your `.cursorrules` for guardrails):

> Scaffold a Next.js 15 app (App Router, TypeScript, Tailwind v4) in this
> folder. Add the Supabase JS client (`@supabase/supabase-js`,
> `@supabase/ssr`) with separate browser and server client helpers in
> `app/lib/supabase/`. Add `@google/generative-ai`. Create an `/api/health`
> route that asserts the required env vars are present and does a trivial
> Supabase query, returning `{ ok, checks }`. Port the Civic Slate theme tokens
> into `globals.css` with a `data-theme` attribute and a ThemeProvider. Do NOT
> build auth, cards, or any feature yet — skeleton only.

Then set up Supabase yourself:
1. Create a project at supabase.com (free tier).
2. `npx supabase init`, then `npx supabase login` and `npx supabase link`.
3. `npx supabase migration new init`, paste `schema.sql` into the generated
   file, then `npx supabase db push`.
4. Copy the project URL + anon key + service role key into `.env.local`.
5. Hit `/api/health` — green means env + DB are wired before you build anything
   on top. (This is the check whose absence caused v1's auth pain.)

---

## Step 3 — Cursor: Phase 1, the government-action record (the wedge)

This is the first real feature and the whole launch rests on it. Feed Claude
Code your `DATA_SOURCES.md` plus this task, one source at a time (don't ask for
all four ingestion routes in one prompt — build and verify Congress first):

> Using DATA_SOURCES.md, build the federal legislation ingestion route at
> `app/api/ingest/congress/route.ts`. It should: require the CRON_SECRET header,
> fetch recent bills + their detail/actions/sponsors/summary from Congress.gov,
> map each to a row in the `cards` table (card_type='legislative',
> sphere='federal'), and upsert on (source, external_id) where source='congress'
> and external_id is the bill id. Write an idempotency entry to job_log. Keep
> business logic in `app/lib/ingest/congress.ts`; the route is thin. No mock
> data — if the API fails, log and return the error.

Verify it writes real rows to `cards`, then repeat the pattern for Federal
Register, then CourtListener, then state legislation. Only after data is
flowing, build the read side:

> Build the feed page reading ONLY from the `cards` table (never call upstream
> APIs at request time). One `Card` component with per-type render branches
> (legislative/executive/judicial). Add a card detail page and the
> coverage-status surface from REBUILD_PLAN §3a.

At the end of Step 3 you have a shippable, useful, unique read-only product —
real government data, no auth, no mocks. That's the milestone to stop and look at.

---

## Step 4 — keep going by the plan

Phases 2–4 (AI Insight, news threshold feed, the GenPop Report v1) finish the
free consumption product. Only then does Phase 5 (identity) begin — and that's
the one to build slowly, with the mobile-Safari acceptance test from the plan
before moving on.

Use Cowork along the way for the non-code pieces as they come up:
- the cross-spectrum outlet list (already in the Step 1 brief)
- privacy policy / ToS stub drafts (Phase 10)
- GenPop Report format drafts (Phase 4)
- keeping REBUILD_PLAN / schema notes current as decisions change

---

## Two cautions

1. **Feed the agent the plan, not just the task.** Both tools do better work
   when you paste the relevant REBUILD_PLAN section into the prompt. The
   `.cursorrules` enforces invariants passively; the section gives intent.
2. **Don't let Cowork run unattended pipelines over live web content with
   write access** — the news ingestion is a prompt-injection surface. Use Cowork
   to research and draft (you review the output); let the *app code* in Cursor
   do the actual automated fetching, where it's sandboxed and reviewable.
