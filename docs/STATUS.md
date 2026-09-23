# Current status — Axiom Revenue Engine

## Owner workflow UI checkpoint; production goal remains open

**Updated:** 2026-09-23 (America/Toronto). **Verified code commit:** `0cf76f5`
(`feat(revenue): unify owner workflows across the console`). This is a local
owner-UI checkpoint, not an M2 exit gate or a
production release. M1's synthetic offline flow remains complete; M2 has
**0/10 real engine assessments**; M3–M7 and production remain incomplete.

Today, Leads, Outreach, Revenue and System now lead with plain-language owner
decisions in a consistent warm, light layout. Leads makes the historical score
list an advanced read-only preview and labels its dossier as a legacy score;
Business Review remains admin-only and is never equated with contact approval.
Outreach starts with business evidence and human work, shows the intended
Cloudflare/Resend mail-and-reply route as unverified, and removes legacy Gmail,
queue and send controls from the owner view. Revenue separates entered monthly
estimates from collected cash and no longer shows every empty stage on a phone.
Settings no longer synchronizes or activates legacy Gmail mailbox rows during
a page read. Its failed emergency-state read shows **Could not verify** and
cannot clear the stop; a verified clear requires explicit owner confirmation.
Non-admins see access notes instead of dead Business Review or stop controls.
Critical read failures are unavailable, never invented zeroes or a claim that
live automation has stopped.

**Verification:** `npm run check:safety`, `npm test -- --test-concurrency=1`
(730 tests: 727 passed, zero failed, three expected Windows skips),
`npm run typecheck`, `npm run lint`, `npm run build:cloudflare`,
`npx wrangler deploy --env="" --dry-run --autoconfig false`, and
`git diff --check` passed. The final `npm run test:owner-ui` ran only after
the build, dry run and full suite exited. It passed the synthetic owner task
and stop flows, 1440 px and 390 px layouts, 17 WCAG scans and zero external
requests. Desktop Leads loaded in 867 ms, dossier in 834 ms and Business Review
in 4,746 ms, each within its acceptance budget. Two earlier browser runs
exposed a loading-state race in the acceptance script; the final run waits for
the owner page and targets its visible disclosure. No prospect was used in tests.

**Production, automation and spend:** no deployment, remote migration,
provider activation, live inbox operation, prospect capture, contact, send or
external outreach occurred. Live production remains unverified. Autonomous
intake, queue, follow-up and send remain off. The C$50/month ceiling is
unchanged and incremental engine-provider spend is C$0. No paid mailbox or
Google Workspace is assumed.

**Owner decisions and blockers:** Riley/Aidan still need the per-business
identity/disposition decisions for the proposed ten, plus source-specific
rights and retention for the first supervised M2 request. M2 needs real
evidence and owner assessments. The zero-paid-mailbox reply route, Cloudflare
owner access, private legacy snapshot, staging backup, migration, rollback
and release gates remain separate; this UI authorizes none of them.

Next three concrete actions:

1. Record the exact ten M2 business keep/replace, city, niche and independence
   decisions, including the two access-blocked sites.
2. Prepare the source-use and retention packet for one supervised real M2
   capture and assessment; inspect its evidence and cost before the rest.
3. Verify the zero-paid-mailbox reply route and private history snapshot under
   their separate gates, then stage backup and rollback proof before release.

## Today owner-workflow redesign checkpoint; production goal remains open

**Updated:** 2026-09-23 (America/Toronto). **Verified code commit:** `a3cb019`
(`feat(revenue): make Today an owner decision workspace`). This is a local
owner-UI checkpoint, not an M2 exit gate or production release. M1's synthetic
offline flow remains complete; M2 has
**0/10 real engine assessments**; M3–M7 and production remain incomplete.

Today now leads owners through the weekly safety, business review, human-action
and learning routine with plain-language cards and a direct Business Review
action. The main screen shows an unverified email route and distinguishes a
reported emergency stop from a failed status read. Replies and follow-ups show
unavailable states instead of invented zeroes, and bounded list counts use `+`
when a query limit may hide more items. The old send and intake telemetry is
closed under Advanced system details and withheld when critical reads fail.
The shell no longer displays a hard-coded `prod` badge, static `Safety gated`
badges, or legacy lead-score navigation counts. It no longer polls the legacy
stats endpoint for those badges. No runtime gate or provider route changed.

**Verification:** `npm run check:safety`, `npm test -- --test-concurrency=1`
(729 tests: 726 passed, zero failed, three expected Windows skips),
`npm run typecheck`, `npm run lint`, `npm run build:cloudflare`,
`npx wrangler deploy --env="" --dry-run --autoconfig false`, and
`git diff --check` passed. The full suite began before the final cosmetic
contrast and sidebar cleanup; final typecheck, lint, build, dry run and browser
acceptance covered those edits. `npm run test:owner-ui` passed after every
build and dry run exited: desktop list 226 ms, dossier 113 ms, M2 review
5,171 ms, 1440 px and 390 px layouts, 11 WCAG scans, synthetic task and stop
checks, and zero external requests. Current local visual artifacts are
`output/playwright/today-desktop.png` and `output/playwright/today-mobile.png`
(ignored, not committed). No prospect was used in tests.

**Production, automation and spend:** no deployment, remote migration,
provider activation, live inbox operation, prospect capture, contact, send or
external outreach occurred. Live production remains unverified. Autonomous
intake, queue, follow-up and send remain off. The C$50/month ceiling is
unchanged and incremental engine-provider spend is C$0. No paid mailbox or
Google Workspace is assumed.

**Owner decisions and blockers:** Riley/Aidan still need to review each of the
ten proposed business identities/dispositions and the source-specific rights
and retention for the first supervised M2 request. M2 needs real evidence and
owner assessments; the zero-paid-mailbox reply path, Cloudflare owner access,
private legacy snapshot, staging backup, migration, rollback and release gates
remain separate. This UI does not authorize outreach.

Next three concrete actions:

1. Record the exact ten M2 business keep/replace, city, niche and independence
   decisions, including the two access-blocked sites.
2. Prepare the source-use and retention packet for one supervised real M2
   capture and assessment; inspect its evidence and cost before the rest.
3. Verify the zero-paid-mailbox reply route and private history snapshot under
   their separate gates, then stage backup and rollback proof before release.

## Business Review redesign checkpoint; production goal remains open

**Updated:** 2026-09-22 (America/Toronto). **Verified code commit:** `5219871`
(`feat(revenue): redesign local business review`). This is a local M2
owner-review usability checkpoint, not
the M2 exit gate or a production release. M1's synthetic offline flow remains
complete; M2 has **0/10 real engine assessments**; M3–M7 and production remain
incomplete.

