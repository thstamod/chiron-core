create table public.extraction_reviews (
  id uuid primary key default gen_random_uuid(),
  extraction_run_id uuid not null references public.extraction_runs(id),
  decision text not null check (decision in ('accepted', 'corrected', 'rejected')),
  reviewed_output_sha256 text not null
    check (reviewed_output_sha256 ~ '^[0-9a-f]{64}$'),
  corrected_output jsonb,
  corrected_schema_version text
    check (
      corrected_schema_version is null
      or char_length(trim(corrected_schema_version)) between 1 and 100
    ),
  corrected_output_sha256 text
    check (
      corrected_output_sha256 is null
      or corrected_output_sha256 ~ '^[0-9a-f]{64}$'
    ),
  corrected_located_evidence jsonb,
  reviewer_label text not null
    check (char_length(trim(reviewer_label)) between 1 and 100),
  notes text not null
    check (char_length(trim(notes)) between 1 and 4000),
  review_version text not null
    check (char_length(trim(review_version)) between 1 and 100),
  created_at timestamptz not null default now(),
  check (
    (
      decision = 'corrected'
      and corrected_output is not null
      and corrected_schema_version is not null
      and corrected_output_sha256 is not null
      and corrected_located_evidence is not null
    )
    or
    (
      decision in ('accepted', 'rejected')
      and corrected_output is null
      and corrected_schema_version is null
      and corrected_output_sha256 is null
      and corrected_located_evidence is null
    )
  )
);

create index extraction_reviews_run_created_idx
  on public.extraction_reviews (extraction_run_id, created_at desc, id desc);

create or replace function public.validate_extraction_review_insert()
returns trigger
language plpgsql
as $$
declare
  source_provider_status text;
  source_validation_status text;
  source_output_sha256 text;
begin
  select provider_status, validation_status, output_sha256
    into source_provider_status, source_validation_status, source_output_sha256
  from public.extraction_runs
  where id = new.extraction_run_id;

  if source_provider_status <> 'completed' or source_output_sha256 is null then
    raise exception 'Only completed extraction output can be reviewed';
  end if;

  if new.reviewed_output_sha256 <> source_output_sha256 then
    raise exception 'Review output fingerprint does not match the extraction run';
  end if;

  if new.decision = 'accepted' and source_validation_status <> 'valid' then
    raise exception 'Only locally valid extraction output can be accepted';
  end if;

  return new;
end;
$$;

create trigger validate_extraction_review_before_insert
before insert on public.extraction_reviews
for each row execute function public.validate_extraction_review_insert();

create or replace function public.prevent_extraction_review_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'extraction_reviews rows are append-only';
end;
$$;

create trigger prevent_extraction_review_update
before update on public.extraction_reviews
for each row execute function public.prevent_extraction_review_mutation();

create trigger prevent_extraction_review_delete
before delete on public.extraction_reviews
for each row execute function public.prevent_extraction_review_mutation();

alter table public.extraction_reviews enable row level security;

comment on table public.extraction_reviews is
  'Append-only human review decisions for immutable qualitative extraction output.';

comment on column public.extraction_reviews.reviewed_output_sha256 is
  'Fingerprint proving which immutable extraction output the reviewer inspected.';

comment on column public.extraction_reviews.corrected_output is
  'Complete human-corrected qualitative output when the decision is corrected.';

comment on column public.extraction_reviews.corrected_located_evidence is
  'Exact source locations derived after validating a corrected qualitative output.';
