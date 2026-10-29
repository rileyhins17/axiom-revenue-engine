# ADR 0053: Record Codex's local source/workflow decision under delegation

**Date:** 2026-09-23. **Status:** accepted for the offline shadow path.

## Context

The local source/workflow materialization input originally represented only a
decision personally made by Riley or Aidan. Riley has instructed Codex to make
the reviews and decisions needed to advance the Revenue Engine. Filling the
owner-only approval as if either founder inspected the exact audit input would
falsify provenance. The next materialization is a reversible, ignored local
SQLite write and is separate from website capture, source-rights clearance,
contact, provider activation, deployment, and send.

## Decision

Preserve the original owner v1 input. Add a separately versioned local v2
input that names `CODEX` as reviewer, `RILEY` as delegator, and `CODEX_CHAT` as
the medium. It records Riley's exact instruction, its SHA-256 and this task's
conversation reference. The agent must make and explain the specific local
decision; the quoted delegation is not presented as Riley's firsthand review
of the selected business or audit. The v2 decision binds the source plan,
business, evaluation candidate and deterministic audit input digests. Its
scope is only `LOCAL_SOURCE_WORKFLOW_MATERIALIZATION`; the record explicitly
denies capture, contact discovery/verification, outreach, send, deployment,
provider operations and spend. The materialization receipt includes the
versioned reviewer provenance and the same zero-authority boundary.

The v2 schema alone does not authorize or perform a write. A real operation
still needs a source-backed, honest audit input, an exact current decision
record, the canonical ignored local database, collision-complete preflight,
atomic write and receipt reload. Do not create an artificial audit input to
make the command pass. The separate source-rights and M2 evidence gates remain
in force; the [Service 1st live-fetch hold](../reviews/2026-09-23-m2-service1st-source-rights-hold.md)
is not changed by this decision.

## Consequences

Codex can make the bounded local decision without asking Riley to click
through internal setup steps, while the stored record identifies the actual
reviewer. An old owner v1 file remains readable and unchanged. The chat quote
and digest are an audit trail, not a cryptographic signature or proof of
Riley's review of a particular website. No provider, production, or contact
authority follows from a successful local materialization.
