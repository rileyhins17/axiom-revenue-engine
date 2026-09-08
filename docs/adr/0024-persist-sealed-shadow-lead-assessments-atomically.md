# ADR 0024 — Persist sealed shadow lead assessments atomically

**Status:** Accepted
**Date:** 2026-08-26
**Deciders:** Riley Hinsperger and the Revenue Engine integration owner

## Context

The owner Leads workspace can read current v2 businesses, website snapshots,
evidence claims, qualification snapshots, and contact routes, but the rebuild had
no safe writer for the audit and qualification records. Writing those rows one at
a time would allow an audit, its evidence, and its qualification to disagree
after a retry or partial failure. Reusing evidence IDs across later captures
would also collide with the previous audit.

Qualification must not invent reachability. Website evidence can prove rebuild
need, while a later contact phase must separately prove whether email, phone,
form, or social contact is usable.

## Decision

Add one private, injected D1 persistence boundary for a single shadow lead
assessment. It accepts only an exact terminal `RevenueWorkflowReceiptRevision`
whose attempt closure is `SEALED`, verifies the stored receipt digest, rebuilds
the deterministic website audit, reconciles the business identity, and validates
current business-fit and timing basis claims.

The assessment writes:

- one immutable `RevenueWebsiteSnapshot`;
- every exact `RevenueEvidenceClaim` from that capture;
- one conservative `RevenueQualificationSnapshot`; and
- one content-bound `RevenueLeadAssessmentReceipt` written last.

All missing rows are committed through one `D1Database.batch`. Every primary and
alternate identity is collision-preflighted without `LIMIT 1`; a different row
or an existing receipt without its exact complete set stops the operation. After
a fresh commit, every row is reloaded and compared exactly. An exact retry
performs no inserts.
A fresh write also requires the assessment time to be within five minutes of
D1's clock. An exact historical replay remains readable after that window because
it performs no mutation.

The qualification deliberately sets reachability to zero and the recommended
channel to `RESEARCH`. It may show that a business fits Axiom and needs a rebuild,
but it cannot become priority-ready until the separate contact-verification phase
proves a usable channel.

Migration 0061 adds the immutable assessment receipt and append-only triggers for
website snapshots, evidence claims, qualification snapshots, and assessment
receipts. Deterministic evidence IDs advance to
`website-audit-deterministic-v4` and include the business, audit version, capture
time, and check identity.

## Safety boundary

- The executor receives a narrow D1 boundary by dependency injection.
- No Worker, route, queue, cron, provider, or operator action imports it.
- Runtime connection, outreach, sending, provider operations, and cost authority
  are false or zero in both schemas and database constraints.
- It cannot discover contacts, verify an address, call a provider, send a
  message, or promote evidence.
- Migration 0061 is local-only until a later staging migration gate explicitly
  approves backup, rollback, resource identity, and deployment.

## Alternatives considered

### Write each record independently

Rejected. A failed retry could expose evidence without its qualification or a
qualification without the exact evidence set that justified it.

### Infer reachability from an email-looking value

Rejected. An address is a possible channel, not proof of deliverability,
recipient relevance, consent basis, or lead quality.

### Wire the writer into the engine immediately

Rejected. The engine still has no approved D1/provider execution authority, and
the private 50-lead evaluation source has not passed its owner-labelled gate.

## Consequences

- A sealed website-evidence receipt can now become one idempotent, queryable,
  current shadow lead assessment in disposable/local D1.
- The existing owner Leads reader can display the resulting rows without a new
  read path or any outreach capability.
- Repeat audits create distinct evidence identities and preserve history.
- Existing website, evidence, and qualification rows become append-only once
  migration 0061 is installed.
- Real staging population, providers, contact verification, and sending remain
  separate future release gates.

## Verification

Disposable-D1 tests apply migrations 0054–0061 and cover fresh commit, exact
replay, owner-reader visibility, alternate-key collision, atomic rollback,
unsealed or digest-drifted source receipts, and update/delete rejection. Unit
tests cover deterministic scoring, derived business blocks, stale or incomplete
basis rejection, and capture-specific evidence IDs. The repository safety gate
also verifies zero authority and absence of Worker wiring.
