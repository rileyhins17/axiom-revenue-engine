# Operator and release runbook

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

## Owner-approved local KW materialization and assessment

This procedure is local shadow evaluation only. Source/workflow materialization
and assessment are two different owner decisions. Neither authorizes capture,
contact discovery/verification, outreach, providers, staging, production,
deployment, or a migration.

1. Keep the prepared source plan, source/workflow approval, assessment
   invocation, and SQLite database as different direct children of ignored
   `data/kw-evaluation/` storage.
2. Confirm the local database already has the canonical migrations 0054–0067.
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

## Local contact persistence boundary

This procedure can preserve owner-reviewed fixture contact evidence beside one
exact assessed lead. It does not run live discovery or verification and does not
authorize CASL consent, qualification changes, outreach, providers, staging,
production, deployment, or migration.

1. Keep the source plan, contact draft, generated review, final approval, and
   `.sqlite` database as different direct children of ignored
   `data/kw-evaluation/` storage. The source/workflow and assessment procedures
   above must already have completed for the exact business.
2. Confirm the database already has canonical migrations 0054–0067. Neither
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
2. Confirm the database has canonical migrations 0054–0067 and contains the
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
