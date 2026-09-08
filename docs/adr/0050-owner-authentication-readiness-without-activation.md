# ADR 0050 — Validate owner-authentication readiness without activation

- Status: Accepted
- Date: 2026-09-03
- Deciders: Riley Hinsperger and the Revenue Engine integration owner

## Context

At this decision's original baseline, the application used Better Auth with email verification disabled and
without a proven owner MFA/recovery rollout. ADRs 0046–0049 define the future
owner-decision and progress-authorisation contracts, but none may be activated
until a real owner session is high assurance and its request origin is safe.

Better Auth's current security model relies on exact trusted origins, CSRF and
Fetch Metadata checks, secure cookies, and explicit email-verification options.
Its two-factor plugin provides TOTP enrollment, encrypted backup-code recovery,
and account lockout, but those features also require their own schema and owner
enrollment review. This milestone must therefore make the complete readiness
policy reviewable without pretending the controls are live.

## Decision

Add a disconnected `OWNER_AUTHENTICATION_READINESS` contract that accepts a
configuration snapshot only when it proves:

1. Exactly Riley and Aidan are the owner allowlist.
2. Email verification is required before a session, with verification delivery
   configured on sign-up and sign-in.
3. TOTP MFA is required for owners and owner actions, with encrypted single-use
   backup codes, fresh-session code viewing, and account lockout.
4. Sessions are obtained server-side, ignore all request-body session fields,
   use secure cookies, and have a bounded lifetime.
5. CSRF/origin and Fetch Metadata checks are on, trusted origins are exact, and
   production never trusts loopback or wildcard origins.
6. Mutations use atomic actor/operation/payload idempotency and exact replay.

The result is frozen, content-addressed, and marked
`VALIDATED_NOT_ACTIVATED`. Its authority is explicitly zero for routes, UI
mutations, databases, providers, progress, outreach, sending, deployment, and
cost. It imports no Better Auth, request, runtime, database, provider, or
secret. A future server-only adapter must produce the snapshot from live config
and still pass a separate activation gate.

## Threat model

| Threat | Mitigation |
|---|---|
| Current weak auth is mistaken for high assurance | Require every email, MFA, recovery, session, CSRF, origin, and idempotency field to be true before readiness can exist. |
| Production trusts a development origin | Reject loopback and wildcard origins in production; accept exact origins only. |
| Browser supplies a fake session or owner | Require server-only lookup and explicitly ignore request-body session fields; owner allowlist is fixed. |
| Lost MFA device creates an account takeover path | Require encrypted, single-use backup codes, fresh-session viewing, and lockout. |
| Mutation replay duplicates an owner action | Require atomic idempotency storage and identical replay results. |
| Readiness JSON becomes activation authority | Register only the exact frozen object in a private `WeakSet` and constrain every authority field to false/zero. |
| A disconnected policy is mistaken for live configuration | Keep the module unreachable from routes, UI, Better Auth, runtime, database, and operators; status names the missing owner/staging proof. |

## Options considered

### Turn on Better Auth controls and MFA routes immediately

Rejected. Verification delivery, two-factor schema, owner enrollment, recovery
handling, staging, rollback, and release approval are not proven. Enabling a
partial stack could lock out the owner or create a false sense of security.

### Keep only prose in the runbook

Rejected. Prose cannot prevent a future adapter from omitting one required
control or accepting a wildcard/loopback origin.

### Add a disconnected readiness contract first

Selected. It makes the activation checklist executable and testable while
preserving the current no-live-operation boundary.

## Consequences

- Future activation has one explicit policy object and a stable test target.
- The current Better Auth configuration remains intentionally unactivated until
  email verification, MFA, recovery, schema, and owner enrollment are complete.
- No provider, secret, route, UI, database, deployment, migration, or spend is
  introduced by this ADR.
- The rebuild remains on its feature branch; Riley's eventual `main` cutover is
  still a later release decision.

## Action items

1. [x] Add the disconnected readiness schema and zero-authority result.
2. [x] Prove weak defaults, unsafe origins, duplicate owners, body-controlled
   sessions, and copied-result trust failures.
3. [ ] Configure verified-email delivery and the Better Auth two-factor schema
   in isolated staging after owner account recovery is confirmed.
4. [ ] Enroll both owners, test backup-code recovery and lockout, and capture
   rollback evidence.
5. [ ] Implement the server-only session adapter and mutation idempotency bridge
   only after the preceding controls and explicit release approval pass.

## Source hardening follow-up — 2026-09-07

SEC-002 now enforces verified, configured owner admission at the shared auth
boundary and session creation, without activating any owner-decision writer.
Current approval is checked without cached environment values. Observed removal
revokes sessions; administrator configuration only limits existing grants and
never promotes a role. Invalid configuration denies access before cleanup.
Permanent revocation remains an explicit ban operation, not an unobserved
configuration toggle. Synthetic local SQLite/D1/browser checks are not live
enrollment, delivery, MFA or recovery evidence. All original activation and
exact-two-owner readiness requirements remain in force.
