# Operator and release runbook

> Readiness update (2026-09-20): procedures below describe existing guarded
> mechanisms and historical release requirements; they do not establish that
> accounts, provider keys, current deployments or new runtime flows are ready.
> Use [STATUS](STATUS.md) for current verification and failures and
> [DELIVERY_PLAN](DELIVERY_PLAN.md) for sequencing. Master Plan v2 does not
> activate any command, change an approval phrase, or grant a release gate.
> Future simplified owner operations must preserve these authority boundaries
> until separately reviewed implementations replace them.

## Emergency stop

1. Use the visible emergency stop in System/Outreach.
2. Verify global intake, queue, send, and follow-up states are off in both runtime
   configuration and the database.
3. Verify no workflow or queue consumer can send; do not trust the UI label alone.
4. Record the timestamp, reason, affected campaign/mailbox, and last confirmed
   outbound event in `docs/STATUS.md` or the incident record.
5. Do not re-enable until the root cause, affected records, and duplicate-send risk
   are known and the owner approves.

## Safe work-cycle start

1. Read the files listed in `AGENTS.md`.
2. Run `git status --short --branch` and inspect recent commits.
3. Verify current production state read-only if the task touches production.
4. Choose one bounded milestone and state its exit gate.
5. Run the closest targeted test before editing to establish the current result.

## Release gate

1. Confirm the diff contains no secret or untracked owner data.
2. Confirm every autonomous default is off and `npm run check:safety` passes.
3. Back up D1 before any remote migration; record export location and checksum.
4. Run test, typecheck, lint, the secret-sanitizing Cloudflare build, and Wrangler
   dry run on Linux CI. A bundle secret-scan failure is a hard stop.
5. Deploy staging; use test providers/mail sinks only.
6. Exercise owner flows, workflow retry/idempotency, cost stop, and rollback.
7. Record exact versions/config/resources and obtain production approval.
8. Deploy through the protected GitHub production environment.
9. Verify real health without sending: auth, database, workflows, mailbox read-only
   health, logs, and current safety state.
10. Update STATUS, release history, ADR/gotchas, and rollback instructions.

## Database migration

- Never edit an applied migration.
- Create a new numbered migration that can run once and be safely detected later.
- Test a fresh local database and a copy of representative legacy data.
- Backfill with repeatable commands; preserve historical uncertainty explicitly.
- Reconcile lead, send, reply, suppression, opportunity, client, and cost totals.
- Keep legacy tables/resources through the 30-day stability window.

## Review legacy contact history offline before v2 outreach

This is a local M4 review report, not an import, send gate, or release. No
production snapshot has been processed by the current implementation. Obtain
any real snapshot through a separately approved backup/export and retention
decision; never point this command at a live D1 file, a provider, or an inbox.

1. Place one standalone SQLite copy directly under ignored `data/`. It must
   contain the legacy contact-history tables and current v2 business/stop
   tables, with no `-wal`, `-shm`, or `-journal` sidecars. Keep the copy private.
2. Choose and record the exact UTC as-of time for the review. Run:

   ```powershell
   npx tsx scripts/report-legacy-v2-history.ts --database data/legacy-v2-snapshot.sqlite --as-of 2026-09-22T12:00:00.000Z --output data/legacy-v2-report.json
   ```

   Replace the example time and filenames with the actual reviewed snapshot.
   The output is created once; an existing output is never overwritten.
3. Check the snapshot and schema digests, table counts, candidate identities,
   per-business blockers, source event references, and unresolved reasons. A
   missing or incompatible table, malformed timestamp, changed file, or
   ambiguous history is a stop for review, not evidence of no prior contact.
   The required-column check and schema digest do not prove the migration
   ledger or origin of a real snapshot; verify those separately before relying
   on the report for a release decision.
4. Record owner dispositions outside the report. This command cannot approve
   a merge, lift a stop, infer consent, import data, or authorize a message.
   Keep the snapshot/report until an explicit private-retention decision is
   made; do not treat the example date as a deletion schedule.

See [ADR 0047](adr/0047-reconcile-legacy-contact-history-offline-before-v2-outreach.md).

## Prepare an isolated staging console release

This procedure identifies one exact candidate for the existing isolated console.
It does not deploy it.

1. Confirm the candidate is already committed, pushed, and locally release-gated.
2. Run the explicit staging no-upload check:

   ```powershell
   npx wrangler deploy --env staging --dry-run --autoconfig false
   ```

   Confirm it names only `axiom-revenue-engine-staging`, Browser, assets, the
   staging URL, and fail-closed zero/off variables. Stop on a production D1,
   service, queue, cron, provider secret, or nonzero autonomous cap.
3. Assemble a committed content-addressed packet under
   `docs/releases/staging/`. It must bind the exact commit/tree/source blobs,
   target resources, local checks, prior staging version, rollback action, and
   every remaining gate. Its authority block stays false/zero.
4. Verify the packet from local Git objects:

   ```powershell
   npm run staging:verify-console-release -- docs/releases/staging/<packet>.json
   ```

5. Push the packet and require Linux CI to verify the same committed candidate.
6. Stop. A later deployment requires Riley's or Aidan's separate exact approval
   phrase `DEPLOY AXIOM REVENUE ENGINE CONSOLE TO ISOLATED STAGING`, bound to the
   packet digest. Do not infer approval from the packet, this runbook, prior chat,
   implementation approval, or a green CI run.

This gate excludes migrations, R2, the engine Worker, Workflows, Queues,
providers, external website capture, real-business data, mailboxes, prospect
contact, and spend.

## Runtime budget response

