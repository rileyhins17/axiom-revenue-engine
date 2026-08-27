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

## Owner-approved local KW assessment

This procedure is local shadow evaluation only. It does not import source or
workflow rows and does not authorize contact discovery, outreach, providers,
staging, production, or a migration.

1. Keep the prepared source plan, owner-reviewed invocation, and SQLite database
   as direct children of ignored `data/kw-evaluation/` storage.
2. Confirm the local database already has migrations 0054–0063, the exact source
   plan rows, and the exact terminal sealed website-evidence receipt. Never point
   the command at Wrangler state or a remote database.
3. Review one candidate's identity, business-fit/timing evidence, scores, and
   policy blocks. Set `reviewedAt` and `assessedAt` to the same current timestamp,
   and use the exact confirmation documented by the invocation schema. The fresh
   assessment must reach SQLite within five minutes.
4. Execute:

   ```powershell
   npm run kw:execute-assessment -- --source-plan data/kw-evaluation/plan.json --invocation data/kw-evaluation/assessment.json --database data/kw-evaluation/shadow.sqlite
   ```

5. Expect `FRESH_COMMIT` once and `EXACT_REPLAY` on an unchanged retry. Stop on
   `MISSING`, `CONFLICT`, source-plan drift, any non-canonical Revenue table,
   index or trigger, stale time, or an unsealed receipt; do not work around the
   gate by editing SQLite.
6. Verify the owner reader shows the new assessment with reachability zero and
   route `RESEARCH`. No provider cost or external action should exist.

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
