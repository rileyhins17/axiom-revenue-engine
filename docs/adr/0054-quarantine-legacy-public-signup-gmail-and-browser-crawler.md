# ADR 0054: Quarantine legacy public signup, Gmail sending, and cloud crawling

**Date:** 2026-09-23. **Status:** accepted for the unreleased console candidate.

## Context

The existing console still contains three older paths whose presence could be
mistaken for release readiness. Public email/password signup promoted an
allow-listed owner address to admin after creating a session, without proving
control of that mailbox. On a fresh or restored database, the first person to
register that public address could take the admin role. Legacy Gmail delivery
and browser crawling remain reachable in source even though the current
Revenue Engine has no approved cold-email provider or live website-capture
gate. The manual Gmail reply route also lacked a final stop and suppression
check. Configuration switches alone are insufficient boundaries for these
paths.

## Decision

Block public email/password signup before account creation in every Cloudflare
runtime. Permit it only for an isolated synthetic owner-browser fixture when
the process has no Cloudflare D1 binding, its configured base URL is HTTP on a
loopback host, and a process-only fixture flag is exactly `1`. Do not expose
that flag in Wrangler configuration or the application environment schema.
The public registration page redirects to sign-in. Privately provisioned
accounts remain the intended operator path; a fresh environment must prove an
actual admin bootstrap before an authenticated owner smoke test can pass.

Block both legacy Gmail first-touch and reply delivery at the shared provider
boundary, before any network request. Keep message construction testable, but
do not offer a toggle that can reactivate delivery. The manual reply endpoint
also checks the global and emergency stops plus business, recipient, and domain
suppression before resolving Gmail credentials. Missing or unreadable policy
state blocks the operation.

Keep the deployed legacy Browser Rendering crawler inert before loading policy
or claiming a job. Its local-only discovery helper validates public HTTP(S)
targets before navigation and aborts private, reserved, or non-web redirect
and subresource requests. If request interception cannot be installed, local
crawling stops before navigation. These hostname checks are defense in depth;
they do not solve DNS rebinding, which is why the deployed crawler stays
disabled.

Reactivation requires a new reviewed path with source rights, DNS-safe network
isolation, current contact/consent and suppression policy, an acceptable
provider, bounded tests, and the exact release gate. Do not re-enable any of
these paths by changing an environment variable or a single boolean.

## Consequences

The console can still show evidence, stops, tasks, and manually observed
replies, but it cannot register the first owner publicly, send through legacy
Gmail, or run the legacy cloud crawler. This is intentional release containment,
not completion of the acquisition or outbound milestones. A clean build and
browser fixture demonstrate software behavior only; staging auth bootstrap,
live source assessment, inbox routing, backup, rollback, and production
approval remain separate proofs.
