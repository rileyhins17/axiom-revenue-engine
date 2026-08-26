# Current status

Last updated: 2026-08-26 (America/Toronto)

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
- Fixture website-evidence workflow source checkpoint:
  `1c9d093351cea3a064ba4b0bc4a4d37d76d880d9`
- Fixture website-evidence workflow documentation/CI checkpoint:
  `831bf77d2661287676a7e18ddd203719bc6efbb9`
- Durable evidence-receipt persistence source checkpoint:
  `4372305279d627991e8d47ff5b717c4a81ecddc2`
- Durable evidence-receipt documentation/CI checkpoint:
  `48c21491268461071540e5bfc0f3275c18a889fa`
- Fenced evidence-resume source checkpoint:
  `c3591e9443826271bea9db9cddcc61f6d304ebfa`
- Fenced evidence-resume documentation checkpoint:
  `7a3e40a47129403a8feae3983d604ecde743caba`
- Fenced resume-persistence source/documentation checkpoint:
  `6d5db2b1536a93571c241f5e2c3fda9be01e075e`
- Fenced resume-persistence status checkpoint:
  `32c7ae29b215db32e3af54938ee9efcb9d2f39fb`
- Artifact current-reference source/documentation checkpoint:
  `9681e56ad62bf0e7e9b77a57fbd81923338c3378`
- Artifact reference proof-hardening checkpoint:
  `fb9f4dd4f94a5793a765c6dc553637bc1bb36158`
- Atomic artifact-reference snapshot source checkpoint:
  `98cd88ad918ae09d08d8ddf66e30338f444a0d0a`
- Atomic artifact-reference documentation checkpoint:
  `b7168a9b52713eb963fb7132064d1556abbd25a8`
- Artifact-reference raw-row decoder source/documentation checkpoint:
  `588926aed3294d5cf6621834ff06d25212b90977`
- Artifact-reference source-writer guard source/documentation checkpoint:
  `7d209816ee9bacb11537d37920ef75efede143c5`
- Private artifact-reference D1 executor source checkpoint:
  `a9da5ad20e843f528fff7b528dcb8f9d5095fc9b`
- Trusted artifact-reference projection-v2 source checkpoint:
  `9e0673be21decd2f70f9f215829a6ab53ba502e3`
- Bounded manifest HEAD and reconciled retention source checkpoint:
  `5508e57eb813531f69f42e6b15a5fc6d3419f6f7`
- Owner-ready lead projection/read-model source checkpoint:
  `bf0c2c489cd3b315ff04843f2968d77ea61a6fc4`
- Evidence-first owner Leads workspace source checkpoint:
  `5e273fa83bc65705e7930fd6c8f33e5c508b6ce0`
- Evidence-first owner lead dossier source checkpoint:
  `e44c7bbdb749e7f439e7e5a892226817a2bfc36d`
- Owner Leads acceptance checkpoint:
  `0dfaafef6cc5b26ceaaec8bcc7344fc77e2ce89f`
- Atomic shadow-assessment persistence checkpoint: the branch HEAD containing
  this status entry; previous verified checkpoint
  `0dfaafef6cc5b26ceaaec8bcc7344fc77e2ce89f`
- Repository: private `rileyhins17/axiom-revenue-engine`
- Local OpenAI key: stored in ignored `.env.local`; value never printed
- Local migrations: all 61 apply, including the fail-closed lockdown, shadow
  Revenue Engine records, content-bound outreach approval, and durable evidence
  plus fenced resume, current-reference history, and atomic snapshot receipt
  contracts
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
- One fixture-only business workflow now composes homepage capture, HTML fact
  extraction, high-signal page selection, selected-subpage capture, fixed Browser
  measurements, content-addressed artifact receipts, multi-page assembly, and
  deterministic audit through eight fixed checkpoint receipts.
- An unavailable homepage is preserved as a completed `UNREACHABLE` observation.
  A missing selected page or failed mobile measurement makes the run `PARTIAL`
  and keeps unsupported website checks `UNKNOWN`. Capture identity, artifact
  integrity, schema, or storage failures stop the run and publish no audit.
- Workflow/page/artifact IDs are deterministic from the workflow identity.
  Repeating the same input reuses exact matching artifacts; a retry after a
  partial fixture write reconciles the immutable orphan rather than overwriting
  or deleting it. Every receipt keeps provider operations and total cost at zero.
