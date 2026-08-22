# Staging inventory

Last verified: 2026-08-21 (America/Toronto)

Staging is isolated from every legacy production resource. It has no schedule,
no producer, no consumer, no mailbox credentials, and no production traffic.

## Provisioned resources

- D1 `axiom-revenue-engine-staging`
  (`322fcf89-312c-44f0-b238-c4a348f6d6ad`), ENAM, approximately 0.95 MB.
- Queue `axiom-revenue-engine-jobs-staging`
  (`3f87b4d293ee414590279a89fba41348`).
- Dead-letter queue `axiom-revenue-engine-jobs-staging-dlq`
  (`a33464b4834e4b3b95659af0ceec2d9d`).

Both queues have zero producers and zero consumers. They cannot receive or
process work until the separate typed engine Worker is implemented and approved.

## Database verification

- Empty pre-migration export:
  `backups/staging/20260821T2322-0400/axiom-revenue-engine-staging-pre-migration.sql`.
- Empty export size: 32 bytes.
- SHA-256:
  `309d1516f5d4f4f792b17106f7b761312f848c634e3028d70e6eb8ed39df7398`.
- All 55 migrations applied successfully; a second list reports none pending.
- SQL inventory reports 41 tables including internal tables and 55 migration
  receipts. Cloudflare's resource summary reports 39 user-facing tables.
- Database safety state: `enabled=0`, global pause `1`, emergency pause `1`,
  intake pause `1`, and follow-up pause `1`.
- Time Travel bookmark:
  `00000001-00000073-000050cf-ff3577eebe7c6028b7682a53a95b770d`.

## Console configuration

`wrangler.jsonc` contains an explicit `staging` environment bound to the staging
D1 only. It has:

- No cron triggers.
- No legacy self-service binding.
- Intake, queue, send, scrape, and detail-page work off.
- Daily intake and send caps set to zero.
- No Gmail, agent, MCP, or OpenAI runtime secret.

The console Worker and its staging auth secret are not deployed yet. Deploy only
after the exact source commit is recorded and the staging dry run is green.

## Pending resources

- R2 is not enabled on the Cloudflare account. Wrangler returned code 10042 and
  directed the owner to enable R2 in the dashboard. Do not accept a new paid
  commitment without confirming it fits the C$50 monthly ceiling.
- Workflows are created when the typed engine Worker is deployed; there are no
  Workflows in the account today.

## Rollback

Before traffic or test data exists, rollback is to remove the exact staging
Worker/Queues/D1 after confirming their identifiers above and preserving the
exports/checksums. Never delete a similarly named production or legacy resource.
