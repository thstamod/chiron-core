# LLM extraction quality gate

This protocol decides whether Chiron's qualitative extractor is reliable enough to process a
larger historical batch. It evaluates information extraction, not stock-prediction performance.

The numbers below are initial engineering and research assumptions. They are not financial facts,
industry standards, or evidence that an extracted signal predicts future returns.

## Why examples are separated

Using the same reviewed examples both to improve a prompt and to prove that it works produces an
overly optimistic result. Chiron therefore gives each example one role:

| Group | Purpose | Can it influence the prompt? |
| --- | --- | --- |
| Development | Find mistakes and improve extraction rules | Yes |
| Validation | Test one frozen prompt on new examples | No |
| Final untouched | Compare mature variants once, near the end of the study | No |

Once a validation or final example has been inspected, it can never become untouched again. If a
prompt fails validation, those reviewed examples may become development evidence for the next
prompt version, but that new version requires a new validation group.

Real event IDs, corrections, source documents, group assignments, and experiment results are
private research data. The reusable grouping rules and reporting code belong in public Chiron Core.

## First bounded gate

1. Treat every already-inspected extraction as development-only evidence.
2. Add no more than eight deliberately varied development events before the first gate. Include
   different sectors, quarterly and annual results, positive and negative language, and different
   document structures where the available sample allows it.
3. Use the development group to compare the compact deterministic input with any proposed larger
   input. Record prompt, schema, input-selection, model, and pricing versions.
4. Freeze one candidate prompt and input policy before selecting or extracting the validation
   group.
5. Freeze 15 new validation events. Do not replace difficult events after seeing their output.
6. Run exactly one candidate extraction per validation event, review every result, and generate the
   quality report for only that prompt and extraction purpose.
7. Apply the thresholds below. A pass authorizes only the next bounded batch of at most 25 events.
   Re-run the gate before expanding further.

Fifteen validation events are enough for an early engineering checkpoint, not for a statistically
strong reliability claim. Live forward events remain the strongest evidence because a model may
already know facts about prominent historical earnings announcements from its original training.

## Initial pass thresholds

| Measurement | Initial requirement | Reason |
| --- | ---: | --- |
| Human-review coverage | 100% | Unreviewed output cannot establish quality. |
| Schema-valid provider results | 100% | Structured output should satisfy the requested schema. |
| Exact evidence validity | At least 95% | Claims should point to supplied source passages. |
| Rejected outputs | 0 | A wholly unusable result blocks the small validation gate. |
| Corrected outputs | At most 20% | At least 12 of 15 outputs should need no correction. |
| Guidance strict agreement | At least 80% | Guidance is a central extracted signal. |
| Margin strict agreement | At least 80% | Margin direction affects the transparent score. |
| Management-tone strict agreement | At least 80% | Tone is subjective and needs explicit review. |
| Key-positive strict agreement | At least 80% | Positive claims must remain source-grounded. |
| Key-risk strict agreement | At least 80% | Missing or invented risks can distort the score. |
| Average estimated API cost | At most $0.01 per event | Keeps the first expansion inexpensive and predictable. |

Strict agreement compares the complete field section, including its summary and evidence—not only
the main label. Cost must use a dated pricing profile that matches the resolved model and cache
policy.

Latency and exact repeated-output fingerprints remain visible but are not pass/fail thresholds in
the first gate. Natural-language wording can vary without changing the useful classification, so
exact repeated JSON equality is a diagnostic rather than proof of quality.

## Gate outcome

The result must be one of:

- **Pass:** all thresholds pass; authorize the next bounded batch only.
- **Fail:** any required threshold fails; do not expand with this prompt version.
- **Inconclusive:** missing reviews, mismatched pricing, mixed prompt versions, or an incorrectly
  frozen sample prevents a valid decision.

Always retain failures, corrections, and negative results. Never remove an event merely because it
makes the reported quality worse.

Passing this gate does not approve automatic LLM extraction, RAG, machine learning, trading, or a
claim that Chiron predicts stock returns.
