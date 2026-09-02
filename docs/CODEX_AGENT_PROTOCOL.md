# Codex agent protocol

This document makes the model split durable across new tasks, scheduled runs,
quota interruptions, and lost conversations. Repository state and the current
commit remain authoritative; a child-agent summary is never the source of truth.

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
2. Sol chooses one bounded milestone and records its exit gate.
3. Sol delegates only independent portions through the task-packet contract.
4. Sol integrates and independently verifies every child result.
5. Sol runs targeted checks, then the full release gate from `AGENTS.md`.
6. Sol updates durable status, decisions, README/runbooks, and proven gotchas.
7. Sol creates one atomic checkpoint and pushes only the current rebuild branch.
8. The next task resumes from the repository commit and `docs/STATUS.md`, never
   from a model's memory of the conversation.

If quota ends, the latest verified commit plus `docs/STATUS.md` must state the
exact checkpoint, blockers, spend, and next three actions. No child summary or
unfinished working tree is treated as completion.
