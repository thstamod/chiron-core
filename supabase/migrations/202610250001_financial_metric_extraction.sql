create table public.financial_metric_extractions (
  id uuid primary key default gen_random_uuid(),
  earnings_event_id uuid not null references public.earnings_events(id),
  source_document_id uuid not null references public.documents(id),
  extraction_version text not null,
  source_content_sha256 text not null,
  fiscal_year integer,
  fiscal_period text,
  metric_count integer not null check (metric_count >= 0),
  warnings jsonb not null default '[]'::jsonb check (jsonb_typeof(warnings) = 'array'),
  output_sha256 text not null,
  created_at timestamptz not null default now(),
  unique (source_document_id, extraction_version, source_content_sha256)
);

alter table public.financial_metrics
  add column extraction_version text not null,
  add column source_content_sha256 text not null,
  add column xbrl_concept text not null,
  add column xbrl_context_id text not null,
  add column source_text text not null,
  add column source_metadata jsonb not null default '{}'::jsonb;

create unique index financial_metrics_versioned_metric_idx
  on public.financial_metrics (
    source_document_id,
    extraction_version,
    source_content_sha256,
    metric_code
  );

create index financial_metric_extractions_event_created_idx
  on public.financial_metric_extractions (earnings_event_id, created_at desc);

alter table public.financial_metric_extractions enable row level security;

comment on table public.financial_metric_extractions is
  'Completion records for deterministic, versioned XBRL extraction from immutable SEC documents.';

comment on column public.financial_metric_extractions.output_sha256 is
  'Fingerprint of the canonical structured extraction output used to verify reproducibility.';

comment on column public.financial_metrics.source_text is
  'Exact text content of the inline XBRL fact selected as evidence.';

comment on column public.financial_metrics.source_metadata is
  'Inline XBRL attributes and context details needed to audit the normalized value.';
