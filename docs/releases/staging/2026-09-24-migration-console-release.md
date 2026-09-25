# Staging release record — migrations 0056–0074 and console

**Environment:** isolated staging only (`axiom-revenue-engine-console-staging`,
D1 `axiom-revenue-engine-staging` / `322fcf89-312c-44f0-b238-c4a348f6d6ad`,
account `fe468a56a5b8c7f8fc5d39e265c2f791`). Legacy production is not touched.

## Approval

Riley, in the Claude Code session on 2026-09-24: "stage it and go live". This
record covers the staging step only. Production has its own guard and gates.

## Candidate

- Code: branch `codex/revenue-engine-production` at the commit named in the
  release result below, verified in a short-path clean clone (full suite,
  safety, typecheck, lint, Cloudflare build with private-file sanitizer,
  staging no-upload dry run, owner browser acceptance).
- Migrations: exactly 0056–0074 pending on staging (listed read-only before
  apply); hashes as recorded by the rehearsal.

## Backup and rehearsal

- Read-only logical export `backups/staging/staging-readonly-export-20260924T030623Z.sql`
  (39 tables, 107 indexes, 745 rows), SHA-256
  `48794fdd03755d9455b67409e5a7aee2c90ce81d8f6d616c5a74944a22eecb45`.
- Checksum-pinned rehearsal: PASS (55 → 74, rows preserved, stops engaged,
  foreign keys and integrity clean).
- A D1 Time Travel bookmark is recorded immediately before apply (below).

## Rollback

- Console: `wrangler rollback 941b37bc-38e8-4c6c-9111-d475e9871727 --env staging`
  (the version serving before this release).
- Database: migrations are additive. If the schema itself is bad, restore
  with `wrangler d1 time-travel restore axiom-revenue-engine-staging --env staging --bookmark <bookmark below>`
  after an explicit recovery decision (it overwrites later writes). A Worker
  rollback alone does not undo migrations.

## Result

Executed 2026-09-24 ~03:50–04:10 UTC.
- Pre-apply export identical to the rehearsed one (SHA-256 `48794fdd…ecb45`,
  745 rows). Time Travel bookmark:
  `00000016-00000000-000050f0-b5640c866c245f3bfc07975874e287b8`.
- First apply: 0056–0073 succeeded; 0074 failed remotely ("incomplete input":
  the remote splitter cut its trigger at a CASE's `END;`) and was rolled back.
  Fixed in `8583d8f` (same rules, `SELECT RAISE … WHERE [NOT] EXISTS` form),
  rehearsal re-run PASS, then 0074 applied.
- After: 74 receipts ending 0074, stops `enabled=0` and all four paused flags
  `=1`, 681 scrape targets and 2 users preserved.
- Console built from `8583d8f` in a clean clone (1,772 files scanned, 0
  secrets) and deployed: version `cb67ccf9-93be-40bc-80fc-a03ef8238ccc`.
  Unauthenticated `/dashboard` redirects to `/sign-in`.
- Not yet done: authenticated owner walkthrough on staging.
