# Current status — Axiom Revenue Engine

**Updated:** 2026-09-20 (America/Toronto). **Work cycle:** comprehensive master-plan revision, documentation and local Git save only.

## Owner-facing state

**Follow-up research:** the owner requested a deeper Jev/Vercel/DOM investigation.
The [research synthesis](research/2026-09-20-jev-deep-research.md) and three
companion reports document the live Vercel free promotion ending September 25,
Gateway evaluation API, account limitations, browser benchmark evidence, and
proposed DOM experiments. The browser access path reached Vercel sign-in;
account entitlement, a key and successful inference are not verified. No
inference, signup, purchase, code/dependency change or deployment occurred.
This research supplements the plan; implementation remains unstarted.
Documentation checks for this follow-up cover local links, whitespace and
changed-file scope. The preceding full runtime verification below remains the
last test evidence; no source/dependency changes justify rerunning those builds
for this research-only checkpoint. Its existing failures remain unresolved.

Master Plan v2 now defines a complete path from evidence-backed business discovery to outreach, replies, opportunities and customer outcomes. The plan retains the existing stack, makes AI optional, corrects provider/account assumptions, and prioritizes complete owner workflows. **It has not been implemented.** No source code, dependency, runtime configuration, provider account, credential, database, campaign, deployment or prospect interaction was changed by this planning cycle.

Riley confirmed no OpenAI API keys. Existing OpenAI adapter/model assignments are source capability only. Jev, verifier and mailbox readiness are not established by their documentation or configuration. New provider and operational decisions remain separately gated.

## Authoritative documents

- [MASTER_PLAN](MASTER_PLAN.md): product, architecture, trade-offs, end-to-end design and constraints.
- [DELIVERY_PLAN](DELIVERY_PLAN.md): M0–M7 sequence, exact existing seams, dependencies and exit gates.
- [OPERATING_MODEL](OPERATING_MODEL.md): ownership, consent, approvals, replies, CRM and retention.
- [PROVIDER_AND_BUDGET_PLAN](PROVIDER_AND_BUDGET_PLAN.md): account readiness and C$50 scenarios.
- [VALIDATION_PLAN](VALIDATION_PLAN.md): tests, experiments, release and recovery evidence.
- [ADR 0039](adr/0039-deliver-owner-workflows-before-optional-ai-and-autonomy.md): planning rationale and relationship to earlier ADRs.

The prior accumulated status is preserved in [the dated archive](archive/2026-09-20/STATUS.md). Its old deployment/schema/test claims retain their original dates and do not establish current remote state. The old rebuild blueprint and Jev-first proposal no longer control work sequencing.

## Source and scope inspected

- Branch: `RileyHinsperger/axiom-revenue-engine-rebuild`.
- Inspected application baseline: `02e0c5a3ef69fe004d8ab7aab1314f0021f07f33` (`feat: trust assessments after durable reload`). This is an inspected baseline, not a claim that current tests are all green.
- Planning checkpoint: the commit containing this revision; resolve its immutable SHA with `git log -1 --format=%H -- docs/MASTER_PLAN.md`.
- Two preexisting untracked files were preserved: `src/lib/revenue-engine/private-kw-assessment-progress.ts` and `src/lib/revenue-engine/private-kw-assessment-progress.test.ts`. They are not included in the documentation commit. Local test/type checks saw the working-tree files; release verification must use an isolated exact committed candidate.
- Evidence: [code reality audit](research/2026-09-20-revenue-engine-code-reality.md), [source/contact research](research/2026-09-20-revenue-engine-sources-and-contact.md), [platform economics](research/2026-09-20-revenue-engine-platform-economics.md).

## Built versus operational

| Capability | Current evidence | Operational implication |
|---|---|---|
| Legacy pipeline/Gmail/CRM | Source exists; historical production inventory | Do not assume safe/connected/current from source or old inventory |
| New domain and storage | Evidence, audit, assessment, contact and durable-reload contracts implemented | Substantial reusable core; not a live complete acquisition loop |
| New owner UI | Leads, dossier and Quality Lab implemented | Current owner-UI acceptance is failing; source is not fresh deployment proof |
| Engine runtime | `src/engine/worker.ts` validates and halts; no new executing source/mail/AI pipeline | Inert by design |
| Provider ledger | Cost schema/contracts exist; operational atomic reservation/settlement service absent | Required before any paid engine provider operation, including manual one-off work |
| OpenAI/Jev | OpenAI adapter exists; no owner OpenAI keys; no Jev adapter | Neither is an available assumed fallback |

