-- GenPop v2 — consolidated initial schema
-- Apply as the first Supabase CLI migration:
--   supabase migration new init  →  paste this file  →  supabase db push
--
-- Design rules baked in here:
--   * Default-deny RLS on every table; explicit policies only.
--   * Reads are public (free tier); writes require an approved verification.
--   * No PII ever: no names, no plaintext document numbers, no emails outside auth.
--   * One `cards` table feeds the entire UI; ingestion jobs upsert into it.
--   * Balances are derived from the append-only points ledger, never stored.

-- ============================================================
-- Helpers
-- ============================================================

create extension if not exists pgcrypto;

-- True when the calling user has an approved identity verification.
create or replace function public.is_verified()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from verified_identities
    where user_id = auth.uid() and status = 'approved'
  );
$$;

-- ============================================================
-- Identity & demographics
-- ============================================================

create type verification_status as enum
  ('approved','in_progress','in_review','declined','abandoned','expired');
create type verification_provider as enum ('didit','nfc');

create table verified_identities (
  user_id uuid primary key references auth.users(id) on delete cascade,
  nullifier_hash text not null unique,        -- HMAC-SHA256(doc#, NULLIFIER_SALT)
  status verification_status not null default 'in_progress',
  provider verification_provider not null default 'didit',
  provider_session_id text,
  approved_at timestamptz,
  failure_reason text,
  created_at timestamptz not null default now()
);

create table user_demographics (
  user_id uuid primary key references auth.users(id) on delete cascade,
  age_cohort text,          -- '18-24' | '25-34' | '35-44' | '45-54' | '55-64' | '65+'
  region text,              -- US state code or ISO country
  sector text,
  income_bracket text,
  education text,
  ethnicity text[],
  sex text,
  political_affiliation text,
  updated_at timestamptz not null default now()
);

alter table verified_identities enable row level security;
alter table user_demographics enable row level security;

-- Verification rows are written only by the service role (webhook/API);
-- users may read their own status.
create policy "read own verification" on verified_identities
  for select using (auth.uid() = user_id);

create policy "read own demographics" on user_demographics
  for select using (auth.uid() = user_id);
create policy "upsert own demographics" on user_demographics
  for insert with check (auth.uid() = user_id);
create policy "update own demographics" on user_demographics
  for update using (auth.uid() = user_id);

-- ============================================================
-- Cards (single source of truth for the feed)
-- ============================================================

create type card_type as enum ('legislative','executive','judicial','live');
create type sphere as enum ('federal','state','city');

create table cards (
  id uuid primary key default gen_random_uuid(),
  card_type card_type not null,
  sphere sphere not null default 'federal',
  source text not null,              -- 'congress' | 'fedreg' | 'courtlistener' | 'news'
  external_id text not null,         -- bill id / EO doc number / docket id / cluster id
  title text not null,
  summary text,                      -- short source-provided summary (not AI)
  status text,                       -- e.g. 'PENDING','PASSED','ARGUED','DECIDED'
  region text,                       -- state code when sphere='state'
  occurred_at timestamptz,           -- introduced / signed / argued / published
  last_action_at timestamptz,
  source_url text,
  raw jsonb not null default '{}',   -- full upstream payload
  topics text[] not null default '{}', -- shared policy-topic taxonomy (set at ingestion)
  news_audit jsonb,                  -- live cards: {outlets:[...], cleared_at} (Plan §3.2)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source, external_id)
);
create index cards_feed_idx on cards (card_type, sphere, last_action_at desc);

-- Cached AI layers per card (Plan §3.3)
create type ai_kind as enum ('insight','outlook');
create table card_ai (
  card_id uuid not null references cards(id) on delete cascade,
  kind ai_kind not null,
  content text not null,
  input_hash text not null,          -- hash of inputs; regenerate when stale
  generated_at timestamptz not null default now(),
  primary key (card_id, kind)
);

