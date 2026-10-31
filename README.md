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
group related filings into earnings events, and create versioned readable-text copies for later
extraction. It also extracts four basic GAAP values from inline XBRL in periodic reports: revenue,
net income, basic earnings per share, and diluted earnings per share. It then calculates standard
year-over-year revenue growth, net margin, and year-over-year margin change when comparable data is
available. A public qualitative-output schema, baseline prompt, replaceable provider interface,
OpenAI adapter, and exact source-evidence validator now define the qualitative-extraction
foundation. A manual single-event command can invoke the LLM only with an explicit paid-request
flag; it is never scheduled automatically. A manual command can collect validated, versioned daily
prices, but it is not scheduled yet and predictions are not active.

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

See [Transparent scoring](docs/scoring.md) for the initial `-5…+5` point rules and the assumptions
that must be validated before drawing conclusions from their results.

## Environment variables

Copy `.env.example` to `.env` only when connecting external services. Never commit `.env`.

The Supabase secret key belongs only in server-side code. It must never be placed in the Vue application or shared through chat, email, logs, or source control.

The OpenAI API key is also server-only. `OPENAI_API_KEY` and `OPENAI_MODEL` are required only by the
explicit qualitative-extraction command. The preview and scheduled ingestion commands neither load
the key nor make paid LLM requests.

The Tiingo token is server-only and is sent in an authorization header rather than placed in a URL.
The price client validates provider responses. The manual price-sync command bootstraps 90 calendar
days for a new symbol, then overlaps the latest stored trading date by 45 days to recover missed
runs, recent provider corrections, and adjusted prices across the 20-trading-day evaluation window:

```bash
pnpm worker:sync-prices
```

The command processes active Tiingo instruments sequentially, stores only new or changed values,
and records its outcome in `job_runs`. A separate GitHub workflow requests one run at 02:15 UTC
from Tuesday through Saturday, after each normal Monday-through-Friday US trading session. GitHub
may delay or occasionally skip a scheduled run; the date range begins before the latest stored
session, so a later run recovers missing trading days.

The versioned `market_sessions` calendar initially records official scheduled US equity sessions
for 2026–2028, including exchange holidays, daylight-saving time, and published early closes. It is
the foundation for choosing realistic reference prices and counting 1, 5, and 20 trading days.

After applying the Supabase migrations, verify the connection and run the filing sync:

```bash
pnpm worker:health
pnpm worker:sync-filings
pnpm worker:sync-documents
pnpm worker:sync-events
pnpm worker:extract-document-text
pnpm worker:extract-financial-metrics
pnpm worker:calculate-financial-derived-metrics
```

To inspect the exact qualitative input for one event without calling OpenAI, run:

```bash
pnpm worker:preview-qualitative <earnings-event-id>
```

The preview downloads and verifies the current and optional previous Exhibit 99.1 readable text,
then prints only document metadata, fingerprints, character counts, and a rough token estimate. It
also reports which source categories are included and excluded. It does not print document text,
use the OpenAI key, write an extraction row, or make a paid request. The MVP does not treat an empty
risk list as evidence that a company is safe; it means no event-specific risk was found in the
supplied releases.

After reviewing the preview, one event can be extracted with an explicitly paid manual command:

```bash
pnpm worker:extract-qualitative <earnings-event-id> --execute-paid-request
```

The confirmation flag is required. This command makes exactly one provider request, performs local
schema and exact-evidence validation, and inserts one permanent `extraction_runs` record. It is not
part of the scheduled workflow and has no automatic retry.

The first document rule treats `10-Q` and `10-K` financial reports as earnings-related. It
also includes `8-K` filings containing SEC item `2.02`, which means results of operations
and financial condition. Other `8-K` filings are retained as metadata but are not downloaded.

For an earnings-related `8-K`, the worker also checks the SEC filing index for Exhibit `99.1`,
which commonly contains the detailed earnings press release. The `8-K` creates a provisional
event. A single `10-Q` or `10-K` published afterward within 24 hours confirms that event; an
ambiguous match is left for review. Fiscal year and quarter remain empty until structured SEC data
can establish them.

The text-extraction command reads the archived HTML from private Storage and creates a separate
readable `.txt` artifact. The original file is never changed. Its database row records both the
original file fingerprint and the extraction-rule version so the exact future LLM input can be
reproduced.

The financial-metric command reads inline XBRL embedded in archived `10-Q` and `10-K` HTML. It
selects whole-company values rather than business-segment values, distinguishes a quarter from a
year-to-date total, applies the XBRL scale without floating-point arithmetic, and stores the exact
source fact text and XBRL context used for each value. A `10-K` produces full-year values; it
does not pretend those values describe only the fourth quarter.

The financial-calculation command compares a quarter with the same fiscal quarter one year earlier,
not with the immediately preceding quarter. Full years are compared with full years. It stores the
exact source metric rows used, the formula version, and the complete input fingerprint. These are
standard calculations, not predictions or evidence that a stock will perform well.

Every scheduled command records its start time, completion status, and result counts in
`job_runs`, including runs that correctly find no new filings.

The hourly SEC workflow requires `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, and `SEC_USER_AGENT`
repository secrets. The daily price workflow requires `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, and
`TIINGO_API_TOKEN`. Enable each workflow only after its corresponding local command succeeds.

## Data sources planned

- SEC EDGAR for filings and structured financial facts.
- Tiingo for personal end-of-day price research.
- OpenAI Responses API for the first structured qualitative-extraction provider. The provider is
  replaceable through a public interface, but it is not connected to a runnable worker command yet.

## License

Licensed under Apache License 2.0. See `LICENSE`.
