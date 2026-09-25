# Linked calling development checkpoint

This is unfinished local implementation, not release or peer-configuration authorization.

The server-to-server grant binds one Engine identity (`axiom` / `axiom-engine`) to one explicitly configured Orbit workspace and connection. The two deployments must share `CALLER_PEER_GRANT_ID` and a 32-byte hex `CALLER_PEER_SECRET` in their secret stores, plus the exact `CALLER_ORBIT_WORKSPACE_ID` and `CALLER_ORBIT_CONNECTION_ID`. No grant has been configured in production. These values are separate from user Caller tokens. Never return the peer secret to a browser, extension, export, log or database row.

Requests go only to the fixed product origins, reject redirects, time out after five seconds, and authenticate a timestamped HMAC envelope covering the operation, grant, both identities and complete payload. A changed or missing grant fails closed. Business IDs and contact IDs must be confirmed explicitly; matching phone numbers or domains never creates a link.

The handshake stages Engine, stages Orbit, activates Orbit, then activates Engine. Engine retains the initiating mapping first so a lost peer response remains visible and resumable in Settings. Its durable link ID makes each stage retryable. A partial handshake keeps the mapping pending and blocks standalone calling. Linking cannot move an open physical attempt between coordinators. SQL guards make a competing link and standalone reservation mutually exclusive. Mappings remain as tombstones when an underlying source disappears; removal must not silently restore standalone calling.

Linked attempts use Engine's contact-control ledger. Engine-origin requests also check Orbit's current eligibility. Orbit-origin requests preserve the original Orbit actor, contact, source and revision locally; Engine stores a scoped opaque operator key and minimal coordination metadata. Both authoritative sources must pass before reserving or arming. Active heartbeats preserve ownership and never imply the ability to revoke a physical phone call. Expired armed/active claims stay uncertain until explicit reconciliation.

A source result, source activity and projection job commit together. Projection payloads contain precise physical facts, exact callback data and the source payload hash. Orbit-to-Engine projections omit private notes, proposals, findings, transcripts and commercial decisions. Mirrored history is append-only and has its own payload hash/receipt; it does not run the source's domain transitions or enqueue a return projection. Corrections require their original mirror. A late mirror closes only its original coordinated attempt, never a replacement.

The outbox retains every job. A flush leases at most ten jobs, runs at concurrency two, uses five-second delivery timeouts and a thirty-second tick budget, prioritizes contact stops, and accepts only an exact projection receipt. Lost responses retry the identical payload. Invalid receipts/conflicts remain visible for review; changed grants require the original authorization. No queue truncation or automatic domain action is part of delivery.

The owner-only Engine Settings screen searches scoped identity previews, requires selecting both records and explicitly confirming the contact, and rechecks the preview revision before the handshake. Changed records require a fresh preview. Pending mappings have Resume controls. Neither source token nor an arbitrary page origin can establish a link. Orbit Settings points back to that setup surface and offers scoped delivery retry.

Independent contact stops have a priority outbox and receipt, without a fabricated call/attempt. Stopping locally and enqueueing the stop are atomic. DNC call results queue a separate stop so missing correction parents cannot delay suppression. Existing stops are queued when linking. Pending/active mappings accept authenticated stops conservatively; history projections require an active mapping.

Both workers have a separate minute-cron dispatch branch. CALLER_SYNC_ENABLED must be exactly true to do scheduled database work; checked-in root and deployment configs require false. The minute trigger itself is intentionally not activated: the release review must account for roughly 43,200 additional invocations per 30-day month per app, existing Worker limits and the Engine C$50/month ceiling. Existing monitoring/email schedules are unchanged. A successful source result or stop schedules best-effort immediate delivery independently of the scheduled switch; its source receipt never waits for the peer. The outbox remains authoritative after worker termination.

Caller can explicitly check linked delivery status after its source receipt. The authenticated response binds the original event/operator and reports each projection’s status, payload hash and distinct received time. A source receipt never implies a peer receipt. Owner Settings can retry jobs only under their original grant; rotating or replacing a grant does not reassign them.

## Remaining Task 12 work

- Full source and setup browser acceptance. Mirrored canonical history, statistics and current callback eligibility are now wired into product reads.
- Expand status/repair display into Caller history (saved-call status exists).
- More fault tests for expiry, concurrent runners, timeout/budget, deleted contacts and correction ordering.
- Final source/browser gates, deployment identity, and device/release acceptance.

The root development packet includes `bridge-smoke.test.ts`, an offline two-repository harness. From the Orbit checkout, `node --import tsx --test ../bridge-smoke.test.ts` exercises both actual HTTP handlers, HMAC requests, shared claims, local results, both projection directions and a lost-response retry. Its injected transport never uses the external network. It does not prove production configuration, Windows TEL behavior, Phone Link or audio routing.

## Reviewed client handoff (local development)

Engine Settings now previews the source business, confirmed phone, selected current call history and agreed work. Confirming a real client relationship creates one durable conversion job and removes that contact from Engine acquisition. An absent domain stays absent in the Orbit inbox. The actual verified Orbit workspace owner then chooses an existing business/client/contact or creates the reviewed records using a real domain. Matching domains never silently select a business.

The existing Orbit conversion domain plan, current owner and revision guards, selected contact, mapping and permanent receipt commit in one transaction. No audit, monitoring or proposal starts. Engine's durable conversion hold is validated before that transaction; new Engine mappings are staged only after the Orbit receipt proves that the target exists. Lost responses resume the same conversion ID. Deleted sources do not recreate business records. Existing link identities and existing client notes are retained.

After both links activate, Engine acquisition remains closed. Only a current, eligible Orbit client/opportunity call for the converted relationship can use the shared coordinator. Contact stops and active/uncertain ownership continue to block new permits. Current Orbit commercial eligibility is still required; creating a client does not invent an opportunity.

Focused conversion, reservation and actual-handler bridge tests pass locally. Required full checkpoint and source-browser checks are recorded in the development ledger; hardware and release acceptance remain separate gates.
