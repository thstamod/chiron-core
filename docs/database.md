# Database guide

Chiron uses Supabase, which provides a hosted PostgreSQL database and private file storage.
PostgreSQL holds structured records such as companies, filing dates, and predictions. Large
original SEC files are kept in Supabase Storage; the database stores a path pointing to each
file.

## How the data fits together

```text
companies
  ├── sec_filings ── documents ── document_text_versions
  │                           └── financial_metric_extractions
  ├── price_instruments ── daily_price_observations
  ├── company_benchmark_assignments ── price_instruments
  └── earnings_events
        ├── documents
        ├── financial_metrics
        ├── financial_derived_metrics
        ├── financial_derived_metric_calculations
        ├── extraction_runs ── extraction_reviews
        └── predictions ── evaluations

job_runs records whether background jobs succeeded or failed.
```

An **earnings event** means one company reporting results for one financial period. A company
can publish several SEC files around the same event, so `sec_filings` and `documents` are kept
separate from `earnings_events`.

## Tables

### `companies`

The watchlist of companies Chiron follows.

Important fields:

- `ticker`: the stock-market abbreviation, such as `MSFT`.
- `cik`: the permanent identifier assigned by the SEC.
- `sector`: the broad business group used later for benchmark comparisons.
- `is_active`: whether scheduled jobs should currently monitor the company.

### `price_instruments`

The company stocks and comparison symbols whose daily prices Chiron can collect. A comparison
symbol is called a **benchmark**. For example, `SPY` is the first broad-market benchmark and
`XLK` is the first technology-sector benchmark.

Important fields:

- `company_id`: connects a company stock to the watchlist. Benchmark rows do not have a company.
- `instrument_type`: whether the row is a company stock, market benchmark, or sector benchmark.
- `provider_name` and `provider_symbol`: the price source and the exact symbol requested from it.
- `is_active`: whether future price jobs should currently collect this symbol.

The initial migration creates instruments for the configured companies and the `SPY`, `XLK`,
`XLY`, and `XLC` benchmark ETFs. An **ETF** is a tradable fund holding a group of securities. Here
it is used only as a practical comparison, not as a claim that it perfectly represents a company.

### `company_benchmark_assignments`

Append-only mappings from a company to one broad-market benchmark and one sector benchmark. A new
mapping creates a new row rather than rewriting history.

Important fields:

- `benchmark_role`: whether the comparison is for the whole market or the company's sector.
- `mapping_version`: the named set of mapping assumptions.
- `applicable_from`: the first date on which the mapping may be selected.
- `rationale`: the understandable reason for choosing that comparison.

The `benchmark-proxy-v1` mappings begin on 29 October 2026. They are research assumptions that
must be validated; they are not financial facts. Applying a mapping to earlier historical events
requires a separate researched backfill rather than silently using today's classification.

### `daily_price_observations`

Versioned end-of-day values returned by the price provider. **End of day** means one summary row
for a completed trading session, containing its opening, highest, lowest, and closing prices and
trading volume.

Important fields:

- `trading_date`: the market session described by the row.
- `open_price`, `high_price`, `low_price`, and `close_price`: values as reported for that day.
- `adjusted_*`: values changed by the provider to account for events such as stock splits and cash
  dividends, making returns across time more comparable.
- `dividend_cash` and `split_factor`: the provider's corporate-action values.
- `fetched_at`: when Chiron obtained this version from the provider.
- `observation_sha256`: a fingerprint of the symbol, date, and complete set of values.

Rows cannot be updated or deleted. If Tiingo later corrects a historical value, Chiron stores a
second observation for that trading date. Repeating a download with identical values does not add
a duplicate because the fingerprint is the same.

### `sec_filings`

One row for every SEC filing discovered by the ingestion worker. This table stores filing
metadata, not the complete filing content.

Important fields:

