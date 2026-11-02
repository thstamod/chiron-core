begin;

create temporary table proposed_company_additions (
  cik text primary key,
  legal_name text not null,
  ticker text not null unique,
  exchange text not null,
  sector text not null
) on commit drop;

insert into proposed_company_additions (cik, legal_name, ticker, exchange, sector)
values
  ('0001045810', 'NVIDIA CORP', 'NVDA', 'NASDAQ', 'Information Technology'),
  ('0001730168', 'Broadcom Inc.', 'AVGO', 'NASDAQ', 'Information Technology'),
  ('0001341439', 'ORACLE CORP', 'ORCL', 'NYSE', 'Information Technology'),
  ('0001108524', 'Salesforce, Inc.', 'CRM', 'NYSE', 'Information Technology'),
  ('0001283699', 'T-Mobile US, Inc.', 'TMUS', 'NASDAQ', 'Communication Services'),
  ('0001744489', 'Walt Disney Co', 'DIS', 'NYSE', 'Communication Services'),
  ('0001318605', 'Tesla, Inc.', 'TSLA', 'NASDAQ', 'Consumer Discretionary'),
  ('0000354950', 'HOME DEPOT, INC.', 'HD', 'NYSE', 'Consumer Discretionary'),
  ('0000063908', 'MCDONALDS CORP', 'MCD', 'NYSE', 'Consumer Discretionary'),
  ('0000104169', 'Walmart Inc.', 'WMT', 'NASDAQ', 'Consumer Staples'),
  ('0000909832', 'COSTCO WHOLESALE CORP /NEW', 'COST', 'NASDAQ', 'Consumer Staples'),
  ('0000080424', 'PROCTER & GAMBLE Co', 'PG', 'NYSE', 'Consumer Staples'),
  ('0000059478', 'ELI LILLY & Co', 'LLY', 'NYSE', 'Health Care'),
  ('0000200406', 'JOHNSON & JOHNSON', 'JNJ', 'NYSE', 'Health Care'),
  ('0000731766', 'UNITEDHEALTH GROUP INC', 'UNH', 'NYSE', 'Health Care'),
  ('0000018230', 'CATERPILLAR INC', 'CAT', 'NYSE', 'Industrials'),
  ('0000040545', 'GENERAL ELECTRIC CO', 'GE', 'NYSE', 'Industrials'),
  ('0000101829', 'RTX Corp', 'RTX', 'NYSE', 'Industrials'),
  ('0000093410', 'CHEVRON CORP', 'CVX', 'NYSE', 'Energy'),
  ('0001163165', 'CONOCOPHILLIPS', 'COP', 'NYSE', 'Energy'),
  ('0000019617', 'JPMORGAN CHASE & CO', 'JPM', 'NYSE', 'Financials'),
  ('0001403161', 'VISA INC.', 'V', 'NYSE', 'Financials'),
  ('0001707925', 'LINDE PLC', 'LIN', 'NASDAQ', 'Materials'),
  ('0000753308', 'NEXTERA ENERGY INC', 'NEE', 'NYSE', 'Utilities'),
  ('0001045609', 'Prologis, Inc.', 'PLD', 'NYSE', 'Real Estate');

do $$
begin
  if exists (
    select 1
    from proposed_company_additions as proposed
    join public.companies as existing
      on existing.ticker = proposed.ticker
     and existing.cik <> proposed.cik
  ) then
    raise exception 'A proposed ticker already belongs to a different SEC CIK';
  end if;
end;
$$;

insert into public.companies (cik, legal_name, ticker, exchange, sector)
select cik, legal_name, ticker, exchange, sector
from proposed_company_additions
on conflict (cik) do nothing;

update public.companies
set sector = 'Consumer Discretionary'
where cik = '0001018724'
  and ticker = 'AMZN'
  and sector = 'Consumer';

do $$
declare
  invalid_companies text;
