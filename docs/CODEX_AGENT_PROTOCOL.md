# Codex agent protocol

This document makes the model split durable across new tasks, scheduled runs,
quota interruptions, and lost conversations. Repository state and the current
commit remain authoritative; a child-agent summary is never the source of truth.

## Owner-outcome work contract (2026-09-08)

Riley asked to correct the working relationship, not to generate another rebuild
plan. This contract changes delivery and reporting; it does not enable production
or replace the master plan, safety rules, role policy or release gates.

### Start from the business decision

Confirmed constraints live in OWNER_CONTEXT: quality over volume, evidence behind
claims, all useful contact routes, no Google Workspace, no Drive working folder,
C$50 runtime ceiling and an owner experience that fits Riley's limited time.
An explicit later owner correction supersedes an older plan. Record its date and
update affected instructions before coding. Separate **confirmed**, **proposed**
and **unknown** decisions; legacy implementation is not proof of owner approval.

The integration owner handles reversible technical choices within these rules.
Ask Riley for material business choices: provider purchase/policy tradeoffs,
budget or offer changes, outreach scope and live rollout. Explain one recommended
choice, its cost/consequence and the actual approval needed. Do not ask Riley to
manage file structure, routine tests or subagent assignments. A question blocks
only work dependent on its answer; safe independent work can continue.

### One deliverable at a time

Before implementation, put a short work card in the active STATUS brief:

- **Owner result:** one action Riley will be able to complete, or one specific
  security failure that will be prevented.
- **Proof:** the real entry point, synthetic test/browser demonstration and
  expected result. For UI work include desktop/mobile evidence and error states.
- **Scope/non-goals:** exact integration boundary and what remains disabled.
- **Dependencies/decisions:** distinguish owner choice, technical gap, unavailable
  review and external permission. Do not label every delay an owner blocker.
- **Finish:** integrated acceptance evidence plus required release verification;
  name unfinished work honestly when only a partial checkpoint is safe.

Prefer a complete thin path through the existing application (for example, open
a lead, inspect proof, save a review decision and see it after reload) over a new
standalone helper. Inventory existing UI and code before rebuilding them. Every
new abstraction must name its actual caller and the failure it prevents. A
necessary prerequisite may be checkpointed, but must be labelled source-only and
linked to its consuming feature; it does not count as that feature being done.

Keep one active delivery milestone. At a scope change or interruption, inventory
the dirty tree, identify reusable versus superseded work and record a bounded
integration path. Do not delete unfinished work or fold unrelated edits into a
commit. If the milestone grows, split it at a safe, demonstrable boundary before
adding another layer. Security work remains necessary, but each claim must be
bounded: passing tests cannot prove the whole application cannot be hacked.

### Evidence before progress claims

Use these capability labels in the active brief:

| State | Required evidence |
|---|---|
| Planned | Acceptance defined; implementation not claimed |
| Source-only | Code exists; real caller/owner flow not yet proven |
| Locally verified | Real application path passes with disposable data; proof linked |
| Staging verified | Exact deployed staging version and acceptance evidence |
| Live verified | Approved production version and live acceptance evidence |
| Commercially validated | Measured real cohort meets the master-plan gates |

These describe capability readiness, not the monitor's existing activity states.
Keep verified Git checkpoint, dirty candidate and deployment version separate.
Do not infer a completion percentage from commits, tests, code size or elapsed
hours. An overall fraction needs an agreed acceptance checklist and denominator.
New test totals are supporting evidence, never the headline owner outcome.

Close a work cycle with: what Riley can now do; proof and where to see it; what
is not working/live; next deliverable; any decision needed and spend change.
Use screenshots or a local demo for visual work, never a description pretending
to be a tested UI. Update on meaningful progress or a concrete failure; do not
claim background work continues after a turn ends or quota stops execution.

### Spend context on progress

Read the required current context once per work cycle; reload changed sections
and task-relevant history, not the entire accumulated history on every step.
STATUS has one authoritative active brief. Previous continuation notes and their
old next-action lists are historical, not additional live queues. Update that
brief in place; retain detailed historical evidence without duplicating it in
README, monitor and chat. README points to the brief and describes the operator
experience. ADRs record durable decisions, not every implementation session.

