# Operator and release runbook

## Owner deployment hold (2026-09-08)

Do not deploy or publish the unfinished app, including hosted previews, staging
and production. This hold supersedes earlier release instructions and historical
approvals. Local development, loopback previews, builds, tests and no-upload dry
runs may continue. Finish implementation and required local acceptance gates,
present Riley with an exact-candidate readiness review and all outstanding
live-only checks, then obtain his explicit release approval before any upload.
Neither green CI nor a staging packet authorizes deployment. No existing resource
is to be removed or changed merely to implement this hold.

The local implementation now routes both `npm run deploy` and
`npm run deploy:production` to an unconditional denial. The checked-in production
workflow's deploy job is disabled and requests no provider credentials. These
guards have no argument or environment override; restoring a release path needs
a reviewed source change after the owner's readiness decision. Safety checks and
`scripts/deployment-hold.test.mjs` protect these entry points. Builds and explicit
`--dry-run` checks remain available. This is not a machine-wide block on manually
invoking Wrangler and does not change old workflow versions already on GitHub.
Never invoke another upload command to bypass the hold.

## Emergency stop

1. Use the visible emergency stop in System/Outreach.
2. Verify global intake, queue, send, and follow-up states are off in both runtime
   configuration and the database.
3. Verify no workflow or queue consumer can send; do not trust the UI label alone.
4. Record the timestamp, reason, affected campaign/mailbox, and last confirmed
   outbound event in `docs/STATUS.md` or the incident record.
5. Do not re-enable until the root cause, affected records, and duplicate-send risk
   are known and the owner approves.

## Safe work-cycle start

### Retired legacy remote control (source-only)

The rebuild no longer serves the shared-token MCP tools or internal cron-tick
dispatcher. Both exact endpoints return an empty HTTP 410 with private/no-store
headers for all supported methods, without parsing credentials or bodies. The
root console's scheduled handler is inert even if an obsolete trigger remains.
Ordinary owner routes and the console's OpenNext request/cache exports remain.
Existing external MCP clients intentionally stop working after an approved
rollout; use the owner console, not an alternate legacy token or endpoint.

`MCP_API_TOKEN` is no longer a runtime setting or declared secret binding.
This does not remove any secret from Cloudflare or an external client. Inventory
and revoke obsolete configured credentials during the separately approved release;
do not read or copy their values. Do not restore this shared-key design to repair
a client connection. New integrations require reviewed scoped authorization,
bounded input/cost, auditability and the Revenue Engine's execution gates.

### Operator accounts after the security lockdown

Public registration is disabled at the server, including for allowlisted owner
addresses. The old `/sign-up` URL only explains that access is private. Existing
approved, verified accounts can still sign in; this source change does not create, delete, verify,
or reset any production account.

Do not temporarily reopen signup to provision or recover an owner. Verified
enrollment, MFA, recovery, and session revocation still require the SEC-002
staging/release gate. Before rollout, review existing account provenance and
unrecognized sessions with Riley. Keep deployment blocked until that review and
the remaining security gates pass. The acceptance script's hardcoded fake
credential is for its new disposable database only, never a bootstrap example
for production.

The rebuild checks sessions and administrator roles against the database on
each authorization request. Old signed cache cookies cannot restore deleted or
expired sessions or a removed administrator role. The disposable browser gate
tests the existing revoke-all-sessions endpoint; this is not yet an owner-facing
session-management UI or proof of deployed behavior. A request already in flight
and data already viewed cannot be recalled.

The source now requires exact, valid `AUTH_ALLOWED_EMAILS` and
`AUTH_ADMIN_EMAILS` lists, with at least one address in each and administrators
a subset of owners. Both are read freshly at each authentication boundary.
Missing, malformed, duplicate, wildcard, or contradictory settings stop access
without deleting all sessions or changing roles. An incomplete Cloudflare
environment never falls back to process/build-time approval values.

A valid policy removal revokes the affected owner's sessions when a request
observes it. Admin approval removal demotes their stored role while preserving
ordinary access if they remain an approved, verified owner. Re-adding an address
never restores old sessions or automatically grants admin powers. Use the
reviewed ban control for permanent removal: toggling configuration off and back
on without a request observing it is not a durable revocation operation.

Before rollout, verify both owners' account provenance and approved settings.
An unverified legacy account will be denied; do not bypass this by manually
marking it verified, reopening signup, or removing the checks. Verified
enrollment/recovery and MFA still need a reviewed implementation and rehearsal.
This patch itself makes no live account or configuration change.

### Ban lifecycle rollout (source-only; not permission to migrate)

The candidate ban control requires migration 0071 and the pinned Better Auth
1.6.29 patch together. The migration removes sessions of already-banned users,
revokes sessions in the same database statement as a new ban, and blocks late
session writes for banned users. A permanent UI ban clears old expiry metadata;
unban permits a fresh login but never restores old cookies. The dependency
patch preserves temporary bans without letting an old expiry check overwrite
a newer ban, including edits preserving the deadline. `npm ci` must successfully
apply the patch before verification. The app checks the exact installed guard
definitions at runtime: missing, altered or unreadable guards suspend access.
Do not remove this check to get a mismatched deployment running.

The login library's built-in administrative mutation shortcuts are disabled,
including account creation, password reset and impersonation. The custom
fenced ban/unban/role controls and read-only admin inspection remain. There is
no current app caller of those shortcuts. Future enrollment/recovery work must
provide a reviewed replacement; do not reopen them as an access workaround.

Before any rollout, approve the exact release SHA, a current restorable backup,
an explicit schema inventory and migration sequence, and the remaining security
gates. Do not run a bulk migration command: unrelated 0070 remains unapproved.
Rehearse the 0071 guards and all ban/browser tests in an explicitly authorized
isolated environment before production. This work cycle only uses disposable
test databases, not persistent local, staging, or production data.

Rollback must keep the console inaccessible and outbound work off while the
approved application/schema pair is restored. Do not remove the guards or
restore old sessions as an emergency access workaround. Session deletion is
intentional; affected users must sign in again after an explicit unban. Restoring
a backup containing old sessions requires separately invalidating those sessions
before the console can reopen. MFA, secure recovery/enrollment, deployed
admission proof, and remaining audit blockers still prevent production activation.

