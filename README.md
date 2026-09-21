# Axiom Revenue Engine

Axiom Web's private system for finding worthwhile local website opportunities, preserving evidence, preparing legitimate outreach, managing replies and next actions, and learning which work becomes customers and collected revenue.

## Current state

The application is in a controlled rebuild. The 2026-09-20 master-plan revision is **documentation only**. New execution, providers, mailboxes, AI, deployments and outreach were not enabled. The typed engine Worker remains deliberately inert; substantial evidence and owner-UI code exists, but the new end-to-end acquisition loop is not operational.

Riley has no OpenAI API keys. Existing adapter code is not a connected service. Jev is an optional later experiment, not a prerequisite for a useful deterministic/manual pilot.

Start with [STATUS](docs/STATUS.md) for current evidence and failures. The verification baseline currently includes 22 time-expired fixture failures and a separate owner-UI warmup timeout; it is not release eligible. Historical production/staging records were not refreshed remotely in this planning cycle.

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

A lead should answer: who is this, what is actually wrong, why is it worth attention, what is uncertain, how may we contact them, and who acts next? Reachability is separate from account quality. Only verified email may eventually automate; calls, forms and social DMs remain manual.

## Local development

Read `AGENTS.md` and the required documents before changes. Use Node.js 22+, npm and the pinned project dependencies. Install with `npm ci` only when needed. Create ignored local configuration from the value-free examples; local auth needs a suitable `BETTER_AUTH_SECRET`. Provider API keys are optional for fixture development and must not be supplied merely to run tests.

`npm run dev` starts the console. `npm run cf:engine:dev` inspects the locked engine scaffold. Neither command is permission to contact a provider, run real acquisition, sync an inbox, send, migrate remotely or deploy. Existing guarded private-KW commands are documented in the runbook; their approval and trusted-input requirements remain.

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

Run `npm run test:owner-ui` only after all build/dry-run commands exit; they share `.next`. Use fake providers, isolated databases and mail sinks. Local results, exact-commit Linux CI, staging smoke and production evidence are separate gates. See STATUS for the current results; a successful build does not cancel failing tests.

## Deployment and data safety

Default automation stays off. No production send, inbox sync, prospect form submission, remote migration or deployment may be used as a test. Releases require an exact candidate, current backup, restore/rollback plan, passed gates and owner authorization for the actual environment. Existing staged release packets retain their own hashes and approval scope.

Keep the legacy system read-only/rollback-capable until reconciliation and the post-cutover stability window are complete. Preserve suppression and contact history across identity changes and migration. Do not import old leads as freshly qualified prospects.