- `accession_number`: the SEC's unique identifier for a filing.
- `form_type`: the filing type, such as `8-K`, `10-Q`, or `10-K`.
- `accepted_at`: when the SEC accepted and published the filing.
- `first_seen_at`: when Chiron first discovered it.
- `items`: the numbered subjects reported in an `8-K`.
- `earnings_classification`: the versioned rule result explaining whether Chiron considers
  the filing earnings-related.
- `earnings_event_id`: the earnings event containing this filing. The event may still be provisional
  while it waits for a periodic report.
- `exhibit_discovery`: the versioned result of checking the SEC index for Exhibit `99.1`.

The first classification rule considers `10-Q` and `10-K` financial reports earnings-related.
It also includes an `8-K` when it contains item `2.02`, which means results of operations and
financial condition. This is a research assumption that must be reviewed against real filings.

### `documents`

An index of original source files saved in private Supabase Storage. The large HTML or text
content is not stored directly in this table.

Important fields:

- `source_url`: the original SEC address.
- `storage_path`: where the private copy is stored in the `sec-documents` bucket.
- `published_at`: the safest known time when the source became public.
- `first_seen_at`: when Chiron discovered the source.
- `content_sha256`: a fingerprint used to prove whether the file content changed.
- `content_size_bytes`: the exact size of the archived source file. Older rows can remain empty until
  they are backfilled or downloaded again.
- `filing_id`: the related `sec_filings` row.
- `earnings_event_id`: the related earnings event, once one has been created.

### `document_text_versions`

An index of readable text files derived from the archived SEC documents. The `.txt` content is
kept in private Supabase Storage; this table records how it was produced.

Important fields:

- `document_id`: the exact original document used as input.
- `extraction_version`: the version of the deterministic HTML-to-text rules.
- `source_content_sha256`: the fingerprint of the original file at extraction time.
- `storage_path`: the private location of the readable `.txt` artifact.
- `content_sha256`: the fingerprint of the derived text.
- `content_size_bytes`, `character_count`, and `line_count`: measurements used to inspect output
  size and later control LLM inputs.

A changed extraction rule creates a new row instead of replacing an older result. This is separate
from `extraction_runs`: a text version is deterministic document preparation, while an extraction
run will contain the later structured JSON produced by an LLM.

### `earnings_events`

One row for a company's earnings announcement. It becomes the event for a particular financial
period when the periodic report confirms that period. For example, Microsoft's results for the
quarter ending 30 September 2026 would be one event.

Important fields:

- `period_end`: the final date of the reported financial period. It remains empty while an event is
  provisional and is filled when the periodic report confirms it.
- `fiscal_year` and `fiscal_quarter`: the company's own reporting year and quarter.
- `detected_at`: when Chiron created the event record. This is separate from the SEC document's
  publication time and the time Chiron first saw each filing.
- `previous_event_id`: the previous comparable event, used for change detection.
- `status`: whether grouping is still in progress, the event is provisional, the period is detected,
  or the event has progressed to later processing, prediction, and evaluation phases.
- `origin_filing_id`: the first filing that created the event. This remains unchanged when a
  provisional event is confirmed.
- `grouping_metadata`: the versioned rule and exact filing IDs used to form the event.

The second grouping rule creates a provisional event from an earnings `8-K`. It attaches one later
`10-Q` or `10-K` published within 24 hours for the same company and then marks the event detected.
No match leaves the event provisional; multiple matches are recorded as ambiguous. Fiscal year and
quarter remain empty until XBRL provides reliable values; Chiron does not infer them from calendar
dates.

### `financial_metrics`

Structured numbers extracted from SEC XBRL data or a filing, such as revenue, earnings per
share, or profit margin.

Important fields:

- `metric_code`: Chiron's stable name for the measurement.
- `value_numeric` and `unit`: the number and its unit, such as USD or USD per share.
- `accounting_basis`: whether the value follows GAAP, is non-GAAP, or is still unknown.
- `period_start` and `period_end`: the period measured by the number.
- `source_document_id`: the exact source supporting the value.
- `extraction_version` and `source_content_sha256`: the parser version and original-file
  fingerprint used to produce the row.
