# ADR 0046: Record a manual business stop before outreach exists

- Status: implemented locally; migration and release remain gated
- Date: 2026-09-22
- Scope: authenticated owner stop on one exact current v2 business dossier

## Problem

The owner console could show a current route for a business Riley or Aidan
decides not to contact. The v2 `SUPPRESSED` enum and legacy
`OutreachSuppression` table do not provide a durable owner action on a current
v2 business identity. M4 still needs contact-level suppression, consent review,
legacy reconciliation, and mail readiness, but an owner must be able to record
and see a business-level stop without waiting for those integrations.

## Decision

Migration 0072 adds one immutable `RevenueBusinessStopEvent` per exact
`RevenueBusiness`. It records a reason, owner-action source, note, session actor,
database time, and idempotency key. The typed D1 boundary uses a conditional
insert, checks exact-key replay against every command field, and reloads the
authoritative saved record. A second key for an already stopped business is a
conflict, not another event or permission to resume. There is no release/undo
command in this slice.

The private `/api/v1/leads/[businessId]/stops` route requires an authenticated
current v2 dossier. Mutations require a same-origin request, strict bounded JSON,
and a session-derived actor. The dossier panel confirms the current saved state
before enabling the manual form, retains the same key for an unchanged uncertain
retry, and refreshes the server dossier after saved readback. The ranked list
and detail projection read stop rows from D1 on every request; a saved stop
changes attention and route presentation to **blocked / do not contact**.
If the stop lookup is unavailable, they also block route presentation while
keeping evidence visible for diagnosis. The sealed qualification scores,
evidence, and contact identities remain unchanged; this is an operational
overlay, not a new qualification decision.

The adjacent owner-task workflow also refuses new tasks and completion while
a business stop exists or the stop table cannot be checked. Existing tasks
remain visible and may be cancelled. Exact replay of a task command accepted
before a stop remains readable, but it cannot create a new action after the stop.

The historical M1 synthetic dossier report is pinned to the pre-0072 local
schema. Its composition explicitly marks this operational gate not applicable
so its immutable fixture replay remains stable. That report has zero contact
or outreach authority. Authenticated owner routes use the required gate by
default and fail closed when it is unavailable.

## Boundaries and consequences

This is a business-level owner stop only. It does not implement contact-level,
address-level, or domain-level suppression; unsubscribe/bounce ingestion; legal
consent; legacy identity mapping; or provider/send gates. It does not mutate
legacy queues or create outreach. Before v2 may nominate or dispatch a send,
M4 must reconcile legacy suppressions, contacts, sends, replies, and canonical
identities, block unresolved mappings, and check the authoritative current
business and recipient stop state at dispatch. Contact and business stops remain
distinct scopes. A future identity merge/import must preserve a stop and cannot
interpret a new v2 ID as permission to contact.

The code and migration are a local checkpoint only. Remote migration or
deployment requires a current backup, rollback/restore evidence, passing gates,
an exact candidate, and the separate release decision in the operating contract.
