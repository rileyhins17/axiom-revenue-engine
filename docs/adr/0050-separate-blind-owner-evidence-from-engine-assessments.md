# ADR 0050: Separate blind owner evidence from engine assessments

- Status: local implementation; no real 50-business evaluation completed
- Date: 2026-09-23
- Scope: the M3 Quality Lab first-pass judgment

## Problem

Quality Lab visually hid the engine verdict until the owner labelled a business,
but its original file upload and validation response both contained all 50
engine labels and scores. The browser could inspect them before any owner
judgment. The evidence view also exposed audit classification and severity cues
that could anchor the owner's decision. A visual reveal button alone could not
provide an independent first pass.

## Decision

Keep the canonical, immutable 50-business owner-labeling checkpoint as the
recording source. A local, no-overwrite split command derives two linked private
files from it: a **blind dossier** with factual identity, site state, captured
observations, source URLs, methods, and confidence; and an **assessment file**
with the engine's verdict, five scores, audit classifications, derived cues, and
full evaluation summary. The blind file has its own content digest. Both files
refer to the original checkpoint digest and the same exact cohort.

The authenticated first-pass endpoint accepts only the strict blind file and
returns a strict blind projection. The browser reviews the entire unreviewed
cohort and downloads a digest-bound first-pass judgment file before it can load
the assessment file. The reveal endpoint checks that all unreviewed businesses
have a complete label and matching reason, rejoins the files against exact IDs,
digest, policy, and the factual evidence shown in the first pass, then validates
the reconstructed original checkpoint. Only then does the browser receive
engine labels, scores, and agreement. Final reviews may still be exported in
batches and recorded through the existing immutable checkpoint command.

The downloaded first-pass file is a private audit artifact. A browser cannot
prove that a person never opened the separate assessment file or that a download
was retained, so this is a procedural independence boundary for an honest owner,
not a defence against an owner intentionally bypassing it. The full checkpoint
remains local and is required by the existing recorder. No server database stores
these files or owner drafts.

## Boundaries and exit gate

The split and review paths cannot acquire leads, call a provider, alter an
assessment, determine consent, contact a business, deploy, or spend. Before the
first-pass export, neither the review request, response, nor browser state may
contain engine labels, scores, agreement, readiness, or assessment-derived audit
cues. Partial, duplicate, mismatched, or tampered sidecars fail closed. Synthetic
tests and browser acceptance verify the boundary; they do not count toward the
50 real M3 judgments or authorize outreach.