### Custom owner API request origins (source-only)

Unsafe custom owner requests require a browser-serialized `Origin` equal to an
explicit `APP_BASE_URL` or `AUTH_ALLOWED_ORIGINS`
entry. Configured root URLs may have a trailing slash; wildcard/path/credential/
query/fragment origins are invalid and suspend mutations. Configure aliases
explicitly; a page on one alias cannot mutate a different alias. The request
Host must equal that already-trusted origin's host (including port); it does not
create trust. Forwarding headers are ignored. This accommodates NextURL's
loopback normalization and proxy-internal URLs without trusting another origin.
Settings are read freshly.

`Sec-Fetch-Site`, when supplied, must be `same-origin`. Clients without Fetch
Metadata must still supply exact Origin; missing/null Origin is denied. No
custom CSRF header is needed by the current same-origin UI. Normal GET/HEAD/
OPTIONS reads are unchanged. This policy does not authenticate a script or
protect against XSS/stolen credentials; session and role checks still run.

Better Auth routes retain library security. Exact HMAC-agent and bearer-service
routes retain their separate authentication, not cookie access. OAuth callback
GET uses its own state check and remains separately audited. Never add a broad
path-prefix or bearer-presence bypass to an owner cookie route. The route
inventory test requires review when an unsafe handler is added or removed.

This is not a production rollout or permission to use mailbox/provider actions.
The high-assurance owner-decision contract, MFA and release approval still apply.

### Mailbox metadata (source-only)

Mailbox metadata PATCH accepts only a nonempty trimmed label (maximum 80
characters, or `null` to clear) and a valid IANA timezone. It cannot change
identity, connection, active/paused state, warmup state, send/check timestamps,
or capacity/delay policy. Unknown fields reject the whole request. A timezone
change affects future scheduler calculations, not authorization to send.
Approved administrators can manage both partners' metadata. Each actual change
requires a current approved admin session and a durable audit event in the same
database transaction; a repeated identical request adds no event. Missing batch
support or audit storage fails closed. This source-only change enables no mail.

### Manual reply boundary (local partial integration)

The actual `/api/clients/[id]/emails/reply` POST now requires the shared current
administrator/origin fence and routes through `handleApprovedManualReply`.
`getManualReplyRuntime()` deliberately returns `null`: authenticated requests
receive private/no-store HTTP 503 without an outbound credential lookup, token
refresh, outbound database operation or Gmail fallback. Authentication still
uses its normal database checks. No environment value enables the mail runtime.

The injected local path accepts only `{ "intentId": "<64 lowercase hex characters>" }`.
The runtime first checks owner-scoped recorded outcomes with a SELECT-only reader.
If no outcome exists, an approval reader loads the immutable intent and current stored
envelope; the handler compares authenticated owner, URL client, mailbox, mode,
Message-ID and exact content digest before invoking the guarded runtime. Bodies are
limited to 1024 actual bytes and five seconds, with strict JSON/UTF-8 validation.
The browser cannot submit authoritative sender, recipient, content, cost or policy.

Responses distinguish accepted mail (`SENT`), accepted mail needing history repair
(`SENT_HISTORY_PENDING`), uncertain delivery (`DELIVERY_UNCERTAIN`), confirmed
rejection (`REJECTED`) and unavailable status (`STATUS_UNAVAILABLE`). A 2xx alone
is not success. Keep the same intent reference for all recovery; never generate a
new one to retry uncertainty. `SENT` means provider acceptance, not inbox delivery.

The old raw-envelope composer is removed from the client email panel. Saved email
activity is now read-only; no generate/reply button can submit the obsolete request.
Durable exact approval and retained-intent recovery must be implemented before
replying is available. Do not restore a Gmail call or count a read-only panel as
completion of the required reply feature.
The synthetic route test calls the real approval writer after seeding synthetic
provider identity metadata. It substitutes provider health/consent/capacity and
transport, not approval creation or the durable receipt reader. Its claim now
uses current database account/session/reviewer, exact approval, lead archive,
global/emergency stop and suppression checks in the SAME INSERT as the budget
reservation. A second check before fake transport catches changes after claiming;
that failed attempt remains reserved and non-resendable. The final budget check
allows an already-reserved amount at the ceiling but rejects a paused or stale
month. This is not an in-flight recall guarantee.

Legacy source `REPLY` (case/whitespace normalized) stops automated sequences, not owner responses. It is not
consent and does not classify the inbound content. Explicit unsubscribe/opt-out,
complaint, bounce and no-MX sources cannot become sendable merely by expiring;
other legacy cooldowns may expire on a valid database timestamp. Unknown/malformed
expiry stays blocked. The separate inbound classifier/opt-out writer is unfinished.
Legacy address wrappers, encoded values and `www.` domain forms use the existing
email parser and a shared pure domain normalizer. A bounded read maps exact raw
suppression inputs to normalized values; the SQL write rechecks every current row
against that mapping. A new or changed row stops the claim instead of using a stale
"not suppressed" answer. The same check runs again before transport. More than
1,000 legacy suppression rows, invalid fields or a mapping over 128 KiB stops for
review; rows are never silently omitted. This compatibility limit must be addressed
with a reviewed canonical suppression migration before larger-scale activation,
not bypassed or described as complete scalable provider policy.
Tests cover changed policy after lookup, zero effects on denial, post-claim stops,
and successful manual responses with automation disabled. A disposable Miniflare
D1 test interleaves changes immediately before the SQL write and repeats concurrent
requests, with zero external requests. These proofs are NOT full policy, the
owner approval UI, production history repair or inbound/opt-out processing.
Those gates, trusted provider ingestion/health and the scheduler's second
outbound caller remain open under ADR 0059. Do not connect a bare intent-store
claim as authorization or repurpose the test runtime as a live configuration.

