# End-to-end tutorial

This conceptual tutorial follows a fictional company through Chiron. It uses synthetic values and
does not create database rows, contact providers, or represent a real investment result.

Core does not yet ship a runnable synthetic seed dataset. Until one is added, use this guide to
understand relationships and use the real operational commands only against an intentionally
configured Supabase project.

## Fictional event

Assume `Example Systems` (`EXM`) publishes an earnings release after the market closes on Monday:

- revenue: $1.1 billion, up from $1.0 billion;
- net income: $110 million, up from $90 million;
- management maintains revenue guidance;
- management says demand improved;
- management identifies one supply-chain risk.

## 1. Discover the filing

`sync-filings` reads configured SEC submissions, classifies supported earnings-related forms, and
inserts new `sec_filings` metadata. The SEC accession number prevents duplicates.

No document body or prediction exists yet.

## 2. Preserve source documents

`sync-documents` identifies the primary filing and earnings-release attachment, downloads their
original bytes, calculates fingerprints and sizes, uploads them to private Storage, and inserts
`documents` rows containing source and availability timestamps.

The original archived document remains the source of truth.

## 3. Group the earnings event

`sync-events` connects filings and documents that describe the same reporting period. An 8-K may
create a provisional event before the later 10-Q or 10-K confirms the fiscal identity.

The fictional event now groups its current earnings evidence without changing source timestamps.

## 4. Create readable text

`extract-document-text` converts archived SEC HTML into a versioned readable-text artifact. It
stores a separate fingerprint and completion record; it does not replace the original HTML.

If the extraction algorithm changes later, a new version can coexist with the old text.

## 5. Extract reported financial values

`extract-financial-metrics` reads inline XBRL and stores exact values, units, periods, accounting
basis, concepts, source text, document IDs, and extraction version.

For EXM, it might store current and prior comparable revenue and net income. It does not ask an LLM
to calculate these values.

## 6. Calculate comparable metrics

`calculate-financial-derived-metrics` applies versioned formulas:

```text
revenue growth = (1.1B − 1.0B) ÷ 1.0B = 10%
current net margin = 110M ÷ 1.1B = 10%
previous net margin = 90M ÷ 1.0B = 9%
margin change = 10% − 9% = +1 percentage point
```

The calculation record preserves the exact input metric IDs and formula version.

## 7. Preview qualitative input

`preview-qualitative` verifies one current and optional previous earnings release, reports source
coverage and an approximate request size, and makes no paid request.

Readable text is split into evidence passages such as `current-p0007`. The ID means passage seven
of the current source document; it is not a page number.

## 8. Extract qualitative information

Only after explicit authorization, the guarded extraction command makes one provider request. The
LLM returns structured guidance, margin, tone, positives, risks, summary, limitations, and passage
IDs. It does not calculate the investment score.

Local validation proves that cited IDs exist and use correct document roles. It cannot prove the
model found every material fact.

## 9. Review the extraction

A person compares each claim with its exact passage and records one append-only decision:

- accept the original;
- correct it with a complete validated replacement;
- reject it as unusable.

Suppose the reviewer confirms maintained guidance and improved demand but adds the omitted
supply-chain risk. Both original and corrected JSON remain available for audit.

## 10. Preview and freeze the score

Transparent rules outside the LLM calculate components. A synthetic result might be:

```text
revenue growth              +1
reported margin change      +1
maintained guidance          0
management tone improved    +1
positive development        +1
material risk               -1
uncapped total              +3
final score                 +3
```

Before creation, the preview shows the score, component explanations, cutoff, entry rule, market
calendar version, and planned sessions. Creation stores an immutable snapshot.

Because the fictional release appeared after Monday's close, the planned entry is normally
Tuesday's opening session—not Monday's earlier close.

## 11. Collect prices

The scheduled price job stores versioned end-of-day observations for EXM, SPY, and EXM's sector
ETF. The original prediction snapshot cannot contain these future observations.

## 12. Evaluate after 1, 5, and 20 sessions

After each planned exit session closes, an evaluation preview selects exact adjusted prices and
benchmark mappings. Creation permanently stores the reviewed calculation and fingerprint.

Example:

```text
EXM return                 +4.0%
SPY return                 +1.5%
sector return              +3.0%
EXM minus SPY              +2.5 percentage points
EXM minus sector           +1.0 percentage point
```

This means EXM outperformed both comparisons over that interval. One example does not prove the
score works.

## 13. Display through GraphQL and Vue

Vue requests approved fields from the Node GraphQL API. It can show the event, source documents,
reported and derived financial values, qualitative evidence, original/corrected audit, score,
planned dates, and stored outcomes. The browser never receives provider or Supabase secrets.

## Historical variation

A historical reconstruction freezes an explicit source plan at a simulated past cutoff before paid
extraction. Its prediction and evaluations use separate tables and retrospective labels. It follows
similar technical steps but never becomes part of the genuine forward record.

## What this tutorial does not prove

- that the LLM extraction is accurate across companies;
- that a `+3` score predicts outperformance;
- that the reference price could be achieved in real trading after spreads or slippage;
- that historical results are free from model-training knowledge;
- that Chiron is ready for public deployment or autonomous trading.

