# Architecture decisions

This guide records the main project boundaries and why they exist. These are current engineering
decisions, not claims that other technologies are unsuitable.

## Modular monolith

Chiron is intentionally one small TypeScript workspace with four packages:

- `apps/worker`: ingestion, extraction, prices, predictions, and evaluations;
- `apps/api`: the application-owned read-only GraphQL boundary;
- `apps/web`: the Vue dashboard;
- `packages/shared`: runtime-validated contracts shared by server and browser code.

A microservice architecture would add deployment, networking, observability, and consistency work
before the research pipeline has proven value. Package boundaries keep responsibilities clear while
one repository and one release remain easy to understand.

## TypeScript and later Python

TypeScript owns ingestion, scheduled work, API behavior, validation, and the dashboard because it
matches the current application and contributor skills. Python is reserved for later statistical
analysis, notebooks, and machine learning after the data and extraction quality are credible. Rust
is not required for the current workload; learning it belongs in a project where its strengths are
central rather than added as complexity.

## PostgreSQL through Supabase

Supabase provides hosted PostgreSQL, private object storage, and a manageable free-plan starting
point. Chiron uses ordinary PostgreSQL tables, constraints, triggers, and SQL migrations. Core owns
the foundational schema, so moving to another managed PostgreSQL provider or self-hosted PostgreSQL
later does not require redesigning the domain model.

The browser never receives the Supabase secret. Worker and API processes are trusted server-side
clients. Row Level Security remains enabled as defense in depth, but a secret/service-role key can
bypass ordinary RLS and must be protected.

## Application-owned GraphQL

Vue queries `/graphql`; it does not connect directly to database-generated APIs. The Node server
defines approved fields, validates IDs and list limits, and hides database and provider details.
GraphQL is useful here because one event view combines companies, predictions, outcomes, documents,
financial values, and evidence. It does not automatically provide security: public deployment still
requires authentication, authorization, complexity limits, origin rules, and monitoring.

## Immutable and append-only research records

Source documents, extraction attempts, reviews, predictions, and evaluations preserve history.
Corrections create new records instead of overwriting the original. Fingerprints and version fields
make each result reproducible and reveal changed inputs. This costs more storage than mutable rows,
but auditability is more important for research that must avoid future-data leakage.

## LLM as extractor, not decision-maker

The LLM returns structured qualitative facts and exact passage references. Deterministic code
validates the response, a person reviews it, and transparent code computes the score. This keeps
financial assumptions visible and provides a permanent non-ML baseline.

## Forward and retrospective separation

Forward predictions use only information actually published and observed before their cutoff.
Historical reconstruction uses publication-time eligibility with preserved later first-seen times.
Separate tables and UI/API records prevent retrospective results from being presented as genuine
forward predictions.

## Public Core and private Research

The workspace may contain two independent repositories:

| Boundary | What belongs there |
| --- | --- |
| Public `chiron-core` | Generic ingestion, schema, baseline extraction, scoring, API, UI, reproducibility safeguards, and synthetic examples. |
| Private `chiron-research` | Experiment selection, private prompt variants, real corrections, tuned rules, statistical notebooks, and fitted artifacts. |
| Supabase or ignored storage | Real SEC text, provider output, prices, corrections, embeddings, experiment results, and credentials. |

The public Core must remain functional without Research. Private code consumes Core's schema and
must not redefine foundational tables. A commercially useful advantage may remain private, but the
public project should still be a complete, honest baseline rather than a crippled demo.

## Deployment boundary

The current API and dashboard are local development tools. Production hosting is deliberately
deferred until authentication, authorization, secret management, backups, monitoring, provider
licensing, and legal positioning are reviewed. Local functionality must not be described as
production readiness.

