alter table public.earnings_events
  alter column period_end drop not null;

alter table public.earnings_events
  add column origin_filing_id uuid references public.sec_filings(id);

create unique index earnings_events_origin_filing_idx
  on public.earnings_events (origin_filing_id)
  where origin_filing_id is not null;

alter table public.earnings_events
  drop constraint earnings_events_status_check;

alter table public.earnings_events
  add constraint earnings_events_status_check
  check (status in (
    'grouping_pending',
    'provisional',
    'detected',
    'processed',
    'predicted',
    'evaluated'
  ));

comment on column public.earnings_events.origin_filing_id is
  'The first SEC filing that created this event; preserved when a provisional event is confirmed.';
