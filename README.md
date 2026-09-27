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

Real SEC ingestion, LLM extraction, stock prices, and predictions are intentionally not active yet.

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

## Environment variables

Copy `.env.example` to `.env` only when connecting external services. Never commit `.env`.

The Supabase secret key belongs only in server-side code. It must never be placed in the Vue application or shared through chat, email, logs, or source control.

## Data sources planned

- SEC EDGAR for filings and structured financial facts.
- Tiingo for personal end-of-day price research.
- A replaceable structured-output LLM provider for qualitative extraction.

## License

Licensed under Apache License 2.0. See `LICENSE`.
