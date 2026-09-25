# Revenue Engine validation and release plan

**Version:** 2026-09-20. Tests establish a precisely named scope: source contract, local integration, owner flow, CI, staging, production, or commercial result. Evidence from one scope is never reported as another. This document describes future gates; current results are in [STATUS](STATUS.md).

## 1. What must be proved

| Area | Failure/input to exercise | Required behavior | Gate |
|---|---|---|---|
| Identity | Same phone, different branches; redirected domain; duplicate import | Conflict/review or exact replay; preserve suppression | M1–M3 |
| Source rights | Missing licence, stale terms, restricted content expiry | Deny restricted storage/use; no automatic alternative provider | M2 |
| Capture | Private/loopback/link-local IPv4/IPv6, redirect chain, DNS change, huge/slow response | Reject/abort; bounded cost; no private-network request | M2 |
| Website truth | JS-only content, blocked browser, partial page set, transient outage | Unknown/incomplete; no unsupported absence or visual claim | M1–M3 |
| Evidence | Cross-business claim, changed bytes, stale/future time, forged receipt | Reject; invalidate dependent result/approval | M1 onward |
| Persistence | Crash before/after final receipt, replay, missing guard, restart | Atomic/explicit incomplete state; durable reload; no invented completion | M1 onward |
| Qualification | Strong business without email; effective site with reachable inbox | Preserve business quality; route contact research; no email-led qualification | M3 |
| AI | Injection, wrong enum/model, missing usage, contradiction, high-confidence error | Advisory-only or abstain; retain potential cost; no action authority | Optional experiment |
| Budget | Parallel reservations, retry/timeout, new month, stale FX/rate, exhausted shared quota | Atomic deny/reserve/settle; unresolved cost held; no cap reset exploit | Before paid work |
| Contact | DNS-only, catch-all, purchased list, stale publication, withdrawn consent | No automatic email; verification never creates consent | M4 |
| Approval | Edited body/recipient/mailbox/offer; expired approval; wrong operator | Refuse dispatch; require exact current review | M4 |
| Send | Queue redelivery, double-click, concurrent owners, crash after provider acceptance | At most one new dispatch decision; ambiguous result reconciled, not blindly retried | M4–M5 |
| Suppression | Stop request before dispatch, during queue wait, duplicate alias, identity merge | Revoke unsent work; propagate stop across applicable scope | M4 onward |
| Replies | Duplicate events, history cursor loss, revoked OAuth, out-of-order events | Durable dedup; bounded resync; visible stale state; pause new outreach | M4 onward |
| Owner/auth | Unauthorized record access, CSRF, malicious HTML/CSV, mobile/keyboard | Deny writes/read leaks; sanitize display/export; usable task flows | All UI milestones |
| CRM | Positive reply versus out-of-office; unowned opportunity; refund/cancellation | Owner review, next action, distinct commercial/collected-value events | M4–M6 |
| Stop/recovery | Global stop with queued/in-flight work; rollback after migration | Block new dispatch within target; reconcile in-flight effects; preserve facts | M4–M7 |

Use fakes, deterministic clocks, isolated databases, synthetic artifacts and mail sinks. Automated tests must not contact prospects, sync real inboxes, submit forms, deploy, migrate remote databases or spend provider credits. An authorized real-data/provider experiment is an operational experiment with its own scope and receipts, not an automated regression test.

## 2. Tests proportional to the change

Run focused tests for the changed contract first. Add tests for real failure modes and user-visible behavior, not tests that merely repeat implementation lines. Keep useful legacy characterization tests before changing adapters/callers. Do not rewrite working modules to satisfy the new roadmap.

For time-dependent tests, inject one fixture clock and derive all freshness windows from it. Keep explicit past/future boundary cases. A hard-coded date that was once in the future is not a stable fixture. The current 22-test failure is recorded as a prerequisite repair; this planning change does not fix it or weaken production validation.

At domain boundaries validate schema, identity, version, freshness and authority. For a transaction, verify the stored rows and replay semantics, not just a mocked function return. For owner pages, seed through the writer the page claims to consume. For durable resumption, restart the process and reconstruct trust from storage rather than carrying in-memory objects into a test that pretends to restart.

## 3. Required checkpoint commands

Run the repository-required checks in order and save exit codes/log references:

```powershell
npm run check:safety
npm test
npm run typecheck
npm run lint
npm run build:cloudflare
npx wrangler deploy --env="" --dry-run --autoconfig false
```

For engine changes also validate generated engine bindings and `npm run cf:engine:dry-run`. For UI/owner-flow changes run `npm run test:owner-ui` **only after every build and dry run has exited**; they share `.next`. Never run these build/browser checks concurrently. Local success does not establish Linux CI or a Cloudflare deployment.

