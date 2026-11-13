# GraphQL API guide

Chiron's Vue dashboard reads through an application-owned Node GraphQL API. The browser does not
connect directly to Supabase and never receives the Supabase secret.

## Local architecture

```text
Vue browser
  → /graphql
  → Vite development proxy
  → http://127.0.0.1:4000/graphql
  → GraphQL resolver
  → research repository
  → Supabase using a server-side secret
```

The API binds to `127.0.0.1` by default. `API_PORT` can change the port, but the Vue development
proxy currently expects port `4000`.

## Start the API and dashboard

Build Shared once on a fresh checkout, then start both apps:

```text
pnpm --filter @chiron/shared build
pnpm dev
```

Or run them separately:

```text
pnpm dev:api
pnpm dev:web
```

The API requires `SUPABASE_URL` and `SUPABASE_SECRET_KEY`. Vue requires no database credential.

## Current queries

| Query | Purpose |
| --- | --- |
| `health` | Confirms that the GraphQL process is running. |
| `watchlistCompanies` | Returns approved company/watchlist fields. |
| `recentPredictionEvents(limit)` | Returns recent forward events with their latest frozen prediction and outcomes. |
| `recentUnpredictedEvents(limit)` | Returns recent events without predictions. |
| `historicalPredictionResults(limit)` | Returns explicitly retrospective prediction/evaluation summaries. |
| `earningsEventDetails(eventId)` | Returns source-document metadata and reported/derived financial values. |
| `predictionEvidence(predictionId)` | Returns exact qualitative evidence and the original/effective review audit. |

List limits default to 25 and are clamped to the supported range of 1–100.

## Example queries

Health:

```graphql
query Health {
  health {
    service
    ready
  }
}
```

Overview:

```graphql
query ResearchOverview {
  watchlistCompanies {
    id
    ticker
    legalName
    sector
  }
  recentPredictionEvents(limit: 10) {
    id
    ticker
    periodEnd
    status
    latestPrediction {
      id
      score
      cutoffAt
      plannedDay20Session
    }
  }
}
```

Evidence for one frozen prediction:

```graphql
query PredictionEvidence($predictionId: ID!) {
  predictionEvidence(predictionId: $predictionId) {
    extractionSchemaVersion
    evidence {
      fieldPath
      claim
      passageId
      quote
      source {
        role
        publishedAt
        sourceUrl
      }
    }
    extractionAudit {
      promptVersion
      reviewDecision
      effectiveSource
      effectiveOutputFingerprint
    }
  }
}
```

The complete checked contract lives in `apps/api/src/schema.ts`. Vue query documents and response
types live in `apps/web/src/research-api.ts`.

## Responsibilities

| Layer | Responsibility |
| --- | --- |
| GraphQL schema/resolver | Defines approved fields, arguments, nullability, and bounded list sizes. |
| Research repository | Reads and validates stored research records and frozen snapshots. |
| Evidence presentation | Resolves exact source passages and original/effective qualitative audit data. |
| Vue API client | Sends checked query documents and maps responses to presentation types. |

GraphQL types are intentionally not generated directly from PostgreSQL. Database tables contain
operational and private fields that the browser does not need.

## Security boundary

- Keep `SUPABASE_SECRET_KEY` only in API/Worker environments.
- Never create `VITE_SUPABASE_SECRET_KEY` or serialize secrets into an API response.
- Only expose fields with an intentional dashboard use.
- Validate IDs, list sizes, stored JSON shapes, and trusted SEC URLs server-side.
- Do not expose provider request IDs, unrestricted review notes, or private research data without a
  documented publication policy.

The current API is local and read-only. GraphQL does not automatically add authentication,
authorization, query-complexity limits, origin protection, rate limiting, or monitoring.

## Current limitations

- No user accounts or public authentication.
- No GraphQL mutations for qualitative review or correction.
- No cursor pagination; lists use bounded limits.
- Vue response interfaces are maintained manually rather than generated from the schema.
- No production shutdown, query-depth, or complexity hardening.
- The API expects the public Core schema but can point at a database that also contains private
  results; resolvers must continue exposing only approved fields.

These limitations are acceptable for the local PoC and must be addressed before public deployment.

## Adding a query

1. Define only the fields and arguments the UI needs in `apps/api/src/schema.ts`.
2. Add a repository method with bounded, deterministic database reads.
3. Validate stored JSON and relationships before presentation.
4. Add API success, null, malformed-data, and limit tests.
5. Add or update the Vue query and response type.
6. Verify the UI's loading, empty, error, and populated states.
7. Confirm no new secret or private field enters browser code or build output.
8. Update this guide when the public contract changes.

