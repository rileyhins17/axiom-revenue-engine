# Current status

Last updated: 2026-08-21 (America/Toronto)

## Plain-English status

The real repository has been recovered into the local workspace, renamed to
`rileyhins17/axiom-revenue-engine`, and made private. The foundation gate is green
locally and on Linux. Production has now been inventoried and backed up: legacy
email/intake work is stopped, the redundant master database switch is off, and
the legacy five-minute cron was removed so a paused engine no longer writes an
empty run every five minutes. No rebuild code or migration has been deployed.

## Verified checkpoint

- Branch: `RileyHinsperger/axiom-revenue-engine-rebuild`
- Baseline commit: `7d23bfa3b0ddad8322051de7d586b787fb1692d3`
- Verified foundation commit: `7afc21299320019a34b93a387b7d7acda7f74403`
- CI hardening commits: `14d85a0468bef56e2bf7a97f7e53ed521955f1da`
  and `6a03de6fe251155d7e5e8fa14b3c7f8e494c5a3b`
- Production-safety checkpoint:
  `4408a894319f786fbe416b3e50c68aa8478e5111`
- Isolated-staging configuration checkpoint:
  `23ee458a997ddfd4df48f3f1f90581a6f4df3da0`
- Repository: private `rileyhins17/axiom-revenue-engine`
- Local OpenAI key: stored in ignored `.env.local`; value never printed
- Local migrations: all 55 apply, including the fail-closed lockdown, shadow
  Revenue Engine records, and content-bound outreach approval
- Current checkpoint verification rerun 2026-08-21: 160/160 tests, typecheck,
  zero-warning lint, safety scan, all 55 local migrations, Cloudflare production
  build, and Wrangler deploy dry run pass
- OpenAI project key authentication was verified without a generation request;
  the key remains ignored and GPT-5.4 nano/mini model families are available.
- Generated Cloudflare bindings replaced the stale hand-written environment file
- Draft PR: `#8`.
- Linux CI run `32547238706` passed on clean Ubuntu: deterministic binding check,
  OpenNext Cloudflare build, all 55 migrations from scratch, 160/160 tests,
  typecheck, lint, and Wrangler deploy dry run.
- The CI fixes also removed duplicate branch/PR runs; PR work now gets one gate.
- Private D1 export completed at `2026-08-22T02:59:22Z`: ignored path
  `backups/production/20260821T2300-0400/axiom-ops-omniscient.sql`, 226,228,443
  bytes, SHA-256
  `46d60b80e099759c54522858d0ee9174d649dce5627fc8f9894b141666518dc7`.
- Post-lockdown D1 Time Travel bookmark:
  `00002ff8-00000002-000050cf-aa041de046860de5cf0527956a845930`.
- Detailed non-secret inventory: `docs/PRODUCTION_INVENTORY.md`.
- GitHub `production` environment exists and only accepts deployments originating
  from `main`. No repository/environment deployment secrets or variables exist,
  so the production workflow remains incapable of deploying.
- Isolated staging D1 plus job and dead-letter Queues are provisioned. All 55
  migrations are applied to staging, every database stop is engaged, and both
  Queues have zero producers/consumers. See `docs/STAGING_INVENTORY.md`.
- The staging configuration has no cron, no legacy self-fetch binding, zero
  autonomous caps, and cannot use Gmail or OpenAI because those secrets are absent.
- Production release inputs now require an exact 40-character commit, structured
  D1 checksum reference, exact checkout, and ancestry on `main`; targeted tests
  reject abbreviated, branch-shaped, and command-shaped inputs.
- Staging/release checkpoint verification rerun 2026-08-21: safety scan,
  168/168 tests, typecheck, lint, secret-sanitizing Cloudflare production build,
  explicit default deploy dry run, and explicit staging deploy dry run pass. The
  staging dry run exposes only the isolated D1, Browser Rendering, assets, and
  fail-closed vars.
- The first staging upload was stopped before network deployment because OpenNext
  had copied the ignored local OpenAI key into its generated environment module.
  Every Cloudflare build now empties that local fallback and scans all generated
  files; the real key was removed and the corrected default/staging dry runs pass.

## Safety and production

- Repository automation target: all autonomous switches off; follow-ups off;
  send cap zero.
- Even if send configuration is later enabled, the final Gmail call now blocks
  without an unexpired operator approval matching the exact message content.
