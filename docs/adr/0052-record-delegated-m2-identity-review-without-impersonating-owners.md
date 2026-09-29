# ADR 0052: Record delegated M2 identity review without impersonating owners

**Date:** 2026-09-23. **Status:** accepted for the local M2 selection path.

## Context

The original M2 identity ledger accepts only a review personally performed by
Riley or Aidan through the named-owner local UI. Riley subsequently delegated
the ten individual business decisions to Codex. Writing those decisions as if
Riley or Aidan had personally made them would make the evidence trail false.
The ten-case selection still needs exact source links, an immutable packet,
supported replacements, market/niche balance, and no execution authority.

## Decision

Keep the existing owner UI, authenticated save route, and v1 owner ledger
unchanged. Add a separate strict offline ledger version for the delegated
review. It records `reviewer: CODEX`, `delegatedBy: RILEY`, the exact chat
instruction and its SHA-256, this task's real conversation reference, review
time, scope limited to M2 identity selection, the exact research-review file
SHA-256, the source-plan digest, and one explicit disposition with rationale
for each M2-01 through M2-10. The private preparation command validates the
ledger and copies the delegation provenance into each selected record's
digest-bound shadow manifest. The existing v1 owner route cannot create a v2
ledger or claim Codex review on an owner's behalf.

The selected manifest remains `SHADOW` and plan-only. All live source,
capture, artifact, database, contact, qualification, outreach, send,
deployment, provider, and spend authorities remain false or zero. Existing
access-block and exact supported-alternate checks still apply; a company can
be a valid identity and still be excluded from the executable capture cohort.

## Consequences

The review can advance without asking Riley to click through ten rows, while
the provenance says exactly who judged the evidence. The private review,
source plan, decision ledger, and manifest stay in ignored
`data/kw-evaluation/`; their hashes and summary belong in `docs/STATUS.md`.
This local file receipt is not a cryptographic signature from Riley. Source
rights, a supervised capture, owner release gates, and independent evidence of
website need remain separate. An agent-generated M2 review must not be
presented as a founder's firsthand evaluation or used as proof that a company
is a qualified sales opportunity.
