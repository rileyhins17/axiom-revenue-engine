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
5. [ ] Add receipt-bound per-business progress as each separately approved phase
   is exercised.