- Production D1 is `axiom-ops-omniscient` (58 tables, about 223 MB). Remote schema
  is still at migration 0052; migrations 0053-0055 have not been applied.
- At `2026-08-22T03:03:15Z`, the single global settings row was safely corrected
  from `enabled=1` to `enabled=0`; global, emergency, intake, and follow-up pauses
  all remain `1`. This was one reversible row update after the verified export.
- No outbound email has been recorded since `2026-06-03T09:20:57Z`: 1,936 total,
  zero in the last seven days. No new scrape job has been created since June 3.
- A dormant legacy backlog remains: 472 ACTIVE and 14 QUEUED sequences with 1,537
  scheduled steps. The database stops and removed cron prevent processing.
- The deployed legacy Worker is version 683
  (`9670516c-88cb-42b3-8ec2-dc48eea7a115`, deployed 2026-08-16). Its embedded
  autonomous variables are still historically `true`, but it has no intended
  scheduled execution and every database control is off. After the full trigger
  propagation window, a read at `2026-08-22T03:18:07Z` still showed 1,695 skipped
  runs and no run newer than `2026-08-22T03:00:46Z`.
- The old cron had produced 287 zero-send SKIPPED runs in the preceding 24 hours.
  Its trigger was removed without uploading code, changing routes, or migrating
  data.
- No live email, inbox sync, prospect contact, production code deployment, or
  production database migration has been performed during this rebuild.
- Legacy Worker/database identifiers remain for rollback and data continuity.

## Current phase

Phase 1 — durable project foundation (in progress).

Completed gates:

- Local folder connected to the real GitHub history.
- GitHub repository is private and renamed.
- Rebuild branch created without rewriting `main`.
- Owner context, operating contract, master plan, and gotcha/runbook structure
  established.
- Fail-closed runtime/config/database defaults and guarded production commands.
- GitHub CI plus an approval-phrase production workflow (not yet exercised).
- Pinned OpenAI Responses provider with schema validation, retry/cost limits, and
  deterministic qualification before AI.
- Additive shadow tables for canonical businesses, evidence, contact routes,
  qualification, coverage, verification, and costs.
- Leads UI now defaults to priority and exposes a transparent legacy score split;
  it explicitly says current evidence is still required.
- Phase 0 production safety: non-secret inventory, full export/checksum, Time
  Travel bookmark, master database stop, and legacy cron removal are verified.

Still required for Phase 1:

- The protected production environment and manual workflow are configured, but
  Cloudflare deployment credentials remain intentionally absent and production
  deploy is not approved. GitHub required reviewers are unavailable for this
  private repository on the current plan; `main` restriction plus exact SHA,
  backup reference, and approval phrase are the no-cost gates.
- Remaining staging resources: console Worker, R2, and typed engine Workflow.
  D1 plus job/DLQ Queues are complete and isolated.
- Staging console Worker deployed from a recorded commit with a fresh staging-only
  auth secret and no production bindings.
- Characterization coverage retained while first v2 modules are introduced.

## Budget

Approved runtime ceiling: C$50/month excluding ChatGPT/Codex. New paid providers
or overage billing are not yet authorized. Cost ledger implementation is pending.

## Blockers / owner actions

- Recreate and secure `riley@getaxiom.ca` and `aidan@getaxiom.ca` in Google
  Workspace; verify send/receive, MFA, SPF, DKIM, DMARC, and recovery ownership.
- Confirm who owns replies for each mailbox before the pilot.
- Later: label the first 50 KW leads strong/weak/wrong with a short reason.
- R2 activation currently requires a Cloudflare dashboard decision. Approve only
  if the account shows it fits inside the existing C$50 ceiling; no R2 resource
  or charge has been created yet.

## Next three actions

1. Commit the isolated staging configuration and deploy only the staging console
   with a fresh auth secret; verify its bindings and zero schedules.
2. Resolve the R2 activation decision, then scaffold the typed engine
   Queue/Workflow worker without attaching a live consumer.
3. Implement the deterministic website evidence/audit workflow and build the
   50-lead KW evaluation set before qualification can connect to sending.

## Resume instructions

Read `AGENTS.md`, `docs/OWNER_CONTEXT.md`, this file, `docs/MASTER_PLAN.md`, and
`docs/GOTCHAS.md`; verify Git status and branch; then start with the first pending
action above. Do not infer live production state from this document if it is more
than one work cycle old—verify it read-only.
