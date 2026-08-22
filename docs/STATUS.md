# Current status

Last updated: 2026-08-22 (America/Toronto)

## Plain-English status

The real repository has been recovered into the local workspace, renamed to
`rileyhins17/axiom-revenue-engine`, and made private. The foundation gate is green
locally and on Linux. Production has now been inventoried and backed up: legacy
email/intake work is stopped, the redundant master database switch is off, and
the legacy five-minute cron was removed so a paused engine no longer writes an
empty run every five minutes. The rebuild console is live only in isolated
staging; no rebuild code or migration has been deployed to production.

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
- Cloudflare bundle-safety checkpoint:
  `ab5621cae3d463f935883705bd324ca92ef7e938`
- Staging binding-refresh checkpoint:
  `e68ac403b8fbd49005438c33554253962340b545`
- Inert engine/workflow checkpoint:
  `5d3ef6a30467db85234b0860b243587dd31084a4`
- Deterministic website-quality checkpoint:
  `ea7ff1a35302c927c0c26bf6008d05692d77a2be`
- Bounded public-website capture checkpoint:
  `5c372091ace34f68596ebbadb59fe66727f66e8e`
- Private KW seed-preparation checkpoint:
  `f0d0378c7dffb34a41637165539424bb98b88ccd`
- Bounded HTML fact-extraction checkpoint:
  `fe8fb659c01982a2e82d1c7b8bcbc1d6065eea8e`
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
- The staging console is live from source commit `7725098`, current version
  `941b37bc-38e8-4c6c-9111-d475e9871727`, with only a fresh
  `BETTER_AUTH_SECRET`. Sign-in returns 200, protected automation health returns
  401 without a session, and staging still has zero runs and zero sends.
- Linux CI run `32550535144` failed only at generated-binding drift. Commit
  `e68ac40` regenerated the expected staging URL unions, intake cap zero, removal
  of the legacy self-binding, and `StagingEnv` interface. Replacement Linux CI
  run `32551436311` passed every step on commit `3f28acd`.
- A separate engine Worker and two-step durable Workflow scaffold now exist with
  stable adapter and receipt contracts. They have no queue, schedule, route,
  D1/R2/Browser binding, provider credential, or nonzero budget. Local `/health`
  returns `503 LOCKED`; a POST action returns 404. Nothing was deployed.
- Wrangler is pinned to `4.125.0`, and both generated binding files use its
  current workerd runtime. The complete checkpoint gate passes with 171/171
  tests, deterministic console/engine bindings, typecheck, zero-warning lint,
  a sanitized console build, and both no-upload deployment dry runs.
- Expanded Linux CI run `32552447874` passed all 13 console/engine steps on
  commit `7c11ec0`, including the isolated engine type and dry-run gates.
- The deterministic website-audit kernel now classifies modern, weak, broken,
  missing, and mobile-failing sites without AI. Negative findings retain URL,
  timestamp, method, confidence, artifact reference, and audit version. No live
  URL was fetched and Browser Rendering/R2 remain unattached.
- The private KW evaluation contract now enforces 50 unique owner-reviewed leads,
  at least 10 per city and niche, and at least 85% engine/owner agreement. Real
  progress remains 0/50; only synthetic test businesses are committed.
- Audit/evaluation checkpoint verification passes 182/182 tests, typecheck,
  zero-warning lint, safety checks, secret-sanitized console build, explicit
  console dry run, deterministic engine type check, and engine dry run.
- Linux CI run `32553187482` passed all 13 gates on audit documentation commit
  `df394b1`.
- The public-website capture boundary now accepts only canonical public HTTP(S)
  domain targets on standard ports, manually revalidates every redirect, limits
  a capture to five redirects, ten seconds, and 1 MiB of HTML, and records
  rejected/failed states without turning them into evidence. IP targets,
  credentials, local/reserved names, non-HTML, loops, oversized responses, and
  timeouts fail closed.
- Cloudflare `global_fetch_strictly_public` is mandatory for the engine and is
  enforced by the repository safety check. The adapter transport is injected in
  tests and is not called by the inert Worker; no real business website was
  fetched.
