# ADR 0051: Link manually observed replies to owner actions

- Status: local implementation; production migration and reply-route proof gated
- Date: 2026-09-23
- Scope: owner-observed email replies for saved v2 business contacts

## Problem

The v2 dossier could save a general next action and an exact email stop, but
could not record a reply observed by Riley or Aidan in an existing inbox. The
legacy Gmail inbox is a different data generation and cannot establish v2
reply ownership. Building provider sync before verifying forwarding would add
cost and operational assumptions without helping an owner act on a response.

## Decision

Migration 0074 adds an append-only `RevenueOwnerObservedReply` record for one
saved email contact, a factual category, short owner-written summary, observed
time, actor, and an assigned action with due time. It stores no message body,
headers, attachments, provider identifiers, or inbox credentials. A database
trigger creates one existing `RevenueOwnerTask` in the same insert statement.
If task creation fails, the reply insert rolls back. Exact idempotency replay
returns the saved reply and its current task status; changed commands conflict.

Both application admission and the migration guard require the exact business
and email contact, no business stop, and no suppression for the normalized
address at that business. Missing stop or suppression tables fail closed. The
authenticated same-origin API returns only bounded owner records. The compact
dossier panel starts closed, records a reply only when its stop state is clear,
and points the owner to the linked task. Today shows open assigned reply
actions by earliest due time and labels them as owner-recorded, separate from
the legacy inbox. Completing the linked task removes it from that open queue;
cancelling it keeps an explicit cancelled record in the business detail.

`NEGATIVE` is a factual classification, not a consent finding or automatic
do-not-contact event. An unsubscribe or complaint must be recorded through
the exact-email stop control; an owner can stop the whole business separately.
Future outbound gates must reconcile negative replies and all prior contact
history before any further touch. No send, provider sync, forwarding rule, or
human reply route is activated by this record.

## Exit and limits

The local exit is an authenticated synthetic owner flow: record one reply,
verify exactly one linked task and Today attention, complete it, and confirm
the reply history remains while open attention clears. Validate anonymous and
cross-site rejection, idempotency, atomic rollback, suppression inheritance,
and failed guard reads. This is one M4 component, not M4 exit or production
readiness. Migration 0074 needs backup, rollback, and an explicit release gate
before a remote apply. The zero-paid-mailbox forwarding and reply round trip,
sender identity, legacy reconciliation, legal contact rules, and send approval
remain separate gates.
