# Axiom Revenue Engine

Axiom Web's private system for finding worthwhile local website opportunities, preserving evidence, preparing legitimate outreach, managing replies and next actions, and learning which work becomes customers and collected revenue.

## Current state

The owner Businesses view separates businesses that meet the existing qualification
criteria from records that still need qualification. Only current
`READY_FOR_REVIEW` records with confirmed business independence count as qualified
for review. A recorded contact remains visible on other records, without being
presented as the next manual outreach task. Scores and qualification thresholds are unchanged; even
a qualified review record grants no outreach or send authority.

The application is in a controlled rebuild. M1 verifies one synthetic business through the real local source, website, eligibility, assessment, owner-dossier, checkpoint and report writers, with exact durable replay. The retained checkpoint is `data/kw-evaluation/m1-checkpoint-2026-09-21-b42094a-fresh4-*`; earlier M1 artifact names are historical. Current implementation work is M2's bounded local HTML route, including the separately gated database setup and recovery runner. Synthetic proof does not establish a live acquisition loop.

The checkpoint is synthetic, offline, and disconnected from providers, network access, contacts, qualification execution, outreach, sending, and spend. Its report records `fixtureOnly=true`, `synthetic=true`, zero network/provider operations, all contact/consent/qualification/outreach/send authority false, `costAuthorizedUsd=0`, and `contactReview.state=NOT_RECORDED`. `localAssessmentMutationAuthorized=true` covers only the explicitly approved local shadow SQLite write. Riley has no OpenAI API keys. Existing adapter code is not a connected service. Jev is an optional later experiment, not a prerequisite for a useful deterministic/manual pilot. Public DNS observed on 2026-09-21 supports Cloudflare root Email Routing MX/SPF and a published Resend verification token, but does not prove active forwarding, a Resend account/key, sender verification, complete DKIM, or send readiness. The zero-paid-mailbox inbound target is Cloudflare forwarding to existing owner destinations. The current [Resend policy](https://resend.com/legal/acceptable-use) prohibits unsolicited cold outreach, so its separately gated adapter is not a route for cold first touches.

Start with [STATUS](docs/STATUS.md) for the verified commit, current artifacts, test evidence and blockers. The local setup command, `npm run kw:prepare-m2-database -- <recorded-release-path>`, defaults to preflight. Applying 0069 requires explicit `--apply` and a current recorded setup release; recovery requires a separate recorded rollback release. Follow the [runbook](docs/RUNBOOK.md#m2-local-database-setup-and-recovery). The assessment command, `npm run kw:assess-m2-html -- <run.json> <business-id>`, prepares a separate owner decision from already captured HTML evidence. Its execution and durable verification modes are documented in the [HTML assessment runbook](docs/RUNBOOK.md#m2-local-html-assessment-and-restart). This path produces a private JSON owner dossier with HTML limitations and no contact authority. Production, staging, provider, contact, outreach and spend state remain unknown or off. M2's real one-then-ten evaluation and subsequent milestones are still incomplete.

The local Quality Lab now takes a **blind dossier file** first and a separate
**engine assessment file** only after the owner has judged and downloaded a
first pass for all 50 businesses. The local `kw:split-owner-labeling` command
derives both from the existing immutable checkpoint; the original is still used
to record final review batches. This closes the browser-payload score leak in
the synthetic owner workflow, but 50 real M3 dossiers and owner judgments have
not been completed. See the [owner-labeling runbook](docs/RUNBOOK.md#resumable-kw-owner-labelling-checkpoint).

Preparing a current M2 capture packet requires `--review-policy` with explicit
dates and the ten source-policy decisions. See the [preparation runbook](docs/RUNBOOK.md#m2-research-scope-and-current-authorization-preparation).
Preparation cannot approve the packet or infer source rights from a public URL.
The one-request capture command, `npm run kw:capture-m2-html -- <request.json>`,
defaults to preflight. Explicit `--execute` requires the recorded capture
approval; `--verify` reloads saved evidence without network access. Its input and
operating limits are in the same preparation runbook.
The [initial public-research scope](docs/reviews/2026-09-21-m2-public-research-scope.md)
produced ten proposed evaluation businesses. Codex completed the delegated
identity selection in an ignored private ledger and saved a ten-record shadow
manifest. This selection does not assess website need or authorize capture or
contact; see [current status](docs/STATUS.md) for the exact scope and blockers.

The private ten-business research packet now has a separate owner decision
sheet and a no-network `npm run kw:prepare-m2-owner-decisions` preparer. It
requires an explicit disposition for each proposed business and an exact
reviewed source plan before it can write a plan-only shadow selection. The two
documented access-blocked sites cannot enter that selection; they need reviewed
replacements or a separately designed partial cohort. Nothing in this step
authorizes capture or contact. See [the M2 decision runbook](docs/RUNBOOK.md#m2-research-scope-and-current-authorization-preparation).

The older local **Businesses → Review 10 businesses** screen remains available
for an owner who specifically wants to make a new owner-attributed decision.
It is no longer promoted as a next step because the current ten identity
choices were made and recorded by Codex under Riley's delegation. The server
still verifies the packet and actual reviewer on that older path; the
Codex-attributed private ledger is separate. Neither path authorizes capture,
contact, or sending. The local screen is unavailable on Cloudflare.

For sealed evidence that needs more research, the same assessment command saves
a research report with missing pages and limitations, without an assessment
approval or database write. Sealed policy blocks return their existing receipt
and allow the ordered run to continue. Selected-page HTTP failures and transport
errors now retain strict v2 partial receipts and research reports. Failed
homepages, unsupported stream/redirect failures and storage conflicts remain
unsealed and stop without a report.

The admin-only `/leads/m2` Business Review independently verifies saved local
evidence. Its searchable business list, plain-language status, selected website
review, page clues and next step let an owner review one business at a time on
desktop or mobile. On phones, opening a business goes directly to its review
instead of repeating the queue overview. Derived-only page clues expand on
demand; visual quality and qualification remain unknown. The page does not
retain HTML, contact values or screenshots in that mode. It does not establish
website fit or outreach readiness.
It is disabled by default and unavailable on Cloudflare. A Node server with an
existing approved local run can set `AXIOM_M2_LOCAL_REVIEW_ENABLED=1` and
`AXIOM_M2_LOCAL_REVIEW_RUN=data/kw-evaluation/<run>.json`. The equivalent read-only
CLI is `npm run kw:assess-m2-html -- data/kw-evaluation/<run>.json --inspect`.
Neither view approves assessments or publishes missing reports. See the
[console runbook](docs/RUNBOOK.md#m2-local-owner-research-console) for setup and limits.

## Read the plan

| Document | Purpose |
|---|---|
| [Master plan](docs/MASTER_PLAN.md) | Business outcome, architecture, complete revenue loop, alternatives and boundaries |
| [Delivery plan](docs/DELIVERY_PLAN.md) | M0–M7 milestones, dependencies, code seams and observable exit gates |
| [Operating model](docs/OPERATING_MODEL.md) | Owner capacity, contact/consent, approvals, reply handling, CRM and retention |
| [Provider and budget plan](docs/PROVIDER_AND_BUDGET_PLAN.md) | Built/connected/authorized/verified inventory and realistic C$50 scenarios |
| [Validation plan](docs/VALIDATION_PLAN.md) | Failure cases, evaluation, verification, release and rollback |
| [Owner context](docs/OWNER_CONTEXT.md) | Private business facts, responsibilities and constraints |
| [Runbook](docs/RUNBOOK.md) | Existing guarded operating and release procedures |
| [Data dictionary](docs/DATA_DICTIONARY.md) | Implemented and proposed record vocabulary |
| [ADRs](docs/adr/0039-deliver-owner-workflows-before-optional-ai-and-autonomy.md) | Recorded decisions and relationship to prior implementation contracts |
| [Historical archive](docs/archive/2026-09-20/INDEX.md) | Previous master plan, accumulated status, README and blueprint |

The current sequence is one complete offline dossier, ten reviewed real-business dossiers, a fixed 50-business quality evaluation, contact/approval/reply readiness, a small separately approved outreach pilot, and a proven opportunity-to-customer loop. Selective automation follows evidence of quality and owner capacity.

## Owner experience

The owner navigation is Today, Businesses, Follow-through, Clients and Settings.
The decision-first workspace leads with plain-language actions and keeps
operator diagnostics behind a disclosure. The private business decision flow
and saved-research console are admin-only. Each page must distinguish
available, blocked, stale, empty and unavailable states.

Today shows replies and follow-ups when they need attention or their status
cannot be read; otherwise it shows a compact no-actions state. It no longer
asks an owner to repeat the completed ten-name selection. Email readiness lives
in Settings, while legacy operator metrics sit behind Operator details.
The navigation does not use lead-score badges as if they counted approved
business decisions. Today does not present Gmail OAuth as the path to the
selected zero-paid-mailbox design. Missing critical status reads appear as
unavailable; a dashboard warning is not a runtime stop or proof of provider
readiness.

Businesses groups saved assessments as ready for a decision, needing another
look, or stopped. It does not present the ten-name identity selection as an
owner task.
Each row shows why it is there and opens its evidence. The old ranking
and detailed scores sit in a closed advanced preview. The admin-only saved-research
view shows the selected business and a short summary of captured pages; page
sources sit under a disclosure. A business detail leads with one supported
website finding, its source, open questions when recorded, and the next owner
action. Owner stop and task controls follow. Contact-review status stays
visible; recorded routes, history, and the full audit are available under
**Research details** when needed.
A score or suggested contact route is not a contact decision. Follow-through
starts with client work and the automation stop, and labels the mail route
unverified; it does not surface legacy Gmail connection or send controls.
Clients distinguishes recorded
recurring estimates from cash received. Settings reads emergency state without
activating or synchronizing mailbox records, shows an unknown state when the
read fails, and does not offer Gmail OAuth. Only an admin can change the stop;
the unknown state permits an engage request but never a clear request. These
owner screens do not authorize outbound work.

A lead should answer: who is this, what is actually wrong, why is it worth attention, what is uncertain, how may we contact them, and who acts next? Reachability is separate from account quality. Email automation requires verified addresses, lawful consent, and a provider that permits the exact use. Cloudflare forwarding handles inbound mail only. Resend requires explicit opt-in under its current policy, and [Cloudflare Email Service](https://developers.cloudflare.com/email-service/reference/faq/) restricts outbound to transactional mail. No cold first-touch email route is selected or live. Calls, forms, and social DMs remain separately governed manual tasks.

The current v2 dossier source also includes a manual owner-task panel. On a
current business, an authenticated owner can save an action with Riley or Aidan
and a Toronto due time, then mark it complete or cancel it. Task records require
migration 0071 in the app database; without it the panel reports unavailable
while the evidence dossier remains readable. Saving a task does not approve a
contact, send a message, schedule automation, or satisfy M4 mail/reply gates.

## Local development

Read `AGENTS.md` and the required documents before changes. Use Node.js 22+, npm and the pinned project dependencies. Install with `npm ci` only when needed. Create ignored local configuration from the value-free examples; local auth needs a suitable `BETTER_AUTH_SECRET`. Provider API keys are optional for fixture development and must not be supplied merely to run tests.

`npm run dev` starts the console. `npm run cf:engine:dev` inspects the locked engine scaffold. Neither command is permission to contact a provider, run real acquisition, sync an inbox, send, migrate remotely or deploy. Existing guarded private-KW commands are documented in the runbook; their approval and trusted-input requirements remain.

Public operator signup is disabled. The isolated owner-browser test alone can
create a synthetic account on loopback with its process-only fixture flag;
Cloudflare cannot use that path. A fresh live environment needs a separately
verified private admin bootstrap. Legacy Gmail delivery and the deployed
Browser Rendering crawler are also hard-disabled at their entry points. The
manual Gmail reply route checks stops and suppressions as a second boundary.
These release-containment decisions are recorded in [ADR 0054](docs/adr/0054-quarantine-legacy-public-signup-gmail-and-browser-crawler.md).

On an authenticated v2 lead dossier, the **Do not contact** panel records one
manual business-level owner stop with a reason and note. The saved stop blocks
route presentation in both the dossier and ranked list. An unreadable stop
state also blocks route presentation. This requires migration 0072 in the
target environment; the committed migration is not a deployed schema. It does
not replace contact-level suppression, legal/consent review, or legacy-history
reconciliation, and it does not enable sending.

The same dossier has a separate, closed **Email do-not-contact records** panel
for an owner who personally observes an unsubscribe request, complaint, or
bounce. It checks one saved email contact at a time and records a permanent
local stop with reason, observed time, and short summary; it must not contain
the message body. A later contact row with the same normalized address at that
business inherits the stop. This requires migration 0073 and has not been
migrated or deployed. It does not implement a provider webhook, legacy/global
suppression reconciliation, or an outbound send gate. See
[ADR 0049](docs/adr/0049-record-exact-email-suppression-before-mail-activation.md).

The dossier also has a compact **Observed email replies** panel for Riley or
Aidan to record a response they personally see in an existing inbox. Select
the exact saved email contact, enter a short factual summary and received time,
then assign one owner, next action, and Toronto due time. Saving creates one
linked Owner task atomically; Today shows open actions and the business detail
retains completed or cancelled reply history. No message body, inbox sync, or
send occurs. Do-not-contact requests belong in the email stop control, and a
stopped business or suppressed contact cannot acquire a new reply task. This
local workflow requires migration 0074 and has not been migrated or deployed;
it does not prove an actual forwarding destination or reply route. See
[ADR 0051](docs/adr/0051-link-manually-observed-replies-to-owner-actions.md).

The M4 legacy-history report can compare old suppressions, contact attempts,
bounces, and replies with v2 business identities from one private, standalone
SQLite snapshot. It runs offline, proposes identity candidates for owner review,
and leaves unresolved history blocked. No real snapshot has been processed or
imported yet. See the [offline reconciliation runbook](docs/RUNBOOK.md#review-legacy-contact-history-offline-before-v2-outreach)
for the exact local command and limits.

### Local M1 offline dossier checkpoint

The integrated M1 CLI accepts only the bounded direct-child paths and identities below. Prepare a new local SQLite with the canonical private-KW migrations, generate the canonical synthetic source/materialization/manifest/invocation inputs, and then run the same command twice without changing any path or ID:

```powershell
npm run kw:execute-m1-dossier -- --source-plan data/kw-evaluation/m1-checkpoint-2026-09-21-96a0277-source.json --materialization data/kw-evaluation/m1-checkpoint-2026-09-21-96a0277-materialization.json --manifest data/kw-evaluation/m1-checkpoint-2026-09-21-96a0277-manifest.json --invocation data/kw-evaluation/m1-checkpoint-2026-09-21-96a0277-invocation.json --website-checkpoint data/kw-evaluation/m1-checkpoint-2026-09-21-96a0277-website-checkpoint.json --assessment-checkpoint data/kw-evaluation/m1-checkpoint-2026-09-21-96a0277-assessment-checkpoint.json --report data/kw-evaluation/m1-checkpoint-2026-09-21-96a0277-report.json --database data/kw-evaluation/m1-checkpoint-2026-09-21-96a0277.sqlite --business-id business:d4d99cc1cfb327216db2655e --evaluation-candidate-id evaluation-candidate:098c9b31dcbb8fd71e641ad1
```

The first run must report fresh local commits/writes. The unchanged retry must report `EXACT_REPLAY` for source, eligibility, assessment, both checkpoint outputs, and the report, with zero assessment `insertedRows`. Preserve the three JSON inputs, invocation, website checkpoint, assessment checkpoint, report, SQLite file, both CLI stdout captures, and the machine-readable `m1-checkpoint-2026-09-21-96a0277-verification.json` receipt. This procedure is synthetic, local SQLite only, and performs no provider, network, contact, qualification, outreach, send, migration, deployment, or spend action.

Secrets belong in ignored local files or approved provider secret stores. Cloudflare builds remove local environment fallback values and scan the bundle before upload. Never commit private seed files, screenshots, inbox contents, exports, databases, tokens or production backups.

## Verification

```powershell
npm run check:safety
npm test
npm run typecheck
npm run lint
npm run build:cloudflare
npx wrangler deploy --env="" --dry-run --autoconfig false
```

Run `npm run test:owner-ui` only after all build/dry-run commands exit; they share `.next`. The test requires the completed production build and starts it with `next start` against synthetic databases; it does not start a development compiler. Use fake providers, isolated databases and mail sinks. Local results, exact-commit Linux CI, staging smoke and production evidence are separate gates. See STATUS for the current results; a successful build does not cancel failing tests.

## Deployment and data safety

Default automation stays off. No production send, inbox sync, prospect form submission, remote migration or deployment may be used as a test. Releases require an exact candidate, current backup, restore/rollback plan, passed gates and owner authorization for the actual environment. Existing staged release packets retain their own hashes and approval scope. `npm run deploy:production` and `npm run db:migrate:production` currently stop before Wrangler: the default console config points at the legacy production D1. See [ADR 0055](docs/adr/0055-block-default-production-release-against-legacy-d1.md) for the isolated-target requirements and the [staging schema runbook](docs/runbooks/STAGING_SCHEMA_0055_TO_0074.md) for the separate 0055-to-0074 preparation. The [pending migration-and-console packet](docs/releases/staging/2026-09-23-migration-console-pending.json) is checked locally with `npm run staging:verify-migration-console-release -- docs/releases/staging/2026-09-23-migration-console-pending.json`; it grants no live authority. Build from a clean release checkout: Next can copy ignored local evaluation files into a Worker bundle, and the build now fails if its final bundle contains them ([ADR 0056](docs/adr/0056-exclude-private-local-files-from-cloudflare-build.md)).

Keep the legacy system read-only/rollback-capable until reconciliation and the post-cutover stability window are complete. Preserve suppression and contact history across identity changes and migration. Do not import old leads as freshly qualified prospects.