- Fixture-workflow checkpoint verification passes 258/258 tests, typecheck,
  zero-warning lint, the repository safety check, secret-sanitized Cloudflare
  build, explicit default console no-upload dry run, deterministic engine
  bindings, and the inert engine no-upload dry run. The first local build attempt
  hit a transient Windows/OneDrive lock in generated `.next` output; moving only
  that generated directory aside allowed the complete unchanged gate to pass.
- Linux CI run `32564289630` passed all 13 gates on fixture-workflow checkpoint
  `831bf77`, including exact dependencies, a clean Ubuntu Cloudflare build, all
  55 migrations, 258/258 tests, and both no-upload Worker validations.
- Additive migration 0056 now defines immutable website-evidence workflow runs,
  per-attempt/per-step receipts, page selection/candidates, audit assemblies,
  artifact manifests/items, evidence uses, ordered promotion links, and
  content-bound release records. It creates no trigger, schedule, provider
  binding, outreach path, or execution authority.
- The fixture workflow aggregate now carries the exact manifest for every
  successful artifact receipt. Persistence rejects a promotion or release that
  attempts to introduce a manifest outside the workflow's receipt and ordered
  promotion chain.
- A deterministic persistence plan emits canonical row JSON/digests, one exact
  preflight for every insert-if-absent statement, and visible conflict results
  for stored drift or alternate identity collisions. It has no database client
  or executor and explicitly sets both `mutationAuthorized` and
  `resumeAuthorized` to false.
- Durable-receipt checkpoint verification passes 262/262 tests, typecheck,
  zero-warning lint, repository safety, a secret-sanitized Cloudflare build,
  both no-upload Worker validations, and all 56 migrations from zero in an
  isolated local D1 directory. Migration 0056 remains unapplied to staging and
  production.
- Linux CI run `32682397316` passed all 13 gates on durable-receipt checkpoint
  `48c2149`, including exact dependencies, a clean Ubuntu Cloudflare build, all
  56 migrations from zero, 262/262 tests, and both no-upload Worker validations.
- The fixture workflow can now emit the full replayable output of every one of
  its eight steps to an injected fixture-only checkpoint sink. Every artifact
  attempt is observed before a failed receipt stops the workflow, so an orphaned
  immutable object cannot disappear from recovery history.
- The deterministic resume planner binds the current workflow graph and all
  component versions, exact request/delivery identity, contiguous attempt
  history, monotonically increasing fencing tokens, exclusive lease expiry, full
  bounded checkpoint payloads/locators, and direct committed dependencies. It
  reproduces cross-step audit results rather than trusting a summary digest.
- Sealed completed, partial, and unreachable audit results are terminal. Active
  running leases wait; stale or interrupted work can only propose a higher-fenced
  takeover. Browser/storage interruption falls back before the side-effect
  boundary and reconciles exact retained plans, while invalid receipts or object
  identity mismatches block without deleting anything.
- Resume-contract verification passes 283/283 tests, typecheck, zero-warning
  lint, repository safety, the secret-sanitized Cloudflare build, explicit
  default console no-upload dry run, deterministic engine bindings, the inert
  engine no-upload dry run, and all 56 migrations from zero in isolated local D1
  storage. The planner still has no persistence executor and grants no mutation,
  execution, provider-operation, cost, or deletion authority.
- Linux CI run `32685987966` passed all 13 gates on fenced-resume checkpoint
  `fbabd3e`, including exact dependencies, a clean Ubuntu Cloudflare build, all
  56 migrations from zero, 283/283 tests, and both no-upload Worker validations.
- Additive migration 0057 now stores the exact workflow definition, delivery,
  stable attempt identity, fenced lease, full checkpoint payload/locator,
  dependency graph, checkpoint state receipt, artifact recovery plan/receipt,
  aggregate receipt revision, and ended-attempt closure needed for recovery.
- RUNNING attempts are represented by an identity with no closure; ended attempts
  receive one immutable closure. Checkpoint identity/payload is separate from
  append-only `PREPARED`/`COMMITTED` receipts, and artifact plans are stored once
  independently of failed or completed retry receipts.
- The new validation-only persistence planner refuses any blocked resume history,
  returns every primary/alternate identity candidate with no `LIMIT 1`, rejects
  drift or multiple matches, preserves byte payloads with an explicit encoding,
  and still grants no D1 mutation, resume, execution, provider, or cost authority.