Use targeted tests while editing and the complete required release gate at a
checkpoint. Broaden or repeat checks for changed scope, failures or unresolved
risks, not merely because another response was generated. Never skip a mandated
security, database or browser gate to save tokens. This is consistent with
[OpenAI's testing and delegation guidance](https://developers.openai.com/api/docs/guides/latest-model#testing-and-verification).

Preserve the approved model/role configuration below. Delegate only an independent
task whose saved work or review value exceeds coordination cost; do not have
parent and child redo the same investigation. Give the child selected context,
not the entire chat by default. On a quota/access failure, record the missing
review once and stop retrying unchanged conditions. Continue safe work that does
not need that review, but do not mark the review passed or bypass release gates.
Never silently switch models or claim a repository edit changed the active app
model, scheduler configuration or subscription quota.

For the next three completed delivery milestones, record the demonstrated owner
outcome, elapsed active work when observable, repair cycles, human decisions and
usage when available. Missing timing/usage stays unknown. Evaluate whether this
produces more usable outcomes with less rework; do not promise an unmeasured
speed multiplier. This is a lightweight status record, not another dashboard.

## Permanent topology

| Responsibility | Model | Reasoning | Concurrency |
|---|---|---:|---:|
| Orchestration, integration, shared docs, safety, release, commits | `gpt-5.6-sol` | high | one owner |
| Bounded research, exploration, audits, tests, or isolated patches | `gpt-5.6-luna` | max | at most three children |

All child roles use low output verbosity. Max reasoning is intentional because
Riley selected it, but it is not permission to waste context: task packets stay
narrow, raw logs stay out of handoffs, and trivial work stays with Sol.

Sol must not override a child's approved model, reasoning effort, verbosity,
sandbox, or permissions. Every child dispatch uses one approved role or the
project defaults. Any exception requires a new ADR and Riley's explicit decision
in `docs/STATUS.md`.

This follows the official guidance to use the flagship model for complex
orchestration, a smaller model for narrow high-volume work, and subagents only
where independent context is useful. See [model selection](https://developers.openai.com/api/docs/guides/latest-model)
and [Codex subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents).

## When Sol delegates

Delegate when the work can finish independently and produce evidence that Sol
can verify, including:

- mapping a bounded part of the codebase;
- researching one version-sensitive question in first-party documentation;
- adversarial security, testing, UI, or lead-quality review;
- running a safe focused check and summarizing failures; or
- editing an exclusive, non-overlapping file allowlist.

Do not delegate a tiny lookup, one obvious edit, shared-document maintenance,
release integration, a task requiring constant back-and-forth, or anything that
would give a child live authority. Delegation has a token and coordination cost.

## Required task packet

Every child receives:

1. One objective and observable exit gate.
2. Canonical checkout, current branch, and exact starting commit.
3. Relevant source-of-truth files and known facts.
4. An explicit read-only or exclusive write scope.
5. Allowed commands and required focused checks.
6. Forbidden actions, especially Drive access, secrets, live resources,
   deployments, migrations, messages, and repository history changes.
7. The required concise result contract.

Sol rejects or rewrites an ambiguous packet before dispatch.
A read-only role must receive the narrowest available runtime permissions and
must never be launched with a broader parent override.

Before reading any project file, the child must run a checkout attestation and
prove all three task-packet values:

1. Git top level is exactly `C:/Users/riley/Documents/ChatGPT/APE`.
2. Current branch is exactly the packet branch.
3. HEAD is exactly the packet starting commit.

Any mismatch ends the child task before inspection or editing. Every later
filesystem or Git operation must use the exact absolute checkout path or
`git -C C:\Users\riley\Documents\ChatGPT\APE`; the inherited working directory
is not trusted. The child includes all three attested values in `Checks`. Sol
discards any report or patch whose attestation is absent, mismatched, or names a
Drive-synced checkout, even when the findings otherwise look plausible.

## Child result contract

Every child returns:

- **Result:** the direct conclusion or patch outcome.
- **Evidence:** exact files, symbols, lines, fixtures, or first-party sources.
- **Checks:** commands run and pass/fail result without raw log dumps.
- **Risks:** unresolved issues, assumptions, or confidence limits.
- **Next action:** one concrete integration step for Sol.

Sol then inspects the evidence and diff, resolves conflicts, runs the relevant
tests, and remains accountable for the final claim.

## Defined roles

| Role | Mode | Use |
|---|---|---|
| `repo_explorer` | read-only | Trace real code, tests, ownership, and persisted state |
| `docs_researcher` | read-only | Answer one current first-party documentation question |
| `lead_quality_auditor` | read-only | Challenge fit, rebuild need, timing, reachability, and evidence separately |
| `security_reviewer` | read-only | Find trust, replay, auth, secret, SQL, and authority failures |
| `test_auditor` | read-only | Map behaviour to focused and adversarial verification |
| `ui_qa` | read-only | Review the owner console, accessibility, decision speed, and regressions |
| `implementation_worker` | exclusive write scope | Produce one small typed patch that Sol integrates |

Role definitions live in `.codex/agents/`. Children cannot create grandchildren.

## Parallel-writing rule

Read-only roles may run in parallel. A write role gets an exclusive file
allowlist. Two writers may run simultaneously only in separate worktrees with
non-overlapping ownership; shared files such as `AGENTS.md`, `docs/STATUS.md`,
release configuration, and safety controls always stay with Sol. In the shared
checkout, writers run serially. Before accepting any writer result, Sol compares
the packet's starting commit and allowed files with `git diff --name-only` and
rejects the entire result if any changed file falls outside that allowlist.

## Never-lost work cycle

1. Sol reads the repository context and verifies branch, commit, status, and
   current tests.
2. Sol chooses one bounded milestone and records its exit gate in the private
   local rebuild monitor.
3. Sol delegates only independent portions through the task-packet contract.
4. Sol integrates and independently verifies every child result, moving the
   monitor only on meaningful testing, fixing, or verification transitions.
5. Sol runs targeted checks, then commits the bounded candidate and runs
   `npm run rebuild-monitor:prove-release` so the exact commit receives the full
   release receipt.
6. Sol updates durable status, decisions, README/runbooks, and proven gotchas.
7. Sol pushes only that release-proven commit, verifies local/upstream/GitHub
   equality, then records the exact checkpoint in the local monitor.
8. The next task resumes from the repository commit, `docs/STATUS.md`, and the
   versioned monitor contract, never from a model's memory of the conversation.

If quota ends, the latest verified commit plus `docs/STATUS.md` must state the
exact checkpoint, blockers, spend, and next three actions. No child summary or
unfinished working tree is treated as completion.

The monitor is an owner-readable projection, not a second source of engineering
truth or an execution control. It is fixed to loopback, stores current-machine
state in the ignored local `data/` boundary, and is fully described in
`docs/REBUILD_MONITOR.md` and ADR 0058.

The active Codex goal keeps the multi-week objective and checkpoint status
attached to the task, while Git, this protocol, and `docs/STATUS.md` preserve the
recoverable implementation truth. This follows the official guidance to use
[goals for long-running checkpointed work](https://learn.chatgpt.com/use-cases/follow-goals);
the local monitor adds Riley's owner-readable view without pretending that a
chat or dashboard replaces the repository.
