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

**Status:** Implemented and verified against the live database on 2026-10-21

#### Current behavior

An earnings-related `8-K` creates a provisional event immediately. A single `10-Q` or `10-K`
published afterward for the same company within the versioned 24-hour window confirms that event's
reporting-period end date. The original event row and `detected_at` value are preserved. Zero
matches leave the event provisional, while multiple matches are recorded as ambiguous instead of
being joined automatically.

#### Implemented behavior

1. Create a provisional earnings event when a confidently classified earnings `8-K` is discovered.
2. Preserve the original event detection time and the documents that were available at that time.
3. When the related `10-Q` or `10-K` arrives, attach it to the provisional event and confirm the
   reporting-period end date.
4. Use a 24-hour forward-only matching window based on the initial stored-data validation.
5. Use a deterministic matching rule with a version number and supporting metadata.
6. Flag ambiguous matches for manual review instead of silently joining unrelated filings.

#### What this improves

- Allows analysis to begin shortly after the earnings announcement.
- Avoids waiting for the later detailed quarterly or annual filing.
- Preserves an honest timeline of what information was available for a prediction.

#### What this does not improve

An `8-K` does not always provide a reliable reporting-period end date, and not every `8-K` concerns
earnings. The 24-hour rule was validated only against the current large-company sample and is not a
universal financial fact.

#### Initial matching-window validation

The stored-data audit covered 40 earnings `8-K` filings across the initial five-company watchlist.
All 40 had exactly one later `10-Q` or `10-K` within 24 hours, no release was unmatched or
ambiguous, and the largest observed gap was 13.52 hours. The sample supports 24 hours for the first
PoC but must be repeated when the watchlist or historical universe expands.

After the migration, the first live run upgraded all 40 existing events without changing their
`detected_at` values. Every event received its origin filing and version-two grouping metadata, no
duplicate company-period or origin-filing relationships were found, and an immediate second run
made zero changes.

#### Acceptance checks

- A qualifying earnings `8-K` can create one provisional event without a `10-Q` or `10-K`.
- Repeating the grouping job does not create duplicate provisional events.
- A later matching periodic report upgrades the existing event instead of creating a second event.
- The event's original detection timestamp is not replaced during that upgrade.
- An ambiguous periodic-report match is recorded for review and is not linked automatically.
- A stored-data sample records whether the matching rule joined the correct filings, missed valid
  matches, or created ambiguous matches. Implemented for the initial 40-event sample.
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

### Make event persistence atomic with a PostgreSQL transaction

**Status:** Planned after the PoC

**Priority:** High before concurrent workers or commercial use

#### Current behavior

The retry-safe write order prevents an incomplete event from being presented as complete, but it
still uses several separate Supabase database requests. A temporary failure can leave an event in
`grouping_pending` until the next worker run repairs it.

#### Proposed behavior

1. Add a versioned PostgreSQL function through a Supabase migration.
2. Send the complete event group to that function with one server-side `rpc()` call.
3. Inside one transaction, find or create the event, validate conflicts, update filing and document
   relationships, save grouping metadata, and set the final status.
4. Acquire a database lock for the event so two workers cannot modify it concurrently.
5. Preserve the original `detected_at` value when a provisional event becomes confirmed.
6. Keep Supabase Storage outside the transaction. Continue using deterministic paths and SHA-256
   verification so a later run can repair a file upload whose database operation failed.

#### What this improves

- Every database change for one event either succeeds together or is rolled back together.
- Concurrent workers cannot create conflicting relationships for the same event.
- The TypeScript worker becomes simpler because PostgreSQL owns the multi-table write operation.

#### What this does not improve

PostgreSQL cannot include Supabase Storage uploads in the same transaction. File persistence must
remain immutable and retry-safe. A database transaction also cannot decide whether the financial
matching rule itself is correct; ambiguous matches must still be recorded for review.

#### Implementation trigger

Implement this before running multiple workers, substantially expanding the watchlist, or preparing
the system for commercial use. It can also be brought forward if live PoC logs show repeated partial
database failures.

#### Acceptance checks

- A simulated failure during any database step leaves none of that transaction's changes committed.
- Two concurrent calls for the same event produce one consistent event and relationship set.
- A provisional event is confirmed without changing its original `detected_at` value.
- Existing uniqueness constraints remain active as a final protection against duplicates.
- A Storage upload followed by a failed database transaction is repaired safely by the next run.

### Represent incomplete event grouping with an explicit status

**Status:** Implemented and verified against the live database on 2026-10-21

**Priority:** Completed prerequisite for the live PoC

#### Current behavior

A newly created earnings event has the `grouping_pending` status while its filing and document
relationships are saved. The final persistence step changes it to `provisional` when only an
earnings release is available or `detected` when a periodic report has confirmed the event.

#### Implemented behavior

1. Add an explicit event status such as `grouping_pending`.
2. Create an event with that status before linking its filings and documents.
3. Change the status to `provisional` or `detected` only after every relationship and the completed
   grouping metadata have been saved successfully.
4. Keep incomplete events visible for retrying and operational review.

#### What this improves

- The event status directly describes whether grouping is complete.
- Database rows are easier for contributors and operators to understand.
- Incomplete events can be queried without interpreting the contents of `grouping_metadata`.

#### Acceptance checks

- New events begin with `grouping_pending`.
- A successful grouping changes the status to `provisional` or `detected` only at the final
  completion step.