The admin-only, disabled-by-default `/leads/m2` page is now a light, searchable
Business Review that keeps the ten saved businesses in a compact queue and
opens one website review at a time. Phone layout uses separate list and detail
views, skips repeated overview content and provides a back action.
Plain-language statuses, the next review step and
explicitly unassessed website fit are prominent; source and technical records
remain expandable. A captured page is not presented as a good website or a
qualified opportunity, and the page has no contact or send action. New
`DERIVED_FACTS_ONLY` captures retain a bounded, text-free HTML structure
summary in their sealed facts and page receipt. It gives the owner expandable
page clues without saving raw HTML, page copy, screenshots or contact values.
Older receipts remain readable. See [ADR 0048](adr/0048-project-text-free-html-structure-into-m2-review.md)
and the [runbook](RUNBOOK.md#m2-local-owner-research-console).

**Verification:** `npm run check:safety`, `npm test -- --test-concurrency=1`
(729 tests: 726 passed, zero failed, three expected Windows skips),
`npm run typecheck`, `npm run lint`, `npm run build:cloudflare`, and
`npx wrangler deploy --env="" --dry-run --autoconfig false` passed on the
final code. The separately run `npm run test:owner-ui` passed after all builds
and dry runs had exited: desktop list 390 ms, dossier 124 ms, M2 review
4,829 ms, 1440 px and 390 px layouts, mobile top/bottom navigation clearance,
nine WCAG scans, synthetic task/stop checks and zero external requests. All
checks used synthetic businesses and local fakes, not prospects. A GPT-6 Luna
independent usability/safety review found no actionable P1/P2 issue.

**Production, automation and spend:** no deployment, remote migration, provider
activation, live inbox operation, prospect capture, contact, send or external
outreach occurred. Live production remains unverified. Autonomous intake,
queue, follow-up and send remain off. The C$50/month ceiling is unchanged and
incremental engine-provider spend is C$0. The last checked local Cloudflare
login was expired; a dry run does not restore account access. No paid mailbox
or Google Workspace is assumed.

**Owner decisions and blockers:** Riley/Aidan's per-business identity and
disposition review for the proposed ten, including the two access-blocked
sites; source-specific rights and retention for the first supervised M2
request; a separately authorized private legacy-history snapshot; Cloudflare
owner access and proof of the zero-paid-mailbox reply route; staging backup,
migration, rollback and release gates. This UI does not authorize outreach or
resolve the remaining M2–M7 work.

Next three concrete actions:

1. Record the per-business identity, city, niche, independence and keep/replace
   dispositions for the proposed ten evaluation candidates.
2. Prepare the exact reviewed M2 source-policy and retention packet; gate one
   supervised real capture and assessment, then inspect its evidence and cost.
3. Verify the private history snapshot and zero-paid-mailbox reply route under
   separate gates before M4 contact work; restore Cloudflare access for the
   later staged release process.

## Offline legacy-history review checkpoint; production goal remains open

**Updated:** 2026-09-22 (America/Toronto). **Verified code commit:** `a67dca7`
(`feat(revenue): add offline legacy contact history review`). This is a local M4
review aid, not the M4 exit gate or a production release. M1's synthetic offline
flow remains complete; M2 has **0/10 real engine assessments**; M3–M7 and
production remain incomplete.

One explicitly supplied standalone SQLite snapshot can now be checked and
projected into a private, read-only legacy-to-v2 contact-history report. The
report binds a snapshot hash and pinned as-of time, nominates domain, business
phone, phone-contact and email-contact identity matches without approving a
merge, and keeps prior suppressions, sends, bounces, replies, contradictory
send timestamps and unreviewed matches blocked. Legacy `Lead` state is labelled
reported rather than confirmed contact. The output omits message content and
raw contact values. **No real or production snapshot has been processed.**
The report does not verify a real snapshot's migration ledger or import any
history; those remain separate release checks. See [ADR 0047](adr/0047-reconcile-legacy-contact-history-offline-before-v2-outreach.md)
and the [runbook](RUNBOOK.md#review-legacy-contact-history-offline-before-v2-outreach).

The dated [provisional M2 source-rights review](reviews/2026-09-22-m2-provisional-source-rights.md)
found no affirmative basis for retained full-page HTML among the proposed ten.
Eight remain `DERIVED_FACTS_ONLY` for a later exact reviewed operation; two
sites returned 403 and remain blocked. The ten are **evaluation candidates,
not a calling list**. Their exact identity/disposition review is pending;
Aidan's aggregate feedback that most sites are decent does not decide each
case. No M2 capture or assessment followed this review.

**Verification:** 23 focused reconciliation tests passed. On the final code,
`npm run check:safety`, `npm test -- --test-concurrency=1` (725 tests: 722
passed, zero failed, three expected Windows skips), `npm run typecheck`,
`npm run lint`, `npm run build:cloudflare`, and
`npx wrangler deploy --env="" --dry-run --autoconfig false` passed. The separately
run `npm run test:owner-ui` passed after both build operations: desktop list
438 ms, dossier 161 ms, M2 review 7,095 ms, 1440 px and 390 px layouts, nine
WCAG scans, synthetic task/stop checks, and zero external requests. The
independent Luna diff review found no actionable P1/P2 issue. All tests used
synthetic data or local fakes and contacted no prospect.

**Production, automation and spend:** no deployment, remote migration, provider
activation, live inbox operation, prospect capture, contact, send or external
outreach occurred. Live production remains unverified. Autonomous intake,
queue, follow-up and send remain off. The C$50/month ceiling is unchanged;
incremental engine-provider spend is C$0. `wrangler whoami` at 2026-09-23
02:20 UTC reported an expired local login. Resend's published free tier was
refreshed in the provider plan, but Axiom account, sender, destination routing,
webhook, reply round trip and actual billing state are unverified. No paid
mailbox or Google Workspace is assumed.

**Owner decisions and blockers:** exact dispositions for the proposed ten and
whether to keep two access-blocked sites in the evaluation; source-specific
rights, terms, robots and retention for the first supervised M2 request; a
separately authorized private snapshot/retention route for actual legacy
history review; Cloudflare owner sign-in and free mail-route verification;
staging backup, migration, rollback and release gates. A local report cannot
clear legacy stops, consent, sender or reply requirements. No live send is
authorized.

Next three concrete actions:

1. Record Riley/Aidan's per-business M2 identity, city, niche and independence
   dispositions, including the keep-or-replace choice for the two blocked sites.
2. Prepare the exact reviewed M2 source-policy and retention packet, then gate
   one supervised real capture and assessment; inspect evidence and cost before
   the rest of the cohort.
3. Obtain a separately approved standalone private history snapshot, verify
   its migration provenance and review the offline reconciliation; restore
   Cloudflare access and prove the zero-paid-mailbox reply path before M4
   contact/send work.

## Manual business stop checkpoint; production goal remains open

**Updated:** 2026-09-22 (America/Toronto). **Verified code commit:** `eb53e7f`
(`feat(revenue): add manual business do-not-contact stop`), following schema
commit `016e3d8`. This is a local M4 safety/owner-workflow slice, not the M4
exit gate or a production release. M1's offline synthetic dossier remains
complete; M2 has **0/10 real engine assessments**; M3–M7 and production remain
incomplete.

An authenticated owner can now record one durable, append-only do-not-contact
stop for an exact current v2 business, with reason, note, session actor, saved
time, and exact idempotent retry. The dossier and ranked list read the current
stop and visibly block route recommendations. An unreadable stop table also
blocks route presentation while leaving evidence visible. Qualification scores
and evidence are unchanged. The adjacent task workflow refuses new tasks and
completion after a stop (or unavailable stop status), while retaining exact
pre-stop replay and allowing cancellation of open tasks. The historical M1
fixture explicitly omits this operational check because its pinned pre-0072
schema and immutable synthetic report have no contact authority. See
[ADR 0046](adr/0046-add-a-manual-business-stop-before-outreach.md).

**Verification:** `npm run check:safety`, `npm test -- --test-concurrency=1`
(702 tests: 699 passed, zero failed, three expected Windows skips),
`npm run typecheck`, `npm run lint`, `npm run build:cloudflare`, and
`npx wrangler deploy --env="" --dry-run --autoconfig false` passed on the final
code. The separately run `npm run test:owner-ui` passed after build/dry-run:
synthetic stop creation/replay survived reload, anonymous and cross-site stop
requests failed, all three recorded contact routes and the ranked lead showed
blocked, new/completed tasks were rejected while cancellation remained
available, nine WCAG page scans passed, and external requests were zero. The
first browser run exposed a wrong test selector for the route cards; the
corrected test passed on the completed build. No test contacted a prospect.

**Production, automation and spend:** schema 0072 and the owner UI/API are
committed locally, not applied to staging or production. No remote migration,
deployment, provider activation, inbox operation, engine prospect capture,
external contact, or outreach occurred. Live production state remains
unverified. Autonomous intake, queue, follow-up, and send remain off; the
C$50/month runtime ceiling is unchanged; incremental engine-provider spend is
C$0. The local `wrangler` login was expired at the last check, while the dry
run succeeded without production access.

**Blockers and owner decisions:** the ten proposed M2 businesses still need
individual identity/disposition review; Aidan's aggregate calling feedback is
not that decision. Current source-use/retention, account/quota/price, one
supervised real capture, Cloudflare owner access, and a staging backup/
migration/rollback release gate remain open. M4 still lacks contact-level and
legacy suppression reconciliation, sender/legal/reply readiness, exact-message
approval, and an outcome loop. A v2 business stop is not proof that legacy
stops or prior sends have been reconciled. No live send is authorized.

Next three concrete actions:

1. Record Riley/Aidan's per-business corrections or dispositions for the ten
   M2 evaluation identities and the current source-use/retention decisions
   needed for a supervised first capture.
2. Build and verify a read-only, snapshot-bound legacy-to-v2 identity,
   suppression, sent, and reply reconciliation report with synthetic fixtures;
   keep unresolved mappings blocked and make no import or outreach decision.
3. Verify actual account/quota/cost and Cloudflare access, prepare a current
   staging backup/restore and rollback gate, then execute one separately
   approved M2 HTML capture and inspect its evidence and cost before the rest.

## Manual owner next-action checkpoint; production goal remains open

**Updated:** 2026-09-22 (America/Toronto). **Verified code commit:** `24c6294`
(`feat(revenue): save manual owner next actions on v2 dossiers`), following
schema commit `6544265`. This is one local M4 owner-workflow slice, not the M4
exit gate. M1's offline dossier remains complete; M2 has **0/10 real engine
assessments**; M3–M7 and production remain incomplete.

An authenticated owner can now save a Riley- or Aidan-assigned next action and
Toronto due time on a current v2 business dossier, then complete or cancel it.
Migration 0071 holds append-only task and terminal-event rows. The API derives
the actor from the session, binds every read/write to the business identity,
requires a same-origin mutation, and checks exact idempotent readback. A lost
POST response can be retried with the same key. Task records are reminders;
they grant no qualification, contact, consent, provider, send, or automation
authority. An unavailable task table leaves the evidence dossier readable and
the task panel explicitly unavailable. See [ADR 0045](adr/0045-keep-owner-next-actions-manual-and-business-scoped.md).

**Verification:** `npm run check:safety`, `npm test -- --test-concurrency=1`
(694 tests: 691 passed, zero failed, three expected Windows skips),
`npm run typecheck`, `npm run lint`, `npm run build:cloudflare`, and
`npx wrangler deploy --env="" --dry-run --autoconfig false` passed. The
separately run `npm run test:owner-ui` passed on the completed build: one
synthetic task survived an accepted-but-lost response and exact retry, open and
terminal states survived reload, anonymous and authenticated cross-site task
requests were rejected, nine WCAG page scans passed, and external requests
were zero. The initial suite refused an uncommitted migration, as designed.
An interrupted subsequent run left the known `other-process` M2 lock marker;
after confirming no owner process, that single marker was removed under
GOTCHAS OPS-012 and the clean full suite passed. No test contacted a prospect.

**Production, automation and spend:** schema 0071 is committed but has not been
applied to staging or production. No deployment, remote migration, provider
activation, inbox operation, or Revenue Engine prospect capture/contact or
outreach occurred in this checkpoint.
Live production state remains unverified. Autonomous switches remain off, the
C$50/month runtime ceiling is unchanged, and incremental engine-provider
spend is C$0. `wrangler whoami` on 2026-09-22 reports an expired local login;
the dry run succeeded without production access.

**Blockers and owner decisions:** the proposed ten businesses still need exact
owner identity/disposition review; Aidan's calling feedback is aggregate and
does not approve them or establish their individual website quality. Current
source-use/retention decisions, a supervised real capture, account/quota and
price evidence, Cloudflare reauthentication, and a staging backup/migration/
rollback gate remain open. M4 still lacks verified contact policy, suppression,
mailbox/reply readiness, exact-message approvals, and the broader CRM outcome
loop. No live send has been authorized.

Next three concrete actions:

1. Record Riley/Aidan corrections or approval for each of the ten proposed M2
   evaluation identities; keep them separate from any calling list.
2. Complete the source-policy/retention and account/cost packet, restore
   Cloudflare owner access, and prepare a backed-up staging migration/rollback
   gate for the schemas actually needed by the next release.
3. Execute one separately gated real M2 HTML capture and assessment, review its
   evidence and cost receipt, then work toward ten dossiers and the fixed
   50-business quality evaluation before external outreach.

## Inert CAD cost admission checkpoint; M2 remains at 0/10

**Updated:** 2026-09-22 (America/Toronto). **Verified code commit:** `16d514a`
(`feat(revenue): add inert CAD cost reservation ledger`). The production goal is
ACTIVE and unfinished. M1's offline owner workflow remains complete; M2 has
zero real engine assessments, and M3–M7 and production remain incomplete.

Migration 0070 and `cost-ledger-d1.ts` now provide a provider-independent D1
reservation/settlement contract in CAD micro-units. A configured Toronto month
combines fixed commitments, settled actuals and unresolved holds under the
C$50 cap. The boundary exposes the C$35 warning and stops discretionary new
cost at C$42.50 or sooner when needed to preserve the essential reserve. An
attempt replay cannot grant another provider call; unknown outcomes retain
their hold; settlement records actual overrun. Direct SQL guards and exact
replay checks are covered by synthetic local tests. See [ADR 0044](adr/0044-reserve-cad-cost-before-provider-attempts.md).

**Verification:** the 11 targeted cost-ledger tests and 21 isolated M2 setup
tests passed. `npm run check:safety`, `npm run typecheck`, `npm run lint`,
`npm run build:cloudflare`, and
`npx wrangler deploy --env="" --dry-run --autoconfig false` passed. The full
suite then passed (686 tests: 683 passed, zero failed, three expected Windows
skips). After it exited, `npm run test:owner-ui` passed on desktop and mobile:
eight WCAG page scans and zero external requests. The first full-suite run was
blocked by an orphaned setup-test lock containing the test-only
`other-process` marker. Root verified the exact file, no active setup/test
process, and no owner PID before removing that one file; the isolated and full
reruns passed and released the lock. No test contacted a prospect.

**Production, automation and spend:** no migration, provider activation,
deployment, inbox operation, prospect capture/contact, or new outreach occurred.
No provider route uses the new ledger; a migration file is not an applied schema.
Live production/account state is unverified. Autonomous switches remain off;
there are no OpenAI keys, Google Workspace seats, or paid mailboxes assumed.
The C$50/month ceiling is unchanged. Incremental engine-provider spend: C$0.

**Blockers and owner decisions:** ten proposed businesses remain an evaluation
cohort, not approved qualified sales opportunities; Aidan reported that most
already have decent sites. Individual owner dispositions, current source rights
and retention, Cloudflare account/browser readiness, exact provider
price/FX/tax and fixed/prepaid commitments, a staging migration/backup/rollback
gate, and one supervised real website-need assessment remain unresolved. The
new boundary alone does not authorize a quote, a paid attempt, or a live job.

An [internal founder calling recap](research/2026-09-22-founder-calling-feedback.md)
adds a separate commercial signal: Aidan reported 18 extension/export call
attempts and no closes, including no-site businesses that did not want more
demand. Follow-up labels and the possible RoofSaver name match need review.
These were not Revenue Engine operations and do not supply an individual M2
identity decision, website assessment, or targeting-policy change.

Next three concrete actions:

1. Record per-business owner corrections on the ten-business evaluation cohort
   and retain website-quality uncertainty until each site is assessed.
2. Verify the specific account/source/cost/storage route and prepare its
   bounded release, staging migration and backup/rollback evidence; do not
   configure the ledger from the planning budget alone.
3. Execute one separately gated real M2 capture and assessment, inspect its
   evidence and cost receipt, then continue toward ten dossiers only from the
   verified path.

## Owner qualification correction; M2 remains incomplete

**Updated:** 2026-09-22 (America/Toronto). Local implementation resumed under
Riley's explicit instruction to return to the engine build. The production goal
is ACTIVE and unfinished.

**Owner feedback:** Aidan reported that most businesses in the calling handoff
already have decent websites. The ten businesses were an identity-researched
evaluation cohort with zero completed engine assessments. Presenting that batch
for a calling day was a manual handoff error; it did not pass through the runtime
qualification path. The aggregate feedback does not establish individual labels
or identity approval for all ten businesses. The earlier handoff receipt remains
historical evidence, not an endorsed sales worklist.

The subsequent code audit found and corrected a separate connected problem:
the owner list counted borderline `REVIEW` records as ready, and available
contacts could appear as manual outreach tasks before qualification. The
projection and list/dossier now distinguish qualified owner review from unmet
qualification criteria, refresh work and blocks. Unknown independence cannot
produce qualified review. Contacts and their evidence remain visible, without
granting an outreach task. Existing scoring policy, thresholds and send authority
are unchanged. Healthy sites remain useful negative evaluation cases.

Two bounded Luna agents handled the projection/read model and list/dossier
respectively; root reviewed the changes, corrected copy and strengthened the
synthetic cases. AGENTS.md, README and ADR 0023 record the distinction between
evaluation cohorts and qualified opportunities. **Verified code checkpoint:
`121601f`** (`fix(revenue): separate qualified leads from research records`).
Verification: `npm run check:safety`, `npm test` (675 tests: 672 passed, zero
failed, three expected Windows skips), `npm run typecheck`, `npm run lint`,
`npm run build:cloudflare`, and
`npx wrangler deploy --env="" --dry-run --autoconfig false` passed. After all
builds and the full suite exited, `npm run test:owner-ui` passed on desktop and
mobile with eight WCAG page scans and zero external requests. Its synthetic
strong-lead fixture now satisfies the existing evidence-confidence gate; the
browser failure before that correction exposed a `REVIEW` snapshot, not a
broken UI policy. The initial full-suite failure was caused by an orphaned M2
test lock from an interrupted process. Root checked the lock's recorded PID,
exact token and absence of active setup/test processes before removing that
one lock; the clean rerun passed. Scratch logs and fixtures were not committed.

**Production and spend:** no deployment, migration, provider activation, prospect
capture or contact, inbox operation, or new Slack message occurred in this work.
Live production/account state remains unverified. Source automation defaults
remain off; zero paid mailboxes, no Workspace, unprovisioned API access and the
C$50/month ceiling remain unchanged. Incremental engine-provider spend: C$0.
Wrangler's saved login is expired (`npx wrangler whoami` failed read-only), so
the configured Cloudflare browser binding does not prove live browser access.

**Remaining blocker and owner decisions:** M2 has zero real engine assessments;
M3 has not started. The exact-ten identity decision and subsequent source-policy,
retention, capture and local release gates remain unresolved. The bounded HTML
path proves availability/HTTPS facts, not visual or mobile website quality; its
research-only assessment cannot substitute for demonstrated rebuild need.

Next three concrete actions:

1. Record individual owner dispositions on the saved ten-business **evaluation**
   cohort, including corrections from Aidan's site-quality feedback; do not
   infer approval or sales readiness from the aggregate comment.
2. Renew the user-owned Cloudflare login and resolve source-policy, retention,
   browser execution/storage and cost authorization for the first supervised
   real site; no real capture occurs by implication from this checkpoint.
3. Execute and inspect a gated real M2 browser evidence/assessment path, then
   require a supported website-need decision before any sales handoff. Continue
   M3-M7 only from verified outputs and their separate release gates.

## Historical: M2 public research and calling handoff

**Updated:** 2026-09-22 (America/Toronto). **Goal state:** BLOCKED.
**Verified code:** `56c7410`; full verification record: `e55ea5f`.
**Research checkpoint:** `ebaad1d`.
**Internal handoff (September 22):** Riley explicitly requested the ten-business
list and current circumstances be sent to Aidan in Slack for his manual calling
today. The DM was sent and read back successfully: all ten businesses, nine
officially published business numbers, source links, limitations and the pending
identity-review request were present. Delta's number was not verified and was
marked unavailable. Two bounded Luna lookups plus root verification used zero
searches and 14 official-page interactions for this separate, user-requested
handoff. Concise phone evidence and the exact message/delivery receipt are saved
privately in `data/kw-evaluation/m2-aidan-slack-handoff-2026-09-22.json` and `.md`.
Aidan's reading, approval and call outcomes are not yet confirmed. This internal
message is not an owner identity decision, completed assessment or permission
for automated outreach. No prospect was contacted by Codex; engine-provider
spend was C$0. Runtime code, production state and the next three build actions
below are unchanged. Documentation-only diff checks passed; code tests were
not repeated for the handoff.

Riley's contextual "Continue" approved the prepared C$0 research scope and
resumed the production goal. The research is complete: **20 businesses
considered, ten proposed identities prepared, zero completed engine
assessments**. M2 remains incomplete; M3 has not started. The previous research
decision blocker below is historical and is superseded by this checkpoint.

The pending exact-ten identity review has now persisted across three consecutive
goal turns: the research checkpoint that presented the actual candidates, then
two automatic continuations. The previous continuation was no progress toward
the build: root and a bounded Luna audit confirmed that necessary offline
preparation was already complete, without changing the next action. The current
audit rechecked the saved review/input/plan hashes and confirmed unchanged
PENDING owner review and disabled authority. There is no live job to wait for.
The goal is now BLOCKED to stop repeated automatic checks; its full production
objective is unchanged and unfinished. Resume after the pending owner decision.
No additional research, code change, test run, provider operation or spend was
performed by these blocker checks. Current production state remains unverified;
the existing source defaults and release gates still apply.

The ten proposed businesses cover Kitchener (3), Waterloo (3), Cambridge (4),
roofing (3), HVAC (5), and landscaping (2). They meet the minimum of two per
city and niche and cover eight of nine preferred city/niche combinations;
Waterloo landscaping remains absent. Identity, location, niche and ownership
claims retain source URLs, observation times, method, confidence, uncertainty
and audit version. Ownership is company-reported, not registry verification;
website/rebuild need is NOT_ASSESSED. Eight proposed identities have high
research confidence and two have medium confidence because their official
sites state a city base without an established street address.

Three bounded Luna agents gathered city research. Root verified the selected
official sources, corrected two service-area assignments to Cambridge business
locations, resolved one weak ownership claim using a company article, and
retained ambiguous or inaccessible candidates as unresolved. One agent
considered eight candidates against a six-candidate allocation; root stopped
that branch and charged the extra two against reserved capacity. Another
branch omitted a failed-fetch candidate from its reported list; root restored
it to the count. Final usage stayed within the approved overall scope:
**12 search queries, 45 page opens (including unsuccessful and find/click
operations), 20 distinct candidates, C$0 engine-provider spend**. No further
searches or candidates are authorized by the exhausted initial research scope.

Saved private artifacts (ignored local files, not committed business data):

- Owner review: `data/kw-evaluation/m2-public-research-2026-09-22-review.md`
  and the corresponding `-review.json`; ten selected and ten unselected with
  reasons. The exact list has been presented for owner review; the decision is
  PENDING, and no owner-approved selection or manifest has been fabricated.
- Import input and prepared plan: the same prefix with `-input.json` and
  `-plan.json`. The existing `kw:prepare-import` command completed successfully.
  All ten businesses remain RESEARCH_ONLY with no contact data. The importer's
  "40 remaining", `balanced: false` and `readyForAudit: false` describe the
  later 50-business evaluation target, not a failed ten-business M2 coverage
  check. Its guards were not changed.
- Root source corrections and accounting: `-root.json`; city originals remain
  separate. `-validation.json` records file hashes, the offline result and the
  exact business/source IDs for a future reviewed selection.

The canonical source-plan digest is
`02308340af2f467592a99d925d7cf09053729572abecbf7830f62d8a63461ade`.
The saved review JSON file SHA-256 is
`4bf0d8c942ee253dcc4dfe965390f53f351373506e8846f4596cbde0c8a9e70c`.
Retention review is due October 22, 2026; this is a review date, not permission
for automatic deletion. These files are local to the active production
worktree; a Git clone alone will not contain the private evidence.

Current verification: the existing input/plan schemas passed; deterministic
re-preparation exactly matched the saved plan; report and per-candidate claim
digests matched; ten unique business IDs/domains, source fields, coverage and
disabled authority were checked by offline readback. Root reviewed the readable
table against the JSON. No runtime code changed, so the prior 670-test result
(667 passed, zero failed, three expected Windows skips), safety, typecheck,
lint, Cloudflare build and dry run remain the code evidence and were not
repeated for these research/documentation changes. No fresh UI acceptance or
production verification is claimed.

No engine website capture, raw HTML retention, database setup/migration,
assessment writes, inbox operation, outreach, deployment, provider activation
or engine-provider spend occurred. Live production/account state was not
refreshed. Source automation remains off; zero paid mailboxes, no Workspace,
unprovisioned API access and the C$50/month ceiling remain unchanged. ADR 0032
requires Riley's or Aidan's explicit review of the actual identities before
the exact-ten manifest. Later capture, source-policy/retention and local
release gates remain separate.

Next three concrete actions:

1. Record the owner's decision on the saved exact-ten review, applying any
   corrections without inventing approval or relaxing coverage.
2. Prepare the content-bound manifest and current pending capture packet from
   the approved identities and explicit source-policy/retention decisions.
3. Complete the first supervised capture, local setup and assessment under
   their existing approval/release gates, then produce real owner dossiers.

## Historical: M2 blocked on the prepared public-research decision

**Updated:** 2026-09-22 (America/Toronto). **Goal state:** BLOCKED.
**Verified code:** `56c7410`; verification record: `e55ea5f`.
The previous goal turn made progress by completing and committing the capture
command. A bounded Luna audit and root review found no further necessary M2
implementation work before obtaining the real source records. The same pending
research decision was confirmed in three consecutive goal turns, beginning with
the question issued on September 21 at 23:07 Eastern. Automatic continuation is
blocked at that decision; the full production objective remains unfinished.

The [prepared C$0 scope](reviews/2026-09-21-m2-public-research-scope.md) still has
no owner answer. ADR 0032 explicitly requires the separate private research
decision before populating the ten real reviewed records. No approval is inferred
from elapsed time, the production goal, or successful synthetic tests. M2 still
has zero real businesses evaluated; M3 has not started. No production/account
inspection, research, capture, migration, deployment, provider activation,
outreach or engine-provider spend occurred in this audit. The C$50/month ceiling,
zero-paid-mailbox decision and automation-off source configuration remain.

This is a documentation-only blocker record. The verified tests/build/dry run
below remain the evidence for unchanged code; they were not repeated. Resume
after the pending scope decision, then complete these three actions:

1. Perform the approved bounded public research and present ten actual candidates.
2. Obtain identity/source-policy review and prepare the exact manifest and packet.
3. Complete the first supervised capture and local assessment after their existing
   approval and release gates.

## M2 one-request HTML capture command

**Updated:** 2026-09-21 (America/Toronto). **Verified code checkpoint:** `56c7410`
(`feat(revenue): add bounded M2 HTML capture command`), based on `d482fc2`.
The capture command is implemented and all required checks passed. This
documentation checkpoint records its saved identity. The prior checkpoint
verified current policy inputs.
M2 remains incomplete: **zero real businesses evaluated; M3 has not started**.

`npm run kw:capture-m2-html -- <request.json>` provides one operator invocation
over the existing HTML evidence workflow. Default preflight checks the exact
saved request and reports pending or ready inputs. Explicit `--execute` requires
the current approved chain, rechecks it under an exclusive local capture lock,
and uses the existing native transport and immutable evidence stores. `--verify`
calls durable reload directly. A completed exact replay makes zero new requests;
the output separates current attempts from recorded historical requests.

Eight focused tests passed. They cover pending/approved preflight, rejected
future/expired/forged/mismatched/non-NEW execution, lock ownership, exact replay,
and unsuccessful CLI exit for failed capture. Synthetic evidence saved through
the native stores was reloaded in a fresh process with DNS, sockets, HTTP and
fetch disabled; request bytes, receipt identity and historical counts survived.
Synthetic native evidence remains in ignored storage. No real website was used
as a test. Luna supplied the implementation/test draft and an independent review;
root corrected current-request counting, lock cleanup, and integrated the CLI.

Full verification passed: **670 tests, 667 passed, zero failures, three expected
Windows symlink-privilege skips; 585.2 seconds**. The final eight focused tests,
safety configuration, TypeScript, lint, Cloudflare build and deployment dry run
also passed. The build scanned 2,022 files with zero local secret values. The
dry run retained autonomous intake/queue/send off and zero sending caps. No
browser UI code changed; no new browser acceptance result is claimed for this
command.

No real research/capture, production deployment, migration, inbox operation,
outreach, provider activation or engine-provider spend occurred. Production and
account state was not refreshed. Runtime automation remains off in source; the
C$50/month ceiling and zero-paid-mailbox decision remain unchanged. The
[public-research scope](reviews/2026-09-21-m2-public-research-scope.md) is still
pending the owner decision required by ADR 0032. Capture, local setup and
assessment retain their separate existing gates. The production goal is active.

Next three actions:

1. Obtain the pending research-scope decision, then inspect the bounded public
   sources and present the actual ten candidates for owner identity review.
2. Prepare the current exact-ten manifest and capture packet from those reviewed
   identities and explicit source-policy/retention decisions.
3. Use the new command for the first supervised capture after its exact approval,
   then complete the separately gated local setup and assessment workflow.

## M2 real-research preparation and current policy inputs

**Updated:** 2026-09-21 (America/Toronto). **Verified code checkpoint:** `44b58ae`
(`fix(revenue): require explicit current M2 policy inputs`), based on `d73df1e`.
All required checks passed; this documentation commit records the saved identity.
The previous goal turn made progress by committing the durable local console.
M2 is still incomplete: zero real businesses evaluated; M3 has not started.

The active checkout's evaluation inventory contains only synthetic/test source
chains. No real exact-ten source plan or owner-reviewed manifest was found.
The [bounded public-research scope](reviews/2026-09-21-m2-public-research-scope.md)
is prepared and awaiting the separate owner decision required by ADR 0032:
up to 20 candidate businesses, 12 searches and 60 page opens, C$0, organization
facts only, across the three cities and niches. No real research ran this cycle.

Luna's bounded audit found that authorization preparation still hardcoded a
September 3 review and September 10 expiry. The repair replaces those dates and
synthetic source-policy defaults with a required strict `--review-policy`
input: explicit current dates and exactly ten per-business decisions. Pending
outputs and the fixture-only mapping remain distinct from owner approval and
the actual assessment policy. Root owns review, integration and verification.

Focused preparation tests passed, including missing/malformed/foreign policy
decisions, future preparation, expired authorization/retention and invalid
clock rejection with no output files. Saved outputs retain every explicit
per-business decision, dates, request cap and pending approval linkage.
Safety, TypeScript, lint, Cloudflare build (2,022 files, zero secret values) and
deployment dry run passed. The first full suite reported 645 passed, 14 shared
setup-lock failures and three expected Windows skips. That run exited and the
canonical lock was confirmed absent before the fresh full run. The cause of
that contention is unproven; production locking was not changed. The fresh
full suite passed: **662 tests, 659 passed, zero failures, three expected Windows
symlink-privilege skips; 585.0 seconds**. No UI code changed; the previous checkpoint's
browser evidence is historical, not a fresh browser run for this repair.

No deployment, real capture, migration, inbox operation, outreach, provider
activation or spend occurred. Production and account state was not refreshed;
runtime defaults remain off, with no release or activation inferred. The
C$50/month ceiling and zero paid mailbox decision remain unchanged. The public
research question is pending; capture, setup and assessment gates are separate.

Next three actions:

1. Obtain the decision on the prepared research scope, then gather the bounded
   source evidence and present the actual ten candidates for owner review.
2. Use the reviewed identities and explicit rights/retention decisions to
   prepare a current exact-ten manifest and pending capture packet.
3. Prepare the first business's bounded capture invocation and local database
   release packet; execute only after their applicable owner/release gates.

## M2 durable partial capture and local research console

**Updated:** 2026-09-21 (America/Toronto). **Verified code checkpoint:** `ce13dd7`
(`feat(revenue): add durable local M2 research console`), based on `2d27e2f`.
All required checks passed. This following documentation commit records the
verified identity. M2 remains incomplete and M3 has not started.

Supported selected-page HTTP/transport failures now have strict v2 PARTIAL
receipts. Failed pages carry exact transport witnesses and no content/facts;
replay rejects altered witnesses and missing homepage/audit proof. A new
admin-only local research console derives its view from the actual assessment
runner's read-only INSPECT mode. It lists saved assessments, research reviews,
policy blocks and unfinished work, with page evidence and a next review step.
The bridge is disabled by default and in Cloudflare binding contexts. Inspection
never approves assessments, publishes missing reports or changes database rows.
It derives all ten entries from native saved evidence in a fresh CLI process.

Integration exposed concrete issues beyond the in-memory fixtures:
the native store's input schema omitted HTTP status/redirect metadata that its
stored schema already supported; policy-denial receipts incorrectly required an
allowed policy; and the console imported native filesystem code through a shared
digest helper. The fixes preserve stored formats and digest semantics. Denial
receipts still require the exact current approval chain and complete transport
witness, and cannot retain page content. Storage tests now use unique UUID
directories and bounded cleanup; they no longer delete the default evidence root.

The longer browser workflow reproduced a truncated development layout chunk
after warmup (327,680 bytes, an exact prefix of the 3,138,186-byte file). Owner
acceptance now serves the completed production build with `next start` and keeps
the existing streaming regression. It checks actual unauthenticated redirection
and absence of business data, then signs the promoted fixture owner in again to
avoid its stale signup role. Upload selectors target the visible enabled control.
Uncaught browser errors remain failures.

Production-mode owner acceptance passed: **list 378 ms, dossier 87 ms, M2 review
4,617 ms; widths 1440/390; eight WCAG views; zero external requests**. The test
proved five saved assessments, three research reviews (including a partial page)
and two policy blocks, all with source links and next steps. M2 database bytes and
identity stayed unchanged across review. Screenshots are retained at
`output/playwright/m2-review-desktop.png` and `m2-review-mobile.png`.

Safety, TypeScript, lint, the Cloudflare build (2,022 files, zero local secret
values) and deployment dry run (no upload, autonomy false/zero) passed. The first
full suite had 662 tests: 657 passed, two stale test assertions failed, and three
Windows symlink-privilege skips. Both assertions were corrected; the focused
rerun passed all 11 tests. The final full suite passed: **662 tests, 659 passed,
zero failures, three expected Windows symlink-privilege skips; 589.1 seconds**.
Focused PARTIAL tests passed 28, native storage 26 plus one expected Windows skip,
and the bridge default-deny/path-boundary test passed.

No production/staging inspection, real migration/capture, paid provider operation,
deployment, outreach or spend occurred. Runtime automation is off or unverified.
The C$50/month ceiling and zero paid mailboxes remain unchanged. No owner decision
is needed for this local checkpoint. Real capture/setup/assessment packets
remain unapproved. Luna owns bounded repairs; root owns integration and final checks.

The next three concrete actions are:

1. Prepare the exact real one-business capture, setup and assessment review packet
   using the saved console workflow and current source/retention evidence.
2. After its separate approval, execute and review that one business, then prepare
   the remaining businesses in the exact-ten evaluation with measured owner time.
3. Complete M2's real evidence gate before starting M3's labelled quality gate.
   Synthetic software proof counts as zero real evaluated businesses.

## M2 research-only and blocked outcome integration

**Updated:** 2026-09-21 (America/Toronto). **Verified code checkpoint:** `b32e7a6`
(`feat(revenue): integrate research-only M2 terminal outcomes`), based on
`181a95e`. This following documentation commit records the verified identity.
This checkpoint extends the actual local HTML assessment runner, with Luna
implementing bounded synthetic fixtures and the research-report projection;
root owns the shared parser, ordered integration, review and final verification.
M2 remains incomplete and M3 has not started.

Sealed `RESEARCH_REQUIRED` captures now produce a deterministic private report
showing source lineage, selected/missing pages and HTML limitations. They remain
`UNKNOWN`, with zero scores, no channels/contact/consent authority, no assessment
approval and no database/progress rows. Robots/terms and retention blocks reload
their existing sealed witnesses and return `BLOCKED`, without new output files.
Both can precede the next complete assessment in the recorded business order.
The complete path still requires its separate owner decision and transaction.

Before report publication, the runner independently reloads the source/capture
on a reopened read-only database and compares the full database with its expected
state. Reports are immutable canonical outputs. Missing reports can be rebuilt
from evidence; altered reports cannot supply their own proof or be overwritten.
An earlier research report can be verified after later approved assessments.

Root review identified that Task 4 deliberately leaves failed-subpage `PARTIAL`
captures unsealed. Failed homepages are also unsealed. Their actual reload fails
with `M2_WEBSITE_RECEIPT_REPLAY_MISSING`; this checkpoint preserves that explicit
no-output failure. The pure partial-report shape is not proof of a saved partial
workflow. Durable failure witnesses remain unfinished, as do the M2 console and
the exact-ten owner workflow. No Task 4 production behavior or schema changed.

Required verification passed for this checkpoint. Safety,
TypeScript, lint, Cloudflare build (2,018 scanned files, zero local secret values),
deployment dry run (no upload, automation false/zero) and owner UI acceptance
passed. Browser acceptance measured 479 ms for the list and 871 ms for the
dossier, widths 1440/390, six WCAG pages and zero external requests. The first
full suite had 654 tests: 650 passed, one M1 interruption chronology failure and
three Windows symlink-privilege skips. Root fixed the M1 synthetic fixture's
five-second wall-clock race by giving its owned SQLite connection and fixture
one fixed clock, including lease comparisons. Production chronology validation
is unchanged. The fixed-date fixture failed without the database clock alignment
and all six interruption stages passed with it. The final full suite passed:
**654 total, 651 passed, zero failed, three Windows symlink-privilege skips;
640.9 seconds**. TypeScript and targeted lint also passed after the fixture
correction. The mixed
real-file test exercises research reports with both retention modes, two policy
blocks, a later complete assessment, evidence loss before publication, tampered
and missing reports, historical replay and rejection of unsealed partial capture.
The initial run caught predecessor ordering and fresh-approval timestamp issues;
both were corrected before the verification pass.

No production/staging inspection, real migration, website request, provider call,
deployment, outreach or spend occurred. Automation remains off or unverified.
The C$50/month ceiling, zero paid mailboxes and no assumed API credentials remain
unchanged. No owner decision is needed for the next local implementation work.

The next three concrete actions are:

1. Complete saved failure evidence for partial captures, preserving exact replay
   and the no-assessment/no-contact boundary.
2. Integrate complete, research and blocked outcomes into the dedicated M2 owner
   console and complete the exact-ten orchestration acceptance packet.
3. Prepare the real one-then-ten evaluation packets for their separate review;
   no real setup, assessment or capture packet is approved yet.

## Owner browser streaming gate repair

**Updated:** 2026-09-21 (America/Toronto). **Code checkpoint:** `878d0ff`
(`fix(test): finish route compilation before browser warmup`), based on
`76766b5`. This following documentation update records that verified identity.
The previous turn made concrete
progress by committing the M2 assessment runner and capturing the browser error.
This cycle resolves that demonstrated verification blocker; M2 is still incomplete.

The failure was reproduced with an external Node filesystem/HTTP probe, outside
the repository. Next opened the 3,138,186-byte development layout chunk, Webpack
rewrote the same inode during the read, and the stream ended after 1,179,648 bytes.
The gzip response completed with HTTP 200 and no Content-Length, and Chromium's
captured failing source contained that exact prefix. Evidence is retained at
`output/playwright/owner-ui-27084-1790036664887`, including stream trace and source.
The initial in-repository probe showed additional rebuilds and was discarded as
a confounded experiment; only the external probe established the diagnosis.

Owner acceptance now finishes authenticated HTTP preparation of all three owner
routes before a browser reads their chunks, then waits for each browser warmup's
`load` event before opening the next route. The full corrected trace has four
layout rewrites before any browser read, followed by eight complete reads with
no overlap. Its summary and trace are retained at
`output/playwright/owner-ui-streaming-evidence-20260921`.

Root diagnosed and integrated the correction. Luna implemented the bounded
loopback streaming regression, which runs the real warmup function against SSR
headings and delayed async scripts. The old warmup failed on two premature
navigations; omitting HTTP preparation separately failed the first-script gate.
The corrected combined warmup passed. Root corrected map types, removed an
unnecessary delay and hardened cleanup. The regression now runs inside every
owner UI acceptance invocation. Runtime app code, provider behavior and browser
error gates are unchanged; this is a correction to test preparation.

| Required check | Current result |
|---|---|
| Safety, TypeScript, lint | PASS |
| Focused browser-diagnostic unit tests | PASS, 8 tests |
| Streaming regression | Proven failing before / passing after |
| Full test suite | PASS, 644 total, 641 passed, 0 failed, 3 Windows symlink-privilege skips; 537.8 seconds |
| Cloudflare build | PASS, 2,018 files scanned, 0 local secret values |
| Wrangler deployment dry run | PASS, no upload; autonomy variables false/zero |
| Owner UI acceptance | Final uninstrumented PASS, list 395 ms, dossier 865 ms, widths 1440/390, 6 WCAG pages, 0 external requests; earlier instrumented PASS proved complete chunk reads |

No production/staging inspection, real migration, provider request, deployment,
outreach or spend occurred. Automation remains off or unverified. C$50/month and
zero paid mailboxes remain the limits. M3 has not started. The M2 COMPLETE
assessment workflow remains at `6aaf216`; partial/research-required terminal
outcomes, dedicated M2 console integration and exact-ten orchestration remain.

The next three actions are:

1. Complete partial/research-required HTML terminal outcomes and the dedicated
   M2 owner console view without inventing qualification from incomplete evidence.
2. Complete exact-ten orchestration and retain a synthetic packet covering
   complete, research-only and blocked outcomes.
3. Prepare the real one-then-ten evaluation packets for their separate review;
   no real setup, assessment or capture packet is approved yet.

## Previous assessment checkpoint

## M2 complete-capture assessment workflow

**Updated:** 2026-09-21 (America/Toronto). **Code checkpoint:** `6aaf216`
(`feat(revenue): persist local HTML assessment checkpoints`), based on
`20ab6a6`. Assessment verification passed; the owner-browser gate remains open.
This following documentation update records the committed checkpoint identity.
The previous code checkpoint is `52f9009`.

The local COMPLETE HTML path now connects actual recorded source rows, Task 4
receipt/artifact reload, a separate owner assessment decision, one transactional
canonical write, immutable lineage, progress and an owner JSON dossier.
`npm run kw:assess-m2-html` defaults to preparing the decision. Execution never
approves itself. Source rows reload on both sides of HTML evidence reload;
evidence reauthenticates immediately before writing and after database reopen.

The successor runner implements ADR 0043: reconstruct the full expected state
in memory from the immutable backup, exact approved migration and authenticated
completed assessments, then compare every table, including legacy/non-Revenue
data. It rejects incomplete or unrelated changes. An exact replay leaves the
database bytes unchanged. Missing post-commit progress/report files can be
regenerated only after durable reconstruction; conflicts are never overwritten.
The progress seed binds the previous checkpoint and every assessment row digest.

Setup now emits a v3 receipt with a trusted completion timestamp after successful
migration, reopen and restore proof. Historical assessment verification requires
that timed receipt and checks setup/assessment approvals at their recorded times.
Later expiry permits historical verification but cannot authorize a fresh write.
The initial setup verifier retains strict v2 support and exact baseline hashes;
it does not infer a timestamp or accept successor drift. No schema changed.

The owner projection exposes page facts, provenance, retained evidence references
and HTML limitations. It forces UNKNOWN/non-qualifying classification, RESEARCH,
zero scores, no routes/channels, and NOT_RECORDED/UNASSESSED contact review. This
is a private JSON dossier; the ordinary owner console still excludes M2 rows.

Root owns the runner, integration tests and final verification. Luna supplied
the bounded source reloader, Task 4 fixture, timed receipt contract and owner
projection, and reviewed the combined boundary. Review found and corrected
second-business selection, fixture type errors, missing snapshot evidence refs,
mixed retention acceptance and missing final evidence reloads. Targeted acceptance
now passes first write, exact replay, second business, fresh-process restart,
expired historical proof, pre-write evidence loss, post-commit evidence loss,
transaction rollback and interrupted output recovery. These tests use real local
setup/assessment runners with synthetic data and fake Task 4 stores.

| Required check | Current result |
|---|---|
| Safety, TypeScript, lint | PASS |
| Full test suite | PASS, 644 total, 641 passed, 0 failed, 3 Windows symlink-privilege skips; 555.5 seconds |
| Cloudflare build | PASS, 2,018 files scanned, 0 local secret values |
| Wrangler deployment dry run | PASS, no upload; autonomy variables remain false/zero |
| Owner UI acceptance | FAIL, intermittent truncated development chunk; one diagnostic repeat passed, the next reproduced and captured the failure |

This checkpoint saves the local assessment workflow and browser investigation;
it does not complete M2 or establish release readiness. The browser error also
occurred after all builds/dry runs exited and after fresh `.next` cleanup, so
concurrent builds are not a sufficient explanation. Chromium attribution captured
`/_next/static/chunks/app/layout.js`: 1,179,648 bytes, an exact prefix of the
complete 3,138,186-byte generated file, ending inside a string. The retained
artifact is `output/playwright/owner-ui-9236-1790035521594` (captured scripts use
`.js.txt` so malformed evidence is not linted as source). New diagnostics retain
the failing script, location and event-time stage while preserving the existing
console/page-error failure gates.

A separate loopback experiment reproduced the empty-stack SyntaxError when the
server ended a response normally at that incomplete prefix. Simple navigation
cancellation did not reproduce it. The reason Next delivered the short script
is not yet proven; a later passing run does not resolve this blocker. No runtime
or navigation workaround has been applied. The next browser investigation is
response completion/length and development chunk replacement timing.
Local Next source inspection found `serve-static.js` delegates to a file stream,
and enabled compression removes Content-Length. A file change between stat and
streaming could therefore produce a clean short response, but the actual rewrite
has not been observed. Capture Content-Encoding/Content-Length, stream completion
and chunk size/mtime together before changing delivery behavior.

The abandoned test lock named PID 37128. A live process inventory proved that
owner absent; the exact lock was preserved as
`data/kw-evaluation/.m2-0069-setup.lock.stale-37128-20260921233432` before continuing.
Setup and assessment acceptance are registered in one test file so the full
suite does not create artificial contention on their shared operation lock.

No real setup/assessment approval, real migration, prospect request, provider
action, deployment, email or paid spend occurred. Production/staging were not
inspected; automation remains off or unverified. C$50/month and zero paid
mailboxes remain the limits. M2 remains incomplete; M3 has not started.
The retained M1 fresh4 database, website checkpoint and owner report SHA-256
values still match the prior verified checkpoint.

The next three actions are:

1. Resolve the captured owner-UI truncated-response failure and repeat the
   isolated browser gate with retained attribution if it fails.
2. Complete the website-only review branch for partial/research-required HTML
   results and integrate the dedicated M2 owner view into the console.
3. Complete exact-ten orchestration and retain a synthetic evaluation packet,
   including research-only/blocked outcomes, before preparing the separately
   approved real one-then-ten evaluation; no real packet is approved yet.

## Prior legacy/M2 reader compatibility checkpoint

**Updated:** 2026-09-21 (America/Toronto). **Work cycle:** M2 Task 5 legacy/M2
reader compatibility. The verified code checkpoint is `52f9009`
(`fix(revenue): isolate HTML evidence from legacy assessments`), based on
`0e5558d`. This following update only records that checkpoint identity.

## M2 assessment partition compatibility checkpoint

Ordinary owner readers now inspect the actual schema before selecting evidence.
Pre-0069 databases retain their existing behavior. On 0069, website and
qualification selection, contact routes, verification, history and contact
review use explicit legacy partitions. Partial or malformed metadata and
introspection failures stop the read; there is no error-to-legacy fallback.

The legacy assessment writer/reloader now includes partition values in exact
row comparisons and explicitly writes `LEGACY` on 0069. Collision queries
remain broad: an M2 row with a matching ID or alternate key is a conflict, not
a missing record. Regression tests first reproduced acceptance of mislabeled
rows and partial schema; both now reject without writes. Tests retain old
0061 fixtures and exercise both 0068 and 0069 commit/replay/reload.

Root implemented the assessment boundary and reviewed Luna's bounded owner-reader
changes. The first reader patch was rejected for unqualified SQL aliases and
missing real-database coverage. Luna corrected the predicates; root added the
complete in-memory SQLite integration regression. It proves an existing dossier
is unchanged after newer HTML website, qualification, contact and verification
rows arrive; HTML-only businesses are excluded; history remains unchanged;
metadata errors propagate; and reads leave the database bytes unchanged.
These constructed projection fixtures do not claim an implemented M2 writer.

[ADR 0043](adr/0043-separate-setup-baseline-from-assessment-state.md) resolves
the Task 5 design conflict between initial setup hashes and legitimate writes.
The initial verifier remains strict. The planned successor verifier will compare
the full database against the verified backup, exact migration and authenticated
deterministic assessment plans. This is an accepted design, not an implemented
successor runner. Task 5's local design F6 now reflects that distinction.

| Check | Result |
|---|---|
| Targeted assessment and reader regressions | PASS, including actual 0068/0069 SQLite reader execution |
| `npm run check:safety` | PASS |
| `npm test` | PASS, 627 total, 624 passed, 0 failed, 3 Windows symlink-privilege skips |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |
| `npm run build:cloudflare` | PASS, 2,018 files scanned, 0 local secret values |
| Wrangler deployment dry run | PASS, no upload |
| `npm run test:owner-ui` | Isolated repeat PASS, list 377 ms, dossier 484 ms, widths 1440/390, 6 WCAG pages, 0 external requests |

The initial full suite had 13 failures because the older assessment-progress
fake boundary returned no schema metadata. That fixture now explicitly describes
its legacy columns; all 13 affected tests pass. No production fallback was added.

The first UI attempt recorded one `SyntaxError: Invalid or unexpected token`
during `/leads` warmup, with no script URL or stack. Its server requests returned
200 and both builds had already exited, so build overlap is not established as
the cause. Failure evidence remains in
`output/playwright/owner-ui-4512-1790031568836`. One isolated repeat after the full
suite exited passed without browser errors. No UI code or acceptance assertion
was weakened. The intermittent warmup error is unresolved; if it recurs, capture
the failing asset before claiming a cause. It is not evidence of a live release.

No real setup release, migration, prospect request, provider action, deployment,
email or paid spend occurred. Production/staging were not inspected or changed;
automation remains off or unverified. C$50/month and zero paid mailboxes remain
the limits. The retained M1 fresh4 database/checkpoint/report hashes still match.

The next three concrete actions are:

1. Implement Task 5's real HTML assessment plan/writer with double source reload
   and the accepted baseline/successor checks; verify first write, replay,
   second business, restart and unauthorized drift.
2. Complete the dedicated HTML owner projection and exact-ten orchestration
   against synthetic receipt-backed fixtures.
3. Prepare the exact real candidate/owner packet and setup release for the
   supervised one-then-ten gate. M2 remains incomplete; M3 has not started.

## Prior M2 local setup runner checkpoint (`d19e344`)

The local runner now applies exactly migration 0069 in one immediate transaction,
compares the complete result with an independently migrated in-memory backup,
reopens the database, repeats the restore drill and publishes the v2 setup
receipt last. The receipt includes typed logical preservation proof and exact
physical identities. Verification and replay reload current artifacts rather
than trusting a caller-supplied success object.

`npm run kw:prepare-m2-database` defaults to preflight. `--apply` requires the
recorded current setup release. `--verify` reloads the exact setup proof.
`--rollback` requires a separate recorded owner decision for the inspected
suspect, backup, quarantine and rollback receipt. No command grants itself
approval. See the [runbook](RUNBOOK.md#m2-local-database-setup-and-recovery) and
[ADR 0042](adr/0042-transactional-local-setup-and-approved-recovery.md).

Root implemented and integrated the runner. Luna implemented only the bounded
receipt/rollback contract and its tests; another Luna reviewed the combined
diff. Root strengthened recovery after the review identified a missing-source
interruption. Tests force failures after quarantine publication, after source
removal and before rollback receipt publication; each resumes from verified
evidence under the separately approved rollback. The original required-source
preflight failed the missing-path regression before the recovery rule passed.

A failure before commit verifies the original source bytes and rows. A failure
after commit intentionally remains unreceipted, keeps source and backup, and
requires the separate recovery decision. It never infers setup success or
automatically restores without approval. The recovery review's concern about
unverified restored contents was checked against `buildReceipt`: it compares
the complete restored logical snapshot to the approved backup and verifies
quarantine identity before publication. No extra authority follows from merely
finding a quarantine file.

| Check | Result |
|---|---|
| Focused integration suite | PASS — 21 passed, 1 Windows symlink skip |
| Added recovery/post-commit cases | PASS — 4 passed; missing-source regression also observed failing before recovery fix |
| `npm run check:safety` | PASS |
| `npm test` | PASS — 619 total, 616 passed, 0 failed, 3 Windows symlink-privilege skips |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS — no warnings |
| `npm run build:cloudflare` | PASS — 2,018 files scanned, 0 local secret values |
| `npx wrangler deploy --env="" --dry-run --autoconfig false` | PASS — no upload; generated duplicate-options warnings nonblocking |
| `npm run test:owner-ui` | PASS — list 400 ms, dossier 881 ms; widths 1440/390; 6 WCAG pages; 0 external requests |

The real CLI is exercised by the synthetic setup/replay test. No deploy, build
or dry run was active when the owner UI test started. M1 fresh4 database,
website-checkpoint and report hashes still match the retained verification.

All execution in this cycle used synthetic local fixtures. No real owner setup
release or persistent real M2 setup receipt was created; no real migration,
prospect request, provider action, deployment, email or paid spend occurred.
Production and staging were not inspected. Automation remains off or unverified.
Runtime remains capped at C$50/month, paid mailboxes and Workspace remain out
of scope, and the rebuilt M1 fresh4 checkpoint remains the retained M1 evidence.

The next three concrete actions are:

1. Correct Task 5's setup-baseline/write-replay interface, then implement its
   double source-materialization preflight and legacy/M2 reader compatibility.
2. Complete the HTML-only assessment writer/replay and Task 6's exact-ten
   orchestration against synthetic receipt-backed fixtures.
3. Prepare the exact real candidate/owner packet and setup release for the
   separate supervised one-then-ten gate. M2 is not complete; M3 has not started.

The handoff audit found a concrete Task 5 plan defect: its current design checks
the immutable setup file SHA before and after legitimate assessment writes,
which necessarily change that file. Its domain-row replay rules do not resolve
the conflict. The unchanged setup baseline must remain a strict initial gate;
later authorized writes need their own independently verified durable-state
checks. Resolve this interface before Task 5 execution rather than weakening
the setup verifier or treating legitimate writes as forgery.

## Prior M2 backup and restore-drill checkpoint (`42eebd3`)

The bounded backup function now requires a live canonical preflight session
and holds the cooperative lock handle for its entire operation. It rereads
approval and source identity, backs up a read-only SQLite snapshot, publishes
without overwriting a conflicting target, and restores into a separate private
temporary directory for independent verification. CLI behavior remains
preflight-only. This completes the synthetic backup/drill prerequisite, not
Task 8, M2, a real setup release, or migration 0069.

[ADR 0041](adr/0041-verify-local-backups-by-logical-snapshot.md) records the
verified SQLite behavior: logically equal backups can have different physical
hashes. Validation therefore compares full schema and all-table content digests
while retaining each file's separate physical identity and hash. Tests cover
non-Revenue rows and integer, real, text, blob, and null values.

Independent Luna review identified reusable sessions after cleanup failure,
missing temporary-output tests, and stale byte-equality wording. Root fixed the
lifecycle defect and the related incomplete-backup failure with failing-then-
passing regressions, integrated the bounded Luna tests, and corrected the design.
Incomplete output or cleanup failure preserves evidence and requires a fresh
session. The lock assumes cooperative processes in an owner-only directory;
the later mutation runner still requires its separate release review.

| Check on this code checkpoint | Result |
|---|---|
| Focused backup and snapshot tests | PASS — 14 total, 13 passed, 1 Windows symlink-privilege skip |
| `npm run check:safety` | PASS |
| `npm test` | PASS — 610 total, 607 passed, 0 failed, 3 Windows symlink-privilege skips |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS — no warnings |
| `npm run build:cloudflare` | PASS — 2,018 files sanitized, 0 local secret values |
| `npx wrangler deploy --env="" --dry-run --autoconfig false` | PASS — no upload; generated duplicate-`options` warnings nonblocking |
| `npm run test:owner-ui` | PASS — list 429 ms, dossier 827 ms; widths 1440/390; 6 WCAG pages; 0 external requests |

The previous M1 fresh4 synthetic evidence is retained; website checkpoint,
report and database SHA-256 values still match the recorded proof. Two private temporary
directories from an earlier failed test-harness cleanup remain as local failure
evidence (`.m2-setup-3c1cf8e...` and `.m2-setup-43f4aef2...`); the corrected
tests clean only their observed owned paths, and the successful path asserts
that it leaves no new temporary directory. No shared-root cleanup is used.

Production and staging were not inspected or changed. This checkpoint used
synthetic local databases only; no real setup envelope, migration, receipt,
provider action, prospect request, deployment, message, or paid spend occurred.
Production automation remains off or unverified. The C$50/month ceiling and
zero-paid-mailbox decision remain: Cloudflare Email Routing inbound with a
separately gated free outbound/reply candidate; no Google Workspace.

The next three concrete actions are:

1. Complete Task 8's separately reviewed 0069 transaction, receipt-last
   publication and rollback runner, then obtain the real local setup gate.
2. Implement Task 5's double source-materialization preflight, legacy/M2 reader
   compatibility and HTML-only assessment against the verified setup receipt.
3. Complete Task 6 orchestration and the exact ten-business owner packet before
   a supervised one-then-ten real-source operation. M3 has not started.

## Prior M2 local prerequisite checkpoint (`a77ccc8`)

The Task 4 website evidence reloader is independently **APPROVED** at
`211c41c`. It authenticates the bounded pathless Task 3 durable website
evidence with current Task 1 approval, read-only replay, and zero network or
write authority. It does not authenticate a caller-supplied source
materialization claim. Task 5 must independently reload and compare the exact
source materialization before and after this evidence reload and before any
assessment write.

The Task 8 additive migration 0069 and canonical `0054-0069` release/receipt
contract are independently **APPROVED as a schema/contract slice** at
`581fdbe`. The local setup preflight/lock is separately **APPROVED as a
preflight slice** through `a77ccc8`: it validates the canonical recorded
release envelope, bounded paths, target identities, sidecar absence, and
exclusive cooperative lock, then exits without opening SQLite or applying a
migration. The remaining lock-release `lstat`/`unlink` interval assumes
cooperative processes; a stronger ownership primitive is needed before a
real mutation runner uses the lock. The executable backup, separate restore
drill, migration application, receipt publication, and rollback runner remain
**unimplemented and unapproved**. No real owner setup envelope or database
setup receipt was created.

| Check on `a77ccc8` | Result |
|---|---|
| Independent Task 8 schema and preflight reviews | APPROVED for their bounded slices only |
| `npm run check:safety` | PASS |
| `npm test` | PASS — 599 total, 597 passed, 0 failed, 2 Windows symlink-privilege skips |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS — one unused type-import warning, no errors |
| `npm run build:cloudflare` | PASS — 2,018 files sanitized, 0 local secret values |
| `npx wrangler deploy --env="" --dry-run --autoconfig false` | PASS — no upload; generated duplicate-`options` warnings nonblocking |
| `npm run test:owner-ui` | PASS — desktop list 369 ms, dossier 1,221 ms, widths 1440/390, 6 WCAG pages, 0 external requests |

The owner UI fixture now deliberately applies legacy migrations through 0068
(`d742fc6`) because its legacy contact writer exact-checks that partition;
Task 5 must separately implement ordinary-reader compatibility for 0069.
This checkpoint is local/offline only. Production and staging were not
inspected or changed. Automation, follow-ups, provider operations, deployment,
real migration, outreach, and send remain off or unverified. No real prospect
request or paid spend occurred. Runtime remains capped at C$50/month and the
zero-paid-mailbox decision remains: Cloudflare Email Routing inbound with a
separately gated free Resend or owner-only reply candidate, no Workspace.

The preflight test originally contained an unsafe shared-directory cleanup
which removed the ignored local M1 synthetic checkpoint files. This was found
in review, repaired in `b42094a` and `a77ccc8`, and the test now cleans only
its own identity-checked direct-child files. The old checkpoint identities
below are historical evidence, not retained files. A new synthetic M1
checkpoint was independently rebuilt and verified below; neither incident
nor rebuild touched production or a real prospect database.

The next three concrete actions are:

1. Implement and independently review Task 8's gated local backup, separate
   restore drill, 0069 transaction, receipt-last publication, and rollback
   runner; strengthen lock ownership before any real setup action.
2. Implement Task 5's double read-only source-materialization preflight,
   legacy/M2 reader partition, HTML-only assessment writer and replay against
   an independently verified Task 8 local setup receipt.
3. Complete Task 6 orchestration and the exact ten-business owner decision
   packet before any supervised one-then-ten real-source operation.

## M2 Task 4 checkpoint

Task 4 is **APPROVED for the bounded local HTML-only implementation** after
independent review of `f131bbe` (`fix(revenue): close M2 receipt trust seams`).
The earlier review rounds rejected incomplete replay, expiry, policy, and
receipt-storage boundaries; the accepted tree closes those findings. The
workflow requires the exact Task 1 owner-approved chain, uses the Task 2
address-pinned transport and canonical robots policy, and writes only through
the conditional Task 3 local evidence store. It retains the complete transport
and source-policy proof, exact raw-byte digests, a four-page maximum, and
conservative HTML-only availability observations. It does not create a
qualification, contact, consent, outreach, or send decision. Sealed replay
requires current approval and independently reloaded durable page or blocked
evidence; failures without a durable witness remain unsealed in-memory results.

| Check on accepted tree | Result |
|---|---|
| Independent Task 4 review | APPROVED on `f131bbe` |
| `npm run check:safety` | PASS |
| `npm test` | PASS — 580 total, 578 passed, 0 failed, 2 Windows symlink-privilege skips |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |
| `npm run build:cloudflare` | PASS — 2,018 files sanitized, 0 local secret values |
| `npx wrangler deploy --env="" --dry-run --autoconfig false` | PASS — no upload; generated duplicate-`options` warnings were nonblocking |
| `npm run test:owner-ui` | PASS — desktop list 389 ms, dossier 496 ms, widths 1440/390, 6 WCAG pages, 0 external requests |

The root also ran an affected focused suite after the accepted commit: 54
total, 53 passed, 0 failed, and one Windows symlink-privilege skip. The
independent reviewer ran its broader affected suite: 64 total, 63 passed,
0 failed, and one such skip. The full suite result above was recorded on the
same accepted code by the implementation agent; the root's full suite on its
preceding repair was also green. The final build, dry run, safety, typecheck,
lint, focused tests, and owner UI were run by the root on `f131bbe`.

Task 5's design is independently **APPROVED, execution blocked on its setup
prerequisite**. The design is retained in ignored local planning artifacts.
The trusted Task 4 receipt reloader is now approved above. Task 5 still
requires its own independent source-materialization preflight and the
separately applied, independently verified local migration 0069 with a matching
`0054-0069` database setup receipt. It must return a zero-write
`EXTERNAL_BLOCKER` until those proofs exist; it does not create or migrate a
database. Task 6
orchestration and the exact ten-business owner packet remain ahead of any
supervised real-source run. No real business was captured in this checkpoint.

Production and staging were not inspected or changed. Automation, follow-ups,
contact review, provider operations, deployment, migration, outreach, and send
remain off or unverified as applicable. This checkpoint made no live prospect
request, provider/account/DNS change, database migration, deployment, send,
or spend; runtime remains capped at C$50/month. The zero-paid-mailbox decision
remains in force: Cloudflare Email Routing inbound and separately gated free
Resend or free owner-only outbound/reply are the only mail candidates. There
is no Google Workspace or paid-mailbox path in scope.

At the earlier Task 4 checkpoint, the next three actions were:

1. Specify, implement, and independently review the trusted Task 4 durable
   receipt reloader for Task 5's input boundary, with zero-network replay tests.
2. Prepare Task 8's migration 0069 and local setup/backup/rollback evidence
   under its separate release gate; do not apply a remote migration.
3. Implement Task 5's HTML-only, zero-authority assessment materialization
   against those exact prerequisites, then prepare Task 6 and the exact
   ten-business owner decision packet. The current next actions are listed at
   the top of this document.

## M2 foundation checkpoint

The verified M2 foundation checkpoint is the exact committed tree at
`65cb2d5` (`fix(revenue): reconcile M2 policy receipts`). The three bounded
foundation gates are approved:

| Foundation | Result |
|---|---|
| Task 1 authorization chain | **APPROVED** — canonical Task 1 authorization and owner-envelope binding are required before publication. |
| Task 2 address-pinned transport and robots policy | **APPROVED** — DNS classification, direct-IP transport, Host/SNI binding, redirect and body limits, robots policy, abort disposal, and immutable receipts are enforced. |
| Task 3 conditional evidence store | **APPROVED** — publication is conditional on the canonical authorization, source-policy decision, complete receipt chain, and verified filesystem identity. |

The complete checkpoint verification sequence was:

| Check | Result |
|---|---|
| `npm run check:safety` | PASS |
| `npm test` | PASS — 565 total, 563 passed, 0 failed, 2 skipped; both skips are Windows symlink-privilege cases |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |
| `npm run build:cloudflare` | PASS — 2018 files sanitized, 0 local secret values |
| `npx wrangler deploy --env="" --dry-run --autoconfig false` | PASS — no upload; generated duplicate-options warnings were nonblocking |
| `npm run test:owner-ui` | PASS — desktop list 382 ms, dossier 568 ms, widths 1440/390, WCAG pages 6, external requests 0 |

Current production, staging, and automation state is unchanged and off. This
checkpoint performed no network, provider, DNS, database, migration,
deployment, send, or spend action. Authority, cost, network, provider,
outreach, and send remain zero/off as applicable, and
`contactReview.status` remains `NOT_RECORDED`.

The zero-cost mailbox decision remains a hard gate: there are **zero paid
mailbox seats**. The only in-scope mail paths are Cloudflare Email Routing for
inbound forwarding and a separately gated Resend Free or separately reviewed
free owner-only send-as path for outbound/reply. If those free paths cannot
satisfy reply ownership and privacy gates, mail activation remains blocked.
Paid mailboxes and Workspace are out of scope unless Riley explicitly reverses
that decision.

The foundation gate covered only local M2 prerequisites. The Task 4 gate above
adds bounded HTML-only composition, without authorizing real-business capture.
The remaining real-run blockers are the Task 5/6/8 implementation and setup
proofs, an exact-ten research packet with rights and owner approval, and
supervised one-then-ten business execution.

## Owner-facing state

M1 again has one fresh ignored local synthetic dossier produced through the actual
`npm run kw:execute-m1-dossier` CLI. This is a **new** checkpoint with new
identities after the unsafe test cleanup removed the earlier ignored artifact
set. The first run used the canonical source,
materialization, manifest, and assessment invocation inputs and wrote the real
local website checkpoint, assessment checkpoint, report, and SQLite state. An
unchanged second run used the same paths and IDs and replayed all stages exactly.

The retained artifact set is under
`data/kw-evaluation/m1-checkpoint-2026-09-21-b42094a-fresh4-*`:

- [source plan](../data/kw-evaluation/m1-checkpoint-2026-09-21-b42094a-fresh4-source.json),
  [materialization](../data/kw-evaluation/m1-checkpoint-2026-09-21-b42094a-fresh4-materialization.json),
  [manifest](../data/kw-evaluation/m1-checkpoint-2026-09-21-b42094a-fresh4-manifest.json),
  and [assessment invocation](../data/kw-evaluation/m1-checkpoint-2026-09-21-b42094a-fresh4-invocation.json);
- [website checkpoint](../data/kw-evaluation/m1-checkpoint-2026-09-21-b42094a-fresh4-website-checkpoint.json),
  [assessment checkpoint](../data/kw-evaluation/m1-checkpoint-2026-09-21-b42094a-fresh4-assessment-checkpoint.json),
  [report](../data/kw-evaluation/m1-checkpoint-2026-09-21-b42094a-fresh4-report.json), and
  [SQLite database](../data/kw-evaluation/m1-checkpoint-2026-09-21-b42094a-fresh4.sqlite);
- [first CLI stdout](../data/kw-evaluation/m1-checkpoint-2026-09-21-b42094a-fresh4-first.stdout.json),
  [second CLI stdout](../data/kw-evaluation/m1-checkpoint-2026-09-21-b42094a-fresh4-second.stdout.json),
  and the [machine-readable verification receipt](../data/kw-evaluation/m1-checkpoint-2026-09-21-b42094a-fresh4-verification.json).

The retained receipt independently verifies exact byte hashes before and after
replay, complete `Revenue*` row-count maps, stable IDs/digests, first-run fresh
paths, second-run `EXACT_REPLAY` paths, and zero second-run assessment inserts.
The exact durable identities are:

| Artifact | ID | Digest |
|---|---|---|
| Website checkpoint | `kw-shadow-progress:e504f554cb36efbb997bb3f0eafd1a9112913fe6bdb7558b91330bfde78b174d` | `e504f554cb36efbb997bb3f0eafd1a9112913fe6bdb7558b91330bfde78b174d` |
| Assessment checkpoint | `kw-shadow-progress:ccd76cab505200be50ec2f72eaf73b9366e53e458e442e96fdde38b73826a3dc` | `ccd76cab505200be50ec2f72eaf73b9366e53e458e442e96fdde38b73826a3dc` |
| Assessment receipt | `assessment:5ee2e8e059b43543497260bad3d773aa163cc9798cd301e94f6a70cc3272172a` | `f7d3994ec9a1dfccd6b1b1549534813e0adc759e9c6daa8931e63a3e4a80f982` |
| M1 report | `private-kw-m1-dossier:2bb5f58830ec14c947d300dcaaedfda924e3256ea18939d6187309c2e358fc3b` | `2bb5f58830ec14c947d300dcaaedfda924e3256ea18939d6187309c2e358fc3b` |

## Completed gate

The local M1 checkpoint gate is complete for the bounded synthetic case. The
first CLI result reported fresh source and eligibility commits, a fresh
assessment commit, and fresh writes for both progress checkpoints and the
report. The identical retry reported `EXACT_REPLAY` for all six paths and zero
`websiteSnapshots`, `evidenceClaims`, `qualificationSnapshots`, and
`assessmentReceipts` in `assessmentInsertedRows`. The complete independent
`Revenue*` count map and all retained output/database SHA-256 hashes were equal
before and after replay.

The report authority is `synthetic=true`, `fixtureOnly=true`,
`workerRuntimeConnected=false`, `networkOperationsPerformed=0`,
`providerOperationsAuthorized=0`, contact discovery and verification false,
consent false, qualification false, outreach false, send false,
`costAuthorizedUsd=0`, and `contactReview.state=NOT_RECORDED`. The one true
`localAssessmentMutationAuthorized` flag covers only the explicitly approved
local shadow SQLite write. No provider, network, mailbox, prospect, deployment,
remote migration, outreach, send, or spend action occurred.

The root checkpoint owner completed the final M1 verification sequence on the
exact committed candidate `fe921824439cda6b485cf11966977d30829d7133`:

| Check | Result |
|---|---|
| `npm run check:safety` | PASS |
| `npm test` | PASS — 511 passed, 0 failed, 1 skipped, 512 total; the skip is the Windows developer-mode symlink privilege case |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |
| `npm run build:cloudflare` | PASS — bundle sanitizer removed 0 local secret values and scanned 2018 files |
| `npx wrangler deploy --env="" --dry-run --autoconfig false` | PASS — no upload after the custom rebuild; generated-bundle duplicate `options` warnings were non-blocking |
| `npm run test:owner-ui` | PASS — desktop list 854 ms, dossier 464 ms, widths 1440/390, WCAG pages 6, external requests 0 |

M1 is complete for the bounded synthetic offline scope. The verification
sequence confirms the local implementation, build safety, dry-run packaging,
and owner UI acceptance; it does not establish a live acquisition loop or
real-business readiness.

## Production, staging, and automation

Production and staging were not inspected or changed. The Worker remains
disconnected, automation and follow-ups remain off, and no provider, mailbox,
source account, contact system, or spend capability is verified. The M1 artifact
does not establish real-business evidence, production or staging readiness, or
M2 readiness. The runtime ceiling remains C$50/month and this checkpoint spent
zero dollars.

Public DNS was inspected read-only on 2026-09-21. `getaxiom.ca` publishes the
Cloudflare Email Routing MX set (`route1/2/3.mx.cloudflare.net`), Cloudflare SPF,
DMARC quarantine, and a Resend domain-verification token. This supports the
zero-paid-mailbox target of Cloudflare inbound forwarding to existing owner
destinations plus a separately gated Resend outbound/reply adapter. It does not
prove active Cloudflare destinations/rules, a Resend account or API key, sender
verification, complete DKIM (two `resend._domainkey` TXT values are ambiguous),
or send readiness. No DNS/provider/account mutation or mail operation occurred.

## Owner decisions and blockers

Owner decision recorded: the mail architecture has zero paid mailbox seats.
Cloudflare Email Routing remains the inbound route and gated Resend Free or a
separately reviewed free owner-only send-as route are the only outbound/reply
options in scope. If those zero-cost routes cannot satisfy reply ownership or
privacy gates, mail activation remains blocked; paid mailboxes and Workspace
are out of scope unless Riley explicitly reverses this decision.
Before any real-source work, the owner must separately decide the source and
privacy scope, accounts and rights, backup/rollback plan, and the exact release
gate. M2 is blocked by the absence of an authorized real-source evidence packet,
verified provider and mailbox readiness, live runtime proof, an owner-approved
ten-business research cohort, and the separate contact/consent/reply gates.
M4 also remains blocked on verified Cloudflare destination ownership/rules,
Resend domain/key/webhook readiness or a separately reviewed free owner-only
send-as route, legal sender identity, suppression/unsubscribe handling, and
sink-tested human-triggered replies. Cloudflare forwarding cannot itself send
replies from the custom domain; legacy Gmail OAuth/send/sync remains quarantined
from the v2 target.

## M1 verification result

The exact-commit M1 verification gate is complete for the synthetic offline
scope. The retained artifact proves only the bounded local path and its
replay/restart behavior. Production, staging, provider, contact, outreach,
deployment, and spend facts remain unknown or off as stated above.

## Next three concrete actions

1. Prepare M2's owner decision packet for real-source rights, privacy, accounts,
   backup/rollback, ten-business scope, and the explicit release gate without
   activating any provider or contact path.
2. Record the owner's approval or rejection of the M2 release and activation
   gates, including provider, contact, privacy, and budget decisions, without
   activating any capability.
3. If M2 is approved, implement and verify its bounded capability packet while
   keeping provider, contact, deployment, outreach, send, and spend actions
   separately gated.
