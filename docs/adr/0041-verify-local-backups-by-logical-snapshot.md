# ADR 0041: Verify local SQLite backups by logical snapshot

- Status: accepted for the Task 8 local backup and restore-drill slice
- Date: 2026-09-21
- Scope: private local SQLite setup; no migration or production release

## Decision

Task 8 uses the installed `better-sqlite3` backup API with an absent destination
inside an exclusively created, random private directory. After the API completes,
the output is reopened read-only and independently checked for integrity,
foreign keys, one main database, and the canonical pre-0069 Revenue schema.

Source, backup, and restored copy must have equal **logical** snapshot digests.
The digest covers the complete SQLite schema and every row in every table,
including non-Revenue tables. Values retain their SQLite types; large integers
and binary values are not converted to lossy JSON numbers or text. Row order is
normalized without dropping duplicate rows. Virtual tables are rejected.

Every file has its own physical SHA-256, length, inode/device, and modification
marker. Source bytes and identity must stay unchanged throughout the operation.
Backup bytes do not have to equal source bytes: an independent probe of
`better-sqlite3` 12.8.0 produced valid, logically equal backups with different
physical hashes even in DELETE journal mode. The restore drill likewise proves
logical equivalence and records its own physical hash. No native fsync or actual
rollback claim is made.

The approved backup path is published using an exclusive same-volume hard link.
An existing target is accepted only when its exact bytes match the newly verified
backup, followed by independent SQLite validation. Conflicting files are never
overwritten. The restore drill copies the published backup into a different
private temporary directory; it never replaces the source database.

## Authority and cleanup

The operation requires a live, module-private setup capability created only by
canonical preflight. Copied objects, released sessions, expired or edited
approvals, and overlapping operations are rejected. The lock's file handle stays
open until release. The current repository/approval is reloaded before backup
and publication, and source/lock/root identities are rechecked around I/O.

This is a cooperative lock for a trusted owner-only local directory. It does not
claim to defend against an adversarial process running as the same operating
system user and replacing paths between filesystem calls. That limitation must
remain explicit before the later mutation runner is approved.

Cleanup removes only verified owned temporary files and their empty directories.
It never recursively removes the shared evaluation directory or forces removal
of another process's lock. Unverified partial outputs are retained for inspection
on failure. A failed setup operation may therefore leave a valid immutable backup
or a private incomplete temporary directory, but it cannot report a completed
setup receipt. Any incomplete temporary output or cleanup failure invalidates
the live session; the operator must release its lock and obtain a fresh preflight
before trying again.

## Delivery boundary

The backup/restore function is callable only through an actual held preflight
session. At this initial checkpoint the setup CLI was preflight-only. Subsequent
[ADR 0042](0042-transactional-local-setup-and-approved-recovery.md) defines explicit
setup, verification and separately approved rollback modes; preflight remains
the default. Tests use synthetic local databases and do not grant a real owner
release. Task 5's assessment consumption remains separate work.
