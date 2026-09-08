# ADR 0059 — One durable outbound intent, one provider attempt

Status: Proposed; implementation in progress, not an activated send path
Date: 2026-09-08
Deciders: Revenue Engine integration owner; Riley approves any live rollout

Owner correction (2026-09-08): Google Workspace is excluded. The provider-neutral
intent/approval/uncertainty design remains applicable, but Gmail-specific transport,
connection schema and credential plumbing below are legacy/reference implementation
evidence, not the target provider decision. New code depending on GmailConnection
must be refactored behind a non-Google-capable contract before integration. No
replacement provider or mailbox subscription has been selected or authorized.

## Context

### Current partial integration (2026-09-08)

The actual manual POST now uses the shared administrator/origin fence and a
provider-neutral handler instead of a direct Gmail call. Its only input is an
existing approved intent ID. `loadApprovedReply` resolves that reference from
stored approval JSON and reuses the current envelope/admission/expiry checks.
The handler checks actor, URL client, mode, mailbox, Message-ID and exact digest
before invoking the guarded manual runtime. Requests are
strict JSON/UTF-8, limited to 1024 bytes and five seconds. Responses expose stable
intent/state, never attempt tokens or raw provider errors.

The real runtime remains explicitly unconfigured (`null`), with no environment
override or Gmail fallback. Local route tests now use the real approval writer,
approval reads, intent claims and dispatcher. They seed synthetic provider identity
metadata and substitute provider health/consent/capacity and transport. History
now derives from actual durable intent/approval rows, not a synthetic Map.
They demonstrate one fake delivery across
retry, explicit ambiguity and history-only repair; they do not prove full
authorization or a finished reply feature. The incompatible old composer is now
removed from the read-only saved activity panel. Restore legitimate manual replies
via exact approval and retained-intent state handling, not the old bypass.

The manual claim now fences current actor/session/reviewer, exact stored approval,
unarchived lead, global/emergency pause and relevant suppression in its INSERT.
The existing 0073 trigger reserves budget within that same statement. No
authority-bearing request field or boolean preflight is used. A final
same-policy and reserved-budget check runs before the fixture transport. A failure
after claim keeps the reservation and becomes non-resendable; no new attempt is
manufactured. Database policy is evaluated at the write; the external configured
owner allowlist is sampled after hashing, not transactionally locked with D1.

The normalized legacy `REPLY` source is sequence control, not an owner-reply prohibition
or proof of consent. Bounce/no-MX and explicit opt-out/complaint sources remain
blocking despite an expiry. Other cooldowns expire only on a valid database time.
Inbound opt-out classification must still be implemented before activation; a
legacy reply marker cannot prove an inbound message lacks an opt-out. Local SQLite
and Miniflare D1 tests exercise current-state changes at lookup/write/transport
boundaries. Recorded mailbox/thread attribution is now checked as described below;
trusted ingestion/health, full consent/verification/capacity, current message-policy
and cost provenance are NOT established by this partial fence.

Candidate review identified a normalization mismatch in the initial SQL literal
comparison. Legacy wrapper/encoded addresses now use `normalizePipelineEmail` and
both old/new domain readers share the extracted pure `normalizeSuppressionDomain`.
The claim binds a bounded raw-to-normalized mapping and LEFT JOINs EVERY current
suppression row to its exact raw id/email/domain/source at the write. An unmapped
new/changed row denies rather than disappearing from a stale preflight. Expiry
and lead scope are evaluated directly from the current DB row. Tests insert/change
a wrapped opt-out between normalization and the D1 write and prove no claim/debit.
The read stops above 1,000 rows or 128 KiB; this is an explicit temporary legacy
compatibility limit pending canonical suppression persistence, not a silently
truncated snapshot or production-scale completion claim.

The generic dispatcher remains a low-level persistence mechanism, not authorization.
`createManualReplyRuntime` now owns guarded claim, final check, outcome persistence
and read-only history. Its options accept only database, exact-envelope transport
and additional policy; a bare claim callback is rejected. The handler no longer
assembles dispatch dependencies. The extra policy callback is still partial and
does not prove atomic consent/health/capacity. The real runtime getter stays null.

An earlier candidate review identified the old composer's `res.ok` shortcut and
added a tested receipt interpreter. The current saved-history panel has no composer:
the incompatible raw-envelope submission is removed, not advertised as a working
reply feature. Durable approval and reload/cancel recovery remain activation gates.
The receipt interpreter remains tested groundwork for the future approved journey.

