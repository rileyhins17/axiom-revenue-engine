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
- Validation-only private KW persistence checkpoint:
  `4d7d9a608b42b09db599cc4f813d8f1fbd062d8b`
- Browser evidence-contract checkpoint:
  `99e37fa2c04fd095013f1200acfa99d90922c8c7`
- Browser evidence documentation/CI checkpoint:
  `30424528b920ec535641282035428661e057a2d7`
- Fixture Browser-measurement source checkpoint:
  `44a65c966841d3a92bf99c14559d2ad85dda87dd`
- Fixture Browser-measurement documentation/CI checkpoint:
  `a4d73fa89b1072fdd7803cd6c2276fe8fe830676`
- Content-addressed artifact-contract source checkpoint:
  `2621f3c1a790516507a78d89ea3ae06e7e738722`
- Content-addressed artifact documentation/CI checkpoint:
  `e77f613d78306c3bc5dd076ed6e46a00527884f2`
- Multi-page website-audit assembly source checkpoint:
  `347390aebb15d5e97caa2d5caa0e6ceda1ad5f12`
- Multi-page website-audit assembly documentation/CI checkpoint:
  `7a6ac24a905030095de766364bee01d140f3675a`
- Artifact lifecycle source checkpoint:
  `7bdabe0316108bb4b24d450ee29e93cac70ed593`
- Artifact lifecycle documentation/CI checkpoint:
  `3892c9b3dc8d5f43871ceb73f05f9ce156d287b0`
- Deterministic website page-selection source checkpoint:
  `0165a0a6a304b06f7bbc09766c2572d3459054fc`
- Deterministic website page-selection documentation/CI checkpoint:
  `f3b3812a93a962658edc259810a202b32f63247f`
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
- A second guarded local command now converts a validated private KW import plan
  into deterministic schema-0054 preflights and insert-if-absent statements for
  only source runs, businesses, locations, and source records. Every statement
  has an exact expected-state fingerprint so an identity collision or data drift
  is visible before a later release-gated write can be considered idempotent.
- The persistence artifact is explicitly `mutationAuthorized: false`; there is
  no database executor, D1/Cloudflare/provider access, qualification row, contact
  row, outreach row, or spend path. Tests apply its SQL only to a disposable
  in-memory database. Real evaluation progress remains 0/50.
- Validation-only persistence checkpoint verification passes 209/209 tests,
  typecheck, zero-warning lint, safety checks, secret-sanitized console build,
  explicit console dry run, deterministic engine type check, and engine dry run.
- Linux CI run `32556171801` passed all 13 gates on persistence documentation
  commit `420e1ba`.
- A versioned Browser Rendering evidence contract now fixes comparable desktop
  and mobile viewports, binds screenshots and measurements to artifact references
  and SHA-256 digests, records coverage separately for layout/actions/forms/
  navigation/text, and rejects cross-business, cross-page, cross-URL, duplicate-
  viewport, malformed-artifact, and stale unreachable-site contamination.
- Server HTML and browser measurements now merge conservatively. Missing,
  failed, or partial browser work remains `UNKNOWN`; a screenshot alone cannot
  become a website defect. The deterministic website audit advanced to v2 so
  content/page-set completeness and visual coverage decide whether absence is a
  supported failure or an owner-review gap.
- Browser evidence remains fixture-only and disconnected from the new engine
  Worker. No new engine Browser or R2 binding, session, request, artifact write,
  provider cost, live website capture, database write, qualification, or outreach
  occurred. The checkpoint passes 215/215 tests, typecheck, zero-warning lint,
  safety checks, the secret-sanitized console build and dry run, deterministic
  engine bindings, and the inert engine dry run.
- Linux CI run `32557669210` passed all 13 gates on browser evidence checkpoint
  `3042452`, including a clean Ubuntu build, all migrations, 215/215 tests, and
  both no-upload Worker validations.
- A fixture-only Browser measurement adapter now converts an injected runner
  result into a bounded, zero-cost, unpersisted draft. Requests use fixed
  desktop/mobile profiles and caps for navigation time, browser time, observed
  requests, screenshot bytes, measurement JSON, and redirects.
- Every document/redirect URL must remain canonical and public. The runner
  receipt proves request interception and URL validation while forbidding
  credentials, private-network access, form submission, downloads, service
  workers, and cache reuse. Direct evidence validation repeats the public-URL
  guard so callers cannot bypass the adapter.
- Finalization recomputes artifact byte lengths and SHA-256 digests and accepts
  only exact content-addressed references. Version 1 accepts `FIXTURE` runners
  only, has no Browser/R2 imports or bindings, grants no artifact-write authority,
  and spends nothing. No website, provider, database, or prospect was touched.
