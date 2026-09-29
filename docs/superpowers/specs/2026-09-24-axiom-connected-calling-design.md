# Axiom Caller + Revenue Engine + Orbit: build specification

Revised draft for Aidan and Riley · 24 September 2026, America/Toronto · Revision 2

## Decision

Provide one Caller workspace that can be launched from either the Revenue Engine or Orbit, use Windows Phone Link with the existing iPhone and number, and return reviewed outcomes to the correct source records. Reuse the Revenue Engine's queue controls and Orbit's prospect, evidence and opportunity workflows. Keep phone control, conversation assistance, and result sync separate so each can improve independently.

Revenue Engine brings acquisition prospects. Orbit brings its own prospects and evidence-backed conversations about existing clients and proposed work. The same calling controls serve each purpose, while the brief, permissible claims and business outcome remain specific to the relationship. Both integrations belong in the first complete release; Orbit is not an export-only afterthought.

The first release should remove number typing, duplicate entry and avoidable waiting. It should preserve accurate outcomes and recover from interruptions. A Raspberry Pi bridge and a different voice backend are later, separately verified upgrades.

This is a proposed design, not an implemented or tested release. No code, deployment, migration, provider account, or prospect contact was changed during this review. Riley was notified of the Caller integration findings on Slack.

## User requirements and assumptions

- Use the existing phone number; do not buy a replacement number.
- Start with Phone Link, minimize manual actions, and work alongside both the Revenue Engine and Orbit.
- Make the tool simpler, more reliable and efficient; latency matters.
- Available hardware includes a Raspberry Pi 4 with 4 GB RAM. Prior discussion also identified a Windows PC and iPhone; exact versions and audio devices need checking on that machine.
- Recommended operator workflow: start from either product and use the same Caller workspace. Keep the originating business or opportunity visible as context. Do not ask the operator to manage separate campaign imports or manually select an integration for every call.
- Interpret “premium” as clarity, speed, consistent interaction, accurate information and graceful recovery. Visual polish must meet those requirements. Perfection is an aspiration; release quality is demonstrated by the acceptance gates below.
- Existing call and outreach approval rules remain in force. This design does not enable unattended prospect calling or email sending.

## Evidence reviewed