Remaining: trusted non-Google ingestion/health, full atomic current-policy claim
and final pre-send recheck, durable UI approval/recovery, legacy CRM/inbound
integration, inbound/opt-out flow, scheduler integration and reviewed provider.
SEC-006 is still open. Older implementation notes below are historical groundwork,
not claims that these missing pieces have been connected.

### Provider-neutral reply admission decision (local implementation, 2026-09-08)

**Context:** a focused regression showed the writer accepted an unrelated recipient
when its new digest was internally consistent. A digest proves unchanged content,
not that a client conversation belongs to that recipient or sending mailbox.
Google Workspace is excluded and trusted non-Google ingestion is not implemented.

**Decision:** migration 0075 adds empty mailbox identity, conversation and reply
target tables with immutable identity fields and one-way retirement. Mailbox state
defaults DISCONNECTED. READY is only a local stop control, never provider-health
evidence. Provider/account/connection/address identity cannot be overwritten; a
replacement connection gets a new identity. A temporary pause can clear while the
same identity/approval is valid; identity replacement must retire the original.
Conversations bind mailbox + provider thread to a lead; active mappings are unique.
Targets bind conversation + provider message to exact recipient, parent Message-ID
and approved References. Retirement permits a corrected new mapping, but cannot
revive the original target-bound approval. No credentials or public writer exist.

Manual envelope v2 includes required target ID and parent Message-ID. The common
fixed SQL predicate is consumed by approval INSERT/reload, atomic claim and final
check. It joins the full recorded chain, requires exact envelope values and rejects
retired/disconnected/paused records. Missing schema stops. No fallback to the lead
email, arbitrary Reply-To, first connection, alias, or legacy Gmail record exists.
Metadata ingestion must establish authorized recipient/Reply-To and provider-message
provenance before writing; a row/digest does not itself prove that external fact.

**Options/trade-offs:** retaining Gmail joins violates the owner constraint and
does not fix thread identity. Looking up only mailbox/thread/to without a bound
target ID lets a replacement mapping revive old approval. Mutating v1 or silently
upgrading stored approval changes what was approved. Selected v2 preserves the v1
parser/digest for reference tests but denies v1 at the new manual admission gates.
This adds three small metadata tables and a shared predicate; it does not choose a
provider or add a second dispatch system. Matching is byte-exact: upstream trusted
parsing supplies canonical identity before approval; dispatch never rewrites it.

**Consequences/actions:** the actual SQLite/D1 reply fixtures now create approval
through the real writer, removing the old direct approval seed. Trusted ingestion,
provider credential/health lifecycle, full policy and owner approval UI still need
implementation. Retirement blocks new sending but no longer erases visibility
of recorded outcomes; historical reads use the separate path below.
Final-check-to-provider races cannot recall
in-flight mail. These are explicit open gates, not permission to enable runtime.

### Read-only recovery decision (local implementation, 2026-09-08)

**Context:** the focused handler regression hid a saved SENT receipt after mailbox
retirement and approval revocation. Reloading active approval confuses permission
to send now with permission to see a message already sent.

**Decision:** derive history from the immutable approved envelope joined to the
durable send intent. No second history table, repair write, attempt claim, budget
debit, credential read or provider call is needed. Check the current exact owner,
session, administrator allowlist and URL client on every read, and repeat admission
after asynchronous digest verification. Never select or expose the attempt token.
Approval expiry/revocation, archived lead and retired mailbox do not hide history;
expired, impersonated, banned or otherwise unadmitted current sessions still deny.

**Trade-off:** this removes dual-write failure for this local receipt view but does
not populate legacy OutreachEmail or implement the inbox/CRM. `recordedAt` is local
acceptance observation, not inbox delivery. SENT is acceptance; UNKNOWN/DISPATCHING
remain uncertain and REJECTED remains terminal. A failed history read returns
STATUS_UNAVAILABLE and must never fall through to a send. On restoration, reading
the same intent recovers its saved state without reauthorizing transport.

**Remaining:** connect durable owner approval/recovery UI, implement full policy
and trusted provider ingestion. The saved-history GET is now implemented below.
The factory is server composition, not protection against arbitrary malicious
server code or privileged database maintenance. Local SQLite/D1 tests prove the
bounded recovery behavior; they do not establish a finished live mail service.

### Saved activity GET and presentation decision (local implementation, 2026-09-08)

**Context:** the old client email-history GET refreshed the first user's Google
connection and fetched provider threads while merely displaying a client. Its
local fallback was not scoped to a message owner, and its UI assumed one sender.
The owner excludes Google Workspace and the target outbound runtime is inactive.