- Fenced-persistence checkpoint verification passes 289/289 tests, typecheck,
  zero-warning lint, repository safety, the secret-sanitized Cloudflare build,
  explicit default console no-upload dry run, deterministic engine bindings, and
  the inert engine no-upload dry run. All 57 migrations replayed from zero in
  isolated local D1 directory
  `C:\Users\riley\AppData\Local\Temp\axiom-revenue-engine-migrations-60ac76a9acb34866b2ed072652c587d5`.
- Linux CI run `32688497512` passed all 13 gates on fenced-persistence
  checkpoint `32c7ae2`, including a clean Ubuntu Cloudflare build, all 57
  migrations from zero, 289/289 tests, and both no-upload Worker validations.
- Additive migration 0058 now stores one immutable ending per exact evidence-use
  version plus lineage-wide current-reference projections, per-use states, and
  protecting-manifest candidates. Replacement endings bind the exact replacement
  ID, record version, and digest; legal hold requires explicit compliance
  clearance.
- The deterministic projector selects the weakest verified-present, unexpired
  manifest that still satisfies each active use. It preserves equal minimum-rank
  candidates as ambiguous, falls back from expired/weaker or ended stronger
  purposes safely, treats no-copy promotion as a link rather than a cycle, and
  refuses a zero-reference result for stale, fixture-asserted, disconnected, or
  unassigned history. The original root must match the shadow write contract and
  every promoted manifest/use must close through exact completed history.
- The validation-only persistence plan reproduces every projection from its
  asserted source set, checks every primary/alternate collision candidate without
  `LIMIT 1`, and emits ordered insert-if-absent SQL only. Fixture snapshots are
  explicitly not transactionally complete, cannot suggest retention review, and
  currentness requires deterministic replay inside a five-minute evidence window.
  Mutation, retention conclusion, release, deletion, provider operations, and
  cost authority remain false/zero; no executor or Cloudflare binding was added.
- Artifact-reference hardening verification passes 310/310 tests, typecheck,
  zero-warning lint, safety checks, the secret-sanitized console build, explicit
  default console no-upload dry run, deterministic engine bindings, and the inert
  engine no-upload dry run. All 58 migrations replayed from zero in isolated
  local D1 at
  `C:\Users\riley\AppData\Local\Temp\axiom-revenue-engine-migrations-f35f266d5fbc45dbae9063e709324ea8`.
- Linux CI run `32692455530` passed every gate on documentation checkpoint
  `a82246a`: fail-closed safety, deterministic bindings, a clean Ubuntu
  Cloudflare build, all 58 migrations from zero, 310/310 tests, typecheck, lint,
  and both no-upload Worker validations.
- A versioned atomic artifact-reference plan now derives 15 exact D1 source sets
  from the workflow and lineage root: complete fenced workflow history,
  manifests/items, promotions/uses, manifest links, recursively referenced uses
  and endings, and every persisted availability candidate. Canonical proofs bind
  every raw row, stable identity, count, predicate version, and aggregate digest.
- Migration 0059 adds append-only snapshot attempt/fence claims, content-bound
  manifest availability receipts, future transaction-sealed completeness
  receipts, and per-set proofs. Exact expiry permits only a contiguous,
  strictly-higher-fence takeover; active unsealed attempts block contenders.
- Caller observations and even structurally valid completeness JSON remain
  explicitly untrusted. The code cannot mint a trusted receipt, and every
  execution, projection, retention, release, deletion, provider, and cost gate
  remains false/zero until a future private D1 transaction rechecks, commits,
  and reloads the exact row. All source-writer fence guards are also explicitly
  incomplete, so no executor or binding was added.
- Atomic snapshot checkpoint verification passes 318/318 tests, typecheck,
  zero-warning full lint, safety checks, the secret-sanitized Cloudflare build,
  explicit default console no-upload dry run, deterministic engine bindings,
  and the inert engine no-upload dry run. All 59 migrations replayed
  from zero in isolated local D1 at
  `C:\Users\riley\AppData\Local\Temp\axiom-revenue-engine-migrations-3d63dc5743484ceb9ae060e718ba0950`,
  with 59 migration receipts and all four new tables verified.
- Linux CI run `32694884895` passed every gate on checkpoint `dc6e697`: a clean
  Ubuntu Cloudflare build, all 59 migrations from zero, 318/318 tests,
  fail-closed safety, deterministic bindings, typecheck, zero-warning lint, and
  both no-upload Worker validations.