- At 70% of C$50: warn Riley and show the largest cost drivers.
- At 85%: pause discretionary discovery/audit refresh work.
- At 100%: stop all nonessential provider jobs. Never auto-enable overages.
- Safety, suppression, unsubscribe, and inbound reply handling remain operational.

## Staging R2 activation

Use [`runbooks/STAGING_R2_ACTIVATION.md`](runbooks/STAGING_R2_ACTIVATION.md).
It requires a separate owner approval, current dashboard pricing, an isolated
staging binding, synthetic data only, recorded provider operations/cost, and a
targeted rollback. It does not authorize production, prospect evidence, remote
D1 migrations, or autonomous work.

## Prepare the bounded ten-business KW shadow slice

This creates the durable scope for the first real-business integration proof. It
does not execute any phase of the pipeline.

1. Keep the exact prepared source plan, owner-reviewed selection, and generated
   manifest as three different direct children of ignored
   `data/kw-evaluation/` storage.
2. Select exactly ten businesses already present in the source plan. Each must
   be manually confirmed as the correct independent business in Kitchener,
   Waterloo, or Cambridge and in roofing, HVAC, or landscaping. Source evidence
   must be no more than 90 days old.
3. Keep at least two businesses from each city and each niche. The selection
   file must bind the source-plan digest, exact business/candidate IDs, reviewer,
   review time, rationale, and the contract's all-false/zero authority block.
4. Prepare the no-overwrite manifest:

   ```powershell
   npm run kw:prepare-shadow-slice -- --source-plan data/kw-evaluation/plan.json --selection data/kw-evaluation/shadow-slice-selection.json --output data/kw-evaluation/shadow-slice-manifest.json
   ```

5. Confirm the output says ten selected/manual/independent businesses,
   `SOURCE_REVIEWED`, and
   `SOURCE_WORKFLOW_MATERIALIZATION_APPROVAL`. Confirm all five ordered phases
   require separate approval and none is authorized by the manifest.
6. Stop on stale evidence, duplicate identity, source-plan drift, imbalance, or
   an unconfirmed/unknown chain status. Never loosen the manifest to make a
   candidate fit.

The manifest cannot read or write a database, call a provider, capture a site,
infer consent, change qualification, deploy, send, or spend. Populate it with
real records only after the separate private-research decision. Each later phase
uses its own gate below; never treat this manifest as batch-execution approval.

### Record one completed shadow phase without losing progress

Record progress only after the phase's existing approval, execution, exact
reload, and receipt verification have succeeded. This command does not perform
those steps.

For the first `SOURCE_WORKFLOW` phase, never hand-author the normalized receipt.
After `kw:materialize-source-workflow` reports a sealed exact result, prepare it
from the same reviewed inputs and ignored local database:

```powershell
npm run kw:prepare-source-workflow-progress -- --manifest data/kw-evaluation/shadow-slice-manifest.json --source-plan data/kw-evaluation/plan.json --materialization data/kw-evaluation/materialization.json --database data/kw-evaluation/shadow.sqlite --output data/kw-evaluation/source-workflow-phase-receipt.json
```

This adapter opens SQLite read-only and query-only, re-derives the approved
materialization, rejects a non-canonical schema, and requires every expected
source/workflow row plus the sealed terminal workflow and materialization
receipts to match exactly. It produces proof for the recorder; it neither
executes nor approves materialization.

1. Keep the immutable manifest, source plan, materialization approval, local
   database, normalized phase-receipt input, previous
   checkpoint, and next checkpoint as different ignored files.
2. For the first completed source/workflow phase, omit `--previous`:

   ```powershell
   npm run kw:record-shadow-progress -- --manifest data/kw-evaluation/shadow-slice-manifest.json --receipt data/kw-evaluation/source-workflow-phase-receipt.json --output data/kw-evaluation/shadow-progress-001.json
   ```

   For every later append, use the exact latest checkpoint:

   ```powershell
   npm run kw:record-shadow-progress -- --manifest data/kw-evaluation/shadow-slice-manifest.json --previous data/kw-evaluation/shadow-progress-current.json --receipt data/kw-evaluation/shadow-phase-receipt.json --output data/kw-evaluation/shadow-progress-next.json
   ```

3. Confirm only the named business advanced one phase and that the output names
   the previous checkpoint, exact predecessor phase receipt, upstream receipt
   IDs/digests, current checkpoint, and next separate gate.
4. Promote the new output to “current” by reference or filename convention; do
   not overwrite or edit either checkpoint. A later task must resume from the
   exact latest content-derived checkpoint.
5. Stop on a skipped phase, wrong predecessor, reused upstream receipt,
   cross-business evidence, manifest drift, time reversal, digest mismatch, or
   unknown proof type. Never redigest or hand-repair a failed checkpoint.

The recorder reads and writes bounded ignored JSON only. It cannot inspect or
mutate a database, validate a provider call, execute Browser Rendering, infer
consent, change qualification, contact a prospect, deploy, send, or spend. A
checkpoint proves only that exact already-verified receipts were recorded.

The `CURRENT_WEBSITE_EVIDENCE` proof contract is a synthetic-only engineering
boundary, not an operator command. Its builder can validate the
exact manifest/predecessor lineage, a complete fixture website workflow,
desktop and mobile homepage evidence, the deterministic audit, the durable
persistence plan, every screenshot/measurement manifest, and fresh fixture
availability observations. Its authority block forbids Browser, R2, database,
progress, provider, contact, deployment, send, and spend operations. The
progress recorder additionally requires a separate content-addressed
`website-evidence-eligibility:*` receipt.

