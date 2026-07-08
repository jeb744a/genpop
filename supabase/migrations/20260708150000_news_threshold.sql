-- News threshold feed staging tables (SPEC_news_threshold.md §4.3)

create table news_items (
  identity_key  text primary key,
  outlet_id     text not null,
  title         text not null,
  description   text,
  url           text not null,
  published_at  timestamptz,
  first_seen_at timestamptz not null default now(),
  cluster_key   text,
  via_wire      text,
  creator       text
);
create index news_items_cluster_idx on news_items (cluster_key);
create index news_items_outlet_idx on news_items (outlet_id);
create index news_items_first_seen_idx on news_items (first_seen_at);

alter table news_items enable row level security;
-- service role only

create table news_clusters (
  cluster_key      text primary key,
  seed_identity    text not null references news_items(identity_key),
  first_seen_at    timestamptz not null,
  status           text not null default 'open'
    check (status in ('open', 'promoted', 'expired', 'closed')),
  promoted_card_id uuid references cards(id) on delete set null,
  last_item_at     timestamptz not null,
  cleared_at       timestamptz
);
create index news_clusters_status_idx on news_clusters (status);
create index news_clusters_first_seen_idx on news_clusters (first_seen_at);

alter table news_clusters enable row level security;
-- service role only

create table news_feed_state (
  outlet_id         text primary key,
  feed_url          text not null,
  etag              text,
  last_modified     text,
  last_status       int,
  consecutive_fails int not null default 0,
  last_fetched_at   timestamptz,
  last_ok_at        timestamptz,
  updated_at        timestamptz not null default now()
);

alter table news_feed_state enable row level security;
-- service role only

-- Soak-week pair log (SPEC §3.2) — droppable after tuning
create table news_cluster_pairs_log (
  id          bigserial primary key,
  identity_a  text not null,
  identity_b  text not null,
  title_a     text,
  title_b     text,
  sim         real not null,
  joined      boolean not null,
  cluster_key text,
  logged_at   timestamptz not null default now()
);
create index news_cluster_pairs_log_sim_idx on news_cluster_pairs_log (sim);
create index news_cluster_pairs_log_logged_idx on news_cluster_pairs_log (logged_at);

alter table news_cluster_pairs_log enable row level security;
-- service role only