## Safety and production

- Repository automation target: all autonomous switches off; follow-ups off;
  send cap zero.
- Even if send configuration is later enabled, the final Gmail call now blocks
  without an unexpired operator approval matching the exact message content.
- Production D1 is `axiom-ops-omniscient` (58 tables, about 223 MB). Remote schema
  is still at migration 0052; migrations 0053-0059 have not been applied.
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
- The primary Leads workspace now ranks only current v2 evidence, keeps all five
  quality scores separate, and explains the best supported route. Legacy data is
  not silently promoted into the owner queue.
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
- Fixture website-evidence workflow: eight ordered business checkpoints,
  deterministic identities/output digests, explicit unreachable/partial/failed
  semantics, content-addressed retry recovery, aggregate zero-cost budgets, and
  end-to-end adversarial coverage with no live provider or Worker wiring.
- Durable evidence-receipt persistence: additive migration 0056, immutable
  attempt revisions, steps bound to the exact revision, queryable page/artifact
  provenance, exact preflight/idempotency planning, drift/collision detection,
  and zero mutation/resume/provider authority.
- Fenced evidence resume: full payload/locator checkpoints, exact definition and
  delivery contracts, contiguous attempts, stale-worker fencing, terminal-result
  precedence, dependency-closed continuation, artifact reconciliation, and a
  deterministic zero-authority plan covering crashes and duplicate delivery.
- Fenced resume persistence: additive migration 0057, stable identity plus
  immutable closure/state receipts, separate artifact plans and retry receipts,
  collision-complete preflights, exact idempotency checks, base64-tagged fixture
  bytes, and zero mutation/resume/execution/provider authority.
- Artifact reference projection: additive migration 0058, immutable use endings,
  fixture-asserted promotion-lineage snapshots, exact promotion/use closure,
  content-bound short-lived availability, deterministic currentness replay,
  weakest-valid protecting-copy selection, collision-complete persistence
  planning, and zero retention/mutation/release/deletion/provider authority.
- Atomic artifact-reference snapshot contract: additive migration 0059,
  bounded append-only attempt/fence claims, persisted R2/fixture availability
  observations, 15 exact source-set proofs, future completeness receipt shape,
  generated D1 transaction SQL, exact-expiry takeover tests, and an explicit
  untrusted-only boundary with no executor or receipt issuer.
- Artifact-reference raw-row decoding: strict schemas and canonical JSON/digest/
  denormalized-column reconciliation for all 15 source sets, one exact sealed
  workflow result, explicit multi-root workflow-forest validation, selected-root
  facts, recursive replacement closure, and fresh per-object R2 HEAD receipt
  selection. In-memory D1 tests exercise the generated source SQL; trust,
  projection persistence, retention, release, deletion, provider operations, and
  cost all remain disabled.
- Raw-row decoder checkpoint verification passes 326/326 tests, safety checks,
  typecheck, zero-warning lint, the secret-sanitized Cloudflare build, explicit
  default console no-upload dry run, deterministic engine bindings, and the inert
  engine no-upload dry run. All 59 migrations replayed from zero in isolated
  local D1 at
  `C:\Users\riley\AppData\Local\Temp\axiom-revenue-engine-migrations-d7399a703f4d4486a783f7a305e644df`,
  including all four migration-0059 tables. No staging/production migration,
  deployment, D1/R2/Browser/provider call, or prospect action occurred.
- Linux CI run `32698071984` passed every gate on checkpoint `0384a79`: clean
  dependency installation, fail-closed safety, both Cloudflare builds, all 59
  migrations from zero, 326/326 tests, typecheck, zero-warning lint, and both
  no-upload Worker validations.
- Atomic source-writer guards: additive local-only migration 0060, one scoped
  freeze plus update/delete immutability triggers for all 15 source tables, and
  append-only snapshot attempt/completeness/proof controls. The freeze covers
  the complete workflow query domain and uses database time with a half-open
  lease. Availability must precede the claim. The atomic plan now requires the
  guarded schema. Projection persistence, retention, release, deletion, provider,
  cost, outreach, and every live runtime path remain off.