- `xbrl_concept` and `xbrl_context_id`: the SEC/XBRL identifiers used to choose the value.
- `source_text`: the exact text content of the selected fact before scale normalization.
- `source_metadata`: the XBRL unit, scale, precision, sign, and dimension count used for auditing.

**GAAP** means the standard US accounting rules. **Non-GAAP** is a company-adjusted measure
that may exclude selected costs. The two should never be treated as interchangeable.

The first deterministic rule stores current-period GAAP revenue, net income, basic earnings per
share, and diluted earnings per share. For a quarterly report it chooses the shortest
whole-company period ending on the report date, excluding segment-level facts. For an annual
report it chooses the full-year period. These selection rules are implementation assumptions that
must be revalidated when the company set expands.

### `financial_metric_extractions`

One completion record for each original document, source fingerprint, and deterministic parser
version. It stores the filing's fiscal year and period, the metric count, warnings, and a fingerprint
of the complete structured result. Keeping this separate from individual values lets a successful
extraction with a genuinely missing metric remain complete rather than being downloaded forever.

### `financial_derived_metrics`

Standard values calculated from the extracted SEC numbers. The first version calculates:

- year-over-year revenue growth: the percentage change from the same fiscal period one year ago;
- net margin: net income divided by revenue, expressed as a percentage;
- year-over-year net-margin change: the difference between the two margins, expressed in
  percentage points.

For example, a margin moving from `15%` to `20%` improved by `5 percentage points`. It did not
improve by `5%`; those phrases mean different calculations.

Important fields:

- `calculation_expression` and `calculation_version`: the transparent formula and its version.
- `input_sha256`: a fingerprint of the complete current- and previous-period input.
- `input_metrics`: the exact `financial_metrics` row IDs and values used in the formula.

A quarter is compared with the same fiscal quarter one year earlier to reduce misleading seasonal
comparisons. A full year is compared with the previous full year. These values are descriptive
financial calculations, not prediction rules.

### `financial_derived_metric_calculations`

One completion record for each event, formula version, and exact input fingerprint. It preserves
the current and previous source-period manifest, calculated-value count, warnings, and output
fingerprint. If an amended filing later changes the available source data, the new input fingerprint
creates a new calculation while the earlier result remains available for auditing.

### `extraction_runs`

One append-only record for every LLM extraction attempt, including unsuccessful requests. Database
triggers reject updates and deletes so an earlier result cannot be silently rewritten.

Important fields:

- `cutoff_at`: the latest information the extraction was allowed to use.
- `schema_version`, `prompt_version`, `input_selection_version`, and `input_sha256`: the exact
  input-selection and extraction setup.
- `provider_name`, `provider_request_id`, `model_name`, and `resolved_model_name`: which provider
  and model handled the request.
- `input_manifest`: the source documents supplied to the model and deterministic source-coverage
  metadata listing what was and was not examined. For the MVP, an empty extracted risk list means
  only that no event-specific risk was found in the supplied earnings releases. It is not evidence
  that the company has no risks and must not add positive points to a future score.
- `provider_status`, `failure_reason`, and `retryable`: whether the request completed and why it did
  not when unsuccessful. `retryable` is classification metadata; it does not trigger another call.
- `started_at`, `finished_at`, `duration_milliseconds`, and `token_usage`: cost and latency evidence.
- `output` and `output_sha256`: the structured JSON and its fingerprint when the provider completed.
- `validation_status`, `located_evidence`, and `validation_errors`: whether every claim passed
  validation, where each exact quote appeared, and any validation problem that requires review.

### `extraction_reviews`