The validation-only eligibility builder can now create that receipt only from
one exact frozen in-process private D1 completeness execution per artifact
manifest. Every execution must be a fresh commit, match the same persisted
terminal workflow/business/audit and complete manifest forest, and contain a
current verified `R2_HEAD` availability receipt for its exact content-addressed
screenshot/measurement manifest. The builder freezes its output and tags the
exact in-process instance; a copied or hand-addressed JSON receipt is not trusted
provenance even when its schema and digest are valid.

The durable eligibility persistence/reload boundary now exists in schema 0068,
but it is deliberately not an operator command or runtime connection. It accepts
a new row only from the exact in-process eligibility result, commits and reloads
that row atomically, and later verifies the canonical stored receipt from its
content-derived ID/digest. Every reload uses the database clock and labels the
receipt `NOT_YET_CURRENT`, `CURRENT`, or `STALE`; historical storage never
refreshes evidence. Copied result envelopes cannot cross the new private trusted
reload guard.

Never hand-author, copy, or use an eligibility receipt to advance a real
business. The validation-only phase-input adapter accepts only the exact
in-process `CURRENT` result returned by a `DURABLE_RELOAD`; a fresh commit,
exact replay, copied result, stale receipt, wrong manifest, wrong predecessor,
proof drift, or false chronology fails closed. Its frozen output is still only
a normalized zero-authority input: the adapter does not call the progress
appender or create a phase receipt/checkpoint.

The separate guarded append boundary accepts only that exact module-private
input with the manifest and content-addressed parent checkpoint used to derive
it. A content-equivalent reloaded parent is valid; any redigested change anywhere
in the ten-business checkpoint is not. The boundary calls the canonical
appender, independently verifies that exactly one website-evidence receipt and
no other business changed, deeply freezes the result, and returns the same
checkpoint object on an identical in-process retry. It does not itself write a
file or database. The integrated local M1 dossier command below composes this
boundary with the real local website writer and persists its bounded checkpoint;
it does not create a live binding. Live capture, R2 activation/HEAD reads,
Cloudflare D1 execution, applying schema 0068 to a real database, and real
business progress remain separate future approvals and implementations.

The `ASSESSMENT` proof contract is also an engineering boundary rather than an
operator command. Its private D1 loader starts from only the assessment ID and
digest, verifies every migration-0061 immutable trigger, reads the database
clock, reloads the exact receipt, sealed terminal workflow source, business,
website snapshot, complete evidence set, and qualification snapshot, then
rebuilds the assessment deterministically. Every canonical row must match and
freshness must be `CURRENT`. The result is deeply frozen and trusted only by
exact in-process identity; copied or hand-authored JSON, immediate commit/replay
responses, missing guards, source drift, row drift, and stale history fail
closed.

The proof builder accepts only that exact current durable reload and uses its D1
clock as proof time. It binds those facts to the exact completed
current-website-evidence phase in one `assessment-proof:*`. The progress recorder
requires the separate proof reference, while the integrated local M1 dossier
command uses the canonical assessment writer and local SQLite reload to build
the owner dossier. Never hand-author either the durable reload or proof. There
is no Worker import, live D1 binding, or real-business path. The loader and
integrated command authorize only the bounded local shadow assessment mutation;
they do not authorize qualification execution, contact work, provider use,
deployment, outreach, send, or spend.

## Owner-approved local KW materialization and assessment

This procedure is local shadow evaluation only. Source/workflow materialization
and assessment are two different owner decisions. Neither authorizes capture,
contact discovery/verification, outreach, providers, staging, production,
deployment, or a migration.

1. Keep the prepared source plan, source/workflow approval, assessment
   invocation, and SQLite database as different direct children of ignored
   `data/kw-evaluation/` storage.
2. Confirm the local database already has the canonical migrations 0054–0068.
   Database creation/migration is a separate developer setup step; neither
   command below may create or migrate it. Never point either command at Wrangler
   state or a remote database.
3. Review the source-plan counts and one candidate's identity plus deterministic
   audit input. The source/workflow approval must bind their exact digests, use
   its own confirmation phrase, and reach SQLite within five minutes. Execute:

   ```powershell
   npm run kw:materialize-source-workflow -- --source-plan data/kw-evaluation/plan.json --materialization data/kw-evaluation/materialization.json --database data/kw-evaluation/shadow.sqlite
   ```

4. Expect `FRESH_COMMIT` once and `EXACT_REPLAY` on an unchanged retry. The
   command must report a sealed workflow receipt but no assessment. Stop on a
   hidden identity collision, stale approval, deterministic-input drift,
   non-canonical schema, partial receipt, or failed exact reload; never repair it
   by editing SQLite.
5. Separately review the candidate's business-fit/timing evidence, scores, and
   policy blocks. Bind the assessment invocation to the sealed receipt from step
   3, use the different assessment confirmation, and submit its current timestamp
   within the assessment writer's five-minute window. Execute:

   ```powershell
   npm run kw:execute-assessment -- --source-plan data/kw-evaluation/plan.json --invocation data/kw-evaluation/assessment.json --database data/kw-evaluation/shadow.sqlite
   ```

6. Expect `FRESH_COMMIT` once and `EXACT_REPLAY` on an unchanged retry. Stop on
   `MISSING`, `CONFLICT`, source-plan drift, any non-canonical Revenue table,
   index or trigger, stale time, or an unsealed receipt; do not work around the
   gate by editing SQLite.
7. Verify the owner reader shows the new assessment with reachability zero and
   route `RESEARCH`. No provider cost or external action should exist.

## Integrated local M1 offline dossier

This is the retained owner-checkpoint procedure for one synthetic business. It
composes the source materialization, current website evidence/eligibility
writer, assessment writer, owner dossier reader, two progress checkpoints, and
report writer through the actual `kw:execute-m1-dossier` CLI. It runs against a
new local SQLite database with the canonical private-KW migrations already
applied. The CLI itself does not create or migrate the database.

