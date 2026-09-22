# Current status — Axiom Revenue Engine

## M2 complete-capture assessment workflow

**Updated:** 2026-09-21 (America/Toronto). **Code checkpoint:** `6aaf216`
(`feat(revenue): persist local HTML assessment checkpoints`), based on
`20ab6a6`. Assessment verification passed; the owner-browser gate remains open.
This following documentation update records the committed checkpoint identity.
The previous code checkpoint is `52f9009`.

The local COMPLETE HTML path now connects actual recorded source rows, Task 4
receipt/artifact reload, a separate owner assessment decision, one transactional
canonical write, immutable lineage, progress and an owner JSON dossier.
`npm run kw:assess-m2-html` defaults to preparing the decision. Execution never
approves itself. Source rows reload on both sides of HTML evidence reload;
evidence reauthenticates immediately before writing and after database reopen.

The successor runner implements ADR 0043: reconstruct the full expected state
in memory from the immutable backup, exact approved migration and authenticated
completed assessments, then compare every table, including legacy/non-Revenue
data. It rejects incomplete or unrelated changes. An exact replay leaves the
database bytes unchanged. Missing post-commit progress/report files can be
regenerated only after durable reconstruction; conflicts are never overwritten.
The progress seed binds the previous checkpoint and every assessment row digest.

Setup now emits a v3 receipt with a trusted completion timestamp after successful
migration, reopen and restore proof. Historical assessment verification requires
that timed receipt and checks setup/assessment approvals at their recorded times.
Later expiry permits historical verification but cannot authorize a fresh write.
The initial setup verifier retains strict v2 support and exact baseline hashes;
it does not infer a timestamp or accept successor drift. No schema changed.

The owner projection exposes page facts, provenance, retained evidence references
and HTML limitations. It forces UNKNOWN/non-qualifying classification, RESEARCH,
zero scores, no routes/channels, and NOT_RECORDED/UNASSESSED contact review. This
is a private JSON dossier; the ordinary owner console still excludes M2 rows.

Root owns the runner, integration tests and final verification. Luna supplied
the bounded source reloader, Task 4 fixture, timed receipt contract and owner
projection, and reviewed the combined boundary. Review found and corrected
second-business selection, fixture type errors, missing snapshot evidence refs,
mixed retention acceptance and missing final evidence reloads. Targeted acceptance
now passes first write, exact replay, second business, fresh-process restart,
expired historical proof, pre-write evidence loss, post-commit evidence loss,
transaction rollback and interrupted output recovery. These tests use real local
setup/assessment runners with synthetic data and fake Task 4 stores.

| Required check | Current result |
|---|---|
| Safety, TypeScript, lint | PASS |
| Full test suite | PASS, 644 total, 641 passed, 0 failed, 3 Windows symlink-privilege skips; 555.5 seconds |
| Cloudflare build | PASS, 2,018 files scanned, 0 local secret values |
| Wrangler deployment dry run | PASS, no upload; autonomy variables remain false/zero |
| Owner UI acceptance | FAIL, intermittent truncated development chunk; one diagnostic repeat passed, the next reproduced and captured the failure |

This checkpoint saves the local assessment workflow and browser investigation;
it does not complete M2 or establish release readiness. The browser error also
occurred after all builds/dry runs exited and after fresh `.next` cleanup, so
concurrent builds are not a sufficient explanation. Chromium attribution captured
`/_next/static/chunks/app/layout.js`: 1,179,648 bytes, an exact prefix of the
complete 3,138,186-byte generated file, ending inside a string. The retained
artifact is `output/playwright/owner-ui-9236-1790035521594` (captured scripts use
`.js.txt` so malformed evidence is not linted as source). New diagnostics retain
the failing script, location and event-time stage while preserving the existing
console/page-error failure gates.

A separate loopback experiment reproduced the empty-stack SyntaxError when the
server ended a response normally at that incomplete prefix. Simple navigation
cancellation did not reproduce it. The reason Next delivered the short script
is not yet proven; a later passing run does not resolve this blocker. No runtime
or navigation workaround has been applied. The next browser investigation is
response completion/length and development chunk replacement timing.
Local Next source inspection found `serve-static.js` delegates to a file stream,
and enabled compression removes Content-Length. A file change between stat and
streaming could therefore produce a clean short response, but the actual rewrite
has not been observed. Capture Content-Encoding/Content-Length, stream completion
and chunk size/mtime together before changing delivery behavior.

