# Future Improvements

This document records improvements that are useful but are intentionally deferred so the current
MVP remains small and understandable. An item in this file is not active functionality until it is
implemented and tested.

## Next iteration

### Use a database-aware SEC cutoff

**Status:** Agreed, not implemented

#### Current behavior

Every SEC synchronization uses the configured historical lookback, currently 730 days. The worker
downloads each company's recent-submissions response, filters the supported filings from that
period, and sends them to Supabase. The unique accession number prevents duplicate database rows,
but already-known filings are still processed again.

#### Proposed behavior

Use a different cutoff for each company:

1. Ask Supabase for the company's latest stored filing date.
2. If the company has no stored filings, use the full configured lookback for the initial backfill.
3. If filings already exist, subtract seven calendar days from the latest stored filing date.
4. Process SEC filings on or after that earlier date.
5. Continue using the unique SEC accession number as the final duplicate safeguard.

The seven-day overlap is intentional. It protects against partial job failures, multiple filings on
the same date, delayed SEC metadata, and temporary database errors.

#### What this improves

- Fewer existing filing objects are sent to Supabase on every run.
- Less repeated classification and database work.
- The initial historical backfill still works for a newly added company.
- A failed or incomplete run can safely catch up later.

#### What this does not improve

The SEC recent-submissions endpoint does not accept an `after` date. Chiron must still make one SEC
request per tracked company to discover whether a new filing exists. This change reduces local and
database processing, not the number or size of SEC responses.

#### Acceptance checks

- A company with no filings uses the full configured lookback.
- A company with existing filings uses its latest filing date minus seven days.
- Two filings on the same date are both retained.
- Repeating the synchronization creates no duplicate rows.
- A simulated partial failure is recovered by the next synchronization.

### Record document sizes and storage usage

**Status:** Core byte-size recording implemented on 2026-10-14; reporting improvements remain

#### Current behavior

The worker rejects a document larger than the 50 MB safety limit and records the exact downloaded
byte count for every new document. Existing document rows can remain empty until they are
backfilled or downloaded again.

#### Proposed behavior

1. Include document sizes in relevant worker summaries.
2. Report unusually large and rejected documents so the 50 MB limit can be reviewed using real
   examples.
3. Add a database query or internal dashboard summary for total archived storage.

#### What this improves

- Makes storage usage visible instead of estimated.
- Helps identify unexpectedly large SEC documents.
- Provides evidence for deciding whether compression or a retention policy is ever needed.
- Makes it easier to remain within the selected Supabase plan's storage allowance.

#### What this does not improve

Recording sizes does not reduce storage by itself. Original source documents used by a prediction
must remain available for auditing even if storage usage grows.

#### Acceptance checks

- The database records the byte size of every newly archived document. Implemented.
- Storage usage can be summarized by company, document type, and year.
- A rejected oversized document is visible in the worker job results or logs.
- Existing document rows can remain without a size until they are backfilled or downloaded again.

### Create provisional events before the periodic report arrives

**Status:** Agreed, not implemented

#### Current behavior

Event grouping requires a `10-Q` or `10-K` with a reporting-period end date to act as the anchor.
An earnings-related `8-K` and its press-release exhibit remain ungrouped until that periodic report
is available. Companies can publish the earnings release before filing the detailed report, so this
can delay creation of the earnings event and any live prediction.

#### Proposed behavior

1. Create a provisional earnings event when a confidently classified earnings `8-K` is discovered.
2. Preserve the original event detection time and the documents that were available at that time.
3. When the related `10-Q` or `10-K` arrives, attach it to the provisional event and confirm the
   reporting-period end date.
4. Manually test the current seven-day matching window against real earnings events. Keep, shorten,
   lengthen, or replace it based on the observed matches rather than treating seven days as a
   financial fact.
5. Use a deterministic matching rule with a version number and supporting metadata.
6. Flag ambiguous matches for manual review instead of silently joining unrelated filings.

