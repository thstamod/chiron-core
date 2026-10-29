create table public.price_instruments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid unique references public.companies(id),
  symbol text not null
    check (char_length(trim(symbol)) between 1 and 20),
  display_name text not null
    check (char_length(trim(display_name)) between 1 and 200),
  instrument_type text not null
    check (instrument_type in ('company_stock', 'market_benchmark', 'sector_benchmark')),
  provider_name text not null
    check (char_length(trim(provider_name)) between 1 and 100),
  provider_symbol text not null
    check (char_length(trim(provider_symbol)) between 1 and 100),
  currency text not null default 'USD'
    check (currency ~ '^[A-Z]{3}$'),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (provider_name, provider_symbol),
  check (
    (instrument_type = 'company_stock' and company_id is not null)
    or
    (instrument_type in ('market_benchmark', 'sector_benchmark') and company_id is null)
  )
);

create table public.company_benchmark_assignments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  benchmark_instrument_id uuid not null references public.price_instruments(id),
  benchmark_role text not null
    check (benchmark_role in ('market', 'sector')),
  mapping_version text not null
    check (char_length(trim(mapping_version)) between 1 and 100),
  applicable_from date not null,
  rationale text not null
    check (char_length(trim(rationale)) between 1 and 1000),
  created_at timestamptz not null default now(),
  unique (company_id, benchmark_role, applicable_from)
);

create table public.daily_price_observations (
  id uuid primary key default gen_random_uuid(),
  price_instrument_id uuid not null references public.price_instruments(id),
  trading_date date not null,
  open_price numeric not null check (open_price > 0),
  high_price numeric not null check (high_price > 0),
  low_price numeric not null check (low_price > 0),
  close_price numeric not null check (close_price > 0),
  volume numeric not null check (volume >= 0),
  adjusted_open_price numeric not null check (adjusted_open_price > 0),
  adjusted_high_price numeric not null check (adjusted_high_price > 0),
  adjusted_low_price numeric not null check (adjusted_low_price > 0),
  adjusted_close_price numeric not null check (adjusted_close_price > 0),
  adjusted_volume numeric not null check (adjusted_volume >= 0),
  dividend_cash numeric not null check (dividend_cash >= 0),
  split_factor numeric not null check (split_factor > 0),
  observation_sha256 text not null
    check (observation_sha256 ~ '^[0-9a-f]{64}$'),
  fetched_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (price_instrument_id, trading_date, observation_sha256)
);

create index company_benchmark_assignments_lookup_idx
  on public.company_benchmark_assignments (
    company_id,
    benchmark_role,
    applicable_from desc,
    created_at desc,
    id desc
  );

create index daily_price_observations_lookup_idx
  on public.daily_price_observations (
    price_instrument_id,
    trading_date,
    fetched_at desc,
    id desc
  );

create or replace function public.validate_company_benchmark_assignment_insert()
returns trigger
language plpgsql
as $$
declare
  selected_instrument_type text;
begin
  select instrument_type
    into selected_instrument_type
  from public.price_instruments
  where id = new.benchmark_instrument_id;

  if new.benchmark_role = 'market' and selected_instrument_type <> 'market_benchmark' then
    raise exception 'A market assignment requires a market benchmark instrument';
  end if;

  if new.benchmark_role = 'sector' and selected_instrument_type <> 'sector_benchmark' then
    raise exception 'A sector assignment requires a sector benchmark instrument';
  end if;

  return new;
end;
$$;

create trigger validate_company_benchmark_assignment_before_insert
before insert on public.company_benchmark_assignments
for each row execute function public.validate_company_benchmark_assignment_insert();

create or replace function public.prevent_company_benchmark_assignment_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'company_benchmark_assignments rows are append-only';
end;
$$;

create trigger prevent_company_benchmark_assignment_update
before update on public.company_benchmark_assignments
for each row execute function public.prevent_company_benchmark_assignment_mutation();

create trigger prevent_company_benchmark_assignment_delete
before delete on public.company_benchmark_assignments
for each row execute function public.prevent_company_benchmark_assignment_mutation();