- A failed relationship update leaves the status as `grouping_pending`.
- A later worker run can complete the event without changing its original detection timestamp.

### Reconcile amended earnings releases

**Status:** Planned

**Priority:** Next iteration before expanding the historical dataset

#### Current behavior

An earnings `8-K` and a later earnings `8-K/A` can each create a provisional event when both arrive
before the related `10-Q` or `10-K`. Once the periodic report arrives, both filings can join the
confirmed group, but the additional provisional row may remain and require manual review.

#### Proposed behavior

1. Detect an amended release using its company, form type, publication order, report date, and SEC
   metadata instead of assuming every nearby `8-K/A` belongs to the same event.
2. Preserve both source filings and their publication timestamps.
3. Designate one event as the continuing event and record why the amendment was attached to it.
4. Remove or mark the redundant provisional event through an explicit, auditable operation.
5. Never merge two provisional events automatically when the relationship is ambiguous.

#### Acceptance checks

- A confirmed event can contain both its original earnings `8-K` and a related `8-K/A`.
- Confirmation does not leave a second active provisional event for the same amended release.
- Unrelated nearby `8-K` filings are not merged merely because their publication times are close.
- The original detection time and both source-publication times remain available for auditing.

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

### Query only financial documents that still need extraction

**Status:** Agreed, not implemented

**Priority:** Scaling improvement after the PoC dataset becomes materially larger

#### Current behavior

The financial-metric job reads the stored periodic-document list and the completed-extraction list,
then compares them in worker memory. Only incomplete documents are downloaded and parsed. With the
current 41 periodic reports, this is a small operation and is suitable for the free-tier PoC.

#### Proposed behavior

Move the comparison into PostgreSQL using a view, database function, or `not exists` query. Return
only documents that do not have a completion record for the requested extraction version and source
fingerprint.

#### What this improves

- Avoids transferring the complete document and completion indexes on every scheduled run.
- Keeps an empty hourly run small when historical storage grows to thousands of reports.
- Preserves the existing retry behavior for partial failures and new parser versions.

#### Implementation trigger

Implement this when query measurements show that listing all records is no longer negligible, or
before expanding the historical dataset to many thousands of periodic reports.

#### Acceptance checks

- A completed document/version/fingerprint combination is not returned.
- A new document, changed source fingerprint, or new extraction version is returned.
- An empty run does not download or parse any SEC document.
- Results remain correct across database pagination boundaries.

### Query only changed inputs for financial calculations

**Status:** Agreed, not implemented

**Priority:** Scaling improvement after the PoC dataset becomes materially larger

#### Current behavior

The standard financial-calculation job loads the versioned revenue and net-income rows plus existing
calculation completions, builds each event's exact input fingerprint, and processes only fingerprints
that are not complete. With the current dataset this is small, and no SEC document is downloaded.

#### Proposed behavior

Move current-period selection, previous-year matching, and pending-input detection into a PostgreSQL
view or function. Return only events whose selected source metrics produce a new input fingerprint.

#### What this improves

- Avoids transferring all historical source metrics and completion keys on every scheduled run.
- Keeps the hourly calculation step small when the historical dataset reaches many thousands of
  events.
- Preserves recalculation when an amended filing or a new formula version changes the inputs.

#### Implementation trigger

Implement this when measured query volume is no longer negligible or before a large historical
backfill. The in-memory approach is simpler and appropriate for the current PoC.

### Add bounded parallel financial extraction

**Status:** Agreed, not implemented

**Priority:** Scaling improvement after sequential processing becomes measurably slow

#### Current behavior

The worker processes pending periodic reports one at a time. This keeps memory, Supabase Storage
traffic, logs, and failure recovery simple. The first 41-document backfill completed within the
GitHub workflow limit, and normal scheduled runs usually process zero or only a few new reports.

#### Proposed behavior

Process a small configurable number of independent documents simultaneously, initially three to
five. Keep the limit shared within one worker, preserve per-document fingerprint and database
verification, and never start unbounded requests with `Promise.all()` over the full pending list.

#### What this improves

- Reduces backfill and new-version extraction time for a much larger watchlist.
- Uses available network and CPU capacity without creating an uncontrolled Storage request burst.
- Keeps one document failure isolated and recoverable through its missing completion record.

#### Implementation trigger

Implement this only when measured extraction runtime approaches the workflow time limit or delays
processing for the expanded watchlist. Sequential processing remains preferable while its runtime is
small.

#### Acceptance checks

- Active document processing never exceeds the configured concurrency limit.
- A failed document does not corrupt or duplicate successful document results.
- The next run retries only documents without verified completion records.
- Memory and Supabase request rates remain within measured safe limits.
- Output is identical to sequential extraction for the same documents and parser version.

### Persist paid LLM requests before calling the provider

**Status:** Agreed, not implemented

**Priority:** Required before qualitative extraction is scheduled or run at larger volume

#### Current behavior

The manually controlled qualitative command reads and verifies its Supabase inputs, calls the LLM,
then inserts the complete attempt into `extraction_runs`. If the provider succeeds but the database
becomes unavailable immediately afterward, the paid output cannot be recovered because provider
storage is disabled and no database record existed before the request.

#### Proposed behavior

Create a durable request record before the provider call. Store the final provider result as a
separate append-only record linked to that request. A request left without a result clearly shows
that execution was interrupted or its completion is unknown. Completed results remain immutable;
the implementation must not achieve recovery by allowing earlier results to be overwritten.

#### What this improves

