# Qualitative extraction and evidence guide

This guide explains how Chiron turns earnings-release text into reviewable structured information.
It is written for contributors who are new to the project and for future development sessions that
need to resume qualitative-extraction work safely.

The qualitative extractor identifies guidance, margin direction, management tone, positive
developments, and risks. It does **not** choose investments, calculate the final score, search the
internet, or predict a stock price.

## The complete flow

```text
archived SEC document
→ versioned readable text
→ one current and optional previous release
→ stable evidence passages
→ structured LLM output containing passage IDs
→ deterministic schema and evidence validation
→ append-only extraction run
→ human acceptance, correction, or rejection
→ effective reviewed output
→ transparent scoring outside the LLM
```

The source document, readable text, extraction attempt, human review, and later prediction are
separate records. Chiron never overwrites an earlier record to make a newer result appear original.

## Vocabulary

| Term | Plain-language meaning |
| --- | --- |
| Source document | The original SEC filing or earnings-release file archived by Chiron. |
| Readable text | A versioned text copy derived from the archived HTML. The original remains preserved. |
| Current document | The earnings release for the event being analyzed. |
| Previous document | The earlier earnings release used only for comparisons such as tone change. |
| Analysis cutoff | The latest time from which information may enter an extraction or prediction. |
| Evidence passage | A small, exact section of readable source text that the LLM may cite. |
| Passage ID | A local identifier such as `current-p0021` that points to one evidence passage. |
| Extraction run | One permanent record of an LLM attempt, including failures, versions, tokens, and output. |
| Review | An append-only human decision: accepted, corrected, or rejected. |
| Effective output | The newest usable reviewed output selected without modifying the original attempt. |
| Fingerprint | A SHA-256 value used to detect whether frozen input or output bytes changed. |

## Current and previous document roles

Every qualitative input contains exactly one document with the role `current`. It may also contain
one document with the role `previous`.

- Current guidance, margin direction, current tone, positives, and risks require current-document
  evidence.
- A concrete tone comparison requires evidence from both current and previous documents.
- When no previous document exists, tone change must be `unavailable`.
- The previous release is context for comparison. It is not another source of current-period facts.

Document roles are not determined by filenames. The input loader selects verified documents and
records their IDs, roles, publication times, first-seen times, content fingerprints, and readable-
text version in the input manifest.

## How passage IDs work

Readable text is divided at paragraph boundaries. A paragraph that exceeds the configured maximum
size is split again, preferably at a line break. Passages are numbered independently inside each
source document.

The ID format is:

```text
<document-role>-p<four-digit-number>
```

Examples:

- `current-p0001`: the first passage in the current earnings release.
- `current-p0021`: the twenty-first passage in the current earnings release.
- `previous-p0008`: the eighth passage in the previous earnings release.

`current-p0021` is **not** an SEC accession number, database ID, HTML element, or page number. Its
meaning is valid only with the exact source documents, readable-text fingerprints, and evidence-
passage version recorded in that extraction input.

Each generated passage also retains:

- the source-document ID;
- the document role;
- its start and end character positions;
- the exact source text.

The generation rule lives in
`apps/worker/src/qualitative-evidence-passages.ts`. The version of that rule is included in the input
manifest. If text extraction or passage generation changes, Chiron must use a new version rather
than silently reinterpret old IDs.

## What the LLM receives

The baseline request supplies controlled document blocks similar to this synthetic example:

```text
BEGIN_DOCUMENT
documentId: synthetic-current-document
role: current
documentType: sec-exhibit-99.1
publishedAt: 2025-01-01T21:00:00.000Z
BEGIN_PASSAGE current-p0001
Synthetic Company reported quarterly revenue growth.
END_PASSAGE
END_DOCUMENT
```

The LLM receives the allowed passage IDs and returns those IDs inside structured JSON. It does not
return copied evidence text. After the response, Chiron resolves each ID back to the exact stored
passage.

The baseline prompt explicitly forbids outside knowledge, analyst estimates, later events,
investment advice, and investment scoring. The ordinary extraction request has no web-search tool.
Source coverage records that the MVP includes earnings releases while excluding SEC legal/risk
sections, regulatory sources, and external news.

An empty risk list means only that no event-specific risk was found in the supplied releases. It
means **unknown**, not **safe**, and cannot be treated as positive evidence.

## Structured output

The shared `qualitative-earnings-v4` schema defines these sections:

- guidance status and separately classified guidance items;
- margin direction;
- current management tone and change from the previous release;
- at most three important positive developments;
- at most three important risks;
- a short summary;
- source limitations.

Every concrete claim that requires evidence contains one or more passage IDs. The shared schema in
`packages/shared/src/qualitative-extraction.ts` validates allowed fields, enum values, array limits,
and passage-ID shapes.

## What automatic validation proves

After the provider responds, deterministic validation checks that:

1. the JSON matches the shared schema;
2. every referenced passage ID exists in the supplied documents;
3. current-only claims cite the current document;
4. a concrete tone comparison cites both current and previous documents;
5. classifications that require evidence and summaries contain them;
6. the exact passage text and character positions can be recovered.

