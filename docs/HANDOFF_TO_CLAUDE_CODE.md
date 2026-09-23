# Claude Code continuation handoff — Axiom Revenue Engine

**Prepared:** 2026-09-23, America/Toronto. This is a dated navigation and
continuation brief, not a release approval. `AGENTS.md` and the current
`docs/STATUS.md` remain authoritative. Verify Git, provider state, CI, account
permissions and public sources again before acting.

## Start in the correct checkout

- Local Windows checkout: `C:\Users\riley\.codex\worktrees\revenue-engine-production\APE`.
- Git remote: `https://github.com/rileyhins17/axiom-revenue-engine.git`.
- Working branch: `codex/revenue-engine-production`; the local branch contains
  commits beyond its pushed counterpart. Do **not** start a new session from
  GitHub `main` or assume cloud Claude Code has these unpushed files.
- The tracked `CLAUDE.md` imports `AGENTS.md`. Read, in its required order,
  `docs/OWNER_CONTEXT.md`, `docs/STATUS.md`, `docs/MASTER_PLAN.md`, and
  `docs/GOTCHAS.md`, then the ADR and runbook for the next bounded milestone.
  Read `docs/DELIVERY_PLAN.md`, `docs/OPERATING_MODEL.md`,
  `docs/PROVIDER_AND_BUDGET_PLAN.md`, and `docs/VALIDATION_PLAN.md` as the
  milestone requires. These files are the durable project context; prior chat
  is not the source of truth.

At the start of each session, run `git status --short --branch`,
`git log -1 --oneline`, `git branch -vv`, and the smallest relevant checks.
Check current GitHub visibility before pushing. Preserve ignored `data/`,
`backups/`, local secrets and prior worktree artifacts. Never use a production
database, prospect, mailbox or live deployment as a test.

## User intent and decisions already made

Riley wants the **whole Revenue Engine completed to a verified production
operating loop**, not another plan or a synthetic demo. Move autonomously on
reversible local implementation, tests, documentation, research and routine
product choices. Riley delegated the ten-business identity decisions to Codex;
they are saved. Do not send the ten choices back for owner review. Riley wants
one plain-language, low-clutter owner UI for nontechnical business operators,
no Google Workspace or paid mailbox seats, and no OpenAI API prerequisite.
Runtime ceiling: C$50/month unless Riley changes it. Keep Jev optional until a
measured task justifies it. Value is qualified opportunities and customers,
not lead count, scraped rows, generated messages or volume.

The user requested economical subagent orchestration. Keep one integration
owner for shared files and final checks; use cheaper capable subagents for
independent, bounded research/audits, with careful model and spend monitoring.
The past Codex preference for GPT-6 Luna does not designate a Claude model.
Use the installed Claude Code model picker or an explicit model ID to confirm
the selected model.

Local implementation and delegated evidence review are authorized. Production
deployments, remote migrations, provider activation/spend, account-security
changes and real outreach retain their separate exact gates. Prepare the
reviewable packet and backup/rollback first, then obtain the applicable action
approval. Do not use broad `bypassPermissions` or run unattended external
effects. No local or CI success implies live permission or readiness.

## Current evidence, holds and next milestone

