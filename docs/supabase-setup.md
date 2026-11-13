# Supabase setup and migrations

Chiron uses Supabase as a hosted PostgreSQL database and private document store. The application
uses ordinary PostgreSQL structures, so Supabase is a hosting choice rather than a separate data
model.

## What you need

- A Supabase project.
- The project URL.
- A server-side secret key with permission to use the database and Storage.
- Node.js 22 or later and the repository's pinned pnpm version.

The current Core code does not use a browser publishable key. Never put the secret key in Vue code,
a `VITE_` variable, a committed file, a screenshot, or application output.

## Local environment

From the Core repository root, create `.env` from `.env.example` only when `.env` does not already
exist:

```text
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_SECRET_KEY=your-server-side-secret
```

`.env` and `.env.*` are ignored except for `.env.example`. Keep optional provider credentials empty
until a command actually requires them.

## Apply migrations

The repository currently stores ordered SQL files in `supabase/migrations/` and does not commit a
Supabase CLI `config.toml`. The supported initial setup is therefore:

1. Open the Supabase SQL editor for the intended project.
2. List `supabase/migrations/*.sql` in filename order.
3. Execute every migration once, from the oldest timestamp to the newest.
4. Stop on the first error. Do not skip ahead or edit an already-applied migration to force it
   through.
5. Record which migration failed and investigate the current database state before rerunning it.

Migration filenames begin with sortable timestamps. Core migrations create tables, constraints,
triggers, seed data, RLS configuration, and the private SEC-document bucket. Execute the SQL as
written; do not ask a dashboard helper to invent alternate policies or rewrite the migration.

After a migration has been applied to a shared project, never modify that migration file. Add a new
timestamped migration for every later schema or seed change.

## Row Level Security

Core migrations enable Row Level Security on application tables. No browser policy grants general
table access. This is intentional: Vue reads through the Node GraphQL API, and trusted worker/API
processes use the server-side secret.

RLS is not permission to expose the secret. A privileged key can bypass ordinary policies and must
remain server-side.

## Private Storage

The SEC ingestion migration creates a private `sec-documents` bucket. Original filing bytes and
derived readable text are not public URLs. Trusted worker and API code access them using server-side
credentials. The `documents` and `document_text_versions` tables preserve metadata and fingerprints.

## Verify the setup

Install dependencies and build the shared runtime package:

```text
pnpm install --frozen-lockfile
pnpm --filter @chiron/shared build
```

Then run:

```text
pnpm worker:health
pnpm worker:validate-watchlist
```

`worker:health` verifies that the configured server-side connection can reach the project.
`worker:validate-watchlist` is read-only and checks company, instrument, and benchmark relationships.

In the Supabase table editor, the current schema should include the tables described in
[Database guide](database.md). The exact count may grow as new migrations are added; verify names
and the newest applied migration instead of relying on a permanently fixed table count.

## Provider credentials

Add other secrets only for commands that need them:

| Variable | Used by | Notes |
| --- | --- | --- |
| `SEC_USER_AGENT` | SEC filing/document requests | Use an application name and a contact email. It is identification, not an API key. |
| `SEC_LOOKBACK_DAYS` | SEC filing discovery | Optional; defaults are validated by server code. |
| `TIINGO_API_TOKEN` | Price synchronization/backfill | Server-side only. |
| `OPENAI_API_KEY` | Explicit paid extraction | Server-side only; never required by previews or tests. |
| `OPENAI_MODEL` | Explicit paid extraction | The requested alias is recorded with the resolved model. |

GitHub Actions use repository secrets with the same names. GitHub workflows do not apply database
migrations.

## Adding a migration

1. Check the latest filename in `supabase/migrations/`.
2. Create a new later timestamped SQL file.
3. Preserve existing rows, fingerprints, and append-only history.
4. Add constraints and RLS deliberately.
5. Review triggers, application queries, and documentation together.
6. Test against a disposable database when the change is risky.
7. Apply it to a shared project only as an explicit operational action.

Never place private research data, provider output, or licensed price data in a public seed
migration. Public seeds should contain configuration or synthetic examples only.

## Common setup failures

| Symptom | Check |
| --- | --- |
| No tables appear | Confirm every migration was executed in filename order against the intended project. |
| Worker reports missing environment variables | Confirm `.env` is in the Core repository root and names match `.env.example`. |
| Browser cannot query Supabase directly | Expected; use the local GraphQL API. |
| Storage download fails | Confirm the bucket migration ran and the server-side key belongs to the same project URL. |
| Duplicate or constraint error during migration | Stop and inspect whether part or all of that migration was already applied. Do not delete history casually. |
| Git reports `.env` | Stop before committing and verify `.gitignore`; secrets must never enter Git history. |

