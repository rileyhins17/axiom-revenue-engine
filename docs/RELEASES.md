# Release history

## Unreleased — Revenue Engine foundation

- Recovered the actual repository into the local workspace.
- Renamed the private GitHub repository to `axiom-revenue-engine`.
- Established the durable owner context, operating contract, master plan, status,
  gotcha ledger, runbook, data dictionary, and ADR structure.
- Added fail-closed configuration/database defaults, generated Cloudflare types,
  Linux CI, and a protected manual production workflow.
- Added the pinned OpenAI Responses provider, immutable evidence contracts,
  coverage memory, four quality scores plus confidence, and additive shadow data.
- Added content-bound human approval as a mandatory final Gmail delivery gate.
- Relabelled the owner navigation and made Leads quality-first with transparent
  score components and an explicit stale-evidence warning.
- Locally verified 160 tests, typecheck, lint, all 55 migrations, Cloudflare build,
  and Wrangler dry run.
- Verified the same complete gate on clean Ubuntu in GitHub Actions after making
  Node/tooling and secret-independent generated bindings reproducible.
- Exported and checksummed the 223 MB legacy production D1 database before any
  mutation, recorded a Time Travel bookmark, and confirmed 1,936 historical sends
  with no send or scrape activity since June 3.
- Corrected the legacy master database switch to off and removed the dormant
  five-minute cron that was creating 287 zero-send skipped runs per day. No code,
  route, or database migration was deployed.
- Added the GitHub `production` environment restricted to `main`; deployment
  credentials remain absent, so the protected workflow cannot deploy yet.
- Provisioned isolated staging D1 and job/DLQ resources, applied and verified all
  55 migrations with every stop engaged, and added a no-cron staging console
  configuration that cannot bind legacy production.
- Hardened production workflow inputs with exact-SHA/checksum validation and a
  requirement that the deployed commit is contained in `main`.
- Blocked a pre-deploy local-secret leak from OpenNext's generated environment
  module and added automatic sanitization plus whole-bundle secret scanning to
  every Cloudflare build.
- Deployed the first isolated staging console with one fresh auth secret, no
  schedule/provider/mailbox credentials, and zero staging runs or sends.
- Regenerated deterministic Cloudflare bindings for the isolated staging
  environment after Linux CI correctly rejected the stale checked-in types.
- Added an inert, separately typed Revenue Engine Worker and durable Workflow
  scaffold with versioned receipts/adapters, zero execution budget, no live
  consumer or schedule, generated bindings, local lock proof, and CI dry runs.
- Pinned Wrangler 4.125.0 so the new Worker can use the current compatibility
  date, while preventing engine type generation and local development from
  inheriting unrelated `.env.local` secrets.
- Added a deterministic website-quality kernel with 18 transparent checks,
  four opportunity classifications, evidence-grounded negative findings, and
  modern/weak/broken/missing/mobile fixture coverage.
- Added the private KW 50-lead evaluation contract and owner guide with unique
  identity, city/niche balance, required owner reasons, and 85% agreement gates.
- Added a bounded public-website capture boundary with canonical URL policy,
  private/internal target blocking, manual redirect revalidation, timeout and
  1 MiB HTML limits, explicit failure outcomes, and fake-network tests. It is not
  connected to live engine execution.
- Added a zero-cost private KW seed-preparation path with strict market/niche
  validation, stable identity/source records, cohort runs, duplicate rejection,
  ignored no-overwrite storage, and explicit research-only/no-outreach state.
- Corrected the complete test command so TypeScript safety tests in `scripts/`
  are always included, and made that test-glob coverage a safety assertion.
- Added bounded WHATWG-compatible streaming HTML fact extraction for metadata,
  visible text, actions, forms, trust markers, JSON-LD types, and internal page
  links. Scripts are never executed and visual placement remains unknown.
- Added a validation-only private KW persistence planner. It binds the prepared
  seed to migration 0054 with deterministic expected-state fingerprints and
  insert-if-absent statements for source, business, location, and source-record
  rows only. Collision, drift, idempotency, and schema compatibility are tested
  in memory; no database executor or outreach authority exists.

Production has not been cut over to this release.
