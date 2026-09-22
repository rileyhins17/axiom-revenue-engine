# Axiom Revenue Engine

Axiom Web's private system for finding worthwhile local website opportunities, preserving evidence, preparing legitimate outreach, managing replies and next actions, and learning which work becomes customers and collected revenue.

## Current state

The application is in a controlled rebuild. M1 verifies one synthetic business through the real local source, website, eligibility, assessment, owner-dossier, checkpoint and report writers, with exact durable replay. The retained checkpoint is `data/kw-evaluation/m1-checkpoint-2026-09-21-b42094a-fresh4-*`; earlier M1 artifact names are historical. Current implementation work is M2's bounded local HTML route, including the separately gated database setup and recovery runner. Synthetic proof does not establish a live acquisition loop.

The checkpoint is synthetic, offline, and disconnected from providers, network access, contacts, qualification execution, outreach, sending, and spend. Its report records `fixtureOnly=true`, `synthetic=true`, zero network/provider operations, all contact/consent/qualification/outreach/send authority false, `costAuthorizedUsd=0`, and `contactReview.state=NOT_RECORDED`. `localAssessmentMutationAuthorized=true` covers only the explicitly approved local shadow SQLite write. Riley has no OpenAI API keys. Existing adapter code is not a connected service. Jev is an optional later experiment, not a prerequisite for a useful deterministic/manual pilot. Public DNS observed on 2026-09-21 supports Cloudflare root Email Routing MX/SPF and a published Resend verification token, but does not prove active forwarding, a Resend account/key, sender verification, complete DKIM, or send readiness. The target mail route has zero paid mailbox seats: Cloudflare forwards inbound mail to existing owner destinations and a typed Resend outbound/reply adapter remains separately gated.

Start with [STATUS](docs/STATUS.md) for the verified commit, current artifacts, test evidence and blockers. The local setup command, `npm run kw:prepare-m2-database -- <recorded-release-path>`, defaults to preflight. Applying 0069 requires explicit `--apply` and a current recorded setup release; recovery requires a separate recorded rollback release. Follow the [runbook](docs/RUNBOOK.md#m2-local-database-setup-and-recovery). The assessment command, `npm run kw:assess-m2-html -- <run.json> <business-id>`, prepares a separate owner decision from already captured HTML evidence. Its execution and durable verification modes are documented in the [HTML assessment runbook](docs/RUNBOOK.md#m2-local-html-assessment-and-restart). This path produces a private JSON owner dossier with HTML limitations and no contact authority. Production, staging, provider, contact, outreach and spend state remain unknown or off. M2's real one-then-ten evaluation and subsequent milestones are still incomplete.

Preparing a current M2 capture packet requires `--review-policy` with explicit
dates and the ten source-policy decisions. See the [preparation runbook](docs/RUNBOOK.md#m2-research-scope-and-current-authorization-preparation).
Preparation cannot approve the packet or infer source rights from a public URL.
The one-request capture command, `npm run kw:capture-m2-html -- <request.json>`,
defaults to preflight. Explicit `--execute` requires the recorded capture
approval; `--verify` reloads saved evidence without network access. Its input and
operating limits are in the same preparation runbook.
The [initial public-research scope](docs/reviews/2026-09-21-m2-public-research-scope.md)
is prepared for a separate owner decision.

For sealed evidence that needs more research, the same assessment command saves
a research report with missing pages and limitations, without an assessment
approval or database write. Sealed policy blocks return their existing receipt
and allow the ordered run to continue. Selected-page HTTP failures and transport
errors now retain strict v2 partial receipts and research reports. Failed
homepages, unsupported stream/redirect failures and storage conflicts remain
unsealed and stop without a report.

The admin-only `/leads/m2` research console independently verifies saved local
evidence and shows each selected business, page failures and next review step.
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

The intended navigation is Today, Leads, Outreach, Revenue and System. Leads/dossier and a file-based Quality Lab already exist in source; other areas still include legacy or future functionality. Each page must distinguish available, blocked, stale, empty and unavailable states.

A lead should answer: who is this, what is actually wrong, why is it worth attention, what is uncertain, how may we contact them, and who acts next? Reachability is separate from account quality. Only verified email may eventually automate; the zero-paid-mailbox target uses Cloudflare inbound forwarding to existing owner destinations and a separately gated Resend outbound route. Cloudflare forwarding cannot itself send custom-domain replies; M4 must prove the human-triggered provider reply flow or a separately reviewed owner-only send-as route. Calls, forms and social DMs remain manual.

## Local development

Read `AGENTS.md` and the required documents before changes. Use Node.js 22+, npm and the pinned project dependencies. Install with `npm ci` only when needed. Create ignored local configuration from the value-free examples; local auth needs a suitable `BETTER_AUTH_SECRET`. Provider API keys are optional for fixture development and must not be supplied merely to run tests.

`npm run dev` starts the console. `npm run cf:engine:dev` inspects the locked engine scaffold. Neither command is permission to contact a provider, run real acquisition, sync an inbox, send, migrate remotely or deploy. Existing guarded private-KW commands are documented in the runbook; their approval and trusted-input requirements remain.

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

Default automation stays off. No production send, inbox sync, prospect form submission, remote migration or deployment may be used as a test. Releases require an exact candidate, current backup, restore/rollback plan, passed gates and owner authorization for the actual environment. Existing staged release packets retain their own hashes and approval scope.

Keep the legacy system read-only/rollback-capable until reconciliation and the post-cutover stability window are complete. Preserve suppression and contact history across identity changes and migration. Do not import old leads as freshly qualified prospects.