| Component | Reviewed version | What exists |
| --- | --- | --- |
| Caller main | `95bd102bb65e0a6708fe02cbd23283ebb3c1ec8f`, v0.4.2 | Lead preparation, supervised ChatGPT Voice flow, transcript capture, local results and recovery |
| Caller integration PR | [Mageester/axiom-caller#1](https://github.com/Mageester/axiom-caller/pull/1), `b5bacb5a76b97fc11f9fba6b4f556d2f93aa8670` | Bearer-token connection, lead import, result upload, local outbox |
| Revenue Engine | `codex/revenue-engine-production`, `f2f954b5b59ee7b3ce8c732292a7ff2d59200dae` | Call queue, phone link/copy, keyboard outcomes, Save & next, caller API |
| Revenue release record | `docs/STATUS.md` on that branch | Reports the Sep 24 deployment with caller endpoints and migration 0078; not independently verified against the running Worker |
| Orbit source snapshot | `Mageester/orbit-production-source` main, `2ec3d3c16696d06af46c514be723143256c91db0` | React Router 7, D1 tenancy, prospects, call activities, conversion, clients, evidence, proposals and opportunity funnel |
| Older Orbit repository | `Mageester/client-growth` main, `1d8e5d0e66ecaa5991b1182fc187738c6da69f1b` | Earlier Orbit source; main's latest commit is Sep 11, versus Sep 18 in the production-source snapshot |
| Supplied screenshots | Today and Call list | Existing ivory/gold owner interface, shared queue and per-person activity counters |

The Revenue Engine's default branch and PR description lag the current production-branch status. Use the verified deployment commit and current API contract when implementing, not default-branch assumptions. Caller PR #1 was open, three main commits behind, and GitHub reported merge conflicts at review time.

Orbit's repository name does not prove which commit is deployed. The richer Sep 18 snapshot is the planning baseline; confirm its relation to `orbit.getaxiom.ca` and choose the maintained remote before product edits. Earlier conversation recall conflated Orbit, Caller and the engine repositories; this revision uses inspected source instead. No authentication, workspace membership or live data parity between the two products is assumed.

Primary source paths:

- Caller: `src/integrations/revenue-engine.ts`, `src/core/background-host.ts`, `src/storage/call-repository.ts`, `src/core/orchestrator.ts`.
- Engine: `src/lib/revenue-engine/caller-integration.ts`, `src/lib/revenue-engine/engine-prospects-d1.ts`, `src/app/api/caller/{leads,result}/route.ts`, `src/components/prospects/call-queue.tsx`.
- Orbit: `src/core/prospect.ts`, `src/core/schema.ts`, `src/db/prospects.ts`, `src/db/opportunityFunnel.ts`, `src/db/schema.ts`, `app/routes/prospects.$id.tsx`, `app/routes/opportunities.$id.tsx`, `app/routes/clients.$id.tsx`, `app/routes.ts`.
- [Microsoft: PC calling with Phone Link](https://support.microsoft.com/en-us/windows/apps/make-and-receive-phone-calls-from-your-pc).
- [Microsoft: requirements and setup](https://support.microsoft.com/en-us/windows/apps/phonelink/phone-link-requirements-and-setup).

## How it works today

Caller prepares a lead in a text conversation, hands the current lead to a reusable Voice conversation, waits for its acknowledgment, then reports readiness. The person still dials and ends the physical call. Caller subsequently captures the transcript, produces a structured result, saves it locally and prepares the next lead. Browser UI changes and missing transcripts can interrupt this process.

Riley's proposed bridge imports callable engine prospects and posts locally saved results back. The engine authenticates a personal token, returns a queue, and records results in the same activity log used by its website. Its Call queue already has a `tel:` link, Copy number, numbered outcomes and Save & next.

Orbit has a tenant-scoped prospect model with phone, contact name, assigned user, next action and activity history. `recordProspectCall` records a call and updates prospect status, but generates a fresh command ID inside each invocation; it is not yet a stable externally retryable call-result API. Conversion is an explicit repository command and links the prospect to a client. Opportunity sales follow a different state machine, with reviewed proposals and explicit sold/lost corrections. The client schema has no dedicated phone/contact fields, so calling an existing client requires a contact model or an explicitly confirmed link to its originating prospect.

## Approaches

| Approach | Benefit | Cost or limitation | Decision |
| --- | --- | --- | --- |
| Shared Caller workspace + two source adapters + Phone Link | Reuses both products, current number and one set of calling controls | OS dialing confirmation and hangup may remain; requires a reliable common contract | First release |
| Pi Bluetooth phone bridge | Potential programmatic dial/hangup and audio routing using the same phone | Must prove pairing, call state, audio and recovery on this exact Pi/iPhone; additional software to maintain | Later experiment |
| Telephony provider + realtime voice service | More direct call events and media integration | Number/provider arrangements, running costs and a larger change | Optional future direction |

Do not insert the Pi into the initial audio path just because it is available. For later testing, keep it responsible for phone I/O and use the PC for heavier model work. No full local voice-stack performance claim is made for the Pi 4.

## First-release experience

### One-time setup

1. Connect the Revenue Engine and the authorized Orbit workspace once. Show the authenticated operator, source and workspace. Use separate revocable scoped credentials; do not reuse one product's session or secret in the other. Initially retain the existing engine key flow and add an equivalent limited Orbit caller connection; a later pairing-code flow can simplify setup without blocking the first release.
2. Pair the iPhone with Windows Phone Link and verify an ordinary call using an owner-controlled test recipient.
3. Test whether a browser `tel:` link opens Phone Link with the correct number on this Windows installation. Offer instructions for the Windows TEL handler where available.
4. If the handler does not work reliably, use Copy number → paste in Phone Link → Dial. Clipboard success must be awaited and errors shown; never display “Copied” before success.
5. Verify microphone, remote audio and hangup. AI audio routing is a separate check: successful PC calling does not prove that browser AI audio reaches the remote person or that remote audio reaches the model.

The application may show “Setup verified by you” after this check. A browser-only implementation must not label Bluetooth as currently connected without a real signal.

### Daily workflow

1. Start calling from Revenue Engine Call queue, an Orbit prospect, or an Orbit client/opportunity. Open the same Caller workspace with the source context already selected. Show one compact brief: identity, relationship, confirmed contact, reason to call with evidence, prior contact and agreed next step.
2. Prepare the next eligible lead in advance. Keep it separate from the active conversation until the current call is finished.
3. When the current lead is eligible and ready, show **Call with Phone Link**. Open the number only from a deliberate user click, preserving browser user activation. Complete asynchronous eligibility checks before enabling the link.
4. Show **Dialer opened — confirm the call in Phone Link**, unless a future verified adapter supplies stronger evidence. User confirms connection when needed; do not start a talk-time timer on Voice readiness or link activation.
5. End the physical call in Phone Link. Caller then ends its Voice session and gathers available evidence. The interface must make these two actions clear.
6. Review the suggested outcome and callback details, then **Save & next** for queues or **Save & return** for a single Orbit conversation. No-answer and other simple outcomes have keyboard shortcuts. Save locally first, show pending sync if necessary, and advance only after that save is durable.

Expected manual effort: a call action, any Windows/Phone Link confirmation, physical hangup, and outcome confirmation. This removes number typing and duplicate CRM entry; zero-click calling is not promised.

If Voice or transcript capture fails, allow a clearly marked human-entered result. Missing evidence stays unknown. Technical failure must not become no answer or a fabricated conversation.

## Architecture and ownership

| Component | Owns | Boundary |
| --- | --- | --- |
| Revenue Engine | Its prospect, acquisition queue and activity log; Axiom's shared call-control ledger for explicitly linked records | Versioned authenticated API |
| Orbit | Its tenant-scoped prospects, clients, contacts, opportunities, evidence, proposals and business transitions | Tenant-scoped caller adapter and existing domain commands |
| Calling workspace | Source-aware display, operator commands, outcome review | One active session and one save owner across both sources |
| Caller | Active assisted session, local evidence, recovery and outbox | Persisted state transitions; typed commands |
| Phone adapter | Dial request and declared control/state capabilities | Phone Link initially supports opening a dial request; connected/hangup are not assumed |
| Voice adapter | Preparation, conversation assistance and capture | Independent of engine sync and phone transport |

In assisted mode, the workspace delegates saving to Caller; it must not separately post the same result through either manual web form. Every operation uses the same stable attempt identifier and source receipt. Without Caller, existing manual workflows remain available and clearly identified, with the same eligibility and duplicate-call controls for linked Axiom records.

Website-to-extension commands must validate the exact approved origin, sender, schema, session and command identifier. Page content cannot choose an arbitrary number, URL or privileged action. Phone actions require an operator gesture. Tokens stay out of page DOM, logs and messages.

Refactor only the relevant orchestration boundaries. Preserve current transcript recovery, Voice stop checks and local backup behavior while integrating PR #1 onto the latest main.

## Both-platform contract

### Identity, ownership and linking

Use a source reference containing `system`, `connectionId`, `workspaceId`, `entityType` and `entityId`. Never treat a bare ID, email, phone or domain as a globally unique customer. Keep an explicit link between engine prospect, Orbit prospect/client, and selected opportunity where one exists. A suggested match is reviewed once; a shared phone number or website never silently merges businesses.

The first connected installation is Axiom's authorized engine account and Axiom's selected Orbit workspace. Orbit's other agency workspaces remain isolated. Their clients, briefs, proposals and outcomes must not flow into Axiom's internal Revenue Engine. Future standalone Orbit installations use an Orbit-local call coordinator and the same adapter contract.

For Axiom's explicitly connected records, extend the engine with a small call-control ledger: linked contact identity, attempt ID, operator, claim, stop state and delivery receipts. It coordinates duplicate prevention and suppression across both apps without becoming a replacement for Orbit's client or opportunity database. Full Orbit evidence and commercial records stay in Orbit. Unlinked records remain separate until their identity is reviewed.

Both linked entry points check that ledger and their source's eligibility before a new call. A local DNC is immediately effective; synchronization then applies it to the linked contact. If the cross-platform control service cannot be checked, new linked calls pause while existing calls and local saves remain recoverable. This is an explicit reliability trade-off: consistent duplicate prevention requires shared authority, not two independent queues that happen to look alike.

### Common adapter operations

| Operation | Required behavior |
| --- | --- |
| `describeConnection` | Returns server-verified operator, workspace, supported schema versions and capabilities |
| `listCallTasks` | Returns a small paginated eligible set with stable source references, purpose and priority reason |
| `prepareCall` | Returns confirmed contact, source revision, evidence-backed brief, restrictions and related links |
| `claimCall` / `renewClaim` | Atomically obtains or renews ownership after checking source and shared stop state |
| `recordCallResult` | Accepts stable attempt ID, schema version, occurrence timestamps and reviewed result; returns a durable receipt |
| `getReceipt` | Resolves an uncertain save without submitting another business event |
| `releaseCall` | Closes or explicitly abandons the claim; never automatically redials |

These are interface names, not claims that endpoints exist. Orbit needs a new caller API; the engine bridge needs an additive version upgrade. Pin contract fixtures in all three repositories and reject incompatible versions visibly. Different frontend frameworks consume the same protocol; neither product needs a framework migration.

The result envelope carries `attemptId`, source reference, operator identity derived from authentication, purpose, contact reference, brief/evidence revision, timestamps, actual call disposition, structured next action, provenance and selected opportunity decisions. Notes and observations are distinct from assertions of a sale or booking.

### Results that mean the same thing

| Call result | Engine or Orbit prospect | Orbit client/opportunity |
| --- | --- | --- |
| No answer / voicemail | Record the actual attempt; apply retry policy without inventing a conversation | Log contact attempt; leave opportunity stage unchanged |
| Requested callback | Record agreed wording, date/time/zone and owner | Create linked follow-up; leave sales stage unchanged |
| Interested / wants details | Record interest and next action | Log interest; offer proposal preparation for review |
| Meeting requested | Record request | Record request; do not mark a meeting booked |
| Meeting booked | Requires confirmed booking details | Store the booking reference/details; do not mark work sold |
| Declines this project | Prospect-specific outcome where appropriate | Mark only the selected opportunity lost after confirmation; do not mark the client globally uninterested |
| Do not contact | Apply contact-level stop according to the stated scope | Suppress the linked contact across connected Axiom workflows; preserve service/client records |
| Agrees to buy | Prompt owner to confirm the actual deal/client conversion | Use explicit Orbit sale command with reviewed amount/currency; do not infer payment received |
| Capture/technical failure | Unknown/manual review | Unknown/manual review; no opportunity transition |

Orbit `accepted` is the agency accepting a finding internally; it is not a client's agreement to buy. `dismissed` is an internal rejection, while `lost` is a client decision. Use `applyFunnelTransition` and explicit conversion commands rather than raw status writes. A single call may discuss several opportunities; record one call with separately reviewed decisions, not multiple counted calls.

### Cross-platform delivery and conversion

Save one local result with separate delivery records for its originating system and any explicitly linked projection. A source receipt does not mean the other app has updated. Show **Saved · Orbit sync pending** or the equivalent, preserve retries and reconcile by attempt ID. Do not promise a transaction spanning two databases.

The source commits its activity and a durable projection task together. Delivery is at least once; each destination uses a unique attempt/projection key and payload digest so retries have one effect. A secondary sync failure must not replay a successful call or erase its result. Corrections carry a new correction ID and reference the original event.

When an engine prospect becomes a real client, offer **Create/link in Orbit** with a preview of identity, domain, contact, agreed work and selected history. The operation is idempotent and returns a permanent mapping. Unknown domain or contact details remain missing; do not invent them to satisfy Orbit's schema. Monitoring, analyses, proposal sharing and outbound messages do not start simply because a client was created.

For existing Orbit clients, introduce a small tenant-scoped contact record with role, phone, source, confirmation time and stop preference. Reuse a verified originating prospect contact when appropriate. Require one-time contact confirmation where missing; never dial a number extracted from arbitrary page text without review.

### Source-aware preparation

Use three explicit purposes: acquisition, prospect follow-up and client/opportunity discussion. Default from the launch context so the operator need not configure it repeatedly. A returning client gets a relationship-aware opener; it must not receive a cold prospect script or an unsolicited free-website offer.

Orbit briefs retain the finding's exact observation, evidence reference, capture time, coverage limits, billability and reviewed commercial terms. Covered, superseded, resolved or rejected work does not become a fresh upsell. Inconclusive evidence is visibly incomplete. Orbit's prospect score measures stored-field completeness; do not present it as probability of a sale or commercial qualification.

## Premium experience: concrete standards

- **One focus:** current business/contact, relationship, reason, primary call action and compact status. One dominant action per state. Evidence, history and diagnostics expand when useful.
- **No repeated setup:** remember the authorized source/workspace, layout and working dial method. Do not remember an unverified claim that the phone is currently connected.
- **One calling implementation:** reuse Caller's existing UI/state engine and add source adapters. Let each product launch the same workspace; avoid independently rebuilding a dialer in React Router and Next.js.
- **Stable context:** keep the active record pinned during a call. A refresh, background queue change or different tab cannot replace its number, brief or pending outcome. Switching sources is explicit and never starts another call.
- **Readable and calm:** comfortable body type, meaningful labels, strong contrast, visible keyboard focus, usable controls at 390 px and desktop widths. Avoid low-contrast tiny status text, unnecessary animation and decorative counters.
- **Consistent Axiom identity:** preserve the A icon and existing product themes. Share spacing, hierarchy, state language and controls; no forced redesign of unrelated pages.
- **Honest progress:** Preparing, Ready, Dial requested, Connected (confirmed), Finishing, Saved locally, Synced. Never show a fake completion percentage or a spinner with no recovery action.
- **Easy repair:** failed action says what happened and offers Retry that step, Save manually, or Return. Draft notes survive refresh. Undo applies only to reversible edits; ending a physical call is never presented as undoable.
- **Useful intelligence:** show the next best action and evidence, not internal prompts, queue IDs or infrastructure settings in the normal call flow.
- **Low input:** zero phone-number typing after contact setup; zero re-entry of the same result in another product; one review surface for outcome and next step. Count remaining Windows/Phone Link interactions during acceptance.

## Correctness work before shared use

### Accurate outcomes and callbacks

- Remove `uncontacted → no_answer`. Keep technical state separate from business disposition, and add an explicit unknown/manual-review representation to the contract.
- The engine currently maps `demo_requested → MEETING_BOOKED`. Require actual booking evidence before counting a meeting; a request remains a request or interest.
- Preserve voicemail, wrong number, gatekeeper, no answer, interest, explicit callback, meeting booked and do-not-contact without lossy translation.
- Send callback date, optional local time, IANA timezone, precision (date-only/time/window), original words and provenance. Preserve ambiguity; do not invent a time. Resolve Toronto daylight-saving ambiguity explicitly.
- Distinguish an operator reminder from a callback the prospect actually agreed to. The existing suggested dates must not imply prospect agreement.
- Record attempt creation, dial request, confirmed connection, physical end, local save and remote receipt separately. Unsensed events remain null.
- Store occurrence time as well as sync time, so an offline result does not inflate the wrong day's counts. Keep the full structured result; a shortened activity-list note is a display projection.

### Durable delivery

- Save the local call and its outbox item in one IndexedDB transaction. Persist import mappings in the same database transaction as imported leads.
- Replace shared-array read/modify/write with serialized, transactional updates. A flush acknowledges individual items and cannot overwrite newly queued work.
- Retry on startup, reconnect and bounded alarms, with request timeouts and backoff. Keep auth failures visible; reconnect must verify the same operator before releasing pending work.
- Mark synced only after validating a saved/duplicate receipt. Engine duplicates currently return 200 `ALREADY_SAVED`; a 409 is a conflict/stop, not proof of success.
- Retain 400/404/409 items with actionable reasons; never discard them as sent. Remove silent truncation of the last 500 pending items. At capacity, pause new work and present recovery/export options.
- Bind queued items to the original engine/account/operator. A key change cannot silently transfer work to another identity.
- Preserve idempotency across retries and use atomic server constraints for concurrent submissions. The same key with changed content is a conflict, not an update. Corrections are separately identified operations.

### Shared queue and stale data

- Refresh imported prospects by stable engine ID. Link matching pre-existing local leads rather than skipping them permanently. De-duplicate repeated engine IDs within a batch.
- Add atomic expiring claims shared by web and extension clients. Reading the next queue today does not reserve it; Aidan and Riley can otherwise receive the same prospect.
- Recheck suppression and eligibility before enabling a dial. A claim is not permission to ignore a later stop.
- Renew claims during an active session. If renewal is lost, retain an uncertain-call marker requiring reconciliation before automatic reassignment; lease expiry alone must not cause a second call while the first may still be active.
- If connectivity is lost, preserve the ongoing call and save its outcome locally. Pause new shared-queue dialing until eligibility and ownership are known again.

## Latency and efficiency

Measure three different delays: preparation/next-lead readiness, dial-to-ring, and end-of-speech-to-first-audible-response. A faster button cannot fix slow AI turn-taking.

For this release:

- Reuse engine research and cached briefs, carrying source time and version. Avoid repeating research on every visit or call.
- Prefetch one next brief while the operator works; validate eligibility again before use. Do not send next-lead context into the active Voice conversation.
- Keep network sync off the critical path after a durable local save.
- Load only the current brief, recent history and a small queue window. Expand diagnostics on demand.
- Instrument real timestamps and action counts. Browser automation cannot provide reliable acoustic timing by itself; use an owner-controlled audio test for conversational latency.

Proposed acceptance targets, not measured results:

| Measure | Target or rule |
| --- | --- |
| UI response to an action | Visible feedback within 100 ms under normal local conditions |
| Local Save & next | P95 under 1 second on the target PC, excluding required human review |
| Display of next cached ready brief | P95 under 2 seconds after durable save |
| Healthy online result sync | P95 under 5 seconds after local save |
| Dial-to-ring | Report observed distribution; do not claim control over carrier timing |
| AI reply latency | Record baseline median and P95; future streaming backend goal median around 1 second, not a guarantee for current ChatGPT UI |
| Data integrity | Zero lost saved outcomes or duplicate activities in the defined fault tests |

A future voice upgrade should stream input/output, support interruption and tune end-of-turn detection. Evaluate it separately with audio and licensing checks; do not couple the first Phone Link release to replacing the entire voice system.

## Delivery boundaries

These are ordered implementation milestones inside the design, not a claim that work has begun. Break changes into reviewable increments with working operator flows at each checkpoint.

| Milestone | Concrete output | Exit gate |
| --- | --- | --- |
| 0. Establish baselines | Confirm maintained Orbit remote/deployed commit; pin all three repos; record current action count and latency; agree adapter fixtures | Reproducible local baseline and known deployment identity; no source ambiguity |
| 1. Phone Link usability | Correct number handling, one-time setup, honest dialing states, copy fallback, compact current-call controls | Owner-controlled Windows/iPhone call and two-way audio check; no phone-number typing |
| 2. Shared calling core | Source references, versioned contracts, persisted session state, atomic local outbox, per-destination receipts | Fault and duplicate-delivery tests pass; latest Caller recovery behavior preserved |
| 3. Two working adapters | Update engine PR; add Orbit tenant-scoped caller API, external idempotency, contacts and correct domain transitions | A complete fixture call from each product saves once to the right record and cannot affect another workspace |
| 4. Cross-platform continuity | Explicit links, shared Axiom contact controls, coordinated claims/stops, reviewed conversion and projection retries | Two callers/two products cannot hold the same linked-contact claim; partial sync recovers without duplicate activity |
| 5. Refined operator workflow | Same workspace launched from both products, context-aware brief, cached next lead, accessible review and recovery | Aidan and Riley complete the acceptance journeys without duplicate data entry; measured latency and usability targets pass |
| Later experiment | Pi bridge and/or streaming voice backend | Exact-device dial, audio, latency, interruption, disconnect and recovery tests; separate production decision |

The first complete release includes both platforms. A Phone Link-only checkpoint can provide immediate utility while the integration work proceeds. Broader CRM features, a new analytics dashboard, new billing, unified authentication and a full frontend rewrite are outside this build.

### Expected implementation areas

- **Caller:** adapt `src/integrations/revenue-engine.ts` into source-specific adapters behind a common protocol; add Orbit adapter; move durable mappings/outbox to transactional storage; keep `background-host.ts` orchestration small; update call-result schemas and focused workspace components.
- **Engine:** version `/api/caller` and `caller-integration.ts`; add migrations for call identity, claims, connection/link mapping and projection receipts; extend the existing activity domain rather than bypassing it; wire Call queue launch/manual fallback through the same controls.
- **Orbit:** new caller API routes in `app/routes.ts` using server-derived tenant scope; extend `src/db/prospects.ts` with stable external command identity; add client contact and client-call activity persistence; invoke `opportunityFunnel.ts` and conversion commands for reviewed transitions; add launch actions to prospect/client/opportunity pages.
- **All:** shared schema fixtures and contract-version checks, documented compatibility, migration/rollback plans, visible sync errors, concise operator docs. Keep these as protocol agreements across repositories rather than requiring a monorepo migration or a separately hosted integration product.

## Acceptance and release

Test with fixtures and owner-controlled calls, not prospects:

- Normal answered call, no answer, voicemail, wrong number, explicit DNC, uncertain outcome, date-only callback and exact-time callback.
- Browser refresh, service-worker termination immediately around save, network loss before/after the server commits, concurrent saves/flushes, repeated receipts, malformed payload and key revocation.
- Two callers claim the same lead concurrently; only one receives a valid claim. Stop updates block later dialing. Lost claims cannot trigger automatic redial.
- Changes of operator, reimport of existing leads, stale research and reconnect after a long offline interval.
- Engine-origin and Orbit-origin calls for the same explicitly linked contact; unlinked shared-phone businesses stay separate. A missing connection does not silently downgrade cross-platform suppression checks.
- Orbit workspace A attempts reads/writes/links using workspace B's IDs; every request is denied without revealing B's contact, price, evidence or activity. Logout and workspace changes cannot reuse cached briefs or deliver pending results under the new identity.
- Engine succeeds while Orbit fails, Orbit succeeds while projection fails, server commits before the response is lost, correction arrives out of order, and the originating record is deleted. Preserve receipts and reviewable failures rather than manufacturing missing records.
- Orbit prospects convert exactly once and remain linked. One call discusses two opportunities without counting two calls. Unknown outcome, interest and meeting request never become sold or meeting booked.
- Phone Link launches the correct number; unsupported handler uses working clipboard fallback. Bluetooth disconnect and failed clipboard never appear as successful calls/copies.
- Audio acceptance checks both directions, echo, interruption and manual takeover. If unverified, ship human-assisted calling with the limitation visible rather than claiming AI phone conversation works.
- Keyboard operation, small-screen layout and recovery messages that state the failed step and available action.

Run Caller `npm run check`. For Engine changes, follow its current AGENTS.md: safety, full tests, typecheck, lint, Cloudflare build, no-upload dry run, then owner UI acceptance sequentially after builds/tests exit. Read the installed Next.js version's documentation before coding. For Orbit, use the pinned Node 24/pnpm environment and `pnpm verify` plus targeted tenant, call, conversion and opportunity tests. Those local checks must use fixtures; paid provider/live scan commands are separate. Update STATUS where present, operator setup docs and architecture records for the versioned integration.

Usability acceptance consists of five journeys: first connection, a normal engine prospect call, an Orbit callback, an existing-client opportunity discussion, and recovery from a failed sync. Aidan and Riley should be able to finish each without developer coaching after setup instructions. Record steps, confusion, latency, missing information and remaining external Phone Link actions; fix blocking findings before calling the release premium or ready.

Before deployment: identify the actual live commits, verify each migration path against a fresh backup, rehearse rollback and present release evidence. The current review did not run the three repositories' tests or exercise the user's Windows/phone hardware.

## Review decision

Approve or revise this architecture: **one calling workspace for Revenue Engine and Orbit, Phone Link with the existing number, source-aware briefs and outcomes, durable cross-platform delivery, and measured usability/latency gates**. The Pi and voice replacement remain later verified upgrades. After written-spec approval, produce the execution plan with exact changes, verification and execution method. The architectural brainstorming workflow requires that review before implementation.
