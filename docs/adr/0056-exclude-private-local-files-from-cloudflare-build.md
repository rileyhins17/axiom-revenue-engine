# ADR 0056 — Exclude private local files from Cloudflare bundles

**Status:** accepted for the current release candidate, 2026-09-23.

## Context

An OpenNext build in a worktree containing ignored `data/kw-evaluation/` files
copied 3,645 local evaluation files into the generated server bundle, including
104 SQLite databases. Next.js output tracing followed a filesystem-using route
and did not treat `.gitignore` as an exclusion rule. The previous sanitizer
searched for secret-shaped values but did not reject private files as a class.
No affected bundle was deployed.

## Decision

Use Next.js `outputFileTracingExcludes` for every server route to omit local
evaluation data, backups, scratch output and agent/tool directories. A Windows
build still traced the private files despite those settings, so they are not a
sufficient release control. Independently, the Cloudflare bundle sanitizer must
fail if any generated output still contains these private paths or local
database/key file types. The error reports only a count, never private
filenames or contents. The sanitizer remains part of every Cloudflare build and
Wrangler custom build. Build from a clean release checkout and keep builds and
unit tests sequential because test fixtures can appear or disappear during
tracing.

## Consequences

The ignored local evaluation workspace is not a runtime source for the deployed
console. If a future route needs a specific non-secret runtime asset, it needs a
new explicit review and narrow include rule. A clean CI checkout alone cannot
prove privacy: the guard must also reject a dirty local worktree containing
private files. The current candidate still requires staging backup, migration,
release approval and owner-flow verification; a clean bundle does not grant a
deployment.