#### What this improves

- Allows analysis to begin shortly after the earnings announcement.
- Avoids waiting for the later detailed quarterly or annual filing.
- Preserves an honest timeline of what information was available for a prediction.

#### What this does not improve

An `8-K` does not always provide a reliable reporting-period end date, and not every `8-K` concerns
earnings. The matching rule is an assumption that must be manually validated before it is trusted
for live predictions.

#### Acceptance checks

- A qualifying earnings `8-K` can create one provisional event without a `10-Q` or `10-K`.
- Repeating the grouping job does not create duplicate provisional events.
- A later matching periodic report upgrades the existing event instead of creating a second event.
- The event's original detection timestamp is not replaced during that upgrade.
- An ambiguous periodic-report match is recorded for review and is not linked automatically.
- A manually reviewed sample records whether the seven-day rule joined the correct filings, missed
  valid matches, or created false matches.
- Any change to the matching window creates a new grouping-rule version.

### Make event-group persistence recoverable

**Status:** Implemented on 2026-10-13

**Priority:** High — required before live predictions

#### Current behavior

The worker creates a new event with incomplete grouping metadata, updates every filing and document
relationship, and writes the final `grouping_metadata` only after those operations succeed. A
versioned persistence marker forces events written by the earlier unsafe order through the new path
once. If a relationship update fails, the completion metadata remains missing or outdated, so the
next run tries the operation again.

#### Implemented behavior

1. Create or find the earnings event without marking the new grouping as complete.
2. Unlink filings and documents removed from the group.
3. Link every current filing and document to the event.
4. Write the final versioned `grouping_metadata` only after all relationship updates succeed.
5. Later, consider moving the complete operation into one PostgreSQL transaction if the simpler
   retry-safe ordering is not sufficient.

#### What this improves

- A failed grouping run can repair itself on the next execution.
- Stored grouping metadata cannot claim success before the relationships are updated.
- Predictions are less likely to use missing or incorrectly linked source documents.

#### What this does not improve

Changing the write order does not make several Supabase requests fully atomic. A PostgreSQL
transaction would still provide stronger all-or-nothing behavior, but retry-safe ordering is the
simplest appropriate first step.

#### Acceptance checks

- Automated tests confirm that completion metadata is written after all relationship steps.
- Automated tests simulate each relationship phase failing and confirm that completion metadata is
  not written.
- New events are inserted without completed grouping metadata.
- Existing events without the persistence version are processed once through the safer write order.
- A live verification upgraded 40 existing groups on its first run and changed zero groups on the
  immediately repeated run.
- Existing event detection timestamps are not included in any retry or completion update.

### Represent incomplete event grouping with an explicit status

**Status:** Agreed, not implemented

**Priority:** Next iteration

#### Current behavior

A newly created earnings event immediately has the `detected` status, even though its filing and
document relationships may still be incomplete. An empty or outdated `grouping_metadata` value is
the technical marker that tells the worker to retry the grouping operation.

#### Proposed behavior

1. Add an explicit event status such as `grouping_pending`.
2. Create an event with that status before linking its filings and documents.
3. Change the status to `detected` only after every relationship and the completed grouping
   metadata have been saved successfully.
4. Keep incomplete events visible for retrying and operational review.

#### What this improves

- The event status directly describes whether grouping is complete.
- Database rows are easier for contributors and operators to understand.
- Incomplete events can be queried without interpreting the contents of `grouping_metadata`.

#### Acceptance checks

- New events begin with `grouping_pending`.
- A successful grouping changes the status to `detected` only at the final completion step.
- A failed relationship update leaves the status as `grouping_pending`.
- A later worker run can complete the event without changing its original detection timestamp.

### Apply one rate limiter to every SEC request

**Status:** Implemented on 2026-10-13

**Priority:** High — required before expanding the watchlist

#### Current behavior