Source-only migration 0075 and manual envelope v2 now bind the immutable reply
target through its conversation to the exact mailbox and client. Approval writes,
reloads, claims and final checks all require matching sender, connection, recipient,
thread, parent Message-ID and References. The general lead email is not the reply
authority. Missing/default-disconnected/paused/retired metadata stops; READY does
not prove real health. Retirement is permanent. Corrections/reconnections use new
identities and fresh approval, never edits that redirect existing permission.
No migration or provider ingestion is authorized by this runbook. v1 is retained
for legacy characterization, not automatically promoted into new manual approval.
Retirement blocks new sending, not visibility of saved outcomes. History is derived
from immutable intent/approval records, without new writes, claims or provider calls.
It remains scoped to the current admitted owner/session and exact client. Revocation,
expiry and archived leads do not erase a past receipt; expired/impersonated/banned
sessions cannot read it. A storage failure is STATUS_UNAVAILABLE, not permission to
create another attempt. recordedAt means locally observed acceptance, not delivery.

`createManualReplyRuntime` owns mandatory claim/final checks and accepts no injectable
claim or outcome/history writer. Additional provider policy is still incomplete;
the real getter remains null. The GET email reader now serves saved activity only;
see below. The local receipt reader is not a completed inbox, legacy CRM repair or approval UI.
See ADR 0059 for trade-offs and remaining gates.

### Saved email activity (local, read-only)

`GET /api/clients/[id]/emails` requires a current administrator session and returns
`source: SAVED_OUTBOUND_ONLY`, up to five `records`, and nullable `nextCursor`.
Only the optional single `cursor` query parameter is allowed. The cursor is a
createdAt/id position, not permission: every page rechecks exact owner/session/client
scope and each immutable message digest. Status codes: 400 invalid input, 404 absent
or unadmitted scope, 503 unavailable/invalid storage, 200 valid saved page. Responses
are private/no-store. Reading never contacts a provider, refreshes credentials or
writes history/budget. Authentication retains its normal admission behavior.

The panel renders plain text, not HTML, remote images or live thread contents.
Accepted is not delivered; UNKNOWN/DISPATCHING stay uncertain. Missing records do
not prove an empty inbox, and legacy records are not automatically promoted.
Mailbox retirement, approval revocation and archived leads do not hide past records
from a currently admitted owner. Invalid v1/legacy or missing schema is not migrated
by reading. No live database was opened to demonstrate this behavior.

After builds and dry runs exit, run `npm run test:saved-email-ui`. It uses the actual
component, built CSS, real saved-history handler and disposable synthetic storage
on loopback. It tests desktop/mobile, keyboard details, plain-text safety, paging,
loading/errors/client switching and WCAG AA. Screenshots go to ignored
`output/playwright/saved-email-history/`. This is not a full application sign-in,
inbound-mail, production-data or approval/composer acceptance test.

### Legacy email history (local candidate)

The client server page, client metadata GET, and legacy email list/detail GETs use
the same SELECT-only reader. Require a current verified, unbanned administrator,
exact live session without impersonation, and current configured owner admission.
Email ownership is `senderUserId`; sequence history uses `queuedByUserId`, not
the assigned mailbox or address. Recheck admission after asynchronous reads.
Ordinary client pages still reject archived clients; explicit historical email
lookup remains available to its current owner after archive.

Legacy records are explicitly `LEGACY_OUTREACH_EMAIL`, never approved send intents.
Profile history shows at most 50 records; the metadata list returns at most 200,
both with an explicit `hasMore` indication. Detail returns one sender-owned record.
Bodies are plain text, at most 32 KiB, with explicit unavailable reasons for an
oversized or missing text copy. No HTML fallback, raw provider error, Gmail ID,
unused sequence body, credential query, provider call or history write is allowed.
Do not infer delivery from a legacy sent flag. Data remains saved unchanged.

Run `npm run test:legacy-email-ui` after every build/dry run has exited. It exercises
actual client-page props, the full ClientProfile and message viewer with synthetic
auth and disposable SQLite; screenshots are under ignored
`output/playwright/legacy-email-history/`. This is not an app sign-in, approved
reply composer, incoming-mail integration or legacy dashboard/automation test.
The independent overview aggregators now have the sibling current-owner boundary
below. Current verification and remaining gaps live in STATUS.

### Dashboard and automation summaries (local candidate)

Both summary readers require the exact current session, verified/unbanned admin
and configured owner admission, rechecked after their asynchronous reads. Email
rows use `senderUserId`, sequences/steps use `queuedByUserId`, and mailbox metadata
uses `userId`; a reassigned foreign mailbox cannot expose its address through an
owned sequence. The API exports explicit metadata, not raw step bodies, sequence
snapshots, connection identifiers or run diagnostics. Shared business/pipeline
and run-count summaries remain explicitly separate from owner message data.

Dashboard and automation pages pass their server-authenticated actor. Ordinary
members see an access-required dashboard instead of a redirect loop or mail data.
The overview and legacy Gmail status GETs require admin access and use private,
no-store responses, including errors. Gmail status is saved metadata only: no
mailbox synchronization, token refresh, provider health probe or sending authority.

The read-only ORM instance bypasses schema repair and rejects mutation methods.
The overview requires existing settings and computes ready-lead summaries without
stale-sequence recovery. Missing settings/storage are unavailable, not repaired by
viewing the page. Scheduler maintenance defaults are unchanged and remain disabled
by the rebuild controls; this change grants no maintenance or execution authority.

Run `scripts/automation-summary-privacy.test.ts` and
`scripts/automation-summary-d1.test.ts` for the actual entry-point and local-D1
regressions. The full `npm run test:owner-ui` additionally covers real authenticated
dashboard/automation-to-message flows at desktop/mobile sizes using only disposable
accounts and storage. This does not prove live provider integration, all-app security
or the completed redesign. No deployment is permitted by these checks.

### Bounded milestone checklist


1. Read the files listed in `AGENTS.md`.
2. Run `git status --short --branch` and inspect recent commits.
3. Verify current production state read-only if the task touches production.
4. Choose one bounded milestone and state its exit gate.
5. Run the closest targeted test before editing to establish the current result.

## Release gate