- Source-writer guard checkpoint verification passes 329/329 tests, fail-closed
  safety, typecheck, zero-warning lint, the secret-sanitized Cloudflare build,
  the console no-upload dry run, deterministic engine bindings, and the inert
  engine no-upload dry run. All 60 migrations replayed from zero in isolated
  local D1 at
  `C:\Users\riley\AppData\Local\Temp\axiom-revenue-engine-migrations-46777bd38c2441f389d01e3ee69fdb78`,
  with 60 migration receipts, 45 source-table triggers, and 51 total triggers.
  No staging/production migration, deployment, D1/R2/Browser/provider call, or
  prospect action occurred.
- Linux CI run `32699873974` passed every gate on checkpoint `bd87195`: clean
  dependency installation, fail-closed safety, both Cloudflare builds, all 60
  migrations from zero, 329/329 tests, typecheck, zero-warning lint, and both
  no-upload Worker validations.
- Private D1 completeness executor: query contract v2 and plan v3 now rebuild the
  complete control plan before use, verify all 51 database writer guards, use
  database-time claim/read and exact 15-set recheck batches, collision-preflight
  every receipt/proof target, atomically insert one parent plus 15 children,
  post-verify them, and independently reload the exact committed rows. Only this
  path returns `transactionallyTrusted=true`; raw decoding and structural receipt
  parsing remain untrusted. Exact replay returns the historical receipt without
  inventing materialized source rows.
- Disposable-D1 adversarial coverage proves fresh commit, exact replay, redigested
  control-SQL rejection before D1, missing-trigger rejection, source-result drift,
  target collisions, child-failure parent rollback, expired database-time fences,
  and divergent attempt identities. All projection persistence, retention,
  release, deletion, provider, cost, and outreach authority remains false/zero.
- Private executor checkpoint verification passes 336/336 tests, fail-closed
  safety, typecheck, zero-warning lint, the secret-sanitized Cloudflare build,
  the console no-upload dry run, deterministic engine bindings, and the inert
  engine no-upload dry run. All 60 migrations replayed from zero in isolated
  local D1 at
  `C:\Users\riley\AppData\Local\Temp\axiom-revenue-engine-migrations-36f002cfd22d41ab9d265e9ab43439c3`,
  with 60 migration receipts, 51 triggers, and 15 scoped insert freezes. No
  staging/production migration, deployment, D1/R2/Browser/provider call, secret
  access, or prospect action occurred.
- Linux CI run `32703057529` passed every gate on checkpoint
  `a6109e6bd6fca75180abcb64f1103a8eb149d5bd`: clean dependency installation,
  fail-closed safety, both Cloudflare builds, all 60 migrations from zero,
  336/336 tests, typecheck, zero-warning lint, and both no-upload Worker
  validations.
- Exact-head Linux CI run `32703474283` also passed every gate on the final
  executor documentation checkpoint `a9a4703385595d074f7d58a757eaed4a011e4476`.
- Trusted projection-v2 now accepts only the exact frozen in-process result of a
  fresh D1 commit with materialized rows. It rejects stale windows, receipt-only
  replay, cloned trust envelopes, and source drift, then replays the selected
  lineage deterministically. Complete zero-active-use snapshots may report
  `NO_CURRENT_REFERENCES`; ambiguous or unassigned active uses remain
  `INDETERMINATE`.
- The compatibility replay now matches availability v2: only shadow objects may
  carry automatic object expiry. Qualification's 180-day policy is a retention
  review boundary, not automatic R2 deletion. Projection persistence, retention
  conclusions, release, deletion, provider operations, cost, outreach, and every
  live runtime path remain false/zero/off.
- Trusted-projection checkpoint verification passes 340/340 tests, fail-closed
  safety, typecheck, zero-warning lint, the secret-sanitized Cloudflare build,
  the console no-upload dry run, deterministic engine bindings, and the inert
  engine no-upload dry run. All 60 migrations replayed from zero in isolated
  local D1 at
  `C:\Users\riley\AppData\Local\Temp\axiom-revenue-engine-migrations-82394009ccd04fa695f01c8e8ab1aedf`,
  with 60 migration receipts, 51 triggers, and 15 scoped insert freezes. No
  staging/production migration, deployment, D1/R2/Browser/provider call, secret
  access, or prospect action occurred.
- Exact-head Linux CI run `32705487957` passed every gate on the final trusted-
  projection documentation checkpoint
  `f95da36cb787cd0e89e1bc328ded610ada3b3f01`: clean install, fail-closed
  safety, both Cloudflare builds/bindings, all 60 migrations from zero, 340/340
  tests, typecheck, zero-warning lint, and both no-upload Worker validations.
