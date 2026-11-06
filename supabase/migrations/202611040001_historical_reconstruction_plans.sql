create table public.historical_reconstruction_plans (
  id uuid primary key default gen_random_uuid(),
  earnings_event_id uuid not null references public.earnings_events(id),
  simulated_cutoff_at timestamptz not null,
  reconstruction_mode text not null
    check (reconstruction_mode in ('retrospective')),
  experiment_version text not null
    check (char_length(trim(experiment_version)) between 1 and 100),
  source_availability_rule_version text not null
    check (char_length(trim(source_availability_rule_version)) between 1 and 100),
  input_selection_version text not null
    check (char_length(trim(input_selection_version)) between 1 and 100),
  source_manifest jsonb not null
    check (jsonb_typeof(source_manifest) = 'object'),
  source_manifest_sha256 text not null unique
    check (source_manifest_sha256 ~ '^[0-9a-f]{64}$'),
  qualitative_input_sha256 text not null
    check (qualitative_input_sha256 ~ '^[0-9a-f]{64}$'),
  snapshot_schema_version text not null
    check (char_length(trim(snapshot_schema_version)) between 1 and 100),
  recorded_at timestamptz not null default now(),
  unique (earnings_event_id, experiment_version)
);

create index historical_reconstruction_plans_cutoff_idx
  on public.historical_reconstruction_plans (simulated_cutoff_at, earnings_event_id);

create or replace function public.validate_historical_reconstruction_plan_insert()
returns trigger
language plpgsql
as $$
declare
  event_period_end date;
  current_document_count integer;
  previous_document_count integer;
  source_document jsonb;
begin
  new.recorded_at := clock_timestamp();

  if new.reconstruction_mode <> 'retrospective'
    or new.source_availability_rule_version <> 'published-by-simulated-cutoff-v1'
    or new.input_selection_version <> 'historical-earnings-release-input-v1'
    or new.snapshot_schema_version <> 'historical-reconstruction-plan-v1' then
    raise exception 'Historical reconstruction plan uses an unsupported version';
  end if;

  select period_end
    into event_period_end
  from public.earnings_events
  where id = new.earnings_event_id;

  if event_period_end is null then
    raise exception 'Historical reconstruction requires a confirmed earnings event';
  end if;

  if new.simulated_cutoff_at >= new.recorded_at then
    raise exception 'Historical simulated cutoff must be earlier than its recording time';
  end if;

  if new.source_manifest ->> 'earningsEventId' is distinct from new.earnings_event_id::text
    or (new.source_manifest ->> 'cutoffAt')::timestamptz
      is distinct from new.simulated_cutoff_at
    or new.source_manifest ->> 'inputSelectionVersion'
      is distinct from new.input_selection_version
    or new.source_manifest ->> 'sourceAvailabilityRuleVersion'
      is distinct from new.source_availability_rule_version then
    raise exception 'Historical source manifest does not match its plan';
  end if;

  if jsonb_typeof(new.source_manifest -> 'documents') <> 'array'
    or jsonb_array_length(new.source_manifest -> 'documents') = 0 then
    raise exception 'Historical source manifest requires documents';
  end if;

  select count(*)
    into current_document_count
  from jsonb_array_elements(new.source_manifest -> 'documents') as document
  where document ->> 'role' = 'current';

  if current_document_count <> 1 then
    raise exception 'Historical source manifest requires exactly one current document';
  end if;

  select count(*)
    into previous_document_count
  from jsonb_array_elements(new.source_manifest -> 'documents') as document
  where document ->> 'role' = 'previous';

  if previous_document_count > 1 then
    raise exception 'Historical source manifest accepts at most one previous document';
  end if;

  for source_document in
    select value from jsonb_array_elements(new.source_manifest -> 'documents')
  loop
    if jsonb_typeof(source_document) <> 'object'
      or coalesce(source_document ->> 'role' not in ('current', 'previous'), true)
      or source_document ->> 'documentId' is null
      or source_document ->> 'publishedAt' is null
      or source_document ->> 'firstSeenAt' is null
      or source_document ->> 'sourceContentSha256' is null
      or source_document ->> 'textContentSha256' is null then
      raise exception 'Historical source manifest contains an invalid document';
    end if;
    if (source_document ->> 'publishedAt')::timestamptz > new.simulated_cutoff_at then
      raise exception 'Historical source document was published after the simulated cutoff';
    end if;
    if (source_document ->> 'firstSeenAt')::timestamptz
      < (source_document ->> 'publishedAt')::timestamptz then
      raise exception 'Historical source document was first seen before publication';
    end if;
  end loop;

  return new;
end;
$$;

create trigger validate_historical_reconstruction_plan_before_insert
before insert on public.historical_reconstruction_plans
for each row execute function public.validate_historical_reconstruction_plan_insert();

create or replace function public.prevent_historical_reconstruction_plan_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'historical_reconstruction_plans rows are append-only';
end;
$$;

create trigger prevent_historical_reconstruction_plan_update
before update on public.historical_reconstruction_plans
for each row execute function public.prevent_historical_reconstruction_plan_mutation();

create trigger prevent_historical_reconstruction_plan_delete
before delete on public.historical_reconstruction_plans
for each row execute function public.prevent_historical_reconstruction_plan_mutation();

alter table public.historical_reconstruction_plans enable row level security;

comment on table public.historical_reconstruction_plans is
  'Append-only plans that freeze historical source availability before paid extraction and outcome evaluation.';

comment on column public.historical_reconstruction_plans.simulated_cutoff_at is
  'Historical timestamp being reconstructed; this is not the real database insertion time.';

comment on column public.historical_reconstruction_plans.source_availability_rule_version is
  'Versioned rule that allows only sources published by the simulated cutoff while preserving real first-seen times.';

comment on column public.historical_reconstruction_plans.recorded_at is
  'Real database-server time when the retrospective plan was frozen.';
