# ADR 0012 — Compose website evidence through a receipted fixture workflow

- Status: accepted
- Date: 2026-08-22

## Decision

Compose the existing website-evidence modules behind one versioned, fixture-only
business workflow before any Cloudflare Browser Rendering, R2, D1, Queue, or
Workflow adapter is connected.

Version 1 has eight fixed checkpoints:

1. capture the homepage;
2. extract homepage facts;
3. select high-signal pages;
4. capture selected subpages;
5. measure fixed Browser viewports;
6. persist content-addressed fixture artifacts;
7. assemble the multi-page audit input; and
8. run the deterministic audit.

Every checkpoint records a stable status, one bounded attempt, timestamps,
output digest, item count, warnings, and structured failure. The aggregate
receipt binds the workflow/idempotency/business identity, selected pages,
per-page evidence coverage, assembly, audit, and zero-cost budget.

Keep three outcomes distinct:

- an unavailable homepage is a successfully observed `UNREACHABLE` site path;
- missing page or Browser evidence is `PARTIAL` and keeps unsupported checks
  `UNKNOWN`; and
- identity, schema, artifact-integrity, or storage failure is `FAILED` and
  publishes no audit.

Artifact plans and capture IDs derive deterministically from the workflow ID.
Retry therefore uses the same content-addressed objects and reconciles an
already-created object instead of overwriting or deleting it. A failed artifact
write can leave a safe immutable orphan for the retry to reuse.

The request schema accepts only shadow mode, fixture dependencies, and a
zero-dollar budget. The repository safety scan forbids Cloudflare runtime
bindings, direct network fetch, provider storage types, and deletion in this
composition module.

## Why

The individual capture, extraction, selection, Browser, storage, assembly, and
audit contracts were already independently safe. They did not yet prove that
their identities, timestamps, limits, failure states, and artifact receipts
could travel through one business-level run without being weakened between
modules.

A provider adapter should not be the first place those integration errors are
discovered. The fixture workflow exposes the exact durable checkpoints and
failure semantics first, at zero cost and without touching a business website.

Treating an unreachable site as an orchestration crash would hide a useful lead
signal. Treating a failed contact page or mobile capture as proof of a website
defect would create dishonest outreach. The explicit site-path/partial/failure
split prevents both mistakes.

## Consequences

- One fixture can now prove the complete website-evidence path and produce the
  same business audit on retry.
- The eight checkpoint names are the migration boundary for later durable D1
  receipts and Cloudflare Workflow steps.
- This version retries the deterministic composition from its input; persisted
  step-level resume, leases, and version-drift handling remain a separate gate.
- The workflow records fixture Browser/provider-shaped evidence but performs
  zero provider operations and incurs zero runtime cost.
- Live Browser/R2 adapters, bindings, resource creation, durable persistence,
  deployment, and execution authority remain explicitly out of scope.
