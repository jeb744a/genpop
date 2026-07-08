-- LegiScan bill-text PDF cache (SPEC_legiscan_pdf.md §3) + low_quality gate

create type bill_text_status as enum (
  'ok',
  'image_only',
  'no_text_version',
  'too_large',
  'fetch_failed',
  'parse_failed',
  'low_quality'
);

create table bill_texts (
  doc_id         bigint primary key,
  card_id        uuid not null references cards(id) on delete cascade,
  text_hash      text not null,
  type_id        int not null,
  type           text,
  version_date   date,
  state_link     text,
  extracted_text text,
  char_count     int,
  page_count     int,
  status         bill_text_status not null,
  fetched_at     timestamptz not null default now()
);

create index bill_texts_card_idx on bill_texts (card_id);

alter table bill_texts enable row level security;
-- service role only (acquisition + Insight generator)
