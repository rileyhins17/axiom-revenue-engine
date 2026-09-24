# ADR 0061: Upgrade legacy production in place

- Status: accepted by Riley, 2026-09-24 (supersedes the isolated-database
  requirement in ADR 0055 for this release)

## Decision

Live (`operations.getaxiom.ca`, Worker `axiom-ops-omniscient`, D1
`e42f3d48-5813-4d18-86c4-4471b55aa65e`) is upgraded in place from 0052 to 0074
and the new console is deployed under the same Worker name, so its existing
secrets and custom domain stay in place. Riley chose this over a fresh
isolated database so the 10,480 legacy leads, 1,937 sent-email records and 85
suppressions stay visible and protected.

## Guards

- `wrangler.production.jsonc` pins the Worker, account and D1, with all
  autonomous switches off and no cron. The legacy Worker's vars had sending,
  queue and intake set to `true` (held back only by database stops); this
  release replaces them with the off defaults.
- `scripts/release-production.mjs` refuses to run without Riley's recorded
  approval phrase, the right account, a clean checkout, a matching backup
  checksum, engaged stops, and exactly 0053–0074 pending. It records a Time
  Travel bookmark, applies, re-verifies, then deploys.
- `npm run deploy`, `deploy:production` and `db:migrate:production` stay
  guarded; the protected GitHub workflow is unchanged.

## Evidence

Export `backups/production/prod-export-20260924T120506Z.sql` (226 MB, SHA-256
`f9f5a0f49356296919fdf30fddd1a9b652161e0054d74bb7fd49d567aaf7ad7a`), rehearsed
locally with `scripts/rehearse-production-upgrade.mts`: 22 applied, 432,751
rows preserved, integrity ok, zero foreign-key violations, stops engaged.

## Rollback

Console: `wrangler rollback 9670516c-88cb-42b3-8ec2-dc48eea7a115 --name axiom-ops-omniscient`.
Database: restore the recorded Time Travel bookmark after an explicit recovery
decision (the old console expects the 0052 schema; the new tables are additive).