1. Confirm the diff contains no secret or untracked owner data.
2. Confirm every autonomous default is off and `npm run check:safety` passes.
3. Back up D1 before any remote migration; record export location and checksum.
4. Run test, typecheck, lint, the secret-sanitizing Cloudflare build, and Wrangler
   dry run on Linux CI. A bundle secret-scan failure is a hard stop.
5. Stop at the owner deployment hold above. Only after finished implementation,
   local acceptance and Riley's exact-release approval may a staging validation
   deployment proceed; use test providers/mail sinks only.
6. Exercise owner flows, workflow retry/idempotency, cost stop, and rollback.
7. Record exact versions/config/resources and obtain production approval.
8. Deploy through the protected GitHub production environment.
9. Verify real health without sending: auth, database, workflows, mailbox read-only
   health, logs, and current safety state.
10. Update STATUS, release history, ADR/gotchas, and rollback instructions.

## Database migration

- Never edit an applied migration.
- Create a new numbered migration that can run once and be safely detected later.
- Test a fresh local database and a copy of representative legacy data.
- Backfill with repeatable commands; preserve historical uncertainty explicitly.
- Reconcile lead, send, reply, suppression, opportunity, client, and cost totals.
- Keep legacy tables/resources through the 30-day stability window.

## Prepare an isolated staging console release

This procedure identifies one exact candidate for the existing isolated console.
It does not deploy it.

1. Confirm the candidate is already committed, pushed, and locally release-gated.
2. Run the explicit staging no-upload check:

   ```powershell
   npx wrangler deploy --env staging --dry-run --autoconfig false
   ```

   Confirm it names only `axiom-revenue-engine-staging`, Browser, assets, the
   staging URL, and fail-closed zero/off variables. Stop on a production D1,
   service, queue, cron, provider secret, or nonzero autonomous cap.
3. Assemble a committed content-addressed packet under
   `docs/releases/staging/`. It must bind the exact commit/tree/source blobs,
   target resources, local checks, prior staging version, rollback action, and
   every remaining gate. Its authority block stays false/zero.
4. Verify the packet from local Git objects:

   ```powershell
   npm run staging:verify-console-release -- docs/releases/staging/<packet>.json
   ```

5. Push the packet and require Linux CI to verify the same committed candidate.
6. Stop. The owner deployment hold above must first be satisfied. A later
   deployment requires Riley's separate exact approval
   phrase `DEPLOY AXIOM REVENUE ENGINE CONSOLE TO ISOLATED STAGING`, bound to the
   packet digest. Do not infer approval from the packet, this runbook, prior chat,
   implementation approval, or a green CI run.

This gate excludes migrations, R2, the engine Worker, Workflows, Queues,
providers, external website capture, real-business data, mailboxes, prospect
contact, and spend.

## Runtime budget response

- At 70% of C$50: warn Riley and show the largest cost drivers.
- At 85%: pause discretionary discovery/audit refresh work.
- At 100%: stop all nonessential provider jobs. Never auto-enable overages.
- Safety, suppression, unsubscribe, and inbound reply handling remain operational.

## Staging R2 activation

Use [`runbooks/STAGING_R2_ACTIVATION.md`](runbooks/STAGING_R2_ACTIVATION.md).
It requires a separate owner approval, current dashboard pricing, an isolated
staging binding, synthetic data only, recorded provider operations/cost, and a
targeted rollback. It does not authorize production, prospect evidence, remote
D1 migrations, or autonomous work.

## Prepare the bounded ten-business KW shadow slice

This creates the durable scope for the first real-business integration proof. It
does not execute any phase of the pipeline.

1. Keep the exact prepared source plan, owner-reviewed selection, and generated
   manifest as three different direct children of ignored
   `data/kw-evaluation/` storage.
2. Select exactly ten businesses already present in the source plan. Each must
   be manually confirmed as the correct independent business in Kitchener,
   Waterloo, or Cambridge and in roofing, HVAC, or landscaping. Source evidence
   must be no more than 90 days old.
3. Keep at least two businesses from each city and each niche. The selection
   file must bind the source-plan digest, exact business/candidate IDs, reviewer,
   review time, rationale, and the contract's all-false/zero authority block.
4. Prepare the no-overwrite manifest:

   ```powershell
   npm run kw:prepare-shadow-slice -- --source-plan data/kw-evaluation/plan.json --selection data/kw-evaluation/shadow-slice-selection.json --output data/kw-evaluation/shadow-slice-manifest.json
   ```

5. Confirm the output says ten selected/manual/independent businesses,
   `SOURCE_REVIEWED`, and
   `SOURCE_WORKFLOW_MATERIALIZATION_APPROVAL`. Confirm all five ordered phases
   require separate approval and none is authorized by the manifest.
6. Stop on stale evidence, duplicate identity, source-plan drift, imbalance, or
   an unconfirmed/unknown chain status. Never loosen the manifest to make a
   candidate fit.

The manifest cannot read or write a database, call a provider, capture a site,
infer consent, change qualification, deploy, send, or spend. Populate it with
real records only after the separate private-research decision. Each later phase
uses its own gate below; never treat this manifest as batch-execution approval.

### Record one completed shadow phase without losing progress

Record progress only after the phase's existing approval, execution, exact
reload, and receipt verification have succeeded. This command does not perform
those steps.

For the first `SOURCE_WORKFLOW` phase, never hand-author the normalized receipt.
After `kw:materialize-source-workflow` reports a sealed exact result, prepare it
from the same reviewed inputs and ignored local database:

```powershell
npm run kw:prepare-source-workflow-progress -- --manifest data/kw-evaluation/shadow-slice-manifest.json --source-plan data/kw-evaluation/plan.json --materialization data/kw-evaluation/materialization.json --database data/kw-evaluation/shadow.sqlite --output data/kw-evaluation/source-workflow-phase-receipt.json
```

This adapter opens SQLite read-only and query-only, re-derives the approved
materialization, rejects a non-canonical schema, and requires every expected
source/workflow row plus the sealed terminal workflow and materialization
receipts to match exactly. It produces proof for the recorder; it neither
executes nor approves materialization.