Keep each input, checkpoint, report, SQLite database, stdout capture, and
verification receipt as a separate ignored direct child of
`data/kw-evaluation/`. Use canonical synthetic fixture builders to create the
source plan, materialization, manifest, and assessment invocation. The fixture
builder's timestamp relationship must be exact: `fixture now` equals assessment
`assessedAt` minus 3.8 minutes. The selected business and evaluation candidate
must match the invocation and manifest.

The following is the recorded `2026-09-21` fresh synthetic checkpoint command.
Its eligibility clock is bounded; to execute a new checkpoint, generate new
fixture inputs with a new suffix and current timestamps, then run the resulting
command twice with identical paths and IDs. Do not re-use the deleted earlier
`96a0277` artifact identity.

```powershell
npm run kw:execute-m1-dossier -- --source-plan data/kw-evaluation/m1-checkpoint-2026-09-21-b42094a-fresh4-source.json --materialization data/kw-evaluation/m1-checkpoint-2026-09-21-b42094a-fresh4-materialization.json --manifest data/kw-evaluation/m1-checkpoint-2026-09-21-b42094a-fresh4-manifest.json --invocation data/kw-evaluation/m1-checkpoint-2026-09-21-b42094a-fresh4-invocation.json --website-checkpoint data/kw-evaluation/m1-checkpoint-2026-09-21-b42094a-fresh4-website-checkpoint.json --assessment-checkpoint data/kw-evaluation/m1-checkpoint-2026-09-21-b42094a-fresh4-assessment-checkpoint.json --report data/kw-evaluation/m1-checkpoint-2026-09-21-b42094a-fresh4-report.json --database data/kw-evaluation/m1-checkpoint-2026-09-21-b42094a-fresh4.sqlite --business-id business:d4d99cc1cfb327216db2655e --evaluation-candidate-id evaluation-candidate:7027717d3b1760239bd62191
```

Capture each stdout stream separately. The first result must report
`FRESH_COMMIT` for website source and eligibility, `FRESH_COMMIT` for
assessment, and `FRESH_WRITE` for both checkpoints and the report. The second
result must report `EXACT_REPLAY` for all six paths and zero values for every
assessment `insertedRows` field. Independently compare the website checkpoint,
assessment checkpoint, report, and SQLite bytes/counts before and after the
retry; retain those hashes in a machine-readable verification receipt.

The report must retain `fixtureOnly=true`, `synthetic=true`,
`workerRuntimeConnected=false`, zero network/provider operations,
`contactReview.state=NOT_RECORDED`, all contact/consent/qualification/outreach/
send authority false, and `costAuthorizedUsd=0`. The one true local assessment
mutation flag authorizes only the explicitly approved synthetic SQLite write.
This procedure contacts no provider or prospect, performs no network operation,
does not deploy or migrate remotely, and spends nothing. It does not establish
real-business evidence, staging/production readiness, or M2 readiness.

## Local contact persistence boundary

This procedure can preserve owner-reviewed fixture contact evidence beside one
exact assessed lead. It does not run live discovery or verification and does not
authorize CASL consent, qualification changes, outreach, providers, staging,
production, deployment, or migration.

1. Keep the source plan, contact draft, generated review, final approval, and
   `.sqlite` database as different direct children of ignored
   `data/kw-evaluation/` storage. The source/workflow and assessment procedures
   above must already have completed for the exact business.
2. Confirm the database already has canonical migrations 0054–0068. Neither
   command creates or migrates it, and neither accepts Wrangler or remote state.
3. Prepare the owner-readable review:

   ```powershell
   npm run kw:prepare-contact-review -- --source-plan data/kw-evaluation/plan.json --draft data/kw-evaluation/contact-draft.json --database data/kw-evaluation/shadow.sqlite --output data/kw-evaluation/contact-review.json
   ```

   The command opens SQLite read-only, reconstructs the assessment from its
   sealed workflow receipt, rebuilds fixture discovery and verification from the
   observations, and creates a no-overwrite review packet. Confirm its business,
   assessment, evidence sources/times, contact values, route status, and
   `UNASSESSED` consent state. It must not change any database count.
4. Riley or Aidan must create a different approval binding the exact review,
   source-plan digest, assessment receipt/digest, persistence-plan digest, every
   verification result, reviewer, current timestamp, rationale, and dedicated
   contact-persistence confirmation. Do not reuse an assessment or source
   approval. Execute within five minutes:

   ```powershell
   npm run kw:persist-contacts -- --source-plan data/kw-evaluation/plan.json --review data/kw-evaluation/contact-review.json --approval data/kw-evaluation/contact-approval.json --database data/kw-evaluation/shadow.sqlite
   ```

5. Expect `FRESH_COMMIT` once and `EXACT_REPLAY` on an unchanged retry. Verify
   one immutable invocation receipt retains the full review and exact source,
   assessment, contact-materialization, discovery, verification, reviewer, and
   approval lineage. Consent and qualification counts must not increase.
6. Stop on `MISSING`, `CONFLICT`, drift, stale approval, partial or unreceipted
   history, a non-canonical schema, or failed reload. Never repair contact rows
   by hand. A final invocation-receipt failure must roll back the contact bundle.

The commands cannot contact a prospect, call a provider, spend, send, deploy, or
touch a remote database. A future live provider and CASL decision require
separate owner, privacy, budget, and release gates.

## Resumable KW owner-labelling checkpoint

This procedure records Riley's Strong/Weak/Wrong lead-quality decisions without
changing the private database or enabling any pipeline action.

