-- AI Insight Phase 2: budget counter, flag/correction tables (SPEC_ai_insight.md §7–§8)

-- Daily Gemini usage counter per feature (atomic cap enforcement)
create table gemini_budget (
  day date not null,
  feature text not null,
  count int not null default 0,
  primary key (day, feature)
);

alter table gemini_budget enable row level security;
-- No public policies — service role only

-- Atomically increment budget; returns true if still under cap, false if at/over cap.
create or replace function public.try_increment_gemini_budget(
  p_day date,
  p_feature text,
  p_cap int
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  current_count int;
begin
  insert into gemini_budget (day, feature, count)
  values (p_day, p_feature, 1)
  on conflict (day, feature)
  do update set count = gemini_budget.count + 1
  returning count into current_count;

  if current_count > p_cap then
    -- Roll back the increment that exceeded the cap
    update gemini_budget
    set count = count - 1
    where day = p_day and feature = p_feature;
    return false;
  end if;

  return true;
end;
$$;

-- User flags on Insight accuracy/bias (SPEC §7)
create table insight_flags (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references cards(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  slot text not null,
  reason text not null,
  note text,
  status text not null default 'open'
    check (status in ('open', 'reviewing', 'upheld', 'rejected')),
  created_at timestamptz not null default now()
);

create index insight_flags_card_id_idx on insight_flags (card_id);
create index insight_flags_user_id_idx on insight_flags (user_id);

alter table insight_flags enable row level security;

create policy "insight_flags verified users insert"
  on insight_flags for insert
  with check (auth.uid() = user_id and public.is_verified());

create policy "insight_flags users read own"
  on insight_flags for select
  using (auth.uid() = user_id);

-- Public correction record (SPEC §7)
create table insight_corrections (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references cards(id) on delete cascade,
  slot text not null,
  before text not null,
  after text not null,
  rationale text not null,
  corrected_at timestamptz not null default now(),
  source_flag_id uuid references insight_flags(id) on delete set null
);

create index insight_corrections_card_id_idx on insight_corrections (card_id);

alter table insight_corrections enable row level security;

create policy "insight_corrections public read"
  on insight_corrections for select
  using (true);
