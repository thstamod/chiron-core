# Contributing to Chiron Core

## Purpose and first steps

Chiron Core is a public earnings research application. It collects SEC documents, extracts traceable
financial and qualitative evidence, freezes point-in-time scores, and evaluates later stock returns.
It does not provide personal investment advice or execute trades.

Before making changes:

1. Read `README.md` and `CONTRIBUTING.md`.
2. Check `git status --short` and preserve unrelated work.
3. Read the relevant source, adjacent tests, and domain documentation before changing behavior.
4. Keep the change focused; update documentation when commands, configuration, or behavior change.

Useful references:

- `docs/README.md`: task-based documentation index and contributor reading paths.
- `docs/current-capabilities.md`: implemented, manual, partial, and deferred behavior.
- `docs/supabase-setup.md`: supported database setup, migrations, RLS, and secret handling.
- `docs/operations-runbook.md`: schedules, command safety, recovery, and operational handoff.
- `docs/testing.md`: proportional validation and live-service boundaries.
- `docs/database.md`: tables, relationships, and private document storage.
- `docs/visual-guide.md`: architecture and processing diagrams.
- `docs/graphql-api.md`: current GraphQL contract, examples, and security boundary.
- `docs/finance-glossary.md`: plain-language financial and research terms.
- `docs/scoring.md`: transparent scoring rules and limitations.
- `docs/qualitative-extraction.md`: qualitative input, passage IDs, evidence validation, review, and
  the safe operating sequence.
- `docs/prediction-audit-and-market-risk.md`: proposed research, not implemented product behavior.
- `docs/future-improvements.md`: future ideas, not a specification of existing functionality.

## Architecture and ownership

| Location | Responsibility |
| --- | --- |
| `apps/web/src/` | Vue 3 dashboard, API client, and presentation styles |
| `apps/api/src/` | Read-only Node GraphQL API and presentation of stored research |
| `apps/worker/src/` | SEC ingestion, document preservation, extraction, prices, predictions, and evaluations |
| `packages/shared/src/` | Shared domain types and qualitative-output validation schema |
| `supabase/migrations/` | Foundational PostgreSQL schema, constraints, and versioned seed changes |
| `.github/workflows/` | Scheduled SEC ingestion and daily price collection |

Keep privileged database access in the API and worker. The browser reads through `/graphql`; Vite
proxies it to `127.0.0.1:4000`. Keep the API read-only unless a change explicitly calls for a new
write boundary. The current API is for local development; public deployment requires authentication
and appropriate origin rules.

## Setup and commands

Run these commands from the `chiron-core` repository root. Use Node.js 22 or later and the pinned
package manager, `pnpm@11.25.0`. Keep `pnpm-lock.yaml` consistent with dependency changes.

```bash
pnpm install --frozen-lockfile
pnpm --filter @chiron/shared build
pnpm dev
```

Build the shared package before starting apps or running tests on a fresh checkout: its runtime
export points to `dist/index.js`. Rebuild it after changing shared runtime code.

For local service access, copy `.env.example` to `.env` if `.env` does not already exist, and fill in
only the required server-side values. Never overwrite an existing `.env` during setup.

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Run the API and Vue development servers |
| `pnpm dev:api` / `pnpm dev:web` | Run one application |
| `pnpm dev:worker` | Watch the worker health command; this connects to the configured database |
| `pnpm typecheck` | Type-check all packages |
| `pnpm build` | Build all packages |
| `pnpm test` | Run all package test scripts |
| `pnpm check` | Run type-checking and builds; does **not** run tests |
| `pnpm --filter @chiron/worker test` | Run worker tests |
| `pnpm --filter @chiron/api test` | Run API tests |

There is currently no lint script. API and worker tests use Node's test runner through `tsx`, with
tests beside the source as `*.test.ts`. Web and shared have `node --test` scripts; do not assume
those provide UI or shared-schema coverage.

## Code conventions

- Use strict TypeScript and the existing ESM conventions, including `.js` extensions on relative
  TypeScript imports and `import type` for type-only dependencies.
- Follow surrounding formatting: single quotes, no semicolons, and two-space indentation.
- Prefer complete domain names, verb-based function names, and `is`/`has`/`can`/`should` booleans.
- Use named options objects when positional arguments would be unclear.
- Keep functions focused and domain constants or rule versions in the appropriate constants module.
- Explain non-obvious reasons, assumptions, or constraints in comments; avoid narrating obvious code.
- Keep financial language understandable to non-specialists. Make missing evidence and incomplete
  outcomes visible instead of silently turning them into neutral or favorable values.

## Research and data invariants

- Preserve original archived documents. Readable text is a separate, versioned artifact.
- Preserve source references, exact evidence, publication and actual first-seen timestamps, rule
  versions, and content/input fingerprints so results remain reproducible.
- Keep financial extraction and calculations deterministic. Preserve XBRL scale, units, periods,
  and exact numeric handling; do not introduce floating-point rounding into exact extraction.
- Compare equivalent fiscal periods. Full-year values must not be represented as fourth-quarter
  values; year-over-year growth compares the same period in the prior year.
- Do not overwrite historical extraction or prediction records. Preserve immutable predictions,
  source manifests, frozen market sessions, and fingerprinted evaluations.
- Forward predictions must use information available at prediction time. Retrospective work uses
  historical reconstruction plans and must remain separate from the forward prediction record.
- Qualitative evidence must pass schema and exact-source validation. Prediction creation requires
  accepted or corrected human-reviewed qualitative output.
- Evaluate the frozen 1-, 5-, or 20-trading-day schedule using the versioned market calendar and
  appropriate benchmark mappings. Preserve `not_ready` when a session or required price is missing.
- Version changes to prompts, extraction rules, formulas, or scoring semantics; preserve the
  ability to interpret previously stored results.
- The earnings score is not a calibrated probability or a promise of positive stock returns.

## External services and database changes

Never commit or print `.env`, API keys, Supabase secrets, private datasets, or licensed market data.
Use `.env.example` for documented variable names and placeholders. Supabase, Tiingo, and OpenAI
credentials are server-only; never expose them through `VITE_` variables or browser code.

Worker sync, extraction, review, create, and evaluation commands may write to the configured
Supabase project or storage. They are operational commands, not a substitute for local tests.
Check the command implementation and target environment before running them. Use the documented
preview commands when inspecting proposed work, and check each preview's service dependencies.

Paid qualitative extraction is manual and requires `--execute-paid-request`. Run the corresponding
preview first, and make paid requests only when explicitly authorized for the task. Do not add paid
LLM calls to scheduled ingestion, automatic retries, or normal test runs.

For database changes, add a new timestamped SQL migration in `supabase/migrations/`; preserve
already-applied migration history. Review constraints, immutable-record protections, and storage
permissions together with application changes. Do not apply migrations to a shared or production
database as part of routine code validation.

## Validation and handoff

For behavior changes, add or update focused tests covering meaningful success and failure cases,
especially provenance, time cutoffs, validation, and immutability. Prefer deterministic fixtures and
mocked service boundaries over live SEC, Tiingo, Supabase, or OpenAI requests.

Before handing off a code change, build shared runtime exports when needed, run relevant tests,
then run `pnpm check`. Use `pnpm test` when changes span packages. For dashboard changes, also check
the affected UI in the browser when available; type-checking alone does not verify presentation.
Documentation-only changes need command/path/link verification rather than unrelated test runs.

Inspect the final diff for unrelated changes, secrets, and generated files. Report what changed,
what validation ran, and any checks that could not be completed. Contributions are under Apache-2.0,
as described in `CONTRIBUTING.md` and `LICENSE`.
