# ADR 0049 — Validate owner-dossier progress authorization without activating it

- Status: Accepted
- Date: 2026-09-03
- Deciders: Riley Hinsperger and the Revenue Engine integration owner

## Context

ADR 0047 added a disconnected durable owner-decision writer/reloader. Its
`DURABLE_RELOAD` result proves that the stored decision is intact, but it is
deliberately not a current login and must not by itself advance shadow progress.
The next safe design boundary needs to prove that a future progress request has
both the exact durable decision and a newly obtained, verified Better Auth owner
session. It must remain unreachable while verified email, MFA, recovery,
CSRF/origin protection, idempotency, staging, rollback, and release approval
are incomplete.

## Decision

Add a disconnected validation-only
`OWNER_DOSSIER_PROGRESS_AUTHORIZATION` adapter. It:

1. Requires the exact module-private `DURABLE_RELOAD` result from the ADR-0047
   injected D1 boundary. Fresh commits, exact replays, schema-valid clones, and
   hand-built JSON are rejected.
2. Reuses the canonical stored decision HMAC and session-binding derivation to
   validate a newly obtained, verified Riley/Aidan Better Auth session context.
   The caller is responsible for obtaining that context through a future
   server-only adapter; this module does not read request bodies or Better Auth.
3. Requires the server timestamp to be at or after the durable reload's database
   clock, within a fixed one-minute freshness window, and inside the session's
   created/expires interval.
4. Returns one deeply frozen, content-addressed token containing only opaque
   bindings, owner enum, exact decision/dossier/manifest/parent lineage, and the
   `OWNER_DOSSIER` intent. Raw user IDs, session IDs, email addresses, and key
   material are not returned.
5. Retains private identity ties to the exact durable result so a future
   consumer can require the same in-process object. It does not create a phase
   input, receipt, checkpoint, file, database mutation, provider call, route,
   UI action, outreach, send, deployment, or spend.

## Threat model

| Threat | Required mitigation |
|---|---|
| Stored decision JSON is copied into a request | Require the exact D1 `DURABLE_RELOAD` object through its private `WeakSet`. |
| A fresh commit or replay is mistaken for process-loss proof | Require `executionPath === DURABLE_RELOAD`. |
| An owner session is changed, unverified, unauthorized, expired, or bound to another key | Recompute the canonical subject/session/decision HMACs and check the current session window. |
| Durable history is reused long after its session context was observed | Require authorization no later than one minute after the durable reload clock. |
| A valid token is copied to a later consumer | Deep-freeze/register the exact token and retain the exact durable-result identity in a private `WeakMap`. |
| Authorization quietly becomes progress authority | Schema-constrain all phase-input, receipt, checkpoint, database, provider, outreach, send, deployment, and cost fields to false/zero; statically forbid append/runtime imports. |
| A request body supplies a fake server session | Keep the adapter disconnected from routes and require future activation to use a server-only Better Auth adapter. |

## Options considered

### Trust the durable reload alone

Rejected. Historical HMAC integrity does not prove that the owner session is
still current at the time a progress request is made.

### Add the Better Auth route and progress bridge now

Rejected. Email verification is disabled in the current application, and MFA,
recovery, CSRF/origin controls, idempotency, staging, rollback, and release
approval are not yet proven.

### Add a disconnected validation-only authorization token

Selected. It proves the smallest next security contract with synthetic fixtures
while preserving the activation blockers and keeping every operational authority
off.

## Consequences

- A future progress bridge has an explicit, content-addressed authorization
  contract instead of treating a durable decision row as a current login.
- The one-minute window makes the durable reload and session check a single
  short-lived validation transaction from the caller's perspective.
- The current implementation still cannot prove that a caller obtained its
  session from Better Auth; only the future server-only adapter can provide that
  origin guarantee. No route or UI can reach this module today.
- The rebuild remains on its feature branch. Riley's intended eventual `main`
  cutover is unchanged and is not authorized by this ADR.

## Action items

1. [x] Add the validation-only owner-dossier progress authorization contract.
2. [x] Reuse canonical HMAC/session-binding verification and exact durable-result
   identity checks.
3. [x] Prove copied, replay, session, key, chronology, freshness, authority, and
   zero-side-effect behavior with synthetic tests.
4. [ ] Harden owner authentication with verified email, MFA, and recovery.
5. [ ] Implement and review a server-only Better Auth session adapter, including
   CSRF/origin and idempotency controls, without accepting request-body session
   fields.
6. [ ] Revisit the progress bridge only after staging, rollback, security review,
   and explicit release approval.
