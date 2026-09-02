# ADR 0048: Use Sol integration with Luna max workers

- Status: Accepted
- Date: 2026-09-02

## Context

The rebuild will span many resumable work cycles. Using the flagship model for
every narrow lookup, audit, or test is unnecessarily expensive in usage and can
pollute the integration context. Using child agents indiscriminately creates its
own token and coordination cost, and parallel writers can corrupt shared state.

Riley explicitly selected Sol as the permanent orchestrator and Luna at max
reasoning for subagents. The choice must survive new tasks and scheduled runs.

## Decision

- Use `gpt-5.6-sol` at high reasoning as the sole orchestrator, integration owner,
  shared-document owner, safety reviewer, release verifier, and committer.
- Default every child to `gpt-5.6-luna` at max reasoning and low verbosity.
- Limit a session to three concurrent children.
- Delegate only bounded independent exploration, first-party research, focused
  test work, reviews, or an exclusive non-overlapping patch.
- Use parallelism freely only for read-only work. Serialize shared-checkout
  writers; separate worktrees and exclusive files are required for parallel
  writers.
- Require explicit task packets and concise evidence-based result contracts.
- Prohibit child model, reasoning, verbosity, sandbox, and permission overrides
  without a new ADR and Riley's explicit recorded decision.
- Require Sol to compare a writer's starting commit, exclusive allowlist, and
  final `git diff --name-only` before accepting its patch.
- Encode the decision in `.codex/config.toml`, `.codex/agents/`, `AGENTS.md`, the
  recurring heartbeat, the safety checker, and `docs/CODEX_AGENT_PROTOCOL.md`.

## Options considered

### Sol for everything

Rejected. It spends flagship effort on narrow work and expands the primary
context without improving integration quality.

### Luna for every task

Rejected. Final architecture, authority boundaries, cross-cutting integration,
release verification, and checkpoint ownership need one flagship integrator.

### Sol integrator with Luna workers

Selected. It preserves strong central judgment while using Luna for work that
benefits from independent context.

## Consequences

- New trusted sessions in the canonical checkout inherit the model split.
- Luna max is not free; narrow scope, low verbosity, and the three-child ceiling
  prevent the setting from becoming an excuse for needless delegation.
- Child output is advisory evidence. Sol owns the final diff and claims.
- The safety gate treats the role directory as a closed set, validates exact
  execution settings, and pins normalized role instructions to reviewed
  SHA-256 digests. Any role change therefore requires an intentional policy and
  test update instead of silently weakening a child boundary.
- Google Drive integration is disabled on Riley's machine for this project and
  the stale trusted OneDrive checkout is replaced by the canonical non-synced
  path. GitHub remains the remote source of truth.
- This decision changes no application runtime, Cloudflare resource, provider,
  prospect-contact capability, deployment authority, or C$50 operating budget.
- Riley's direction that this branch eventually become `main` remains recorded,
  but this ADR does not authorize that merge.

## Follow-up

- [x] Add project-local defaults and role definitions.
- [x] Add the permanent operating protocol.
- [x] Add fail-closed safety assertions for the model and role configuration.
- [x] Update the recurring rebuild heartbeat.
- [ ] Review actual usage after several nontrivial milestones and tighten role
  scope or concurrency if Luna max is not producing useful independent evidence.
