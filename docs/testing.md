# Testing and validation guide

Chiron separates deterministic software validation from live operational checks. A command that
writes Supabase or contacts a provider is not a test.

## Main commands

| Command | What it does | What it does not do |
| --- | --- | --- |
| `pnpm typecheck` | Type-checks every workspace package. | Does not build runtime files or run tests. |
| `pnpm build` | Builds every package. | Does not run package tests. |
| `pnpm test` | Runs every package's declared test script. | Does not contact live providers. |
| `pnpm check` | Runs type-checking and builds. | **Does not run tests.** |

On a fresh checkout, build `@chiron/shared` before starting apps because its runtime import points
to `packages/shared/dist/index.js`:

```text
pnpm --filter @chiron/shared build
```

## Focused package commands

```text
pnpm --filter @chiron/worker test
pnpm --filter @chiron/api test
pnpm --filter @chiron/web test
pnpm --filter @chiron/shared test
```

Worker and API tests use Node's test runner through `tsx`. Web and Shared currently declare
`node --test`; an exit code of zero does not imply comprehensive UI or shared-schema coverage.

## What to run by change type

| Change | Minimum validation |
| --- | --- |
| Worker behavior | Focused Worker tests, then `pnpm check`. |
| GraphQL schema/repository | API tests, type-check, build; verify affected query locally. |
| Vue behavior or styling | Web type-check/build plus browser inspection of the affected state. |
| Shared runtime schema | Shared build, affected Worker/API tests, then `pnpm check`. |
| Migration | SQL review, application query review, and testing against a disposable database when risk warrants it. Do not apply to a shared project as routine validation. |
| Documentation only | `git diff --check`, verify paths/commands/links; unrelated tests are unnecessary. |
| Cross-package change | `pnpm test` and `pnpm check`. |

## Test boundaries

- Use deterministic fixtures and mocked provider/database boundaries.
- Never use a real OpenAI key in tests.
- Never make a paid request from tests, CI, builds, or type-checking.
- Do not depend on live SEC, Tiingo, Supabase, current dates, or network availability.
- Include success and failure cases for timestamps, fingerprints, source roles, validation, and
  append-only behavior.
- Preserve exact decimal/string handling for financial values; avoid floating-point assumptions in
  deterministic extraction tests.

## Browser verification

Type-checking cannot detect white-on-white text, overflow, loading-state problems, or misleading
financial labels. For dashboard changes:

1. build Shared;
2. run `pnpm dev` with a safe configured database;
3. inspect loading, empty, error, and populated states;
4. check narrow and wide layouts when the component is responsive;
5. verify percentages, percentage points, dates, null values, and historical/forward labels.

Do not expose `.env`, network authorization headers, or full private records while capturing logs or
screenshots.

## Before handoff

1. Check both `git status --short` and the final diff.
2. Preserve unrelated edits.
3. Run the proportional validations above.
4. Report exact commands and results.
5. State checks that were intentionally not run.
6. Do not infer that a successful local test means a migration was applied, a workflow ran, or an
   external write succeeded.

