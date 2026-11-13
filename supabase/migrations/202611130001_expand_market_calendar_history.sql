begin;

with
holiday_dates (session_date) as (
  values
    (date '2024-01-01'),
    (date '2024-01-15'),
    (date '2024-02-19'),
    (date '2024-03-29'),
    (date '2024-05-27'),
    (date '2024-06-19'),
    (date '2024-07-04'),
    (date '2024-09-02'),
    (date '2024-11-28'),
    (date '2024-12-25'),
    (date '2025-01-01'),
    -- Official NYSE closure memo:
    -- https://www.nyse.com/publicdocs/nyse/markets/american-options/rule-interpretations/2025/National_Day_of_Mourning_20250102.pdf
    (date '2025-01-09'),
    (date '2025-01-20'),
    (date '2025-02-17'),
    (date '2025-04-18'),
    (date '2025-05-26'),
    (date '2025-06-19'),
    (date '2025-07-04'),
    (date '2025-09-01'),
    (date '2025-11-27'),
    (date '2025-12-25'),
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
    (date '2024-07-03'),
    (date '2024-11-29'),
    (date '2024-12-24'),
    (date '2025-07-03'),
    (date '2025-11-28'),
    (date '2025-12-24'),
    (date '2026-11-27'),
    (date '2026-12-24'),
    (date '2027-11-26'),
    (date '2028-07-03'),
    (date '2028-11-24')
),
calendar_dates (session_date) as (
  select generated_date::date
  from generate_series(
    date '2024-01-01',
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
  'us-equities-nyse-2024-2028-v1',
  case extract(year from calendar_dates.session_date)
    when 2024 then 'https://www.nyse.com/publicdocs/ICE_NYSE_2024_Yearly_Trading_Calendar.pdf'
    when 2025 then 'https://www.nyse.com/publicdocs/ICE_NYSE_2025_Yearly_Trading_Calendar.pdf'
    else 'https://www.nyse.com/trade/hours-calendars'
  end
from calendar_dates
left join holiday_dates
  on holiday_dates.session_date = calendar_dates.session_date
left join early_close_dates
  on early_close_dates.session_date = calendar_dates.session_date
where extract(isodow from calendar_dates.session_date) between 1 and 5
  and holiday_dates.session_date is null;

do $$
declare
  lin_entry_session public.market_sessions%rowtype;
  unexpected_carter_session_count integer;
begin
  select *
  into lin_entry_session
  from public.market_sessions
  where calendar_code = 'us_equities'
    and calendar_version = 'us-equities-nyse-2024-2028-v1'
    and opens_at > timestamptz '2025-08-01T10:04:08Z'
  order by opens_at
  limit 1;

  if lin_entry_session.session_date is distinct from date '2025-08-01'
    or lin_entry_session.opens_at is distinct from timestamptz '2025-08-01T13:30:00Z' then
    raise exception 'Expanded calendar does not select the expected LIN entry session';
  end if;

  select count(*)
  into unexpected_carter_session_count
  from public.market_sessions
  where calendar_code = 'us_equities'
    and calendar_version = 'us-equities-nyse-2024-2028-v1'
    and session_date = date '2025-01-09';

  if unexpected_carter_session_count <> 0 then
    raise exception 'Expanded calendar includes the January 9, 2025 NYSE closure';
  end if;
end;
$$;

comment on column public.market_sessions.calendar_version is
  'Explicit schedule version selected by prediction and evaluation rules; us-equities-nyse-2024-2028-v1 includes the January 9, 2025 national-day-of-mourning closure.';

commit;