Do not reinstall/update dependencies or upgrade model versions as a side effect of documentation verification. Preserve untracked owner work and report whether local checks included it. Before release, verify an isolated clean checkout of the exact committed candidate so uncommitted files cannot mask a missing dependency or test failure.

## 4. Fifty-business evaluation protocol

Preserve the existing exact 50 distinct businesses, each city >=10, each niche >=10, current assessments, all owner labels/reasons and >=85% agreement (43/50) contract. These must be 50 real dossiers: M3 adds at least 40 to M2's ten and replaces any initial records that fail freshness or balance. Validate real source provenance for every case before labelling; imported synthetic fixtures cannot satisfy this gate. The local Quality Lab now requires a separate blind evidence artifact and complete first-pass export before loading engine assessments. Browser network checks must find no engine verdict, score, aggregate agreement, or assessment-derived audit cue before that export. This controls the app flow; report the remaining possibility that an owner opens the separate assessment file early as an anchoring limitation.

Proposed experimental split: 30 tuning and 20 holdout, fixed with recorded IDs/seed before question/policy tuning, stratified by city/niche and known classes where feasible. Freeze all prompts/model/policy versions before scoring holdout. Do not use holdout errors to tune and keep calling it unseen. Refresh with a new reviewed cohort when the original set is exhausted by tuning.

Report total and per-class confusion, strong-lead precision/recall, unknown/abstention rate, wrong-identity/source errors, false negatives from rejected-case review, human disagreements, minutes per business, and exact costs/attempts. Split 50-case acceptance from holdout estimates. Report intervals where meaningful; show N/A when no positive denominator exists. Synthetic adversarial safety cases are a separate suite, not extra business-accuracy observations.

Commercial trials use a different cohort/result ledger. Track contacts attempted, provider accepted, subsequently bounced, human replies, qualified interest, opportunities, wins and collected cash, with observation windows. Do not count out-of-office as interest or provider acceptance as delivered mail. A small no-complaint sample cannot verify a <0.1% underlying complaint rate.

## 5. Owner acceptance

Use the real application on desktop and mobile with keyboard navigation. Check empty/error/stale/blocked states, clear source links, time-zone display, reduced motion, accessible contrast/labels, no horizontal overflow, and safe downloads. Existing browser timing tests measure readiness; ask Riley/Aidan to actually complete the task to verify the 10/15/30-second targets.

Test: choose the next worthwhile business; explain its strongest supported issue; distinguish a strong account needing contact research from an email-ready weak account; review/edit one exact draft; handle unsubscribe/positive reply; assign a next action; locate spend and stop. The UI must show missing capabilities honestly, including absent provider keys or disconnected mailboxes.

## 6. Release, migration and rollback

1. Inventory the exact candidate commit, diff, accounts, current environment, schema, existing running jobs, safety switches and budget. Verify no secrets/private lead data in the patch.
2. Pass required local checks and exact-candidate Linux CI. The current documentation checkpoint with a known failing test suite is not releasable.
3. Export/checksum the relevant D1 state before any remote migration and rehearse restore in isolation. Confirm artifact protection and OAuth recovery; a backup file alone is not a tested recovery plan.
4. Use additive schema changes and repeatable backfills. Reconcile identity links, contacts, suppressions, consent, sent/reply history, opportunities, monetary events and costs. Unknown historical fields remain unknown; legacy data does not gain fresh evidence through import.
5. Deploy to isolated staging only under its exact release gate. Test with synthetic data and sinks. Record actual bindings, model IDs, flags, generated types, budget caps and rollback version.
6. Present the owner a concrete production packet: exact commit/config/schema, backup, scope, cost, current validation, known limits and rollback. A previous approval for another hash/environment does not authorize it.
7. Release with new features off. Perform approved read-only smoke checks; never test by sending to a prospect. Enable only the authorized cohort/capability and observe every effect.
8. On regression, stop new work first, reconcile ambiguous external effects, then restore compatible code/config. Prefer forward repair for append-only facts; do not erase sends or suppression to make a rollback look clean. Keep legacy rollback/export through 30 stable days.

In-flight sends may complete after a stop; record/reconcile them. A database rollback cannot unsend email, uncharge a provider, or withdraw already-exposed data. Queue replay and OAuth reconnect never silently resume paused outreach.

## 7. Handoff evidence

Every checkpoint records source SHA, dirty/untracked scope, commands/exit codes, counts, environment, data type (synthetic/real), provider operations/cost, owner decisions, known blockers and next three actions. Keep short current STATUS separate from append-only historical reports. Never mark a milestone complete merely because all planned files were written.
