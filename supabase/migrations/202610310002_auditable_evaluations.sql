alter table public.evaluations
  rename column entry_price to stock_entry_price;

alter table public.evaluations
  add column stock_exit_price numeric not null check (stock_exit_price > 0),
  add column market_entry_price numeric not null check (market_entry_price > 0),
  add column market_exit_price numeric not null check (market_exit_price > 0),
  add column sector_entry_price numeric check (sector_entry_price > 0),
  add column sector_exit_price numeric check (sector_exit_price > 0),
  add column stock_minus_market_return numeric not null,
  add column stock_minus_sector_return numeric,
  add column stock_entry_price_observation_id uuid not null
    references public.daily_price_observations(id),
  add column stock_exit_price_observation_id uuid not null
    references public.daily_price_observations(id),
  add column market_entry_price_observation_id uuid not null
    references public.daily_price_observations(id),
  add column market_exit_price_observation_id uuid not null
    references public.daily_price_observations(id),
  add column sector_entry_price_observation_id uuid
    references public.daily_price_observations(id),
  add column sector_exit_price_observation_id uuid
    references public.daily_price_observations(id),
  add column market_benchmark_assignment_id uuid not null
    references public.company_benchmark_assignments(id),
  add column sector_benchmark_assignment_id uuid
    references public.company_benchmark_assignments(id),
  add column planned_exit_session date not null,
  add column snapshot jsonb not null
    check (jsonb_typeof(snapshot) = 'object'),
  add column snapshot_schema_version text not null
    check (char_length(trim(snapshot_schema_version)) between 1 and 100),
  add column snapshot_sha256 text not null unique
    check (snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  add column recorded_at timestamptz not null default now(),
  add constraint evaluations_sector_evidence_complete
    check (
      (
        sector_return is null
        and sector_entry_price is null
        and sector_exit_price is null
        and stock_minus_sector_return is null
        and sector_entry_price_observation_id is null
        and sector_exit_price_observation_id is null
        and sector_benchmark_assignment_id is null
      )
      or
      (
        sector_return is not null
        and sector_entry_price is not null
        and sector_exit_price is not null
        and stock_minus_sector_return is not null
        and sector_entry_price_observation_id is not null
        and sector_exit_price_observation_id is not null
        and sector_benchmark_assignment_id is not null
      )
    );

create or replace function public.validate_evaluation_insert()
returns trigger
language plpgsql
as $$
declare
  prediction_cutoff_at timestamptz;
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
    or new.snapshot_schema_version <> 'evaluation-snapshot-v1' then
    raise exception 'Evaluation methodology or snapshot version is unsupported';
  end if;

  select
    prediction.cutoff_at,
    prediction.planned_entry_session,
    prediction.planned_day_1_session,
    prediction.planned_day_5_session,
    prediction.planned_day_20_session,
    prediction.entry_calendar_code,
    prediction.entry_calendar_version,
    earnings_event.company_id
  into
    prediction_cutoff_at,
    prediction_entry_session,
    prediction_day_1_session,
    prediction_day_5_session,
    prediction_day_20_session,
    prediction_calendar_code,
    prediction_calendar_version,
    prediction_company_id
  from public.predictions as prediction
  join public.earnings_events as earnings_event
    on earnings_event.id = prediction.earnings_event_id
  where prediction.id = new.prediction_id;

  expected_exit_session := case new.horizon_days
    when 1 then prediction_day_1_session
    when 5 then prediction_day_5_session
    when 20 then prediction_day_20_session
  end;

  if expected_exit_session is null or new.planned_exit_session <> expected_exit_session then
    raise exception 'Evaluation exit session does not match its prediction horizon';
  end if;

  select closes_at
    into expected_entry_closes_at
  from public.market_sessions
  where calendar_code = prediction_calendar_code
    and session_date = prediction_entry_session
    and calendar_version = prediction_calendar_version;

  select closes_at
    into expected_exit_closes_at
  from public.market_sessions
  where calendar_code = prediction_calendar_code
    and session_date = expected_exit_session
    and calendar_version = prediction_calendar_version;

  if expected_entry_closes_at is null or expected_exit_closes_at is null then
    raise exception 'Evaluation entry or exit market session does not exist';
  end if;

  if new.calculated_at < expected_exit_closes_at then
    raise exception 'Evaluation cannot be calculated before its exit session closes';
  end if;

  if new.calculated_at > new.recorded_at then
    raise exception 'Evaluation calculation time cannot be later than its database recording time';
  end if;

  if new.recorded_at - new.calculated_at > interval '10 minutes' then
    raise exception 'Evaluation must be recorded within 10 minutes of its calculation time';
  end if;

  select id
    into expected_market_assignment_id
  from public.company_benchmark_assignments
  where company_id = prediction_company_id
    and benchmark_role = 'market'
    and applicable_from <= prediction_entry_session
    and created_at <= prediction_cutoff_at
  order by applicable_from desc, created_at desc, id desc
  limit 1;

  if new.market_benchmark_assignment_id is distinct from expected_market_assignment_id then
    raise exception 'Evaluation did not select the latest available market benchmark assignment';
  end if;

  select id
    into expected_sector_assignment_id
  from public.company_benchmark_assignments
  where company_id = prediction_company_id
    and benchmark_role = 'sector'
    and applicable_from <= prediction_entry_session
    and created_at <= prediction_cutoff_at
  order by applicable_from desc, created_at desc, id desc
  limit 1;

  if new.sector_benchmark_assignment_id is distinct from expected_sector_assignment_id then
    raise exception 'Evaluation did not select the latest available sector benchmark assignment';
  end if;

  select *
    into market_assignment
  from public.company_benchmark_assignments
  where id = expected_market_assignment_id;

  if market_assignment.company_id <> prediction_company_id
    or market_assignment.benchmark_role <> 'market'
    or market_assignment.applicable_from > prediction_entry_session
    or market_assignment.created_at > prediction_cutoff_at then
    raise exception 'Evaluation market benchmark was not valid at the prediction cutoff';
  end if;

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

  foreach selected_observation_id in array array[
    new.stock_entry_price_observation_id,
    new.stock_exit_price_observation_id,
    new.market_entry_price_observation_id,
    new.market_exit_price_observation_id,
    new.sector_entry_price_observation_id,
    new.sector_exit_price_observation_id
  ]
  loop
    if selected_observation_id is not null and exists (
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
      raise exception 'Evaluation did not select the latest available price observation';
    end if;
  end loop;

  select company_id, instrument_type
    into stock_instrument_company_id, stock_instrument_type
  from public.price_instruments
  where id = stock_entry_observation.price_instrument_id;

  if stock_instrument_company_id <> prediction_company_id
    or stock_instrument_type <> 'company_stock'
    or stock_exit_observation.price_instrument_id <> stock_entry_observation.price_instrument_id then
    raise exception 'Evaluation stock observations belong to the wrong instrument';
  end if;

  if stock_entry_observation.trading_date <> prediction_entry_session
    or market_entry_observation.trading_date <> prediction_entry_session
    or stock_exit_observation.trading_date <> expected_exit_session
    or market_exit_observation.trading_date <> expected_exit_session then
    raise exception 'Evaluation stock or market observation has the wrong trading date';
  end if;

  if market_entry_observation.price_instrument_id
      <> market_assignment.benchmark_instrument_id
    or market_exit_observation.price_instrument_id
      <> market_assignment.benchmark_instrument_id then
    raise exception 'Evaluation market observations do not match the benchmark assignment';
  end if;

  if stock_entry_observation.fetched_at > new.calculated_at
    or stock_exit_observation.fetched_at > new.calculated_at
    or market_entry_observation.fetched_at > new.calculated_at
    or market_exit_observation.fetched_at > new.calculated_at
    or stock_entry_observation.created_at > new.calculated_at
    or stock_exit_observation.created_at > new.calculated_at
    or market_entry_observation.created_at > new.calculated_at
    or market_exit_observation.created_at > new.calculated_at then
    raise exception 'Evaluation uses a stock or market price fetched after calculation time';
  end if;

  if stock_entry_observation.fetched_at < expected_entry_closes_at
    or market_entry_observation.fetched_at < expected_entry_closes_at
    or stock_exit_observation.fetched_at < expected_exit_closes_at
    or market_exit_observation.fetched_at < expected_exit_closes_at then
    raise exception 'Evaluation uses a stock or market observation fetched before session close';
  end if;

  if new.stock_entry_price <> stock_entry_observation.adjusted_open_price
    or new.stock_exit_price <> stock_exit_observation.adjusted_close_price
    or new.market_entry_price <> market_entry_observation.adjusted_open_price
    or new.market_exit_price <> market_exit_observation.adjusted_close_price then
    raise exception 'Evaluation stock or market prices do not match their observations';
  end if;

  if new.stock_return <> round(
    (new.stock_exit_price / new.stock_entry_price) - 1,
    12
  ) or new.market_return <> round(
    (new.market_exit_price / new.market_entry_price) - 1,
    12
  ) or new.stock_minus_market_return <> round(
    new.stock_return - new.market_return,
    12
  ) then
    raise exception 'Evaluation stock or market return calculation is incorrect';
  end if;

  if new.sector_benchmark_assignment_id is not null then
    select *
      into sector_assignment
    from public.company_benchmark_assignments
    where id = expected_sector_assignment_id;

    if sector_assignment.company_id <> prediction_company_id
      or sector_assignment.benchmark_role <> 'sector'
      or sector_assignment.applicable_from > prediction_entry_session
      or sector_assignment.created_at > prediction_cutoff_at then
      raise exception 'Evaluation sector benchmark was not valid at the prediction cutoff';
    end if;

    select * into sector_entry_observation
    from public.daily_price_observations
    where id = new.sector_entry_price_observation_id;

    select * into sector_exit_observation
    from public.daily_price_observations
    where id = new.sector_exit_price_observation_id;

    if sector_entry_observation.price_instrument_id
        <> sector_assignment.benchmark_instrument_id
      or sector_exit_observation.price_instrument_id
        <> sector_assignment.benchmark_instrument_id then
      raise exception 'Evaluation sector observations do not match the benchmark assignment';
    end if;

    if sector_entry_observation.trading_date <> prediction_entry_session
      or sector_exit_observation.trading_date <> expected_exit_session then
      raise exception 'Evaluation sector observation has the wrong trading date';
    end if;

    if sector_entry_observation.fetched_at > new.calculated_at
      or sector_exit_observation.fetched_at > new.calculated_at
      or sector_entry_observation.created_at > new.calculated_at
      or sector_exit_observation.created_at > new.calculated_at then
      raise exception 'Evaluation uses a sector price fetched after calculation time';
    end if;

    if sector_entry_observation.fetched_at < expected_entry_closes_at
      or sector_exit_observation.fetched_at < expected_exit_closes_at then
      raise exception 'Evaluation uses a sector observation fetched before session close';
    end if;

    if new.sector_entry_price <> sector_entry_observation.adjusted_open_price
      or new.sector_exit_price <> sector_exit_observation.adjusted_close_price then
      raise exception 'Evaluation sector prices do not match their observations';
    end if;

    if new.sector_return <> round(
      (new.sector_exit_price / new.sector_entry_price) - 1,
      12
    ) or new.stock_minus_sector_return <> round(
      new.stock_return - new.sector_return,
      12
    ) then
      raise exception 'Evaluation sector return calculation is incorrect';
    end if;
  end if;

  return new;
end;
$$;

create trigger validate_evaluation_before_insert
before insert on public.evaluations
for each row execute function public.validate_evaluation_insert();

create or replace function public.prevent_evaluation_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'evaluations rows are append-only';
end;
$$;

create trigger prevent_evaluation_update
before update on public.evaluations
for each row execute function public.prevent_evaluation_mutation();

create trigger prevent_evaluation_delete
before delete on public.evaluations
for each row execute function public.prevent_evaluation_mutation();

comment on table public.evaluations is
  'Append-only, reproducible stock and benchmark outcomes for immutable predictions.';

comment on column public.evaluations.stock_entry_price is
  'Adjusted opening price selected from the exact stored entry observation.';

comment on column public.evaluations.stock_exit_price is
  'Adjusted closing price selected from the exact stored horizon observation.';

comment on column public.evaluations.stock_minus_market_return is
  'Stock return fraction minus the broad-market benchmark return fraction.';

comment on column public.evaluations.stock_minus_sector_return is
  'Stock return fraction minus the sector benchmark return fraction when available.';

comment on column public.evaluations.snapshot is
  'Complete versioned evaluation input and output snapshot for independent reproduction.';

comment on column public.evaluations.recorded_at is
  'Database-server timestamp assigned when the immutable evaluation was inserted.';
