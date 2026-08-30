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

The first owner-safe Leads workspace is now implemented in source at `/leads`.
It ranks current v2 businesses, keeps all five quality scores visible, explains
“why this lead” with exact evidence links, and recommends the strongest supported
email, phone, form, social, or research route. Phone, form, and social remain
manual; the list itself contains no approval, direct-contact, or send action.
Stale, blocked, rejected, empty, loading, and unavailable states stay explicit
instead of falling back to legacy records or a false “healthy” view.

The workspace reads the same deterministic owner contract as the authenticated,
private/no-store `GET /api/v1/leads` endpoint. The reader is SELECT-only, bounded
to 100 businesses, and grants no qualification, mutation, outreach, provider, or
spend authority. The primary navigation now opens `/leads`; the old `/vault`
route remains available only as a legacy reference. Nothing in this workspace
has been deployed. A private v2 audit/qualification writer now exists in source,
but it is not imported by a Worker, route, queue, or provider path.

The owner quality-calibration workspace is also implemented in source at
`/leads/evaluation`. Riley loads the exact prepared 50-business checkpoint,
compares the engine's verdict with the five visible scores and supporting
evidence, selects Strong/Weak/Wrong plus a plain-language reason, and downloads
an immutable review batch. Unfinished work stays in browser storage bound to the
exact packet digest. The screen cannot read or write D1, call a provider, change
qualification or consent, contact a business, send, deploy, or spend. It has not
been published to staging.

The first isolated-staging console release packet is committed at
`docs/releases/staging/2026-08-28-owner-quality-lab.json`. It binds the already
tested Quality Lab commit, exact owner UI/API blobs, isolated staging resources,
local checks, and the currently deployed rollback version. Verify it with
`npm run staging:verify-console-release -- docs/releases/staging/2026-08-28-owner-quality-lab.json`.
Exact packet-commit Linux CI run `33221735787` passed. The packet still leaves
owner approval, deployment, and staging smoke checks pending and grants zero
migration, provider, mailbox, prospect, or spend authority.

That writer accepts only an exact sealed website-evidence receipt and persists
the website snapshot, every evidence claim, a conservative qualification, and
one assessment receipt through a single D1 batch. Exact retries write nothing;
collisions or an incomplete existing receipt stop the operation. Reachability
stays zero and the route stays `RESEARCH` until the separate contact-verification
phase proves a usable channel. Migration 0061 also makes those shadow assessment
records append-only. It is tested only in disposable local D1 and has not been
applied to staging or production.

An owner-approved local invocation path can now call that writer against one
ignored `.sqlite` database. It re-derives the source plan from trusted code,
requires every source row to be exactly materialized, binds one reviewed KW
candidate to one sealed receipt and timestamp, and then permits only the
append-only assessment write. It cannot import source/workflow rows, discover a
contact, call a provider, send outreach, migrate staging/production, or use the
engine Worker.

A separate owner-approved local materialization gate now fills that exact gap.
It accepts the original ignored source plan plus a different approval file,
re-derives the website audit from deterministic inputs, and appends the source
rows, six-row sealed workflow lineage, and a schema-0064 materialization receipt
inside one SQLite `IMMEDIATE` transaction. The receipt is inserted last and every
row is reloaded before commit; exact replay writes nothing and a hidden identity,
partial receipt, stale approval, or schema drift stops. This gate cannot assess
or qualify the lead, capture a website, call a provider, persist contacts, send
outreach, run migrations, deploy, or touch staging/production.

The next contact-quality boundary now exists as fixture-only typed contracts.
Discovery preserves email, Canadian phone, form, and supported social routes as
content-bound evidence candidates; an email-shaped string stays explicitly
unverified and consent-unassessed. Verification is a separate channel-specific
receipt bound to that exact business and candidate. A current deliverable
named/role email can become owner-reviewable, while positive phone, form, and
social results remain manual. Catch-all, generic, unknown, stale, or negative
outcomes remain research work. These contracts cannot persist a contact, call a
provider, approve outreach, spend money, or send, and the engine Worker does not
execute them.

The append-only storage boundary for those contracts now exists in migrations
0062–0063 and a validation-only persistence planner. A stable candidate identity can
gain new immutable discovery versions; exact public evidence is stored once and
linked to every version that used it; verification refreshes append rather than
overwriting prior state. Collision checks distinguish a fresh plan, exact replay,
and corrupt/incomplete history. The planner itself remains zero-authority.

