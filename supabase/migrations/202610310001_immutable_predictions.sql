alter table public.predictions
  alter column extraction_run_id set not null,
  add column extraction_review_id uuid not null references public.extraction_reviews(id),
  add column financial_calculation_id uuid not null
    references public.financial_derived_metric_calculations(id),
  add column snapshot_schema_version text not null
    check (char_length(trim(snapshot_schema_version)) between 1 and 100),
  add column evaluation_session_rule_version text not null
    check (char_length(trim(evaluation_session_rule_version)) between 1 and 100),
  add column recorded_at timestamptz not null default now(),
  add column planned_day_1_session date not null,
  add column planned_day_5_session date not null,
  add column planned_day_20_session date not null,
  add constraint predictions_event_rule_unique
    unique (earnings_event_id, rule_version),
  add constraint predictions_planned_sessions_ordered
    check (
      planned_entry_session = planned_day_1_session
      and planned_day_1_session < planned_day_5_session
      and planned_day_5_session < planned_day_20_session
    ),
  add constraint predictions_score_components_array
    check (jsonb_typeof(score_components) = 'array'),
  add constraint predictions_snapshot_object
    check (jsonb_typeof(snapshot) = 'object'),
  add constraint predictions_day_1_session_fkey
    foreign key (
      entry_calendar_code,
      planned_day_1_session,
      entry_calendar_version
    )
    references public.market_sessions (
      calendar_code,
      session_date,
      calendar_version
    ),
  add constraint predictions_day_5_session_fkey
    foreign key (
      entry_calendar_code,
      planned_day_5_session,
      entry_calendar_version
    )
    references public.market_sessions (
      calendar_code,
      session_date,
      calendar_version
    ),
  add constraint predictions_day_20_session_fkey
    foreign key (
      entry_calendar_code,
      planned_day_20_session,
      entry_calendar_version
    )
    references public.market_sessions (
      calendar_code,
      session_date,
      calendar_version
    );

create or replace function public.validate_prediction_insert()
returns trigger
language plpgsql
as $$
declare
  review_extraction_run_id uuid;
  review_decision text;
  review_created_at timestamptz;
  event_detected_at timestamptz;
  extraction_event_id uuid;
  extraction_cutoff_at timestamptz;
  extraction_finished_at timestamptz;
  extraction_created_at timestamptz;
  financial_event_id uuid;
  financial_created_at timestamptz;
  entry_opens_at timestamptz;
begin
  new.recorded_at := clock_timestamp();

  select extraction_run_id, decision, created_at
    into review_extraction_run_id, review_decision, review_created_at
  from public.extraction_reviews
  where id = new.extraction_review_id;

  if review_extraction_run_id is null then
    raise exception 'Prediction extraction review does not exist';
  end if;

  if review_extraction_run_id <> new.extraction_run_id then
    raise exception 'Prediction extraction review belongs to a different extraction run';
  end if;

  if review_decision not in ('accepted', 'corrected') then
    raise exception 'Prediction requires an accepted or corrected extraction review';
  end if;

  select earnings_event_id, cutoff_at, finished_at, created_at
    into
      extraction_event_id,
      extraction_cutoff_at,
      extraction_finished_at,
      extraction_created_at
  from public.extraction_runs
  where id = new.extraction_run_id;

  if extraction_event_id <> new.earnings_event_id then
    raise exception 'Prediction extraction belongs to a different earnings event';
  end if;

  select earnings_event_id, created_at
    into financial_event_id, financial_created_at
  from public.financial_derived_metric_calculations
  where id = new.financial_calculation_id;

  if financial_event_id <> new.earnings_event_id then
    raise exception 'Prediction financial calculation belongs to a different earnings event';
  end if;

  select detected_at
    into event_detected_at
  from public.earnings_events
  where id = new.earnings_event_id;

  if new.cutoff_at <> new.created_at then
    raise exception 'Prediction cutoff and creation timestamp must match';
  end if;

  if new.cutoff_at > new.recorded_at then
    raise exception 'Prediction cutoff cannot be later than its database recording time';
  end if;

  if new.recorded_at - new.cutoff_at > interval '10 minutes' then
    raise exception 'Prediction must be recorded within 10 minutes of its cutoff';
  end if;

  if event_detected_at > new.cutoff_at
    or extraction_cutoff_at > new.cutoff_at
    or extraction_finished_at > new.cutoff_at
    or extraction_created_at > new.cutoff_at
    or review_created_at > new.cutoff_at
    or financial_created_at > new.cutoff_at then
    raise exception 'Prediction input was not available by its cutoff';
  end if;

  select opens_at
    into entry_opens_at
  from public.market_sessions
  where calendar_code = new.entry_calendar_code
    and session_date = new.planned_entry_session
    and calendar_version = new.entry_calendar_version;

  if entry_opens_at is null then
    raise exception 'Prediction planned entry session does not exist';
  end if;

  if entry_opens_at <= new.recorded_at then
    raise exception 'Prediction must be recorded before its planned entry session opens';
  end if;

  return new;
end;
$$;

create trigger validate_prediction_before_insert
before insert on public.predictions
for each row execute function public.validate_prediction_insert();

create or replace function public.prevent_prediction_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'predictions rows are append-only';
end;
$$;

create trigger prevent_prediction_update
before update on public.predictions
for each row execute function public.prevent_prediction_mutation();

create trigger prevent_prediction_delete
before delete on public.predictions
for each row execute function public.prevent_prediction_mutation();

comment on table public.predictions is
  'Append-only point-in-time research predictions created before future outcome prices are known.';

comment on column public.predictions.snapshot_schema_version is
  'Version of the complete canonical prediction snapshot structure.';

comment on column public.predictions.evaluation_session_rule_version is
  'Versioned rule mapping the entry session to one-, five-, and twenty-session outcomes.';

comment on column public.predictions.recorded_at is
  'Database-server timestamp assigned when the immutable prediction was inserted.';

comment on column public.predictions.financial_calculation_id is
  'Exact versioned financial calculation selected before the prediction cutoff.';

comment on column public.predictions.planned_day_1_session is
  'Entry session whose close is used for the one-trading-day outcome.';

comment on column public.predictions.planned_day_5_session is
  'Fifth trading session including the entry session.';

comment on column public.predictions.planned_day_20_session is
  'Twentieth trading session including the entry session.';
