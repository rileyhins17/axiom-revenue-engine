# Current status — Axiom Revenue Engine

**Updated:** 2026-09-21 (America/Toronto). **Work cycle:** M2 Task 4
HTML-only composition accepted on `f131bbe`; checkpoint verification completed
before this status commit.

## M2 Task 4 checkpoint

Task 4 is **APPROVED for the bounded local HTML-only implementation** after
independent review of `f131bbe` (`fix(revenue): close M2 receipt trust seams`).
The earlier review rounds rejected incomplete replay, expiry, policy, and
receipt-storage boundaries; the accepted tree closes those findings. The
workflow requires the exact Task 1 owner-approved chain, uses the Task 2
address-pinned transport and canonical robots policy, and writes only through
the conditional Task 3 local evidence store. It retains the complete transport
and source-policy proof, exact raw-byte digests, a four-page maximum, and
conservative HTML-only availability observations. It does not create a
qualification, contact, consent, outreach, or send decision. Sealed replay
requires current approval and independently reloaded durable page or blocked
evidence; failures without a durable witness remain unsealed in-memory results.

| Check on accepted tree | Result |
|---|---|
| Independent Task 4 review | APPROVED on `f131bbe` |
| `npm run check:safety` | PASS |
| `npm test` | PASS — 580 total, 578 passed, 0 failed, 2 Windows symlink-privilege skips |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |
| `npm run build:cloudflare` | PASS — 2,018 files sanitized, 0 local secret values |
| `npx wrangler deploy --env="" --dry-run --autoconfig false` | PASS — no upload; generated duplicate-`options` warnings were nonblocking |
| `npm run test:owner-ui` | PASS — desktop list 389 ms, dossier 496 ms, widths 1440/390, 6 WCAG pages, 0 external requests |

The root also ran an affected focused suite after the accepted commit: 54
total, 53 passed, 0 failed, and one Windows symlink-privilege skip. The
independent reviewer ran its broader affected suite: 64 total, 63 passed,
0 failed, and one such skip. The full suite result above was recorded on the
same accepted code by the implementation agent; the root's full suite on its
preceding repair was also green. The final build, dry run, safety, typecheck,
lint, focused tests, and owner UI were run by the root on `f131bbe`.

Task 5's design is independently **APPROVED, execution blocked on external
prerequisites**. The design is retained in ignored local planning artifacts.
It requires a complete trusted Task 4 receipt reloader and the separately
applied, independently verified local migration 0069 and matching `0054-0069`
database setup receipt. Task 5 must return a zero-write `EXTERNAL_BLOCKER`
until those proofs exist; it does not create or migrate a database. Task 6
orchestration and the exact ten-business owner packet remain ahead of any
supervised real-source run. No real business was captured in this checkpoint.

Production and staging were not inspected or changed. Automation, follow-ups,
contact review, provider operations, deployment, migration, outreach, and send
remain off or unverified as applicable. This checkpoint made no live prospect
request, provider/account/DNS change, database migration, deployment, send,
or spend; runtime remains capped at C$50/month. The zero-paid-mailbox decision
remains in force: Cloudflare Email Routing inbound and separately gated free
Resend or free owner-only outbound/reply are the only mail candidates. There
is no Google Workspace or paid-mailbox path in scope.

The next three concrete actions are:

1. Specify, implement, and independently review the trusted Task 4 durable
   receipt reloader for Task 5's input boundary, with zero-network replay tests.
2. Prepare Task 8's migration 0069 and local setup/backup/rollback evidence
   under its separate release gate; do not apply a remote migration.
3. Implement Task 5's HTML-only, zero-authority assessment materialization
   against those exact prerequisites, then prepare Task 6 and the exact
   ten-business owner decision packet.

## M2 foundation checkpoint

The verified M2 foundation checkpoint is the exact committed tree at
`65cb2d5` (`fix(revenue): reconcile M2 policy receipts`). The three bounded
foundation gates are approved:

| Foundation | Result |
|---|---|
| Task 1 authorization chain | **APPROVED** — canonical Task 1 authorization and owner-envelope binding are required before publication. |
| Task 2 address-pinned transport and robots policy | **APPROVED** — DNS classification, direct-IP transport, Host/SNI binding, redirect and body limits, robots policy, abort disposal, and immutable receipts are enforced. |
| Task 3 conditional evidence store | **APPROVED** — publication is conditional on the canonical authorization, source-policy decision, complete receipt chain, and verified filesystem identity. |

The complete checkpoint verification sequence was:

