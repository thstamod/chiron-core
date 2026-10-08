create table public.sec_filings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  accession_number text not null unique,
  form_type text not null,
  filing_date date not null,
  accepted_at timestamptz,
  first_seen_at timestamptz not null,
  report_date date,
  primary_document text not null,
  items text[] not null default '{}',
  sec_index_url text not null,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

alter table public.documents
  add column filing_id uuid references public.sec_filings(id);

create table public.job_runs (
  id uuid primary key default gen_random_uuid(),
  job_name text not null,
  status text not null check (status in ('running', 'succeeded', 'failed')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  error_summary text,
  details jsonb not null default '{}'
);

create index sec_filings_company_date_idx
  on public.sec_filings (company_id, filing_date desc);

create index sec_filings_form_date_idx
  on public.sec_filings (form_type, filing_date desc);

create index documents_filing_idx
  on public.documents (filing_id);

alter table public.sec_filings enable row level security;
alter table public.job_runs enable row level security;

insert into public.companies (cik, legal_name, ticker, exchange, sector)
values
  ('0000789019', 'Microsoft Corporation', 'MSFT', 'NASDAQ', 'Technology'),
  ('0000320193', 'Apple Inc.', 'AAPL', 'NASDAQ', 'Technology'),
  ('0001018724', 'Amazon.com, Inc.', 'AMZN', 'NASDAQ', 'Consumer'),
  ('0001652044', 'Alphabet Inc.', 'GOOGL', 'NASDAQ', 'Communication Services'),
  ('0001326801', 'Meta Platforms, Inc.', 'META', 'NASDAQ', 'Communication Services')
on conflict (cik) do update set
  legal_name = excluded.legal_name,
  ticker = excluded.ticker,
  exchange = excluded.exchange,
  sector = excluded.sector,
  is_active = true;

insert into storage.buckets (id, name, public, file_size_limit)
values ('sec-documents', 'sec-documents', false, 52428800)
on conflict (id) do update set
  public = false,
  file_size_limit = 52428800;

comment on table public.sec_filings is 'Point-in-time SEC filing metadata discovered by the Chiron worker.';
comment on table public.job_runs is 'Operational history for scheduled ingestion and evaluation jobs.';
