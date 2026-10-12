# Chiron Core

Chiron Core is an open-source research application for collecting company earnings reports, extracting evidence, freezing point-in-time research scores, and later measuring what happened to the stock.

It is a research and learning project. It does not provide personal investment advice, execute trades, or promise profitable results.

## Current phase

Phase 1 provides:

- A Vue 3 dashboard that runs with clearly labelled demonstration data.
- A TypeScript worker foundation.
- Shared domain types.
- An initial Supabase/PostgreSQL schema.
- Safe environment-variable templates.
- Separate boundaries for future private research code.

SEC metadata ingestion is active. The worker can classify earnings-related filings with a
versioned transparent rule, preserve primary documents and Exhibit 99.1 earnings releases,
and group related filings into earnings events.
LLM extraction, stock prices, and predictions are not active yet.

## Requirements

- Node.js 22 or later
- pnpm 11 or later

## Run the demonstration

```bash
pnpm install
pnpm dev
```

The dashboard is available at the URL printed by Vite. Demo mode does not require Supabase or API keys.

## Repository layout

```text
apps/web       Vue dashboard
apps/worker    Background-processing foundation
packages/shared Shared TypeScript domain types
supabase       Database migrations
```

See [Database guide](docs/database.md) for a plain-language explanation of every table,
their relationships, and the private SEC document bucket.

See [Visual code guide](docs/visual-guide.md) for Mermaid diagrams explaining the project,
its files, worker functions, database relationships, and the future research pipeline.

## Environment variables

Copy `.env.example` to `.env` only when connecting external services. Never commit `.env`.

The Supabase secret key belongs only in server-side code. It must never be placed in the Vue application or shared through chat, email, logs, or source control.

After applying the Supabase migrations, verify the connection and run the filing sync:

```bash
pnpm worker:health
pnpm worker:sync-filings
pnpm worker:sync-documents
pnpm worker:sync-events
```

The first document rule treats `10-Q` and `10-K` financial reports as earnings-related. It
also includes `8-K` filings containing SEC item `2.02`, which means results of operations
and financial condition. Other `8-K` filings are retained as metadata but are not downloaded.

For an earnings-related `8-K`, the worker also checks the SEC filing index for Exhibit `99.1`,
which commonly contains the detailed earnings press release. Event grouping uses a `10-Q` or
`10-K` reported period as its anchor and attaches the nearest item `2.02` filing within seven
days. Fiscal year and quarter remain empty until structured SEC data can establish them.

Every scheduled command records its start time, completion status, and result counts in
`job_runs`, including runs that correctly find no new filings.

The scheduled GitHub workflow requires `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, and `SEC_USER_AGENT` repository secrets. Enable it only after the local sync succeeds.
It checks once per hour on weekdays to keep free-tier usage comfortably low.

## Data sources planned

- SEC EDGAR for filings and structured financial facts.
- Tiingo for personal end-of-day price research.
- A replaceable structured-output LLM provider for qualitative extraction.

## License

Licensed under Apache License 2.0. See `LICENSE`.
