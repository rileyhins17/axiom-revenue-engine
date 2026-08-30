# ADR 0037 — Append website-evidence progress only against its exact parent

**Status:** Accepted
**Date:** 2026-08-30
**Deciders:** Riley Hinsperger and the Revenue Engine integration owner

## Context

ADR 0036 creates a module-private `CURRENT_WEBSITE_EVIDENCE` phase input from an
exact current durable eligibility reload, but intentionally does not change the
ten-business progress checkpoint. The generic progress appender is deterministic
and content-addressed, yet it accepts any schema-valid phase input. Calling it
directly would discard the stronger in-process trust established by the durable
reload adapter.

The parent checkpoint can also change after the phase input is derived. Even an
unrelated business advancing would produce a different content-addressed parent.
Appending the old input to that new parent would blur which complete ten-business
state was reviewed. Retrying the same exact operation must not create another
receipt or a second logical checkpoint.

## Decision

The phase-input adapter privately binds each trusted input to the manifest ID and
digest plus the exact parent checkpoint ID and digest used during derivation.
An exact validation-only append boundary requires that same in-process input and
an exact content-equivalent parent. Object identity is not required for the
parent, so a safely reloaded content-equivalent checkpoint can resume after a task boundary;
any changed and redigested checkpoint is rejected.

The boundary calls the canonical `appendPrivateKwShadowSliceProgress` function,
then independently verifies:

- the new checkpoint names the exact parent ID and digest;
- creation time equals the trusted input's recording time;
- total completed receipts increased by exactly one;
- the selected business gained exactly the expected content-addressed
  `CURRENT_WEBSITE_EVIDENCE` receipt and reached `ASSESSMENT_APPROVAL`;
- the selected business's prior receipt prefix is unchanged; and
- every other business record is canonically equivalent.

The result is deeply frozen and registered as an exact in-process trusted
checkpoint. A module-private `WeakMap` caches it by the trusted phase-input
instance. An exact retry against the same parent returns the same checkpoint
object; a retry against any different parent fails closed.

## Options considered

### Option A — Use the existing generic recorder

| Dimension | Assessment |
|---|---|
| Complexity | Low |
| Resume safety | Low |
| Trust preservation | Low |
| Operational risk | High because copied phase-input JSON could be recorded |

### Option B — Append inside the durable-reload adapter

| Dimension | Assessment |
|---|---|
| Complexity | Medium |
| Resume safety | Medium |
| Trust preservation | High |
| Operational risk | Medium because derivation and state change share one boundary |

### Option C — Separate parent-bound in-memory append

| Dimension | Assessment |
|---|---|
| Complexity | Medium |
| Resume safety | High for an exact content-addressed parent |
| Trust preservation | High |
| Operational risk | Low because it has no durable or runtime writer |

Option C was selected. The extra boundary and checks are worthwhile for a
ten-business commercial pilot where explainable, restart-safe lineage matters
more than shaving off one function call.

## Trade-off analysis

The selected design deliberately prevents an old trusted input from being
rebased onto a newer checkpoint, even when another business changed harmlessly.
The input must be re-derived against the new parent. That costs another bounded
validation pass but makes the complete cohort state auditable and avoids hidden
merge semantics. Caching by exact input instance gives retry idempotency without
introducing a mutable global ID registry or durable write.

## Consequences

- A content-identical reloaded parent can safely resume the append.
- Copied phase inputs, redigested parent changes, completed-child parents, and
  cross-context retries fail closed.
- One exact retry returns the same deeply frozen checkpoint instance.
- No unrelated business, existing receipt, summary field, or authority can
  change unnoticed.
- There is still no operator command, file write, database mutation, Worker or
  API import, live binding, real-business execution, provider call, deployment,
  outreach, send, or spend.
- The next trust gap is assessment persistence: schema-valid
  `RevenueLeadAssessmentD1Execution` JSON is still synthetic evidence rather
  than durable transaction provenance.

## Action items

1. [x] Bind each trusted website-evidence input to its exact manifest and parent
   checkpoint in module-private provenance.
2. [x] Add the canonical, independently verified, frozen, cached append boundary.
3. [x] Prove exact retry, content-equivalent parent reload, copied-input
   rejection, redigested-parent rejection, completed-parent rejection, unchanged
   unrelated businesses, and zero authority.
4. [x] Prevent the generic operator recorder and inert Worker from importing the
   new boundary.
5. [ ] Establish exact durable assessment execution/reload trust before an
   `ASSESSMENT` phase-input adapter or append path is allowed.