- Preserves evidence that a paid request started even if the worker or database fails afterward.
- Distinguishes never-started, interrupted, failed, and completed extraction attempts.
- Supports safe recovery without silently issuing a duplicate paid request.

#### What this does not improve

No database design can guarantee recovery of a response that the provider delivered only to a
worker process that crashed before persisting it. Provider idempotency or retrievable response
storage would be needed for that final gap and must be evaluated against privacy requirements.

#### Acceptance checks

- A durable request row exists before the external provider receives the request.
- Provider results are appended and cannot modify earlier completed results.
- An interrupted request is visible and is not automatically charged again.
- Manual recovery requires an explicit decision and records its relationship to the earlier request.
- Logs never contain source documents, LLM output, or API credentials.

### Automate guarded qualitative LLM execution

**Status:** Agreed, not implemented

**Priority:** After the manual PoC demonstrates stable extraction quality and predictable cost

#### Current behavior

The scheduled SEC workflow prepares readable source text and deterministic financial data but stops
before any paid LLM request. The owner explicitly previews an event, authorizes one qualitative
extraction, and then accepts, corrects, or rejects the completed output. Local validation never
turns an extraction into an approved result automatically.

#### Proposed behavior

1. Consider only complete, unambiguous earnings events with the required verified source text.
2. Create the durable paid-request record before contacting the provider.
3. Allow at most one provider call for each unique versioned input fingerprint.
4. Enforce configured input-token, calls-per-run, and monthly-cost limits before making a request.
5. Never automatically retry a failed, interrupted, refused, or incomplete paid request.
6. Store every outcome and validation result without making it effective automatically.
7. Continue requiring a human decision to accept, correct, or reject every completed extraction.

#### What this improves

- Removes the need to start each routine extraction from the terminal or dashboard.
- Keeps duplicate workflow runs from creating duplicate paid requests.
- Allows new events to become ready for review sooner while preserving cost controls.

#### What this does not improve

Automatic execution does not prove that the financial interpretation is correct. Schema and exact
evidence validation catch technical problems, not missing context or mistaken judgment. Human
approval therefore remains a separate mandatory step before scoring can use an extraction.

#### Acceptance checks

- The same input fingerprint cannot create a second automatic provider call.
- Ambiguous or incomplete events never trigger a paid call.
- Limit exhaustion creates a visible deferred result rather than a provider request.
- Provider failures are stored and are not retried automatically.
- Valid output remains unavailable to scoring until a human accepts or corrects it.
- The scheduled workflow never receives more provider permissions than the extraction job needs.

### Revalidate historical outputs after validation-rule changes

**Status:** Agreed, not implemented

**Priority:** Post-MVP, after repeated validation-rule changes or a larger extraction history

#### Current behavior

An extraction keeps the validation result produced when it originally ran. If a later code change
fixes an overly strict validation rule, earlier invalid rows remain immutable and must be reviewed
manually. This preserves the historical result but creates repeated work when the same technical
validation issue affected several events.

#### Proposed behavior

1. Store the semantic-validation rule version used for every new extraction and review.
2. Add a free dry-run command that checks historical invalid outputs against a selected newer
   validation version without calling the LLM or changing the database.
3. Report which outputs now pass unchanged, which still fail, and why.
4. After explicit confirmation, append a separate `revalidated` review record for unchanged outputs
   that pass the newer validator. Never update the original extraction row or its original status.
5. Keep content corrections separate. Missing risks, incorrect tone, or other financial-interpretation
   changes still require a human-reviewed `corrected` record.
6. Process records in bounded pages so a large history does not create an unbounded database job.

#### What this improves

- Avoids repeating paid LLM requests when only a local validation rule changed.
- Applies a proven technical fix consistently across affected historical outputs.
- Preserves which rule produced the original result and which newer rule accepted it.
- Keeps human judgment responsible for changes to the extracted financial meaning.

#### Acceptance checks

- Dry-run mode performs no database writes and no provider requests.
- Revalidation is deterministic for the same output, evidence, source documents, and rule version.
- Every appended revalidation identifies the original extraction and both validation-rule versions.
- The original extraction status and output remain unchanged.
- A changed output cannot be labeled `revalidated`; it must use the correction workflow.
- The command requires explicit confirmation before appending any records.

### Add reviewed-example RAG for qualitative extraction

**Status:** Agreed, not implemented

**Priority:** Next iteration after enough reviewed corrections exist

#### Current behavior

The baseline qualitative extractor uses the current and previous earnings-release inputs, one
versioned prompt, and local evidence validation. Human reviews preserve accepted, corrected, and
rejected results, but a new extraction does not retrieve lessons from earlier reviewed examples.
The OpenAI model does not automatically learn Chiron's corrections from earlier API calls.

#### Proposed behavior

1. Enable PostgreSQL's `pgvector` extension in Supabase rather than introducing a separate vector
   database for the initial implementation.
2. Add a versioned reviewed-example table containing compact relevant source text, the accepted or
   corrected structured result, review metadata, an embedding, the embedding-model version, and a
   content fingerprint.
3. Exclude rejected, unreviewed, and technically invalid examples from retrieval.
4. Generate an embedding for a new extraction input and retrieve a small bounded number of similar
   examples, initially two or three.
5. Apply explicit metadata filters where useful, such as document type, company, sector, and
   available source coverage. Keep similarity thresholds and ranking rules versioned.
6. Include only the compact reviewed examples needed by the prompt; never send an unbounded set of
   complete filings to the LLM.
