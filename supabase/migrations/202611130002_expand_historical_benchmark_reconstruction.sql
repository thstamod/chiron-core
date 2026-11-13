begin;

insert into public.company_benchmark_assignments (
  company_id,
  benchmark_instrument_id,
  benchmark_role,
  mapping_version,
  applicable_from,
  rationale
)
select
  forward_assignment.company_id,
  forward_assignment.benchmark_instrument_id,
  forward_assignment.benchmark_role,
  'benchmark-proxy-historical-2024-v1',
  date '2024-01-01',
  format(
    'Retrospective 2024-2025 research proxy copied from %s. It was created later and does not prove Chiron observed or would have selected this mapping at the historical date.',
    forward_assignment.mapping_version
  )
from public.company_benchmark_assignments as forward_assignment
where forward_assignment.mapping_version = 'benchmark-proxy-v2'
  and forward_assignment.applicable_from = date '2026-11-02'
on conflict (company_id, benchmark_role, applicable_from) do nothing;

do $$
declare
  invalid_assignment_count integer;
begin
  select count(*)
  into invalid_assignment_count
  from public.company_benchmark_assignments as forward_assignment
  left join public.company_benchmark_assignments as historical_assignment
    on historical_assignment.company_id = forward_assignment.company_id
   and historical_assignment.benchmark_role = forward_assignment.benchmark_role
   and historical_assignment.applicable_from = date '2024-01-01'
  where forward_assignment.mapping_version = 'benchmark-proxy-v2'
    and forward_assignment.applicable_from = date '2026-11-02'
    and (
      historical_assignment.id is null
      or historical_assignment.benchmark_instrument_id
        <> forward_assignment.benchmark_instrument_id
      or historical_assignment.mapping_version
        <> 'benchmark-proxy-historical-2024-v1'
    );

  if invalid_assignment_count > 0 then
    raise exception
      'Expanded historical benchmark reconstruction is missing or differs for % assignments',
      invalid_assignment_count;
  end if;
end;
$$;

commit;
