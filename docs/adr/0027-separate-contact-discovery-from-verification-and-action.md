# ADR 0027 — Separate contact discovery from verification and action

**Status:** Accepted
**Date:** 2026-08-27
**Deciders:** Riley Hinsperger and the Revenue Engine integration owner

## Context

The shadow-assessment writer deliberately records reachability as zero and routes
every newly assessed business to research. The owner read model already requires
current, channel-specific proof before it presents email, phone, form, or social
as usable. The stable adapter boundary did not enforce that standard: contact
discovery returned loose strings and email verification used one ambiguous
`RISKY` state without binding the result to an exact evidence-backed candidate.

That gap could let an email-shaped value be mistaken for reachability, lose the
public source and publication context needed for later compliance review, or let
one verification result drift onto another business or address. It also treated
email as the only channel worth verifying even though a strong lead may be best
handled by phone, a form, social, or further research.

## Decision

Introduce separate, versioned fixture contracts for contact discovery and
contact verification.

Discovery accepts explicit observations for email, Canadian phone, form, and
supported social routes. It canonicalizes values, groups the same business,
channel, and value, and retains every exact evidence claim with source URL,
capture time, method, confidence, publication state, contrary-contact-statement
state, role relevance, and `consentBasis: UNASSESSED`. Candidate and evidence
identities are content-derived; conflicting recipient identity, duplicate proof,
stale evidence, private URLs, malformed values, and candidate-cap overruns stop
the result. No candidate can leave discovery with anything other than
`NOT_VERIFIED` and `automationPermitted: false`.

Verification accepts one complete discovery candidate, not a bare address. Its
request and result bind the exact business, candidate identity, candidate digest,
channel, and canonical value. Channel outcomes remain distinct:

- email: `DELIVERABLE`, `UNDELIVERABLE`, `CATCH_ALL`, or `UNKNOWN`;
- phone: `PUBLISHED`, `UNAVAILABLE`, or `UNKNOWN`;
- form: `AVAILABLE`, `UNAVAILABLE`, or `UNKNOWN`; and
- social: `ACTIVE`, `INACTIVE`, or `UNKNOWN`.

A current deliverable named/role email can become owner-reviewable. A generic
business inbox, catch-all, unknown, or undeliverable address cannot. Positive
phone, form, and social results become manual routes only. Verification never
assesses consent, approves a message, or grants autonomous email authority.

Both contracts are fixture-only, cost zero, provider-operation zero, and grant
no runtime, persistence, qualification, outreach, or send authority. The stable
contact and verification adapter interfaces now consume and return these exact
contracts, but the engine Worker does not import or execute them. The repository
safety scan locks those boundaries.

## Options considered

### Option A — Keep loose adapter strings and validate in the UI

| Dimension | Assessment |
|---|---|
| Complexity | Low initially; duplicated later |
| Evidence integrity | Weak; provenance can be lost before the UI |
| Lead quality | Weak; email availability remains easy to overvalue |
| Runtime safety | Depends on every future caller remembering the same rules |

**Pros:** Minimal source change.

**Cons:** Makes presentation code responsible for identity, evidence,
deliverability, and compliance semantics.

### Option B — Discover and verify email in one provider operation

| Dimension | Assessment |
|---|---|
| Complexity | Medium and provider-specific |
| Evidence integrity | Better for email, absent for other channels |
| Lead quality | Biased toward businesses with an inbox |
| Runtime safety | Couples discovery to spend and live network access |

**Pros:** A provider could return one convenient email result.

**Cons:** Hides which fact came from which source, makes provider replacement
harder, and incorrectly turns “no email” into “no route.”

### Option C — Versioned evidence discovery plus bound channel verification

| Dimension | Assessment |
|---|---|
| Complexity | Medium and isolated |
| Evidence integrity | Strong, content-bound, and replayable |
| Lead quality | Preserves valuable non-email opportunities |
| Runtime safety | Strong; fixture-only and zero-authority by contract |

**Pros:** Keeps discovery, deliverability/availability, consent, approval, and
action as separate gates that can evolve independently.

**Cons:** Adds explicit mapping work before real provider and persistence
adapters can be enabled.

## Trade-off analysis

Option C adds more types and validation before a live contact provider exists,
but that is the cheapest point to prevent the wrong product behaviour. It lets a
later provider adapter change without changing what “evidence-backed candidate”
or “usable manual route” means. It also matches the owner workflow: first decide
whether a business is valuable, then prove how it can be reached, then make a
separate compliant contact decision.

The v1 contract supports four named social platforms and Canadian E.164 phone
numbers because the pilot is KW/Ontario. New platforms or countries require a
versioned contract change instead of silent normalization drift.

## Consequences

- An email-looking value is never proof of deliverability, consent, or action
  authority.
- Multiple public observations for one route remain available for owner and
  compliance review rather than being collapsed into one unexplained string.
- A strong no-email lead can still surface a verified manual phone, form, or
  social route.
- Provider-specific receipts can later be translated behind the stable adapter
  without leaking raw provider payloads into the domain contract.
- The current modules cannot write `RevenueContactPoint` or
  `RevenueVerificationResult`; persistence schema/executor design remains a
  separate milestone.
- No provider, mailbox, Worker, route, queue, workflow, migration, or live
  business was used for this decision.

## Action items

1. [x] Implement strict discovery and verification schemas, deterministic
   builders, candidate/evidence/result digests, and channel-specific route
   outcomes.
2. [x] Replace the loose stable adapter signatures with the versioned contracts.
3. [x] Add adversarial unit coverage and repository safety enforcement.
4. [ ] Design append-only contact/verification persistence separately, including
   exact replay/collision rules and no inference of consent.
5. [ ] Implement a live provider only after owner approval, cost limits, test
   fixtures, privacy review, and a separate runtime release gate.