This proves that evidence references are structurally valid and traceable. It does **not** prove
that the LLM interpreted the passage correctly or found every material fact. For example, a valid
response may still miss a material regional sales decline. Human review remains mandatory during
the current research phase.

## Extraction status versus human review

These concepts are different:

- Provider status answers whether the API request completed.
- Validation status answers whether local schema/evidence checks completed successfully or require
  attention.
- Human review decides whether the business interpretation is accepted, corrected, or rejected.

A completed development extraction may deliberately be stored as `needs_review`. That is a workflow
state, not evidence that the provider call failed.

Review decisions are append-only:

- `accepted`: use the original fingerprint-verified output;
- `corrected`: preserve the original and store a complete validated replacement;
- `rejected`: exclude the output from scoring.

The effective-output selector uses the newest applicable review. It returns both original and
effective data so the audit trail remains visible.

## Forward and historical work

Forward extraction and historical reconstruction share validation code but represent different
claims:

| Mode | Source availability | Research meaning |
| --- | --- | --- |
| Forward | Document was published and actually observed by Chiron before the cutoff. | Contributes to the genuine forward record. |
| Historical reconstruction | Document publication time is at or before a simulated historical cutoff; the later real first-seen time remains recorded. | Retrospective experiment only. Never part of the forward record. |

Historical work freezes a reconstruction plan before a paid extraction. Prices and outcomes must
not enter source selection, extraction input, human correction, scoring, or prediction creation.

## Safe operating sequence

For a forward event:

```text
pnpm worker:preview-qualitative <earnings-event-id>
pnpm worker:extract-qualitative <earnings-event-id> --execute-paid-request
pnpm worker:review-qualitative <extraction-run-id> --decision=<decision> \
  --reviewer-label=<label> --notes="<review notes>"
```

For a historical event:

```text
pnpm worker:preview-historical-reconstruction-plan <earnings-event-id> \
  --cutoff=<historical-timestamp> --experiment-version=<version>
pnpm worker:create-historical-reconstruction-plan <earnings-event-id> \
  --cutoff=<historical-timestamp> --experiment-version=<version>
pnpm worker:preview-historical-qualitative <historical-plan-id>
pnpm worker:extract-historical-qualitative <historical-plan-id> --execute-paid-request
```

Preview commands do not make paid LLM requests. Creation, extraction, and review commands can write
to Supabase. Paid commands require deliberate event-specific authorization and must never be run as
routine tests. Provider retries are disabled for the guarded single-event workflow.

## Where data lives

| Data | Location |
| --- | --- |
| Original SEC bytes | Private Supabase Storage bucket plus the `documents` catalog. |
| Versioned readable text | Private storage plus `document_text_versions`. |
| LLM attempt and original output | Append-only `extraction_runs`. |
| Human decision or corrected output | Append-only `extraction_reviews`. |
| Effective reviewed value | Selected at read time; original rows are not overwritten. |
| Frozen forward prediction | Immutable `predictions` snapshot. |
| Historical experiment | Separate historical plan, prediction, and evaluation tables. |

Real documents, provider output, corrections, licensed data, and credentials do not belong in the
public Git repository.

## Contributor code map

| File | Responsibility |
| --- | --- |
| `apps/worker/src/qualitative-input-loader.ts` | Selects and verifies current/previous release inputs. |
| `apps/worker/src/qualitative-extraction.ts` | Builds the manifest and validates schema/evidence semantics. |
| `apps/worker/src/qualitative-evidence-passages.ts` | Generates passage ranges and IDs. |
| `apps/worker/src/baseline-qualitative-prompt.ts` | Defines the public extraction instructions and request text. |
| `apps/worker/src/openai-qualitative-provider.ts` | Sends the structured provider request. |
| `apps/worker/src/qualitative-extraction-run.ts` | Stores one immutable provider attempt. |
| `apps/worker/src/qualitative-extraction-review.ts` | Validates and appends human reviews. |
| `apps/worker/src/effective-qualitative-extraction.ts` | Selects the newest usable reviewed output. |
| `packages/shared/src/qualitative-extraction.ts` | Defines the shared runtime JSON schema. |
| `apps/api/src/evidence-presentation.ts` | Resolves frozen evidence for the GraphQL/UI audit view. |

Tests beside these files contain synthetic examples. Tests must never call a paid provider or rely
on live SEC, Tiingo, or Supabase state.

## Checklist for a contributor or a new development session

Before changing or operating this pipeline:

1. Read the workspace handoff when one exists, then the repository `AGENTS.md`, `README.md`, and
   `CONTRIBUTING.md`.
2. Read this guide and `docs/database.md`; read `docs/llm-quality-gate.md` for experiment decisions.
3. Check Git status and preserve unrelated changes.
4. Distinguish a read-only preview from a database write or paid request.
5. Verify external state before repeating an operation; append-only rows may already exist even when
   earlier terminal output is unavailable.
6. Never infer authorization for another paid event from an earlier approval.
7. Keep historical results separate from the forward track record.
8. Record exact versions, timestamps, fingerprints, review decisions, tokens, and failures.
9. Explain missing coverage and uncertainty instead of converting them into neutral or positive
   financial claims.

This guide explains system behavior. The quality thresholds for deciding whether extraction is
reliable enough to scale remain in `docs/llm-quality-gate.md`.
