# Operations runbook

This guide separates automatic collection, manual research actions, safe previews, writes, external
requests, and paid work.

## Scheduled GitHub workflows

GitHub cron expressions use UTC.

| Workflow | Cron | Plain-language schedule | Purpose |
| --- | --- | --- | --- |
| `sec-filings.yml` | `17 * * * 1-5` | At minute 17 of every UTC hour, Monday–Friday | Discover filings, preserve documents, group events, extract readable text and financial values, then calculate derived metrics. |
| `daily-prices.yml` | `15 2 * * 2-6` | 02:15 UTC Tuesday–Saturday | Collect the prior normal Monday–Friday U.S. session's end-of-day prices. |

Schedules are requests to GitHub, not exact timers. Runs may start late or occasionally be skipped.
The pipelines are designed to catch up:

- SEC discovery looks back across a bounded historical window and unique accession numbers prevent
  duplicate filings.
- Later document/event/extraction stages query work still missing for their version.
- Price synchronization overlaps recent stored dates, so a later run can recover missed sessions
  and provider corrections.

Weekend SEC scheduling is not required for the current workflow. A manual run or the next weekday
lookback can recover a filing that appeared outside the requested schedule.

## GitHub secrets

| Workflow | Required secrets |
| --- | --- |
| SEC filings | `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `SEC_USER_AGENT` |
| Daily prices | `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `TIINGO_API_TOKEN` |

Workflow logs should show summaries, IDs, and safe errors—not secret values or complete source
documents.

## Command safety matrix

`External` means the command can contact Supabase, SEC, Tiingo, Storage, or OpenAI. A preview may be
read-only while still requiring network access.

| Command | Read-only | Writes Supabase | External | Paid |
| --- | ---: | ---: | ---: | ---: |
| `pnpm worker:health` | Yes | No | Yes | No |
| `pnpm worker:validate-watchlist` | Yes | No | Yes | No |
| `pnpm worker:sync-filings` | No | Yes | SEC + Supabase | No |
| `pnpm worker:sync-documents` | No | Yes | SEC + Storage + Supabase | No |
| `pnpm worker:sync-events` | No | Yes | Supabase | No |
| `pnpm worker:extract-document-text` | No | Yes | Storage + Supabase | No |
| `pnpm worker:extract-financial-metrics` | No | Yes | Storage + Supabase | No |
| `pnpm worker:calculate-financial-derived-metrics` | No | Yes | Supabase | No |
| `pnpm worker:sync-prices` | No | Yes | Tiingo + Supabase | No provider charge expected under the configured plan, but provider limits apply |
| `pnpm worker:preview-qualitative` | Yes | No | Storage + Supabase | No |
| `pnpm worker:extract-qualitative ... --execute-paid-request` | No | Yes | OpenAI + Storage + Supabase | **Yes** |
| `pnpm worker:review-qualitative` | No | Yes | Storage + Supabase | No |
| `pnpm worker:report-qualitative-quality` | Yes | No | Supabase | No |
| `pnpm worker:preview-prediction` | Yes | No | Supabase | No |
| `pnpm worker:create-prediction` | No | Yes | Supabase | No |
| `pnpm worker:preview-evaluation` | Yes | No | Supabase | No |
| `pnpm worker:create-evaluation` | No | Yes | Supabase | No |
| Historical `preview-*` commands | Yes | No | Storage/Supabase as needed | No |
| Historical `create-*` commands | No | Yes | Supabase | No |
| `pnpm worker:backfill-historical-prices` | No | Yes | Tiingo + Supabase | No provider charge expected under the configured plan, but provider limits apply |
| `pnpm worker:extract-historical-qualitative ... --execute-paid-request` | No | Yes | OpenAI + Storage + Supabase | **Yes** |

Tests, type-checking, and builds must not contact these services.

## Normal manual checks

Use this order after a new setup or when diagnosing the pipeline:

```text
pnpm worker:health
pnpm worker:validate-watchlist
pnpm worker:sync-filings
pnpm worker:sync-documents
pnpm worker:sync-events
pnpm worker:extract-document-text
pnpm worker:extract-financial-metrics
pnpm worker:calculate-financial-derived-metrics
```

These are operational commands. Inspect the configured project before running them; a local shell
can point at the same shared Supabase project used by GitHub Actions.

## Failure handling

1. Read the failing step and safe error message.
2. Check `job_runs` for the command, start time, completion time, status, and error summary.
3. Determine whether the command is a safe idempotent/catch-up operation or a paid append-only
   attempt.
4. Verify database state before rerunning when terminal output is missing or truncated.
5. Fix configuration or source problems, then rerun only the required stage.

Collection stages are designed to skip unchanged work and repair common partial failures. Do not
delete successful rows merely to force a rerun.

Paid extraction is different. The OpenAI response and Supabase insert cannot be one transaction. If
the provider call may have succeeded but saving failed, inspect provider and database records before
trying again. Automatic retries are disabled, and a failed append-only attempt requires deliberate
investigation and versioning.

## Stopping workflows

- Disable a workflow from the repository's Actions interface to stop future scheduled requests.
- Canceling a running workflow stops later steps but cannot undo completed database or provider
  operations.
- Removing a cron line changes future scheduling only after the change reaches the default branch.
- Keep `workflow_dispatch` when manual recovery remains useful.

## Free-plan expectations

The initial watchlist and once-per-session price collection are intentionally small. Free plans can
change their quotas, so treat provider limits as configuration to monitor rather than permanent
facts. The application avoids unnecessary requests through overlap, fingerprints, and missing-work
queries, but it does not promise that every future watchlist size will fit a free tier.

## Handoff after an operational session

Record:

- exact command and target event/prediction IDs;
- whether the action was preview, write, external request, or paid call;
- created row IDs and fingerprints;
- token/request counts when applicable;
- what was manually reviewed;
- the exact next safe step;
- operations that must not be repeated.

Never record credentials, document bodies, licensed prices, or raw private provider output in a
public document.

