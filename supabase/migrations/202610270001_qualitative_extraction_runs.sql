alter table public.extraction_runs
  alter column output drop not null,
  alter column output_sha256 drop not null,
  alter column validation_status drop not null,
  add column input_sha256 text not null,
  add column input_selection_version text not null,
  add column provider_name text not null,
  add column provider_request_id text,
  add column provider_status text not null
    check (provider_status in (
      'completed',
      'refused',
      'incomplete',
      'request_failed',
      'invalid_output'
    )),
  add column resolved_model_name text,
  add column failure_reason text,
  add column retryable boolean not null,
  add column started_at timestamptz not null,
  add column finished_at timestamptz not null,
  add column duration_milliseconds integer not null
    check (duration_milliseconds >= 0),
  add column token_usage jsonb not null,
  add column located_evidence jsonb,
  add column validation_errors jsonb,
  add constraint extraction_runs_finished_after_started
    check (finished_at >= started_at),
  add constraint extraction_runs_result_shape
    check (
      (
        provider_status = 'completed'
        and output is not null
        and output_sha256 is not null
        and validation_status is not null
        and failure_reason is null
        and retryable = false
        and (
          (
            validation_status = 'valid'
            and located_evidence is not null
            and validation_errors is null
          )
          or
          (
            validation_status in ('invalid', 'needs_review')
            and validation_errors is not null
          )
        )
      )
      or
      (
        provider_status <> 'completed'
        and output is null
        and output_sha256 is null
        and validation_status is null
        and located_evidence is null
        and validation_errors is null
        and failure_reason is not null
      )
    );

create index extraction_runs_event_created_idx
  on public.extraction_runs (earnings_event_id, created_at desc);

create or replace function public.prevent_extraction_run_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'extraction_runs rows are append-only';
end;
$$;

create trigger prevent_extraction_run_update
before update on public.extraction_runs
for each row execute function public.prevent_extraction_run_mutation();

create trigger prevent_extraction_run_delete
before delete on public.extraction_runs
for each row execute function public.prevent_extraction_run_mutation();

comment on table public.extraction_runs is
  'Append-only records of every qualitative LLM extraction attempt, including failures.';

comment on column public.extraction_runs.input_sha256 is
  'Fingerprint of the complete versioned input manifest supplied to the extraction process.';

comment on column public.extraction_runs.located_evidence is
  'Exact character locations found when validating model evidence against readable source text.';

comment on column public.extraction_runs.validation_errors is
  'Validation problems preserved when a completed provider output fails evidence checks.';

comment on column public.extraction_runs.retryable is
  'Provider classification metadata only. Chiron does not automatically retry the request.';
