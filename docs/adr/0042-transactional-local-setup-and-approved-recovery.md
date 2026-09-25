# ADR 0042: Transactional local setup and separately approved recovery

- Status: accepted for synthetic local verification; real setup release remains separate
- Date: 2026-09-21
- Scope: M2 Task 8 migration 0069, receipts, and local recovery

The setup command accepts a recorded, current owner release for exact paths,
repository commit, migration manifest and zero external authority. Its default
mode remains preflight. `--apply` is explicit; the command cannot create its own
approval. A live private capability and a held cooperative lock cover the whole
operation in an owner-controlled directory.

Before mutation, the runner validates the canonical 0054-0068 source, publishes
an immutable backup, and proves restoration. It derives the expected post-0069
schema and all-table contents by applying the approved migration to an in-memory
copy of the verified backup. The real source receives exactly 0069 in one
`IMMEDIATE` transaction. Its result must match that independent expected state
inside the transaction and after close/reopen. Existing records and non-Revenue
tables are covered by the same comparison.

The v2 receipt includes the typed logical snapshot digest established in
ADR 0041. Its backup evidence digest covers every proof field; duplicate physical
SHA fields must match their own file identities. Source, backup and restore
physical hashes need not equal each other. A second restore drill follows the
committed migration. The receipt is published last by exclusive hard link from
a fully written, flushed private file; conflicting bytes are never overwritten.
This does not assert a portable power-loss durability guarantee for the database
backup or directory metadata.

A transaction error rolls back and checks the original schema, rows, file
identity and bytes using a fresh handle. SQLite's integrity check initializes
an internal temporary schema, so each strict single-database inspection uses
the appropriate fresh handle instead of weakening the existing check.

A post-commit error leaves the migrated database and backup available, produces
no success result, and invalidates the session. A missing setup receipt never
authorizes inferring success or repeating the migration. Recovery requires a
separate recorded rollback release naming the inspected suspect and backup
identities, logical proof, quarantine path and rollback receipt path. This
deliberately preserves the owner's decision about replacing the database.

Approved rollback first validates a separate restore candidate, then preserves
the suspect through an exclusive quarantine hard link. Only that inspected
source is unlinked before the validated restore is published. Failed operations
retain their candidates. A rollback-only preflight can resume when the source
is missing but its exact approved quarantine and backup survive. It also handles
interruption while source and quarantine still share the original inode. This
capability cannot apply a migration or authorize an ordinary setup backup.

If replacement completed but receipt publication was interrupted, the runner
independently verifies restored contents and quarantine identity before writing
the rollback receipt. Replays compare the exact receipt with current physical
and logical evidence and do not repeat a database mutation. Unknown or changed
evidence stops recovery. Existing setup receipts remain immutable; restoration
changes their bound database identity, so they cannot falsely verify afterward.

All acceptance fixtures are synthetic. This decision does not connect a provider,
run a real migration, change targeting, enable mail, deploy, or authorize spend.
