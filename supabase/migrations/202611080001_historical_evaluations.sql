begin;

create table public.historical_evaluations (
  id uuid primary key default gen_random_uuid(),
  historical_prediction_id uuid not null references public.historical_predictions(id),
  horizon_days integer not null check (horizon_days in (1, 5, 20)),
  stock_entry_price numeric not null check (stock_entry_price > 0),
  stock_exit_price numeric not null check (stock_exit_price > 0),
  market_entry_price numeric not null check (market_entry_price > 0),
  market_exit_price numeric not null check (market_exit_price > 0),
  sector_entry_price numeric not null check (sector_entry_price > 0),
  sector_exit_price numeric not null check (sector_exit_price > 0),
  stock_return numeric not null,
  market_return numeric not null,
  sector_return numeric not null,
  stock_minus_market_return numeric not null,
  stock_minus_sector_return numeric not null,
  stock_entry_price_observation_id uuid not null
    references public.daily_price_observations(id),
  stock_exit_price_observation_id uuid not null
    references public.daily_price_observations(id),
  market_entry_price_observation_id uuid not null
    references public.daily_price_observations(id),
  market_exit_price_observation_id uuid not null
    references public.daily_price_observations(id),
  sector_entry_price_observation_id uuid not null
    references public.daily_price_observations(id),
  sector_exit_price_observation_id uuid not null
    references public.daily_price_observations(id),
  market_benchmark_assignment_id uuid not null
    references public.company_benchmark_assignments(id),
  sector_benchmark_assignment_id uuid not null
    references public.company_benchmark_assignments(id),
  planned_exit_session date not null,
  calculated_at timestamptz not null,
  methodology_version text not null,
  reconstruction_rule_version text not null,
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  snapshot_schema_version text not null
    check (char_length(trim(snapshot_schema_version)) between 1 and 100),
  snapshot_sha256 text not null unique check (snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  recorded_at timestamptz not null default now(),
  unique (
    historical_prediction_id,
    horizon_days,
    methodology_version,
    reconstruction_rule_version
  )
);

create index historical_evaluations_prediction_horizon_idx
  on public.historical_evaluations (historical_prediction_id, horizon_days);

create or replace function public.validate_historical_evaluation_insert()
returns trigger
language plpgsql
as $$
declare
  prediction_snapshot_sha256 text;
  prediction_experiment_version text;
  prediction_feature_set_version text;
  prediction_simulated_cutoff_at timestamptz;
  prediction_entry_session date;
  prediction_day_1_session date;
  prediction_day_5_session date;
  prediction_day_20_session date;
  prediction_calendar_code text;
  prediction_calendar_version text;
  prediction_company_id uuid;
  expected_exit_session date;
  expected_entry_closes_at timestamptz;
  expected_exit_closes_at timestamptz;
  expected_market_assignment_id uuid;
  expected_sector_assignment_id uuid;
  selected_observation_id uuid;
  market_assignment public.company_benchmark_assignments%rowtype;
  sector_assignment public.company_benchmark_assignments%rowtype;
  stock_entry_observation public.daily_price_observations%rowtype;
  stock_exit_observation public.daily_price_observations%rowtype;
  market_entry_observation public.daily_price_observations%rowtype;
  market_exit_observation public.daily_price_observations%rowtype;
  sector_entry_observation public.daily_price_observations%rowtype;
  sector_exit_observation public.daily_price_observations%rowtype;
  stock_instrument_company_id uuid;
  stock_instrument_type text;
begin
  new.recorded_at := clock_timestamp();

  if new.methodology_version <> 'adjusted-open-to-adjusted-close-v1'
    or new.reconstruction_rule_version
      <> 'retrospective-price-and-benchmark-reconstruction-v1'
    or new.snapshot_schema_version <> 'historical-evaluation-snapshot-v1' then
    raise exception 'Historical evaluation version is unsupported';
  end if;

  select
    prediction.snapshot_sha256,
    prediction.experiment_version,
    prediction.feature_set_version,
    prediction.simulated_cutoff_at,
    prediction.planned_entry_session,
    prediction.planned_day_1_session,
    prediction.planned_day_5_session,
    prediction.planned_day_20_session,
    prediction.entry_calendar_code,
    prediction.entry_calendar_version,
    earnings_event.company_id
  into
    prediction_snapshot_sha256,
    prediction_experiment_version,
    prediction_feature_set_version,
    prediction_simulated_cutoff_at,
    prediction_entry_session,
    prediction_day_1_session,
    prediction_day_5_session,
    prediction_day_20_session,
    prediction_calendar_code,
    prediction_calendar_version,
    prediction_company_id
  from public.historical_predictions as prediction
  join public.earnings_events as earnings_event
    on earnings_event.id = prediction.earnings_event_id
  where prediction.id = new.historical_prediction_id;

  expected_exit_session := case new.horizon_days
    when 1 then prediction_day_1_session
    when 5 then prediction_day_5_session
    when 20 then prediction_day_20_session
  end;

  if expected_exit_session is null or new.planned_exit_session <> expected_exit_session then
    raise exception 'Historical evaluation exit session does not match its prediction horizon';
  end if;

  select closes_at into expected_entry_closes_at
  from public.market_sessions
  where calendar_code = prediction_calendar_code
    and session_date = prediction_entry_session
    and calendar_version = prediction_calendar_version;

  select closes_at into expected_exit_closes_at
  from public.market_sessions
  where calendar_code = prediction_calendar_code
    and session_date = expected_exit_session
    and calendar_version = prediction_calendar_version;

  if expected_entry_closes_at is null or expected_exit_closes_at is null then
    raise exception 'Historical evaluation market session does not exist';
  end if;
  if new.calculated_at < expected_exit_closes_at then
    raise exception 'Historical evaluation cannot precede its exit-session close';
  end if;
  if new.calculated_at > new.recorded_at
    or new.recorded_at - new.calculated_at > interval '10 minutes' then
    raise exception 'Historical evaluation must be recorded promptly after calculation';
  end if;

  select id into expected_market_assignment_id
  from public.company_benchmark_assignments
  where company_id = prediction_company_id
    and benchmark_role = 'market'
    and applicable_from <= prediction_entry_session
    and created_at <= new.calculated_at
  order by applicable_from desc, created_at desc, id desc
  limit 1;

  select id into expected_sector_assignment_id
  from public.company_benchmark_assignments
  where company_id = prediction_company_id
    and benchmark_role = 'sector'
    and applicable_from <= prediction_entry_session
    and created_at <= new.calculated_at
  order by applicable_from desc, created_at desc, id desc
  limit 1;

  if new.market_benchmark_assignment_id is distinct from expected_market_assignment_id
    or new.sector_benchmark_assignment_id is distinct from expected_sector_assignment_id then
    raise exception 'Historical evaluation selected an unexpected benchmark assignment';
  end if;

  select * into market_assignment
  from public.company_benchmark_assignments
  where id = expected_market_assignment_id;

  select * into sector_assignment
  from public.company_benchmark_assignments
  where id = expected_sector_assignment_id;

  select * into stock_entry_observation
  from public.daily_price_observations
  where id = new.stock_entry_price_observation_id;
  select * into stock_exit_observation
  from public.daily_price_observations
  where id = new.stock_exit_price_observation_id;
  select * into market_entry_observation
  from public.daily_price_observations
  where id = new.market_entry_price_observation_id;
  select * into market_exit_observation
  from public.daily_price_observations
  where id = new.market_exit_price_observation_id;
  select * into sector_entry_observation
  from public.daily_price_observations
  where id = new.sector_entry_price_observation_id;
  select * into sector_exit_observation
  from public.daily_price_observations
  where id = new.sector_exit_price_observation_id;

  foreach selected_observation_id in array array[
    new.stock_entry_price_observation_id,
    new.stock_exit_price_observation_id,
    new.market_entry_price_observation_id,
    new.market_exit_price_observation_id,
    new.sector_entry_price_observation_id,
    new.sector_exit_price_observation_id
  ]
  loop
    if exists (
      select 1
      from public.daily_price_observations as selected_observation
      join public.daily_price_observations as later_observation
        on later_observation.price_instrument_id = selected_observation.price_instrument_id
       and later_observation.trading_date = selected_observation.trading_date
      where selected_observation.id = selected_observation_id
        and later_observation.fetched_at <= new.calculated_at
        and later_observation.created_at <= new.calculated_at
        and (
          later_observation.fetched_at > selected_observation.fetched_at
          or (
            later_observation.fetched_at = selected_observation.fetched_at
            and later_observation.id > selected_observation.id
          )
        )
    ) then
      raise exception 'Historical evaluation did not select the latest price observation';
    end if;
  end loop;

  select company_id, instrument_type
  into stock_instrument_company_id, stock_instrument_type
  from public.price_instruments
  where id = stock_entry_observation.price_instrument_id;

  if stock_instrument_company_id <> prediction_company_id
    or stock_instrument_type <> 'company_stock'
    or stock_exit_observation.price_instrument_id
      <> stock_entry_observation.price_instrument_id then
    raise exception 'Historical evaluation stock observations use the wrong instrument';
  end if;

  if market_assignment.company_id <> prediction_company_id
    or market_assignment.benchmark_role <> 'market'
    or market_entry_observation.price_instrument_id
      <> market_assignment.benchmark_instrument_id
    or market_exit_observation.price_instrument_id
      <> market_assignment.benchmark_instrument_id
    or sector_assignment.company_id <> prediction_company_id
    or sector_assignment.benchmark_role <> 'sector'
    or sector_entry_observation.price_instrument_id
      <> sector_assignment.benchmark_instrument_id
    or sector_exit_observation.price_instrument_id
      <> sector_assignment.benchmark_instrument_id then
    raise exception 'Historical evaluation benchmark observations use the wrong mapping';
  end if;

  if stock_entry_observation.trading_date <> prediction_entry_session
    or market_entry_observation.trading_date <> prediction_entry_session
    or sector_entry_observation.trading_date <> prediction_entry_session
    or stock_exit_observation.trading_date <> expected_exit_session
    or market_exit_observation.trading_date <> expected_exit_session
    or sector_exit_observation.trading_date <> expected_exit_session then
    raise exception 'Historical evaluation observation has the wrong trading date';
  end if;

  if stock_entry_observation.fetched_at > new.calculated_at
    or stock_exit_observation.fetched_at > new.calculated_at
    or market_entry_observation.fetched_at > new.calculated_at
    or market_exit_observation.fetched_at > new.calculated_at
    or sector_entry_observation.fetched_at > new.calculated_at
    or sector_exit_observation.fetched_at > new.calculated_at
    or stock_entry_observation.created_at > new.calculated_at
    or stock_exit_observation.created_at > new.calculated_at
    or market_entry_observation.created_at > new.calculated_at
    or market_exit_observation.created_at > new.calculated_at
    or sector_entry_observation.created_at > new.calculated_at
    or sector_exit_observation.created_at > new.calculated_at then
    raise exception 'Historical evaluation uses a price unavailable at calculation time';
  end if;

  if stock_entry_observation.fetched_at < expected_entry_closes_at
    or market_entry_observation.fetched_at < expected_entry_closes_at
    or sector_entry_observation.fetched_at < expected_entry_closes_at
    or stock_exit_observation.fetched_at < expected_exit_closes_at
    or market_exit_observation.fetched_at < expected_exit_closes_at
    or sector_exit_observation.fetched_at < expected_exit_closes_at then
    raise exception 'Historical evaluation uses a price fetched before session close';
  end if;

  if new.stock_entry_price <> stock_entry_observation.adjusted_open_price
    or new.stock_exit_price <> stock_exit_observation.adjusted_close_price
    or new.market_entry_price <> market_entry_observation.adjusted_open_price
    or new.market_exit_price <> market_exit_observation.adjusted_close_price
    or new.sector_entry_price <> sector_entry_observation.adjusted_open_price
    or new.sector_exit_price <> sector_exit_observation.adjusted_close_price then
    raise exception 'Historical evaluation prices do not match their observations';
  end if;

  if new.stock_return <> round((new.stock_exit_price / new.stock_entry_price) - 1, 12)
    or new.market_return <> round((new.market_exit_price / new.market_entry_price) - 1, 12)
    or new.sector_return <> round((new.sector_exit_price / new.sector_entry_price) - 1, 12)
    or new.stock_minus_market_return <> round(new.stock_return - new.market_return, 12)
    or new.stock_minus_sector_return <> round(new.stock_return - new.sector_return, 12) then
    raise exception 'Historical evaluation return calculation is incorrect';
  end if;

  if (new.snapshot ->> 'schemaVersion') is distinct from new.snapshot_schema_version
    or (new.snapshot ->> 'methodologyVersion') is distinct from new.methodology_version
    or (new.snapshot ->> 'reconstructionRuleVersion')
      is distinct from new.reconstruction_rule_version
    or (new.snapshot ->> 'reconstructionMode') is distinct from 'retrospective'
    or (new.snapshot ->> 'calculatedAt')::timestamptz
      is distinct from new.calculated_at
    or (new.snapshot #>> '{historicalPrediction,id}')
      is distinct from new.historical_prediction_id::text
    or (new.snapshot #>> '{historicalPrediction,snapshotFingerprint}')
      is distinct from prediction_snapshot_sha256
    or (new.snapshot #>> '{historicalPrediction,experimentVersion}')
      is distinct from prediction_experiment_version
    or (new.snapshot #>> '{historicalPrediction,featureSetVersion}')
      is distinct from prediction_feature_set_version
    or (new.snapshot #>> '{historicalPrediction,simulatedCutoffAt}')::timestamptz
      is distinct from prediction_simulated_cutoff_at
    or (new.snapshot ->> 'horizonDays')::integer is distinct from new.horizon_days
    or (new.snapshot ->> 'entrySession')::date is distinct from prediction_entry_session
    or (new.snapshot ->> 'exitSession')::date is distinct from new.planned_exit_session
    or (new.snapshot #>> '{stock,entryObservation,id}')::uuid
      is distinct from new.stock_entry_price_observation_id
    or (new.snapshot #>> '{stock,exitObservation,id}')::uuid
      is distinct from new.stock_exit_price_observation_id
    or (new.snapshot #>> '{marketBenchmark,entryObservation,id}')::uuid
      is distinct from new.market_entry_price_observation_id
    or (new.snapshot #>> '{marketBenchmark,exitObservation,id}')::uuid
      is distinct from new.market_exit_price_observation_id
    or (new.snapshot #>> '{sectorBenchmark,entryObservation,id}')::uuid
      is distinct from new.sector_entry_price_observation_id
    or (new.snapshot #>> '{sectorBenchmark,exitObservation,id}')::uuid
      is distinct from new.sector_exit_price_observation_id
    or (new.snapshot #>> '{marketBenchmark,assignment,id}')::uuid
      is distinct from new.market_benchmark_assignment_id
    or (new.snapshot #>> '{sectorBenchmark,assignment,id}')::uuid
      is distinct from new.sector_benchmark_assignment_id
    or (new.snapshot #>> '{returns,stock,entryPrice}')::numeric
      is distinct from new.stock_entry_price
    or (new.snapshot #>> '{returns,stock,exitPrice}')::numeric
      is distinct from new.stock_exit_price
    or (new.snapshot #>> '{returns,marketBenchmark,entryPrice}')::numeric
      is distinct from new.market_entry_price
    or (new.snapshot #>> '{returns,marketBenchmark,exitPrice}')::numeric
      is distinct from new.market_exit_price
    or (new.snapshot #>> '{returns,sectorBenchmark,entryPrice}')::numeric
      is distinct from new.sector_entry_price
    or (new.snapshot #>> '{returns,sectorBenchmark,exitPrice}')::numeric
      is distinct from new.sector_exit_price
    or (new.snapshot #>> '{returns,stock,returnFraction}')::numeric
      is distinct from new.stock_return
    or (new.snapshot #>> '{returns,marketBenchmark,returnFraction}')::numeric
      is distinct from new.market_return
    or (new.snapshot #>> '{returns,sectorBenchmark,returnFraction}')::numeric
      is distinct from new.sector_return
    or (new.snapshot #>> '{returns,stockMinusMarketReturn}')::numeric
      is distinct from new.stock_minus_market_return
    or (new.snapshot #>> '{returns,stockMinusSectorReturn}')::numeric
      is distinct from new.stock_minus_sector_return then
    raise exception 'Historical evaluation columns do not match the immutable snapshot';
  end if;

  return new;
end;
$$;

create trigger validate_historical_evaluation_before_insert
before insert on public.historical_evaluations
for each row execute function public.validate_historical_evaluation_insert();

create trigger prevent_historical_evaluation_update
before update on public.historical_evaluations
for each row execute function public.prevent_evaluation_mutation();

create trigger prevent_historical_evaluation_delete
before delete on public.historical_evaluations
for each row execute function public.prevent_evaluation_mutation();

alter table public.historical_evaluations enable row level security;

comment on table public.historical_evaluations is
  'Append-only retrospective outcomes kept separate from genuine forward evaluations.';

comment on column public.historical_evaluations.snapshot is
  'Complete versioned historical-evaluation evidence and calculated returns.';

comment on column public.historical_evaluations.reconstruction_rule_version is
  'Versioned rule describing retrospective benchmark and price reconstruction.';

comment on column public.historical_evaluations.recorded_at is
  'Honest database time when the immutable retrospective outcome was inserted.';

commit;