## Verification performed in this planning cycle

All builds and dry runs completed before the owner-UI check began. No remote deploy or migration was performed. Verification logs and safe browser artifacts remain ignored-local, not committed.

| Command | Result | Interpretation |
|---|---|---|
| `npm run check:safety` | PASS | Checked repository safety defaults/contracts |
| `npm test` | FAIL: 466 passed, 22 failed | All 22 tracked decoder-fixture failures share an expired fixed date |
| `npm run typecheck` | PASS | Current workspace, including preserved untracked source |
| `npm run lint` | PASS | Current workspace lint |
| `npm run build:cloudflare` | PASS | Local sanitized Cloudflare build only |
| `npx wrangler deploy --env="" --dry-run --autoconfig false` | PASS | No-upload bundle/config validation, not deployment |
| `npm run test:owner-ui` | FAIL | Quality Lab client-ready marker did not appear within 30 seconds |

Unit-test cause is demonstrated: `artifact-reference-d1-source-decoder.test.ts:544` fixes SHADOW_30D expiry at `2026-09-20T00:00:00.000Z`, while its timing builder uses the real clock. Fixture construction now fails the correct production rule that object expiry must follow the availability check. The repair is a test-clock change, not relaxed runtime expiry validation.

The owner-UI warmup returned HTTP 200 for the routes but timed out waiting for `[data-quality-lab-ready='true']`. That marker depends on browser client initialization. Exact client-side cause is **not established** because the warmup has no page-error/console diagnostic capture. It is not proven to share the unit fixture's clock issue. Diagnose separately before declaring the owner flow usable.

Local evidence: `data/planning-audit-2026-09-20/verification.json` and individual logs; owner artifacts `output/playwright/owner-ui-2628-1789960246373`. The documentation checkpoint preserves known failures and is **not release eligible**. No repairs were implemented because the owner explicitly requested planning only.

## Production, staging, and automation

Current remote production/staging state was not inspected in this task. Historical inventory records paused legacy intake/sending, removed legacy cron, a retained rollback deployment, and an isolated staging console. Treat those as historical until read-only reverified. Checked source defaults remain off; follow-ups remain off and the new engine scaffold remains locked. No current production health claim is made.

The older staging release packet `docs/releases/staging/2026-08-28-owner-quality-lab.json` still binds its own exact candidate and approval rules. This planning commit neither refreshes nor approves it. Decide whether that older console still serves the next milestone before preparing or deploying anything.

## Budget and owner decisions

The ceiling remains C$50/month, excluding the existing ChatGPT/Codex plan. This cycle made zero paid runtime/provider calls and activated no service. Research/browser documentation access and local builds are not a provider purchase. Existing actual bills and account balances are unverified.

A proposed two-mailbox/Cloudflare/domain/optional-AI scenario is approximately C$36.05 including a uniform 13% tax planning allowance at US$1=C$1.38, with no paid discovery and eligible free verification. This is not current spend or account approval. See the budget plan for assumptions, free-tier limits and cash top-up boundaries.

No owner decision is needed to save this plan. Future decisions must be concrete: source/research scope and real manifest, actual account/price commitments, sender identity/legal address and mailbox recovery, storage/privacy setup, exact releases/migrations, campaign messages/cohort, and any autonomy/budget change. The user explicitly said **do not implement after planning**.

## Completed gate and blockers

M0 planning content and verification inventory are complete; the local Git checkpoint saves the documentation. M1–M7 are future work. Existing blockers: 22 clock-dependent unit failures; unresolved owner-UI warmup failure; preexisting assessment-progress work needing review; absent live new-pipeline composition; unverified provider/mailbox/source readiness; no global operational cost ledger; real 10/50-cohort evidence and labels not established.

## Next three concrete actions — after implementation is authorized

1. Repair the tracked fixture clock and diagnose the Quality Lab warmup independently; rerun their targeted checks and the required suite. Preserve production expiry rules and do not mark the baseline green prematurely.
2. Review the two preexisting assessment-progress files, then complete M1: one offline business through actual persistence/reload to the owner dossier, with replay and restart proof.
3. Prepare M2's exact ten-business research/capture/storage capability packet with rights, accounts, budget, privacy, backup/rollback and owner decision; do not activate it by implication.