Append-only human decisions about immutable qualitative extraction output. A review never changes
the original `extraction_runs` row. Multiple reviews preserve history; the newest row by
`created_at` and `id` represents the latest decision.

The application selects an effective qualitative extraction without changing either table. For
each extraction run, its newest review controls whether that run is accepted, corrected, or
rejected. Among reviewed usable runs for one earnings event, the newest review wins. Unreviewed
runs are ignored, accepted reviews use the fingerprint-verified original output, corrected reviews
use their fingerprint-verified corrected output, and rejected runs are excluded. The selector
returns both original and effective data so the dashboard can preserve the audit trail.

Important fields:

- `extraction_run_id` and `reviewed_output_sha256`: identify the exact extraction output that was
  inspected and reject a review if its fingerprint does not match.
- `decision`: `accepted`, `corrected`, or `rejected`.
- `corrected_output`, `corrected_schema_version`, `corrected_output_sha256`, and
  `corrected_located_evidence`: a complete, separately validated replacement when the reviewer
  corrects the extraction.
- `reviewer_label`, `notes`, and `review_version`: who performed the review, what they concluded,
  and which review procedure they followed.

Database triggers reject updates and deletes. An accepted review is allowed only for extraction
output that already passed local validation. Later scoring should use the latest accepted output or
the latest corrected output and must ignore rejected output.

The worker records an accepted or rejected review with an explicit decision, reviewer label, and
notes. Corrected reviews additionally require a JSON file containing the complete corrected output:

```text
pnpm worker:review-qualitative <extraction-run-id> --decision=accepted \
  --reviewer-label=owner-manual-review --notes="Reviewed every claim and its evidence."
```

### `predictions`

The frozen score created before the future stock performance is known.

Important fields:

- `cutoff_at`: the information deadline for the prediction.
- `score`: the transparent score from `-5` to `+5`.
- `score_components`: the individual rule contributions.
- `rule_version`: the precise scoring-rule version.
- `snapshot`: all information used to create the score.
- `snapshot_sha256`: a fingerprint protecting reproducibility.
- `planned_entry_session`: the trading day on which a realistic entry price will be measured.

Prediction rows must eventually be protected from updates and deletion. That protection is
scheduled for the prediction phase, before any live predictions are created.

### `evaluations`

The measured result after a prediction. Separate rows are stored for 1, 5, and 20 trading-day
horizons.

Important fields:

- `entry_price`: the realistic reference price available after the prediction.
- `stock_return`: the company's percentage price change.
- `market_return`: the S&P 500 percentage change over the same period.
- `sector_return`: the relevant sector benchmark's percentage change.
- `methodology_version`: the exact calculation rules used.

A stock **outperforms** a benchmark when its return is higher over the same dates. For example,
if a stock gains 4% while the S&P 500 gains 1%, its market-relative performance is +3 percentage
points.

### `job_runs`

Operational history for scheduled background work such as checking the SEC, downloading
documents, grouping events, or calculating evaluations. A successful row is recorded even when
the job correctly finds no new data.

Important fields:

- `job_name`: which background job ran.
- `status`: `running`, `succeeded`, or `failed`.
- `started_at` and `finished_at`: how long it ran.
- `error_summary`: a safe error description when it failed.
- `details`: job-specific counts or other structured information.

## Private storage

The `sec-documents` storage bucket contains original SEC files and versioned readable-text artifacts.
Derived text is stored below the `derived-text/` folder so it cannot be confused with original
evidence. The bucket is private, so files are not available through a public URL. Only trusted
server-side code using the Supabase secret key can write or retrieve them.

The secret key must never be placed in the Vue application or committed to Git.

## Access policy

Row Level Security is enabled for the database tables. No browser-access policies are created
in the first phase, so the public Vue application cannot read the research database directly.
The worker is currently the trusted database client.

This boundary can change later if the project becomes a product. A server API can expose only
the safe fields that the dashboard needs while keeping private research data and secret keys on
the server.
