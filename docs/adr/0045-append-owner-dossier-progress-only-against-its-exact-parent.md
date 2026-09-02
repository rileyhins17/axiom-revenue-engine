# ADR 0045 — Append owner-dossier progress only against its exact parent

**Status:** Accepted
**Date:** 2026-09-01
**Deciders:** Riley Hinsperger and the Revenue Engine integration owner

## Context

ADR 0044 derives one module-private `OWNER_DOSSIER` input only from the exact
current owner read model, exact acceptance declaration, and complete guarded
contact-review checkpoint. The generic progress appender is deterministic, but
it accepts schema-valid phase inputs and therefore cannot preserve ADR 0044's
exact-object provenance by itself.

The final phase also changes more summary state than earlier phases. Completing
one owner dossier increments both completed receipts and fully completed
businesses, and may move the cohort's next-incomplete pointer. A guarded boundary
must prove that transition without assuming the pointer remains unchanged.

This milestone must not turn a synthetic declaration into authenticated owner
truth or durable progress.

## Decision

Add a separate validation-only in-memory owner-dossier append boundary. It
accepts only the exact phase-input instance registered by ADR 0044 and requires
the content-equivalent manifest plus parent ID/digest used when that input was
derived.

The boundary calls the canonical receipt builder and progress appender, then
independently verifies:

- progress version, manifest, slice, source plan, and zero-authority policy are
  unchanged;
- the result names the exact contact-review parent and trusted recording time;
- completed receipts and fully completed businesses each increase by one;
- one business moves from `CONTACT_REVIEW_PERSISTED` to
  `OWNER_DOSSIER_ACCEPTED`, while other checkpoint counts stay unchanged;
- the next-incomplete pointer equals the first still-incomplete parent record
  after excluding the completed target, or `null`;
- the target keeps its exact four-receipt prefix, index, and complete
  manifest-bound business/evaluation/source identity, gains only the expected
  canonical receipt, and has no next gate; and
- all other nine business records remain canonically equivalent.

The verified result is deeply frozen and registered in a private `WeakSet`. A
private `WeakMap` caches it by exact trusted input and parent identity. Exact
retry returns the same checkpoint object; a different parent fails closed.

The module has no file, database, runtime, provider, operator, UI/API,
real-business, or external connection. It only changes in-memory validation
state after every predecessor fact has already been proven.

## Options Considered

### Option A — Call the generic progress appender directly

| Dimension | Assessment |
|---|---|
| Complexity | Low |
| Trust preservation | Low |
| Final-state proof | Generic only |
| Operational risk | High because copied input could become progress |

**Pros:** No new boundary.

**Cons:** Loses the exact dossier/proof/input provenance established by ADR
0044 and does not independently audit the special final summary transition.

### Option B — Append inside proof or phase-input construction

| Dimension | Assessment |
|---|---|
| Complexity | Medium |
| Trust preservation | High |
| Failure isolation | Low |
| Operational risk | Medium |

**Pros:** Fewer public calls.

**Cons:** Mixes dossier validation and state change, making the proof/input layer
appear to have advancement authority.

### Option C — Persist authenticated owner acceptance and progress now

| Dimension | Assessment |
|---|---|
| Complexity | High |
| Resume convenience | High |
| Authentication assurance | Not yet designed |
| Operational risk | High |

**Pros:** Could survive process loss without re-derivation.

**Cons:** Conflates session authentication, reviewer authority, durable decision
storage, progress mutation, UI/operator wiring, and real-business policy.

### Option D — Separate exact-parent in-memory append

| Dimension | Assessment |
|---|---|
| Complexity | Medium |
| Trust preservation | High |
| Failure isolation | High |
| Operational risk | Low |

**Pros:** Completes the synthetic integration chain while keeping durable and
operational authority absent and testable.

**Cons:** A resumed task must repeat the bounded dossier read and derivation.

Option D was selected.

## Trade-off Analysis

The design intentionally chooses re-derivation after process loss over trusting
serialized JSON. That costs a bounded local recomputation but prevents copied or
stale approvals from becoming authority.

The next-incomplete pointer is computed from the parent order and target identity,
not accepted from the generic result. This extra check matters only on the final
phase and prevents a valid receipt append from quietly corrupting cohort resume
state.

Authentication and durable storage remain separate because this proof explicitly
says they are unproven. Adding persistence here would make an engineering fixture
look like an owner decision, which would be worse than repeating the bounded
validation later.

## Consequences

- One exact owner-dossier phase can complete one business in a frozen in-memory
  checkpoint.
- Exact retry returns the same checkpoint instance.
- Copied input/result JSON, another manifest, changed or re-digested parent, and
  completed-child replay fail closed.
- Fully completed count, next-incomplete pointer, prior receipts, unrelated
  businesses, and zero-authority policy cannot change unnoticed.
- No owner is authenticated and no owner decision or progress is persisted.
- No operator, UI action, API mutation, Worker, provider, real business, mailbox,
  deployment, outreach, send, or cost path is introduced.
- The rebuild remains on its feature branch; eventual `main` cutover still
  requires the completed rebuild and explicit final release decision.

## Action Items

1. [x] Add the exact-parent in-memory owner-dossier append boundary.
2. [x] Prove the final one-receipt transition, fully-completed count, pointer,
   complete manifest-bound target identity, prior prefix, and unchanged
   unrelated records.
3. [x] Cache exact retries and reject copied input/result trust, changed parents,
   and completed-child replay.
4. [x] Add static safety isolation from operator, Worker, UI/API, file, database,
   runtime, provider, network, mutation, deployment, outreach, send, and cost.
5. [x] Define the authenticated append-only owner-decision contract and inactive
   schema separately under ADR 0046.
6. [ ] Add recording, durable reload, UI/operator action, and real-business
   owner-dossier progress only after their separate authentication and release
   gates pass.