A separately approved local executor now re-derives that planner from exact
fixture results and can append one bundle to a canonical ignored SQLite database
inside an `IMMEDIATE` transaction. Migration 0065 adds a different completion
receipt that is inserted last; migration 0066 hardens its content-derived identity
and exact verification set. The receipt requires the whole contact/evidence/
verification set; exact replay writes nothing, while partial or receipt-less
history stops.

The guarded operator invocation now has two explicit stages. A read-only command
proves the exact source and persisted assessment lineage, reconstructs fixture
discovery/verification from reviewed observations, and writes a no-overwrite
review packet. A separate current owner approval can then persist that exact
bundle and an immutable migration-0067 receipt under one outer `IMMEDIATE`
transaction. The receipt retains the full review plus source, assessment,
contact, reviewer, and approval lineage. Neither command can call a provider,
infer consent, change qualification, send outreach, use a remote database, or
spend. Migrations 0062–0067 have been applied only to ignored local state and
disposable tests—not staging or production.

Each ranked business now opens a read-only dossier at `/leads/[businessId]`.
The dossier keeps the five quality scores separate; groups current audit findings
as critical, important, or minor; shows the exact recorded contact routes and why
one is recommended; and builds a bounded factual timeline from v2 source, audit,
qualification, contact, and verification records. It also reads the latest
immutable contact-invocation receipt and says, in plain language, whether Riley
or Aidan reviewed the exact current contact packet, what was approved for local
storage, and whether a later audit or score made that review stale. Missing or
invalid review proof is never presented as approval, consent remains explicitly
unassessed, and the section cannot trigger qualification, outreach, sending,
provider use, or spend. Opaque desktop, mobile, and DOM
artifact references are labelled as reference-only until private evidence storage
is activated. Outreach, reply, opportunity, and client history are explicitly
shown as unavailable when they do not exist in v2—legacy data is never guessed or
silently merged. The matching authenticated `GET /api/v1/leads/[businessId]`
endpoint is private/no-store and read-only.

The Leads list and dossier now share an automated owner acceptance gate. It
starts the real Next.js application against an isolated synthetic database with
all migrations, creates a real local operator session, and checks the two owner
flows in Chromium at desktop and mobile sizes. The gate covers WCAG 2.2 AA
labels and contrast, keyboard/skip-link focus, reduced motion, 24-pixel target
minimums, horizontal overflow, mobile navigation clearance, distinct page
titles, read-only controls, and 10/15-second discoverability budgets. Browser
requests are restricted to the exact loopback origin; no provider or prospect
can be contacted by the test.

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
planned 30-day lifecycle. Qualification evidence requires review after 180 days,
but qualification, outreach, and legal-hold objects never receive an automatic
expiry. R2 is still disabled and no bucket, binding, object, operation, or charge
exists.

The audit assembler now combines those bounded inputs across a home, service,
about, and contact page. It will not call a page set complete unless all four are
captured with complete HTML/desktop coverage and the homepage has complete mobile
measurements. Missing or partial coverage stays visible and keeps absence checks
unknown; it cannot be converted into a reason to contact a business. The
assembler is fixture-only, capped at zero dollars, and has no provider access.

Before those pages are captured, a deterministic selector now ranks the
homepage's same-site links for one service, about, and contact page. It favours
specific services relevant to the business, explains every role score, and
filters noisy destinations such as blogs, careers, policy pages, FAQs, financing,
files, query URLs, and homepage duplicates. Missing or incomplete discovery stays
partial instead of sending the crawler back to random pages. Selection is also
fixture-only, provider-free, and zero-cost.

Evidence lifecycle planning is now explicit as well. The same verified content
hash can move only toward stronger protection: shadow, qualification, outreach,
then legal hold. Every copy is create-if-absent and reconciled; retries cannot
overwrite a conflicting object. A retention-release record must bind every known
use, the reviewing owner/compliance actor, reason, and exact decision. It still
cannot delete an object—deletion needs a fresh reference check and a separate
future release gate. All lifecycle work remains fixture-only and zero-cost.

Those boundaries now run together in one fixture-only business workflow. Eight
fixed receipts cover homepage capture, fact extraction, page selection, subpage
capture, Browser measurement, artifact storage, audit assembly, and the final
deterministic audit. An unreachable homepage is a real observed site state;
missing page/mobile proof stays partial and unknown; identity, integrity, or
storage failure publishes no audit. Repeating the same workflow safely reuses
matching content-addressed artifacts. This is still an in-process proof—there is
no live provider adapter, binding, deployment, or execution authority.