| Check | Result |
|---|---|
| `npm run check:safety` | PASS |
| `npm test` | PASS — 565 total, 563 passed, 0 failed, 2 skipped; both skips are Windows symlink-privilege cases |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |
| `npm run build:cloudflare` | PASS — 2018 files sanitized, 0 local secret values |
| `npx wrangler deploy --env="" --dry-run --autoconfig false` | PASS — no upload; generated duplicate-options warnings were nonblocking |
| `npm run test:owner-ui` | PASS — desktop list 382 ms, dossier 568 ms, widths 1440/390, WCAG pages 6, external requests 0 |

Current production, staging, and automation state is unchanged and off. This
checkpoint performed no network, provider, DNS, database, migration,
deployment, send, or spend action. Authority, cost, network, provider,
outreach, and send remain zero/off as applicable, and
`contactReview.status` remains `NOT_RECORDED`.

The zero-cost mailbox decision remains a hard gate: there are **zero paid
mailbox seats**. The only in-scope mail paths are Cloudflare Email Routing for
inbound forwarding and a separately gated Resend Free or separately reviewed
free owner-only send-as path for outbound/reply. If those free paths cannot
satisfy reply ownership and privacy gates, mail activation remains blocked.
Paid mailboxes and Workspace are out of scope unless Riley explicitly reverses
that decision.

The foundation gate covered only local M2 prerequisites. The Task 4 gate above
adds bounded HTML-only composition, without authorizing real-business capture.
The remaining real-run blockers are the Task 5/6/8 implementation and setup
proofs, an exact-ten research packet with rights and owner approval, and
supervised one-then-ten business execution.

## Owner-facing state

M1 now has one fresh ignored local synthetic dossier produced through the actual
`npm run kw:execute-m1-dossier` CLI. The first run used the canonical source,
materialization, manifest, and assessment invocation inputs and wrote the real
local website checkpoint, assessment checkpoint, report, and SQLite state. An
unchanged second run used the same paths and IDs and replayed all stages exactly.

The retained artifact set is under
`data/kw-evaluation/m1-checkpoint-2026-09-21-96a0277-*`:

- [source plan](../data/kw-evaluation/m1-checkpoint-2026-09-21-96a0277-source.json),
  [materialization](../data/kw-evaluation/m1-checkpoint-2026-09-21-96a0277-materialization.json),
  [manifest](../data/kw-evaluation/m1-checkpoint-2026-09-21-96a0277-manifest.json),
  and [assessment invocation](../data/kw-evaluation/m1-checkpoint-2026-09-21-96a0277-invocation.json);
- [website checkpoint](../data/kw-evaluation/m1-checkpoint-2026-09-21-96a0277-website-checkpoint.json),
  [assessment checkpoint](../data/kw-evaluation/m1-checkpoint-2026-09-21-96a0277-assessment-checkpoint.json),
  [report](../data/kw-evaluation/m1-checkpoint-2026-09-21-96a0277-report.json), and
  [SQLite database](../data/kw-evaluation/m1-checkpoint-2026-09-21-96a0277.sqlite);
- [first CLI stdout](../data/kw-evaluation/m1-checkpoint-2026-09-21-96a0277-first.stdout.json),
  [second CLI stdout](../data/kw-evaluation/m1-checkpoint-2026-09-21-96a0277-second.stdout.json),
  and the [machine-readable verification receipt](../data/kw-evaluation/m1-checkpoint-2026-09-21-96a0277-verification.json).

The retained receipt independently verifies exact byte hashes before and after
replay, complete `Revenue*` row-count maps, stable IDs/digests, first-run fresh
paths, second-run `EXACT_REPLAY` paths, and zero second-run assessment inserts.
The exact durable identities are:

| Artifact | ID | Digest |
|---|---|---|
| Website checkpoint | `kw-shadow-progress:9a0a2874312fbff0d21ad88f5f42199903c458ad7c132c13c36054d89dd221bc` | `9a0a2874312fbff0d21ad88f5f42199903c458ad7c132c13c36054d89dd221bc` |
| Assessment checkpoint | `kw-shadow-progress:5554730a1bdcace5edd7feb47c7ef7e282cb2154cbe66ad6fb4851e5592adf8b` | `5554730a1bdcace5edd7feb47c7ef7e282cb2154cbe66ad6fb4851e5592adf8b` |
| Assessment receipt | `assessment:a3c5c139eb13a3b28211d18ae53a94c9b2c15baf370e0e3da70b78a634ca46f7` | `1070b1f40b10ebd325b55a5efd5857f615e78d95ae7a9d5c02c9d9f8c21f6266` |
| M1 report | `private-kw-m1-dossier:cf44b2168822296e6868c8577f85f596935b88c3908390278fdd5467fa4a9d0c` | `cf44b2168822296e6868c8577f85f596935b88c3908390278fdd5467fa4a9d0c` |

## Completed gate

