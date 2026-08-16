# Axiom Pipeline Engine

Private Axiom operations app for lead intake, enrichment, autonomous first-touch outreach, reply tracking, and CRM movement.

The live app runs at `https://operations.getaxiom.ca`. The Cloudflare Worker and D1 resources still use the legacy resource name `axiom-ops-omniscient` so the production domain, bindings, and database stay stable. The npm package name is `axiom-pipeline-engine`.

## Current Production Shape

- Next.js 16 app deployed to Cloudflare Workers through OpenNext.
- Cloudflare D1 is the production database. SQL migrations live in `migrations/`.
- Cloudflare Browser Rendering powers cloud scraping. Local dev can fall back to Playwright.
- Better Auth gates the app and API. Admin-only routes protect export, settings, and automation controls.
- Gmail OAuth connections are used by the sending engine. Tests and local verification must not send mail or call inbox actions.
- The autonomous pipeline is first-touch only right now. Follow-ups are intentionally paused in settings and capped at zero in `wrangler.jsonc`.

## Main Surfaces

- `/dashboard` - operator command center: send capacity, queue load, next effective sends, recent sends, and lead supply.
- `/automation` - sending console: mailbox readiness, first-touch queue, sent log, diagnostics, intake pause, and emergency stop.
- `/vault` - source of truth for leads, filtering, CSV export, and manual lead entry.
- `/clients` - reply and deal pipeline board.
- `/settings` - authenticated operator profile and mailbox/runtime visibility.

## Pipeline Rules

Autonomous outreach should only send to qualified recipients:

- owner email confidence must be at least `0.50`
- staff email confidence must be at least `0.65`
- generic, role, scraper-artifact, and malformed addresses are blocked
- chain/non-customer entities and businesses with >800 reviews are hard-disqualified before autonomous send
- follow-up sends remain disabled until deliberately re-enabled

The dashboard and automation queue show projected effective send times based on mailbox cooldown and capacity. They should not show stale scheduled dates as if they were live next-send times.

## Operator interface

The Ops 04 interface is built for dense, repeated operational work: calm graphite surfaces, one mint status accent, shared page headers, compact metrics, keyboard search, responsive mobile navigation, and reduced-motion support. Authentication, Vault, Clients, Automation, and Settings use the same visual hierarchy and error language.

The interface is deliberately restrained. Status colour communicates meaning; decorative animation does not compete with queue health, send safety, replies, or revenue signals.

## Local Setup

```bash
npm install
copy .env.example .env.development
copy .dev.vars.example .dev.vars
npm run db:migrate:local
npm run dev
```

Open `http://localhost:3000/sign-in`.

Use `npm run preview` only when you need a Cloudflare-shaped local run with OpenNext bindings and local D1.

## Environment

Required app/runtime values:

- `APP_BASE_URL`
- `BETTER_AUTH_SECRET`
- `AUTH_ALLOWED_EMAILS`
- `AUTH_ADMIN_EMAILS`
- `MCP_API_TOKEN`

Server-only secrets:

- `GEMINI_API_KEY`
- Gmail OAuth client secrets used by the existing auth/Gmail flow

Operational controls in `wrangler.jsonc`:

- `AUTONOMOUS_INTAKE_ENABLED`
- `AUTONOMOUS_QUEUE_ENABLED`
- `AUTONOMOUS_SEND_ENABLED`
- `AUTONOMOUS_MAX_SENDS_PER_DAY`
- `AUTONOMOUS_MAX_FOLLOW_UP_SENDS_PER_DAY`
- scrape/runtime rate limits

## Cloudflare Operations

Apply remote migrations:

```bash
npm run db:migrate:remote
```

Generate Cloudflare types:

```bash
npm run cf:typegen
```

Build for Cloudflare:

```bash
npm run build:cloudflare
```

Deploy manually:

```bash
npm run deploy
```

Check recent deployments:

```bash
npx wrangler deployments list --json
```

Do not run live cron, scheduler, Gmail send, or inbox-sync actions as a test. Use unit tests, typecheck, lint, build, and dry-run deploy checks for maintenance work.

## Verification

Run these before merging operational changes:

```bash
npm test
npm run typecheck
npm run lint
npm run build:cloudflare
npx wrangler deploy --dry-run --autoconfig false
npm audit --omit=dev
```

`npm run typecheck` clears stale generated Next route types before TypeScript runs. This prevents deleted routes from poisoning source-only checks.

## Notes For Maintainers

- Keep production secrets out of Git. Use Cloudflare secrets or local `.dev.vars`.
- Keep autonomous send policy and dashboard SQL predicates aligned.
- If a feature is removed from the API, remove matching UI buttons, command-palette entries, cron budget fields, tests, and README references in the same change.
- Prefer CSV export. XLSX export was removed to reduce dependency weight and the transitive `uuid` audit surface.
- Cloudflare may print "preview database" for D1 because the configured preview and production D1 IDs are the same. Verify `served_by: v3-prod` in command metadata when checking production D1.
