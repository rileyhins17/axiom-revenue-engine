# ADR 0043: Separate setup baseline from assessment state

- Status: implemented local successor runner; real evaluation and release remain gated
- Date: 2026-09-21
- Scope: M2 Task 5 assessment persistence after the Task 8 setup receipt

## Problem

Task 8 proves the initial database by comparing its physical identity and bytes
with the setup receipt, and its complete logical state with a separately
migrated backup. Task 5's former design repeated that initial byte comparison
after legitimate assessment inserts. Those inserts necessarily change the
database. The former rule would reject its own successful operation and prevent
restart or the next business in the ten-business run.

## Decision

Keep `verifyPrivateKwM2Setup` strict and unchanged. It verifies an unchanged
setup baseline. Introduce successor verification only with the actual Task 5
assessment writer and its deterministic row plans; do not add an independent
generic SQL executor or accept a caller's assertion that drift was authorized.

The expected successor is the verified pre-0069 backup, the exact approved
0069 migration, and the complete set of independently reconstructed, authorized
M2 assessment plans. Build this reference in memory. Compare all schema and
table contents using the logical snapshot mechanism from ADR 0041. Include
non-Revenue tables and all legacy rows. Row counts alone are insufficient.
The real database is never recreated or repaired from this reference.
The assessment set is bounded by the exact approved M2 manifest (at most ten
businesses); it cannot expand by discovering more rows in the database.

The runner must implement this sequence under one held local operation lock:

1. Reload the immutable setup receipt, its recorded release, backup identity
   and logical proof, exact migration manifest, and canonical database path.
   Preserve the setup receipt and backup unchanged.
2. For an initial assessment, require the exact setup file identity and hash.
   For a successor, require the same database device/inode and canonical path;
   compare its contents to the reconstructed successor rather than the original
   setup bytes. A copied database or recovery replacement requires a new gate.
3. Reconstruct each completed assessment from its exact recorded approval,
   source materialization, Task 4 evidence, frozen mapping, and immutable
   assessment/lineage rows. Reject an unaccounted row, incomplete row set,
   duplicate operation, conflicting parent, or unsupported writer version.
   Neither report files nor self-consistent database JSON are sufficient proof.
4. Check the requested new operation's current owner approval and clock. Reload
   its source materialization before and after Task 4 evidence reload. Derive
   its complete bounded row plan and the next reference state without writing
   the real database. No caller-supplied SQL or arbitrary callback is accepted.
5. Execute only that plan in one immediate transaction, with the lineage
   completion row last. Compare the resulting complete logical state inside
   the transaction. After commit, reopen and compare again, then derive reports
   from durable rows. Each read-only inspection requires unchanged physical
   identity and bytes across that inspection, and absent sidecars.
6. A restart rederives the same expected state. A complete exact database
   transaction can regenerate missing reports without new mutations. A partial
   or mismatched database stops; it cannot receive a synthesized completion row
   or an automatic repair. An exact replay must leave database bytes unchanged.

Receipt verification and permission to perform a new operation are separate.
Historical setup and completed-operation approvals are checked against their
recorded execution time and exact versions. Their later expiry does not erase
completed evidence. Every new write requires an unexpired current approval.
Migration blobs must match the approved manifest; an unrelated documentation
commit is not a new migration. A changed mapping, writer, migration, or operation
scope requires its applicable new review. This historical verification belongs
to the Task 5 reader, not a weakening of the current setup command's release
loader or its current-HEAD rule.

## Legacy reader compatibility

The ordinary owner list/detail and legacy assessment APIs must distinguish
pre-0069 schemas from 0069's explicit evidence partitions. Use bounded read-only
schema inspection, with no fallback on errors and no long-lived schema cache.
Cloudflare documents `PRAGMA table_info` support through its bindings API:
[D1 SQL statements](https://developers.cloudflare.com/d1/sql-api/sql-statements/).
Reject partial or malformed partition metadata.

On 0069, ordinary owner projections select only `LEGACY` rows, including latest
row subqueries, contacts, verification, history and contact review. Legacy
assessment collision queries still inspect every matching identity/key, select
the partition fields, and require `LEGACY`; they must not filter a conflicting
M2 row out of existence. New legacy assessment inserts set these fields
explicitly. Dedicated M2 readers remain the only place to present HTML-only
limitations as M2 evidence. Existing private M1/contact scripts retain their
strict pre-0069 schema gate.

## Required evidence before successor verification is complete

- First assessment, exact replay, second business and process restart succeed
  with the full expected contents and no repeated mutation.
- Unauthorized changes to an unrelated table, a legacy row or an M2 row fail.
- Missing approval/evidence, partial lineage and same-ID/key conflicts fail.
- Failure before commit rolls back; interruption after commit permits only an
  exact durable reload and report regeneration, never inferred permission.
- Copied databases, swapped paths, sidecars and within-inspection changes fail.
- Expired approvals can verify historical completed evidence but cannot approve
  a fresh write; changed execution versions cannot be silently adopted.

## Implementation and receipt versions

`scripts/execute-private-kw-m2-html-assessment.ts` implements the bounded local
runner. Its ordered run artifact names the exact source, manifest, Task 4
requests, recorded assessment decisions and output paths. The typed planner
binds progress to the prior checkpoint and every canonical assessment row
digest; lineage stays acyclic and is inserted last. Exact progress reload and
fresh database reconstruction precede owner report publication. A caller's SQL,
plan object or report cannot authorize execution.

Task 8 now emits a v3 setup receipt containing `completedAt`. That timestamp is
recorded by the actual runner after successful migration/reopen/restore proof
and checked against the recorded release window and trusted clock. The original
strict v2 parser remains available, and initial setup verification accepts v2
without changing its hash or inferring a timestamp. Task 5 requires v3 because
v2 cannot prove when historical setup completed. No migration schema changed.

The integration tests execute actual setup and assessment runners against
synthetic local files; restart uses a fresh process with independently rebuilt
fake Task 4 stores. No browser/prospect/provider is contacted. The accepted
scope is a COMPLETE HTML capture; website-only partial review, owner-console
integration and the real one-then-ten evaluation remain unfinished.

This decision grants no migration, real research, provider, deployment, contact,
qualification, outreach or spend authority. See STATUS for current verification.