alter table cards enable row level security;
alter table card_ai enable row level security;
create policy "cards are public" on cards for select using (true);
create policy "card_ai is public" on card_ai for select using (true);
-- writes: service role only (ingestion jobs / AI cache)

-- ============================================================
-- Reactions (Plan §3.4 structured reactions)
-- ============================================================

-- Valid responses per card_type are enforced in app code (reactionConfig):
--  legislative: yes | needs_amendment | no
--  executive:   right_call | needs_clarification | wrong_call
--  judicial:    fair | too_early | unfair
--  live:        under_control | developing | out_of_control
create table card_reactions (
  user_id uuid not null references auth.users(id) on delete cascade,
  card_id uuid not null references cards(id) on delete cascade,
  response text not null,
  is_strong boolean not null default false,   -- conviction toggle
  is_delegated boolean not null default false, -- future: Delegated Reactions (Plan §3.6)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, card_id)
);
create index card_reactions_card_idx on card_reactions (card_id);

alter table card_reactions enable row level security;
create policy "read reactions" on card_reactions for select using (true);
create policy "verified users react" on card_reactions
  for insert with check (auth.uid() = user_id and public.is_verified());
create policy "update own reaction" on card_reactions
  for update using (auth.uid() = user_id);

-- ============================================================
-- Discussion: takes + replies, scoped to cards only (no standalone forum)
-- ============================================================