1. Keep the immutable manifest, source plan, materialization approval, local
   database, normalized phase-receipt input, previous
   checkpoint, and next checkpoint as different ignored files.
2. For the first completed source/workflow phase, omit `--previous`:

   ```powershell
   npm run kw:record-shadow-progress -- --manifest data/kw-evaluation/shadow-slice-manifest.json --receipt data/kw-evaluation/source-workflow-phase-receipt.json --output data/kw-evaluation/shadow-progress-001.json
   ```

   For every later append, use the exact latest checkpoint:

   ```powershell
   npm run kw:record-shadow-progress -- --manifest data/kw-evaluation/shadow-slice-manifest.json --previous data/kw-evaluation/shadow-progress-current.json --receipt data/kw-evaluation/shadow-phase-receipt.json --output data/kw-evaluation/shadow-progress-next.json
   ```

3. Confirm only the named business advanced one phase and that the output names
   the previous checkpoint, exact predecessor phase receipt, upstream receipt
   IDs/digests, current checkpoint, and next separate gate.
4. Promote the new output to “current” by reference or filename convention; do
   not overwrite or edit either checkpoint. A later task must resume from the
   exact latest content-derived checkpoint.
5. Stop on a skipped phase, wrong predecessor, reused upstream receipt,
   cross-business evidence, manifest drift, time reversal, digest mismatch, or
   unknown proof type. Never redigest or hand-repair a failed checkpoint.

The recorder reads and writes bounded ignored JSON only. It cannot inspect or
mutate a database, validate a provider call, execute Browser Rendering, infer
consent, change qualification, contact a prospect, deploy, send, or spend. A
checkpoint proves only that exact already-verified receipts were recorded.

The `CURRENT_WEBSITE_EVIDENCE` proof contract is a synthetic-only engineering
boundary, not an operator command. Its builder can validate the
exact manifest/predecessor lineage, a complete fixture website workflow,
desktop and mobile homepage evidence, the deterministic audit, the durable
persistence plan, every screenshot/measurement manifest, and fresh fixture
availability observations. Its authority block forbids Browser, R2, database,
progress, provider, contact, deployment, send, and spend operations. The
progress recorder additionally requires a separate content-addressed
`website-evidence-eligibility:*` receipt.

The validation-only eligibility builder can now create that receipt only from
one exact frozen in-process private D1 completeness execution per artifact
manifest. Every execution must be a fresh commit, match the same persisted
terminal workflow/business/audit and complete manifest forest, and contain a
current verified `R2_HEAD` availability receipt for its exact content-addressed
screenshot/measurement manifest. The builder freezes its output and tags the
exact in-process instance; a copied or hand-addressed JSON receipt is not trusted
provenance even when its schema and digest are valid.

The durable eligibility persistence/reload boundary now exists in schema 0068,
but it is deliberately not an operator command or runtime connection. It accepts
a new row only from the exact in-process eligibility result, commits and reloads
that row atomically, and later verifies the canonical stored receipt from its
content-derived ID/digest. Every reload uses the database clock and labels the
receipt `NOT_YET_CURRENT`, `CURRENT`, or `STALE`; historical storage never
refreshes evidence. Copied result envelopes cannot cross the new private trusted
reload guard.

Never hand-author, copy, or use an eligibility receipt to advance a real
business. The validation-only phase-input adapter accepts only the exact
in-process `CURRENT` result returned by a `DURABLE_RELOAD`; a fresh commit,
exact replay, copied result, stale receipt, wrong manifest, wrong predecessor,
proof drift, or false chronology fails closed. Its frozen output is still only
a normalized zero-authority input: the adapter does not call the progress
appender or create a phase receipt/checkpoint.

The separate guarded append boundary accepts only that exact module-private
input with the manifest and content-addressed parent checkpoint used to derive
it. A content-equivalent reloaded parent is valid; any redigested change anywhere
in the ten-business checkpoint is not. The boundary calls the canonical
appender, independently verifies that exactly one website-evidence receipt and
no other business changed, deeply freezes the result, and returns the same
checkpoint object on an identical in-process retry. It does not write a file or
database. There is no operator command, live binding, or durable progress path
for this phase. Synthetic tests use local SQLite rows and in-memory artifacts
only. Live capture, R2 activation/HEAD reads, Cloudflare D1 execution, applying
schema 0068 to a real database, and real progress remain separate future
approvals and implementations.

The `ASSESSMENT` proof contract is also an engineering boundary rather than an
operator command. Its private D1 loader starts from only the assessment ID and
digest, verifies every migration-0061 immutable trigger, reads the database
clock, reloads the exact receipt, sealed terminal workflow source, business,
website snapshot, complete evidence set, and qualification snapshot, then
rebuilds the assessment deterministically. Every canonical row must match and
freshness must be `CURRENT`. The result is deeply frozen and trusted only by
exact in-process identity; copied or hand-authored JSON, immediate commit/replay
responses, missing guards, source drift, row drift, and stale history fail
closed.

The proof builder accepts only that exact current durable reload and uses its D1
clock as proof time. It binds those facts to the exact completed
current-website-evidence phase in one `assessment-proof:*`. A separate
validation-only adapter now regenerates that proof internally and can derive one
frozen `ASSESSMENT` phase input only after rechecking the exact ten-business
manifest, selected business, two-receipt predecessor prefix, canonical complete
parent checkpoint, and chronology. It uses the durable receipt and D1 clock;
there is no caller-owned progress time. A valid later receipt for another
business is allowed only when the adapter is re-run against that exact new
parent and D1 time is not older than the checkpoint.

The phase input is trusted only by exact in-process identity and privately bound
to its manifest and parent ID/digest. Copied input or reload JSON, an edited and
re-hashed parent time, a changed parent presented after derivation, stale
assessment history, or lineage drift fails closed.

A separate guarded in-memory append boundary accepts only that exact input and
the content-equivalent manifest and parent used during derivation. It calls the
canonical appender, then independently proves that only the selected business
gained one exact assessment receipt, its prior prefix and the other nine
businesses remained unchanged, and the summary moved one business from current
website evidence to assessment persisted. An exact retry returns the same
frozen checkpoint instance; copied input, a changed parent, or replay against
the completed child fails closed.

