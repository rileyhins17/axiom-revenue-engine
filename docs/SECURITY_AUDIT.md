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

The rebuild has several unusually strong safety foundations, but it is **not
ready for production activation**. One critical account-claiming path and six
high-risk boundaries require remediation before a merge to `main` or any new
deployment. Most of the automation-specific risks are currently dormant because
intake, queues, follow-ups, sends, providers, and the new engine are off. The
public registration weakness must still be treated as urgent because source
configuration would allow an attacker who knows an approved owner email to
claim a not-yet-created account without proving control of that mailbox.

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

**Status:** Open; immediate release blocker.
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

### SEC-002 — High — Owner authentication lacks the activation-grade controls

**Status:** Open; activation blocker already acknowledged in project status.
**Reachability:** Reachable whenever the console is deployed.

The console currently relies on password authentication without verified email
or an application MFA/WebAuthn policy. Sessions last seven days and the sign-in
UI explicitly requests a remembered session. There is no proven Cloudflare
Access layer, recovery procedure, active-session inventory, or forced session
revocation test in this audit.

**Evidence:**

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

### SEC-003 — High — One MCP token carries broad read and mutation authority

**Status:** Open; do not activate the legacy MCP/cron surface.
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

### SEC-004 — High — Legacy website browsing can reach attacker-selected hosts

**Status:** Open in legacy code; retire or harden before Browser activation.
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

### SEC-005 — High — Agent requests can be replayed across instances and alter server-owned lead fields

**Status:** Open in the legacy agent surface.
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

**Status:** Open.
**Reachability:** Reachable when the console is deployed.

The middleware checks only for the presence of a session cookie before allowing
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

**Status:** Open.
**Reachability:** Reachable when the console is deployed.

No global Content Security Policy, frame restriction, MIME-sniffing protection,
referrer policy, permissions policy, or HSTS configuration was found in the
Next configuration or middleware. This permits clickjacking and removes useful
containment if a future XSS or content-type error is introduced.

**Evidence:** `next.config.ts` and `middleware.ts` contain no global security
header policy at this snapshot.

**Required fix:** add and integration-test `frame-ancestors 'none'`,
`X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, a strict referrer
policy, a minimal permissions policy, and HSTS on verified HTTPS production.
Introduce CSP in report-only mode first, collect violations, then enforce a
Next-compatible policy without silently permitting arbitrary scripts.

### SEC-010 — Medium — Gmail OAuth state is session text, not a one-time signed transaction

**Status:** Open; mailbox connection is not authorized yet.
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

### SEC-011 — Medium — Mailbox PATCH permits broad record mutation

**Status:** Open; automation/mailboxes remain off.
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

1. Close `SEC-001` with server-enforced no-public-signup and synthetic fixture
   authentication.
2. Add the shared browser/request security boundary for `SEC-008`, `SEC-009`,
   and `SEC-013`.
3. Retire or redesign the legacy MCP, agent, browser, and send paths before any
   provider or automation activation.

This audit is a living release artifact. Update each finding with a verifying
commit and regression test when fixed. Do not delete closed findings; preserve
the historical risk and link the control that made it unreachable.
