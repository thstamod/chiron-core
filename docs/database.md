# Database guide

Chiron uses Supabase, which provides a hosted PostgreSQL database and private file storage.
PostgreSQL holds structured records such as companies, filing dates, and predictions. Large
original SEC files are kept in Supabase Storage; the database stores a path pointing to each
file.

## How the data fits together

```text
companies
  ├── sec_filings ── documents
  └── earnings_events
        ├── documents
        ├── financial_metrics
        ├── extraction_runs
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
- `earnings_event_id`: the grouped earnings event, when a reliable periodic-report anchor exists.
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

### `earnings_events`

One row for a company's results for a particular financial period. For example, Microsoft's
results for the quarter ending 30 September 2026 would be one event.

Important fields:

- `period_end`: the final date of the reported financial period.
- `fiscal_year` and `fiscal_quarter`: the company's own reporting year and quarter.
- `detected_at`: when Chiron created the event record. This is separate from the SEC document's
  publication time and the time Chiron first saw each filing.
- `previous_event_id`: the previous comparable event, used for change detection.
- `status`: how far the event has progressed through ingestion, prediction, and evaluation.
- `grouping_metadata`: the versioned rule and exact filing IDs used to form the event.

The first grouping rule anchors an event on a `10-Q` or `10-K`, which provides a reported period
end, and attaches the nearest earnings `8-K` within seven days. Fiscal year and quarter remain
empty until XBRL provides reliable values; Chiron does not infer them from calendar dates.

### `financial_metrics`

Structured numbers extracted from SEC XBRL data or a filing, such as revenue, earnings per
share, or profit margin.

Important fields:

- `metric_code`: Chiron's stable name for the measurement.
- `value_numeric` and `unit`: the number and its unit, such as USD or USD per share.
- `accounting_basis`: whether the value follows GAAP, is non-GAAP, or is still unknown.
- `period_start` and `period_end`: the period measured by the number.
- `source_document_id`: the exact source supporting the value.

**GAAP** means the standard US accounting rules. **Non-GAAP** is a company-adjusted measure
that may exclude selected costs. The two should never be treated as interchangeable.

### `extraction_runs`

One immutable-style record of an LLM extraction attempt. This will be used when qualitative
extraction is introduced.

Important fields:

- `cutoff_at`: the latest information the extraction was allowed to use.
- `schema_version`, `prompt_version`, and `model_name`: the exact extraction setup.
- `input_manifest`: the source documents supplied to the model.
- `output`: the structured JSON produced by the model.
- `output_sha256`: a fingerprint of that output.
- `validation_status`: whether the output passed structural validation or needs review.

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

The `sec-documents` storage bucket contains original SEC files. It is private, so files are not
available through a public URL. Only trusted server-side code using the Supabase secret key can
write or retrieve them.

The secret key must never be placed in the Vue application or committed to Git.

## Access policy

Row Level Security is enabled for the database tables. No browser-access policies are created
in the first phase, so the public Vue application cannot read the research database directly.
The worker is currently the trusted database client.

This boundary can change later if the project becomes a product. A server API can expose only
the safe fields that the dashboard needs while keeping private research data and secret keys on
the server.