7. Store the retrieved example IDs, distances, retrieval-rule version, embedding-model version, and
   final prompt-input fingerprint with every extraction.
8. Compare the same extraction task with and without retrieval before enabling RAG for normal use.

For live extraction, only examples reviewed before the new extraction cutoff are eligible. During
historical replay, the same rule is mandatory: an event may retrieve only examples that were
available at that historical time. A later human correction must never leak into an earlier
backtest.

The public `chiron-core` repository should contain a complete generic RAG implementation, public
schema, retrieval interfaces, example fixtures, and evaluation harness. Real correction data,
detailed experiments, tuned retrieval settings, and any later proven enhancement may remain in
`chiron-research`. Ordinary embeddings and cosine-similarity code are not treated as a commercial
advantage by themselves.

#### What this improves

- Reuses corrected examples without retraining or silently modifying the language model.
- Helps the extractor handle equivalent financial language expressed with different wording.
- Demonstrates embeddings, vector search, metadata filtering, prompt construction, versioning, and
  leakage-safe evaluation in the public project.
- Creates a controlled feedback loop from human review to a candidate extraction improvement.

#### What this does not improve

RAG does not itself train the prediction model or prove that extracted signals predict stock
outperformance. Similar examples can also make an extraction worse when retrieval is irrelevant or
biased. The prompt, retrieval rules, and production version must never update themselves
automatically from one failure.

#### Implementation trigger

Design the schema now, but implement retrieval after approximately 30–50 useful reviewed examples
exist. Use the larger manual review target to judge extraction quality before claiming an
improvement. Historical source text and corrections are already preserved, so embeddings can be
generated later without losing information.

#### Acceptance checks

- Only accepted or corrected examples are eligible for retrieval.
- Every retrieved example was reviewed before the extraction cutoff being evaluated.
- Embeddings compared in one search come from the same versioned embedding model.
- Retrieval is bounded and records all selected example IDs and similarity values.
- The baseline and RAG variants are compared on untouched reviewed events.
- Evaluation measures field accuracy, unsupported claims, evidence validity, token usage, cost, and
  latency.
- Enabling a new retrieval version is an explicit deployment decision; old extractions never
  change.

### Add a server-side GraphQL API for the live dashboard

**Status:** Initial local read API implemented; deployment hardening remains

**Priority:** Required before the Vue dashboard reads real Supabase data

#### Current behavior

The Vue overview reads frozen prediction events, recent events without predictions, the configured
company watchlist, and exact frozen evidence through the application-owned Node GraphQL API in
`apps/api`. The API uses the Supabase secret only on the server, binds to the local computer, limits
event lists, and returns approved presentation fields. Vue never receives the Supabase secret or
queries Supabase directly. Authentication, public deployment controls, full pagination, review
mutations, financial-detail queries, and outcome-detail queries are not implemented yet.

#### Proposed behavior

Continue the small Node.js/TypeScript GraphQL server in `apps/api`, or deploy the same API through
equivalent serverless functions. Vue sends queries to our GraphQL endpoint. Its resolvers perform
narrowly defined Supabase queries using credentials available only on the server.

Define an application-owned schema for companies, earnings events, source evidence, financial
values, and calculated comparisons. The schema must not automatically expose the PostgreSQL schema.
Add mutations later for manual review and corrections, with input validation and authorization.
Use cursor or bounded page-size pagination for lists, batch related database reads to avoid repeated
queries, and keep private research fields behind explicitly separate resolvers and access rules.

This is different from connecting Vue directly to Supabase GraphQL. Our Node server controls the
GraphQL schema, resolver logic, returned fields, and public/private boundary. The Supabase secret
key remains on that server and is never sent to Vue. REST can still be added for simple operational
endpoints such as health checks or webhooks when it is a better fit.

#### Compact dashboard read model

The first prediction-event resolver reads each complete immutable prediction snapshot because the
summary, guidance, tone, margin direction, and main risk are stored inside it. This is appropriate
for the small PoC and preserves one source of truth, but repeatedly transferring complete audit
snapshots would become inefficient with thousands of predictions.

After the PoC, add a compact database view, projection table, or narrowly selected API read model
containing only approved dashboard fields. Derive it from the immutable prediction and review data;
never replace, shorten, or mutate the original audit snapshot. Version the projection logic and
retain the prediction ID so every displayed value can be traced back to its permanent source.

#### Graceful API shutdown before production deployment

The local API currently exits when its process is stopped. Before production deployment, handle
the hosting platform's termination signals, stop accepting new HTTP requests, allow active requests
to finish within a bounded timeout, dispose GraphQL resources, and then exit. This prevents a deploy
or restart from abruptly interrupting an in-progress review or read request. Log shutdown start,
completion, timeout, and failure without exposing secrets.

#### Generate frontend types from the GraphQL contract

The first Vue query uses manually maintained TypeScript response interfaces. Before the number of
queries and fields grows, add GraphQL Code Generator or an equivalent build-time tool. Generate
operation-specific frontend types from the server schema and checked query documents so a renamed,
removed, or nullability-changed field fails during development instead of becoming a browser runtime
error. Commit deterministic generated types if that keeps public setup simpler, and verify in CI that
regeneration produces no unexpected diff.

#### What this improves

- Keeps the Supabase secret key exclusively on the server.
- Prevents the browser from selecting arbitrary database tables and columns.
- Creates one place for validation, pagination, query limits, authorization, and public/private
  data boundaries.
