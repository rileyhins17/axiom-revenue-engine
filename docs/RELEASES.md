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

Production has not been cut over to this release.
