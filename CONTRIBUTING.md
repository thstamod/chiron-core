# Contributing

Chiron Core is currently in its early research phase.

Before proposing a change:

1. Do not include API keys, private datasets, or licensed market data.
2. Keep financial language understandable to non-specialists.
3. Preserve source evidence and timestamps for every extracted value.
4. Do not add buy/sell recommendations or automated trading features.
5. Add or update tests when behavior changes.

## Code readability

Chiron is an open-source research project, so a reader should be able to understand the code without
already knowing its implementation history.

- Prefer complete, domain-specific names over abbreviations or generic names such as `data`,
  `value`, `item`, or `handler` when a more precise name is available.
- Name functions with a verb that describes their result or side effect, such as
  `fetchRecentFilings`, `buildEarningsEventGroups`, or `storeSecDocument`.
- Name booleans as questions using prefixes such as `is`, `has`, `can`, or `should`.
- Prefer a named options object when positional arguments would not be immediately understandable at
  the call site.
- Keep functions focused on one responsibility and extract a well-named function when doing so makes
  the workflow easier to read.
- Keep repeated domain values, external URLs, statuses, and rule versions in shared constants.
- Do not add comments that merely repeat the code. Use a comment only when it explains a non-obvious
  reason, constraint, financial assumption, or deliberate tradeoff that clearer naming cannot
  express.

By submitting a contribution, you agree that it is licensed under Apache License 2.0.