The top of `docs/STATUS.md` records the latest verified application commit,
tests and live inventory. At preparation time, the **pushed** candidate was
`d30db0c` and its [CI run 121](https://github.com/rileyhins17/axiom-revenue-engine/actions/runs/35907330796)
passed. The local, unpushed application commit `a969f10` passed the full suite,
safety, typecheck, lint, a clean Cloudflare build, two no-upload dry runs and
owner browser acceptance. Subsequent local changes add a Codex-attributed,
source-decision-bound manual fact entry path; verify the final commit and
update STATUS before calling that slice complete. Draft [PR #9](https://github.com/rileyhins17/axiom-revenue-engine/pull/9)
is not a production release.

**Security hold:** GitHub currently reports this repository **public**, while
tracked owner context describes it as private. History includes a former
SQLite WAL blob with email-like strings; the count-only investigation is
`docs/reviews/2026-09-23-public-repository-exposure-check.md`. No secret leak
has been proven or ruled out. GitHub showed zero forks and no Pages site. Do
not push further private project material until repository visibility is
resolved and anonymously verified. Do not force-push/history-rewrite without
classifying the data and coordinating consumers. The owner has a pending
visibility decision; do not silently treat a later answer as already applied.

**Live release hold:** staging Worker/D1 and legacy production Worker/D1 are
unchanged. Staging D1 was observed with 55 migrations through 0055, all stops
engaged; candidate migrations 0056–0074 have synthetic and dry-run coverage,
but no current staging export, local restore of those exact rows, remote
migration or console deploy. Wrangler OAuth had expired. The precise next
procedure is `docs/runbooks/STAGING_SCHEMA_0055_TO_0074.md`, with the pinned
but pending packet in `docs/releases/staging/`. Start with a short-lived D1
Read token and read-only inventory/export if authorized. Escalate to separate
write/deploy credentials and approval only after checksum-pinned backup,
offline/local restore rehearsal, exact target/CI and rollback packet. Never
touch the legacy production D1 during staging work.

**Market-quality hold:** ten delegated identity decisions are saved, but M2 is
still **0/10 real website-need assessments** and M3 **0/50 real judged
dossiers**. Identity or a manual own-word fact is not a qualified lead. The
current source disposition is `docs/reviews/2026-09-23-m2-manual-facts-only-source-disposition.md`:
eight sites are only conditionally suitable in principle for narrow manual
facts; two access-denied sites and Service 1st remain held. No site has general
raw-HTML retention or automated-fetch clearance. The optional local manual
fact tool stays `UNKNOWN / RESEARCH`, scores zero, authority false; it does
not advance M2. Obtain source-specific rights and actual website evidence,
replace blocked cases when appropriate, then make real evidence-backed
assessments and the fixed 50-case quality evaluation.

**Communication hold:** Cloudflare Email Routing is inbound forwarding only.
The two domain addresses are planned identities, not proof of active routes.
Resend's current policy does not allow unsolicited cold outreach; Cloudflare's
outbound Email Service is transactional. No permitted cold-email sender or
verified reply route is connected. Manual business calls remain held until
National DNCL registration and calling controls are verified. Do not revive
legacy Gmail, automated browser crawl, automatic follow-ups, forms, social
messages or prospect sends as a shortcut. The first-touch review is
`docs/reviews/2026-09-23-first-touch-channel-route.md`.

## Recommended continuation sequence

1. Reconcile local diff and tests, finish and commit the bounded Codex manual
   fact slice, and update STATUS with exact proof. Resolve the public-repo
   exposure/visibility hold before pushing. Keep ignored local data private.
2. With authorized scoped Cloudflare read access, verify staging target and
   stop state, export/checksum its **current** D1, rehearse the exact data
   offline and in a fresh local D1, then prepare a new migration/console
   packet. Do not convert the old pending JSON into an apparent approval.
3. Complete one source-cleared real M2 website assessment end to end, replace
   blocked identities as needed, finish 10 real assessments, then acquire and
   judge the fixed 50-case M3 set. Keep scores and evidence confidence honest.
4. Prove inbound routing/reply ownership, legacy suppression reconciliation,
   stops, consent and first-touch channel rules. Only then run a small,
   separately authorized real conversation pilot with recorded outcomes.
5. Finish the reply-to-opportunity-to-customer workflow, collected-value
   tracking, owner alerts, operator runbooks and recovery checks. Add selective
   automation only where observed quality, owner time and the C$50 ceiling
   justify it. For each milestone, verify code, CI, staging behavior and live
   behavior at their actual evidence levels; update `docs/STATUS.md` and
   `docs/GOTCHAS.md` as required by AGENTS.md.

Production completion means a current, backed-up, rollback-ready release that
the owners can use end to end with real evidence, functioning reply handling,
safe stop/suppression controls, measured quality and cost, and recorded
customer outcomes. A green build, static preview or isolated synthetic flow
is not that completion. Stop at any genuine external approval or account-login
boundary with a prepared packet; resume immediately when it is satisfied.

## Claude Code desktop entry

Riley uses the **Claude desktop app**, not the CLI, for this handoff. On
2026-09-23 the signed-in desktop app showed a Code-mode new-session screen
with **Local** selected and **Opus 5.5** as its default; weekly usage was
displayed at 48%. Start a new local Code session, select this exact checkout
as the project folder, and confirm the session header shows Local and Opus
5.5. A separate CLI installation was updated to 2.1.281 but reported itself
signed out; its account state is irrelevant to desktop access. Do not route
this handoff through that CLI or start from a cloud checkout that lacks the
local commits and ignored evaluation data. Enable desktop Remote Control only
through an explicit user-approved access decision.

First session request: **Read AGENTS.md and its required docs, then this
handoff. Verify Git and current provider/repo facts. Continue the next safe
milestone autonomously, update STATUS and commit verified work. Keep public
repo pushes, remote changes, paid operations and real outreach behind their
exact gates. Report only the user actions that genuinely remain.**

Official Claude Code references: [model configuration](https://code.claude.com/docs/en/model-config),
[instructions and imports](https://code.claude.com/docs/en/memory), and
[permissions](https://code.claude.com/docs/en/permissions).
