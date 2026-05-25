# Local Setup

This repo is the Axiom Pipeline Engine. Local setup is for UI, unit tests, and Cloudflare-shaped smoke tests. Do not use local setup to send Gmail, sync inboxes, or run production cron tasks.

## 1. Install dependencies

```bash
npm install
```

## 2. Create local env files

```bash
copy .env.example .env.development
copy .dev.vars.example .dev.vars
```

Fill in local-safe values. Keep production secrets in Cloudflare, not Git.

## 3. Prepare local D1

```bash
npm run db:migrate:local
```

The Cloudflare resource name is still `axiom-ops-omniscient` for database continuity.

## 4. Start development

```bash
npm run dev
```

Open `http://localhost:3000/sign-in` and sign in with an email listed in `AUTH_ALLOWED_EMAILS`.

## 5. Verify safely

```bash
npm test
npm run typecheck
npm run lint
npm run build:cloudflare
```

Use `npm run preview` only when you need OpenNext and local Cloudflare bindings. Do not use live Gmail or inbox actions as a test.
