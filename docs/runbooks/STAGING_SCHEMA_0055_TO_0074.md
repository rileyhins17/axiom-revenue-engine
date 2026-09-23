# Isolated staging schema upgrade: 0055 to 0074

**State:** prepared procedure, not an approval or completed migration. The
staging database observed on 2026-09-23 has 55 receipts through
`0055_outreach_human_approval.sql`; the candidate contains 19 later migrations.
The legacy production database and the default `wrangler.jsonc` environment
are outside this procedure. See [staging inventory](../STAGING_INVENTORY.md),
[production inventory](../PRODUCTION_INVENTORY.md), and the
[release runbook](../RUNBOOK.md).

## Before requesting the staging migration gate

1. Confirm the exact application commit has passed Linux CI and the current
   branch still contains the same 19 migration blobs. Run the local synthetic
   upgrade test: `npx tsx --test scripts/staging-upgrade-rehearsal.test.ts`.
   That test seeds a 0055 schema with old contacts, verification, website,
   qualification, an admin, and engaged stops. It checks original row values,
   the new `LEGACY`/null defaults, foreign keys, integrity, and the 0074 reply
   task/stop/suppression triggers after applying 0056–0074. **It cannot prove
   that today's remote staging rows migrate correctly.**
2. Restore authorized Wrangler access. Verify account, database name and UUID
   `322fcf89-312c-44f0-b238-c4a348f6d6ad`, and `--env staging` in every
   command. Never use the default environment or the `axiom-ops-omniscient`
   database for this operation. Use `wrangler d1 info` and a read-only
   `d1 execute --remote --command` to confirm the current ledger is exactly
   55 receipts, ending at 0055, and the database stops remain engaged.
3. Set `$privateExportSql` to an absolute path under ignored
   `backups/staging/` and export the **current** staging database there; record
   UTC, file size and SHA-256 with `Get-FileHash`.
   The August 32-byte empty export and the September Time Travel bookmark are
   not substitutes. Cloudflare documents `d1 export --remote --output` for a
   full SQL export; it may block database requests while running. Keep the
   export out of Git, logs, issues and screenshots.
   Run the checksum-pinned offline rehearsal against that exact file before any
   Wrangler restore or remote operation:

   ```powershell
   $privateExportHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $privateExportSql).Hash.ToLowerInvariant()
   npx tsx scripts/rehearse-staging-sql-export.ts --export $privateExportSql --sha256 $privateExportHash
   ```

   It accepts only an absolute path under ignored `backups/staging/`, requires
   the exact 55-receipt baseline and engaged database stops, replays 0056–0074
   in disposable in-memory SQLite, and reports counts, names, hashes, and
   pass/fail metadata. Keep the export private. A failed checksum, parser,
   ledger, stop, integrity, foreign-key, or row-preservation check is a hard
   stop; a pass still needs the separate Wrangler local restore below.
4. Restore that SQL export into a **fresh disposable local D1 directory**,
   without overwriting the export. For one unique, private `rehearsal` directory
   under the same ignored backup folder, set `$privateRehearsalDir` to that
   new directory and retain `$privateExportSql` as the current export path.
   Use these local-only Wrangler commands and check each output before the
   next command:

   ```powershell
   npx wrangler d1 execute axiom-revenue-engine-staging --local --config wrangler.jsonc --env staging --persist-to $privateRehearsalDir --file $privateExportSql
   npx wrangler d1 migrations list axiom-revenue-engine-staging --local --config wrangler.jsonc --env staging --persist-to $privateRehearsalDir
   npx wrangler d1 migrations apply axiom-revenue-engine-staging --local --config wrangler.jsonc --env staging --persist-to $privateRehearsalDir
   ```

   Verify the restored 55-name migration ledger, original table/row counts,
   representative user/contact/verification rows, engaged stops,
   `PRAGMA integrity_check`, and `PRAGMA foreign_key_check` before applying.
   Wrangler must list exactly 0056–0074; afterwards it must report 74 receipts.
   Compare every pre-upgrade table's original columns and rows and exercise the
   new owner reply/task and suppression paths. Record only counts, migration
   names/hashes and pass/fail metadata in the release record; do not publish
   private row contents. An incompatible export, ledger or row is a hard stop.
5. Record a migration-specific release packet: exact Git commit and migration
   hashes, staging D1 UUID, export checksum, actual restore/rehearsal results,
   pre/post SQL checks, Time Travel bookmark, Worker rollback version, and the
   separate database recovery decision. A Worker rollback does **not** undo a
   D1 migration. Obtain the exact applicable migration approval before the
   remote apply; the older console-only staging packet explicitly excludes
   migrations.

## Approved-window execution and verification

At the approved window, recheck that the staging D1 UUID, 55-name ledger,
database stops and exact branch/CI still match the packet. Take a fresh export
and checksum immediately before applying. The remote operation must name the
isolated database and environment explicitly:

```powershell
npx wrangler d1 migrations list axiom-revenue-engine-staging --remote --config wrangler.jsonc --env staging
npx wrangler d1 migrations apply axiom-revenue-engine-staging --remote --config wrangler.jsonc --env staging
```

Confirm Wrangler lists **only** 0056–0074 before accepting its migration
prompt. Stop on any changed target, migration list, rows, backup, or safety
state. Cloudflare says each failed migration is rolled back while prior
successful migrations remain, so an interrupted run needs a fresh ledger and
data inspection before any retry. After completion, verify 74 receipts through
0074, old-row and stop preservation, foreign keys, and authenticated synthetic
owner flows. No prospect, mailbox or provider call is a smoke test.

If the schema is bad, stop the console and evaluate recovery from the recorded
pre-change export or Time Travel bookmark. Cloudflare's Time Travel restore
overwrites the database in place and can discard post-bookmark writes, so it
requires an explicit recovery decision; do not run it as an automatic rollback.
Keep the legacy production database untouched.

Cloudflare references: [D1 export/import](https://developers.cloudflare.com/d1/best-practices/import-export-data/),
[Wrangler migration commands](https://developers.cloudflare.com/d1/wrangler-commands/),
and [Time Travel recovery](https://developers.cloudflare.com/d1/reference/time-travel/).
