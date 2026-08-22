# KW lead-quality evaluation guide

## What this is

Before the engine is allowed to contact anyone, Riley will review 50 real
Kitchener, Waterloo, and Cambridge businesses across roofing, HVAC, and
landscaping. This teaches the engine what Axiom considers a genuinely worthwhile
opportunity. It is a one-time launch gate, not a weekly chore.

The current progress is **0 of 50 real leads loaded**. The repository now has the
validated format and scoring gate; real lead records will stay in the private
database or ignored local evaluation storage, not in Git documentation.

## What Riley will do

For each business, the app will show its website capture, the engine's scores,
and the proof behind every finding. Riley chooses one label:

- `Strong` — Axiom should seriously consider contacting this business.
- `Weak` — it is a real business, but the opportunity is not good enough.
- `Wrong` — wrong identity, chain/franchise, wrong market, wrong business type,
  or another hard mismatch.

Riley then chooses at least one short reason. A note is optional. No email is
sent from this screen.

## Passing gate

The evaluation is complete only when:

- Exactly 50 unique businesses have current audit evidence.
- Every business has Riley's label and at least one reason.
- Each city has at least 10 businesses.
- Each niche has at least 10 businesses.
- Riley and the engine agree on at least 85% of the set.

If agreement is lower, the engine's rules are corrected and the same versioned
set is rescored. The system does not quietly change its scoring policy.
