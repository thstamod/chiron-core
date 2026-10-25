create table public.financial_derived_metrics (
  id uuid primary key default gen_random_uuid(),
  earnings_event_id uuid not null references public.earnings_events(id),
  metric_code text not null,
  value_numeric numeric not null,
  unit text not null,
  calculation_expression text not null,
  calculation_version text not null,
  input_sha256 text not null,
  input_metrics jsonb not null check (jsonb_typeof(input_metrics) = 'array'),
  created_at timestamptz not null default now(),
  unique (earnings_event_id, calculation_version, input_sha256, metric_code)
);

create table public.financial_derived_metric_calculations (
  id uuid primary key default gen_random_uuid(),
  earnings_event_id uuid not null references public.earnings_events(id),
  calculation_version text not null,
  input_sha256 text not null,
  input_manifest jsonb not null check (jsonb_typeof(input_manifest) = 'object'),
  metric_count integer not null check (metric_count >= 0),
  warnings jsonb not null default '[]'::jsonb check (jsonb_typeof(warnings) = 'array'),
  output_sha256 text not null,
  created_at timestamptz not null default now(),
  unique (earnings_event_id, calculation_version, input_sha256)
);

create index financial_derived_metrics_event_created_idx
  on public.financial_derived_metrics (earnings_event_id, created_at desc);

create index financial_derived_metric_calculations_event_created_idx
  on public.financial_derived_metric_calculations (earnings_event_id, created_at desc);

alter table public.financial_derived_metrics enable row level security;
alter table public.financial_derived_metric_calculations enable row level security;

comment on table public.financial_derived_metrics is
  'Versioned standard calculations derived from immutable SEC financial metric rows.';

comment on column public.financial_derived_metrics.input_metrics is
  'Exact financial metric row IDs and values used by the calculation.';

comment on table public.financial_derived_metric_calculations is
  'Completion records and input manifests for reproducible financial calculations.';
