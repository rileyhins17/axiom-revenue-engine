# Staging inventory

Last verified: 2026-08-22 (America/Toronto)

Staging is isolated from every legacy production resource. It has no schedule,
no producer, no consumer, no mailbox credentials, and no production traffic.

## Provisioned resources

- D1 `axiom-revenue-engine-staging`
  (`322fcf89-312c-44f0-b238-c4a348f6d6ad`), ENAM, approximately 0.95 MB.
- Queue `axiom-revenue-engine-jobs-staging`
  (`3f87b4d293ee414590279a89fba41348`).
- Dead-letter queue `axiom-revenue-engine-jobs-staging-dlq`
  (`a33464b4834e4b3b95659af0ceec2d9d`).
- Console Worker `axiom-revenue-engine-console-staging` at
  `https://axiom-revenue-engine-console-staging.aidan-magee2.workers.dev`.

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
- Post-deploy verification: zero `OutreachRun` rows and zero sent
  `OutreachEmail` rows. The exact table names are singular `OutreachRun` and
  `OutreachAutomationSetting`; legacy plural guesses are invalid.
- Time Travel bookmark:
  `00000001-00000073-000050cf-ff3577eebe7c6028b7682a53a95b770d`.

## Console configuration

`wrangler.jsonc` contains an explicit `staging` environment bound to the staging
D1 only. The exact configuration checkpoint is
`23ee458a997ddfd4df48f3f1f90581a6f4df3da0`. It has:

- No cron triggers.
- No legacy self-service binding.
- Intake, queue, send, scrape, and detail-page work off.
- Daily intake and send caps set to zero.
- No Gmail, agent, MCP, or OpenAI runtime secret.

The console was deployed from source commit
`7725098232829b7aca64a81d730db3b1729a5c7a` after the bundle-safety gate at
`ab5621cae3d463f935883705bd324ca92ef7e938` removed the local OpenAI key from
generated output and scanned 1,988 files.

- Initial code version: `ee966729-32e9-40f4-aa09-899ad9a27cd0`.
- Current version after adding the auth secret:
  `941b37bc-38e8-4c6c-9111-d475e9871727`.
- Current deployment: `c4bdd4af-85ec-4075-9a5a-7ded9f42add4` at 100%.
- Secret inventory contains only `BETTER_AUTH_SECRET`; its value was generated
  cryptographically, stored remotely, and never printed.
- `/sign-in` returns 200; unauthenticated automation health returns 401.
- No cron schedule, producer, consumer, OpenAI key, Gmail credential, or send
  route is enabled.

## Pending resources

- R2 is not enabled on the Cloudflare account. Wrangler returned code 10042 and
  directed the owner to enable R2 in the dashboard. Do not accept a new paid
  commitment without confirming it fits the C$50 monthly ceiling.
- The pre-provisioning storage contract is complete at source checkpoint
  `2621f3c1a790516507a78d89ea3ae06e7e738722`. If approved, the bucket must be
  private and use Standard storage, SHA-256 content keys, create-if-absent writes,
  a 30-day `shadow/30d/v1/` lifecycle, and a 180-day
  `qualification/180d/v1/` lifecycle. Outreach-active and legal-hold prefixes
  must not receive an automatic expiry. No bucket or lifecycle rule exists yet.
- Workflows are created when the typed engine Worker is deployed; there are no
  Workflows in the account today.

## Rollback

Before traffic or test data exists, console rollback is to move the staging
deployment to a previously recorded version or remove only the exact staging
Worker. Full teardown additionally removes the exact Queues/D1 after confirming
their identifiers above and preserving exports/checksums. Never delete a similarly
named production or legacy resource.