- Lets the public core dashboard use a stable API contract while private research logic remains in
  `chiron-research`.
- Avoids coupling Vue components directly to the database schema.
- Lets one event-details query retrieve its company, evidence, financial values, and outcomes.

#### What this does not improve

A GraphQL server is not automatically secure. Every resolver still needs explicit input validation,
restricted responses, safe error messages, and deployment configuration. Query depth, complexity,
page size, and execution time need limits so one request cannot create excessive database work.
User accounts and public internet access are not needed for the local PoC and should not be added
before they are required.

#### Acceptance checks

- No Supabase secret or server-only environment variable appears in the frontend source or build.
- Vue receives real data only through the application-owned GraphQL schema.
- GraphQL lists are paginated and resolvers expose only approved fields.
- Query depth, complexity, page size, and execution time have explicit limits.
- Related records are batched so one query does not create one database request per returned row.
- Dashboard lists do not repeatedly transfer complete immutable snapshots at larger scale.
- Every projected presentation field remains traceable to its immutable prediction snapshot.
- Production termination signals stop the API gracefully within a bounded timeout.
- Frontend operation types are generated from the checked GraphQL schema and query documents.
- Database and API errors do not reveal credentials or private research data.
- Public core endpoints can run without the private research repository.
- Private predictions, corrections, and research results require explicitly separate access.

### Add the dashboard qualitative-review and correction workflow

**Status:** Agreed, not implemented

**Priority:** Required when the live dashboard begins displaying real qualitative extractions

#### Current behavior

A reviewer uses a command-line action to accept, correct, or reject an LLM extraction. A correction
requires a complete validated JSON file. The original `extraction_runs` row remains immutable, the
decision is appended to `extraction_reviews`, and the effective-output selector chooses the newest
usable human-reviewed result. This is auditable but inconvenient for routine review.

#### Proposed behavior

1. Show the original LLM output beside each exact supporting passage in the event-details view.
2. Provide explicit `Accept`, `Correct`, and `Reject` actions.
3. When `Correct` is selected, open a structured form for guidance, margin direction, management
   tone, positives, risks, summary, source limitations, and their evidence references.
4. Submit the complete corrected output and the fingerprint of the original output through a
   narrowly defined GraphQL mutation. Vue must never write directly to Supabase.
5. Validate the allowed values, complete JSON schema, evidence passage IDs, source-document roles,
   output fingerprints, reviewer identity, and review notes on the Node server.
6. Append a new `extraction_reviews` row without updating either the original extraction or an
   earlier review.
7. Display the original result, complete review history, and currently effective result clearly.
8. Allow a later review to correct or reject an earlier decision. The newest valid review controls
   the effective result while every earlier decision remains visible.
9. Make future scoring read only the effective reviewed output and refuse unreviewed, invalid, or
   rejected output.

#### What this improves

- Removes the need to create correction JSON files manually.
- Makes financial interpretation and supporting evidence reviewable in one place.
- Reduces correction mistakes through constrained form controls and server-side validation.
- Preserves a clear explanation of why scoring used an original or corrected value.

#### What this does not improve

The interface cannot determine whether a financial interpretation is correct. Human judgment is
still required. A locally valid extraction must not be automatically accepted, and a later
correction must never rewrite a prediction that was already frozen from an earlier effective
snapshot.

#### Acceptance checks

- The browser never receives the Supabase secret key or writes directly to review tables.
- Accepting an extraction records its exact original fingerprint.
- Correcting one field submits and validates one complete corrected output.
- Invalid enum values, missing evidence, mismatched fingerprints, and cross-event evidence are
  rejected before insertion.
- Rejecting an extraction prevents it from being selected for new scoring.
- A second correction creates another review row and leaves the first correction unchanged.
- The dashboard identifies the original result, every review decision, and the effective result.
- Existing predictions continue using their frozen snapshot even if a newer correction is added.

## Nice to have

### Verify the official market calendar automatically

**Status:** Planned

**Priority:** Before the stored calendar coverage expires or commercial use

#### Current behavior

The versioned `market_sessions` rows are generated from holiday and early-close dates that were
manually checked against the official NYSE trading-hours calendar. The worker does not periodically
download or compare that page. Extending the calendar or handling a published revision therefore
requires a person to review the official source and add a new migration and calendar version.

#### Proposed behavior

1. Periodically retrieve an official exchange calendar source.
2. Compare its holidays, regular hours, and early closes with the active stored calendar version.
3. Report missing future coverage or differences without changing historical rows automatically.
4. Require a reviewed migration to create a new calendar version when a real difference is found.
5. Record when the source was checked and which published schedule was compared.

#### What this improves

- Warns us before the stored calendar runs out.
- Detects official schedule revisions and unusual announced closures.
- Reduces the chance that a reference price or evaluation horizon uses an incorrect trading day.
- Preserves reproducibility because detection does not silently rewrite an existing version.

#### Acceptance checks

- An unchanged official schedule produces no alert and no database writes.
- A new holiday, early close, or uncovered year produces a clear review item.
- Existing calendar-version rows remain unchanged.
- A reviewed difference is added under a new version and can be selected by future rules.
- Temporary source failures do not create or modify calendar data.

### Strengthen document synchronization and extraction reuse

**Status:** Partial — recoverable Storage/database persistence implemented on 2026-10-14

#### Current behavior

