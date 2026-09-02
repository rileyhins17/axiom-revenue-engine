# ADR 0044 — Bind owner-dossier acceptance to exact read proof

**Status:** Accepted
**Date:** 2026-09-01
**Deciders:** Riley Hinsperger and the Revenue Engine integration owner

## Context

ADR 0043 ends with one exact, deeply frozen contact-review checkpoint. The final
shadow-slice phase is `OWNER_DOSSIER`, but a schema-valid dossier copy is not
proof that it came from the current reader, and a typed declaration is not proof
that Riley or Aidan was authenticated or that the decision was durably stored.

The existing owner projection also exposed a quality-model trap while this gate
was being tested: adding a current contact route caused the reader to recompute
and stale the earlier qualification snapshot. That mixed reachability with lead
quality even though Axiom's product rule makes them separate facts.

This milestone needs a trustworthy validation contract without quietly creating
an owner action, durable decision, progress append, real-business path, or live
operation.

## Decision

Use three explicit in-process boundaries:

1. The SELECT-only owner-dossier reader deep-freezes each successful response
   and registers the exact object in a private `WeakSet`. Its guard rejects
   schema-valid clones.
2. A content-addressed `owner-dossier-acceptance:*` proof accepts only that exact
   dossier and the exact guarded contact-review checkpoint. It binds the full
   dossier digest, manifest/cohort/business/source lineage, contact predecessor,
   current website and qualification snapshots, explicit declaration, and a
   five-minute dossier-to-acceptance window.
3. A separate adapter regenerates the proof internally and returns one frozen,
   parent-bound, zero-authority `OWNER_DOSSIER` phase input. It cannot import the
   canonical receipt builder or progress appender.

The proof states that owner-session authentication is not proven and no durable
decision has been recorded. No real owner acceptance is created by tests.
Authentication, durable recording, guarded append, operator wiring, real data,
and live resources remain separate later decisions.

Qualification is revalidated against the channel context recorded in its
immutable qualification snapshot. The current best contact route remains a
separate projection. Finding an email may improve routing, but cannot make a
weak lead strong or make an otherwise current qualification stale.

## Options Considered

### Option A — Trust serialized dossier and acceptance JSON

| Dimension | Assessment |
|---|---|
| Complexity | Low |
| Provenance | Low |
| Resume convenience | High |
| False-authority risk | High |

**Pros:** Easy to save, reload, and pass through generic commands.

**Cons:** A copied or edited object could impersonate the exact dossier that was
read and reviewed.

### Option B — Add the owner UI, durable decision, and progress append together

| Dimension | Assessment |
|---|---|
| Complexity | High |
| Provenance | Medium |
| Failure isolation | Low |
| Operational risk | High |

**Pros:** Delivers an end-to-end action sooner.

**Cons:** Conflates read provenance, identity/authentication, decision storage,
progress mutation, and operator authority before each boundary is proven.

### Option C — Separate exact-object proof and zero-authority phase input

| Dimension | Assessment |
|---|---|
| Complexity | Medium |
| Provenance | High |
| Failure isolation | High |
| Operational risk | Low |

**Pros:** Makes every fact and missing authority explicit, testable, and
content-addressed.

**Cons:** Trust does not survive process loss; the bounded dossier read and proof
derivation must be repeated.

Option C was selected.

## Trade-off Analysis

The design intentionally values provable origin over serialization convenience.
After a process ends, copied proof/input JSON is only audit material and cannot
resume authority. A later authenticated operator flow must re-read current data
and create its own durable, append-only owner decision.

The five-minute window reduces the chance that an acceptance refers to a dossier
whose evidence or parent changed between read and declaration. It does not
authenticate the reviewer; the authority block and tests make that limitation
machine-visible instead of implying it.

Keeping contact routing separate from qualification preserves the commercial
meaning of lead quality. It also means route freshness must be shown and gated
independently rather than smuggled into a blended qualification result.

## Consequences

- The exact current dossier, exact contact parent, complete digest, and explicit
  declaration can now produce one reproducible validation proof and phase input.
- Copied dossier/proof/input objects, stale data, stale snapshot lineage,
  cross-manifest parents, wrong digest/confirmation, and chronology drift fail
  closed.
- A newly discovered route no longer rewrites or stales the separate immutable
  qualification snapshot.
- No phase receipt or checkpoint is created, and no owner is authenticated.
- No decision is saved to a file or database.
- No operator, API action, UI control, Worker, provider, real-business, mailbox,
  deployment, outreach, send, or cost path is introduced.
- The rebuild remains on its feature branch. Riley's direction is to move it to
  `main` eventually, only after the full rebuild, safety, review, rollback, and
  cutover gates pass.

## Action Items

1. [x] Deep-freeze and register exact owner-dossier reader responses.
2. [x] Add content-addressed proof with exact manifest/contact/dossier lineage,
   explicit declaration, and five-minute chronology.
3. [x] Add the zero-authority, exact-parent `OWNER_DOSSIER` phase-input adapter.
4. [x] Separate current contact routing from immutable qualification validation
   and add regression coverage.
5. [x] Enforce copied-object rejection and disconnected operation in the static
   safety gate.
6. [x] Design and implement a separate exact-parent guarded in-memory append;
   do not combine it with authentication, durable owner-decision storage, or
   operator wiring.
7. [ ] Add authenticated, append-only owner-decision recording only after its
   own threat model, UI acceptance, and release approval.