The first durable-record boundary is now defined without enabling it. Additive
migration 0056 separates the stable workflow request from immutable attempt and
step receipts, and adds queryable page-selection, audit-assembly, manifest,
promotion, evidence-use, and release records. A validation-only planner binds
each row to canonical JSON and digests, requires an exact preflight before every
insert-if-absent statement, and rejects drift, identity collisions, or manifests
outside the workflow's receipt/promotion chain. It explicitly grants neither
database mutation nor resume authority. The migration passes from zero in an
isolated local D1 store, but it has not been applied to staging or production;
the existing tables still do not authorize execution.

The next resume boundary is now specified and tested in fixture-only code. Full
bounded checkpoint payloads have content-addressed locators, direct dependency
links, definition/component versions, delivery identity, attempt history, and
monotonically increasing lease fences. Partial artifact writes keep their exact
plans and receipts for no-delete reconciliation. The deterministic planner
returns sealed terminal results, waits for active leases, blocks version or
integrity drift, or proposes the exact next fence and safe continuation point.
It cannot acquire a lease, mutate D1, call Browser/R2, execute a workflow, or
authorize provider cost.

Additive migration 0057 can now represent that exact recovery history without
overwriting it. Stable attempts are closed by separate immutable records;
checkpoint identity/payload is separate from prepared/committed state receipts;
and artifact plans are separate from retry receipts. The validation-only planner
rejects blocked resume histories and checks every primary or alternate identity
candidate before proposing ordered insert-if-absent SQL. It deliberately has no
resume executor: all resume, workflow execution, provider, and cost authority
remains false. All 64 migrations pass from zero in isolated local
D1, but migration 0057 has not been applied to staging or production.

Evidence-use endings and current-reference reasoning are now explicit without
turning a historical link into a mutable counter. One immutable ending binds the
exact use, effective time, owner/compliance basis, and actor. A lineage-wide
  fixture projection then checks a short-lived asserted set of workflow identity,
  manifests, completed promotions, exact uses/links, endings, and content-bound
  storage availability.
For each active use it chooses the weakest valid copy that still satisfies the
required retention. Equal candidates or a missing valid copy remain
  `INDETERMINATE`. Fixture snapshots are explicitly incomplete and even all-ended
  asserted uses cannot suggest that
  retention review or deletion is safe.
Migration 0058 and its collision-complete persistence plan grant no mutation,
release, deletion, provider, or cost authority and have not been applied to
staging or production.

The next database boundary is implemented without pretending it is live.
Migration 0059 adds append-only snapshot attempts/fences, durable manifest
availability observations, exact source-set proofs, and the future completeness
receipt shape. The validation-only planner derives 15 complete workflow,
manifest, promotion, use, ending, and availability queries and requires a single
Cloudflare D1 batch for prepare plus snapshot. It also requires an atomic source
recheck, insert, post-verification, and committed-row reload before trust.

Pure TypeScript cannot mint that trusted receipt. Caller-supplied rows create
only an explicitly untrusted proof, and even a structurally valid completeness
JSON is reported as incomplete unless the private D1 executor performs and
reloads the exact transaction. Migration 0059 has been tested only in disposable
local databases and is not on staging or production.

The 15-set raw-row decoder now validates what those rows mean instead of trusting
their hashes alone. It parses every stored canonical JSON payload, recomputes its
digest, checks every denormalized column and alternate identity, reconstructs one
sealed workflow result, and verifies the complete artifact forest before selecting
one explicit lineage root. Other valid workflow roots remain visible rather than
being silently filtered.

Availability v2 also binds one exact expected-and-observed HEAD record per
manifest object. A digest of expected keys is insufficient: a usable winner must
be the only latest `R2_HEAD` receipt, match every object's length, SHA-256 metadata,
and ETag, and remain fresh at the snapshot boundary. The raw decoder is
validation-only and uses no D1 or R2 binding. Successful decoding still reports
`transactionallyTrusted=false`, `snapshotComplete=false`, and zero authority for
projection persistence, retention, release, deletion, provider operations, or
cost.