create or replace function public.prevent_daily_price_observation_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'daily_price_observations rows are append-only';
end;
$$;

create trigger prevent_daily_price_observation_update
before update on public.daily_price_observations
for each row execute function public.prevent_daily_price_observation_mutation();

create trigger prevent_daily_price_observation_delete
before delete on public.daily_price_observations
for each row execute function public.prevent_daily_price_observation_mutation();

alter table public.price_instruments enable row level security;
alter table public.company_benchmark_assignments enable row level security;
alter table public.daily_price_observations enable row level security;

insert into public.price_instruments (
  company_id,
  symbol,
  display_name,
  instrument_type,
  provider_name,
  provider_symbol,
  is_active
)
select
  id,
  ticker,
  legal_name,
  'company_stock',
  'tiingo',
  ticker,
  is_active
from public.companies
on conflict do nothing;

insert into public.price_instruments (
  symbol,
  display_name,
  instrument_type,
  provider_name,
  provider_symbol
)
values
  ('SPY', 'SPDR S&P 500 ETF Trust', 'market_benchmark', 'tiingo', 'SPY'),
  ('XLK', 'Technology Select Sector SPDR Fund', 'sector_benchmark', 'tiingo', 'XLK'),
  ('XLY', 'Consumer Discretionary Select Sector SPDR Fund', 'sector_benchmark', 'tiingo', 'XLY'),
  ('XLC', 'Communication Services Select Sector SPDR Fund', 'sector_benchmark', 'tiingo', 'XLC')
on conflict do nothing;

insert into public.company_benchmark_assignments (
  company_id,
  benchmark_instrument_id,
  benchmark_role,
  mapping_version,
  applicable_from,
  rationale
)
select
  company.id,
  benchmark.id,
  'market',
  'benchmark-proxy-v1',
  date '2026-10-29',
  'SPY is the first PoC proxy for broad US market performance.'
from public.companies as company
join public.price_instruments as benchmark
  on benchmark.symbol = 'SPY'
 and benchmark.instrument_type = 'market_benchmark'
where company.is_active = true
on conflict do nothing;

with sector_mappings (company_ticker, benchmark_symbol, rationale) as (
  values
    ('AAPL', 'XLK', 'XLK is the first PoC technology-sector proxy for Apple.'),
    ('MSFT', 'XLK', 'XLK is the first PoC technology-sector proxy for Microsoft.'),
    ('AMZN', 'XLY', 'XLY is the first PoC consumer-discretionary proxy for Amazon.'),
    ('GOOGL', 'XLC', 'XLC is the first PoC communication-services proxy for Alphabet.'),
    ('META', 'XLC', 'XLC is the first PoC communication-services proxy for Meta.')
)
insert into public.company_benchmark_assignments (
  company_id,
  benchmark_instrument_id,
  benchmark_role,
  mapping_version,
  applicable_from,
  rationale
)
select
  company.id,
  benchmark.id,
  'sector',
  'benchmark-proxy-v1',
  date '2026-10-29',
  sector_mappings.rationale
from sector_mappings
join public.companies as company
  on company.ticker = sector_mappings.company_ticker
join public.price_instruments as benchmark
  on benchmark.symbol = sector_mappings.benchmark_symbol
 and benchmark.instrument_type = 'sector_benchmark'
on conflict do nothing;

comment on table public.price_instruments is
  'Company stocks and benchmark symbols whose end-of-day prices Chiron can collect.';

comment on table public.company_benchmark_assignments is
  'Append-only, versioned research-proxy mappings used to compare a company with the market and its sector.';

comment on column public.company_benchmark_assignments.applicable_from is
  'The first event or price date for which this benchmark mapping may be selected.';

comment on table public.daily_price_observations is
  'Append-only versions of end-of-day provider values. A provider correction creates another row.';

comment on column public.daily_price_observations.observation_sha256 is
  'Fingerprint of the canonical provider symbol, trading date, and complete price values.';