**Decision:** replace that GET with current-administrator, owner/session/client
scoped saved activity. Return five exact validated records, stable createdAt/id
keyset pagination, and a source marker explicitly saying outgoing records only.
Admission is rechecked after reading, including empty pages. Each selected record
uses the shared read-only receipt/digest check. Bad/missing storage is unavailable,
not a fabricated empty inbox. Cursors are positions, never authorization.

The actual client panel renders plain text with no HTML, tracking pixels, credential
refresh, inbox sync, generation or send action. Each record names its own sender
and shows acceptance, uncertainty or rejection accurately. Abort superseded fetches,
clear stale/error content and key the component by client so one client's history
cannot remain visible when another client is opened. Legacy messages are explicitly
not imported into this new provenance model; no data is erased or reclassified.

**Options/trade-offs:** keeping live Gmail violates the corrected product scope.
Returning fake empty threads hides valuable local receipts and misrepresents source
health. Adapting local receipts to Gmail-thread shapes would imply incoming mail and
one-mailbox ownership that have not been proved. A distinct read-only activity DTO
and panel are selected. This is an interim useful history feature, not a replacement
for the required future owner approval/reply/inbound journey. It uses existing
tables and adds no migration. Five body-bounded messages constrain response size
and hashing; dataset-scale query cost needs evaluation before production volume.

**Evidence/actions:** actual GET characterization reproduced two fake provider
calls plus a credential write before the replacement. Local SQLite/D1 now exercise
the real reader; browser fixtures exercise the real component, built CSS and handler
with synthetic authentication/storage. Full-app login and live mail are not proved
by that isolated panel check. Current results and outstanding review are in STATUS.

SEC-006 was reproduced through the baseline reply handler with synthetic dependencies.
Repeated requests caused repeated sends. A CRM write failure after provider success
returns 500, and repeating the request sends again. The route also chooses the
first user mailbox instead of the exact mailbox associated with the thread.
The scheduler has a sequence-specific pre-send marker, but directly invokes the
same Gmail transport and cannot serve as a shared manual-reply boundary.

Replies to interested prospects are a required product feature. Retiring the
reply route, adding only an administrator check, or applying the autonomous-send
switch indiscriminately would not satisfy the product or security requirement.
Migration 0070 is a different owner-dossier transaction whose contract forbids
provider authority; it must not be repurposed for outbound email.

## Proposed decision

Both manual replies and scheduled outreach must use one server-only dispatcher.
It owns an immutable, durable intent and a single provider attempt. The transport
must not remain available as a bypass for either caller.

- Bind the intent to the authenticated actor, exact mailbox, lead, mode, logical
  operation, caller idempotency key, canonical payload digest, and policy version.
  The request may not supply authoritative owner, approval, or budget facts.
- Validate a bounded strict request before hashing. Hash the exact normalized
  envelope that will be sent, including recipient, subject, body, threading and
  sender. Changing a payload under an existing key returns a conflict.
- Resolve the exact thread mailbox from recorded provenance. A user's first
  connection or fallback mailbox is not adequate. Preserve legitimate recorded
  recipient validation; ambiguous historical mailbox attribution blocks sending.
- At dispatch, freshly check owner/admin admission, exact mailbox ownership and
  health, recipient/thread, suppression/complaints, global stop, applicable consent,
  current content approval, policy version and budget. Manual and autonomous modes
  differ explicitly; neither bypasses global stop or safety requirements.
- Atomically reserve the intent, applicable budget/capacity, and an attempt before
  contacting Gmail. The durable claim must have exactly one winner across processes.
  Read-then-write or an in-memory lock is insufficient. Missing schema fails closed.
- Claim time is the dispatch authorization point. Stops prevent new claims, not
  recall of a request already in flight. Recheck immediately before transport;
  document and test this unavoidable in-flight boundary instead of promising recall.

## Delivery and recovery

| Durable state | Meaning | May dispatch this intent again? |
|---|---|---|
| DISPATCHING | Attempt committed; provider result not durably recorded | No |
| UNKNOWN | Timeout, malformed result, or uncertain provider outcome | No |
| SENT | Exact provider acceptance or validated reconciliation recorded | No |
| REJECTED | Definitive provider rejection recorded | No |

An interrupted DISPATCHING row is treated as uncertain, never as an expired lease
that permits another send. Only DISPATCHING can become UNKNOWN or REJECTED;
DISPATCHING/UNKNOWN can become SENT. Terminal results and intent identity cannot
be overwritten or deleted by ordinary application writes.