begin
  select string_agg(proposed.ticker, ', ' order by proposed.ticker)
  into invalid_companies
  from proposed_company_additions as proposed
  left join public.companies as company
    on company.cik = proposed.cik
  where company.id is null
     or company.legal_name <> proposed.legal_name
     or company.ticker <> proposed.ticker
     or company.exchange <> proposed.exchange
     or company.sector <> proposed.sector
     or company.is_active is not true;

  if invalid_companies is not null then
    raise exception 'Proposed company rows were missing or different: %', invalid_companies;
  end if;

  if not exists (
    select 1
    from public.companies
    where cik = '0001018724'
      and ticker = 'AMZN'
      and sector = 'Consumer Discretionary'
      and is_active is true
  ) then
    raise exception 'Amazon sector standardization could not be verified';
  end if;
end;
$$;

create temporary table frozen_sector_mappings (
  company_ticker text primary key,
  benchmark_symbol text not null
) on commit drop;

insert into frozen_sector_mappings (company_ticker, benchmark_symbol)
values
  ('AAPL', 'XLK'),
  ('MSFT', 'XLK'),
  ('AMZN', 'XLY'),
  ('GOOGL', 'XLC'),
  ('META', 'XLC'),
  ('NVDA', 'XLK'),
  ('AVGO', 'XLK'),
  ('ORCL', 'XLK'),
  ('CRM', 'XLK'),
  ('TMUS', 'XLC'),
  ('DIS', 'XLC'),
  ('TSLA', 'XLY'),
  ('HD', 'XLY'),
  ('MCD', 'XLY'),
  ('WMT', 'XLP'),
  ('COST', 'XLP'),
  ('PG', 'XLP'),
  ('LLY', 'XLV'),
  ('JNJ', 'XLV'),
  ('UNH', 'XLV'),
  ('CAT', 'XLI'),
  ('GE', 'XLI'),
  ('RTX', 'XLI'),
  ('CVX', 'XLE'),
  ('COP', 'XLE'),
  ('JPM', 'XLF'),
  ('V', 'XLF'),
  ('LIN', 'XLB'),
  ('NEE', 'XLU'),
  ('PLD', 'XLRE');

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
  company.id,
  company.ticker,
  company.legal_name,
  'company_stock',
  'tiingo',
  company.ticker,
  true
from frozen_sector_mappings as mapping
join public.companies as company
  on company.ticker = mapping.company_ticker
on conflict (provider_name, provider_symbol) do nothing;

create temporary table frozen_sector_benchmarks (
  symbol text primary key,
  display_name text not null
) on commit drop;

insert into frozen_sector_benchmarks (symbol, display_name)
values
  ('XLK', 'Technology Select Sector SPDR Fund'),
  ('XLC', 'Communication Services Select Sector SPDR Fund'),
  ('XLY', 'Consumer Discretionary Select Sector SPDR Fund'),
  ('XLP', 'Consumer Staples Select Sector SPDR Fund'),
  ('XLV', 'Health Care Select Sector SPDR Fund'),
  ('XLI', 'Industrial Select Sector SPDR Fund'),
  ('XLE', 'Energy Select Sector SPDR Fund'),
  ('XLF', 'Financial Select Sector SPDR Fund'),
  ('XLB', 'Materials Select Sector SPDR Fund'),
  ('XLU', 'Utilities Select Sector SPDR Fund'),
  ('XLRE', 'Real Estate Select Sector SPDR Fund');

insert into public.price_instruments (
  symbol,
  display_name,
  instrument_type,
  provider_name,
  provider_symbol,
  is_active
)
select
  symbol,
  display_name,
  'sector_benchmark',
  'tiingo',
  symbol,
  true
from frozen_sector_benchmarks
on conflict (provider_name, provider_symbol) do nothing;

do $$
declare
  invalid_instruments text;
