create table public.historical_predictions (
  id uuid primary key default gen_random_uuid(),
  historical_reconstruction_plan_id uuid not null
    references public.historical_reconstruction_plans(id),
  earnings_event_id uuid not null references public.earnings_events(id),
  extraction_run_id uuid not null references public.extraction_runs(id),
  extraction_review_id uuid not null references public.extraction_reviews(id),
  experiment_version text not null check (char_length(trim(experiment_version)) between 1 and 100),
  feature_set_version text not null check (feature_set_version = 'qualitative-only-v1'),
  prompt_version text not null check (char_length(trim(prompt_version)) between 1 and 100),
  model_name text not null check (char_length(trim(model_name)) between 1 and 200),
  rule_version text not null check (char_length(trim(rule_version)) between 1 and 100),
  simulated_cutoff_at timestamptz not null,
  score smallint not null check (score between -5 and 5),
  score_components jsonb not null check (jsonb_typeof(score_components) = 'array'),
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  snapshot_schema_version text not null
    check (char_length(trim(snapshot_schema_version)) between 1 and 100),
  snapshot_sha256 text not null unique check (snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  evaluation_session_rule_version text not null,
  planned_entry_session date not null,
  planned_day_1_session date not null,
  planned_day_5_session date not null,
  planned_day_20_session date not null,
  entry_calendar_code text not null,
  entry_calendar_version text not null,
  reference_price_rule_version text not null,
  recorded_at timestamptz not null default now(),
  unique (historical_reconstruction_plan_id, feature_set_version, rule_version),
  check (
    planned_entry_session = planned_day_1_session
    and planned_day_1_session < planned_day_5_session
    and planned_day_5_session < planned_day_20_session
  ),
  foreign key (entry_calendar_code, planned_entry_session, entry_calendar_version)
    references public.market_sessions(calendar_code, session_date, calendar_version),
  foreign key (entry_calendar_code, planned_day_5_session, entry_calendar_version)
    references public.market_sessions(calendar_code, session_date, calendar_version),
  foreign key (entry_calendar_code, planned_day_20_session, entry_calendar_version)
    references public.market_sessions(calendar_code, session_date, calendar_version)
);

create index historical_predictions_experiment_feature_idx
  on public.historical_predictions (experiment_version, feature_set_version);

create or replace function public.validate_historical_prediction_insert()
returns trigger
language plpgsql
as $$
declare
  plan_event_id uuid;
  plan_cutoff_at timestamptz;
  plan_experiment_version text;
  run_event_id uuid;
  run_cutoff_at timestamptz;
  run_purpose text;
  run_plan_id uuid;
  review_run_id uuid;
  review_decision text;
  entry_opens_at timestamptz;
  existing_prompt_version text;
  existing_model_name text;
begin
  new.recorded_at := clock_timestamp();

  select earnings_event_id, simulated_cutoff_at, experiment_version
    into plan_event_id, plan_cutoff_at, plan_experiment_version
  from public.historical_reconstruction_plans
  where id = new.historical_reconstruction_plan_id;

  if plan_event_id is null
    or plan_event_id <> new.earnings_event_id
    or plan_cutoff_at <> new.simulated_cutoff_at
    or plan_experiment_version <> new.experiment_version then
    raise exception 'Historical prediction does not match its reconstruction plan';
  end if;

  select earnings_event_id, cutoff_at, extraction_purpose, historical_reconstruction_plan_id
    into run_event_id, run_cutoff_at, run_purpose, run_plan_id
  from public.extraction_runs
  where id = new.extraction_run_id;

  if run_event_id is null
    or run_event_id <> new.earnings_event_id
    or run_cutoff_at <> new.simulated_cutoff_at
    or run_purpose <> 'historical_reconstruction'
    or run_plan_id <> new.historical_reconstruction_plan_id then
    raise exception 'Historical prediction extraction does not match its plan';
  end if;

  select extraction_run_id, decision into review_run_id, review_decision
  from public.extraction_reviews where id = new.extraction_review_id;
  if review_run_id is null
    or review_run_id <> new.extraction_run_id
    or review_decision not in ('accepted', 'corrected') then
    raise exception 'Historical prediction requires a usable review for its extraction';
  end if;

  select opens_at into entry_opens_at from public.market_sessions
  where calendar_code = new.entry_calendar_code
    and calendar_version = new.entry_calendar_version
    and session_date = new.planned_entry_session;
  if entry_opens_at is null or entry_opens_at <= new.simulated_cutoff_at then
    raise exception 'Historical prediction entry must open after its simulated cutoff';
  end if;

  if (new.snapshot ->> 'schemaVersion') is distinct from new.snapshot_schema_version
    or (new.snapshot ->> 'experimentVersion') is distinct from new.experiment_version
    or (new.snapshot ->> 'featureSetVersion') is distinct from new.feature_set_version
    or (new.snapshot ->> 'promptVersion') is distinct from new.prompt_version
    or (new.snapshot ->> 'modelName') is distinct from new.model_name
    or (new.snapshot #>> '{historicalPlan,id}') is distinct from
      new.historical_reconstruction_plan_id::text
    or (new.snapshot #>> '{qualitative,extractionRunId}') is distinct from
      new.extraction_run_id::text
    or (new.snapshot #>> '{qualitative,review,id}') is distinct from
      new.extraction_review_id::text
    or (new.snapshot #>> '{score,ruleVersion}') is distinct from new.rule_version
    or (new.snapshot #>> '{score,score}') is distinct from new.score::text
    or (new.snapshot #> '{score,components}') is distinct from new.score_components then
    raise exception 'Historical prediction columns do not match the immutable snapshot';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(new.experiment_version || chr(31) || new.feature_set_version, 0)
  );
  select prompt_version, model_name into existing_prompt_version, existing_model_name
  from public.historical_predictions
  where experiment_version = new.experiment_version
    and feature_set_version = new.feature_set_version
  limit 1;
  if existing_prompt_version is not null and (
    existing_prompt_version <> new.prompt_version
    or existing_model_name <> new.model_name
  ) then
    raise exception 'Historical experiment requires one prompt and model configuration';
  end if;
  return new;
end;
$$;

create trigger validate_historical_prediction_before_insert
before insert on public.historical_predictions
for each row execute function public.validate_historical_prediction_insert();

create trigger prevent_historical_prediction_update
before update on public.historical_predictions
for each row execute function public.prevent_prediction_mutation();

create trigger prevent_historical_prediction_delete
before delete on public.historical_predictions
for each row execute function public.prevent_prediction_mutation();

alter table public.historical_predictions enable row level security;

comment on table public.historical_predictions is
  'Append-only retrospective prediction snapshots, kept separate from the forward track record.';