Assign a stable RFC Message-ID before transport and persist it with the intent.
Gmail's documented send method does not describe a client idempotency parameter;
therefore we must not assume duplicate suppression. Message search supports an
RFC message-ID query, but is only a candidate lookup. Reconciliation must retrieve
the candidate and verify the exact sending mailbox, sent status, message identity,
thread and envelope/content before recording acceptance. An empty search, multiple
candidates, missing permissions, or a mismatched result is not proof of non-delivery.
The UI must show uncertainty, retain the same intent across retry/reload, and never
silently rotate to a fresh key. Explicitly creating a different reply is distinct
from retrying an uncertain one and must not become a hidden retry mechanism.

Provider acceptance and local SQL cannot share a transaction. Persist acceptance
before CRM projections; projections use deterministic IDs and retry idempotently.
A projection failure means history needs repair, not that the provider should be
called again. If acceptance itself cannot be saved, the durable pre-send marker
still blocks redelivery until reconciliation.

## Alternatives and trade-offs

- **Client button lock:** cheap, but fails on retries, reloads and concurrent servers.
- **Scheduler marker reused directly:** some existing protection, but specific to
  sequence steps and does not close manual, mailbox or policy bypasses.
- **Automatic retry after a timeout:** improves apparent availability but can
  duplicate messages. Rejected without provider-level idempotency proof.
- **Shared durable dispatcher:** additional SQL and recovery/UI work, but preserves
  useful replies and makes uncertain delivery explicit. Selected for implementation.

## Implementation and exit gates

Source migration 0074 introduces OutboundEnvelopeApproval rather than repurposing
the sequence-only legacy OutreachApproval. `outbound-approval-store.ts` persists the
complete immutable intent and envelope after checking current admin session and
owner admission in the INSERT, exact sender/mailbox/connection identity, a present
unarchived lead, and explicit future expiry. Actor IDs must originate from the
authenticated server session; the SQL guard is a fresh recheck, not a substitute
for authenticating browser requests. No approval route or UI is wired yet. MFA
and the existing high-assurance owner/release requirements are not waived.

Approval expiry is an explicit server-policy input, with no new default duration.
One record belongs to one immutable intent. Repeating the exact approval reuses
the record without writes, renewal or changed reviewer attribution. Changing an
approved message requires a separately approved new intent; the UI must never use
that mechanism as a hidden retry of uncertain delivery. SQL prevents rewriting,
replacement and deletion. A current admitted admin may revoke once; repeated
revocation is read-only, and ordinary writes cannot undo it. Revocation blocks
future use, not a provider request already dispatched.

The loader checks the original reviewer and sending owner's current admission,
lead archive state, expiry and the full intent/content digest. It rechecks the
record after asynchronous hashing and fails if revocation, role, policy or content
changed. It can supply the envelope transport's real load callback. This is still
only one gate: current approval must also be fenced into the eventual atomic send
claim with consent, health, global/campaign/mailbox stops, capacity and budget.
Privileged database maintenance is outside this writer's authorization boundary.

Seven focused synthetic tests cover real auth/mailbox table shapes, current actor
denials, immutable/exact replay, expiry, revocation, changes between read and use,
and composition with the real mailbox resolver plus dispatcher. Existing approval
data is not imported or promoted automatically. No live schema is migrated, no
autonomy enabled and no real provider called. Independent review, D1 approval-store
proof, full policy composition and actual route/UI integration are outstanding.

`outbound-mailbox.ts` replaces the test-only identity callback with a read-only
database resolver for the actual GmailConnection/OutreachMailbox schema. It joins
the exact mailbox, connection, both owner fields and both address fields; no first
mailbox, address normalization or send-as alias fallback exists. It requires an
ACTIVE/WARMING mailbox, an exact gmail.send scope, and a strictly valid expiry more
than five minutes beyond the database clock. It selects only encrypted access
credentials, not refresh tokens. Inject local `decryptToken`, never the legacy
helper that may refresh or contact Google. Missing schema/records and invalid
credentials yield bounded errors without token or parser contents.

After decryption it reloads the same database records, rejects metadata/ciphertext
changes and clock regression, and checks expiry again before returning the token.
This closes the tested pause/rotation-during-decryption gap, not the unavoidable
change-after-final-check/in-flight-send interval. Fresh actor, consent, approval,
health, global stop and capacity policy still belong to the enclosing dispatcher
authorization and final policy recheck. Stored ACTIVE is not proof of mailbox health.
Expired tokens stop; a separately reviewed refresh lifecycle remains required.

