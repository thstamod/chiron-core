# Prediction audit and market-risk research plan

**Recorded:** 2026-11-06

**Status:** Proposed research sequence; not implemented or validated.

## Purpose and current behavior

Chiron's earnings score summarizes reported company performance and reviewed qualitative evidence.
It is not a calibrated probability of a positive stock return. Strong company results can coexist
with falling prices because expectations, sector conditions, and broader market changes also matter.

The current workflow freezes predictions and supports later 1-, 5-, and 20-trading-day evaluations
with market and sector benchmarks. This plan proposes an aggregate audit first, followed by a
separate experimental market-risk indicator only if the audit supports further research.

## First deliverable: audit existing predictions

Create a reproducible report with one row per prediction and evaluation horizon, containing:

- Prediction ID, creation timestamp, scoring-rule version, score, and frozen input references.
- Frozen entry and exit sessions, outcome readiness, and missing-data reasons.
- Stock, market-benchmark, and sector-benchmark returns over identical sessions.
- Stock return minus each benchmark return, clearly labeled as excess return rather than a
  risk-adjusted measure of skill.
- Price-observation versions and benchmark assignments used, plus the report's evaluation timestamp.

Summarize results by score and horizon, showing sample counts, positive-return rates, average and
median returns, benchmark-relative returns, and the distribution of losses. Include neutral and
negative scores; do not select only recent losing or positive-score examples. Report missing and
not-yet-ready outcomes explicitly. Multiple horizons and overlapping predictions are not independent
observations; report unique prediction and company counts as well as row counts.

Use this report to distinguish broad-market or sector co-movement from company underperformance.
Benchmark comparisons describe outcomes; they do not prove why a stock moved. Record insufficient
sample size as an inconclusive result rather than claiming the score works or fails.

## Algorithm-evolution sequence

Do not change the transparent `v1` scoring rules to explain the first few observed outcomes. Keep
that version immutable as the permanent understandable baseline. With only a few completed events,
changing weights would likely fit those particular examples rather than improve unseen predictions.

For the initial research comparison, use:

- Primary target: stock return minus sector-benchmark return after 20 trading days.
- Secondary target: stock return minus SPY return after 20 trading days.
- Supporting diagnostics: the same comparisons after 1 and 5 trading days and the absolute stock
  return at every horizon.

The primary target is a research convention to freeze before comparison, not a financial fact. A
positive score is aligned with the target when the primary excess return is positive; a negative
score is aligned when it is negative. A zero score expresses no directional view and is not counted
as a successful or failed directional prediction.

Develop and evaluate distinct versioned variants rather than silently extending `v1`:

1. Qualitative-only baseline.
2. Deterministic financial-only baseline.
3. Combined financial and qualitative score.
4. Simple price-momentum baseline.
5. Combined earnings score and momentum.
6. Only later, separately versioned market-context, RAG, or statistical-model variants.

Use roughly 100 manually reviewed earnings events first to validate extraction consistency, data
coverage, correction handling, and the experiment pipeline. That number is a practical review
milestone, not proof that a predictive model is reliable. Freeze feature definitions and scoring
rules using earlier events, evaluate on later untouched events, and preserve unsuccessful variants
alongside promising ones. More complex models require a larger and more varied time-ordered sample.

### Public and private ownership

The public `chiron-core` repository owns a complete, reproducible baseline: transparent scoring,
immutable predictions and evaluations, generic experiment contracts, common comparison rules, and
enough example or synthetic data to demonstrate the workflow. It must remain useful without the
private repository.

The private `chiron-research` repository may hold real reviewed research datasets, correction and
failure analysis, experiment outputs, unsuccessful attempts, tuned feature choices and weights,
learned model artifacts, proprietary context-source configurations, and conclusions from held-out
or forward results. Private work should consume public contracts rather than redefine foundational
core tables.

Generic code is not kept private merely because it can be. A research enhancement becomes a
reasonable private advantage only when it demonstrates measurable value beyond the public baseline
on untouched data. An intentionally reviewed implementation may later be promoted to core, while
private data, fitted parameters, and unreleased experiment evidence remain private.

## Second deliverable: a point-in-time context experiment

Only after reviewing the audit, define a small experimental indicator using candidate inputs:

| Input | Candidate information |
| --- | --- |
| Market trend | Trailing broad-market returns |
| Sector trend | Trailing returns for the prediction's assigned sector benchmark |
| Recent volatility | Realized volatility from trailing daily returns |
| Scheduled events | Known dates of major elections and policy or economic announcements |

An event date flags uncertainty; it does not imply a negative return. Unexpected news and election
outcomes cannot be included before they were available. Keep event categories few and define them
before testing. Exact lookbacks, thresholds, event windows, and any loss definition remain research
choices to freeze in an experiment specification before viewing test-period outcomes.

Preserve source publication timestamps, actual first-seen timestamps, provider/version references,
and the calculation cutoff. A daily closing price is eligible only after that session has closed
and the price was available. Do not substitute subsequently revised values without labeling the
reconstruction. Mark retrospectively collected context as reconstructed; it is not evidence that
Chiron held that information live. Missing inputs must remain visible, never silently become
low-risk values.

Keep experimental output separate from immutable forward predictions and the existing earnings
score. Each experiment needs a version, frozen inputs, explicit rules, and reproducible results.
Implementation must follow the existing historical-reconstruction boundaries rather than inserting
backdated forward predictions.

Broader current information, including company news, regulatory developments, geopolitical events,
and unexpected macroeconomic news, belongs to the separately planned frozen pre-prediction
market-context pipeline in `docs/future-improvements.md`. It must not be added by enabling
unrestricted web search on the earnings-extraction LLM. The earnings-only audit and this small
price-and-scheduled-event experiment should establish baselines before that larger experiment is
built.

## Validation and adoption

1. Define the forecast target, primary horizon, metrics, baselines, and success criteria before
   examining the held-out test period. Do not confuse predicting an absolute loss with predicting
   sector underperformance.
2. Design on earlier periods and evaluate on later untouched periods. Keep overlapping outcome
   windows across the split from leaking into training; use time-ordered validation rather than a
   random row split.
3. Compare earnings-only results with earnings plus context and with simple unconditional and
   market-context-only baselines on the same eligible sample.
4. Measure both missed losses and false alarms. Report coverage, sample sizes, uncertainty, and
   results across companies and periods. Disclose all tried variants rather than selecting only
   the best-looking result.
5. If results are promising, freeze the indicator and observe it prospectively before adopting it
   in the main product. Inconclusive or inconsistent results do not justify adoption.

The recent selloff motivates the question; it cannot serve as both the design example and proof
that the new indicator predicts future selloffs. No new data provider, paid collection, model rule,
database migration, or UI behavior is authorized or implemented by this document alone.

## Possible presentation after validation

Display company outlook and near-term market risk separately, with the forecast horizon, supporting
reasons, and data completeness. Any example labels are conceptual until rules are validated.
Do not present numerical probabilities without calibration on independent data.

## Acceptance checks

- The audit reproduces stored evaluation conventions and preserves original prediction records.
- Every eligible prediction is accounted for, including incomplete outcomes.
- Context inputs can be traced to information available by the stated cutoff; retrospective
  reconstructions are identified explicitly.
- Experiment rules and test splits are frozen before test outcomes are inspected.
- The report shows benchmark comparisons, false alarms, missed losses, and sample limitations.
- Adoption requires evidence beyond explaining one recent decline; no profitability or crash-timing
  claim follows from this plan.