begin
  select string_agg(mapping.company_ticker, ', ' order by mapping.company_ticker)
  into invalid_instruments
  from frozen_sector_mappings as mapping
  join public.companies as company
    on company.ticker = mapping.company_ticker
  left join public.price_instruments as instrument
    on instrument.company_id = company.id
  where instrument.id is null
     or instrument.symbol <> company.ticker
     or instrument.display_name <> company.legal_name
     or instrument.instrument_type <> 'company_stock'
     or instrument.provider_name <> 'tiingo'
     or instrument.provider_symbol <> company.ticker
     or instrument.currency <> 'USD'
     or instrument.is_active is not true;

  if invalid_instruments is not null then
    raise exception 'Company price instruments were missing or different: %', invalid_instruments;
  end if;

  select string_agg(benchmark.symbol, ', ' order by benchmark.symbol)
  into invalid_instruments
  from frozen_sector_benchmarks as benchmark
  left join public.price_instruments as instrument
    on instrument.provider_name = 'tiingo'
   and instrument.provider_symbol = benchmark.symbol
  where instrument.id is null
     or instrument.company_id is not null
     or instrument.symbol <> benchmark.symbol
     or instrument.display_name <> benchmark.display_name
     or instrument.instrument_type <> 'sector_benchmark'
     or instrument.currency <> 'USD'
     or instrument.is_active is not true;

  if invalid_instruments is not null then
    raise exception 'Sector benchmark instruments were missing or different: %', invalid_instruments;
  end if;
end;
$$;

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
  market_benchmark.id,
  'market',
  'benchmark-proxy-v2',
  date '2026-11-02',
  'SPY is the frozen benchmark-proxy-v2 broad US market proxy.'
from frozen_sector_mappings as mapping
join public.companies as company
  on company.ticker = mapping.company_ticker
join public.price_instruments as market_benchmark
  on market_benchmark.provider_name = 'tiingo'
 and market_benchmark.provider_symbol = 'SPY'
 and market_benchmark.instrument_type = 'market_benchmark'
on conflict (company_id, benchmark_role, applicable_from) do nothing;

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
  sector_benchmark.id,
  'sector',
  'benchmark-proxy-v2',
  date '2026-11-02',
  format(
    '%s is the frozen benchmark-proxy-v2 sector proxy for %s.',
    mapping.benchmark_symbol,
    mapping.company_ticker
  )
from frozen_sector_mappings as mapping
join public.companies as company
  on company.ticker = mapping.company_ticker
join public.price_instruments as sector_benchmark
  on sector_benchmark.provider_name = 'tiingo'
 and sector_benchmark.provider_symbol = mapping.benchmark_symbol
 and sector_benchmark.instrument_type = 'sector_benchmark'
on conflict (company_id, benchmark_role, applicable_from) do nothing;

do $$
declare
  invalid_assignments text;
begin
  select string_agg(mapping.company_ticker, ', ' order by mapping.company_ticker)
  into invalid_assignments
  from frozen_sector_mappings as mapping
  join public.companies as company
    on company.ticker = mapping.company_ticker
  left join public.company_benchmark_assignments as assignment
    on assignment.company_id = company.id
   and assignment.benchmark_role = 'market'
   and assignment.applicable_from = date '2026-11-02'
  left join public.price_instruments as benchmark
    on benchmark.id = assignment.benchmark_instrument_id
  where assignment.id is null
     or assignment.mapping_version <> 'benchmark-proxy-v2'
     or benchmark.provider_name <> 'tiingo'
     or benchmark.provider_symbol <> 'SPY'
     or benchmark.instrument_type <> 'market_benchmark';

  if invalid_assignments is not null then
    raise exception 'Market benchmark assignments were missing or different: %', invalid_assignments;
  end if;

  select string_agg(mapping.company_ticker, ', ' order by mapping.company_ticker)
  into invalid_assignments
  from frozen_sector_mappings as mapping
  join public.companies as company
    on company.ticker = mapping.company_ticker
  left join public.company_benchmark_assignments as assignment
    on assignment.company_id = company.id
   and assignment.benchmark_role = 'sector'
   and assignment.applicable_from = date '2026-11-02'
  left join public.price_instruments as benchmark
    on benchmark.id = assignment.benchmark_instrument_id
  where assignment.id is null
     or assignment.mapping_version <> 'benchmark-proxy-v2'
     or benchmark.provider_name <> 'tiingo'
     or benchmark.provider_symbol <> mapping.benchmark_symbol
     or benchmark.instrument_type <> 'sector_benchmark';

  if invalid_assignments is not null then
    raise exception 'Sector benchmark assignments were missing or different: %', invalid_assignments;
  end if;
end;
$$;

commit;