Six focused tests execute migrations 0005/0006 in in-memory SQLite, deny foreign or
missing identities, status/scope/expiry failures and metadata races, and compose the
database resolver with exact-envelope transport and the durable dispatcher. An
active fixture makes one fake send across replay; a paused fixture makes zero.
Approval/consent in that integration is still synthetic. No actual route is wired,
no runtime binding is imported and no live credential/provider operation occurs.

`scripts/outbound-mailbox-d1.test.ts` additionally runs that resolver against the
installed Miniflare D1 backend. Actual table definitions and the current multi-
mailbox unique index are used, with a different same-owner connection inserted
first. It proves exact selection, wrong-identity denial, database-clock expiry,
pause/rotation during decryption, and connection-deletion foreign-key behavior.
The runtime has no live bindings, denies outbound services, records zero external
requests and is disposed after the test. This is local D1 compatibility evidence,
not cloud production proof or a substitute for the pending independent review.

`outbound-envelope.ts` now supplies the exact-content transport dependency. Its
versioned digest includes owner/mailbox/connection, lead, policy, mode, sender,
recipient, final subject, both body representations, thread/reference headers and
stable Message-ID. Unlike the legacy approval digest, it never trims body text or
normalizes line endings. Headers that Gmail would silently trim or sanitize are
rejected before approval. Unicode must round-trip through UTF-8 without loss.
Fixed schema order makes object property order irrelevant; unknown fields reject.

The adapter clones/freezes the loaded envelope, compares its digest and identity
to the claimed intent before resolving credentials, then checks exact mailbox,
owner, connection and sender address. Only explicitly selected fields reach the
Gmail helper. It uses `sendGmailEmail`, not the reply helper that adds `Re:` and
rewrites references after approval. A mismatched provider reply thread is uncertain
and cannot justify retry. Mailbox provenance and current policy still depend on
trusted database loaders that are NOT implemented; matching returned strings alone
does not prove a token belongs to that mailbox. Aliases require separately verified
send-as provenance, never an arbitrary From override.

Tests exercise real Gmail MIME formatting with fake fetch, all approval-field
mutations, invalid headers/Unicode, mismatched mailbox identities, mutation during
await, thread mismatch and composition with the durable dispatcher. No provider is
contacted. The 656-test full suite passes at this working-copy step. These adapters
remain unwired from the actual routes; SEC-006 is still open.

The trusted transport contract now includes an explicit `{ rejected: true }`
result for confirmed non-delivery. Ordinary thrown errors remain UNKNOWN; the
dispatcher does not infer rejection from text or HTTP status. Contradictory
acceptance fields on that result fail closed. REJECTED is returned only after
its outcome write succeeds; a lost acknowledgement is initially uncertain and
replay reads the durable state without another provider call. Rejected attempts
retain budget reservations. Sixteen combined tests cover these paths, including
receipt write failure before and after commit. A real provider classifier still
requires separate evidence and integration. Durable history repair scheduling
also remains open; SENT_HISTORY_PENDING alone is not a repair queue.

`outbound-dispatch.ts` now implements the shared lifecycle over injected trusted
dependencies: atomic authorization/claim, one exact-intent transport attempt,
durable acceptance, then idempotent CRM/history projection. It imports no Gmail
transport, database binding or credential and has no runtime caller yet.
`authorizeAndClaim` must combine all current policy gates with the budget-backed
claim; simply passing the standalone store's claim method is valid only in the
synthetic test fixture. The eventual exact-intent adapter must verify the approved
envelope digest and mailbox before sending; that adapter is not implemented here.

Thirteen combined tests now include dispatcher policy denial, simultaneous callers,
transport uncertainty plus failed outcome storage, post-send CRM failure, and
lost acceptance-write acknowledgement. Replays of DISPATCHING/UNKNOWN never send;
replays of SENT may repair history but never send. Acceptance is stored before
projection. No raw error or attempt token is returned in a dispatch result.
The baseline legacy-route reproduction demonstrated the old bug before the partial
integration above. Neither live caller is activated on the new boundary; these
tests do not close SEC-006.

Budget groundwork now lives in the same source-only 0073 migration. An unseeded
RuntimeBudgetMonth table holds CAD cents, a ceiling no greater than 5000, prior
commitments and an accounting-reference digest; new rows default paused. Its
proposed billing window is UTC calendar months, separate from Ontario owner work
hours. No live billing policy or accounting import has been created or approved.
The dispatcher must supply a verified upper-bound cost quote and seed prior
subscriptions/provider commitments through a separately reviewed accounting path.
This module does not validate those external accounting facts or exchange rates.