Migration 0060 now enforces the missing writer boundary inside D1. All 15 source
tables are append-only, and scoped inserts abort while an unsealed snapshot is in
its half-open active window. The guard follows the whole workflow forest,
promotion/manifest links, recursive replacement uses, and availability—not only
the selected root. Provider availability must be persisted before the claim.
The private executor now verifies those 51 trigger contracts from the database,
uses database-time claim/read and exact source recheck batches, collision-preflights
the receipt and all proofs, commits the parent plus 15 children atomically, and
independently reloads them before returning transactional trust. It rejects a
redigested control-plan forgery, source drift, missing guards, stale fences,
collisions, partial writes, and divergent replay.

This executor is local/disposable only. It is not imported by the inert Worker,
and the engine still has no D1/R2/Browser binding, route, schedule, queue consumer,
deployment approval, provider authority, projection persistence, retention
conclusion, release, deletion, outreach, or cost authority. Migrations 0059–0060
remain unapplied to staging and production.

A fixture-only projection-v2 adapter can now consume only the exact frozen
in-process result of a fresh D1 commit with materialized source rows. It rejects
receipt-only replay, cloned “trusted” JSON, source drift, and stale half-open
freshness windows, then deterministically replays the selected lineage. A
complete source set with no active uses can finally report
`NO_CURRENT_REFERENCES`; equal-rank or unassigned candidates remain
`INDETERMINATE`.

That result is evidence, not permission. It is not persisted and cannot authorize
a retention conclusion, release, deletion, provider operation, outreach, or
spend. Only shadow objects carry automatic object expiry in the replay contract;
the 180-day qualification policy requires a later retention review instead of an
invented R2 lifecycle delete. The adapter is still disconnected from the Worker,
and no live resource was touched.

A bounded manifest HEAD adapter now exercises the next provider boundary with an
injected fixture only. It attempts every object once in canonical order, records
missing/mismatched/malformed/error outcomes, binds exact normalized metadata,
and enforces a ten-object, five-minute, zero-provider-operation, zero-cost cap.
Its receipt remains `FIXTURE`, so it cannot impersonate a fresh `R2_HEAD` winner
or authorize persistence, retry, release, or deletion. The separate staging R2
activation and rollback gate is documented in
[`docs/runbooks/STAGING_R2_ACTIVATION.md`](docs/runbooks/STAGING_R2_ACTIVATION.md).

Private screenshot delivery now has a fixture-proven authorization contract too.
A desktop/mobile preview grant is HMAC-authenticated, bound to the exact signed-in
session and current business/snapshot/artifact, and expires within five minutes
or sooner when the audit or artifact expires. Valid bytes are streamed through a
same-origin private/no-store response with strict image and anti-sniffing headers;
the browser never receives an R2 URL, bucket, object key, user ID, or raw session
ID. DOM artifacts cannot be rendered through this boundary. No route, R2 reader,
binding, secret, deployment, or live provider operation exists yet, so the owner
dossier correctly continues to label previews unavailable.

## Verification