Never hand-author the durable reload, proof, phase input, or appended checkpoint.
There is no operator command, file/database writer, Worker import, live D1
binding, or real-business path. The durable loader authorizes reads only and the
append boundary changes in-memory validation state only; neither authorizes
qualification execution, contact work, provider use, deployment, outreach,
send, or spend. The validation-only `CONTACT_REVIEW` phase-input and guarded
in-memory append boundaries are described below.

The durable `CONTACT_REVIEW` proof now exists as another engineering-only
boundary. Its read-only loader starts from the exact invocation ID/digest and
verifies the complete migration 0062–0067 source/contact writer-
guard set, canonical invocation receipt, exact rebuilt assessment, source
materialization receipt, every re-derived contact-plan row, and the final contact
materialization receipt. It reads database time last so evidence cannot expire
while the proof is assembled unnoticed. Freshness ends at the earlier of
assessment refresh or verification expiry. Only the exact deeply frozen
`CURRENT` reload is trusted;
copied JSON, writer responses, missing/ambiguous rows, guard drift, stale history,
and row drift fail closed.

The proof builder additionally requires the exact in-process assessment
checkpoint. It verifies that the first phase still names the reloaded source
materialization and the third phase still names the reloaded assessment and its
separate proof, then binds the reviewed invocation and final contact receipt in
one `contact-review-proof:*`. Never hand-author or copy that result.

The validation-only contact-review phase-input adapter accepts only the exact
in-process `CURRENT` durable reload and exact guarded assessment checkpoint. It
regenerates the proof internally, rechecks the complete ten-business scope,
selected manifest business, exact three-receipt predecessor, reviewed invocation,
final materialization, and database chronology, then returns one deeply frozen
zero-authority input. Its completion time comes from the invocation receipt and
its recording time comes from the final database clock. Copied reload, proof,
input, or checkpoint JSON cannot recreate trust, and the input remains privately
bound to its unchanged assessment parent.

The separate contact-review append accepts only that exact trusted input and its
unchanged content-addressed assessment parent. It calls the canonical receipt
builder/appender, then independently proves one added receipt, the exact
`ASSESSMENT_PERSISTED` to `CONTACT_REVIEW_PERSISTED` summary transition, the
unchanged three-receipt prefix, and unchanged other nine businesses. Exact retry
returns the same frozen checkpoint; copied input, changed manifest/parent, and
completed-child replay fail closed.

There is no operator command, file/database writer, live binding, provider
operation, real-business path, outreach, or spend authority. Never pass a
hand-authored contact-review input to the generic recorder.

The validation-only `OWNER_DOSSIER` boundary starts by reading the exact owner
dossier through the SELECT-only reader. Only the exact deeply frozen in-process
response is trusted; copied JSON is rejected. Qualification and current routing
must remain separate: discovering a route cannot rewrite or stale the immutable
lead-quality snapshot.

The proof builder requires that exact current dossier and exact guarded
contact-review checkpoint. It binds the complete dossier digest, manifest and
source identity, website/qualification snapshots, current contact invocation,
four-receipt predecessor, and an explicit Riley/Aidan declaration made no more
than five minutes after dossier generation. The resulting
`owner-dossier-acceptance:*` object explicitly says that session authentication
is not proven and no decision is durably recorded.

The separate phase-input adapter regenerates that proof internally and returns
one frozen, parent-bound `OWNER_DOSSIER` input. Never hand-author or reload the
proof/input from JSON.

The separate owner-dossier append accepts only that exact input and unchanged
content-addressed contact-review parent. It calls the canonical receipt
builder/appender, then independently proves one final receipt, the exact
`CONTACT_REVIEW_PERSISTED` to `OWNER_DOSSIER_ACCEPTED` transition, the
fully-completed count, the first still-incomplete business pointer, the unchanged
four-receipt prefix, the complete manifest-bound business/evaluation/source
identity, and unchanged other nine businesses. Exact retry returns the same
frozen checkpoint. Copied input/result JSON, another manifest, any changed or
re-digested parent, and completed-child replay fail closed. Never pass a
hand-authored owner-dossier input to the generic recorder.

This progress append remains in-memory contract verification only. It creates no
real authenticated or durably stored owner decision, operator command,
file/database writer, API/UI action, Worker import, live resource, real-business
path, provider operation, outreach, send, or spend. Actual owner-decision
activation, progress bridging, and operator wiring remain separate
approval-gated designs.

### Inactive authenticated owner-decision foundation

ADRs 0046–0047 and migration 0069 now define the future owner-decision security,
storage, and exact durable-reload shape. They are not an operator procedure and
must not be treated as one.

- The browser declaration contains only the exact dossier/business digest,
  acceptance, rationale, and fixed confirmation. It cannot choose the reviewer
  or timestamp.
- A future server boundary must obtain the current Better Auth session in the
  same request, require a verified email for exactly Riley or Aidan, derive the
  time from the server, and supply a separate secret binding key from provider
  secret storage. The boundary's HMAC recheck verifies continuity; it does not
  query Better Auth itself. Never accept any session field from request JSON.
- The candidate retains only HMAC subject/session/decision bindings and the
  owner enum. Never log or persist raw user ID, session ID, session token, email,
  or binding key.
- Migration 0069 is source-only. Do not apply it to an existing local, staging,
  or production database under this checkpoint.
- A disconnected injected D1-shaped boundary exists for synthetic tests. Fresh
  persistence requires the exact private candidate and same current verified
  session, while process-loss reload verifies historical HMAC/mirror integrity.
  It has no Cloudflare adapter, D1 binding, route, button, CLI, or progress
  bridge. Never call it against a live resource.
- A durable reload is not a current authenticated session and grants no progress
  authority. A schema-valid row or copied JSON remains untrusted.
- Before any activation, require verified owner email, MFA and recovery setup,
  a separate progress-authorization threat review, database-clock/session-expiry
  enforcement, exact migration-0069 writer-guard verification, CSRF/origin and
  idempotency controls, staging/rollback evidence, and explicit release approval.

