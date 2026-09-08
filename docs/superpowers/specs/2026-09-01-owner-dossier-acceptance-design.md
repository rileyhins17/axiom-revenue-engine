# Owner-Dossier Acceptance Trust Design

**Status:** Approved by the existing Axiom Revenue Engine master-plan mandate
and Riley's instruction to continue the rebuild.

**Date:** 2026-09-01

## Outcome

Create a validation-only trust boundary for the final `OWNER_DOSSIER` phase of
the ten-business shadow slice. One phase input must prove that an explicit
read-only acceptance declaration refers to the exact current owner dossier and
the exact guarded contact-review checkpoint. This milestone must not append
progress, persist a decision, add an operator or UI action, touch real business
data, call a provider, deploy, contact anyone, or spend money.

Riley's branch direction is also explicit: the rebuild branch is intended to
move to `main` eventually, but only after the complete rebuild and its safety,
review, rollback, and verification gates pass. This design does not authorize
that merge or any deployment now.

## Trust model

The current dossier reader already validates its D1 rows and returns a strict,
zero-authority owner projection. It does not prove object provenance after the
result is serialized or cloned. The reader will therefore deep-freeze each
successful non-null response and register its exact object in a module-private
`WeakSet`. A guard will accept only that exact in-process result; schema-valid
copies fail.

The acceptance proof will bind:

- the exact manifest, ten-business scope, selected business, candidate, and
  source record;
- the exact four-receipt `CONTACT_REVIEW_PERSISTED` parent and contact-review
  phase receipt;
- the dossier read-model version, projection key, generated time, complete
  canonical dossier digest, current data-quality state, website snapshot,
  qualification snapshot, current contact invocation, review, assessment,
  discovery, and contact-materialization lineage;
- an explicit Riley/Aidan declaration containing the exact dossier digest,
  reviewer, time, rationale, decision, and confirmation phrase; and
- an authority block that states this layer does not prove owner-session
  authentication, does not persist the decision, and authorizes no phase
  append, mutation, provider, outreach, deployment, send, or cost.

Acceptance must occur at or after dossier generation and parent recording, and
within five minutes of dossier generation. The proof identity is
`owner-dossier-acceptance:<sha256>` over every canonical core field.

## Components

1. `owner-lead-detail-read-model.ts` owns exact-object dossier trust. It remains
   SELECT-only and exposes no acceptance behavior.
2. `private-kw-owner-dossier-progress-proof.ts` validates the exact dossier,
   parent, declaration, chronology, and lineage; creates one frozen,
   content-addressed proof; and registers exact proof objects.
3. `private-kw-owner-dossier-progress.ts` regenerates the proof internally and
   derives one frozen `OWNER_DOSSIER` phase input bound privately to the exact
   manifest and contact-review parent. It cannot import the canonical appender
   or receipt builder.
4. A synthetic test fixture composes the existing durable contact fixture,
   guarded contact append, and real owner dossier reader using a bounded fake D1
   response. It adds no production test hook.

## Failure behavior

Fail closed on copied dossier/proof/input objects, non-current data, missing or
stale contact review, changed full-cohort parent, wrong business or source
lineage, snapshot mismatch, wrong predecessor, digest mismatch, declaration
predating the dossier or exceeding five minutes, altered confirmation, or any
nonzero operational authority.

No fallback may convert a stale or unauthenticated declaration into owner truth.
Because this layer explicitly does not prove session authentication or durable
recording, a later operator boundary must add those facts before any real
owner-dossier append is designed.

## Verification

- Test exact read-model trust, deep freeze, and clone rejection.
- Test content-addressed proof and zero authority.
- Test phase-input derivation without checkpoint creation.
- Test copied trust, stale data, parent/manifest drift, lineage drift, and
  acceptance chronology failures.
- Extend the repository safety scan to enforce isolation and forbidden imports.
- Run the complete AGENTS release gate sequentially, including the six-view
  owner UI gate after OpenNext/Wrangler have exited.

## Alternatives rejected

### Trust saved dossier JSON

Simple, but content integrity cannot establish that the object came from the
current reader or was the exact dossier reviewed in-process.

### Combine owner acceptance with durable/operator progress

Operationally convenient, but it mixes read provenance, identity/authentication,
decision persistence, and progress mutation before those later authorities have
been separately designed and approved.

### Separate exact-object proof and phase input

Selected. It preserves evidence and parent integrity now while keeping session
authentication, durable recording, guarded append, operator wiring, real data,
and live resources as explicit later gates.
