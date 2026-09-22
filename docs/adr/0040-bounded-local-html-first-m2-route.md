# ADR 0040: Bound the M2 route to a reviewed packet and a separate owner decision

- Status: accepted for implementation planning
- Date: 2026-09-21
- Scope: the first M2 local HTML-first route

## Decision

M2 uses one digest-bound chain:

1. A ten-business, organization-only research packet is derived from the
   existing reviewed manifest and source plan.
2. A pending execution authorization is derived from that exact packet and
   binds the manifest, source-plan, website-policy, transport-policy, source
   rights, terms, robots, retention, stop conditions, and expiry.
3. A separate owner decision records an immutable `APPROVED` owner envelope
   against the exact packet and pending authorization. Preparation creates only
   a `PENDING` candidate; it cannot create the approved envelope.
4. A later Task 5 freezes the policy-neutral HTML-to-assessment mapping and
   alone defines the production-shaped assessment approval. Task 1 may create
   only an explicitly fixture-only mapping policy.

Every authority block remains zero or false for provider, contact, consent,
qualification, outreach, send, deployment, and cost. An approved envelope is a
review gate for the later bounded robots/GET workflow; it is not a provider,
contact, qualification, outreach, send, deployment, or spend grant.

The packet defaults each business to `DERIVED_FACTS_ONLY`. `RAW_HTML_ALLOWED`
requires an explicit per-business decision, and `BLOCKED` stops before document
capture. Source rights, terms, robots, retention, and stop conditions are
durable fields and are included in the authorization digest.

The Task 1 database contract is a receipt schema only. It binds a later local
database setup to its direct-child path, file identity, content hash, canonical
schema digest, migration set, commit, and backup/restore evidence. Task 1 does
not create, migrate, open, or mutate SQLite; Task 8 owns that separate setup
command and review.

## Rejected alternatives

- Treating the ADR 0032 manifest as execution authority would allow a stale or
  edited manifest to stand in for a separately reviewed owner decision.
- Letting the preparation CLI emit `APPROVED` would collapse candidate
  preparation and owner approval into one unreviewable operation.
- Generating a real assessment approval before Task 5 freezes the mapping would
  create a durable approval whose field semantics can later change.
- Creating or migrating the execution database from the M2 CLI would hide a
  setup mutation inside the run boundary and weaken receipt-bound replay.

## Consequences

The initial Task 1 CLI used fixed synthetic dates. The current local preparation
command instead requires a strict review-policy input with actual preparation
and expiry times and all ten explicit source-policy/retention decisions. It
rejects future preparation, expired authorization and expired retention review
before publishing outputs; it cannot infer real source rights from the former
synthetic defaults. This changes preparation, not owner authority.

It writes four no-overwrite JSON artifacts: the research packet, pending
authorization, pending owner candidate, and fixture-only mapping policy. That
mapping remains labelled fixture-only and is not a real assessment approval.
Task 2, Task 5, Task 6, and Task 8 must consume
the exact IDs and digests and fail closed on copied, changed, expired, or
missing artifacts.

## Bounded operator invocation

The capture command wraps the existing Task 4 service for exactly one private
request file. Default preflight reads and validates pending or approved inputs;
only explicit execution with a current approved envelope can reach transport
and evidence writes. Verification calls the existing durable reload boundary
directly and cannot fall back to capture. The wrapper introduces no new approval
semantics, retention policy, provider, database migration or automatic trigger.

A dedicated local capture lock prevents overlapping operator executions without
changing the setup/assessment lock. Its owner releases only the same regular
file identity it acquired. An unexpected lock is a stop condition, not permission
to remove another process's file. The first-business review and subsequent
exact-ten evaluation remain owner workflows, not a background batch loop.