An AFTER INSERT trigger reserves the quoted amount in the same statement as the
intent. Missing/stale/paused/exhausted periods reject the entire insertion. Repeat
intent lookups do not charge again. Committed cost cannot decrease, history cannot
be deleted/replaced, and uncertain/rejected attempts retain their reservation
until a separately reviewed reconciliation/refund mechanism exists. At a full
ceiling even a zero-cost new intent is stopped. Tests race three distinct one-cent
intents from separate processes against one cent remaining: one inserts and two
roll back, leaving the counter exactly at 5000. This is not an app-wide runtime
cost guarantee: other provider paths, real accounting and policy remain unwired.
An accounting import may reveal costs already above the ceiling. That state is
permitted only with paused=1 and cannot be unpaused while overcommitted; raising
the ceiling above C$50 remains rejected. This preserves honest accounting without
turning an overspent month into spending permission. Tests cover the constraint
and stable conflict errors for missing/wrong attempt tokens after review.

Source inventory: existing OutreachApproval binds sequence-step content but is
not a manual-reply authorization record. RevenueContactPoint/VerificationResult
currently enforce UNASSESSED/no-send shadow contracts. RevenueCostLedger records
costs but does not reserve outbound budget. New consent/health/budget integration
must preserve those distinctions, rather than infer authorization from telemetry.

The existing approval gate now validates timestamp syntax/chronology and selects
latest rows by normalized creation time then insertion rowid. Invalid creation
times block. The real table test demonstrates why lexical/random-ID ordering was
unsafe. Gmail helpers now accept an optional validated RFC Message-ID and reject
malformed success receipts as uncertain. Neither change connects the ledger or
provides provider-level exactly-once delivery; both remain integration groundwork.

The initial ledger implementation is migration 0073 plus
`outbound-send-intent-store.ts`, an injected persistence primitive. Seven
disposable SQLite tests cover a unique claimant across store instances,
identity conflict, immutable terminal outcomes, uncertainty, malformed input,
unavailable storage, and lost claim/acceptance acknowledgements. No runtime
caller imports it yet. It is not a policy or budget authorization boundary.
The claim winner alone receives a random attempt token for outcome writes; replay
responses and public rows omit it. This token is an internal capability, never
an API response, log field or owner-UI value. A privileged reconciliation path
still needs implementation; it cannot simply issue the token to a retrying client.
The additional process test creates one disposable temporary SQLite database,
starts three separate Node processes with independent connections, releases them
from an IPC barrier, proves one claim winner, waits for all processes to exit,
then starts a fourth process that reopens the file and sees only EXISTING. A final
read confirms one row. The fixture directory is removed after the processes exit;
no user database is opened. Child environments omit application bindings and
inherited credentials. This is SQLite evidence, not a live Cloudflare D1 claim.

SQL now mirrors the printable-ASCII identifier and RFC Message-ID shape checks,
rejects hidden NULs/BLOBs, constrains hexadecimal digests and safe nonnegative
integer timestamps, and prevents INSERT OR REPLACE from replacing an existing
intent. Tests cover malformed direct inserts and attempted replacement of a
terminal result. Policy/budget composition and complete dispatcher integration
remain required before this becomes a sending authority.

1. [x] Reproduce real-route duplicate delivery with synthetic dependencies.
2. [ ] Implement additive intent schema, atomic claim, conflict/replay checks and
   exact affected-row proof; test concurrent claims and process loss in disposable SQL.
3. [ ] Integrate current policy and atomic budget reservations, exact mailbox/thread
   attribution, stable Message-ID and both existing outbound callers.
4. [ ] Implement acceptance/projection recovery and owner UI intent retention.
5. [ ] Prove all blocked paths make zero provider calls, legitimate replies work,
   concurrent/replayed requests send once, and uncertain outcomes never auto-resend.
6. [ ] Independent security review and complete exact-commit release gate.

SEC-006 remains open until the integrated boundary passes these gates. No live
schema, mailbox, provider, deployment or budget authority is granted. C$0 spent.

## Primary-source evidence

Checked 2026-09-08: [Gmail messages.send](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/send)
and [Gmail messages.list](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/list).
The no-automatic-retry rule is our conservative engineering decision, not a Gmail
exactly-once guarantee.
