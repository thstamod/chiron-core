# Transparent Scoring

Chiron's first score is a deliberately simple research baseline. It is not an investment
recommendation, and its weights are assumptions to test rather than established financial facts.
The LLM never selects points. It produces reviewed structured information; deterministic
TypeScript rules convert that information and the reported financial comparisons into points.

## Version 1

Rule version: `transparent-earnings-score-v1`

| Component | Rule | Points |
| --- | --- | ---: |
| Year-over-year revenue growth | Positive / zero / negative | `+1 / 0 / -1` |
| Year-over-year net-margin change | Positive / zero / negative | `+1 / 0 / -1` |
| Guidance | Each raised scorable item / lowered or withdrawn scorable item | `+1 / -1`, component capped at `-2…+2` |
| Qualitative margin direction | Improving / other / declining | `+1 / 0 / -1` |
| Management tone change | More positive / other / more negative | `+1 / 0 / -1` |
| Key positives | At least one / none | `+1 / 0` |
| Key risks | At least one / none | `-1 / 0` |

The combined result is capped at `-5…+5`. Chiron also retains the uncapped result, separate
financial and qualitative subtotals, every component, the input value used by that component, and a
plain-language explanation.

Only revenue, earnings per share, operating income, operating margin, and free-cash-flow guidance
are directionally scored. Expense, capital-expenditure, and `other` guidance are retained but score
zero because an increase is not consistently positive or negative. Introduced and maintained
guidance also score zero because they do not establish an improvement or deterioration by
themselves.

Missing financial comparisons score zero rather than being guessed. The number of positive or risk
claims does not increase their weight because list length is constrained by the extraction schema
and is not a reliable measure of importance.

Version 1 does not use the immediate stock-price reaction. A later version may add at most a small
contribution after Chiron has a leakage-safe rule proving which market data was available before the
prediction cutoff.

## Assumptions requiring validation

- Any positive revenue growth is treated equally, regardless of company or industry.
- Any positive net-margin change is treated equally, even when the change is very small.
- Reviewed qualitative margin direction may overlap with the reported margin calculation.
- One extracted positive and one extracted risk cancel each other even if their importance differs.
- Capping the combined score may hide differences between unusually strong events.

These choices remain fixed for forward predictions under this version. Changing a threshold,
weight, eligible guidance metric, or cap requires a new rule version. Historical results must not be
silently recalculated as though a newer rule existed at the original prediction time.