The local M1 checkpoint gate is complete for the bounded synthetic case. The
first CLI result reported fresh source and eligibility commits, a fresh
assessment commit, and fresh writes for both progress checkpoints and the
report. The identical retry reported `EXACT_REPLAY` for all six paths and zero
`websiteSnapshots`, `evidenceClaims`, `qualificationSnapshots`, and
`assessmentReceipts` in `assessmentInsertedRows`. The complete independent
`Revenue*` count map and all retained output/database SHA-256 hashes were equal
before and after replay.

The report authority is `synthetic=true`, `fixtureOnly=true`,
`workerRuntimeConnected=false`, `networkOperationsPerformed=0`,
`providerOperationsAuthorized=0`, contact discovery and verification false,
consent false, qualification false, outreach false, send false,
`costAuthorizedUsd=0`, and `contactReview.state=NOT_RECORDED`. The one true
`localAssessmentMutationAuthorized` flag covers only the explicitly approved
local shadow SQLite write. No provider, network, mailbox, prospect, deployment,
remote migration, outreach, send, or spend action occurred.

The root checkpoint owner completed the final M1 verification sequence on the
exact committed candidate `fe921824439cda6b485cf11966977d30829d7133`:

| Check | Result |
|---|---|
| `npm run check:safety` | PASS |
| `npm test` | PASS — 511 passed, 0 failed, 1 skipped, 512 total; the skip is the Windows developer-mode symlink privilege case |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |
| `npm run build:cloudflare` | PASS — bundle sanitizer removed 0 local secret values and scanned 2018 files |
| `npx wrangler deploy --env="" --dry-run --autoconfig false` | PASS — no upload after the custom rebuild; generated-bundle duplicate `options` warnings were non-blocking |
| `npm run test:owner-ui` | PASS — desktop list 854 ms, dossier 464 ms, widths 1440/390, WCAG pages 6, external requests 0 |

M1 is complete for the bounded synthetic offline scope. The verification
sequence confirms the local implementation, build safety, dry-run packaging,
and owner UI acceptance; it does not establish a live acquisition loop or
real-business readiness.

## Production, staging, and automation

Production and staging were not inspected or changed. The Worker remains
disconnected, automation and follow-ups remain off, and no provider, mailbox,
source account, contact system, or spend capability is verified. The M1 artifact
does not establish real-business evidence, production or staging readiness, or
M2 readiness. The runtime ceiling remains C$50/month and this checkpoint spent
zero dollars.

Public DNS was inspected read-only on 2026-09-21. `getaxiom.ca` publishes the
Cloudflare Email Routing MX set (`route1/2/3.mx.cloudflare.net`), Cloudflare SPF,
DMARC quarantine, and a Resend domain-verification token. This supports the
zero-paid-mailbox target of Cloudflare inbound forwarding to existing owner
destinations plus a separately gated Resend outbound/reply adapter. It does not
prove active Cloudflare destinations/rules, a Resend account or API key, sender
verification, complete DKIM (two `resend._domainkey` TXT values are ambiguous),
or send readiness. No DNS/provider/account mutation or mail operation occurred.

## Owner decisions and blockers

Owner decision recorded: the mail architecture has zero paid mailbox seats.
Cloudflare Email Routing remains the inbound route and gated Resend Free or a
separately reviewed free owner-only send-as route are the only outbound/reply
options in scope. If those zero-cost routes cannot satisfy reply ownership or
privacy gates, mail activation remains blocked; paid mailboxes and Workspace
are out of scope unless Riley explicitly reverses this decision.
Before any real-source work, the owner must separately decide the source and
privacy scope, accounts and rights, backup/rollback plan, and the exact release
gate. M2 is blocked by the absence of an authorized real-source evidence packet,
verified provider and mailbox readiness, live runtime proof, an owner-approved
ten-business research cohort, and the separate contact/consent/reply gates.
M4 also remains blocked on verified Cloudflare destination ownership/rules,
Resend domain/key/webhook readiness or a separately reviewed free owner-only
send-as route, legal sender identity, suppression/unsubscribe handling, and
sink-tested human-triggered replies. Cloudflare forwarding cannot itself send
replies from the custom domain; legacy Gmail OAuth/send/sync remains quarantined
from the v2 target.

## M1 verification result

The exact-commit M1 verification gate is complete for the synthetic offline
scope. The retained artifact proves only the bounded local path and its
replay/restart behavior. Production, staging, provider, contact, outreach,
deployment, and spend facts remain unknown or off as stated above.

## Next three concrete actions

1. Prepare M2's owner decision packet for real-source rights, privacy, accounts,
   backup/rollback, ten-business scope, and the explicit release gate without
   activating any provider or contact path.
2. Record the owner's approval or rejection of the M2 release and activation
   gates, including provider, contact, privacy, and budget decisions, without
   activating any capability.
3. If M2 is approved, implement and verify its bounded capability packet while
   keeping provider, contact, deployment, outreach, send, and spend actions
   separately gated.