The abandoned test lock named PID 37128. A live process inventory proved that
owner absent; the exact lock was preserved as
`data/kw-evaluation/.m2-0069-setup.lock.stale-37128-20260921233432` before continuing.
Setup and assessment acceptance are registered in one test file so the full
suite does not create artificial contention on their shared operation lock.

No real setup/assessment approval, real migration, prospect request, provider
action, deployment, email or paid spend occurred. Production/staging were not
inspected; automation remains off or unverified. C$50/month and zero paid
mailboxes remain the limits. M2 remains incomplete; M3 has not started.
The retained M1 fresh4 database, website checkpoint and owner report SHA-256
values still match the prior verified checkpoint.

The next three actions are:

1. Resolve the captured owner-UI truncated-response failure and repeat the
   isolated browser gate with retained attribution if it fails.
2. Complete the website-only review branch for partial/research-required HTML
   results and integrate the dedicated M2 owner view into the console.
3. Complete exact-ten orchestration and retain a synthetic evaluation packet,
   including research-only/blocked outcomes, before preparing the separately
   approved real one-then-ten evaluation; no real packet is approved yet.

## Prior legacy/M2 reader compatibility checkpoint

**Updated:** 2026-09-21 (America/Toronto). **Work cycle:** M2 Task 5 legacy/M2
reader compatibility. The verified code checkpoint is `52f9009`
(`fix(revenue): isolate HTML evidence from legacy assessments`), based on
`0e5558d`. This following update only records that checkpoint identity.

## M2 assessment partition compatibility checkpoint

Ordinary owner readers now inspect the actual schema before selecting evidence.
Pre-0069 databases retain their existing behavior. On 0069, website and
qualification selection, contact routes, verification, history and contact
review use explicit legacy partitions. Partial or malformed metadata and
introspection failures stop the read; there is no error-to-legacy fallback.

The legacy assessment writer/reloader now includes partition values in exact
row comparisons and explicitly writes `LEGACY` on 0069. Collision queries
remain broad: an M2 row with a matching ID or alternate key is a conflict, not
a missing record. Regression tests first reproduced acceptance of mislabeled
rows and partial schema; both now reject without writes. Tests retain old
0061 fixtures and exercise both 0068 and 0069 commit/replay/reload.

Root implemented the assessment boundary and reviewed Luna's bounded owner-reader
changes. The first reader patch was rejected for unqualified SQL aliases and
missing real-database coverage. Luna corrected the predicates; root added the
complete in-memory SQLite integration regression. It proves an existing dossier
is unchanged after newer HTML website, qualification, contact and verification
rows arrive; HTML-only businesses are excluded; history remains unchanged;
metadata errors propagate; and reads leave the database bytes unchanged.
These constructed projection fixtures do not claim an implemented M2 writer.

[ADR 0043](adr/0043-separate-setup-baseline-from-assessment-state.md) resolves
the Task 5 design conflict between initial setup hashes and legitimate writes.
The initial verifier remains strict. The planned successor verifier will compare
the full database against the verified backup, exact migration and authenticated
deterministic assessment plans. This is an accepted design, not an implemented
successor runner. Task 5's local design F6 now reflects that distinction.

| Check | Result |
|---|---|
| Targeted assessment and reader regressions | PASS, including actual 0068/0069 SQLite reader execution |
| `npm run check:safety` | PASS |
| `npm test` | PASS, 627 total, 624 passed, 0 failed, 3 Windows symlink-privilege skips |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |
| `npm run build:cloudflare` | PASS, 2,018 files scanned, 0 local secret values |
| Wrangler deployment dry run | PASS, no upload |
| `npm run test:owner-ui` | Isolated repeat PASS, list 377 ms, dossier 484 ms, widths 1440/390, 6 WCAG pages, 0 external requests |

The initial full suite had 13 failures because the older assessment-progress
fake boundary returned no schema metadata. That fixture now explicitly describes
its legacy columns; all 13 affected tests pass. No production fallback was added.

The first UI attempt recorded one `SyntaxError: Invalid or unexpected token`
during `/leads` warmup, with no script URL or stack. Its server requests returned
200 and both builds had already exited, so build overlap is not established as
the cause. Failure evidence remains in
`output/playwright/owner-ui-4512-1790031568836`. One isolated repeat after the full
suite exited passed without browser errors. No UI code or acceptance assertion
was weakened. The intermittent warmup error is unresolved; if it recurs, capture
the failing asset before claiming a cause. It is not evidence of a live release.

