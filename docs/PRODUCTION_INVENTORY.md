# Legacy production inventory

## Read-only dashboard refresh — 2026-09-23 17:11 UTC

The active legacy Worker `axiom-ops-omniscient` still serves
`operations.getaxiom.ca` at version `9670516c`. Its dashboard shows the legacy
D1, Browser Run, assets, and a self-service binding. It has no cron trigger,
queue consumer, or email trigger. The database remains about 223 MB with 58
user-facing tables. Read-only SQL returned 55 migration receipts whose latest
filename is `0052_message_evidence_and_experiments.sql`. The current
automation-setting row is `enabled=0`, with global, emergency, intake, and
follow-up pauses all `1`.

These observations confirm the stopped runtime state at the inspection time;
they do not prove that every historical background effect or external mailbox
is reconciled. No deployment, migration, data export, restore drill, or
configuration change occurred. The August backup below is historical and is
not a current release backup. The local Wrangler OAuth session is expired.

Verified: 2026-08-21 (America/Toronto)

This inventory contains identifiers and aggregate counts only. It intentionally
omits lead/contact contents, authentication tokens, secret values, and message
bodies. Re-verify live state before a release because this document is a
checkpoint, not a monitoring system.

## Cloudflare resources

- Account: Aidan's Cloudflare account, ID
  `fe468a56a5b8c7f8fc5d39e265c2f791`.
- Legacy Worker: `axiom-ops-omniscient`.
- Active legacy Worker version: 683,
  `9670516c-88cb-42b3-8ec2-dc48eea7a115`.
- Active deployment: `4048f30c-eebc-4628-a98c-846110f425ab`, created
  `2026-08-16T06:43:39Z`.
- Legacy D1: `axiom-ops-omniscient`, ID
  `e42f3d48-5813-4d18-86c4-4471b55aa65e`, ENAM primary, read replication off.
- D1 inventory: 58 tables and approximately 223 MB.
- Remote migrations stop at 0052. Rebuild migrations 0053-0055 are local/staging
  work and have not been applied to production.
- Configured secret names: `AGENT_SHARED_SECRET`, `BETTER_AUTH_SECRET`,
  `BETTER_AUTH_URL`, `DEEPSEEK_API_KEY`, `GEMINI_API_KEY`, `GMAIL_CLIENT_ID`,
  `GMAIL_CLIENT_SECRET`, `GOOGLE_MAPS_API_KEY`, `GOOGLE_PLACES_API_KEY`, and
  `MCP_API_TOKEN`. Values were never read or printed.

## Safety state

At `2026-08-22T03:03:15Z`, the database settings were:

| Gate | State |
|---|---:|
| Master enabled | 0 |
| Global pause | 1 |
| Emergency pause | 1 |
| Intake pause | 1 |
| Follow-up pause | 1 |

The old deployed bundle still contains historical plain configuration values
that say intake, queue, and send are enabled. They cannot pass the database
gates. The new repository configuration has all three off and a zero send cap.

The legacy Worker cron was removed after the backup. Before removal it created
287 zero-send `SKIPPED` runs per day. The prior schedule was `*/5 * * * *`; do
not restore it without an approved rollback or rollout.

Trigger removal was observed past Cloudflare's full propagation window. At
`2026-08-22T03:18:07Z`, the skipped-run count was unchanged at 1,695 and the most
recent run remained `2026-08-22T03:00:46Z`.

## Aggregate data

| Record | Count / latest evidence |
|---|---|
| Leads | 10,480 total; 1,888 not archived |
| Leads with an email | 2,382 |
| Leads with a website | 5,743 |
| Qualification snapshots | 10,480 legacy/shadow snapshots |
| Website inspections | 23 |
| Lead assessments | 551 |
| Suppressions | 85 |
| Sent/delivered email records | 1,936 |
| Most recent send | `2026-06-03T09:20:57Z` |
| Send records in prior seven days | 0 |
| Reply-outcome records | 0 |
| Scrape jobs | 3,590: 2,715 completed, 872 failed, 3 canceled |
| Most recent scrape job | `2026-06-03T14:00:33Z` |

The legacy scrape-job failure rate is 24.29%. Reply outcomes were not stored in
`LeadReplyOutcome`; do not infer zero human replies from that empty table. The
older rebuild blueprint identified four replies through other evidence.

The dormant outreach backlog contains 472 `ACTIVE` and 14 `QUEUED` sequences,
plus 1,537 scheduled steps. It must be reconciled or archived during migration;
it must never be imported as approved work.

## Backup and rollback evidence

- Ignored local export:
  `backups/production/20260821T2300-0400/axiom-ops-omniscient.sql`.
- Size: 226,228,443 bytes (215.75 MiB).
- SHA-256:
  `46d60b80e099759c54522858d0ee9174d649dce5627fc8f9894b141666518dc7`.
- Post-lockdown Time Travel bookmark:
  `00002ff8-00000002-000050cf-aa041de046860de5cf0527956a845930`.
- Prior cron schedule for an explicitly approved trigger rollback:
  `*/5 * * * *`.

Do not commit the export, restore the unsafe master-enabled state, or restore the
cron merely to test the old engine.