Until every gate above is complete, re-run only the synthetic contract tests;
never configure binding material, apply migration 0069, hand-insert an owner
decision, connect the boundary, or use one to append real progress.

## Owner-approved local KW materialization and assessment

The exact-schema guard accepts the original canonical Revenue tables from
0054-0069, or those tables plus the **complete exact** provider-neutral mailbox
extension from source migration 0075. It does not ignore tables by prefix or
permit arbitrary extra objects: partial/altered tables, indexes or triggers still
deny. This is compatibility validation, not migration authority. The inspector
creates only a disposable in-memory reference; the supplied database is unchanged.

This procedure is local shadow evaluation only. Source/workflow materialization
and assessment are two different owner decisions. Neither authorizes capture,
contact discovery/verification, outreach, providers, staging, production,
deployment, or a migration.

1. Keep the prepared source plan, source/workflow approval, assessment
   invocation, and SQLite database as different direct children of ignored
   `data/kw-evaluation/` storage.
2. Confirm the local database already has the canonical migrations 0054–0069.
   Database creation/migration is a separate developer setup step; neither
   command below may create or migrate it. Never point either command at Wrangler
   state or a remote database.
3. Review the source-plan counts and one candidate's identity plus deterministic
   audit input. The source/workflow approval must bind their exact digests, use
   its own confirmation phrase, and reach SQLite within five minutes. Execute:

   ```powershell
   npm run kw:materialize-source-workflow -- --source-plan data/kw-evaluation/plan.json --materialization data/kw-evaluation/materialization.json --database data/kw-evaluation/shadow.sqlite
   ```

4. Expect `FRESH_COMMIT` once and `EXACT_REPLAY` on an unchanged retry. The
   command must report a sealed workflow receipt but no assessment. Stop on a
   hidden identity collision, stale approval, deterministic-input drift,
   non-canonical schema, partial receipt, or failed exact reload; never repair it
   by editing SQLite.
5. Separately review the candidate's business-fit/timing evidence, scores, and
   policy blocks. Bind the assessment invocation to the sealed receipt from step
   3, use the different assessment confirmation, and submit its current timestamp
   within the assessment writer's five-minute window. Execute:

   ```powershell
   npm run kw:execute-assessment -- --source-plan data/kw-evaluation/plan.json --invocation data/kw-evaluation/assessment.json --database data/kw-evaluation/shadow.sqlite
   ```

6. Expect `FRESH_COMMIT` once and `EXACT_REPLAY` on an unchanged retry. Stop on
   `MISSING`, `CONFLICT`, source-plan drift, any non-canonical Revenue table,
   index or trigger, stale time, or an unsealed receipt; do not work around the
   gate by editing SQLite.
7. Verify the owner reader shows the new assessment with reachability zero and
   route `RESEARCH`. No provider cost or external action should exist.

## Local contact persistence boundary

This procedure can preserve owner-reviewed fixture contact evidence beside one
exact assessed lead. It does not run live discovery or verification and does not
authorize CASL consent, qualification changes, outreach, providers, staging,
production, deployment, or migration.

1. Keep the source plan, contact draft, generated review, final approval, and
   `.sqlite` database as different direct children of ignored
   `data/kw-evaluation/` storage. The source/workflow and assessment procedures
   above must already have completed for the exact business.
2. Confirm the database already has canonical migrations 0054–0069. Neither
   command creates or migrates it, and neither accepts Wrangler or remote state.
3. Prepare the owner-readable review:

   ```powershell
   npm run kw:prepare-contact-review -- --source-plan data/kw-evaluation/plan.json --draft data/kw-evaluation/contact-draft.json --database data/kw-evaluation/shadow.sqlite --output data/kw-evaluation/contact-review.json
   ```

   The command opens SQLite read-only, reconstructs the assessment from its
   sealed workflow receipt, rebuilds fixture discovery and verification from the
   observations, and creates a no-overwrite review packet. Confirm its business,
   assessment, evidence sources/times, contact values, route status, and
   `UNASSESSED` consent state. It must not change any database count.
4. Riley or Aidan must create a different approval binding the exact review,
   source-plan digest, assessment receipt/digest, persistence-plan digest, every
   verification result, reviewer, current timestamp, rationale, and dedicated
   contact-persistence confirmation. Do not reuse an assessment or source
   approval. Execute within five minutes:

   ```powershell
   npm run kw:persist-contacts -- --source-plan data/kw-evaluation/plan.json --review data/kw-evaluation/contact-review.json --approval data/kw-evaluation/contact-approval.json --database data/kw-evaluation/shadow.sqlite
   ```

5. Expect `FRESH_COMMIT` once and `EXACT_REPLAY` on an unchanged retry. Verify
   one immutable invocation receipt retains the full review and exact source,
   assessment, contact-materialization, discovery, verification, reviewer, and
   approval lineage. Consent and qualification counts must not increase.
6. Stop on `MISSING`, `CONFLICT`, drift, stale approval, partial or unreceipted
   history, a non-canonical schema, or failed reload. Never repair contact rows
   by hand. A final invocation-receipt failure must roll back the contact bundle.

The commands cannot contact a prospect, call a provider, spend, send, deploy, or
touch a remote database. A future live provider and CASL decision require
separate owner, privacy, budget, and release gates.

## Resumable KW owner-labelling checkpoint

This procedure records Riley's Strong/Weak/Wrong lead-quality decisions without
changing the private database or enabling any pipeline action.

1. Keep the exact source plan, existing local SQLite database, current labelling
   packet, review submission, and next packet as distinct direct children of
   ignored `data/kw-evaluation/` storage.
2. Confirm the database has canonical migrations 0054–0069 and contains the
   exact 50-business source cohort plus one sealed current assessment receipt for
   every business. The command refuses a partial cohort so completed labels can
   never be invalidated by adding leads later.
3. Prepare a no-overwrite packet from the read-only database:

   ```powershell
   npm run kw:prepare-owner-labeling -- --source-plan data/kw-evaluation/plan.json --database data/kw-evaluation/shadow.sqlite --output data/kw-evaluation/owner-labeling.json
   ```