For each supported earnings filing, the worker downloads the relevant original SEC documents and
stores them in the private `sec-documents` bucket. The `documents` table stores only their metadata,
including the storage path and SHA-256 content fingerprint. Structured JSON extraction will be
stored separately as derived data.

The worker loads the source URLs stored in the `documents` table and skips a download when the same
URL has already been archived. If a Storage upload succeeds but the following database insert
fails, the next run lists the deterministic Storage folder and compares the exact filename. It then
downloads the existing private object, verifies its SHA-256 fingerprint, and retries the missing
database insert. New uploads disable overwriting so archived evidence cannot be silently replaced.
Folder listing is used because the Supabase `exists()` request returned HTTP 400 for a valid missing
object during the live META filing run on 2026-10-22.

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

### Retain completed LLM extractions while cleaning up old failed attempts

**Status:** Agreed, not implemented

**Priority:** Nice to have after real extraction volume is measured

#### Current behavior

Database triggers prevent updates and deletes for every `extraction_runs` row. This gives the first
PoC a simple, honest audit history, but it also retains unsuccessful technical attempts forever.

#### Proposed behavior

Keep completed extraction records permanent when they support research, corrections, or
predictions. Define a measured retention period for old failed attempts such as temporary network
errors, refusals, and incomplete responses. Preserve any aggregate usage and cost measurements
needed before removing eligible failures. Cleanup must be an explicit, logged operation rather than
an automatic side effect of a normal extraction run.

#### What this improves

- Prevents repeated technical failures from becoming permanent database clutter.
- Preserves the immutable history of completed research outputs.
- Keeps token-cost and reliability analysis available for the period where it is useful.

#### Acceptance checks

- Completed extractions cannot be updated or deleted by the application.
- Failed attempts are deleted only after the documented retention period.
- Cleanup records how many rows were removed and which cutoff was used.
- A failed-attempt cleanup cannot delete an extraction referenced by a prediction or correction.

### Detect SEC HTML changes and degraded text extraction

**Status:** Agreed, not implemented

**Priority:** Next iteration — required before relying on automated extraction at larger scale

#### Current behavior

The current converter uses standard HTML headings, paragraphs, tables, rows, and cells rather
than company-specific CSS classes. It removes scripts and explicitly hidden content, converts
tables into readable rows, and rejects a result only when no readable text was produced. It was
validated against the current archived documents, including META's `8-K`, Exhibit `99.1`, and
`10-Q`.

#### Proposed behavior

1. Compare the readable-text size with the archived source size and flag unusual changes.
2. Record whether basic document markers, headings, and financial table content survived.
3. Flag unexpectedly short output, extremely long lines, or abnormal amounts of repeated text.
4. Keep representative fixtures for `8-K`, Exhibit `99.1`, `10-Q`, and `10-K` documents from
   different companies.
5. Run those fixtures automatically whenever the converter changes.
6. Record extraction warnings and allow the affected document to be reviewed instead of silently
   using questionable text.
7. Create a new extraction-rule version when a material parser change affects output.

#### What this improves

- Detects when an SEC or company HTML structure change produces incomplete or noisy text.
- Prevents a technically successful conversion from being mistaken for a reliable extraction.
- Makes expansion beyond the initial large-company sample safer.

#### What this does not improve

Automated checks cannot prove that every meaningful sentence or table relationship was preserved.
Representative documents and flagged results still require human review. A document format such as
PDF would also require a separate versioned converter.

#### Acceptance checks

- Empty and unusually short outputs are rejected or marked for review.
- A material size-ratio change is visible in job results.
- Representative document fixtures retain expected headings, sentences, and table rows.
- Extraction warnings are stored with the document text version.
- A new converter version does not overwrite earlier text artifacts.

### Broaden material-risk coverage beyond earnings releases

**Status:** Agreed, not implemented

**Priority:** Required before risk signals materially influence live or commercial scoring

#### Current behavior

The MVP qualitative extraction reads the current earnings release and, when available, the previous
earnings release. It can find risks management discusses there, but it does not yet inspect the
legal-proceedings and risk-factor sections of periodic SEC reports, official regulator publications,
or external news. The immutable input manifest records those exclusions. No extracted risk means
"not found in the supplied releases," not "the company has no risks."

#### Proposed behavior

1. Ingest relevant `10-Q` and `10-K` legal-proceedings and risk-factor sections, plus material
   non-earnings `8-K` filings.
2. Compare each SEC section with its previous version so new, increased, reduced, and removed risks
   can be distinguished from unchanged boilerplate.
3. Add timestamped official regulatory sources, such as regulator decisions or case updates, before
   considering broader third-party news.
4. Store the original source, publication time, first-seen time, exact evidence, extraction version,
   and correction history for every risk claim.
5. Allow only sources available by the prediction cutoff into the immutable prediction snapshot.
6. Keep source coverage separate from the signal score. Missing sources produce an explicit warning
   or confidence limitation, never positive score points.
7. Add external news only after source licensing, timestamp reliability, cost, and extraction quality
   have been evaluated.

#### What this improves

- Reduces the chance that a score overlooks a material legal or regulatory issue absent from the
  earnings release.
- Makes changed risks more useful than a repeated generic list.
- Makes clear whether a result is based on narrow earnings-release evidence or broader coverage.

#### Acceptance checks

- Every risk claim links to exact evidence and point-in-time source metadata.
- A source published or first discovered after the cutoff cannot affect an earlier prediction.
- The dashboard clearly distinguishes "no risk found in examined sources" from "no company risk."
- An empty risk list never improves the score.
- Reprocessing with broader coverage creates a new versioned result and preserves the earlier one.

