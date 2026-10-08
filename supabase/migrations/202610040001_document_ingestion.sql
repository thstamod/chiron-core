alter table public.sec_filings
  add column earnings_classification jsonb not null default '{}'::jsonb;

create unique index documents_primary_filing_idx
  on public.documents (filing_id, document_type)
  where filing_id is not null and document_type = 'sec-primary-document';

comment on column public.sec_filings.earnings_classification is
  'Versioned deterministic classification explaining whether this filing is earnings-related.';
