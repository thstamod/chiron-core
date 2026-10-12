alter table public.earnings_events
  alter column fiscal_year drop not null;

alter table public.earnings_events
  add column grouping_metadata jsonb not null default '{}'::jsonb;

alter table public.sec_filings
  add column earnings_event_id uuid references public.earnings_events(id),
  add column exhibit_discovery jsonb not null default '{}'::jsonb;

create index sec_filings_event_idx
  on public.sec_filings (earnings_event_id);

create unique index documents_filing_source_idx
  on public.documents (filing_id, source_url)
  where filing_id is not null;

comment on column public.earnings_events.grouping_metadata is
  'Versioned deterministic rule output describing which SEC filings form this event.';

comment on column public.sec_filings.exhibit_discovery is
  'Versioned record of the SEC filing-index scan for earnings-release exhibits.';
