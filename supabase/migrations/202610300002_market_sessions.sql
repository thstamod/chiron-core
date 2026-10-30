create table public.market_sessions (
  id uuid primary key default gen_random_uuid(),
  calendar_code text not null
    check (char_length(trim(calendar_code)) between 1 and 100),
  session_date date not null,
  opens_at timestamptz not null,
  closes_at timestamptz not null,
  session_type text not null
    check (session_type in ('regular', 'early_close')),
  calendar_version text not null
    check (char_length(trim(calendar_version)) between 1 and 100),
  source_url text not null
    check (char_length(trim(source_url)) between 1 and 2000),
  source_checked_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  check (opens_at < closes_at),
  unique (calendar_code, session_date, calendar_version)
);

create index market_sessions_version_date_idx
  on public.market_sessions (calendar_code, calendar_version, session_date);

create or replace function public.prevent_market_session_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'market_sessions rows are append-only';
end;
$$;

create trigger prevent_market_session_update
before update on public.market_sessions
for each row execute function public.prevent_market_session_mutation();

create trigger prevent_market_session_delete
before delete on public.market_sessions
for each row execute function public.prevent_market_session_mutation();

alter table public.market_sessions enable row level security;

with
holiday_dates (session_date) as (
  values
    (date '2026-01-01'),
    (date '2026-01-19'),
    (date '2026-02-16'),
    (date '2026-04-03'),
    (date '2026-05-25'),
    (date '2026-06-19'),
    (date '2026-07-03'),
    (date '2026-09-07'),
    (date '2026-11-26'),
    (date '2026-12-25'),
    (date '2027-01-01'),
    (date '2027-01-18'),
    (date '2027-02-15'),
    (date '2027-03-26'),
    (date '2027-05-31'),
    (date '2027-06-18'),
    (date '2027-07-05'),
    (date '2027-09-06'),
    (date '2027-11-25'),
    (date '2027-12-24'),
    (date '2028-01-17'),
    (date '2028-02-21'),
    (date '2028-04-14'),
    (date '2028-05-29'),
    (date '2028-06-19'),
    (date '2028-07-04'),
    (date '2028-09-04'),
    (date '2028-11-23'),
    (date '2028-12-25')
),
early_close_dates (session_date) as (
  values
    (date '2026-11-27'),
    (date '2026-12-24'),
    (date '2027-11-26'),
    (date '2028-07-03'),
    (date '2028-11-24')
),
calendar_dates (session_date) as (
  select generated_date::date
  from generate_series(
    date '2026-01-01',
    date '2028-12-31',
    interval '1 day'
  ) as generated_dates(generated_date)
)
insert into public.market_sessions (
  calendar_code,
  session_date,
  opens_at,
  closes_at,
  session_type,
  calendar_version,
  source_url
)
select
  'us_equities',
  calendar_dates.session_date,
  (calendar_dates.session_date + time '09:30') at time zone 'America/New_York',
  (
    calendar_dates.session_date
    + case
      when early_close_dates.session_date is not null then time '13:00'
      else time '16:00'
    end
  ) at time zone 'America/New_York',
  case
    when early_close_dates.session_date is not null then 'early_close'
    else 'regular'
  end,
  'us-equities-nyse-2026-2028-v1',
  'https://www.nyse.com/trade/hours-calendars'
from calendar_dates
left join holiday_dates
  on holiday_dates.session_date = calendar_dates.session_date
left join early_close_dates
  on early_close_dates.session_date = calendar_dates.session_date
where extract(isodow from calendar_dates.session_date) between 1 and 5
  and holiday_dates.session_date is null;

comment on table public.market_sessions is
  'Append-only, versioned scheduled US equity sessions used for reference-price and evaluation rules.';

comment on column public.market_sessions.opens_at is
  'Official scheduled core-session open converted from 09:30 America/New_York to an absolute timestamp.';

comment on column public.market_sessions.closes_at is
  'Official scheduled core-session close, including published 13:00 America/New_York early closes.';

comment on column public.market_sessions.calendar_version is
  'Explicit schedule version selected by prediction and evaluation rules; later revisions add a new version.';