create table takes (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references cards(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  parent_id uuid references takes(id) on delete cascade,  -- null = top-level; one nesting level enforced in app
  content text not null check (char_length(content) between 70 and 280),
  created_at timestamptz not null default now()
);
create index takes_card_idx on takes (card_id, created_at);

create table take_votes (
  take_id uuid not null references takes(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  value smallint not null check (value in (-1, 1)),
  created_at timestamptz not null default now(),
  primary key (take_id, user_id)
);

alter table takes enable row level security;
alter table take_votes enable row level security;
create policy "read takes" on takes for select using (true);
create policy "verified users post takes" on takes
  for insert with check (auth.uid() = user_id and public.is_verified());
create policy "delete own take" on takes
  for delete using (auth.uid() = user_id);
create policy "read votes" on take_votes for select using (true);
create policy "verified users vote" on take_votes
  for insert with check (auth.uid() = user_id and public.is_verified());
create policy "change own vote" on take_votes
  for update using (auth.uid() = user_id);

-- ============================================================
-- Saved cards
-- ============================================================

create table saved_cards (
  user_id uuid not null references auth.users(id) on delete cascade,
  card_id uuid not null references cards(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, card_id)
);
alter table saved_cards enable row level security;
create policy "own saved cards" on saved_cards
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ============================================================
-- The Forum (REBUILD_PLAN §4a) — standalone anonymous political posting
-- ============================================================

create type post_status as enum ('live','reduced','hidden','removed');
-- 'reduced'  = published but distribution-limited (borderline AI gate result)
-- 'hidden'   = community auto-hide at net -5 votes (appealable)
-- 'removed'  = moderation removal

create table posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  parent_id uuid references posts(id) on delete cascade, -- null = top-level; one nesting level enforced in app
  card_id uuid references cards(id) on delete set null,  -- optional card attachment
  content text not null check (char_length(content) between 1 and 280),
  topics text[] not null default '{}',     -- Gemini-tagged, same taxonomy as cards.topics
  region text,                              -- poster's bucketed state at post time (for locality boost)
  status post_status not null default 'live',
  -- denormalized counters + cron-computed ranking score (service role writes)
  upvotes integer not null default 0,
  downvotes integer not null default 0,
  reply_count integer not null default 0,
  hot_score real not null default 0,
  created_at timestamptz not null default now()
);
create index posts_latest_idx on posts (created_at desc) where parent_id is null and status = 'live';
create index posts_trending_idx on posts (hot_score desc) where parent_id is null and status in ('live');
create index posts_topics_idx on posts using gin (topics);
create index posts_parent_idx on posts (parent_id);

create table post_votes (
  post_id uuid not null references posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  value smallint not null check (value in (-1, 1)),
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

alter table posts enable row level security;
alter table post_votes enable row level security;
create policy "read visible posts" on posts
  for select using (status in ('live','reduced') or auth.uid() = user_id);
create policy "verified users post" on posts
  for insert with check (auth.uid() = user_id and public.is_verified());
create policy "delete own post" on posts
  for delete using (auth.uid() = user_id);
create policy "read post votes" on post_votes for select using (true);
create policy "verified users vote on posts" on post_votes
  for insert with check (auth.uid() = user_id and public.is_verified());
create policy "change own post vote" on post_votes
  for update using (auth.uid() = user_id);
-- status transitions, counters, hot_score: service role only (cron/triggers)

-- Topic affinity for the For-You feed (and later: survey targeting, delegate
-- matching). HARD RULE: scores are built ONLY from engagement *volume* per
-- topic (reactions cast, takes/replies written, saves, votes given) —
-- NEVER from the direction/stance of any reaction or vote.
create table user_topic_affinity (
  user_id uuid not null references auth.users(id) on delete cascade,
  topic text not null,
  score real not null default 0,            -- exponentially decayed by cron
  updated_at timestamptz not null default now(),
  primary key (user_id, topic)
);
alter table user_topic_affinity enable row level security;
create policy "read own affinity" on user_topic_affinity
  for select using (auth.uid() = user_id);
-- writes: service role only (affinity cron)

-- ============================================================
-- Points ledger — DEFERRED to the Earn milestone (no points economy at launch).
-- When built, it is append-only and balances are derived (SUM of delta);
-- never store a balance column. Entry types will include:
--   verify_bonus, daily_login, take_upvote_bonus, post_upvote_bonus,
--   survey_flat, survey_merit, referral, redeemed, adjustment
-- Created in a later migration alongside surveys/payouts. Not here.
-- ============================================================

-- ============================================================
-- The GenPop Report (REBUILD_PLAN §6) — weekly published digest
-- ============================================================

create type report_status as enum ('draft','published');

create table reports (
  id uuid primary key default gen_random_uuid(),
  period_start date not null,
  period_end date not null,
  status report_status not null default 'draft',
  -- generated content (neutral register, same discipline as AI Insight)
  gov_action_digest text,        -- "what government did this week" (works at N=0 users)
  opinion_digest text,           -- "what citizens thought" (null until verified base supports it)
  -- reproducibility / audit: snapshot of the inputs this issue was built from
  input_snapshot jsonb not null default '{}',
  card_ids uuid[] not null default '{}',   -- cards featured this issue
  generated_at timestamptz,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  unique (period_start, period_end)
);
create index reports_published_idx on reports (published_at desc) where status = 'published';

alter table reports enable row level security;
create policy "published reports are public" on reports
  for select using (status = 'published');
-- generation/publishing: service role only (weekly cron)

-- ============================================================
-- Job idempotency log (cron-driven jobs, no Redis)
-- ============================================================

create table job_log (
  job_key text primary key,               -- e.g. 'ingest:congress:2026-06-10T18'
  status text not null default 'done',
  detail jsonb,
  ran_at timestamptz not null default now()
);
alter table job_log enable row level security;  -- service role only

-- ============================================================
-- Feedback
-- ============================================================

create table feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  content text not null,
  created_at timestamptz not null default now()
);
alter table feedback enable row level security;
create policy "submit feedback" on feedback
  for insert with check (auth.uid() = user_id);

-- ============================================================
-- Deferred (create in later milestone migrations, not now):
--   points_ledger (Earn milestone), surveys, survey_discussion_posts,
--   survey_post_reactions, contribution_scores, survey_payouts,
--   company_profiles, survey_b2b_synthesis, delegations (Plan §3.6)
-- Note: NO standing/karma table at launch (cut per REBUILD_PLAN §1).
-- ============================================================