```powershell
npm run check:safety
npm test
npm run test:owner-ui
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
Before exercising the real-business chain, exactly ten manually reviewed,
independent candidates can be sealed into a balanced plan-only manifest with
`npm run kw:prepare-shadow-slice -- --source-plan data/kw-evaluation/plan.json --selection data/kw-evaluation/shadow-slice-selection.json --output data/kw-evaluation/shadow-slice-manifest.json`.
The manifest preserves the source checkpoint and five required phase gates, but
authorizes none of them; it cannot access a database, website, provider, runtime,
deployment, or prospect.
Completed work is now recorded beside that immutable manifest as a chain of
no-overwrite per-business checkpoints. `npm run kw:record-shadow-progress`
accepts one exact upstream phase receipt at a time, preserves its predecessor and
prior checkpoint, and advances only that business. It cannot run the phase it
records, access SQLite/Cloudflare/providers, contact anyone, deploy, or spend.
The first source/workflow receipt is not handwritten. After the existing local
materialization succeeds, `npm run kw:prepare-source-workflow-progress` opens the
ignored SQLite file read-only and query-only, reconstructs the approved plan,
verifies every exact stored row plus the sealed terminal workflow receipt, and
writes one no-overwrite normalized input for the progress recorder. It cannot
execute the workflow or change the database.
The next current-website-evidence boundary is now defined and tested without a
live website or provider. Its content-addressed proof binds the exact reviewed
business and predecessor, completed desktop/mobile homepage capture, deterministic
audit, durable persistence plan, every screenshot/measurement manifest, and one
fresh exact availability observation per artifact. The available builder accepts
fixture evidence only and explicitly cannot create a progress receipt. Real
progress also requires a separate content-addressed website-evidence eligibility
receipt. The private schema-0068 D1 boundary can now atomically persist and
reload the exact trusted in-process receipt, then distinguish current evidence
from immutable stale history using the database clock. It has no operator
command, runtime import, or live database binding. A separate validation-only
adapter can derive the normalized `CURRENT_WEBSITE_EVIDENCE` phase input only
from the exact in-process `CURRENT` durable reload. It rechecks the exact
ten-business manifest scope, selected business, source/workflow predecessor,
website proof, receipt lineage, and time window; it cannot append progress,
create a checkpoint, access a provider, or authorize execution.
The following assessment boundary is normalized in the same fail-closed style.
A synthetic-only `assessment-proof:*` binds the exact manifest business,
completed website-evidence phase, website proof and eligibility reference,
sealed workflow/audit lineage, immutable assessment, and committed-and-reloaded
persistence result. The progress recorder requires that proof as a separate
supporting receipt for `ASSESSMENT`; the builder cannot create a phase receipt,
read or mutate a database, execute qualification, discover contacts, or advance
the chain. Because no real current eligibility execution or guarded
progress-append boundary exists, no real assessment can use this proof to claim
progress.
After an owner has reviewed the exact source plan and deterministic audit input,
Codex can use the separate local-only materialization command
`npm run kw:materialize-source-workflow -- --source-plan data/kw-evaluation/plan.json --materialization data/kw-evaluation/materialization.json --database data/kw-evaluation/shadow.sqlite`.
It requires a fresh, content-bound source/workflow approval; it neither creates
the database nor runs migrations. Only after that command has sealed and reloaded
the exact workflow receipt may Codex use the separately approved assessment command
`npm run kw:execute-assessment -- --source-plan data/kw-evaluation/plan.json --invocation data/kw-evaluation/assessment.json --database data/kw-evaluation/shadow.sqlite`.
The assessment invocation must contain its different exact local-shadow
confirmation and a timestamp
within the assessment writer's five-minute freshness window. The command refuses
source drift, hidden alternate-identity collisions, missing schema, unsealed
receipts, non-local paths, and all remote/provider authority.

After the assessment exists, reviewed fixture observations can become a separate
no-write artifact with
`npm run kw:prepare-contact-review -- --source-plan data/kw-evaluation/plan.json --draft data/kw-evaluation/contact-draft.json --database data/kw-evaluation/shadow.sqlite --output data/kw-evaluation/contact-review.json`.
The database is opened read-only and the review output cannot overwrite an
existing file. Riley or Aidan must then inspect that exact packet and create a
different current approval before
`npm run kw:persist-contacts -- --source-plan data/kw-evaluation/plan.json --review data/kw-evaluation/contact-review.json --approval data/kw-evaluation/contact-approval.json --database data/kw-evaluation/shadow.sqlite`.
The second command persists only the reviewed fixture bundle and final lineage
receipt. It does not perform live discovery or verification, infer CASL consent,
change a lead score, or authorize outreach.

Current assessed KW leads can also be assembled into a resumable, owner-readable
quality checkpoint after the fixed 50-business cohort has one exact current
assessment per business, with
`npm run kw:prepare-owner-labeling -- --source-plan data/kw-evaluation/plan.json --database data/kw-evaluation/shadow.sqlite --output data/kw-evaluation/owner-labeling.json`.
Riley's exact Strong/Weak/Wrong decisions can then be recorded in a new immutable
parent-linked file with
`npm run kw:record-owner-labels -- --packet data/kw-evaluation/owner-labeling.json --reviews data/kw-evaluation/owner-reviews.json --output data/kw-evaluation/owner-labeling-next.json`.
This allows partial review batches to survive a lost task or exhausted model
quota without editing the database or granting acquisition, provider,
qualification, consent, outreach, send, deployment, or spend authority. Real
evaluation progress remains 0/50 until actual businesses are assessed and Riley
reviews them.

Riley normally creates the review file through the authenticated Quality Lab at
`/leads/evaluation`; Codex then runs the guarded recording command. Hand-written
JSON is only a fallback for engineering recovery.

Legacy resource identifiers are kept only where needed for safe migration. They
must not be renamed in place or retired until reconciliation, rollback, and the
30-day stability gate are complete.
