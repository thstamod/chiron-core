create extension if not exists pgcrypto;

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  cik text not null unique,
  legal_name text not null,
  ticker text not null,
  exchange text,
  sector text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.earnings_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  fiscal_year integer not null,
  fiscal_quarter integer check (fiscal_quarter between 1 and 4),
  period_end date not null,
  detected_at timestamptz not null,
  status text not null default 'detected' check (status in ('detected', 'processed', 'predicted', 'evaluated')),
  previous_event_id uuid references public.earnings_events(id),
  created_at timestamptz not null default now(),
  unique (company_id, period_end)
);

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  earnings_event_id uuid references public.earnings_events(id),
  accession_number text,
  document_type text not null,
  source_url text not null,
  storage_path text not null,
  published_at timestamptz not null,
  first_seen_at timestamptz not null,
  content_sha256 text not null,
  created_at timestamptz not null default now(),
  unique (content_sha256)
);

create table public.financial_metrics (
  id uuid primary key default gen_random_uuid(),
  earnings_event_id uuid not null references public.earnings_events(id),
  metric_code text not null,
  value_numeric numeric not null,
  unit text not null,
  accounting_basis text not null default 'unknown' check (accounting_basis in ('gaap', 'non_gaap', 'unknown')),
  period_start date,
  period_end date not null,
  source_document_id uuid not null references public.documents(id),
  source_location text,
  created_at timestamptz not null default now()
);

create table public.extraction_runs (
  id uuid primary key default gen_random_uuid(),
  earnings_event_id uuid not null references public.earnings_events(id),
  cutoff_at timestamptz not null,
  schema_version text not null,
  prompt_version text not null,
  model_name text not null,
  input_manifest jsonb not null,
  output jsonb not null,
  output_sha256 text not null,
  validation_status text not null check (validation_status in ('valid', 'invalid', 'needs_review')),
  created_at timestamptz not null default now()
);

create table public.predictions (
  id uuid primary key default gen_random_uuid(),
  earnings_event_id uuid not null references public.earnings_events(id),
  extraction_run_id uuid references public.extraction_runs(id),
  cutoff_at timestamptz not null,
  score smallint not null check (score between -5 and 5),
  score_components jsonb not null,
  rule_version text not null,
  snapshot jsonb not null,
  snapshot_sha256 text not null unique,
  planned_entry_session date not null,
  created_at timestamptz not null default now()
);

create table public.evaluations (
  id uuid primary key default gen_random_uuid(),
  prediction_id uuid not null references public.predictions(id),
  horizon_days smallint not null check (horizon_days in (1, 5, 20)),
  entry_price numeric not null check (entry_price > 0),
  stock_return numeric not null,
  market_return numeric not null,
  sector_return numeric,
  calculated_at timestamptz not null default now(),
  methodology_version text not null,
  unique (prediction_id, horizon_days, methodology_version)
);

create index earnings_events_company_period_idx on public.earnings_events (company_id, period_end desc);
create index documents_event_published_idx on public.documents (earnings_event_id, published_at);
create index financial_metrics_event_code_idx on public.financial_metrics (earnings_event_id, metric_code);
create index predictions_event_created_idx on public.predictions (earnings_event_id, created_at desc);

alter table public.companies enable row level security;
alter table public.earnings_events enable row level security;
alter table public.documents enable row level security;
alter table public.financial_metrics enable row level security;
alter table public.extraction_runs enable row level security;
alter table public.predictions enable row level security;
alter table public.evaluations enable row level security;

comment on schema public is 'No publishable-key policies are created in phase 1. Browser access is denied by default.';
comment on table public.predictions is 'Append-only prediction snapshots. Update/delete protection is added with the prediction phase.';
