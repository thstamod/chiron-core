# Current capabilities

This page is the short source of truth for what the public Core repository implements today. It
prevents proposed work in `future-improvements.md` from being mistaken for active behavior.

## Implemented

- A configured 30-company watchlist with SEC identifiers, Tiingo symbols, and versioned market and
  sector benchmark assignments.
- Scheduled SEC filing discovery on weekday hours and scheduled end-of-day price collection after
  normal weekday trading sessions.
- Preservation of primary SEC documents and Exhibit 99.1 earnings releases in private Supabase
  Storage with publication, first-seen, size, and content-fingerprint metadata.
- Recoverable grouping of related filings into provisional and confirmed earnings events.
- Versioned readable text derived from archived SEC HTML.
- Deterministic inline-XBRL extraction of revenue, net income, basic EPS, and diluted EPS.
- Versioned calculations for year-over-year revenue growth, net margin, and margin change.
- A structured qualitative schema, public baseline prompt, exact evidence passages, OpenAI adapter,
  guarded one-event paid command, and append-only human review/correction history.
- Transparent scoring from `-5` to `+5` outside the LLM.
- Versioned daily prices, market sessions, benchmark mappings, immutable forward predictions, and
  explicit 1-, 5-, and 20-session evaluation creation.
- Separate immutable historical reconstruction plans, predictions, price backfills, and evaluations
  that never enter the genuine forward record.
- A local read-only Node GraphQL API and Vue dashboard for approved research presentation fields.

## Manual by design during validation

- Paid qualitative LLM execution.
- Human acceptance, correction, or rejection.
- Forward and historical prediction creation.
- Historical price backfill.
- Evaluation preview and immutable creation.

These steps remain manual so a person can verify evidence, timing, and cost before Chiron automates
them. A delayed evaluation is not lost because the planned sessions are frozen and daily prices can
be retrieved later.

## Partial or local-only

- The GraphQL API binds to `127.0.0.1`, has bounded list sizes, and is suitable for local use. It has
  no user authentication or public-deployment hardening.
- The dashboard reads stored records but does not yet provide GraphQL mutations for qualitative
  accept/correct/reject workflows.
- Historical research infrastructure works, but a small number of examples cannot establish
  extraction reliability or predictive value.
- Public setup requires a real Supabase project. A committed runnable synthetic dataset is not yet
  available.

## Not implemented

- Automatic paid LLM extraction or automatic LLM retries.
- Automatic due-evaluation creation.
- Reviewed-example RAG or vector retrieval.
- Logistic regression, XGBoost, or another trained prediction model.
- News, election, geopolitical, or broad web context in the baseline earnings extractor.
- Authentication, subscriptions, billing, public production hosting, or broker integration.
- Autonomous or real-money trading.

## Research limitations

- The score is an understandable rule-based research assumption, not a calibrated probability or
  buy/sell recommendation.
- Historical reconstruction is retrospective. It cannot be presented as an unedited forward track
  record, even when its source cutoff is carefully enforced.
- Earnings releases are narrow sources. An empty extracted risk list means unknown, not safe.
- Model training data may contain facts about famous historical announcements, so live forward
  events remain stronger evidence than retrospective examples.
- Extraction accuracy and investment usefulness are separate questions and require separate tests.

For planned work and its acceptance conditions, read [Future improvements](future-improvements.md).