No real setup release, migration, prospect request, provider action, deployment,
email or paid spend occurred. Production/staging were not inspected or changed;
automation remains off or unverified. C$50/month and zero paid mailboxes remain
the limits. The retained M1 fresh4 database/checkpoint/report hashes still match.

The next three concrete actions are:

1. Implement Task 5's real HTML assessment plan/writer with double source reload
   and the accepted baseline/successor checks; verify first write, replay,
   second business, restart and unauthorized drift.
2. Complete the dedicated HTML owner projection and exact-ten orchestration
   against synthetic receipt-backed fixtures.
3. Prepare the exact real candidate/owner packet and setup release for the
   supervised one-then-ten gate. M2 remains incomplete; M3 has not started.

## Prior M2 local setup runner checkpoint (`d19e344`)

The local runner now applies exactly migration 0069 in one immediate transaction,
compares the complete result with an independently migrated in-memory backup,
reopens the database, repeats the restore drill and publishes the v2 setup
receipt last. The receipt includes typed logical preservation proof and exact
physical identities. Verification and replay reload current artifacts rather
than trusting a caller-supplied success object.

`npm run kw:prepare-m2-database` defaults to preflight. `--apply` requires the
recorded current setup release. `--verify` reloads the exact setup proof.
`--rollback` requires a separate recorded owner decision for the inspected
suspect, backup, quarantine and rollback receipt. No command grants itself
approval. See the [runbook](RUNBOOK.md#m2-local-database-setup-and-recovery) and
[ADR 0042](adr/0042-transactional-local-setup-and-approved-recovery.md).

Root implemented and integrated the runner. Luna implemented only the bounded
receipt/rollback contract and its tests; another Luna reviewed the combined
diff. Root strengthened recovery after the review identified a missing-source
interruption. Tests force failures after quarantine publication, after source
removal and before rollback receipt publication; each resumes from verified
evidence under the separately approved rollback. The original required-source
preflight failed the missing-path regression before the recovery rule passed.

A failure before commit verifies the original source bytes and rows. A failure
after commit intentionally remains unreceipted, keeps source and backup, and
requires the separate recovery decision. It never infers setup success or
automatically restores without approval. The recovery review's concern about
unverified restored contents was checked against `buildReceipt`: it compares
the complete restored logical snapshot to the approved backup and verifies
quarantine identity before publication. No extra authority follows from merely
finding a quarantine file.

| Check | Result |
|---|---|
| Focused integration suite | PASS — 21 passed, 1 Windows symlink skip |
| Added recovery/post-commit cases | PASS — 4 passed; missing-source regression also observed failing before recovery fix |
| `npm run check:safety` | PASS |
| `npm test` | PASS — 619 total, 616 passed, 0 failed, 3 Windows symlink-privilege skips |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS — no warnings |
| `npm run build:cloudflare` | PASS — 2,018 files scanned, 0 local secret values |
| `npx wrangler deploy --env="" --dry-run --autoconfig false` | PASS — no upload; generated duplicate-options warnings nonblocking |
| `npm run test:owner-ui` | PASS — list 400 ms, dossier 881 ms; widths 1440/390; 6 WCAG pages; 0 external requests |

The real CLI is exercised by the synthetic setup/replay test. No deploy, build
or dry run was active when the owner UI test started. M1 fresh4 database,
website-checkpoint and report hashes still match the retained verification.

All execution in this cycle used synthetic local fixtures. No real owner setup
release or persistent real M2 setup receipt was created; no real migration,
prospect request, provider action, deployment, email or paid spend occurred.
Production and staging were not inspected. Automation remains off or unverified.
Runtime remains capped at C$50/month, paid mailboxes and Workspace remain out
of scope, and the rebuilt M1 fresh4 checkpoint remains the retained M1 evidence.

The next three concrete actions are:

1. Correct Task 5's setup-baseline/write-replay interface, then implement its
   double source-materialization preflight and legacy/M2 reader compatibility.
2. Complete the HTML-only assessment writer/replay and Task 6's exact-ten
   orchestration against synthetic receipt-backed fixtures.
3. Prepare the exact real candidate/owner packet and setup release for the
   separate supervised one-then-ten gate. M2 is not complete; M3 has not started.

The handoff audit found a concrete Task 5 plan defect: its current design checks
the immutable setup file SHA before and after legitimate assessment writes,
which necessarily change that file. Its domain-row replay rules do not resolve
the conflict. The unchanged setup baseline must remain a strict initial gate;
later authorized writes need their own independently verified durable-state
checks. Resolve this interface before Task 5 execution rather than weakening
the setup verifier or treating legitimate writes as forgery.

## Prior M2 backup and restore-drill checkpoint (`42eebd3`)

The bounded backup function now requires a live canonical preflight session
and holds the cooperative lock handle for its entire operation. It rereads
approval and source identity, backs up a read-only SQLite snapshot, publishes
without overwriting a conflicting target, and restores into a separate private
temporary directory for independent verification. CLI behavior remains
preflight-only. This completes the synthetic backup/drill prerequisite, not
Task 8, M2, a real setup release, or migration 0069.

[ADR 0041](adr/0041-verify-local-backups-by-logical-snapshot.md) records the
verified SQLite behavior: logically equal backups can have different physical
hashes. Validation therefore compares full schema and all-table content digests
while retaining each file's separate physical identity and hash. Tests cover
non-Revenue rows and integer, real, text, blob, and null values.

Independent Luna review identified reusable sessions after cleanup failure,
missing temporary-output tests, and stale byte-equality wording. Root fixed the
lifecycle defect and the related incomplete-backup failure with failing-then-
passing regressions, integrated the bounded Luna tests, and corrected the design.
Incomplete output or cleanup failure preserves evidence and requires a fresh
session. The lock assumes cooperative processes in an owner-only directory;
the later mutation runner still requires its separate release review.

| Check on this code checkpoint | Result |
|---|---|
| Focused backup and snapshot tests | PASS — 14 total, 13 passed, 1 Windows symlink-privilege skip |
| `npm run check:safety` | PASS |
| `npm test` | PASS — 610 total, 607 passed, 0 failed, 3 Windows symlink-privilege skips |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS — no warnings |
| `npm run build:cloudflare` | PASS — 2,018 files sanitized, 0 local secret values |
| `npx wrangler deploy --env="" --dry-run --autoconfig false` | PASS — no upload; generated duplicate-`options` warnings nonblocking |
| `npm run test:owner-ui` | PASS — list 429 ms, dossier 827 ms; widths 1440/390; 6 WCAG pages; 0 external requests |

The previous M1 fresh4 synthetic evidence is retained; website checkpoint,
report and database SHA-256 values still match the recorded proof. Two private temporary
directories from an earlier failed test-harness cleanup remain as local failure
evidence (`.m2-setup-3c1cf8e...` and `.m2-setup-43f4aef2...`); the corrected
tests clean only their observed owned paths, and the successful path asserts
that it leaves no new temporary directory. No shared-root cleanup is used.

Production and staging were not inspected or changed. This checkpoint used
synthetic local databases only; no real setup envelope, migration, receipt,
provider action, prospect request, deployment, message, or paid spend occurred.
Production automation remains off or unverified. The C$50/month ceiling and
zero-paid-mailbox decision remain: Cloudflare Email Routing inbound with a
separately gated free outbound/reply candidate; no Google Workspace.

The next three concrete actions are:

1. Complete Task 8's separately reviewed 0069 transaction, receipt-last
   publication and rollback runner, then obtain the real local setup gate.
2. Implement Task 5's double source-materialization preflight, legacy/M2 reader
   compatibility and HTML-only assessment against the verified setup receipt.
3. Complete Task 6 orchestration and the exact ten-business owner packet before
   a supervised one-then-ten real-source operation. M3 has not started.

## Prior M2 local prerequisite checkpoint (`a77ccc8`)

The Task 4 website evidence reloader is independently **APPROVED** at
`211c41c`. It authenticates the bounded pathless Task 3 durable website
evidence with current Task 1 approval, read-only replay, and zero network or
write authority. It does not authenticate a caller-supplied source
materialization claim. Task 5 must independently reload and compare the exact
source materialization before and after this evidence reload and before any
assessment write.

The Task 8 additive migration 0069 and canonical `0054-0069` release/receipt
contract are independently **APPROVED as a schema/contract slice** at
`581fdbe`. The local setup preflight/lock is separately **APPROVED as a
preflight slice** through `a77ccc8`: it validates the canonical recorded
release envelope, bounded paths, target identities, sidecar absence, and
exclusive cooperative lock, then exits without opening SQLite or applying a
migration. The remaining lock-release `lstat`/`unlink` interval assumes
cooperative processes; a stronger ownership primitive is needed before a
real mutation runner uses the lock. The executable backup, separate restore
drill, migration application, receipt publication, and rollback runner remain
**unimplemented and unapproved**. No real owner setup envelope or database
setup receipt was created.

| Check on `a77ccc8` | Result |
|---|---|
| Independent Task 8 schema and preflight reviews | APPROVED for their bounded slices only |
| `npm run check:safety` | PASS |
| `npm test` | PASS — 599 total, 597 passed, 0 failed, 2 Windows symlink-privilege skips |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS — one unused type-import warning, no errors |
| `npm run build:cloudflare` | PASS — 2,018 files sanitized, 0 local secret values |
| `npx wrangler deploy --env="" --dry-run --autoconfig false` | PASS — no upload; generated duplicate-`options` warnings nonblocking |
| `npm run test:owner-ui` | PASS — desktop list 369 ms, dossier 1,221 ms, widths 1440/390, 6 WCAG pages, 0 external requests |

The owner UI fixture now deliberately applies legacy migrations through 0068
(`d742fc6`) because its legacy contact writer exact-checks that partition;
Task 5 must separately implement ordinary-reader compatibility for 0069.
This checkpoint is local/offline only. Production and staging were not
inspected or changed. Automation, follow-ups, provider operations, deployment,
real migration, outreach, and send remain off or unverified. No real prospect
request or paid spend occurred. Runtime remains capped at C$50/month and the
zero-paid-mailbox decision remains: Cloudflare Email Routing inbound with a
separately gated free Resend or owner-only reply candidate, no Workspace.

The preflight test originally contained an unsafe shared-directory cleanup
which removed the ignored local M1 synthetic checkpoint files. This was found
in review, repaired in `b42094a` and `a77ccc8`, and the test now cleans only
its own identity-checked direct-child files. The old checkpoint identities
below are historical evidence, not retained files. A new synthetic M1
checkpoint was independently rebuilt and verified below; neither incident
nor rebuild touched production or a real prospect database.

The next three concrete actions are:

1. Implement and independently review Task 8's gated local backup, separate
   restore drill, 0069 transaction, receipt-last publication, and rollback
   runner; strengthen lock ownership before any real setup action.
2. Implement Task 5's double read-only source-materialization preflight,
   legacy/M2 reader partition, HTML-only assessment writer and replay against
   an independently verified Task 8 local setup receipt.
3. Complete Task 6 orchestration and the exact ten-business owner decision
   packet before any supervised one-then-ten real-source operation.

## M2 Task 4 checkpoint

Task 4 is **APPROVED for the bounded local HTML-only implementation** after
independent review of `f131bbe` (`fix(revenue): close M2 receipt trust seams`).
The earlier review rounds rejected incomplete replay, expiry, policy, and
receipt-storage boundaries; the accepted tree closes those findings. The
workflow requires the exact Task 1 owner-approved chain, uses the Task 2
address-pinned transport and canonical robots policy, and writes only through
the conditional Task 3 local evidence store. It retains the complete transport
and source-policy proof, exact raw-byte digests, a four-page maximum, and
conservative HTML-only availability observations. It does not create a
qualification, contact, consent, outreach, or send decision. Sealed replay
requires current approval and independently reloaded durable page or blocked
evidence; failures without a durable witness remain unsealed in-memory results.

| Check on accepted tree | Result |
|---|---|
| Independent Task 4 review | APPROVED on `f131bbe` |
| `npm run check:safety` | PASS |
| `npm test` | PASS — 580 total, 578 passed, 0 failed, 2 Windows symlink-privilege skips |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |
| `npm run build:cloudflare` | PASS — 2,018 files sanitized, 0 local secret values |
| `npx wrangler deploy --env="" --dry-run --autoconfig false` | PASS — no upload; generated duplicate-`options` warnings were nonblocking |
| `npm run test:owner-ui` | PASS — desktop list 389 ms, dossier 496 ms, widths 1440/390, 6 WCAG pages, 0 external requests |

The root also ran an affected focused suite after the accepted commit: 54
total, 53 passed, 0 failed, and one Windows symlink-privilege skip. The
independent reviewer ran its broader affected suite: 64 total, 63 passed,
0 failed, and one such skip. The full suite result above was recorded on the
same accepted code by the implementation agent; the root's full suite on its
preceding repair was also green. The final build, dry run, safety, typecheck,
lint, focused tests, and owner UI were run by the root on `f131bbe`.

Task 5's design is independently **APPROVED, execution blocked on its setup
prerequisite**. The design is retained in ignored local planning artifacts.
The trusted Task 4 receipt reloader is now approved above. Task 5 still
requires its own independent source-materialization preflight and the
separately applied, independently verified local migration 0069 with a matching
`0054-0069` database setup receipt. It must return a zero-write
`EXTERNAL_BLOCKER` until those proofs exist; it does not create or migrate a
database. Task 6
orchestration and the exact ten-business owner packet remain ahead of any
supervised real-source run. No real business was captured in this checkpoint.

Production and staging were not inspected or changed. Automation, follow-ups,
contact review, provider operations, deployment, migration, outreach, and send
remain off or unverified as applicable. This checkpoint made no live prospect
request, provider/account/DNS change, database migration, deployment, send,
or spend; runtime remains capped at C$50/month. The zero-paid-mailbox decision
remains in force: Cloudflare Email Routing inbound and separately gated free
Resend or free owner-only outbound/reply are the only mail candidates. There
is no Google Workspace or paid-mailbox path in scope.

At the earlier Task 4 checkpoint, the next three actions were:

1. Specify, implement, and independently review the trusted Task 4 durable
   receipt reloader for Task 5's input boundary, with zero-network replay tests.
2. Prepare Task 8's migration 0069 and local setup/backup/rollback evidence
   under its separate release gate; do not apply a remote migration.
3. Implement Task 5's HTML-only, zero-authority assessment materialization
   against those exact prerequisites, then prepare Task 6 and the exact
   ten-business owner decision packet. The current next actions are listed at
   the top of this document.

## M2 foundation checkpoint

The verified M2 foundation checkpoint is the exact committed tree at
`65cb2d5` (`fix(revenue): reconcile M2 policy receipts`). The three bounded
foundation gates are approved:

| Foundation | Result |
|---|---|
| Task 1 authorization chain | **APPROVED** — canonical Task 1 authorization and owner-envelope binding are required before publication. |
| Task 2 address-pinned transport and robots policy | **APPROVED** — DNS classification, direct-IP transport, Host/SNI binding, redirect and body limits, robots policy, abort disposal, and immutable receipts are enforced. |
| Task 3 conditional evidence store | **APPROVED** — publication is conditional on the canonical authorization, source-policy decision, complete receipt chain, and verified filesystem identity. |

The complete checkpoint verification sequence was:

| Check | Result |
|---|---|
| `npm run check:safety` | PASS |
| `npm test` | PASS — 565 total, 563 passed, 0 failed, 2 skipped; both skips are Windows symlink-privilege cases |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |
| `npm run build:cloudflare` | PASS — 2018 files sanitized, 0 local secret values |
| `npx wrangler deploy --env="" --dry-run --autoconfig false` | PASS — no upload; generated duplicate-options warnings were nonblocking |
| `npm run test:owner-ui` | PASS — desktop list 382 ms, dossier 568 ms, widths 1440/390, WCAG pages 6, external requests 0 |

Current production, staging, and automation state is unchanged and off. This
checkpoint performed no network, provider, DNS, database, migration,
deployment, send, or spend action. Authority, cost, network, provider,
outreach, and send remain zero/off as applicable, and
`contactReview.status` remains `NOT_RECORDED`.

The zero-cost mailbox decision remains a hard gate: there are **zero paid
mailbox seats**. The only in-scope mail paths are Cloudflare Email Routing for
inbound forwarding and a separately gated Resend Free or separately reviewed
free owner-only send-as path for outbound/reply. If those free paths cannot
satisfy reply ownership and privacy gates, mail activation remains blocked.
Paid mailboxes and Workspace are out of scope unless Riley explicitly reverses
that decision.

The foundation gate covered only local M2 prerequisites. The Task 4 gate above
adds bounded HTML-only composition, without authorizing real-business capture.
The remaining real-run blockers are the Task 5/6/8 implementation and setup
proofs, an exact-ten research packet with rights and owner approval, and
supervised one-then-ten business execution.

## Owner-facing state

M1 again has one fresh ignored local synthetic dossier produced through the actual
`npm run kw:execute-m1-dossier` CLI. This is a **new** checkpoint with new
identities after the unsafe test cleanup removed the earlier ignored artifact
set. The first run used the canonical source,
materialization, manifest, and assessment invocation inputs and wrote the real
local website checkpoint, assessment checkpoint, report, and SQLite state. An
unchanged second run used the same paths and IDs and replayed all stages exactly.

The retained artifact set is under
`data/kw-evaluation/m1-checkpoint-2026-09-21-b42094a-fresh4-*`:

- [source plan](../data/kw-evaluation/m1-checkpoint-2026-09-21-b42094a-fresh4-source.json),
  [materialization](../data/kw-evaluation/m1-checkpoint-2026-09-21-b42094a-fresh4-materialization.json),
  [manifest](../data/kw-evaluation/m1-checkpoint-2026-09-21-b42094a-fresh4-manifest.json),
  and [assessment invocation](../data/kw-evaluation/m1-checkpoint-2026-09-21-b42094a-fresh4-invocation.json);
- [website checkpoint](../data/kw-evaluation/m1-checkpoint-2026-09-21-b42094a-fresh4-website-checkpoint.json),
  [assessment checkpoint](../data/kw-evaluation/m1-checkpoint-2026-09-21-b42094a-fresh4-assessment-checkpoint.json),
  [report](../data/kw-evaluation/m1-checkpoint-2026-09-21-b42094a-fresh4-report.json), and
  [SQLite database](../data/kw-evaluation/m1-checkpoint-2026-09-21-b42094a-fresh4.sqlite);
- [first CLI stdout](../data/kw-evaluation/m1-checkpoint-2026-09-21-b42094a-fresh4-first.stdout.json),
  [second CLI stdout](../data/kw-evaluation/m1-checkpoint-2026-09-21-b42094a-fresh4-second.stdout.json),
  and the [machine-readable verification receipt](../data/kw-evaluation/m1-checkpoint-2026-09-21-b42094a-fresh4-verification.json).

The retained receipt independently verifies exact byte hashes before and after
replay, complete `Revenue*` row-count maps, stable IDs/digests, first-run fresh
paths, second-run `EXACT_REPLAY` paths, and zero second-run assessment inserts.
The exact durable identities are:

| Artifact | ID | Digest |
|---|---|---|
| Website checkpoint | `kw-shadow-progress:e504f554cb36efbb997bb3f0eafd1a9112913fe6bdb7558b91330bfde78b174d` | `e504f554cb36efbb997bb3f0eafd1a9112913fe6bdb7558b91330bfde78b174d` |
| Assessment checkpoint | `kw-shadow-progress:ccd76cab505200be50ec2f72eaf73b9366e53e458e442e96fdde38b73826a3dc` | `ccd76cab505200be50ec2f72eaf73b9366e53e458e442e96fdde38b73826a3dc` |
| Assessment receipt | `assessment:5ee2e8e059b43543497260bad3d773aa163cc9798cd301e94f6a70cc3272172a` | `f7d3994ec9a1dfccd6b1b1549534813e0adc759e9c6daa8931e63a3e4a80f982` |
| M1 report | `private-kw-m1-dossier:2bb5f58830ec14c947d300dcaaedfda924e3256ea18939d6187309c2e358fc3b` | `2bb5f58830ec14c947d300dcaaedfda924e3256ea18939d6187309c2e358fc3b` |

## Completed gate

The local M1 checkpoint gate is complete for the bounded synthetic case. The
first CLI result reported fresh source and eligibility commits, a fresh
assessment commit, and fresh writes for both progress checkpoints and the
report. The identical retry reported `EXACT_REPLAY` for all six paths and zero
`websiteSnapshots`, `evidenceClaims`, `qualificationSnapshots`, and
`assessmentReceipts` in `assessmentInsertedRows`. The complete independent
`Revenue*` count map and all retained output/database SHA-256 hashes were equal
before and after replay.

The report authority is `synthetic=true`, `fixtureOnly=true`,
`workerRuntimeConnected=false`, `networkOperationsPerformed=0`,
`providerOperationsAuthorized=0`, contact discovery and verification false,
consent false, qualification false, outreach false, send false,
`costAuthorizedUsd=0`, and `contactReview.state=NOT_RECORDED`. The one true
`localAssessmentMutationAuthorized` flag covers only the explicitly approved
local shadow SQLite write. No provider, network, mailbox, prospect, deployment,
remote migration, outreach, send, or spend action occurred.

The root checkpoint owner completed the final M1 verification sequence on the
exact committed candidate `fe921824439cda6b485cf11966977d30829d7133`:

| Check | Result |
|---|---|
| `npm run check:safety` | PASS |
| `npm test` | PASS — 511 passed, 0 failed, 1 skipped, 512 total; the skip is the Windows developer-mode symlink privilege case |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |
| `npm run build:cloudflare` | PASS — bundle sanitizer removed 0 local secret values and scanned 2018 files |
| `npx wrangler deploy --env="" --dry-run --autoconfig false` | PASS — no upload after the custom rebuild; generated-bundle duplicate `options` warnings were non-blocking |
| `npm run test:owner-ui` | PASS — desktop list 854 ms, dossier 464 ms, widths 1440/390, WCAG pages 6, external requests 0 |

M1 is complete for the bounded synthetic offline scope. The verification
sequence confirms the local implementation, build safety, dry-run packaging,
and owner UI acceptance; it does not establish a live acquisition loop or
real-business readiness.

## Production, staging, and automation

Production and staging were not inspected or changed. The Worker remains
disconnected, automation and follow-ups remain off, and no provider, mailbox,
source account, contact system, or spend capability is verified. The M1 artifact
does not establish real-business evidence, production or staging readiness, or
M2 readiness. The runtime ceiling remains C$50/month and this checkpoint spent
zero dollars.

Public DNS was inspected read-only on 2026-09-21. `getaxiom.ca` publishes the
Cloudflare Email Routing MX set (`route1/2/3.mx.cloudflare.net`), Cloudflare SPF,
DMARC quarantine, and a Resend domain-verification token. This supports the
zero-paid-mailbox target of Cloudflare inbound forwarding to existing owner
destinations plus a separately gated Resend outbound/reply adapter. It does not
prove active Cloudflare destinations/rules, a Resend account or API key, sender
verification, complete DKIM (two `resend._domainkey` TXT values are ambiguous),
or send readiness. No DNS/provider/account mutation or mail operation occurred.

## Owner decisions and blockers

Owner decision recorded: the mail architecture has zero paid mailbox seats.
Cloudflare Email Routing remains the inbound route and gated Resend Free or a
separately reviewed free owner-only send-as route are the only outbound/reply
options in scope. If those zero-cost routes cannot satisfy reply ownership or
privacy gates, mail activation remains blocked; paid mailboxes and Workspace
are out of scope unless Riley explicitly reverses this decision.
Before any real-source work, the owner must separately decide the source and
privacy scope, accounts and rights, backup/rollback plan, and the exact release
gate. M2 is blocked by the absence of an authorized real-source evidence packet,
verified provider and mailbox readiness, live runtime proof, an owner-approved
ten-business research cohort, and the separate contact/consent/reply gates.
M4 also remains blocked on verified Cloudflare destination ownership/rules,
Resend domain/key/webhook readiness or a separately reviewed free owner-only
send-as route, legal sender identity, suppression/unsubscribe handling, and
sink-tested human-triggered replies. Cloudflare forwarding cannot itself send
replies from the custom domain; legacy Gmail OAuth/send/sync remains quarantined
from the v2 target.

## M1 verification result

The exact-commit M1 verification gate is complete for the synthetic offline
scope. The retained artifact proves only the bounded local path and its
replay/restart behavior. Production, staging, provider, contact, outreach,
deployment, and spend facts remain unknown or off as stated above.

## Next three concrete actions

1. Prepare M2's owner decision packet for real-source rights, privacy, accounts,
   backup/rollback, ten-business scope, and the explicit release gate without
   activating any provider or contact path.
2. Record the owner's approval or rejection of the M2 release and activation
   gates, including provider, contact, privacy, and budget decisions, without
   activating any capability.
3. If M2 is approved, implement and verify its bounded capability packet while
   keeping provider, contact, deployment, outreach, send, and spend actions
   separately gated.
