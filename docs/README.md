# Chiron documentation

This index helps contributors find the smallest useful reading path. `README.md` remains the entry
point for running the repository; these guides explain individual subsystems and operating rules.

## Start here

| Goal | Read |
| --- | --- |
| Understand what works today | [Current capabilities](current-capabilities.md) |
| Set up Supabase safely | [Supabase setup and migrations](supabase-setup.md) |
| Understand the architecture and public/private boundary | [Architecture decisions](architecture-decisions.md) |
| Follow the code visually | [Visual code guide](visual-guide.md) |
| Understand tables and storage | [Database guide](database.md) |
| Run jobs or diagnose a workflow | [Operations runbook](operations-runbook.md) |
| Use or change the GraphQL API | [GraphQL API guide](graphql-api.md) |
| Choose the right validation command | [Testing guide](testing.md) |
| Understand financial terms | [Finance and research glossary](finance-glossary.md) |
| Follow one fictional event through the system | [End-to-end tutorial](end-to-end-tutorial.md) |
| Work on LLM evidence and review | [Qualitative extraction and evidence](qualitative-extraction.md) |
| Understand the score | [Transparent scoring](scoring.md) |
| Understand the starter universe | [Starter watchlist](starter-watchlist.md) |
| Decide whether extraction may scale | [LLM quality gate](llm-quality-gate.md) |
| See intentionally deferred work | [Future improvements](future-improvements.md) |

## Reading paths

### New contributor

1. Repository `README.md`, `AGENTS.md`, and `CONTRIBUTING.md`.
2. [Current capabilities](current-capabilities.md).
3. [Architecture decisions](architecture-decisions.md).
4. [Visual code guide](visual-guide.md).
5. [Testing guide](testing.md).
6. The subsystem guide for the intended change.

### New development chat or handoff

1. Read the workspace handoff when one exists.
2. Read repository instructions and check Git status.
3. Read [Current capabilities](current-capabilities.md).
4. Read the subsystem guide named by the handoff.
5. Verify external database state before repeating an append-only or paid operation.

The handoff records temporary operational state. These committed guides record stable system
behavior. A handoff should link here instead of copying architecture explanations.

### Frontend contributor

Read [GraphQL API guide](graphql-api.md), then section 13 of the
[visual guide](visual-guide.md). Vue must not receive Supabase, Tiingo, SEC, or OpenAI secrets.

### Worker or data contributor

Read [Operations runbook](operations-runbook.md), [Database guide](database.md), and the relevant
extraction guide. Operational commands can contact external services or write shared data; they are
not substitutes for deterministic tests.

## Documentation rules

- Describe implemented, partial, proposed, and far-future behavior separately.
- Use synthetic examples in Git. Real documents, provider output, corrections, prices, and private
  experiment results remain in Supabase or ignored/private storage.
- Explain financial language when first used and link to the glossary.
- State whether a command is read-only, writes data, contacts an external provider, or can cost
  money.
- Update the relevant guide when behavior, configuration, commands, or public boundaries change.
- Before declaring a feature complete, verify the root README, current-capabilities page, affected
  subsystem and operations guides, and local handoff/roadmap are not stale. Stable contributor
  behavior belongs in committed guides; temporary execution state belongs in the local handoff.

