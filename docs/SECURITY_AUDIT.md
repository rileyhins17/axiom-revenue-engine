# Axiom Revenue Engine security audit

Audit opened: 2026-09-06 (America/Toronto)
Canonical source snapshot: `f7a555a604f06b19623b727794fc505b3eebaaee`
Repository: `C:\Users\riley\Documents\ChatGPT\APE`
Branch: `RileyHinsperger/axiom-revenue-engine-rebuild`

## CEO verdict

No competent security review can promise that a system "cannot be hacked."
The defensible goal is to make compromise difficult, limit the damage of any
single failure, detect important abuse, recover safely, and refuse release while
a known severe path remains open.

The rebuild has tested fail-closed safety foundations, but it is **not
ready for production activation**. The critical public account-claiming path
has a source-level remediation in this checkpoint; it has not been deployed.
Six high-risk boundaries still require remediation before a merge to `main` or
any new deployment. Most automation-specific risks are currently dormant because
intake, queues, follow-ups, sends, providers, and the new engine are off. The
public registration weakness must still be treated as urgent in any environment
running the original audit snapshot: that configuration permits claiming a
not-yet-created approved account without proving control of its mailbox.

The current security posture is therefore:

| Area | Current verdict |
|---|---|
| Production activation | **Blocked** |
| Merge to `main` | **Blocked by Critical/High findings** |
| Autonomous sends and intake | Off and must remain off |
| Runtime providers | Not authorized for this audit |
| Production data or migrations | Not accessed |
| Production dependency vulnerabilities | 0 known from the current npm audit |
| Development/build dependency vulnerabilities | 2 moderate package entries |
| Known committed secrets | None found by the bounded pattern scan |
| Security guarantee | Impossible; continuous defence and recovery required |

## Scope and method

The review covered the current application and its dormant legacy surfaces:

- authentication, registration, sessions, authorization, owner roles, and OAuth;
- cookie-authenticated mutations, CSRF, redirects, response headers, and caching;
- Gmail connection, mailbox control, reply sending, suppression, and idempotency;
- agent HMAC authentication, replay prevention, job ownership, and ingestion;
- MCP and internal cron authority;
- website browsing and server-side request forgery (SSRF);
- error handling, audit logging, sensitive data exposure, and secret hygiene;
- dependency vulnerability reports and GitHub Actions supply-chain controls;
- release, backup, migration, rollback, and deployment evidence;
- the new disconnected Revenue Engine safety boundaries.

The method combined manual source tracing, safe static searches, current package
audit metadata, existing tests, the repository's release evidence, and focused
adversarial review. The baseline follows OWASP ASVS 5.0 as a practical control
catalog, not as a claim of formal certification.

