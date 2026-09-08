# ADR 0052 — Define atomic owner-auth idempotency without live storage

- Status: Accepted
- Date: 2026-09-03
- Deciders: Riley Hinsperger and the Revenue Engine integration owner

## Context

ADR 0051 defines the server-only owner-auth request boundary and binds each
mutation to an owner, operation, and payload digest. A future route still needs
an atomic replay protocol: the first request may commit one result, an identical
retry must return that result, and a conflicting request must fail rather than
reuse the key.

No live owner route, verified-email rollout, staging schema, or production
release exists yet. Connecting a D1 writer now would cross the current safety
boundary and make an unreviewed owner action possible.

## Decision

Add a disconnected idempotency contract with an injected `insertIfAbsent`
store seam. It requires the exact in-process owner-auth server-boundary result,
the current server session window, and a bounded safe-JSON result. The record
binds:

- the boundary ID/digest;
- Riley or Aidan, operation, payload digest, and exact idempotency key;
- the result digest and result content; and
- the server storage timestamp.

The first insert returns `FRESH_COMMIT`. A store replay returns `EXACT_REPLAY`
only when every intent and result field matches. A conflicting payload, result,
owner, or forged record fails closed. Secret-like result keys, non-JSON values,
oversized results, stale sessions, and copied result envelopes are rejected.

The contract has no D1/SQLite/Cloudflare/Better Auth import, no route or runtime
consumer, and no mutation callback. Its authority remains zero for mutations,
owner decisions, routes, UI, database, providers, outreach, sending,
deployment, and cost. A future server adapter must provide a genuinely atomic
durable store and separately prove that executing the mutation and recording its
result cannot diverge.

## Threat model

| Threat | Mitigation |
|---|---|
| Same key executes twice | `insertIfAbsent` is the only accepted storage seam; exact replay is returned instead of a second commit. |
| Same key is reused for a different payload/result | Boundary digest, owner, operation, payload digest, result digest, and canonical result are compared before replay. |
| A forged stored JSON row is trusted | Stored rows are schema- and digest-checked; mismatches fail closed. |
| Secrets are persisted in a replay result | Result JSON is bounded and rejects secret-like field names, tokens, cookies, and keys. |
| Expired owner session writes an idempotency record | Server time must remain inside the verified session's half-open lifetime. |
| Replay envelope becomes a mutation grant | Results are frozen, exact in-process identity is required, and every authority flag is false/zero. |

## Options considered

### Execute the owner mutation before writing the replay record

Rejected for this milestone. Without a durable transaction/outbox design, a
crash between the mutation and record write can duplicate the action.

### Add a D1 table and route immediately

Rejected. Owner verification, MFA/recovery, staging, rollback, and release
approval are not proven.

### Define the atomic replay contract behind an injected store first

Selected. It makes the race/conflict semantics testable without connecting a
live resource or authorizing a real mutation.

## Consequences

- Future route work has explicit fresh/replay/conflict semantics.
- A durable adapter and transaction/outbox decision remain separate required
  milestones; this contract is not production persistence.
- No provider, secret, route, UI, database, deployment, migration, or spend is
  introduced by this ADR.

## Action items

1. [x] Add the disconnected atomic insert-if-absent/replay contract.
2. [x] Test exact replay, conflict, forged rows, secret filtering, size limits,
   stale sessions, and copied-result rejection.
3. [ ] Choose and review the production D1 idempotency schema/transaction shape.
4. [ ] Prove owner accounts, email verification, MFA/recovery, staging, and
   rollback before wiring any route.
5. [ ] Connect a mutation only after explicit release approval and a tested
   rollback/duplicate-delivery plan.
