# Current status

Last updated: 2026-08-16 (America/Toronto)

## Plain-English status

The real repository has been recovered into the local workspace, renamed to
`rileyhins17/axiom-revenue-engine`, and made private. The first rebuild checkpoint
is locally verified: autonomous work defaults off, final email delivery requires
an exact human approval, the new evidence/quality kernel runs in shadow mode, and
the owner-facing Leads screen prioritizes quality instead of record age.

## Verified checkpoint

- Branch: `RileyHinsperger/axiom-revenue-engine-rebuild`
- Baseline commit: `7d23bfa3b0ddad8322051de7d586b787fb1692d3`
- Repository: private `rileyhins17/axiom-revenue-engine`
- Local OpenAI key: stored in ignored `.env.local`; value never printed
- Local migrations: all 55 apply, including the fail-closed lockdown, shadow
  Revenue Engine records, and content-bound outreach approval
- Current checkpoint verification: 160/160 tests, typecheck, zero-warning lint,
  safety scan, Cloudflare production build, and Wrangler deploy dry run pass
- Generated Cloudflare bindings replaced the stale hand-written environment file

## Safety and production

- Repository automation target: all autonomous switches off; follow-ups off;
  send cap zero.
- Even if send configuration is later enabled, the final Gmail call now blocks
  without an unexpired operator approval matching the exact message content.
- Production D1 pause records were the last known real stop. Production state must
  be re-inventoried and backed up before any deployment or migration.
- No live email, inbox sync, prospect contact, database migration, or Cloudflare
  deployment has been performed during this rebuild checkpoint.
- Legacy Worker/database identifiers still exist for rollback and data continuity.

## Current phase

Phase 1 — durable project foundation (in progress).

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

Still required for Phase 1:

- CI and protected manual production deployment verified in GitHub.
- Current production inventory/backup and explicit proof automation is stopped.
- Staging Worker/D1/R2/Queue/Workflow resources provisioned.
- Characterization coverage retained while first v2 modules are introduced.

## Budget

Approved runtime ceiling: C$50/month excluding ChatGPT/Codex. New paid providers
or overage billing are not yet authorized. Cost ledger implementation is pending.

## Blockers / owner actions

- Recreate and secure `riley@getaxiom.ca` and `aidan@getaxiom.ca` in Google
  Workspace; verify send/receive, MFA, SPF, DKIM, DMARC, and recovery ownership.
- Confirm who owns replies for each mailbox before the pilot.
- Later: label the first 50 KW leads strong/weak/wrong with a short reason.

## Next three actions

1. Push this checkpoint, open its draft PR, and verify the Linux GitHub CI result.
2. Export and inventory legacy production read-only, then provision isolated staging
   resources without changing production traffic.
3. Implement the website evidence/audit workflow and build the 50-lead KW
   evaluation set before connecting any new qualification to sending.

## Resume instructions

Read `AGENTS.md`, `docs/OWNER_CONTEXT.md`, this file, `docs/MASTER_PLAN.md`, and
`docs/GOTCHAS.md`; verify Git status and branch; then start with the first pending
action above. Do not infer live production state from this document if it is more
than one work cycle old—verify it read-only.
