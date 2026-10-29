# Implementation decisions and remaining gates

These rulings retain the Native execution ledger decisions in their original order. They are local implementation decisions, not production authorization.

1. Preserve the imported snapshot in separate commits; a restore checkpoint is not release evidence. Cost if wrong: an unverified snapshot could be mistaken for a deployable build.
2. Repair demonstrated Windows fresh-checkout failures first, with synthetic cache fixtures and safe symlink handling. Cost if wrong: verification could consume private cache data or write through an unexpected link.
3. Bind claims to the prepared source revision and use explicit not-dialed/call-finished reconciliation. Cost: old clients need the coordinated protocol upgrade.
4. A dialer click does not prove an attempted or connected call. Cost: the operator must confirm physical facts.
5. Enforce exact configured Origin and current owner authorization on the new Orbit Caller settings route. Cost if wrong: credential actions could be exposed to another origin; existing generic settings behavior is not silently changed.
6. Leave the minute sync schedule disabled until its separate release/configuration/budget gate. Cost: outages may leave queued work waiting for an explicit retry or later source activity; activation adds about43,200 invocations/app/month.
7. Persist the initiating Engine link before the peer handshake so interrupted setup can resume. Cost: a pending link conservatively holds calling until repaired.
8. Explicit attempted:false records do not invent last-contact timing; existing manual history retains its prior semantics. Cost: historical manual notes are not reclassified automatically.
9. Connected Voice uses a copied brief, new ChatGPT chat and explicit operator confirmations. Cost: manual paste/start/end and no automatic connected transcript; phone/audio transport remains a separate device gate.
10. Commercial corrections are append-only domain revisions referring to the original call, rather than a new physical call from another actor. Cost: a future cross-app domain-correction protocol may be needed.
11. Engine sends a minimal reviewed conversion request and the actual Orbit owner confirms it. Cost: one additional owner review; a peer grant never impersonates that owner.
12. Hold acquisition during conversion, but create permanent mapping only with the committed Orbit business receipt. Cost: an outage can hold calling pending recovery instead of risking a duplicate or nonexistent client.
13. Refresh compatible stable dependencies within current framework majors. Cost: newer-major features and fixes await separately scoped migrations.
14. Retain Orbit auth's separate Zod4 runtime alongside app Zod3 without suppressing its optional peer warning. Cost if wrong: auth compatibility regressions; covered by auth tests and real fixture login.
15. Retain Orbit Better Auth1.7.2 because later versions fail its required account.issuer contract. Cost: newer auth changes await a reviewed schema migration.
16. Hardware/audio and uncoached owner acceptance remain unverified; provide a runnable build and checklist. Cost: device friction may still be discovered before release.
17. Dedicated WebWorker termination proves IndexedDB transaction behavior, not installed extension service-worker lifecycle. Cost: extension suspension/restart issues remain for device acceptance.
18. Do not mutate production to establish deployment identity or backup evidence. Cost: rollout waits for verified deployed commits and fresh restore-tested backups.
19. Record exact final revisions and verification results after review fixes; do not treat the reviewer as proof of pending gates. Cost if wrong: stale evidence, prevented by the final manifest and hashes.
20. Retain Engine Better Auth1.6.29 after1.7.6 failed production-build login schema validation. Cost: newer auth changes await a reviewed migration; no validation was disabled.

The original ledger preserves the detailed chronology in the local release packet. No final-review Minor findings were deferred. All five Important findings are in the single tested fix pass; see verification.md for outcomes.
