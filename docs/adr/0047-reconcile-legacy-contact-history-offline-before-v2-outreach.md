# ADR 0047: Review legacy contact history before v2 outreach

- Status: local, read-only report; no production reconciliation or release
- Date: 2026-09-22
- Scope: legacy Lead identity, suppression, send, bounce, and reply evidence versus current v2 business identities

## Problem

The v2 business stop in ADR 0046 applies to an exact `RevenueBusiness` ID. The
older `Lead`, `OutreachSuppression`, `OutreachEmail`, sequence, and funnel records
have no durable link to that ID. A new v2 identity must not erase an old stop or
make a previously contacted business appear untouched. Domain, phone, and
contact address can be shared or change, so an exact signal is a candidate for
owner review rather than proof of a merge.

## Decision

Produce a deterministic, offline report from one explicitly supplied,
standalone local SQLite snapshot. The reader opens it read-only, checks its
required schema and integrity, binds the output to the snapshot digest and a
pinned as-of time, and refuses a changing or partial source. It reads only the
columns needed for identity and contact-history classification; message bodies,
subjects, OAuth tokens, and raw source payloads stay outside the projection.
The local report contains opaque record IDs, candidate match methods, history
classes, blockers, and counts, without raw recipient or contact values.

Exact domain, business-phone, phone-contact, and email-contact signals may
nominate v2 candidates; the report names matching contact-point IDs without
copying their values. They do not approve identity merges, consent, or contact.
Ambiguous, conflicting, missing,
or otherwise unreviewed historical suppression, contacted, or reply evidence
remains blocked for new outreach; every plausible matched business remains
blocked while that history is unresolved. A suppression's expiry is shown at
the pinned as-of time, but does not silently clear an old stop. A recorded send
or provider acceptance is application evidence, not proof of delivery. Bounce
evidence never becomes a human reply merely because a legacy sequence has a
`replyDetectedAt` value. A bounce-only funnel record remains explicit bounce
history. Unsubscribe and complaint funnel records are suppressive history,
not human replies; a funnel send remains contact history even when it is the
only surviving send record.

An old delivery row with a send timestamp and a conflicting failed or
cancelled status is unresolved history, not proof of delivery or a clean
no-contact state. Legacy `Lead` contact/reply/bounce fields are retained as
**reported** states, separate from confirmed send, human reply, and bounce
events. A status reset
cannot erase those timestamps from the review. The report hashes source event
IDs into stable references and includes their type, status, and time so an owner
can trace a blocker without copying message content into the report. Every
unapproved identity candidate carries an `IDENTITY_REVIEW` blocker even when no
legacy contact history is found.

## Boundaries and consequences

This report is an owner review aid. It does not import rows, rewrite legacy or
v2 state, activate mail, grant a legal basis, nominate a send, or authorize
outreach. No production snapshot is inspected by the local implementation
checkpoint. Before any v2 send can be considered, an owner must review actual
history, resolve or explicitly block every conflict, preserve business and
contact stops in an approved additive path, and pass the separate M4 consent,
sender, reply, budget, and exact-approval gates.

Keep the snapshot and report in ignored private storage with access limited to
the owners. The source and output retention period and any later import are
separate decisions. A missing or incompatible schema, incomplete extract, or
unreadable snapshot fails closed; it is never interpreted as no history.
The reader validates the required tables/columns and records a schema digest;
it does not verify the database's migration ledger or prove that a snapshot is
the exact production schema. That provenance must be checked separately before
an actual owner reconciliation is relied on for release.