The external hardening references used for this review are [OWASP ASVS 5.0](https://owasp.org/www-project-application-security-verification-standard/),
[Cloudflare's current security-header guidance](https://developers.cloudflare.com/workers/examples/security-headers/),
and [GitHub's Actions hardening guidance](https://docs.github.com/en/actions/how-tos/secure-your-work).

Two initial Luna review drafts were excluded from the authoritative findings
because they inspected an obsolete OneDrive checkout and old commit. Every
finding below was independently checked against the canonical source snapshot.
That process failure is now `AGENT-001` in `docs/GOTCHAS.md`, and every role is
machine-required to attest the exact root, branch, and HEAD before reading code.

### Important limitations

This was a source and local-control audit. It did not:

- probe a public staging or production URL;
- attempt account takeover against a deployed environment;
- read local secret files or display secret values;
- inspect Cloudflare, Google, or OpenAI account settings;
- validate DNS, Cloudflare Access, MFA, recovery accounts, or mailbox policy;
- run a destructive penetration test, send mail, contact prospects, or spend money;
- prove that an uninstalled external secret scanner would find nothing;
- reverify private GitHub repository settings because GitHub CLI access was not
  available in this environment.

Those items require a separate, explicitly authorized deployment/security
review. Absence of a finding here is not proof that a vulnerability does not
exist.

## Severity model

- **Critical:** realistic path to owner/admin takeover, secret compromise,
  uncontrolled production action, or material data loss.
- **High:** a boundary failure that can cause external contact, broad privileged
  access, server-side network abuse, replayed work, or unsafe deployment.
- **Medium:** meaningful defence-in-depth, privacy, integrity, or availability
  weakness that normally needs another condition to become severe.
- **Low:** hardening or hygiene gap with limited direct impact.

`Reachable` means the code path can operate when the console is deployed and its
ordinary credential exists. `Dormant` means current switches, absent bindings,
or the disconnected v2 design prevent execution today; dormant is not the same
as fixed.

## Findings

### SEC-001 — Critical — An approved email can claim a fresh owner/admin account

**Status:** Remediated in this source checkpoint; not deployed. Secure owner
enrollment, MFA, recovery, and existing-account review remain open under SEC-002.
**Reachability:** Source path is public. Current deployed exposure was not probed.

The public `/sign-up` page accepts a name, approved email, and attacker-chosen
password. The server checks only whether the submitted email string appears in
the allow-list. Email verification is disabled, the new account signs in
automatically, and an address on the admin list is promoted to admin after
signup. If Riley's or Aidan's application account does not already exist, anyone
who knows that address can register it first without controlling the mailbox.

**Evidence:**

- `src/app/sign-up/page.tsx:29-52` submits public email/password registration and
  redirects the new session into the dashboard.
- `src/lib/auth.ts:54-58` enables password signup, automatic sign-in, and disables
  email verification.
- `src/lib/auth.ts:82-89` authorizes signup using only the submitted email value.
- `src/lib/auth.ts:104-112` grants the admin role solely from that address.
- `src/lib/public-paths.ts:1-8` makes the signup and auth endpoints public.

**Required fix:** disable public signup in server configuration by default,
remove the public signup flow, and provision owners through a one-time,
short-lived, mailbox-verified invitation or an explicit offline bootstrap. Do
not auto-sign in a new owner and do not derive administrator authority solely
from a submitted address. Add a test that an approved address without an invite
still receives a denial.

**Remediation:** `src/lib/auth.ts` sets Better Auth's `disableSignUp: true` and
`autoSignIn: false`, unconditionally denies `/sign-up/email` in the server hook,
and removes the post-signup address-based administrator promotion. `/sign-up`
is now an informational page with no form, and sign-in no longer links to
registration. Existing password sign-in remains unchanged to avoid an
unreviewed owner lockout. No production owner is created or modified.

**Regression gate:** `scripts/verify-owner-ui-acceptance.ts` seeds one synthetic
credential account directly into its freshly created disposable SQLite database.
Against the real local auth route, it requires HTTP 403 for an unprovisioned
allowlisted admin, a stranger, and an existing fixture address; no session
cookie; failed login for the unprovisioned identity; no registration form;
successful existing-account login; and unchanged user/credential counts and
role. The exact commit's release receipt must include `test:owner-ui` before
this checkpoint is considered verified. Historical evidence above refers to the
audit's original snapshot, not current line numbers.

This does not discover or repair accounts that may already have been claimed in
another environment. The deployment gate must review account provenance and
revoke unrecognized sessions; never infer deployment from this source fix.

### SEC-002 — High — Owner authentication lacks the activation-grade controls

**Status:** Open; activation blocker already acknowledged in project status.
**Reachability:** Reachable whenever the console is deployed.

At the initial audit, the console relied on password authentication without
verified email or an application MFA/WebAuthn policy. Sessions last seven days
and the sign-in UI explicitly requests a remembered session. There is no proven Cloudflare
Access layer, recovery procedure, or owner-facing active-session inventory.
The initial audit had no forced session-revocation proof; the follow-up below
adds a regression for the concrete stale-cache authorization path.

**Initial audit evidence (follow-up source fixes below supersede these gaps):**

- `src/lib/auth.ts:54-67` configures unverified password auth and seven-day
  sessions.
- `src/lib/auth.ts:134-140` installs admin and cookie helpers but no MFA plugin.
- `src/app/sign-in/page.tsx:39-44` requests `rememberMe: true`.
- `src/lib/session.ts:27-64` trusts the current stored role but does not re-check
  an owner allow-list or verified-email requirement.

**Required fix:** after closing public signup, implement verified enrollment,
phishing-resistant MFA or a proven Cloudflare Access identity layer, recovery
codes/admin recovery, session listing and revocation, and reauthentication for
security-sensitive actions. Test demotion, allow-list removal, password reset,
lost-device recovery, and stolen-session containment.

**Partial remediation — current database authorization:** the pre-patch local
browser test reproduced a saved administrator cookie obtaining HTTP 200 from
`/api/admin/users` after its user's database role was changed to `user` (expected
403). Better Auth's compact cookie cache returned the signed old user/role for
up to five minutes without reading the stored session. This was an application
configuration/guard failure; the installed Better Auth admin plugin already uses
an authoritative lookup for its own sensitive admin routes.

`src/lib/auth.ts` now disables cookie caching globally. Both application session
lookups in `src/lib/session.ts` also explicitly request `disableCookieCache: true`.
No request query can opt them back into the cache. Current database session
existence, expiry, and role are authoritative at each authorization check. This
does not cancel already-running requests or erase information already viewed.

`scripts/owner-session-acceptance.ts`, called by the full owner browser gate,
constructs a valid legacy cache using only the disposable fixture's fake key.
It exercises demotion, ordinary access after demotion, the existing revoke-all
endpoint, old-cookie replay against application/auth APIs and a rendered page,
`disableCookieCache=false`, a new legitimate login, and server-side expiry.
The pre-patch HTTP 200 reproduction is recorded against source commit `f9ffebe`.
The exact candidate's release receipt must include this browser gate.

**Partial remediation — ban lifecycle:** a subsequent browser reproduction at
`4a94547` showed that the custom ban endpoint returned success while the target
still had one active session (expected zero). Source migration
`0071_operator_ban_session_guards.sql` now removes existing banned sessions,
revokes sessions atomically whenever a ban is written, and rejects inserts or
updates that would give a banned user a session. This shared database boundary
covers custom routes, Better Auth admin routes, and a login finishing after its
ban precheck. Explicit unban permits a new login; it cannot recreate old sessions.

The custom route uses `src/lib/operator-access.ts` to fence the write against
the acting administrator's current session, expiry, role, and ban status.
Permanent bans clear stale expiry metadata. A successful mutation returns the
same action vocabulary; an account/authority change returns 409 instead of
claiming an update that did not happen. Self-modification stays prohibited.

Installed Better Auth 1.6.29 also unconditionally cleared an expired ban read
before a newer ban. `patches/better-auth+1.6.29.patch`, applied by the existing
postinstall workflow, makes expiry clearance conditional on the same user,
banned state, expiry, reason and update time, then rechecks a failed update. This
also covers a same-deadline ban edit identified during independent review. Session triggers
cover the remaining clearance-to-insert gap. Do not upgrade the dependency or
drop this patch without rerunning the actual hook/adapter race regressions.
This app has no user-update hooks or secondary auth cache to synchronize;
adding those features requires reviewing the conditional adapter update.

The review also identified two alternate boundaries. Built-in `/api/auth/admin/*`
mutation shortcuts do not carry the custom route's mutation-time actor fence;
they are now denied in the shared auth before-hook. Read-only get/list/session
inspection and permission checks remain enabled. No app admin-client plugin or
production UI caller of the blocked shortcuts exists in the inspected source.
The custom ban/unban/role API retains its fenced controls. Re-enabling creation,
password reset, impersonation or other admin shortcuts requires a reviewed
replacement, not removal of this denial.

`src/lib/operator-ban-schema.ts` verifies the exact three installed guard
definitions before every auth request and before custom operator writes. Missing,
altered or unreadable schema fails closed. This prevents application-first or
partial migration rollout from restoring the original existing-session bypass.
Public registration retains its unconditional denial. The synthetic browser
gate removes/restores a guard to verify auth/read/mutation denial, and attempts
all eleven blocked administrative shortcuts with a valid administrator.

Fifteen focused tests cover real SQLite and local D1/Miniflare plus the
installed Better Auth adapter. The full local browser gate additionally tests
saved cookies against reads, profile writes and auth lookup; denied new login;
repeated ban; and successful new login only after unban. Source migration 0071
is applied only to disposable test databases. No live session or production
account was accessed, and no deployment or persistent migration was performed.
The fix requires both the schema guards and application/dependency patch in a
separately approved release. Do not bulk-apply the unrelated 0070 design.

**Partial remediation — owner admission and administrator ceiling:** a browser
reproduction at `f8946bf` returned HTTP 200 from `/api/v1/leads` after the stored
account email moved outside the configured owner list (expected 401). The
configuration helpers existed but no authentication path enforced them.

`src/lib/operator-owner-policy.ts` now reads current bindings on every check,
without the environment or auth-singleton cache. It rejects missing, malformed,
wildcard, duplicate, or contradictory lists; administrators must be a subset of
approved owners. A present but incomplete Cloudflare environment cannot fall
back to process/build-time values. Invalid configuration denies authentication
before destructive cleanup. Database failure also denies access.

The global auth before-hook deletes sessions belonging to unapproved or
unverified current database identities before any endpoint/session lookup. It
demotes stored admin roles outside current approval, including legacy
comma-separated combinations that grant admin permissions. Approved multi-role
administrators and non-admin service roles retain their existing values.
Approval is only a ceiling:
re-adding configuration cannot restore sessions or promote roles. The session
creation hook independently checks the current verified, approved database user,
including internal adapter calls with no HTTP context. Password sign-in also
requires email verification. Identity-edit/admin shortcuts remain disabled.
An independent review identified the admission-check-to-insert interval. A
deterministic test reproduced a late session created after the stored email
changed. The creation after-hook now rechecks the completed session against
current policy and identity, deleting only that newly created session before
rejecting the login if approval changed. Tests interleave email, verification,
and policy removal during actual internal and HTTP session creation. This is a
final completion check, not a transaction spanning external configuration;
every later request still checks current authority.
Queued after-hook rejections are converted by the auth route to explicit,
uncached 403/503 responses instead of escaping as generic server errors. The
integration test invokes that real route, not a duplicate test-only handler.
The custom admin mutation independently fences the actor's verified identity
against fresh admin approval in the same SQL statement; promotion also requires
the target's verified identity to be approved for administration.

`scripts/operator-owner-auth.test.ts` exercises the actual cached application
auth instance on disposable local D1: configuration removal/re-add with no
cache reset, raw auth/app session rejection, direct session-creation denial,
verification, role ceiling, identity edit rejection, invalid configuration,
sign-out and normal fresh login. The browser test exercises removed/unverified
owner reads and sign-in using real fake-account cookies. SQLite and D1 tests
cover cleanup, re-add, unsupported role representations, errors, and the actor
fence. None of these tests contacts a live account or external service.

Policy removal takes effect when a request observes it. A remove/re-add cycle
entirely between checks cannot be observed; use the explicit ban/revocation
operation for permanent removal, rather than treating configuration as an
account-management transaction. Already-running non-admin requests cannot be
recalled. Verification enforcement does not provide verified enrollment or
retroactively prove old account provenance. Those remain release blockers.

SEC-002 remains **open**: MFA, verified enrollment, recovery,
owner-facing session controls, and staging/production evidence remain missing.
Already-running requests and information already downloaded cannot be recalled
by revocation. The custom admin write has a transaction-time actor fence and
alternative admin writes are disabled; this does not claim equivalent in-flight
fencing for every non-admin legacy mutation.

### SEC-003 — High — One MCP token carries broad read and mutation authority

**Status:** Source retirement verified at `98c3df8eb7e5cf0e3e079565daef0b15e09fa750`;
all ten release checks and branch push passed. Not deployed.
No live route, trigger or credential has been changed.
**Reachability:** Dormant if the token is absent and automation remains off.

One bearer token protects a large MCP surface that includes scheduler triggers,
unblocking, and lead queueing. The internal cron path deliberately reuses the
same token. JSON-RPC batch requests are processed in an unbounded `Promise.all`,
and the route advertises wildcard CORS. Theft of one token would therefore have
a much larger blast radius than a single narrowly scoped job credential.

**Evidence:**

- `src/app/api/mcp/route.ts:62` reads the shared MCP token.
- `src/app/api/mcp/route.ts:496-523` exposes scheduler, unblock, and queue tools.
- `src/app/api/mcp/route.ts:622` fan-outs the caller's full batch concurrently.
- `src/app/api/mcp/route.ts:652-655` permits wildcard cross-origin access.
- `src/app/api/internal/cron-tick/route.ts:17-21` documents and uses the same
  token.

**Required fix:** retire this route with the legacy engine or split read,
mutation, and scheduler authority into scoped credentials. Prefer a Cloudflare
service binding for internal jobs. Enforce strict schemas, request/body/batch
limits, rate and cost limits, constant-time credential comparison, origin/CORS
policy, and redacted error responses.

**Candidate evidence (2026-09-08):** pre-removal characterization proved that a
synthetic shared token listed both read and mutation tools and that a fake
scheduled event dispatched scheduler/pipeline requests with that same token.
No tool, database or provider was used. The candidate removes the tool dispatcher
and shared-token cron implementation, supplies pure fixed-410 responses for both
exact routes, and makes the root scheduler inert. Current console fetch/cache
exports and separately authenticated owner endpoints remain. Retirement tests
reject any binding/request inspection and prove zero scheduled dispatch even
with enabled flags and an old credential. All 625 tests and the actual-route
browser gate pass, including all seven supported methods and six WCAG pages
with zero outside requests. Independent candidate review found no concrete
surviving bypass or nonlegacy console regression. Broader legacy agent/browser/send
paths remain separate findings, not implicitly fixed by this retirement.

### SEC-004 — High — Legacy website browsing can reach attacker-selected hosts

**Status:** Legacy-browser retirement reviewed; exact-commit release proof required.
V2 live DNS/egress validation remains a separate activation requirement.
**Reachability:** Dormant while discovery/browser bindings and intake remain off.

The legacy path normalizes arbitrary HTTP(S) website values and later navigates
a server-side browser to them. Resource interception blocks selected content
types and trackers, but it does not prove the destination is public, re-check
redirects, or prevent DNS rebinding. A malicious source record could direct the
browser toward loopback, private networks, metadata services, or another
internal hostname.

**Evidence:**

- `src/lib/scrape-engine.ts:137-165` accepts broad HTTP(S) website destinations.
- `src/lib/public-web-discovery.ts:106` navigates the server-side browser to the
  supplied website.
- `src/lib/browser-rendering.ts:91-137` filters resources but has no public-IP or
  redirect destination enforcement.

**Required fix:** use the v2 public-website URL policy before every navigation,
resolve and reject private/reserved IP ranges, validate every redirect hop,
defend against DNS rebinding, cap bytes/time/pages, and use platform egress
controls. Prefer deleting the legacy browser path after characterization tests.

**Candidate evidence (2026-09-08):** synthetic page/context instrumentation
confirmed private, loopback and metadata URLs reached `goto`, and the request
filter continued a private document request. Existing normal extraction/capture
tests passed before removal. The candidate deletes legacy navigation, browser
loaders/local fallback, AI execution and cloud job orchestration. Retired shims
reject without reading inputs or bindings; the cloud entrypoint returns
unclaimed before database/environment/timer activity. Pure historical parsers
remain, explicitly not a network URL policy. All 21 focused checks, 628 full tests,
type-check, lint and safety pass. Browser acceptance passed six desktop/mobile
accessibility pages with zero outside requests. V2 capture is independent and unchanged: its synthetic
URL/redirect/size/time tests do not establish live DNS pinning or platform egress.
No production or provider operation occurred. Historical line references above
describe the pre-retirement source. Independent candidate review found no concrete
surviving legacy browser authority or v2/owner-console regression in this scope.

### SEC-005 — High — Agent requests can be replayed across instances and alter server-owned lead fields

**Status:** External-agent source retirement verified at
`9519cb06cc0fd4ea1de9f24ce9c4bf910ad6130d`; all ten release checks and branch
push passed. No production route or credential changed.
**Reachability:** Dormant if `AGENT_SHARED_SECRET` is absent and agent work is off.

The HMAC is a good base, but the claimed agent name is not part of the signed
message, replay nonces live only in one process's memory, and the body is cloned
without a route-level byte limit. A replay sent to another Worker instance may
therefore pass within the five-minute window. The lead schema and progress
schemas use passthrough objects, and lead normalization spreads caller data
before storing it. Job completion checks only current `claimedBy` and terminal
status; it has no lease-generation token to reject an old worker after a job is
reclaimed under the same agent identity.

**Evidence:**

- `src/lib/agent-protocol.ts:172-213` signs timestamp, nonce, method, path, and
  body but omits `agentName`.
- `src/lib/agent-auth.ts:11-28` stores seen nonces in a process-local map.
- `src/lib/agent-auth.ts:64-82` reads the cloned body and accepts the local nonce.
- `src/lib/agent-protocol.ts:32-80` defines the lead object with `.passthrough()`.
- `src/app/api/agent/jobs/[id]/results/route.ts:42-85` spreads caller fields into
  the normalized record.
- `src/app/api/agent/jobs/[id]/complete/route.ts:20-31` has no claim-generation
  fence.

**Required fix:** bind normalized agent identity and a scoped key ID into the
signature, enforce body limits before parsing, persist nonce/idempotency state in
a durable atomic store, replace passthrough with strict write DTOs, make IDs and
lifecycle fields server-owned, and require a unique claim/lease generation on
every result, heartbeat, failure, and completion write.

**Candidate evidence (2026-09-08):** isolated instances of the original auth
implementation accepted the same synthetic signed request under a substituted
agent name; the same instance rejected its second request. No operational route,
database or provider was called. The candidate replaces all six HTTP handlers
with the shared pure 410 response and deletes `agent-auth.ts` plus its runtime
shared-secret declarations. Exact route-shape public matching replaces the
broad prefix exemption. The complete-module inventory prevents retired handlers
from regaining request/credential/binding authority. Focused tests exercise every
method with unreadable request/context objects and forbidden network/bindings.
All 626 tests, type-check, lint and safety pass. The actual-route browser gate
passes every retired endpoint/method and six desktop/mobile accessibility pages
with zero external requests.
Independent candidate review found no concrete remaining SEC-005 bypass or
console/internal-worker regression in this scope.
Internal scrape-job helpers and lead validation remain unchanged; this does not
claim that the separate legacy browser workflow or its data contract is hardened.
External clients remain an explicit rollout compatibility check. Historical
evidence above refers to the pre-retirement source.

### SEC-006 — High — Manual Gmail replies bypass the engine's send safety contract

**Status:** Open; route must remain unusable without mailbox credentials.
**Reachability:** Reachable to any authenticated user with a Gmail connection.

The reply route correctly verifies that a thread and recipient belong to the
lead, but it calls Gmail without proving an administrator role, global pause,
mailbox health, suppression, complaint state, current approval, budget, or an
idempotency key. The provider side effect happens before the local records. A
timeout or retry can therefore send the same message twice, and a failure after
Gmail succeeds can leave no trustworthy local receipt.

**Evidence:**

- `src/app/api/clients/[id]/emails/reply/route.ts:21-27` requires only a normal
  authenticated session.
- `src/app/api/clients/[id]/emails/reply/route.ts:71-93` provides the valuable
  thread/recipient ownership checks.
- `src/app/api/clients/[id]/emails/reply/route.ts:95-128` loads the first user
  mailbox and sends without the broader safety contract.
- `src/app/api/clients/[id]/emails/reply/route.ts:130-168` writes records only
  after the provider call.

**Required fix:** route every outbound message, including replies, through one
transactional send-intent/idempotency boundary. Recheck owner role, exact
mailbox, recipient, suppression, mailbox health, global stop, approval, and
budget immediately before dispatch. Recover an ambiguous provider response by
provider message ID rather than sending again.

### SEC-007 — High — Production release evidence is descriptive, not provider-bound

**Status:** Open; no production deploy is authorized.
**Reachability:** Dormant because deployment credentials are intentionally absent.

The protected workflow is substantially safer than a direct deployment, but
the supplied backup reference is checked only for text shape, not existence,
freshness, database identity, checksum ownership, or rollback usability. A raw
production deploy and a raw remote migration command remain ordinary package
scripts. The release workflow accepts any commit that is an ancestor of current
`main`, which permits an older vulnerable build without a distinct rollback
procedure. Secret-bearing jobs reference action tags rather than immutable
action commits.

**Evidence:**

- `scripts/validate-release-inputs.mjs:6-20` validates only SHA/reference format.
- `.github/workflows/deploy-production.yml:38-60` uses mutable action tags and
  accepts an ancestor of `main`.
- `.github/workflows/deploy-production.yml:70-79` records the caller's backup
  text and invokes the raw deploy script.
- `package.json:15` and `package.json:32` expose direct production deploy and
  migration commands.

**Required fix:** issue a provider-backed backup receipt tied to exact database,
export object, checksum, timestamp, release SHA, and rehearsed rollback. Make one
guarded executor the only production script, require exact `origin/main` for a
normal release, use a separate explicit rollback workflow, pin actions to
reviewed full commit SHAs, and prove post-deploy no-send health.

### SEC-008 — Medium — Custom cookie-authenticated mutations lack one explicit CSRF policy

**Status:** Source patch and local attack regression complete; not deployed.
The exact-commit release receipt is required before treating this as a verified
source checkpoint. Deployment/adapter proof remains an activation gate.
**Reachability:** Reachable when the console is deployed.

**Source remediation (2026-09-07):** At `7d1eef2`, a Chromium
same-site/cross-origin `text/plain` POST with the genuine disposable owner's
cookie archived a synthetic lead through `/api/vault/bulk`. This was a loopback
HTTP bridge to the real handler and disposable D1, not a live-production probe.
Foreign/missing-origin profile PATCH requests also changed the disposable owner.
The candidate shared `requireApiSession` boundary requires exact serialized
Origin equality with fresh explicit configured origins and a matching request
Host. Host constrains that configured trust and never supplies it; forwarding
headers are ignored. This supports Next's normalized/proxy-internal URL form.
Present Fetch Metadata must say `same-origin`; absent metadata is allowed only
with the exact Origin. Invalid configuration returns uncached 503; untrusted
requests return uncached 403 before authentication or mutation. No bearer-header
bypass is added. Current route inventory covers 21 unsafe custom handlers and
exact separate service/auth authorities. The original browser attack is now
denied and a legitimate same-origin archive succeeds; full production-mode
browser gate now also passes: actual forbidden POST/403, unchanged stored lead,
normal same-origin archive, six WCAG pages, desktop/mobile, zero outside requests.
The independent bounded review found no concrete remaining bypass/regression.
Exact-commit release proof remains required before push, and proxy Host formatting
must be checked during an explicitly approved staging release.
OAuth's state-bearing GET callback and Better Auth's own CSRF controls remain
separate review surfaces; this does not close SEC-002 or enable owner decisions.

**Historical vulnerable boundary:** The middleware checks only for the presence of a session cookie before allowing
private routes to continue. Custom API mutations authenticate the session, but
there is no shared same-origin `Origin`/`Sec-Fetch-Site`/CSRF assertion. Better
Auth's protections do not automatically become proof for the application's own
route handlers. Cookie defaults and JSON requests reduce some conventional CSRF
paths, but the invariant is not tested or enforced across every mutation.

**Evidence:**

- `middleware.ts:6-24` performs path and cookie-presence routing only.
- `src/lib/session.ts:35-64` validates the session and role without an unsafe-
  method origin policy.
- Representative custom mutations include the mailbox PATCH and reply POST.

**Required fix:** implement one shared unsafe-method request guard using exact
trusted origin plus fetch metadata, reject missing/foreign evidence outside a
documented non-browser service path, and add a route inventory test so new
mutations cannot omit it.

### SEC-009 — Medium — Global browser security headers are absent

**Status:** Partially remediated in source; strict CSP and verified HTTPS HSTS remain open.
**Reachability:** Reachable when the console is deployed.

No global Content Security Policy, frame restriction, MIME-sniffing protection,
referrer policy, permissions policy, or HSTS configuration was found in the
Next configuration or middleware. This permits clickjacking and removes useful
containment if a future XSS or content-type error is introduced.

**Evidence:** `next.config.ts` and `middleware.ts` contain no global security
header policy at the original audit snapshot. The current candidate adds an
enforced framing/object/base policy plus XFO, nosniff, no-referrer and minimal
permissions through Next configuration and matching Cloudflare `public/_headers`.
Script/style restrictions remain report-only. No live deployment is claimed.

**Required fix:** add and integration-test `frame-ancestors 'none'`,
`X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, a strict referrer
policy, a minimal permissions policy, and HSTS on verified HTTPS production.
Introduce CSP in report-only mode first, collect violations, then enforce a
Next-compatible policy without silently permitting arbitrary scripts.

### SEC-010 — Medium — Gmail OAuth state is session text, not a one-time signed transaction

**Status:** Source remediation; acceptance requires the exact-commit release receipt. Mailbox connection and migration remain unauthorized.
**Reachability:** Dormant without Google credentials.

OAuth state contains the session ID and optional target address but no separate
cryptographic signature, expiry, random one-time nonce, or consumed-state row.
The callback usefully requires the current session and exact target address,
which limits impact, but replay and transaction-confusion resistance are not
complete. Callback errors also place provider/error details into the redirect
query.

**Evidence:**

- `src/lib/gmail.ts:92-121` serializes and parses the state, including a legacy
  raw-session form.
- `src/app/api/outreach/gmail/callback/route.ts:17-40` compares the session but
  does not consume a one-time record.
- `src/app/api/outreach/gmail/callback/route.ts:127-134` exposes an exception
  message in a URL parameter.

**Required fix:** create a short-lived, random, server-stored one-time OAuth
transaction bound to user, session, exact redirect, and intended mailbox; sign
or encrypt opaque state, consume it atomically, remove legacy fallback, and map
internal failures to a generic error ID.

**Source remediation:** migration 0072 and `gmail-oauth-transaction.ts` use a
signed 256-bit random state identifier, server-owned identity/target/callback,
ten-minute database-clock expiry and atomic consumed-at update with current
approved admin/session predicates. Callback authorization is admin-only and
rechecked after provider round trips. Legacy parsing is removed; generic errors
do not expose provider text, internal exception messages or account addresses.
Independent review identified that GET initiation also needs a mutation fence;
the candidate now requires same-origin Fetch Metadata and the shared configured
origin/host check before creating state. HEAD requests cannot create or consume
transactions. Local D1 concurrency, local callback regression and isolated actual
Settings-link checks pass. The fresh full browser gate also passes; exact-commit
release proof remains required before push.
No live Google exchange, deployment or migration has been performed.

### SEC-011 — Medium — Mailbox PATCH permits broad record mutation

**Status:** Verified source fix at `084ff3e70328af4c09e43e11bf618963b8bb257e`;
all ten exact-commit release checks and branch push passed. Not deployed.
Automation/mailboxes remain off; no live fix is claimed.
**Reachability:** Reachable to an administrator when mailbox data exists.

The route passes an unvalidated arbitrary object into a helper typed as
`Partial<OutreachMailboxRecord>`, and that helper forwards it directly to Prisma.
This allows the caller to mutate server-owned identity, connection, counters,
health, timestamps, or other fields Prisma accepts rather than only the narrow
owner-editable settings intended by the UI.

**Evidence:**

- `src/app/api/outreach/automation/mailboxes/[id]/route.ts:16-20` forwards the
  complete JSON body.
- `src/lib/outreach-automation.ts:2561-2566` sends it directly to the database.

**Required fix:** use a strict schema with an explicit allow-list, reject unknown
keys, keep identifiers/connection/health/counters server-owned, validate state
transitions, record an audit event, and add adversarial mass-assignment tests.

**Candidate evidence (2026-09-08):** disposable SQLite reproduced protected owner,
status and last-send mutation through the old helper. The new shared boundary is
`src/lib/mailbox-settings.ts`: label and validated timezone only, atomic current
admin/session check, update-plus-audit batch, and write-free identical retry.
Numeric settings are derived on connection sync and are not misleadingly exposed
as persistent owner overrides. Lifecycle transitions stay outside this metadata
endpoint. Targeted SQLite/D1 adversarial and audit-rollback tests and actual
route/browser proof pass. Independent bounded review found no concrete bypass or
regression. The complete exact-commit release receipt is recorded at the SHA
above; the final six-page browser gate made zero external requests. Live
deployment, mailbox activation and unrelated security findings remain open.

### SEC-012 — Medium — Security audit events fail open

**Status:** Open.
**Reachability:** Reachable across authentication and sensitive mutations.

`writeAuditEvent` catches every storage error and only logs it. Security-relevant
changes can therefore succeed without a durable audit record. Several routes
also log raw exception objects and return their messages, which may expose
provider, database, or configuration detail.

**Evidence:**

- `src/lib/audit.ts:12-27` suppresses all audit-write failures.
- Representative raw-error paths include Gmail connect/callback, reply sending,
  mailbox updates, MCP tool errors, and agent job claims.

**Required fix:** define which events are mandatory and persist them in the same
transaction or a transactional outbox. Fail closed for privileged changes when
mandatory evidence cannot be written. Return a generic public error with a
correlation ID; send redacted structured detail only to the private log sink.

### SEC-013 — Medium — Sensitive responses have no consistent private-cache policy

**Status:** Open.
**Reachability:** Reachable when owner APIs are deployed.

Some new v2 routes explicitly return private/no-store responses, but legacy
client, lead, email, and export responses do not consistently set
`Cache-Control: private, no-store` and `Vary: Cookie`. These payloads contain
business identities, contact details, messages, notes, and pipeline state.

**Evidence:** representative legacy responses in `src/app/api/clients/route.ts`,
`src/app/api/clients/[id]/route.ts`, `src/app/api/clients/[id]/emails/route.ts`,
and `src/app/api/leads/export/route.ts` construct responses without one shared
sensitive-response policy.

**Required fix:** add a shared response helper or middleware invariant for every
authenticated HTML/API/export response and test production-like headers.

### SEC-014 — Medium — Development/build dependency advisories remain

**Status:** Open; no known production dependency vulnerability in this audit.

The current npm production audit reports zero vulnerabilities. The complete
audit reports two vulnerable development/build package entries and no High or
Critical issue:

- `@humanfs/node@0.16.7`, moderate, reached through ESLint;
- `qs@6.15.2`, moderate, reached through the OpenNext/AWS/Express build chain,
  with two advisory records.

**Required fix:** update the pinned `qs` override to a fixed compatible version
and advance ESLint/its dependency, then run the complete local and Linux release
gates. Do not broadly upgrade unrelated runtime packages inside this fix.

## Controls that are already strong

The audit did not treat legacy risks as proof that the rebuild has no security.
The following controls materially reduce current exposure:

- The repository's recorded production state keeps autonomous intake, queueing,
  follow-ups, sending, mailbox sync, providers, production deployment, and
  production migration disabled.
- The new Revenue Engine Worker is inert and disconnected: no public processing
  routes, providers, costs, or live-data authority are configured.
- The complete checkpoint before this audit passed 589 tests, type-checking,
  lint, both Cloudflare build/dry-run boundaries, and the owner-browser gate.
- Safety contracts are fail-closed, typed, versioned, idempotent, and heavily
  tested before any v2 provider or durable resource is connected.
- The current production dependency audit reports zero known vulnerabilities.
- A bounded tracked-file and Git-history credential-pattern scan found no real
  committed secret; the only match was an intentional fake secret-shape fixture.
- `.env*`, generated builds, Wrangler state, local monitor state, and private
  data are ignored. The Cloudflare bundle sanitizer removes compiled local env
  values and scans the generated bundle before upload could occur.
- Gmail tokens are encrypted at rest with authenticated encryption, message
  headers are normalized, and the reply route verifies thread and recipient
  ownership even though it still lacks the full send contract.
- D1 calls inspected in the high-risk paths use bound parameters; this audit did
  not establish a direct SQL-injection path.
- No `dangerouslySetInnerHTML` use was found in the application source during the
  bounded scan; rendered email content uses a sandbox boundary.
- v2 website evidence has a stricter public URL/capture design than the legacy
  browser path and remains disconnected pending its own release gate.
- GitHub workflows declare read-only repository permissions, production
  concurrency, a production environment, an exact typed approval phrase, and a
  dry-run/test gate before deployment.

## Remediation order and release gates

Security work must remain incremental; fixing all findings in one giant patch
would itself be a review and rollback risk.

### Gate A — Identity lockdown

1. Disable public registration and remove public signup navigation.
2. Replace the UI acceptance test's public self-registration with a direct,
   synthetic local fixture account.
3. Design and test verified invite/bootstrap, MFA, recovery, reauthentication,
   role demotion, and session revocation.

**Exit:** no owner account can be created or promoted from a submitted email
alone, and no Critical identity finding remains.

### Gate B — Browser and request boundaries

1. Add exact-origin/fetch-metadata enforcement to custom mutations.
2. Add private/no-store responses and global security headers.
3. Deploy CSP report-only to isolated staging, close violations, then enforce it.
4. Add OAuth one-time state and strict mailbox mutation schemas.

**Exit:** browser-origin, framing, cache, OAuth, and mass-assignment tests pass in
a production-like environment.

### Gate C — Legacy authority retirement

1. Remove or separately scope MCP/cron mutation authority.
2. Replace agent replay/DTO/job-fencing boundaries or retire that agent surface.
3. Remove the legacy browser workflow or enforce public-only destinations across
   navigation and redirects.
4. Route every outbound email through one safe, idempotent send-intent system.

**Exit:** no shared credential authorizes unrelated operations, no job/result can
be replayed across instances or claims, no browser can reach private networks,
and no external message bypasses the send contract.

### Gate D — Release and operational security

1. Pin GitHub Actions to reviewed full SHAs.
2. Replace text-shaped backup references with provider-backed receipts.
3. Remove raw production scripts in favour of one guarded deploy/migration tool.
4. Add exact-main release, separate rollback, post-deploy no-send health, and
   rollback rehearsal.
5. Verify GitHub privacy, branch protection, Dependabot/security settings,
   Cloudflare Access, least-privilege tokens, DNS, MFA, recovery, alerting, and
   secret rotation without printing secret values.

**Exit:** a release is attributable, reproducible, recoverable, least-privileged,
and cannot proceed on stale or invented evidence.

### Gate E — Independent validation

After Critical and High findings are closed, run:

- the complete repository release gate;
- production-build header and CSRF integration tests;
- dependency and secret scans in Linux CI;
- a safe isolated-staging penetration test with synthetic data;
- an external human security review before enabling real providers or sends.

**Exit:** zero open Critical or High findings, all Medium findings either fixed or
explicitly risk-accepted by Riley with a compensating control and review date.

## Riley's security responsibilities

Engineering cannot protect accounts Riley controls if the surrounding identity
layer is weak. Before activation Riley must:

1. Use unique password-manager-generated credentials for GitHub, Cloudflare,
   Google Workspace, domain registrar, and OpenAI.
2. Enable phishing-resistant MFA/security keys where supported, with two secure
   recovery methods and no shared personal recovery inbox.
3. Keep Riley and Aidan as separate named accounts; never share one login.
4. Review and remove stale sessions, OAuth apps, API tokens, SSH keys, deploy
   keys, collaborators, and recovery contacts.
5. Approve least-privilege production tokens only after the corresponding
   release gate exists; rotate any secret whose history is uncertain.
6. Keep the canonical repository outside OneDrive and Google Drive.
7. Treat unexpected login, mailbox, deployment, billing, or DNS alerts as an
   incident and use the documented kill switches immediately.

## Next security checkpoints

1. Complete `SEC-002` enrollment, MFA, recovery, and session-revocation proof;
   retain the new `SEC-001` no-public-signup regression gate.
2. Add the shared browser/request security boundary for `SEC-008`, `SEC-009`,
   and `SEC-013`.
3. Retire or redesign the legacy MCP, agent, browser, and send paths before any
   provider or automation activation.

This audit is a living release artifact. Update each finding with a verifying
commit and regression test when fixed. Do not delete closed findings; preserve
the historical risk and link the control that made it unreachable.
