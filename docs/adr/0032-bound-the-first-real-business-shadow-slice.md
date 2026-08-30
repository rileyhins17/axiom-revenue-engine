# ADR 0032 — Bound the first real-business shadow slice

**Status:** Accepted
**Date:** 2026-08-28
**Deciders:** Riley Hinsperger and the Revenue Engine integration owner

## Context

The repository can now preserve one manually reviewed source/workflow,
assessment, and fixture contact bundle and display it in the owner dossier. The
next step is to prove the chain on real businesses without turning “try the new
pipeline” into unbounded acquisition, browser use, provider spend, database
writes, or outreach.

A list of business IDs alone is not a safe pilot. It would not prove that the
identity, city, niche, independence, source freshness, phase order, or owner
review survived a lost Codex task. It could also be mistaken for authority to
execute all downstream phases.

## Decision

Create a content-bound, ignored-local manifest for exactly ten Kitchener,
Waterloo, and Cambridge businesses:

- Every candidate must already exist in one exact private source plan, be
  confirmed independent, have source evidence no more than 90 days old, and
  carry Riley's or Aidan's explicit identity/market/niche review.
- The slice must include at least two businesses from each pilot city and each
  pilot niche. This prevents a convenient cluster from masquerading as a useful
  cross-market test.
- The manifest records the fixed sequence `source/workflow → current website
  evidence → assessment → contact review → owner dossier` and the proof required
  to complete each phase.
- Every phase still requires its own existing or future approval. The manifest
  authorizes zero database mutations, live source work, Browser Rendering,
  artifact storage, contact discovery or verification, consent decisions,
  qualification, mailbox sync, outreach, deployment, sends, provider operations,
  or cost.
- Preparation is a deterministic no-overwrite command confined to ignored
  `data/kw-evaluation/` JSON files. It cannot access a database, runtime binding,
  provider, or network.

The first manifest checkpoint is `SOURCE_REVIEWED`; the next required gate for
each business is `SOURCE_WORKFLOW_MATERIALIZATION_APPROVAL`. Later work must add
receipt-bound progress rather than editing a checkpoint optimistically.

## Options considered

### Process whichever real businesses are easiest

Fast, but unbounded and impossible to distinguish from normal acquisition. It
would bias the test toward one city or niche and leave no durable scope.

### Use the full 50-lead quality set immediately

This would combine pipeline integration and score calibration into one large
failure surface. Ten businesses are enough to expose integration problems before
Riley spends time labelling all 50.

### Use a fixed, reviewed ten-business manifest

This adds one small preparation step but creates an exact resume point, useful
commercial coverage, and a hard authority boundary. This option was selected.

## Consequences

- A future task can identify the exact ten businesses and next gate without
  reconstructing chat history.
- A stale, duplicate, unbalanced, unconfirmed, non-independent, or source-drifted
  selection fails before any execution step.
- The manifest is a plan, not a batch runner. Separate approvals and receipts
  remain mandatory for every business and phase.
- Real business data remains ignored and private; only the contract, tests, and
  operating procedure are committed.
- No provider, database, website, Cloudflare resource, prospect, or paid runtime
  is touched by this decision.

## Action items

1. [x] Add the exact-ten typed manifest, source-lineage and coverage checks, and
   content-derived identity.
2. [x] Add a guarded ignored-local no-overwrite preparation command and safety
   enforcement.
3. [x] Prove deterministic ordering, tamper rejection, source drift, duplicate,
   stale, independence, and coverage failures with synthetic tests.
4. [ ] Populate ten real reviewed source records only after the separate private
   research decision; do not scrape or use a paid source implicitly.
5. [x] Add immutable, parent-linked, receipt-bound per-business progress. One
   append records one fixed next phase, exact upstream proof IDs/digests, and the
   prior business receipt without executing or authorizing that phase.
6. [x] Add the read-only source/workflow proof adapter. It re-derives the exact
   approved materialization, verifies the complete canonical stored row set and
   sealed terminal receipt, and emits the first normalized progress input without
   executing a workflow or mutating SQLite.
7. [x] Define the content-addressed current-website-evidence proof against the
   existing fixture workflow, deterministic audit, durable persistence, artifact
   manifest, and availability contracts. Keep it synthetic-only and require a
   separate trusted eligibility receipt before any progress append.
8. [x] Define the content-addressed assessment progress proof against the exact
   completed website-evidence phase, sealed workflow/audit lineage, immutable
   assessment identities, and committed-and-reloaded persistence result. Require
   it as a separate progress reference without creating a phase-input adapter.
9. [x] Define the trusted website-evidence eligibility boundary before any real
   assessment progress. It now requires one exact frozen fresh-commit D1
   completeness execution and current R2 HEAD receipt per content-addressed
   artifact, rejects copied trust, and creates no phase input. Browser/R2
   activation, live D1, durable persistence, and owner approvals remain
   separate.
10. [x] Persist and reload one exact eligibility receipt through append-only
    schema 0068. The private injected D1 boundary requires the original trusted
    in-process result for a new commit, revalidates canonical storage after a
    process loss, and keeps current versus stale history explicit without
    creating phase input.
11. [x] Define a validation-only current-website-evidence phase-input adapter
    that accepts only the exact current durable reload result and still cannot
    append progress or authorize downstream work.
12. [x] Define a separate guarded progress-append boundary that accepts only the
    exact module-private current-website-evidence input and its unchanged parent
    checkpoint. Keep it disconnected from operator commands, live bindings, and
    real data until those approvals exist.
13. [ ] Replace the synthetic assessment persistence claim with an exact trusted
    durable assessment execution/reload boundary before creating an `ASSESSMENT`
    phase input. Schema-valid copied execution JSON must never become authority.
14. [ ] Stop on stale evidence, duplicate identity, source-plan drift, imbalance,
    or an unconfirmed/unknown chain status. Never loosen the manifest to make a
    candidate fit.
