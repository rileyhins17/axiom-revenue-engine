# ADR 0057 — Pin the pending staging migration and console candidate

**Status:** Accepted
**Date:** 2026-09-23
**Decider:** Revenue Engine integration owner

## Context

The existing staging release packet excludes database migration. Staging D1
has receipts through 0055; the candidate console needs 0056–0074. The old
packet cannot safely identify or authorize this combined change. The exact
candidate has passed CI and a no-upload staging dry run, but there is no fresh
remote export, local restore rehearsal or release approval.

## Decision

Keep a separate, immutable *pending* migration-and-console packet. Pin the
candidate Git commit and tree, the ordered 19 migration blobs, the staging
Wrangler config blob, isolated Worker and D1 identities, CI, no-upload dry-run
evidence, and observed rollback Worker version. The verifier checks the packet
against its staged or committed Git blob and local Git objects, and prints a
SHA-256 for a later release record. Every live data, migration, deployment and
smoke gate stays pending; all authority remains false or zero.

Fresh export and rehearsal evidence, approvals, and execution results must be
recorded separately against this packet digest. A Worker version rollback
cannot undo a D1 migration; database recovery remains a separate decision.

## Consequences

- The candidate can be reviewed and reverified without assuming remote access.
- A changed migration, target or packet cannot silently inherit this candidate's
  release evidence.
- Passing this verifier or CI is not permission to migrate or deploy. The
  staging schema runbook supplies the remaining pre-change and live gates.
