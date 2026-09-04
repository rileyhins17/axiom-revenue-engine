# ADR 0051 — Define the server-only owner-auth request boundary without activation

- Status: Accepted
- Date: 2026-09-03
- Deciders: Riley Hinsperger and the Revenue Engine integration owner

## Context

ADR 0050 made the required email, MFA, recovery, session, origin, Fetch
Metadata, and idempotency controls executable as a disconnected readiness
policy. The next design risk is allowing a browser request body to impersonate
an owner or replay a mutation. Better Auth must eventually be queried on the
server in the same request; no request-body field may select a user, session,
or owner.

The application is not ready to activate this boundary. Email verification is
still disabled in the current Better Auth configuration, owner MFA/recovery has
not been enrolled and tested, and no staging schema or rollback evidence exists.

## Decision

Add a validation-only `OWNER_AUTH_SERVER_REQUEST` contract that requires:

1. The exact frozen `OWNER_AUTHENTICATION_READINESS` result.
2. A server-supplied, currently active, verified Better Auth owner session.
3. An exact trusted request origin, matching `Origin` header, and strict
   same-origin Fetch Metadata (`Sec-Fetch-Site`, `Sec-Fetch-Mode`, and
   `Sec-Fetch-Dest`) for mutation requests.
4. A stable operation name, canonical payload digest, and idempotency key bound
   to the derived owner, operation, and payload. A future durable adapter must
   atomically store and replay this key; this contract does not store it.
5. Explicitly opaque request body handling: body fields are ignored for
   identity, session, owner, and authorization.

The result contains only a derived owner enum, verified-session times, request
policy facts, payload digest, and idempotency key. It excludes raw user IDs,
session IDs, tokens, passwords, and request body data. The output is frozen,
content-addressed, trusted only by exact in-process identity, and marked
`VALIDATED_NOT_ACTIVATED`. All mutation, route, UI, database, provider,
outreach, send, deployment, and cost authority remains false or zero.

This module imports neither Better Auth nor a request/runtime/database/provider
adapter. A future server adapter may obtain a session with Better Auth and pass
its structured result here only after ADR 0050's activation gates pass.

## Threat model

| Threat | Mitigation |
|---|---|
| Browser body claims to be Riley or Aidan | Owner is derived only from the server-supplied verified session; body is opaque and ignored. |
| Cross-site mutation reaches an owner route | Exact trusted origin, matching `Origin`, and strict Fetch Metadata are required. |
| Expired or future session is accepted | Server time must fall within the session's finite created/expiry interval. |
| A mutation is replayed with a different payload | Idempotency key must bind the operation, derived owner, and canonical payload digest. |
| Raw auth identifiers leak into a boundary result | Only the owner enum and session timestamps are returned; IDs and tokens never enter output. |
| Boundary result becomes an action grant | WeakSet identity, frozen output, `VALIDATED_NOT_ACTIVATED`, and zero authority prevent reuse as an activation token. |

## Options considered

### Read identity from request JSON

Rejected. A browser-controlled body is not an authentication boundary and would
make owner actions impersonable.

### Connect this contract directly to Better Auth and routes now

Rejected. The required owner accounts, verified-email delivery, MFA/recovery
enrollment, staging schema, rollback, security review, and release approval are
not proven.

### Define a disconnected server-boundary contract first

Selected. It makes the correct server-only shape and replay rules testable while
preserving the no-live-operation boundary.

## Consequences

- Future route work has one small contract that can be reviewed before wiring.
- Request-body spoofing, unsafe origins, stale sessions, and forged replay keys
  fail closed in tests.
- The contract does not yet provide durable idempotency storage or authorize a
  mutation; those require a separate server adapter and release gate.
- No provider, secret, route, UI, database, deployment, migration, or spend is
  introduced by this ADR.

## Action items

1. [x] Add the disconnected server-boundary schema, owner derivation, CSRF/
   Fetch Metadata checks, and idempotency-key validation.
2. [x] Prove body spoofing, stale/unverified sessions, unsafe origins, forged
   keys, and copied-result trust failures.
3. [ ] Prove Better Auth verified-email delivery and two-factor/recovery setup
   for both owners in isolated staging.
4. [ ] Design an atomic durable idempotency adapter with replayed result
   storage, without accepting any request-body session fields.
5. [ ] Connect a route only after staging, rollback, security review, and an
   explicit owner release approval.
