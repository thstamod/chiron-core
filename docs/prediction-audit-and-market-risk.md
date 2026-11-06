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
