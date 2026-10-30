alter table public.daily_price_observations
  add column provider_name text,
  add column provider_symbol text;

update public.daily_price_observations as observation
set
  provider_name = instrument.provider_name,
  provider_symbol = instrument.provider_symbol
from public.price_instruments as instrument
where instrument.id = observation.price_instrument_id;

alter table public.daily_price_observations
  alter column provider_name set not null,
  alter column provider_symbol set not null,
  add constraint daily_price_observations_provider_name_valid
    check (char_length(trim(provider_name)) between 1 and 100),
  add constraint daily_price_observations_provider_symbol_valid
    check (char_length(trim(provider_symbol)) between 1 and 100);

do $$
declare
  previous_unique_constraint_name text;
begin
  select database_constraint.conname
    into previous_unique_constraint_name
  from pg_constraint as database_constraint
  join pg_class as database_table
    on database_table.oid = database_constraint.conrelid
  join pg_namespace as database_schema
    on database_schema.oid = database_table.relnamespace
  where database_schema.nspname = 'public'
    and database_table.relname = 'daily_price_observations'
    and database_constraint.contype = 'u'
    and (
      select array_agg(
        database_column.attname::text
        order by constraint_column.ordinality
      )
      from unnest(database_constraint.conkey)
        with ordinality as constraint_column(attribute_number, ordinality)
      join pg_attribute as database_column
        on database_column.attrelid = database_constraint.conrelid
       and database_column.attnum = constraint_column.attribute_number
    ) = array['price_instrument_id', 'trading_date', 'observation_sha256']::text[];

  if previous_unique_constraint_name is null then
    raise exception 'Could not find the original daily price observation uniqueness constraint';
  end if;

  execute format(
    'alter table public.daily_price_observations drop constraint %I',
    previous_unique_constraint_name
  );
end;
$$;

alter table public.daily_price_observations
  add constraint daily_price_observations_fetch_identity_key
  unique (
    price_instrument_id,
    trading_date,
    fetched_at
  );

comment on column public.daily_price_observations.provider_name is
  'Price provider recorded at fetch time so later instrument configuration changes do not rewrite history.';

comment on column public.daily_price_observations.provider_symbol is
  'Exact provider symbol recorded at fetch time and included in the observation fingerprint.';
