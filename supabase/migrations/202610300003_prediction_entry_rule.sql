alter table public.predictions
  add column entry_calendar_code text not null
    check (char_length(trim(entry_calendar_code)) between 1 and 100),
  add column entry_calendar_version text not null
    check (char_length(trim(entry_calendar_version)) between 1 and 100),
  add column reference_price_rule_version text not null
    check (char_length(trim(reference_price_rule_version)) between 1 and 100),
  add constraint predictions_planned_entry_session_fkey
    foreign key (
      entry_calendar_code,
      planned_entry_session,
      entry_calendar_version
    )
    references public.market_sessions (
      calendar_code,
      session_date,
      calendar_version
    );

comment on column public.predictions.entry_calendar_code is
  'Market calendar used to select the planned entry session.';

comment on column public.predictions.entry_calendar_version is
  'Immutable schedule version used to select the planned entry session.';

comment on column public.predictions.reference_price_rule_version is
  'Versioned rule that selected the first market opening strictly after the prediction cutoff.';