1. Keep the exact source plan, existing local SQLite database, current labelling
   packet, review submission, and next packet as distinct direct children of
   ignored `data/kw-evaluation/` storage.
2. Confirm the database has canonical migrations 0054–0068 and contains the
   exact 50-business source cohort plus one sealed current assessment receipt for
   every business. The command refuses a partial cohort so completed labels can
   never be invalidated by adding leads later.
3. Prepare a no-overwrite packet from the read-only database:

   ```powershell
   npm run kw:prepare-owner-labeling -- --source-plan data/kw-evaluation/plan.json --database data/kw-evaluation/shadow.sqlite --output data/kw-evaluation/owner-labeling.json
   ```

4. Sign in to the local console, open `/leads/evaluation`, and load the prepared
   packet. Review each business identity, audit, five scores, engine label, and
   exact evidence; choose `STRONG`, `WEAK`, or `WRONG`, at least one offered
   reason, and an optional note. Partial batches are allowed. Download the review
   file when the batch is complete. Browser drafts resume only for the same
   packet digest; they are not durable system truth until step 5 records them.
5. Record the batch into a different no-overwrite checkpoint:

   ```powershell
   npm run kw:record-owner-labels -- --packet data/kw-evaluation/owner-labeling.json --reviews data/kw-evaluation/owner-reviews.json --output data/kw-evaluation/owner-labeling-next.json
   ```

6. Confirm the new packet names the prior packet as its parent and the reviewed,
   agreement, balance, and gate counts are correct. Use this new packet as the
   input for the next review batch; never edit or overwrite an older checkpoint.
7. Stop on source, assessment, packet, digest, timestamp, identity, or decision
   drift. Do not repair the checkpoint by hand.

Both commands are ignored-local only. The Quality Lab validation route is
authenticated, private/no-store, bounded to JSON, and has no database or provider
binding. Together they authorize no database mutation, provider or network
operation, acquisition, qualification change, consent
decision, outreach, sending, deployment, remote database, or spend.

## M2 research scope and current authorization preparation

The [bounded public research scope](reviews/2026-09-21-m2-public-research-scope.md)
was approved and completed on 2026-09-22. It produced ten proposed businesses
for M2 evaluation, not a calling list or ten approved assessments. Their exact
identity, city, niche and independence dispositions still need Riley's or
Aidan's review. Research notes cannot supply that owner decision. Prepare the
source plan from actual research evidence and the exact-ten manifest after
the recorded review.

The private, source-linked candidate packet is
`data/kw-evaluation/m2-public-research-2026-09-22-review.md`; the shorter
`m2-owner-identity-decision-2026-09-23.md` in the same ignored directory is
the owner decision sheet. The underlying review JSON has SHA-256
`4bf0d8c942ee253dcc4dfe965390f53f351373506e8846f4596cbde0c8a9e70c`.
Review every proposed identity, Kitchener/Waterloo/Cambridge assignment, niche
and company-stated independence claim; record the reviewer, date, correction or
keep/replace/hold decision for each ID. M2-06 and M2-10 denied access and may
remain explicitly blocked research cases; keeping either does not make it
capturable. Aidan's aggregate observation that many sites look decent has no
per-business disposition or website-fit label. A "keep" is for evaluation,
never permission to call or email. Do not turn the research JSON's `PENDING`
fields into approval, or infer ten separate decisions from an earlier
"continue." Preserve a separate decision record bound to the exact research
packet. A replacement needs an exact supported source-plan member and the
same city/niche balance; otherwise prepare a new reviewed research operation.

An admin owner can open **Businesses → Review 10 businesses** on the local
workspace. The page reads only the fixed, ignored research packet above, checks
its SHA-256, and shows the exact source links and company-stated independence
claims. It is unavailable in Cloudflare or when that packet is absent or changed.
Riley or Aidan must sign in under their own named owner account, make a separate choice for all ten,
enter reasons, and explicitly confirm identity, city/niche, and independence
where required. A browser draft resumes only against the same packet digest.
Select **Save owner decisions** after all ten are complete. The local server
validates the signed-in owner and exact packet again, then writes a new,
immutable `m2-owner-decisions-<packet>-<owner>-<decision>.json` under ignored
`data/kw-evaluation`. A retry of the same choices returns the original saved
record; a changed review becomes a separate version. Reopen the page, including
from a fresh browser, to inspect the saved choices. The local server checks the
immutable file before returning them to a named owner. If this browser has
different unsaved choices, the page preserves them and offers **Load saved
choices** rather than silently replacing them. The screen identifies whether
the visible choices are saved or still a browser draft. Download a copy only
if needed. Browser storage and a download alone are not the saved record.
Saving the ledger does not pass the later source-plan, cohort, or capture gates;
the operator still reviews and supplies the exact saved file to the preparer as
`--decisions`. The screen does not fetch candidate sites automatically;
following a source link is a separate
owner-controlled browser visit. It grants no capture or contact.

The owner identity ledger binds the exact research-review SHA-256, reviewer,
review time, and one explicit choice for every M2-01 through M2-10. It may be
recorded **before** a source import plan exists. Its `sourcePlanDigest` is
optional: if present, the preparer must match it exactly. After the decisions,
prepare and review the source import plan, including any supported replacement.
Then `npm run kw:prepare-m2-owner-decisions` takes four distinct direct-child
files under ignored `data/kw-evaluation`: `--research-review`, `--source-plan`,
`--decisions`, and `--output`. It validates the saved source plan, exact
identities, cohort balance and supported replacement membership, derives the
plan digest for the output, and writes only when the destination is new. Its
exact-ten shadow selection is plan-only with every capture, database, provider,
contact, send, deployment, and spend authority set to zero.