Every SEC request now passes through one shared request client. It spaces request starts by at least
200 ms, applies a fresh timeout to every attempt, and retries temporary network failures and HTTP
statuses `408`, `429`, `500`, `502`, `503`, and `504` up to three attempts. It honors a
`Retry-After` header within a bounded maximum delay. Company submissions, filing-index pages,
primary documents, and exhibits all use this client.

#### Implemented behavior

1. Route every SEC network request through one shared rate limiter.
2. Enforce a conservative minimum interval, initially 200 ms, for a maximum of approximately five
   requests per second from this worker.
3. Cover submissions metadata, filing-index pages, primary documents, and exhibits with the same
   limiter.
4. Retry temporary SEC throttling and server failures with bounded backoff, respecting a
   `Retry-After` header when one is provided.
5. Keep the configured SEC user agent on every request.

#### What this improves

- Makes compliance with SEC fair-access guidance explicit and testable.
- Prevents a larger watchlist or a fast connection from creating request bursts.
- Provides predictable behavior when the SEC temporarily throttles access.

#### What this does not improve

A rate limiter cannot guarantee that the SEC will always accept a request. The SEC can change its
guidance or temporarily restrict automated traffic, so failures must still be recorded and retried
later without losing data.

#### Acceptance checks

- Automated tests confirm that all SEC request paths use the shared limiter.
- Request start times never exceed the configured rate in a simulated fast-response run.
- A simulated `429` response follows the bounded retry policy.
- Retry exhaustion fails the tracked job with a clear error.
- Increasing the watchlist does not create concurrent SEC request bursts.

## Nice to have

### Strengthen document synchronization and extraction reuse

**Status:** Partial — recoverable Storage/database persistence implemented on 2026-10-14

#### Current behavior

For each supported earnings filing, the worker downloads the relevant original SEC documents and
stores them in the private `sec-documents` bucket. The `documents` table stores only their metadata,
including the storage path and SHA-256 content fingerprint. Structured JSON extraction will be
stored separately as derived data.

The worker loads the source URLs stored in the `documents` table and skips a download when the same
URL has already been archived. If a Storage upload succeeds but the following database insert
fails, the next run finds the deterministic Storage path, downloads the existing private object,
verifies its SHA-256 fingerprint, and retries the missing database insert. New uploads disable
overwriting so archived evidence cannot be silently replaced.

#### Proposed behavior

1. Store only documents that are relevant to an earnings event, rather than every attachment in a
   filing.
2. Run structured JSON extraction only when no extraction exists for the same document fingerprint,
   prompt version, and model version.
3. Re-run extraction only as an explicit versioned operation when the extraction rules, prompt, or
   model change.
4. Consider compression or a retention policy only if measured storage usage shows that one is
   necessary. Original source documents used by a prediction must remain available for auditing.

#### What this improves

- Reliable recovery from partially completed document writes.
- Protection against accidentally overwriting archived source evidence.
- Fewer LLM calls and lower extraction cost.
- Clear separation between immutable source evidence and replaceable, versioned JSON extraction.

#### What this does not improve

This does not remove the need to keep the original SEC document. Storing only the extracted JSON
would make it impossible to reliably audit or correct an extraction later. It also does not assume
that storage is a problem before measurements show that it is.

#### Acceptance checks

- The existing source-URL check continues to skip documents already recorded in the database.
- A simulated failure between Storage upload and database insert is repaired by the next run.
  Implemented.
- An existing archived object with different content is not silently overwritten. Implemented.
- An existing document can be extracted without requesting it from the SEC again.
- The same document and extraction version produces at most one extraction record.
- A new prompt or model version creates a new extraction without overwriting the previous result.
- Every prediction still points to the exact original documents and extraction versions it used.

## Adding another improvement

For each future item, record:

- the current behavior,
- the proposed behavior,
- why the change is useful,
- what it does not solve,
- and how we will verify it.
