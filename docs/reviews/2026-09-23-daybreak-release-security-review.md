# Release security review — 2026-09-23

**Scope:** Two bounded Daybreak Blue subagent audits of operator authentication
and legacy outbound/browser paths on the unreleased console branch, integrated
and verified by the root agent. This is targeted release-path review, not an
exhaustive security assessment of every route or dependency. Codex Security
reported Daybreak Blue access as granted on 2026-09-23. The review made no
provider request, deployment, migration, prospect contact, or database change.

| Finding and attack path | Disposition in candidate `3098615` | Residual release condition |
|---|---|---|
| **First registration could become admin.** Public email/password signup accepted an allow-listed owner address without mailbox proof; on a fresh or restored D1, the first registrant could choose its password and receive the admin role. | Shared Better Auth pre-signup hook now rejects Cloudflare/public registration before persistence. Local synthetic signup needs no D1 binding, loopback HTTP, and an exact process-only fixture flag. Production-handler regression gets 403 and no session cookie. | Verify current operator access in staging and production. Never reopen public bootstrap by allow-list alone. |
| **Legacy Gmail first-touch bypassed current consent/provider release requirements.** Historical database or environment switches could reach the Gmail REST send boundary. | Shared `sendGmailEmail` boundary now rejects before network for both cold first touches and replies; fake-network test proves zero requests. | A future sender needs a provider permitting the exact use, verified contact/consent/stop policy, and a separate pilot release. |
| **Legacy manual reply ignored stops and suppressions.** An authenticated reply route could resolve credentials and send after a business or recipient stop. | The route now fails closed on missing or paused settings, suppressed lead, exact recipient, and business/domain suppressions before credential resolution. The provider-wide Gmail block remains a second boundary. | Reconcile legacy and v2 history before any new reply provider is activated. |
| **Browser crawler could request private URLs.** Maps-derived website targets and browser redirects/subresources could reach internal hosts; request-routing failures previously continued. | Deployed legacy crawler returns before policy load, job claim, or browser launch. Local-only discovery validates public URLs and aborts private/non-web requests; interceptor installation failure now stops crawling. | Local hostname checks do not pin DNS and cannot defeat rebinding. New live capture needs network isolation and source-rights review. |
| **Outdated production Next dependency.** The direct Next.js dependency was 16.3.1. | Pinned Next.js 16.3.6 after checking the [official security advisory](https://github.com/vercel/next.js/security/advisories/GHSA-vcvr-r3jv-pc5j); `npm audit --omit=dev` reports zero vulnerabilities. | Dev-only audit findings remain for separate dependency maintenance; do not treat a package audit as a full penetration test. |

The exact candidate passed focused auth, send, reply, crawler, URL, safety,
typecheck, lint, Cloudflare build, and default/staging no-upload dry-run checks.
The clean local full suite on parent security commit `737f45b` passed 835 tests
(831 passed, zero failed, four host symlink skips); its successor `3098615`
adds the fail-closed route-install test. GitHub Actions Revenue Engine CI run
`35893290427` passed its full exact-commit Linux gate, including browser
acceptance, fresh local migrations, typecheck, lint, builds and dry runs.
These tests do not prove deployed behavior or live provider readiness.

The release decision remains governed by [ADR 0054](../adr/0054-quarantine-legacy-public-signup-gmail-and-browser-crawler.md),
the [current status](../STATUS.md), current backups and rollback proof. The
[Daybreak Blue model description](https://developers.openai.com/api/docs/models/gpt-daybreak-blue-latest)
and [OpenAI's cyber-defender guidance](https://developers.openai.com/blog/scaling-cyber-defenders-with-daybreak)
informed the bounded attack-path, evidence, and validation format used here.