**Known access blocks are a hard selection boundary.** KEEP_AS_BLOCKED for
M2-06 or M2-10 can remain an honest owner decision in the separate JSON ledger,
but the preparer refuses to put either blocked site in the next-phase shadow
selection. A replacement requires a supported alternate that is also in a
reviewed import source plan; the current research packet does not by itself
establish that membership. HOLD or REJECT also leaves the exact-ten selection
incomplete. These are valid ways to account for a business in M2 review, not
reasons to silently promote it to a capturable site. A separate, reviewed
partial-cohort design is required if the owner elects to finish M2 with blocked
cases instead of finding replacements. Do not fabricate confirmations to make
the preparer pass.

The first public-research operation exhausted its candidate and search caps.
[The bounded replacement-search proposal](reviews/2026-09-23-m2-replacement-research-proposal.md)
is **pending owner approval**; it authorizes no new site opens by itself.

The authorization CLI requires an explicit review-policy JSON in addition to
the source plan and reviewed manifest. Its seven input/output paths must be
different direct children of ignored `data/kw-evaluation`. It does not infer
source rights or terms from a public URL, and it no longer uses fixed fixture
dates. The review file contains:

- `reviewVersion`: `kw-m2-authorization-review-v1`.
- `preparedAt`: the actual preparation timestamp.
- `websitePolicy`: an explicit `version`, `networkRequestCap` (1–100), and
  `expiresAt` later than preparation and still current at execution preparation.
- `researchPolicy`: the existing `kw-m2-research-policy-v1` policy with exactly
  one decision for each of the ten manifest business IDs. Each decision records
  `sourceRights`, `termsDecision`, `robotsDecision`, `evidenceRetention`,
  `retentionReviewDate` and `stopConditions` from the reviewed source policy.

Every retention-review date must still be current. Unknown or unreviewed rights
cannot be replaced with fixture defaults. Prepare only once all decisions are
supported; choose `BLOCKED` where retention is prohibited. A raw-HTML retention
decision must be explicit and separately supported. The owner must review the
exact resulting capture scope before any real HTTP request.

```powershell
npm run kw:prepare-m2-authorization -- --source-plan data/kw-evaluation/source.json --manifest data/kw-evaluation/manifest.json --review-policy data/kw-evaluation/m2-review-policy.json --research-packet data/kw-evaluation/research-packet.json --authorization data/kw-evaluation/authorization.json --owner-approval data/kw-evaluation/owner-candidate.json --mapping-policy data/kw-evaluation/fixture-mapping.json
```

The four outputs remain a pending research packet, pending execution
authorization, pending owner-decision candidate and explicitly fixture-only
mapping artifact. The last artifact is not a production assessment policy; the
assessment runner uses its separately frozen mapping and approval. This command
does not record owner approval, open a database, fetch a website, invoke a
provider or grant spending authority. Reusing the former six-path invocation
now fails closed instead of silently substituting old dates and synthetic
source-policy claims. Do not edit an expired packet; prepare a new one with
current reviewed inputs and obtain its own decision.

The first real capture is one supervised business within the reviewed ten,
followed by the remaining nine after review. Prepare one immutable request JSON
containing its request ID, actual request time, business ID and exact research
packet, authorization, owner envelope, manifest, source plan and research policy.
Keep it as a direct child of ignored `data/kw-evaluation`, at most 5 MiB. Do not
substitute the fixture mapping for the actual research policy. A pending owner
candidate is suitable only for preflight; real capture requires the separately
recorded approved envelope. The operator command accepts one request per run:

```powershell
npm run kw:capture-m2-html -- data/kw-evaluation/capture-request.json
npm run kw:capture-m2-html -- data/kw-evaluation/capture-request.json --execute
npm run kw:capture-m2-html -- data/kw-evaluation/capture-request.json --verify
```

The default is preflight. It checks the saved request and current approval chain
and distinguishes a pending owner decision from inputs ready for capture. It
does not fetch robots or pages, retain evidence, or approve anything. Input
readiness does not prove website accessibility or successful capture.

Only `--execute` calls the existing HTML evidence workflow. It uses the native
address-pinned transport and immutable local evidence stores, checks source
policy before page capture, and retains the existing request/page limits. It
rejects future request times and requires `replayMode: "NEW"`. Repeating a
completed exact request reloads its sealed evidence without repeating network
work. A dedicated `data/kw-evaluation/.m2-html-capture.lock` prevents simultaneous operator
captures; release removes only the same owned regular file. Do not remove or
replace another operation's lock to force progress.

`--verify` directly reloads sealed evidence, without a capture fallback or any
network request. Current authorization and retention checks remain in force;
verification does not renew expiry. The compact result separates request
attempts made during this invocation (`currentRequestCount`) from the saved
capture's historical count (`recordedNetworkRequestCount`). Preflight, verify
and completed exact replay report zero current requests. A failed result exits unsuccessfully;
blocked, partial and research-required outcomes remain explicit and cannot be
treated as qualification or permission to contact anyone. Preserve valid saved
evidence after a failure instead of deleting it as compensation.

No command mode creates an owner approval, changes a database, enables a
provider or deploys anything. The separate database and assessment gates below
still apply; the assessment command consumes this saved evidence and is not a
capture tool.

## M2 local database setup and recovery

The setup command requires an already recorded owner release naming an existing
canonical 0054-0068 database, exact repository commit and migration manifest,
backup, setup receipt and quarantine paths. All paths are direct children of
`data/kw-evaluation`. The command does not create an approval, create a blank
database, apply remote migrations, or enable runtime operations.

With the reviewed release recorded, these are the separate operating modes:

```powershell
npm run kw:prepare-m2-database -- data/kw-evaluation/recorded-setup-release.json
npm run kw:prepare-m2-database -- data/kw-evaluation/recorded-setup-release.json --apply
npm run kw:prepare-m2-database -- data/kw-evaluation/recorded-setup-release.json --verify
```

The first command performs preflight only. `--apply` validates backup/restore,
applies exactly 0069 in one transaction, verifies the complete expected result
after reopen, repeats the restore drill and publishes the setup receipt last.
An existing exact receipt is verified and replayed without database writes.
`--verify` independently reloads the receipt and current database/backup proof.
It verifies the unchanged setup baseline. It is not a future application health
check after authorized assessment writes; Task 5 must separately prove those
successor states before its runtime route is enabled.

For the synthetic test path, the backup function opens the source read-only,
publishes a verified backup without overwriting a conflicting destination, and
checks a restore into a separate temporary directory. Source, backup, and restore
must preserve the same logical schema and rows, including non-Revenue tables.
Each file has its own physical hash; SQLite backups can be logically identical
while having different bytes. See [ADR 0041](adr/0041-verify-local-backups-by-logical-snapshot.md).

An incomplete temporary output or cleanup failure invalidates the session.
Release its lock before obtaining a fresh preflight. Preserve unexpected files
for inspection; never recursively delete `data/kw-evaluation` or remove another
process's lock. The lock assumes cooperative processes in an owner-only local
directory. A successful restore drill proves a usable copy; the separate setup
receipt records an applied migration.

If failure occurs after commit and before a valid receipt, stop. Keep the
database, backup and temporary evidence; do not infer completion or edit a
receipt. Prepare a separate rollback release for owner review using the current
suspect identity, backup identity/logical digest, quarantine and rollback-receipt
paths. Its required confirmation is `RESTORE_M2_LOCAL_DATABASE_FROM_BACKUP`.
Only after that decision is recorded:

```powershell
npm run kw:prepare-m2-database -- data/kw-evaluation/recorded-setup-release.json --rollback data/kw-evaluation/recorded-rollback-release.json
```

Rollback preserves the suspect in quarantine before publishing the validated
restore. Repeating the same approved operation can recover interruption after
quarantine, after source removal, or before receipt publication; it revalidates
the surviving evidence first. Changed or missing backup/quarantine evidence
requires manual investigation. The old setup receipt remains immutable and
fails verification against the restored database. See
[ADR 0042](adr/0042-transactional-local-setup-and-approved-recovery.md).

The runner has been exercised only on synthetic fixtures. Real database setup
and downstream M2 execution still require their recorded release gates.

New setup executions issue a **v3 receipt** with a trusted `completedAt` captured
after migration, reopen verification and the restore drill. Its time must fall
within the recorded release window. The strict initial setup verifier still
accepts existing v2 receipts; it never invents their execution time. The HTML
assessment runner requires v3 so historical setup can be verified after release
expiry. Do not edit or upgrade an existing receipt by hand.

## M2 local HTML assessment and restart

This local command consumes completed Task 4 evidence and an existing, separately
approved v3 setup. It performs no source creation, real website request, database
migration, provider call or outreach. It writes only the canonical HTML evidence,
fixed RESEARCH projection, assessment receipt and final immutable lineage. HTML
capture does not establish visual quality, mobile usability, qualification,
contact readiness or consent.

Record a private run JSON with `runVersion: "kw-m2-html-assessment-run-v1"`,
`setupReleasePath`, `sourcePlanPath`, `manifestPath`, and an ordered `operations`
array. Each operation names one approved manifest business and has `businessId`,
`materializationPath`, `requestPath`, `candidatePath`, `approvalPath`,
`progressPath` and `reportPath`. Every JSON path must be a distinct direct child
of `data/kw-evaluation`. The source/manifest and Task 4 request must have exact
matching identities. At most ten businesses can enter the run, in its recorded
order; the first supervised business must complete before the next.

```powershell
npm run kw:assess-m2-html -- data/kw-evaluation/assessment-run.json business:reviewed-id
npm run kw:assess-m2-html -- data/kw-evaluation/assessment-run.json business:reviewed-id --record-decision data/kw-evaluation/assessment-decision.json
npm run kw:assess-m2-html -- data/kw-evaluation/assessment-run.json business:reviewed-id --execute
npm run kw:assess-m2-html -- data/kw-evaluation/assessment-run.json business:reviewed-id --verify
```

For COMPLETE evidence, the first command persists a PENDING candidate and the complete evidence context
for review. It does not approve itself. Only after an explicit owner review,
record a decision file with `approvedBy` (`RILEY` or `AIDAN`), `reviewedAt`,
`rationale`, and `confirmation: "RECORD_LOCAL_HTML_WEBSITE_FIT_ASSESSMENT"`.
The decision command binds that choice to the exact candidate. `--execute`
independently rechecks the recorded decision, source rows, Task 4 artifacts,
backup and entire expected database before one transaction. No copy of an
in-memory success result substitutes for those checks.

The runner holds the same local lock as setup/recovery. It reconstructs the
expected database in memory from the exact backup, migration and authenticated
completed assessments, including unrelated tables and every legacy row. It
reloads source rows on both sides of HTML reload, reauthenticates before writing,
and reconstructs the assessment on a fresh read-only handle before publishing
the progress receipt and owner dossier. The dossier displays `UNKNOWN`,
`NON_QUALIFYING_HTML_ONLY`, zero scores, `RESEARCH`, no channels/routes, and
`NOT_RECORDED` contact review. The ordinary legacy console does not select these
M2 rows.

