create or replace function public.validate_extraction_review_insert()
returns trigger
language plpgsql
as $$
declare
  source_provider_status text;
  source_validation_status text;
  source_output_sha256 text;
begin
  select provider_status, validation_status, output_sha256
    into source_provider_status, source_validation_status, source_output_sha256
  from public.extraction_runs
  where id = new.extraction_run_id;

  if source_provider_status <> 'completed' or source_output_sha256 is null then
    raise exception 'Only completed extraction output can be reviewed';
  end if;

  if new.reviewed_output_sha256 <> source_output_sha256 then
    raise exception 'Review output fingerprint does not match the extraction run';
  end if;

  if new.decision = 'accepted' and (
    source_validation_status is null
    or source_validation_status not in ('valid', 'needs_review')
  ) then
    raise exception 'Only valid or needs-review extraction output can be accepted';
  end if;

  return new;
end;
$$;