- Bounded manifest HEAD adapter v1 now attempts every exact manifest object in
  canonical order through an injected fixture client. It binds explicit matched,
  missing, mismatched, malformed, and client-error observations with a ten-object,
  five-minute, zero-provider-operation, zero-cost ceiling. It always emits a
  fixture availability receipt and cannot become an R2 winner or authorize
  persistence, retry, release, deletion, provider work, outreach, or spend.
- The lower-level artifact policy now agrees with projection v2: only shadow
  objects have a planned automatic 30-day lifecycle. Qualification evidence has
  a 180-day review boundary and no automatic delete; outreach and legal hold
  remain protected as well. The staging activation/rollback procedure is now
  explicit in `docs/runbooks/STAGING_R2_ACTIVATION.md`.
- Manifest-HEAD checkpoint local verification passes 344/344 tests, fail-closed
  safety, typecheck, zero-warning lint, the secret-sanitized Cloudflare build,
  console no-upload dry run, deterministic engine bindings, and inert engine
  no-upload dry run. No bucket, binding, provider request, lifecycle rule,
  deployment, remote migration, D1 write, secret access, or prospect action
  occurred.
- Exact-head Linux CI run `32923727144` passed every gate on the final manifest-
  HEAD/R2-runbook checkpoint `f17fc5d60142884617979d0f54b2c8206050932a`:
  clean install, fail-closed safety, both Cloudflare builds/bindings, all 60
  migrations from zero, 344/344 tests, typecheck, zero-warning lint, and both
  no-upload Worker validations.
- Owner lead projection v1 now turns current v2 business, KW location, audit,
  evidence, contact, verification, and five-score qualification facts into a
  deterministic owner view. It recomputes qualification, keeps non-email leads
  valuable, prefers verified named/role email only when current, and routes phone,
  form, and social as manual work. Stale/future/drifted facts become refresh work;
  cross-business contamination fails closed.
- The owner lead D1 reader uses two bounded SELECT-only contracts, validates
  public URLs and stored JSON, reports malformed rows with bounded codes, and
  exposes authenticated private/no-store `GET /api/v1/leads` with a maximum of
  100 candidates. Every qualification, mutation, send, outreach, provider, and
  cost authority remains false/zero.
- Owner-read-model local verification passes 354/354 tests, fail-closed safety,
  typecheck, zero-warning lint, the secret-sanitized Cloudflare build (including
  `/api/v1/leads`), console no-upload dry run, deterministic engine bindings, and
  inert engine no-upload dry run. No deployment, remote migration, provider call,
  D1 write, mailbox action, secret access, or prospect contact occurred.
- Exact-head Linux CI run `32925363253` (job `98047071013`) passed every gate on
  the final owner-read-model documentation checkpoint
  `2a131b71a34b33b41551ff316a58820c91c8e32d`: clean install, fail-closed
  safety, both Cloudflare builds/bindings, all 60 migrations from zero, 354/354
  tests, typecheck, zero-warning lint, and both no-upload Worker validations.
- The primary owner navigation and installed-app shortcut now open `/leads`.
  Its authenticated Server Component reads the bounded v2 owner model directly
  and renders plain-English priority, all five separate scores, exact
  why-this-lead evidence links, classification, current data quality, and the
  strongest supported route. The legacy `/vault` remains available as a
  migration reference but is no longer the primary Leads destination.
- The Leads list has honest current, empty, loading, refresh, research, blocked,
  rejected-data, and unavailable states. It cannot silently substitute legacy
  rows. Phone, form, and social routes are visibly manual, and the list contains
  no approval, direct-contact, send, provider, or mutation action.
- Safety checks now enforce owner authentication, direct use of the bounded read
  model, read-only copy, and absence of self-fetch, write methods, buttons,
  forms, or direct email/phone links. Fixture-rendered tests verify semantic
  headings, all five score labels, exact evidence, manual route copy, fail-closed
  states, and navigation.
- A local headed Playwright review used a temporary synthetic route at 1440x1000
  and 390x844. Desktop and mobile layouts, semantic snapshots, focusable evidence
  links, score readability, route prominence, and bottom navigation were
  inspected; the temporary route and screenshots were removed before commit.
- Owner-Leads workspace local verification passes 360/360 tests, fail-closed
  safety, typecheck, zero-warning lint, the secret-sanitized Cloudflare build
  (including dynamic `/leads`), console no-upload dry run, deterministic engine
  bindings, and inert engine no-upload dry run. No deployment, remote migration,
  provider request, D1 write, mailbox action, secret access, or prospect contact
  occurred.