- Fixture measurement checkpoint verification passes 220/220 tests, typecheck,
  zero-warning lint, safety checks, the secret-sanitized console build, explicit
  default console no-upload dry run, deterministic engine bindings, and the inert
  engine no-upload dry run. The console dry run still reports only the known
  generated duplicate-key warnings documented for the legacy UI bundle.
- Linux CI run `32558784285` passed all 13 gates on fixture measurement checkpoint
  `a4d73fa`, including exact dependency installation, a clean Ubuntu Cloudflare
  build, all migrations, 220/220 tests, and both no-upload Worker validations.
- A fixture-only artifact-store contract now derives private Standard-storage
  object keys from retention class, artifact kind, digest prefix, full SHA-256,
  and media type. Plans remain shadow-only, provider-write unauthorized, capped,
  and zero-cost; no R2 type, binding, bucket, API, or provider method is reachable.
- Create-if-absent retries reuse an existing object only after its key, length,
  digest, storage class, HTTP metadata, and custom metadata all match. Conflict or
  partial failure creates a bounded failure receipt and cannot produce Browser
  evidence references. Content-addressed partial objects are kept for safe retry
  rather than deleted and are later handled by prefix lifecycle.
- Planned automatic retention is 30 days for shadow evidence and 180 days for
  uncontacted qualification evidence. Outreach-active and legal-hold evidence
  have no guessed expiry and require owner/compliance release; current CRTC
  guidance says CASL does not prescribe one universal record-retention period.
- Artifact-contract checkpoint verification passes 228/228 tests, typecheck,
  zero-warning lint, safety checks, the secret-sanitized console build, explicit
  default console no-upload dry run, deterministic engine bindings, and the inert
  engine no-upload dry run. No Cloudflare resource was created or changed.
- Linux CI run `32559645916` passed all 13 gates on artifact-contract checkpoint
  `e77f613`, including exact dependencies, a clean Ubuntu Cloudflare build, all
  migrations, 228/228 tests, and both no-upload Worker validations.
- A fixture-only assembler now links captured pages, HTML facts, Browser
  measurements, and completed content-addressed artifact receipts into one
  deterministic website-audit input. It rejects stale, cross-site, duplicate,
  over-budget, future-dated, mismatched, and noncanonical evidence before audit.
- A full page set requires current home, service, about, and contact coverage,
  complete desktop action/form facts on every selected page, and a fully measured
  mobile homepage. Missing, failed, or incomplete coverage is reported as partial
  and the deterministic audit v3 keeps unseen form absence `UNKNOWN`.
- Business-level limits are fixed at five pages, six Browser captures, 120
  Browser seconds, 30 MiB of artifacts, 5 MiB of HTML, 24-hour freshness, and
  two-hour maximum capture skew. The assembler remains fixture-only with zero
  provider operations and zero cost; no website, R2 object, database, prospect,
  or production resource was touched.
- Multi-page assembly checkpoint verification passes 235/235 tests, typecheck,
  zero-warning lint, the repository safety check, secret-sanitized Cloudflare
  build, explicit default console no-upload dry run, deterministic engine
  bindings, and the inert engine no-upload dry run. The console build reports
  only the known generated duplicate-key warnings documented for the legacy UI.
- Linux CI run `32560819780` passed all 13 gates on multi-page assembly
  checkpoint `7a6ac24`, including exact dependencies, a clean Ubuntu Cloudflare
  build, all 55 migrations, 235/235 tests, and both no-upload Worker validations.
- Artifact manifests can now be derived only from completed write/promotion
  receipts. Qualification, outreach/consent/touch, and legal-hold uses compute the
  minimum retention needed; promotion can move only upward and preserves the
  exact content hash while changing its retention prefix and metadata.
- The fixture promotion executor verifies the source manifest, performs
  create-if-absent copies, reconciles existing targets, and emits bounded success
  or partial-failure receipts without rollback deletion. A later promotion can
  safely move qualification evidence to outreach protection and then legal hold.
- Content-bound owner/compliance release records require every known use, exact
  confirmation, a class-specific reason, rationale, actor, and decision digest.
  They never authorize or perform provider deletion; a future deletion path must
  recheck live references and pass another explicit release gate. No R2 binding,
  object, provider operation, database write, prospect, or production resource
  was touched.
- Artifact-lifecycle checkpoint verification passes 244/244 tests, typecheck,
  zero-warning lint, the repository safety check, secret-sanitized Cloudflare
  build, explicit default console no-upload dry run, deterministic engine
  bindings, and the inert engine no-upload dry run. The console build reports
  only the known generated duplicate-key warnings documented for the legacy UI.