### Record material company news as evaluation context

**Status:** Agreed, not implemented

**Priority:** Post-MVP research feature

#### Current behavior

Chiron monitors SEC filings related to earnings. It does not monitor general company announcements,
such as a major partnership, product announcement, or acquisition. A material announcement during
the 20-trading-day evaluation period could move the stock price, but the result currently has no
structured note explaining that external event. Chiron can also miss the earliest version of an
earnings release when a company publishes it on its investor-relations website before the related
SEC `8-K`.

#### Proposed behavior

1. Start with reliable first-party sources: non-earnings SEC `8-K` filings, company investor-
   relations pages, and official company newsrooms.
2. Monitor official investor-relations earnings releases so a provisional event can be created when
   the company publication appears before its SEC filing.
3. Use the later `8-K` and `10-Q` or `10-K` to confirm and complete that same event without replacing
   its original detection timestamp.
4. Store the source URL, publication timestamp, discovery timestamp, company, and a short manual or
   structured description of the event.
5. Separate events published before the prediction cutoff from events published afterward.
6. Allow later events to annotate an evaluation result, but never update the original prediction,
   its inputs, or its score.
7. Consider using pre-prediction news as a versioned model input only after the earnings-only
   baseline has been validated.
8. Avoid storing or processing third-party article text until its licensing, duplication, and
   timestamp reliability have been evaluated.

#### What this improves

- Helps explain when a 1-, 5-, or 20-day return may have been influenced by news after earnings.
- Reduces the risk of incorrectly attributing every price move to the earnings signal.
- Preserves a path for later research into whether already-public company developments add useful
  information.

#### What this does not improve

An annotation cannot prove that a particular announcement caused a price movement. News-based
signals also introduce classification noise and additional data-source complexity, so this feature
does not belong in the first earnings-only score.

#### Acceptance checks

- Every recorded event retains its source and original publication timestamp.
- An official investor-relations release published before the SEC filing can create one provisional
  event, which the later SEC filings confirm instead of duplicating.
- A prediction is timestamped when Chiron actually finishes processing the release and is never
  backdated to the source publication time.
- Events published after a prediction cutoff cannot appear in that prediction's input snapshot.
- Adding or correcting an evaluation annotation never changes the immutable prediction.
- The dashboard clearly labels later news as context rather than as part of the original signal.
- Duplicate announcements from several sources can be linked without counting them as several
  independent events.

### Notify when an earnings event is ready for review

**Status:** Agreed, not implemented

**Priority:** Implement after the live dashboard defines and displays the `ready for review` state

#### Current behavior

The scheduled workflow can collect, group, and extract a new earnings event without actively
notifying the owner. Discovering a ready event currently requires checking workflow logs or the
database. Qualitative LLM extraction remains an explicit manual action.

#### Proposed behavior

1. Define one application-owned `ready for review` state after the required filings, readable text,
   and deterministic financial extraction are complete.
2. Display unread ready events in the dashboard.
3. Record each notification delivery with a unique event, notification type, and channel so an
   hourly retry cannot send the same alert repeatedly.
4. Include only safe metadata: company, reporting period, completed stages, and whether manual LLM
   extraction is still required.
5. Add an optional external delivery channel, such as Telegram or Discord, only after the dashboard
   behavior is stable.
6. Keep webhook URLs, bot tokens, and other delivery credentials in server-side GitHub Secrets.
7. Treat workflow failures as a separate notification type from newly ready earnings events.

#### What this improves

- Makes new earnings events visible without repeatedly inspecting GitHub Actions or Supabase.
- Gives the owner a clear prompt to run the manual qualitative preview and paid extraction.
- Reuses the same readiness meaning in the worker, API, and dashboard.

#### What this does not improve

A notification does not make the extraction more accurate and must not trigger a paid LLM request
or prediction automatically. External delivery services can also have their own availability and
usage limits.

#### Acceptance checks

- Reprocessing one event several times produces at most one notification per type and channel.
- An event is not announced as ready until all required deterministic stages have completed.
- Notification payloads contain no document text, database secrets, API tokens, or private URLs.
- A delivery failure is recorded and can be retried without duplicating a successful delivery.
- The dashboard and external message show the same readiness state.
- Paid qualitative extraction remains a separate, explicit user action.

## Far future

### Add a point-in-time company discovery screener

**Status:** Idea recorded, not designed or implemented

**Priority:** Far future — only after the fixed-universe earnings research is validated

#### Current behavior

Chiron monitors a manually selected watchlist. It does not scan a broader US-company universe or
propose which companies may deserve research attention. Company revenue growth is not treated as a
promise of positive stock returns, and the current score is not a buy recommendation.

#### Proposed behavior

1. Define a versioned universe of sufficiently large and liquid US companies using point-in-time
   membership data.
2. Collect deterministic SEC/XBRL fundamentals, including revenue, margins, cash flow, and debt,
   plus price, volume, volatility, momentum, and benchmark-relative performance.
3. Apply explicit liquidity and data-quality filters before ranking any company.
4. Create a transparent, versioned screening rule that proposes companies worth researching; keep
   this separate from the earnings-event score and from trading decisions.
5. Freeze every screening run with its timestamp, universe version, input values, rule version, and
   selected companies before later earnings or price outcomes are known.
