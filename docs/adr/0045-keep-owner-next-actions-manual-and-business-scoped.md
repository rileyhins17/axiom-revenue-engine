# ADR 0045: Keep the first owner next-action workflow manual and business-scoped

- Status: implemented locally; migration and release remain gated
- Date: 2026-09-22
- Scope: authenticated owner actions on a current v2 business dossier

## Problem

The dossier shows why a business needs attention, but it had no saved owner,
next action, or due time. Aidan and Riley could lose a human follow-up even when
the research itself was retained. This is a useful M4 owner-workflow slice while
M2 real research and mail readiness remain gated. It must not turn a contact or
a task into permission to send.

## Decision

Migration 0071 adds an append-only task row and at most one terminal event per
task. A task belongs to one `RevenueBusiness` and records an assigned owner,
human-readable action, absolute due time, creating actor, and creation time.
The only terminal outcomes in this slice are completed and cancelled. Database
constraints reject edits/deletes and duplicate terminal events. The typed D1
boundary uses a single conditional insert for each mutation, followed by exact
idempotency readback. Both terminal writes and single-task reads are scoped to
the business identity. A list returns at most 100 newest tasks; an exact replay
uses a direct task lookup so the list cap cannot hide its result.

The authenticated `/leads/[businessId]` page keeps its evidence dossier
read-only and shows a separate manual task panel. The private, no-store API
requires a current v2 dossier, derives the actor from the session, validates
the command and same-origin POST, and returns a saved task only after database
readback. The UI presents due times in America/Toronto and makes a human choose
Riley or Aidan. The browser acceptance loses one accepted response, retries with
the same key, reloads the one saved task, closes it, and reloads the terminal
state against local SQLite. It also rejects anonymous reads/writes and an
authenticated cross-site write.

These records are **owner reminders only**. They do not grant qualification,
consent, contact verification, outreach approval, provider access, autonomous
follow-up, or spend authority. A completed task does not imply that a prospect
was contacted. No background scheduler is attached. The current work does not
implement assignment history, a unique active next action, reply triage,
opportunity transitions, or an overdue dashboard; those are later M4/M6 work.

## Consequences and release gate

This reuses the existing console and database boundary without connecting a
mailbox or new provider. It also makes the owner page depend on migration 0071
for task loading; an absent schema leaves the dossier readable and the task
panel explicitly unavailable. No remote migration or deployment follows from
this source change. A later release needs a current backup, rollback path,
staging migration/restore acceptance, exact candidate verification, and an
explicit release decision. The M2 local assessment database and its pinned
migration baseline remain separate.