`--verify` reconstructs completed evidence at its recorded execution time, so a
later approval expiry does not erase historical proof. Every fresh assessment write still
requires current approval. A completed replay leaves database bytes unchanged.
If the database committed but progress/report publication was interrupted,
`--verify` can regenerate only the exact missing output after full durable
verification. A conflicting output, changed database, copied file, partial row
set or missing evidence stops execution. The runner never repairs data or
overwrites an existing output. Initial setup verification remains strict and
will correctly reject a database that now contains successor assessment writes.

The assessment write requires a COMPLETE four-page capture. A sealed
`RESEARCH_REQUIRED` or supported `PARTIAL` outcome instead publishes an immutable research report at
`reportPath`, with the missing page kinds, capture limitations, source lineage
and `UNKNOWN` classification. It creates no candidate, approval, assessment
rows or progress receipt. Its result is `RESEARCH_REVIEW`; exact replay returns
`executionPath: "EXACT_REPLAY"`. Report construction makes zero network requests;
the report records the earlier capture's request count separately.

Sealed robots/terms or retention blocks return `BLOCKED` and the existing
blocked receipt reference. They create no report, candidate, approval, progress
or database rows. Research reports and blocked receipts can precede the next
business in the ordered run. Each is reloaded from its actual source and capture
evidence; an existing report cannot prove its own accuracy. The next assessment
binds the research report digest or blocked capture operation digest as its
previous checkpoint. These outcomes grant no permission to assess or contact.
The native store accepts a complete denied robots-policy witness for the exact
business even when its previously authorized retention was raw or derived. That
branch stores only the denial receipt. It still requires the canonical robots
URL, successful policy response, exact transport ledger and current approval
chain; raw/derived page storage continues to require an allowed policy.

Task 4 seals a v2 `PARTIAL` receipt only when each failed selected page has an
exact ordered transport witness for an HTTP error or transport failure. The
homepage and retained successful pages must still reload and verify. Failed
pages carry no content/facts references and cannot authorize an assessment.
Body-stream failures without a transport error witness, unsupported redirects,
failed homepages, storage conflicts and expired capture authority remain
unsealed. Reload rejects them with `M2_WEBSITE_RECEIPT_REPLAY_MISSING`; it never
manufactures a report. Existing COMPLETE/research/blocked receipts retain v1.

## M2 local owner research console

The admin-only `/leads/m2` Business Review presents the saved local run as a
searchable business list and one selected website review. On mobile, opening a
business hides the queue overview and the owner can return to the list.
Plain-language statuses separate
captured pages, missing research and stopped checks, while the next step and
unassessed website-fit state stay visible. Source links, page outcomes, capture
times, retention and HTML limitations remain available. Every selected business
is accounted for in the recorded order.
An assessment saved here still means UNKNOWN qualification and zero scores.
For new `DERIVED_FACTS_ONLY` captures, each captured page can also show a
bounded structural summary: title/description presence, detected action kinds,
form counts, trust signal markers and internal-link hints. Page clues are collapsed
by default so repeated parser details do not bury the owner decision. These are
HTML clues, not proof of visual placement, working controls or rebuild need. No source body,
page copy, contact details, screenshot or rendered DOM is retained by this mode.
Older receipts without the optional summary remain readable. See [ADR 0048](adr/0048-project-text-free-html-structure-into-m2-review.md).

Configure an existing run in the local Node server's ignored environment file:

```dotenv
AXIOM_M2_LOCAL_REVIEW_ENABLED=1
AXIOM_M2_LOCAL_REVIEW_RUN=data/kw-evaluation/assessment-run.json
```

Restart that local server and sign in with an existing admin account. The Leads
page links to Business Review. Do not change `DATABASE_PATH` to the M2
shadow database: normal app authentication and the research database are
separate. The fixed server-configured run path is restricted to a direct JSON
child of `data/kw-evaluation`. The browser cannot choose paths or upload reports.
The bridge is disabled by default and refuses all Cloudflare binding contexts.
It requires the repository's local Node runtime, `tsx`, Git and native SQLite.

For the same verification without the browser:

```powershell
npm run kw:assess-m2-html -- data/kw-evaluation/assessment-run.json --inspect
```

Inspection reconstructs the whole expected database and independently reloads
the canonical evidence. It creates only a transient owned operation lock; it
never prepares or approves an assessment, changes rows, or publishes missing
reports. Missing capture evidence is shown as unavailable and subsequent work
as pending. Corrupt evidence, conflicting files or unexpected database changes
fail the entire inspection. An existing operation lock also makes review
unavailable; finish or investigate that operation before retrying. Do not delete
a live operation's lock or substitute unverified report JSON.

The browser acceptance seeds ten synthetic businesses through real native
source, setup, capture and assessment writers using fake HTTP transport. A fresh
CLI process and the authenticated server then reload the default evidence stores.
Synthetic acceptance counts as zero real businesses. The real one-then-ten
capture/setup/assessment evaluation and production release remain separate gates.
Storage unit tests use unique `m2-evidence-test-<UUID>` sibling directories with
bounded cleanup. They must never clear the default `m2-evidence` directory,
which the console and native restart verification use.

## Weekly owner review (30 minutes)

1. Handle qualified replies and overdue opportunities.
2. Review top leads and manual-channel actions.
3. Approve/reject/correct the next message batch.
4. Review qualified replies, opportunities, customers, deliverability, and spend.
5. Approve or reject the one proposed targeting/scoring/message experiment.

## Resume/handoff

Before stopping, update `docs/STATUS.md` with the verified commit, production and
automation state, completed exit gate, tests, budget effect, blockers, owner
decisions, and exactly three next actions. Commit documentation with the code it
describes.
