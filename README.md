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

Cloudflare builds automatically remove values loaded from local `.env*` files and
scan the generated bundle for secret material. Runtime secrets belong in
Cloudflare's secret store; a local `.env.local` value is never a deploy source.

The separate engine scaffold is intentionally inert. Use `npm run cf:engine:dev`
for local inspection; its empty secret allow-list prevents unrelated console
secrets from entering the Worker. `/health` should return `503 LOCKED` until a
later, explicitly approved phase adds execution authority.

The first website-capture boundary is implemented but not wired to the Worker. It
normalizes only public HTTP(S) domains, revalidates each manual redirect, and caps
time and HTML size. All capture tests use an injected fake transport; running the
test suite does not fetch a real business website.

Captured HTML fixtures can now be converted into bounded page facts with a
standards-based streaming parser. Scripts are never executed, incomplete parsing
stays explicit, and visual/mobile facts remain unknown until Browser Rendering
proves them. This parser is also not connected to a live capture path.

The browser-evidence contract now defines that proof without enabling the
provider. Desktop and mobile captures use fixed comparison viewports, referenced
artifacts and hashes, deterministic measurement coverage, and conservative merge
rules. Missing or partial measurements stay unknown; a screenshot alone cannot
lower a lead's website score. Browser Rendering and R2 are still not attached to
the engine.

A fixture-only Browser measurement adapter now proves the boundary around a
future Cloudflare runner. It accepts only canonical public navigation, fixed
viewports, strict time/request/byte limits, and a receipt proving that no private
network request, credential, form submission, or download was allowed. Captures
remain unpersisted, zero-cost drafts until separate content-addressed artifact
references match their revalidated bytes and hashes. This version cannot connect
to Browser Rendering or R2.

The next storage boundary is also fixture-only. Screenshot and measurement keys
are derived from their SHA-256 content, writes are create-if-absent, retries reuse
matching objects, and conflicting objects stop the job. Shadow evidence has a
planned 30-day lifecycle and uncontacted qualification evidence 180 days;
outreach/compliance evidence is never assigned a guessed automatic expiry. R2 is
still disabled and no bucket, binding, object, operation, or charge exists.

The audit assembler now combines those bounded inputs across a home, service,
about, and contact page. It will not call a page set complete unless all four are
captured with complete HTML/desktop coverage and the homepage has complete mobile
measurements. Missing or partial coverage stays visible and keeps absence checks
unknown; it cannot be converted into a reason to contact a business. The
assembler is fixture-only, capped at zero dollars, and has no provider access.

Evidence lifecycle planning is now explicit as well. The same verified content
hash can move only toward stronger protection: shadow, qualification, outreach,
then legal hold. Every copy is create-if-absent and reconciled; retries cannot
overwrite a conflicting object. A retention-release record must bind every known
use, the reviewing owner/compliance actor, reason, and exact decision. It still
cannot delete an object—deletion needs a fresh reference check and a separate
future release gate. All lifecycle work remains fixture-only and zero-cost.

## Verification

```powershell
npm run check:safety
npm test
npm run typecheck
npm run lint
npm run build:cloudflare
npx wrangler deploy --env="" --dry-run --autoconfig false
npm run cf:engine:typegen:check
npm run cf:engine:dry-run
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
- [`docs/KW_EVALUATION_GUIDE.md`](docs/KW_EVALUATION_GUIDE.md) — Riley's one-time
  50-lead quality-label gate and current progress.
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

The Worker/Workflow and bounded website-capture contracts now exist, but there is
deliberately no deployed engine resource, live queue consumer, schedule, data
binding, live capture call, or spending path.

The first 50-business seed can be normalized into ignored local storage with
`npm run kw:prepare-import -- --input data/kw-evaluation/input.json --output data/kw-evaluation/plan.json`.
This command makes no provider call, spends nothing, and cannot qualify or contact
a business. A second local-only command can prepare schema-bound preflights with
`npm run kw:plan-persistence -- --input data/kw-evaluation/plan.json --output data/kw-evaluation/persistence.json`.
It does not connect to or write a database and its output explicitly carries no
mutation authority. See the evaluation guide before preparing real private data.

Legacy resource identifiers are kept only where needed for safe migration. They
must not be renamed in place or retired until reconciliation, rollback, and the
30-day stability gate are complete.
