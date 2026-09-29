# ADR 0026 — Gate owner-approved local shadow assessments

**Status:** Accepted
**Date:** 2026-08-26
**Deciders:** Riley Hinsperger and the Revenue Engine integration owner

## Context

ADR 0024 created an atomic writer that can turn one sealed website-evidence
receipt into immutable audit, evidence, qualification, and assessment rows. It
was intentionally not reachable from a Worker, route, or command. A safe private
evaluation still needed a way to invoke it for a record Riley had actually
reviewed, without turning the validation-only KW persistence artifact into an
executable payload or creating a path to production.

The older KW source persistence planner also combined primary and alternate
business/source identities with `LIMIT 1`. That repeated DATA-002: an exact first
row could hide a second conflicting identity.

## Decision

Add one guarded command for a direct-child `.sqlite` file under ignored
`data/kw-evaluation/` storage. It accepts the original prepared source plan and a
separate strict owner-approval invocation. It never accepts a saved persistence
artifact as executable authority.

Before the assessment writer is called, the command:

1. rejects paths outside the ignored directory, nested paths, other extensions,
   symbolic links, oversized databases, and attached databases;
2. rebuilds migrations 0054–0061 in memory and requires the local Revenue tables,
   indexes, and triggers to match that canonical schema exactly;
3. re-parses the prepared source plan and re-derives persistence plan v2;
4. reads every primary and alternate identity match and requires exactly one
   byte-equivalent row for every source run, business, location, and source
   record; and
5. binds the approval to one import digest, business, evaluation candidate,
   sealed workflow receipt, exact assessment timestamp, evidence basis, scores,
   policy blocks, reviewer, and explicit local-shadow confirmation.

The only positive authority is
`localAssessmentMutationAuthorized: true`. Source and workflow mutation, contact
discovery, outreach, sending, provider operations, and cost remain false or zero.
The sealed assessment writer retains its own receipt, collision, D1-clock,
atomicity, exact-reload, and replay checks.

Persistence plan v2 removes both `LIMIT 1` clauses. A preflight now accepts only
zero rows as missing or one exact row as idempotent; two or more matches are
always a conflict. The local assessment command is stricter: every source row
must already be the one exact match, so it performs no source import.

## Safety boundary

- The command opens only one existing ignored local SQLite file.
- It does not run migrations, write source/workflow/contact data, or repair drift.
- It has no Wrangler, Worker binding, route, queue, cron, network, provider,
  mailbox, or artifact-store integration.
- Its console result contains content-derived IDs and counts, not prospect names,
  evidence text, email addresses, or secrets.
- Staging and production activation remain separate backup/rollback/approval
  gates.

## Alternatives considered

### Execute the saved persistence-plan JSON

Rejected. An ignored artifact is untrusted data and carries
`mutationAuthorized: false`; accepting it as executable SQL would turn a review
artifact into authority.

### Auto-import missing source or workflow rows

Rejected. That would combine three persistence domains and let an assessment
approval silently authorize unrelated writes. Missing data is a clean stop.

### Expose an authenticated application route

Rejected. Owner authentication is necessary but insufficient for a runtime
writer. Staging schema, deployment, UI approval state, CSRF/idempotency, audit
logging, and production release controls have not passed their later gates.

## Consequences

- An approved KW record with an already sealed local receipt can now be assessed
  end to end in one ignored SQLite file.
- Exact retries are mutation-free; hidden source collisions stop before the
  sealed writer runs.
- Riley's approval remains a deliberate local procedure for the evaluation
  phase, not reusable production authorization.
- Real source acquisition, workflow execution/import, contact discovery,
  verification, UI approval, staging migration, and production remain pending.

## Verification

Unit tests cover deterministic binding, source/candidate drift, approval-time
drift, unrelated evidence URLs, complete identity preflights, and multiple-match
rejection. An end-to-end disposable SQLite test applies migrations 0054–0061,
materializes exact synthetic source/workflow data, proves one fresh assessment,
proves exact replay, injects a hidden alternate-phone collision, and confirms the
next invocation stops before the writer. It also injects an unexpected Revenue
trigger and proves schema drift blocks execution. The safety gate locks the command,
authority fields, absence of Worker wiring, and collision-complete planner.