- Linux CI run `32562059951` passed all 13 gates on artifact-lifecycle checkpoint
  `3892c9b`, including exact dependencies, a clean Ubuntu Cloudflare build, all
  55 migrations, 244/244 tests, and both no-upload Worker validations.
- A deterministic page selector now turns fresh homepage link facts into one
  unique home/service/about/contact capture plan. It scores all subpage roles
  together, favours the business's expected services and niche, and records each
  candidate's scores, eligibility, selection, and reasons in stable order.
- Query URLs, homepage duplicates, non-HTML files, policy/blog/news/resource,
  careers, account/commerce, FAQ, financing/rebate/promotion, off-site, reserved,
  noncanonical, stale, and future-dated inputs cannot become selected pages.
  Incomplete homepage extraction or a missing role remains `PARTIAL`; the planner
  never improvises another crawl target.
- Version 1 is deterministic fixture-only work with zero provider operations and
  zero cost. It is not wired to capture, Browser Rendering, R2, D1, the engine
  Worker, a live website, or a prospect.
- Page-selection checkpoint verification passes 251/251 tests, typecheck,
  zero-warning lint, the repository safety check, secret-sanitized Cloudflare
  build, explicit default console no-upload dry run, deterministic engine
  bindings, and the inert engine no-upload dry run. The console build reports
  only the known generated duplicate-key warnings documented for the legacy UI.
- Linux CI run `32563067858` passed all 13 gates on page-selection checkpoint
  `f3b3812`, including exact dependencies, a clean Ubuntu Cloudflare build, all
  55 migrations, 251/251 tests, and both no-upload Worker validations.

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
- Validation-only KW persistence: deterministic schema-bound preflights and
  insert-if-absent plans, collision/drift detection, ignored no-overwrite output,
  and in-memory migration compatibility/idempotency coverage with no executor.
- Browser evidence boundary: fixed viewports, bounded measurement schemas,
  artifact digests, explicit coverage, conservative HTML merge rules, and audit
  v2 unknown-state semantics with no live Browser/R2 wiring.
- Fixture Browser measurement boundary: injected fixture runner, public-only
  redirect/network receipts, strict execution/payload limits, in-memory artifact
  drafts, and content-hash finalization with safety-check enforcement.
- Content-addressed artifact boundary: deterministic private keys and lifecycle
  prefixes, create-if-absent idempotency, exact stored-object reconciliation,
  no-delete retry receipts, and zero provider authority with fixture-only tests.
- Multi-page audit assembly: required page-set coverage, same-business/site and
  artifact-receipt reconciliation, evidence freshness/skew, whole-business
  budgets, deterministic ordering, and audit v3 incomplete-coverage semantics.
- Artifact lifecycle boundary: receipt-derived manifests, evidence-use-driven
  monotonic retention, idempotent copy/reuse/failure receipts, exact plan
  reconciliation, and owner/compliance release records with no delete authority.
- Deterministic page selection: fresh same-authority homepage inputs, explainable
  role/relevance scoring, global unique assignment, explicit noise exclusions,
  stable receipts, and partial-state handling with no provider authority.

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
The planned R2 contract uses Standard storage, whose current included allowance
is 10 GB-month plus one million writes and ten million reads monthly, but R2 is
not activated and the project has incurred zero artifact-storage cost.

## Blockers / owner actions

- Recreate and secure `riley@getaxiom.ca` and `aidan@getaxiom.ca` in Google
  Workspace; verify send/receive, MFA, SPF, DKIM, DMARC, and recovery ownership.
- Confirm who owns replies for each mailbox before the pilot.
- Later: label the first 50 KW leads strong/weak/wrong with a short reason.
- R2 activation currently requires a Cloudflare dashboard decision. Approve only
  if the account shows it fits inside the existing C$50 ceiling; no R2 resource
  or charge has been created yet.

## Next three actions

1. Compose capture, extraction, page selection, Browser drafts, artifact receipts,
   and audit assembly into one bounded fixture-only business workflow receipt.
2. Define additive manifest, promotion, evidence-use, selection, and release
   persistence records before a live artifact adapter can be connected.
3. Design the separately release-gated Cloudflare Browser/R2 staging adapters and
   smoke test; do not add a binding or make a live request until R2, budget,
   rollback, and owner approval gates are recorded.

## Resume instructions

Read `AGENTS.md`, `docs/OWNER_CONTEXT.md`, this file, `docs/MASTER_PLAN.md`, and
`docs/GOTCHAS.md`; verify Git status and branch; then start with the first pending
action above. Do not infer live production state from this document if it is more
than one work cycle old—verify it read-only.
