alter table public.historical_reconstruction_plans
  drop constraint if exists historical_reconstruction_plans_source_manifest_sha256_key;

alter table public.extraction_runs
  add column extraction_purpose text not null default 'forward_prediction'
    check (extraction_purpose in ('forward_prediction', 'historical_reconstruction')),
  add column historical_reconstruction_plan_id uuid
    references public.historical_reconstruction_plans(id),
  add column source_availability_rule_version text not null
    default 'published-and-observed-by-chiron-v1'
    check (char_length(trim(source_availability_rule_version)) between 1 and 100),
  add constraint extraction_runs_purpose_shape
    check (
      (
        extraction_purpose = 'forward_prediction'
        and historical_reconstruction_plan_id is null
        and source_availability_rule_version = 'published-and-observed-by-chiron-v1'
      )
      or
      (
        extraction_purpose = 'historical_reconstruction'
        and historical_reconstruction_plan_id is not null
        and source_availability_rule_version = 'published-by-simulated-cutoff-v1'
      )
    );

create index extraction_runs_historical_plan_idx
  on public.extraction_runs (historical_reconstruction_plan_id, created_at desc)
  where historical_reconstruction_plan_id is not null;

create or replace function public.validate_extraction_run_research_context_insert()
returns trigger
language plpgsql
as $$
declare
  historical_plan public.historical_reconstruction_plans%rowtype;
  source_document jsonb;
begin
  if new.extraction_purpose = 'forward_prediction' then
    if jsonb_typeof(new.input_manifest -> 'documents') is distinct from 'array' then
      raise exception 'Forward qualitative extraction requires a source-document array';
    end if;
    if jsonb_array_length(new.input_manifest -> 'documents') = 0 then
      raise exception 'Forward qualitative extraction requires source documents';
    end if;

    for source_document in
      select value from jsonb_array_elements(new.input_manifest -> 'documents')
    loop
      if source_document ->> 'publishedAt' is null
        or source_document ->> 'firstSeenAt' is null then
        raise exception 'Forward qualitative extraction contains invalid source availability';
      end if;
      if (source_document ->> 'publishedAt')::timestamptz > new.cutoff_at
        or (source_document ->> 'firstSeenAt')::timestamptz > new.cutoff_at then
        raise exception 'Forward qualitative extraction uses a source unavailable at its cutoff';
      end if;
    end loop;

    return new;
  end if;

  select *
    into historical_plan
  from public.historical_reconstruction_plans
  where id = new.historical_reconstruction_plan_id;

  if historical_plan.id is null then
    raise exception 'Historical qualitative extraction plan does not exist';
  end if;

  if new.earnings_event_id <> historical_plan.earnings_event_id
    or new.cutoff_at <> historical_plan.simulated_cutoff_at
    or new.input_selection_version <> historical_plan.input_selection_version
    or new.source_availability_rule_version
      <> historical_plan.source_availability_rule_version
    or new.input_sha256 <> historical_plan.qualitative_input_sha256
    or new.input_manifest <> historical_plan.source_manifest then
    raise exception 'Historical qualitative extraction does not match its immutable plan';
  end if;

  return new;
end;
$$;

create trigger validate_extraction_run_research_context_before_insert
before insert on public.extraction_runs
for each row execute function public.validate_extraction_run_research_context_insert();

comment on column public.extraction_runs.extraction_purpose is
  'Separates genuine forward extraction from retrospective historical reconstruction.';

comment on column public.extraction_runs.historical_reconstruction_plan_id is
  'Immutable historical source plan that authorized this retrospective extraction attempt.';

comment on column public.extraction_runs.source_availability_rule_version is
  'Versioned publication and first-seen rule used to select the extraction documents.';
