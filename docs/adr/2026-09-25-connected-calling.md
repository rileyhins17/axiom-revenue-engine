# Connected calling decisions

Status: implemented locally; production and device release gates remain open.

Caller owns the physical attempt and one atomic IndexedDB transaction for its reviewed result, transcript record, immutable event and delivery job. Caller never infers phone connection, audio routing or a sale from a TEL click. Manual Phone Link is usable independently of optional Voice.

Each source owns eligibility, contact stops, current source revisions and domain effects. Explicit signed links coordinate ownership through Engine; a phone/domain match is never a link. Both sources must authorize linked preparation and arming. Expired armed/active ownership becomes uncertain until the original operator reconciles it.

An origin receipt and a peer receipt are separate facts. Outboxes survive retries and retain exact payload identity. Corrections preserve the physical attempt and wait for the exact original receipt; linked projection includes missing ancestors. Commit-time guards resolve stop/link and correction/link races without losing suppression or history. Orbit commercial decisions and client conversion require explicit review and atomic receipts, with no invented price or automatic sale.

A precise callback whose clock time is ambiguous or nonexistent remains visible with the original words, and blocks new calling until resolved. Date-only timing needs an IANA zone before its due status can permit a call. UI request generations discard delayed previous-session/account replies; local mutation acknowledgments finish before queued refreshes, and dial clicks require the current accepted session.

Deployment activation is strict, default off and bound to one workspace. Ordinary Caller tokens and signed peer grants do not enable it. Pausing blocks new preparation/reservation/arming while retaining existing call recovery and durable delivery. Checked-in calling and scheduled-sync flags stay false. Schema changes are additive; rollback uses compatible code or reviewed exports, never destructive schema reversal.

Compatible dependencies were selected by full verification. Engine retains Better Auth 1.6.29 and Orbit 1.7.2 because newer releases failed their existing auth schemas. See dependency-compatibility.md and the release manifest for exact locks, tests and external gates.