- Exact-head Linux CI run `32943097435` (job `98098016868`) passed all 13 gates
  on owner-Leads documentation checkpoint
  `653bf5fa1abe79086866d9c072bdbbf00ae6cd65`: clean install, fail-closed
  safety, both Cloudflare builds/bindings, all 60 migrations from zero, 360/360
  tests, typecheck, zero-warning lint, and both no-upload Worker validations.
- Every ranked lead now links to authenticated dynamic `/leads/[businessId]`.
  Its exact-business reader reuses the deterministic owner projection, validates
  the current website snapshot against its stored audit receipt, reads every
  current contact route, and returns at most 100 factual v2 source, audit,
  qualification, contact, and verification events. Invalid identities fail
  before D1; missing dossiers return not found; inconsistent facts fail closed.
- The dossier keeps all five scores visible, leads with the strongest supported
  observations, groups audit findings as critical/important/minor, explains the
  recommended route, and shows every recorded contact value without turning it
  into a direct email, phone, form, social, approval, or send action. Opaque
  desktop/mobile/DOM artifact references say that preview delivery is not yet
  available. Outreach, reply, opportunity, and client history remain explicit
  unavailable placeholders rather than guessed legacy history.
- Authenticated private/no-store `GET /api/v1/leads/[businessId]` exposes the
  same zero-authority contract. Safety checks enforce authenticated direct reads,
  SELECT-only/provider-free data access, read-only copy, no write methods, and no
  contact-action controls. The detail/list fixture suite and real migration-0054
  SQL compilation pass; the complete repository suite is now 368/368 tests.
- A headed Playwright review used a temporary synthetic local D1 and route at
  1440x1000 and 390x844. Semantic structure, evidence hierarchy, route
  prominence, long-page readability, and desktop/mobile layout were inspected;
  mobile document width was 385 CSS pixels inside a 390-pixel viewport. The
  temporary route, database, screenshots, logs, browser, and dev server were
  removed before commit. The only browser console failure was the expected local
  session lookup with no test auth secret; the dossier itself returned 200.
- Lead-dossier local release verification passes fail-closed safety, 368/368
  tests, typecheck, zero-warning lint, the secret-sanitized Cloudflare build
  (including dynamic detail page/API routes), console no-upload dry run,
  deterministic engine bindings, and inert engine no-upload dry run. No
  deployment, remote migration, provider request, configured local/remote D1
  write, mailbox action, secret access, prospect contact, or spend occurred; the
  only write was the removed isolated synthetic preview database. Production and
  staging automation state is unchanged and remains stopped.
- Exact-head Linux CI run `32969626111` (job `98180042849`) passed all 13 gates
  on dossier documentation checkpoint
  `ded584857ece8c5c3409225de693877ee26781b8`, including all 60 migrations and
  368/368 tests.
- A repeatable owner acceptance command now starts the real Next.js console on
  an ephemeral loopback port, applies all 60 migrations to a disposable
  synthetic database, creates a real local Better Auth operator session, and
  exercises the ranked Leads list plus evidence dossier in pinned Chromium.
- The acceptance boundary blocks every browser request outside the exact local
  origin and starts the app with intake, queueing, sending, follow-ups, scraping,
  provider credentials, and all cost paths disabled. Successful fixtures and
  screenshots are removed; bounded failure artifacts remain ignored for local
  diagnosis only.
- Four page/viewport states now pass axe-core WCAG 2.2 AA checks, 24-pixel target
  minimums, responsive overflow checks, reduced-motion checks, distinct titles,
  read-only control checks, mobile-navigation clearance, and keyboard/visible-
  focus traversal from the skip link into the first evidence dossier. The last
  clean local browser run found the list in 258 ms against a 10-second budget
  and the dossier rationale in 2,872 ms against a 15-second budget at 1440x1000;
  mobile width remained exactly 390 CSS pixels and external requests were zero.
- This gate exposed and fixed a real route bug: the list percent-encoded `:` in
  typed business IDs, while the dynamic route received the encoded text and
  rejected a valid dossier. One shared identity contract now emits safe readable
  paths, decodes route input exactly once, and rejects slashes, malformed escapes,
  and double encoding before D1. Leads/dossiers also gained distinct page titles,
  a focusable main landmark, and WCAG-AA contrast floors for small operational
  labels.
