-- Earlier grouping code used the SEC publication time here. For an auditable live
-- track record, detected_at must instead mean when Chiron created the event row.
update public.earnings_events
set detected_at = created_at
where grouping_metadata ->> 'ruleVersion' = 'sec-event-grouping-v1'
  and detected_at <> created_at;

comment on column public.earnings_events.detected_at is
  'When Chiron first created this earnings event; SEC publication times remain on source records.';