- Public-capture checkpoint verification passes 193/193 tests, typecheck,
  zero-warning lint, safety checks, secret-sanitized console build, explicit
  console dry run, deterministic engine type check, and engine dry run.
- A private seed-preparation command now turns up to 50 manually researched or
  legacy-read-only KW businesses into a versioned ignored plan. It normalizes
  public URLs, names, Canadian phones/postal codes, locations, city/niche cohort
  runs, and stable identity/source IDs; likely duplicates fail closed.
- Seed plans are research-only, zero-cost, and explicitly cannot qualify or
  contact anyone. The command cannot use Cloudflare/providers and cannot write
  outside `data/kw-evaluation/` or overwrite an existing plan. Real progress is
  still 0/50 because no prospect data was committed or acquired.
- The complete test glob previously omitted TypeScript tests in `scripts/`.
  That is corrected and enforced by the safety checker. The private-import
  checkpoint passes 200/200 tests and the complete local release gate.
- Linux CI run `32554761048` passed all 13 gates on private-import documentation
  commit `7cf0ec4`, including the newly enforced TypeScript script tests.
- A versioned streaming HTML extractor now turns captured fixture HTML into
  bounded metadata, visible text, actions, forms, trust markers, structured-data
  types, and internal page links. It never executes scripts and blocks unsafe
  navigation/form destinations.
- Token, visible-text, JSON-LD, and output limits prevent unbounded parsing.
  Above-the-fold and computed visibility remain explicitly unknown until Browser
  Rendering proves them; truncated extraction is marked incomplete. No live site
  or provider was called. The checkpoint passes 204/204 tests, `npm audit` with
  zero vulnerabilities, and the complete local release gate.

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

Phase 1 — durable project foundation (in progress), with the first Phase 2 domain
slice implemented in shadow-only code.

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
- Inert typed engine: versioned Workflow input/receipt contracts, stable source,
  audit, contact, verification, and mailbox adapter interfaces, two durable
  fail-closed steps, generated bindings, safety tests, and CI dry-run coverage.
- Deterministic website audit: bounded typed inputs, 18 visible checks, four
  opportunity classes, evidence traceability, unknown-state handling, and tests
  for modern, weak, unreachable, missing, mobile-failing, and minor sites.
- KW evaluation gate: private-data contract, duplicate protection, balance
  requirements, owner reasons, 85% agreement calculation, and owner guide.
- Public website capture boundary: canonical public targets, redirect-by-redirect
  validation, bounded HTML/time, explicit failure states, generated Cloudflare
  types, and fake-network safety tests.
- Private KW source/identity seed: ignored no-overwrite storage, strict input and
  plan schemas, stable multi-signal identities, cohort provenance, duplicate and
  market guards, and zero qualification/outreach authority.
- Bounded HTML facts: standards-based streaming parse, non-executing scripts,
  strict token/text/JSON-LD limits, safe URL resolution, explicit unknown visual
  state, and adversarial fixture coverage.

Still required for Phase 1:

- The protected production environment and manual workflow are configured, but
  Cloudflare deployment credentials remain intentionally absent and production
  deploy is not approved. GitHub required reviewers are unavailable for this
  private repository on the current plan; `main` restriction plus exact SHA,
  backup reference, and approval phrase are the no-cost gates.
- Remaining staging resources: R2 and deployment of the typed engine Workflow.
  The source scaffold is complete but intentionally has no live resource or
  consumer. The console, D1, and job/DLQ Queues are complete and isolated.
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

1. Push the bounded HTML fact-extraction checkpoint and verify Linux CI.
2. Add a repeatable, validation-only persistence plan for the private seed; do
   not write staging/production D1 or acquire paid data until that gate is
   separately verified.
3. Define the Browser Rendering evidence contract and fixture merge rules before
   attaching a Browser or R2 binding to the engine.

## Resume instructions

Read `AGENTS.md`, `docs/OWNER_CONTEXT.md`, this file, `docs/MASTER_PLAN.md`, and
`docs/GOTCHAS.md`; verify Git status and branch; then start with the first pending
action above. Do not infer live production state from this document if it is more
than one work cycle old—verify it read-only.
