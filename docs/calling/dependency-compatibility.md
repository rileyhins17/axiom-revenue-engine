# Dependency compatibility — September 25, 2026

Published versions and peer ranges were read from the npm registry during this local continuation. Lockfiles remain authoritative; use Node 24.19.0 and Orbit's pinned pnpm 10.12.1.

- Engine: Next 16.3.6, React 19.3.0, Better Auth 1.6.29, SQLite 12.11.1, OpenNext Cloudflare 1.20.6 (AWS adapter 4.1.4), Wrangler 4.140.0, Cloudflare Playwright 1.3.6 and Playwright 1.63.0. Tailwind 4.3.3, Radix 1.6.7, Zod 4.6.5 and tsx 4.23.15.
- Orbit: React 19.3.0, Router 7.18.4, Better Auth 1.7.2, Cloudflare Vite 1.60.1, Wrangler 4.140.0, workers types 5.20260925.1, tsx 4.23.15. App schemas remain Zod 3.25.76; auth installs its own Zod 4.5.4. pnpm reports an optional better-call Zod peer warning through the core peer graph; the installed better-call runtime resolves Zod 4.5.4, not the app's Zod 3. No peer range has been suppressed or falsified.
- Caller: TypeScript 5.9.3; no runtime package dependencies.
- Both servers use Node 24.13.6 type definitions, React/DOM 19.3.0 definitions.

Keep the existing framework/compiler majors: TypeScript 5, Router 7, Vite 7, Vitest 3, SQLite 12, ESLint 9, and each app's schema major. Newer major versions require separate migration and compatibility work; this release does not claim every package is the newest published major. ESLint 9.39.5 now carries an upstream support deprecation, retained for compatibility with the existing configuration and verification pipeline. SQLite type definitions remain the previously compatible 7.x line.

Engine's three patch-package patches remain required: the Cloudflare browser binding adapter, OpenNext's Windows symlink copy fallback, and Next's Windows trace-exclusion path normalization. The first two were rebased onto the upgraded package artifacts; no production guard was disabled. The installed Next matcher regression test verifies private-path exclusions. A physical npm-ci dependency layout is required for Windows Cloudflare packaging; sharing a node_modules junction with another worktree caused native Sharp to enter the worker bundle.

Use the release packet's exact commit set and final check logs to assess this update. No deployment, account upgrade, source scan, extension installation or paid operation is part of dependency installation.

Orbit rejects Better Auth 1.7.6 as incompatible with its existing required account.issuer column: the full suite reproduced eleven auth/schema failures. Releases after 1.7.2 changed that storage contract. Retain 1.7.2 for this release; changing account tables requires a separately reviewed auth migration and rollback. No schema check was disabled.

Engine also retains Better Auth1.6.29: although its unit tests passed with1.7.6, the production-build owner browser gate failed before sign-in with SCHEMA_MISMATCH (missing user/session/account/verification tables). Do not disable auth validation or silently change the account schema for a calling release.
