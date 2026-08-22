# Axiom Revenue Engine

Axiom Revenue Engine is Axiom Web's private system for finding strong local
business opportunities, proving why they need help, selecting the best reachable
channel, preparing specific outreach, and learning which work becomes revenue.

> The goal is qualified opportunities and customers—not scraped records or send
> volume.

## Current state

The application is in a controlled rebuild. The legacy production application is
the read-only reference until the new engine passes its shadow and pilot gates.
All autonomous repository defaults are off, follow-ups are disabled, and no test
is allowed to send real outreach.

Start with [`docs/STATUS.md`](docs/STATUS.md) for the current verified checkpoint,
the next three actions, blockers, live-system state, and budget. The full approved
direction lives in [`docs/MASTER_PLAN.md`](docs/MASTER_PLAN.md).

## Owner view

The final owner experience has five plain-language areas:

- **Today** — replies, approvals, problems, spend, and the next best action.
- **Leads** — ranked businesses, visible quality scores, evidence, and best route.
- **Outreach** — evidence/message approval, mailbox health, and manual tasks.
- **Revenue** — replies, opportunities, clients, value, and next sales action.
- **System** — coverage, workflows, providers, deployments, costs, and audit trail.

Only verified email can become automated. Phone calls, contact forms, and social
messages remain manual actions.

## Safe local setup

Requirements: Node.js 22+, npm, and Wrangler through the project dependency.

```powershell
npm ci
Copy-Item .env.example .env.local
npm run dev
```

Set a local `BETTER_AUTH_SECRET` of at least 32 characters. `OPENAI_API_KEY` is
optional until AI-backed development is being tested. Local and automated tests
must use fixtures/fakes and must never call prospects, submit forms, sync a live
inbox, or run the production scheduler.

## Verification

```powershell
npm run check:safety
npm test
npm run typecheck
npm run lint
npm run build:cloudflare
npx wrangler deploy --env="" --dry-run --autoconfig false
```

## Documentation map

- [`AGENTS.md`](AGENTS.md) — mandatory rules for every agent and contributor.
- [`docs/OWNER_CONTEXT.md`](docs/OWNER_CONTEXT.md) — private business and owner context.
- [`docs/STATUS.md`](docs/STATUS.md) — exact resumable checkpoint.
- [`docs/PRODUCTION_INVENTORY.md`](docs/PRODUCTION_INVENTORY.md) — latest non-secret
  legacy resource, data, safety, and backup inventory.
- [`docs/STAGING_INVENTORY.md`](docs/STAGING_INVENTORY.md) — isolated Cloudflare
  resource IDs, migration state, pending services, and rollback notes.
- [`docs/MASTER_PLAN.md`](docs/MASTER_PLAN.md) — product, architecture, phases, and gates.
- [`docs/GOTCHAS.md`](docs/GOTCHAS.md) — proven recurring traps and prevention.
- [`docs/RUNBOOK.md`](docs/RUNBOOK.md) — safe operator and release procedures.
- [`docs/DATA_DICTIONARY.md`](docs/DATA_DICTIONARY.md) — canonical domain language.
- [`docs/adr/`](docs/adr/) — versioned architecture decisions.

## Platform

The console remains Next.js on Cloudflare. New long-running work moves into a
separate typed Worker using Cloudflare Queues and Workflows; D1 stores operational
records and R2 stores screenshots/evidence. Runtime AI uses a provider interface
with OpenAI Responses, structured outputs, snapshot-pinned models, strict per-job
limits, and a cost ledger.

Legacy resource identifiers are kept only where needed for safe migration. They
must not be renamed in place or retired until reconciliation, rollback, and the
30-day stability gate are complete.
