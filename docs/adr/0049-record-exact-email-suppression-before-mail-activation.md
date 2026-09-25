# ADR 0049: Record observed email stops before mail activation

- Status: local implementation; production migration and mail activation gated
- Date: 2026-09-23
- Scope: owner-recorded unsubscribe, complaint, and bounce for an exact v2 contact

## Problem

The business-level stop in ADR 0046 cannot express an observed stop for one
email address while leaving the business's other evidence and manual routes
intact. A contact-point ID alone is insufficient: a new immutable contact row
could contain the same address under a different ID. The owner needs a durable
way to record an observed stop before any v2 mail path is built or activated.

## Decision

Migration 0073 adds an append-only `RevenueContactSuppressionEvent`. An
authenticated, same-origin owner action records one of `UNSUBSCRIBE`,
`COMPLAINT`, or `BOUNCE`, the exact business and contact-point IDs, a short
observation summary, observed time, session actor, and an idempotency key.
The event also stores a SHA-256 fingerprint of business ID, channel, and
normalized contact value. A later contact-point version with the same
normalized email at that business inherits the stop. The event does not copy
the raw address or message body; the fingerprint is a matching identifier,
not anonymous data or a secret. The source contact row remains under its
own retention rules.

The typed D1 boundary checks contact ownership before insertion, resolves
exact-key replay against every command field, and reloads the authoritative
event. A different command for an already suppressed address conflicts. The
route can record a stop when a dossier projection is stale or unavailable:
the persisted contact/business relationship is its scope gate. The current
dossier UI still needs that projection to render, so a separate recovery
surface would be needed if it is unavailable. A read failure
is unavailable, never a clear status. There is no release or undo in this
slice. The owner panel checks one selected email at a time and requires an
explicit personally-observed event; it does not send or import messages.

## Boundaries

This is a local manual safety control, not a complete M4 suppression service
or a send gate. Production remains unmodified until the migration, backup,
rollback, and release gates pass. Before any outbound mail can be considered,
the dispatch path must recheck authoritative business and recipient stops,
legacy/global suppressions and unresolved identity mappings, consent,
verification, approval, sender/reply readiness, and budget. A per-business
fingerprint does not resolve a request that applies across multiple
businesses or a changed address; those cases require explicit reconciliation
or a broader stop. No Cloudflare destination, Resend key, provider webhook,
legal sender identity, or paid mailbox is inferred from this code. Autonomous
send and follow-ups remain off.