- Owner-acceptance local verification passes fail-closed safety, 372/372 unit and
  characterization tests, the isolated browser gate, typecheck, zero-warning
  lint, the secret-sanitized Cloudflare build, console no-upload dry run,
  deterministic engine bindings, and inert engine no-upload dry run. No
  deployment, remote migration, configured local/remote D1 write, provider call,
  mailbox action, prospect contact, secret exposure, or runtime spend occurred.
  Production and staging automation remain stopped.
- Exact-head Linux CI run `32999604935` (job `98277643017`) passed all 13 gates
  on owner-acceptance checkpoint
  `0dfaafef6cc5b26ceaaec8bcc7344fc77e2ce89f`, including the isolated Chromium
  owner gate, all 60 then-current migrations, and 372/372 tests.
- The private shadow-assessment boundary now accepts only an exact sealed
  website-evidence receipt, revalidates its digest/business/audit/evidence
  identity, and combines current business-fit/timing basis with deterministic
  rebuild evidence. Reachability remains zero and the route remains `RESEARCH`;
  no email, contact, consent, provider, or owner-action state is inferred.
- Migration 0061 adds an append-only assessment receipt and protects website
  snapshots, capture-specific evidence claims, qualification snapshots, and the
  receipt from update/delete. The injected D1 executor collision-preflights every
  identity, checks fresh writes against D1 time, commits all missing rows in one
  batch with the receipt last, reloads every exact row, and makes an exact replay
  mutation-free.
- Deterministic website audits advanced to v4 because repeat captures previously
  reused claim IDs. Claim identity now includes business, audit version, capture
  time, and check ID; the assessment boundary independently verifies that
  identity before persistence.
- Shadow-assessment local release verification passes fail-closed safety,
  381/381 tests, typecheck, zero-warning lint, the secret-sanitized Cloudflare
  build, console no-upload dry run, deterministic console/engine bindings, inert
  engine no-upload dry run, all 61 migrations, and the isolated owner browser
  gate. Browser readiness was 243 ms for the list and 3,642 ms for the dossier;
  all four WCAG views passed at desktop/mobile widths with zero external
  requests.
- Migration 0061 was applied only to ignored local Wrangler state, and all 61
  migrations were also replayed in the disposable owner-acceptance database.
  No staging/production migration, deployment, provider call, R2/Browser
  operation, mailbox action, prospect contact, secret exposure, or runtime spend
  occurred. Both deployed automation states remain stopped.

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
As checked against Cloudflare's published pricing on 2026-08-25, the planned R2
contract uses Standard storage, whose included allowance is 10 GB-month plus one
million Class A and ten million Class B operations monthly. HEAD is Class B. R2
is not activated and the project has incurred zero artifact-storage cost. The
dashboard price and any activation commitment must be rechecked immediately
before approval.

## Blockers / owner actions

- Recreate and secure `riley@getaxiom.ca` and `aidan@getaxiom.ca` in Google
  Workspace; verify send/receive, MFA, SPF, DKIM, DMARC, and recovery ownership.
- Confirm who owns replies for each mailbox before the pilot.
- Later: label the first 50 KW leads strong/weak/wrong with a short reason.
- R2 activation currently requires the exact owner phrase in
  `docs/runbooks/STAGING_R2_ACTIVATION.md` after the Cloudflare dashboard proves
  it fits inside the existing C$50 ceiling. No R2 resource, binding, operation,
  lifecycle rule, or charge has been created yet.
- No new owner decision is required for the shadow-assessment persistence
  checkpoint.

## Next three actions

1. Add private artifact-delivery authorization and expiry contracts so a future
   dossier can display desktop/mobile proof without exposing an R2 object or
   activating R2 before its separate owner gate.
2. Design the separately gated private invocation/import path that can feed the
   sealed assessment writer from owner-approved KW records; keep staging
   migration, Workers, providers, contact discovery, and every live writer off.
3. Extend the browser owner gate to approval, emergency-stop, and weekly-review
   timing only after those real v2 UI actions exist; do not test legacy controls
   as if they were the finished owner workflow.

## Resume instructions

Read `AGENTS.md`, `docs/OWNER_CONTEXT.md`, this file, `docs/MASTER_PLAN.md`, and
`docs/GOTCHAS.md`; verify Git status and branch; then start with the first pending
action above. Do not infer live production state from this document if it is more
than one work cycle old—verify it read-only.
