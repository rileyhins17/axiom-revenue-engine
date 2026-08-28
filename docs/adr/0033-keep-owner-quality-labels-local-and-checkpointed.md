# ADR 0033 — Keep owner quality labels local and checkpointed

**Status:** Accepted
**Date:** 2026-08-28
**Deciders:** Riley Hinsperger and the Revenue Engine integration owner

## Context

The fixed 50-business evaluation contract can prepare and record exact,
parent-linked owner-label checkpoints, but Riley should not have to inspect or
hand-edit JSON. A normal database-backed form would be convenient, but it would
also create a new mutation path before the quality gate, staging migration, and
release boundaries are ready.

The owner needs a fast visual workspace without turning a quality opinion into
qualification, consent, outreach, or send authority. Draft work must also
survive a browser refresh or interrupted Codex task without becoming system
truth prematurely.

## Decision

Add an authenticated Quality Lab at `/leads/evaluation` with a narrow file
handshake:

- Riley loads the exact 50-business owner-label packet created by the existing
  read-only preparation command.
- A private/no-store same-origin route accepts only bounded JSON, revalidates the
  complete packet and content digest, and returns a narrower owner view. It has
  no database, provider, or storage binding.
- The workspace shows business identity, city, niche, audit classification,
  five separate scores, the engine label, and the URL-backed evidence behind
  the verdict.
- Riley or Aidan chooses Strong, Weak, or Wrong, at least one label-appropriate
  reason, and an optional note.
- In-progress decisions live only in browser storage under the exact packet
  digest. Unknown leads, changed packets, and mismatched label/reason pairs are
  not restored.
- Export creates the existing immutable review-submission format. The guarded
  local CLI remains the only way to record that submission into a new
  parent-linked checkpoint.

The screen has zero authority to change the database, score or qualify a lead,
assess consent, run a provider, contact a business, send email, deploy, or spend
money.

## Options considered

### Write every click directly to D1

This would reduce one file step, but it would introduce mutation, migration,
deployment, idempotency, rollback, and permission questions into a calibration
gate that does not need them.

### Ask Riley to edit review JSON

This preserves the safe checkpoint model but creates needless owner friction and
makes malformed labels more likely.

### Use a verified file in, immutable file out workflow

This keeps the proven resume boundary while providing an owner-grade UI. It was
selected.

## Consequences

- Riley can review a lead in plain language without learning the repository
  format.
- Refresh-safe drafts are convenient but do not become durable system truth
  until exported and recorded by the guarded command.
- A file from a different checkpoint cannot silently inherit prior decisions.
- There is still one explicit handoff between the app download and the local
  recording command. Codex normally performs that step for Riley.
- Nothing in this decision publishes the screen to staging or enables real-data
  collection.

## Action items

1. [x] Add the authenticated bounded validation route and fixed-50 projection.
2. [x] Add the evidence-first desktop/mobile Quality Lab with local draft
   recovery and immutable export.
3. [x] Add schema, tamper, reason, safety, accessibility, responsive, download,
   and resume tests.
4. [ ] Include the screen in a separately approved isolated-staging release.
5. [ ] Use it only after the real fixed cohort has current exact assessments.