6. Use inexpensive deterministic calculations across the broad universe. Run qualitative LLM
   extraction only after a selected company has a relevant earnings event.
7. Evaluate the screener against fixed-universe and simple baseline selections before allowing it
   to change the live watchlist.

#### What this improves

- Allows Chiron to discover research candidates outside a permanently fixed manual watchlist.
- Keeps broad-universe screening inexpensive and understandable.
- Provides a reproducible explanation for why a company entered the research universe.

#### What this does not improve

A screener cannot guarantee profitable stocks. Strong company revenue or margins can already be
reflected in the price, and investor expectations can cause a stock to fall after objectively good
results. This feature also requires broader company, sector, and price data whose availability,
licensing, survivorship history, and cost must be validated.

#### Acceptance checks

- Historical screening uses only companies and data that existed at each historical cutoff.
- Delisted or later-unsuccessful companies are not silently removed from historical universes.
- No outcome from the screened event enters its own screening inputs.
- Every proposed company has a stored, human-readable reason and complete input snapshot.
- The dashboard labels results as research candidates, never guaranteed investments.
- The same historical sample compares the screener with fixed, random, and equal-weight universes.

### Anchor critical append-only history outside the primary database

**Status:** Planned only if Chiron publishes a serious forward track record

**Priority:** Far future — useful before commercial claims, not required for the PoC

#### Current behavior

Database triggers reject ordinary updates and deletes for critical append-only records such as LLM
extraction runs, extraction reviews, price observations, market-calendar versions, and predictions.
This protects the history from application bugs and ordinary service-role queries. A database
administrator could still deliberately disable those triggers and rewrite both a record and its
stored fingerprint.

#### Proposed behavior

1. Build a canonical daily manifest containing the IDs and fingerprints of newly created critical
   records.
2. Link each manifest to the previous manifest's fingerprint so removing or reordering a published
   record is detectable.
3. Digitally sign the manifest with a key kept outside the database.
4. Publish or timestamp the signed fingerprint through an independent system outside Supabase.
5. Provide a verification command that compares the database history with the externally anchored
   manifests.
6. Version the manifest format and document exactly which record types it covers.

#### What this improves

- Makes deliberate rewriting of historical predictions or inputs externally detectable.
- Strengthens the credibility of an unedited public forward track record.
- Covers the complete evidence chain rather than anchoring only the final score.

#### What this does not improve

External anchoring does not prove that an extraction, correction, price source, or prediction was
correct. It proves only that the published record existed in that form by a particular time and was
not silently replaced later. Key management and the independence of the timestamping mechanism
also require their own operational controls.

#### Implementation trigger

Implement this before relying on Chiron's forward history in public commercial claims. Keep the
PoC focused on database-enforced append-only records, reproducible fingerprints, and honest
versioning until then.

### Make fiscal-identity updates atomic for concurrent workers

**Status:** Agreed, not implemented

**Priority:** Required only before multiple financial-extraction workers can process the same event

#### Current behavior

The worker reads an earnings event's fiscal year and quarter, checks for conflicts, and fills fields
that are still empty. The GitHub workflow's concurrency group prevents overlapping scheduled runs,
so the current PoC has one writer and is safe.

#### Proposed behavior

Perform the empty-field check and update as one PostgreSQL operation. The update must set a fiscal
value only while the stored column is still `null`. If another worker fills it first, reload the row
and verify that both workers derived the same fiscal identity. A conflicting value must fail rather
than overwrite either result.

#### What this improves

- Prevents a race in which two workers both read empty fields and the later write replaces the
  earlier write.
- Makes horizontal worker scaling safe without relying only on GitHub workflow concurrency.
- Preserves conflict detection when amendments or grouping errors point different documents at the
  same event.

#### Implementation trigger

Implement this before running multiple extraction workers, processing the same database from more
than one scheduler, or moving toward commercial infrastructure.

#### Acceptance checks

- Two workers proposing the same fiscal identity both finish with one consistent stored value.
- A worker proposing a conflicting identity cannot overwrite the existing value.
- A simulated concurrent update is detected and verified.
- The current single-worker path continues to fill previously empty fiscal fields.

### Make price-observation state changes atomic for concurrent workers

**Status:** Agreed, not implemented

**Priority:** Required only before multiple price workers can process the same instrument at once

#### Current behavior

The price persistence layer reads the latest fingerprint for each trading date and then inserts a
new append-only observation only when the provider value changed. The planned GitHub workflow will
prevent overlapping price runs, so this read-then-insert process is safe for the current PoC.

#### Proposed behavior

Move the latest-fingerprint comparison and conditional insert into one PostgreSQL operation. Lock
the instrument and trading date during that operation so two workers cannot both observe the same
old state and insert duplicate transitions.

#### What this improves

- Makes parallel or horizontally scaled price workers safe.
- Preserves one ordered transition for each real provider-value change.
- Removes dependence on one scheduler's workflow-concurrency setting.

#### Implementation trigger

Implement this before enabling more than one price scheduler, processing the same database from
multiple environments, or horizontally scaling the price worker.

#### Acceptance checks

- Two workers receiving identical new values produce one stored state transition.
- Two workers receiving different values cannot silently overwrite or reorder each other.
- An unchanged provider value still creates no new observation.
- A real `A → B → A` sequence remains preserved in chronological order.

## Adding another improvement

For each future item, record:

- the current behavior,
- the proposed behavior,
- why the change is useful,
- what it does not solve,
- and how we will verify it.
