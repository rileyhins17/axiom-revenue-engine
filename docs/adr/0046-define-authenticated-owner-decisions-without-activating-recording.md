# ADR 0046 — Define authenticated owner decisions without activating recording

**Status:** Accepted
**Date:** 2026-09-02
**Deciders:** Riley Hinsperger and the Revenue Engine integration owner

## Context

ADR 0044 proves that one dossier and contact-review parent are exact current
in-process objects. ADR 0045 proves the final progress transition in memory.
Neither boundary authenticates Riley or Aidan, and neither result survives
process loss as trusted authority.

A durable owner decision eventually needs to identify the real reviewer without
letting a browser body choose that identity or timestamp. It must also remain
bound to the exact dossier, acceptance proof, contact predecessor, and current
session while exposing no raw session token, session ID, user ID, or owner email
in the durable record. Defining that contract must not quietly create the route,
button, database executor, or progress bridge that could exercise it.

The current application uses Better Auth, but email verification is disabled in
the existing configuration. A session alone therefore cannot satisfy the new
high-assurance owner-decision boundary. Activation must first provide a verified
owner email and the separately required MFA/recovery controls.

## Decision

Add two disconnected foundations:

1. A server-side `kw-authenticated-owner-dossier-decision-v1` contract accepts
   the exact in-process dossier/contact parent, a declaration containing no
   reviewer or timestamp, current Better Auth session context, an injected
   server clock, and an injected binding key. It:
   - requires `emailVerified: true` and maps only the exact normalized
     `riley@getaxiom.ca` or `aidan@getaxiom.ca` identity to the owner enum;
   - derives decision time from the server clock and requires the session to be
     active at that instant;
   - regenerates the existing exact dossier acceptance proof internally;
   - HMAC-SHA-256 binds subject, session, key version, proof, decision, owner,
     and time with at least 32 bytes of injected secret material;
   - persists only opaque binding digests and the owner enum, never raw auth
     identifiers;
   - returns one content-addressed, deeply frozen record candidate registered in
     a private in-process trust set; and
   - grants no persistence, progress, provider, outreach, send, deployment, or
     cost authority.
2. Additive migration 0069 defines `RevenuePrivateKwOwnerDecision`, a mirrored
   append-only ledger. It requires one record per exact acceptance proof, unique
   decision/session binding, verified-session and future-recheck flags, exact
   JSON/column lineage, absence of raw auth identifier keys, database chronology,
   immutable update/delete triggers, and zero downstream authority.

Migration 0069 is source-only. This decision adds no D1 writer or reader. A
future writer must receive the exact trusted in-process candidate, re-check the
still-current verified Better Auth session inside the same request, prove every
0069 writer guard, use database time, commit only the decision row, and reload
the exact durable row before anything may treat it as recorded.

## Threat model

| Threat | Required mitigation |
|---|---|
| Browser chooses Riley/Aidan or backdates a decision | The declaration schema rejects reviewer/time fields; both come from the current server session and clock. |
| Unverified or unauthorized account | Require Better Auth `emailVerified: true` and the fixed two-owner allowlist. Route activation remains blocked until real owner email verification and MFA are configured. |
| Session fixation, theft, or substitution | Bind user, normalized verified email, session ID, session creation/expiry, exact proof, decision, and time with HMAC; future recording must re-check the current session rather than trust the record alone. |
| Bearer JSON replay after process loss | Only the exact `WeakSet`-registered in-process object can reach a future writer. Serialized JSON is audit data, never authority. |
| Dossier, manifest, business, snapshot, or parent substitution | Regenerate ADR 0044 proof from exact trusted objects and mirror every content-addressed lineage field into the record and schema. |
| Stale dossier or expired session | Keep ADR 0044's five-minute dossier window and require database recording before session expiry. |
| Raw authentication leakage | Store only HMAC digests, owner enum, provider, key version, observation time, and expiry. Migration 0069 rejects raw auth identifier keys in `decisionJson`. |
| Weak or rotated key ambiguity | Require at least 32 bytes and record a bounded explicit key version. Rotation must preserve old verification material according to a later runbook. |
| Duplicate or conflicting decision for the same proof | Content-address the complete record and enforce unique acceptance-proof and decision-binding identities. A changed decision requires a new current dossier/proof version, not an update. |
| Direct SQL forgery | The schema can enforce shape, lineage mirrors, and immutability but cannot verify an HMAC secret. Durable trust therefore requires a future guarded executor plus exact reload; direct SQL never becomes trusted merely because the row parses. |
| CSRF or cross-origin mutation | No route exists. A future same-origin mutation must add CSRF/origin, method, content-type, size, rate, and idempotency controls before activation. |
| Clock disagreement | Contract time is server-derived; future persistence must use and reload database time and reject writes outside the active session/dossier window. |
| Authority creep | Both contract and database constrain phase input, progress, capture, contact, qualification, consent, mailbox, outreach, send, deployment, provider operations, and cost to false/zero. |

## Options considered

### Persist the existing unauthenticated acceptance proof

Rejected. It explicitly says authentication is unproven and accepts reviewer and
time as declaration fields. Storing it would turn a synthetic contract into
false owner authority.

### Put user/session/email directly in the ledger

Rejected. It leaks unnecessary authentication identifiers and makes copied
database output more sensitive. HMAC bindings retain comparison/audit value
without exposing the raw values.

### Add route, button, D1 executor, reload, and progress append together

Rejected. It would combine identity, CSRF, persistence, idempotency, UI state,
durable trust, and phase advancement before each boundary has its own test and
release decision.

### Define contract and inactive schema first

Selected. It makes the eventual security contract reviewable and migration-safe
while keeping the repository incapable of recording a real owner decision.

## Consequences

- Riley/Aidan identity and decision time are no longer browser-controlled in the
  future contract.
- Raw auth identifiers do not appear in the record candidate or schema JSON.
- Migration 0069 can be replayed from zero and is part of the canonical ignored
  local schema, but it has not been applied to any existing local, staging, or
  production database.
- No real owner has been authenticated by this milestone and no decision row has
  been written.
- Current Better Auth configuration is an explicit activation blocker until
  verified owner email and MFA/recovery controls exist.
- A future D1 executor/reloader, UI mutation, and authenticated progress bridge
  remain separate milestones with separate release approval.
- The rebuild remains on its feature branch. Riley's intended eventual `main`
  cutover is unchanged and is not authorized by this ADR.

## Action items

1. [x] Add the verified-session, server-derived, HMAC-bound record candidate.
2. [x] Add schema 0069 with mirrored lineage, raw-auth-key rejection, unique
   proof/binding identities, append-only triggers, and zero downstream authority.
3. [x] Prove exact synthetic candidates, migration replay, drift rejection, and
   immutability without a live database or owner action.
4. [ ] Harden owner authentication with verified email, MFA, and recovery before
   any decision-writing route can pass.
5. [x] Design a separate D1 executor/exact-reload boundary with database clock,
   current-session recheck, writer-guard verification, and no progress authority.
6. [ ] Add the owner UI mutation and progress bridge only after separate UI,
   CSRF/idempotency, staging, rollback, and release approval.