4. Sign in to the local console, open `/leads/evaluation`, and load the prepared
   packet. Review each business identity, audit, five scores, engine label, and
   exact evidence; choose `STRONG`, `WEAK`, or `WRONG`, at least one offered
   reason, and an optional note. Partial batches are allowed. Download the review
   file when the batch is complete. Browser drafts resume only for the same
   packet digest; they are not durable system truth until step 5 records them.
5. Record the batch into a different no-overwrite checkpoint:

   ```powershell
   npm run kw:record-owner-labels -- --packet data/kw-evaluation/owner-labeling.json --reviews data/kw-evaluation/owner-reviews.json --output data/kw-evaluation/owner-labeling-next.json
   ```

6. Confirm the new packet names the prior packet as its parent and the reviewed,
   agreement, balance, and gate counts are correct. Use this new packet as the
   input for the next review batch; never edit or overwrite an older checkpoint.
7. Stop on source, assessment, packet, digest, timestamp, identity, or decision
   drift. Do not repair the checkpoint by hand.

Both commands are ignored-local only. The Quality Lab validation route is
authenticated, private/no-store, bounded to JSON, and has no database or provider
binding. Together they authorize no database mutation, provider or network
operation, acquisition, qualification change, consent
decision, outreach, sending, deployment, remote database, or spend.

## Weekly owner review (30 minutes)

1. Handle qualified replies and overdue opportunities.
2. Review top leads and manual-channel actions.
3. Approve/reject/correct the next message batch.
4. Review qualified replies, opportunities, customers, deliverability, and spend.
5. Approve or reject the one proposed targeting/scoring/message experiment.

## Browser-protection release gate (SEC-009)

`next.config.ts` applies the shared browser headers to application responses.
`public/_headers` covers Cloudflare static assets, which can bypass that code;
the policy test requires exact parity. Preserve route-specific content types,
CORS and caching. See [Cloudflare static headers](https://developers.cloudflare.com/workers/static-assets/headers/).

Framing, object embedding, MIME sniffing, referrer disclosure and unnecessary
camera/microphone/location/payment/USB access are restricted. Script/style CSP
is deliberately report-only; inline Next hydration and existing styles require
compatibility evaluation. There is no external reporting endpoint or telemetry
upload. Never add unsafe-inline/unsafe-eval to a production script policy simply
to make a browser test green.

Before a separately authorized release, verify headers on HTTPS pages, denied
API requests, errors, static assets and redirects through the actual adapter.
Collect only directive/disposition counts from browser CSP violation events in
a synthetic session; do not log source snippets, private URLs or message data.
Resolve violations using a Next-compatible nonce/hash strategy, verify ordinary
owner flows, then enforce strict CSP. HSTS requires verified HTTPS and a rollback
plan; start with an approved host-only policy, not unverified includeSubDomains
or preload. SEC-009 is not fully closed before these gates pass.

## Mailbox connection transaction release gate (SEC-010)

Source migration `0072_gmail_oauth_transactions.sql` is additive. A future
approved deployment needs a current backup, explicit migration approval and
rollback plan. Do not blanket-apply pending migrations: 0070 remains a separate
unapproved design. Missing 0072 stops connection rather than using legacy state.

Each attempt is tied to its current administrator, session, exact callback and
normalized intended mailbox. It expires after ten minutes and is consumed before
the provider exchange; a cancellation, timeout or provider failure requires a
fresh attempt. Existing configured mailbox links supply the required target.
Start from Settings inside the console: initiation requires same-origin browser
Fetch Metadata and the shared trusted-origin/host fence. External/bookmarked
connection URLs and clients without that browser metadata cannot create state.
No raw session ID, provider error or expected/actual address is returned in error
URLs. Never log state, authorization codes or tokens. This follows the one-time
session-bound state guidance in [OAuth Security BCP](https://www.rfc-editor.org/info/rfc9700/).

Local D1 and browser fixtures prove state fencing without contacting Google.
Successful Google consent/token storage still needs a separately authorized
staging test before release; review provider configuration, callback registration
and PKCE support then. Keep mailbox operations and sending off throughout.

## Resume/handoff

### Retired legacy browser execution (SEC-004, source only)

The old scraper and website/search collectors reject work with a fixed retirement
error. `runCloudScrapeWorker` returns `claimed: false` before reading bindings,
environment, settings or jobs. There is no legacy Cloudflare browser launch,
local Playwright fallback, navigation, AI call or job heartbeat/retry loop.
Do not restore these paths by supplying bindings or enabling old switches.

Read-only scrape history and pure Maps parser helpers remain available; a parsed
or normalized URL is never authorization to contact that destination. The new
evidence-capture contracts remain separate. Before live capture, prove DNS/private
address enforcement, redirect and rebinding protection, platform egress isolation,
bounded requests and costs, and the approved provider/release configuration.
Fixture tests alone cannot prove these network properties. This checkpoint
does not deploy, change stored jobs/leads, migrate, activate or revoke resources.

### Retired external legacy agents (SEC-005, source only)

The six `/api/agent/jobs` endpoints (claim, results, heartbeat, logs, complete,
failed) now return empty 410 responses with no operational authority. Do not
re-enable an old client or create replacement shared credentials to bypass this
retirement. New execution belongs to the separately gated engine, not these URLs.
The internal Cloudflare scrape helpers and validator remain unchanged and off.

Before an explicitly approved rollout, inventory and stop any external legacy
worker, then revoke its obsolete configured `AGENT_SHARED_SECRET`. This change
does not inspect or revoke real provider secrets. Source searches cannot prove
whether external clients still exist. The obsolete `worker`/`worker:local`
package commands and legacy launcher scripts refer to missing files and are not
a supported way to start the rebuilt engine. No migration, live database write,
deployment or activation is part of this source checkpoint.

Before stopping, update `docs/STATUS.md` with the verified commit, production and
automation state, completed exit gate, tests, budget effect, blockers, owner
decisions, and exactly three next actions. Commit documentation with the code it
describes.
