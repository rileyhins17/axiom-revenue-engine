# KW lead-quality evaluation guide

## What this is

Before the engine is allowed to contact anyone, Riley will review 50 real
Kitchener, Waterloo, and Cambridge businesses across roofing, HVAC, and
landscaping. This teaches the engine what Axiom considers a genuinely worthwhile
opportunity. It is a one-time launch gate, not a weekly chore.

The current progress is **0 of 50 real leads loaded**. The repository now has the
validated format, scoring gate, and resumable owner-labelling checkpoint; real
lead records will stay in the private database or ignored local evaluation
storage, not in Git documentation.

## Safe private loading

The preparation path is implemented. Codex—not Riley—will normally operate it:

```powershell
npm run kw:prepare-import -- --input data/kw-evaluation/input.json --output data/kw-evaluation/plan.json
```

Both files must be direct children of the ignored `data/kw-evaluation/` folder.
The command refuses to overwrite an existing plan. It accepts at most 50 records
and only Kitchener, Waterloo, or Cambridge businesses in roofing, HVAC, or
landscaping. It validates public source/website URLs, Canadian phone/postal
formats, stable identity signals, duplicate source IDs, and potential duplicate
businesses.

The seed version accepts only manual research or the read-only legacy export and
requires provider cost to be zero. Social/listing pages remain source evidence;
they cannot masquerade as the business's website. Prepared businesses stay
`RESEARCH_ONLY`, with qualification and outreach explicitly unauthorized.

Preparation creates separate source-run records for each city/niche cohort and
shows the exact remaining count and balance. It does not audit a website, call a
provider, create an email candidate, or load staging/production D1.

The prepared plan can now be converted into a separate validation-only
persistence artifact:

```powershell
npm run kw:plan-persistence -- --input data/kw-evaluation/plan.json --output data/kw-evaluation/persistence.json
```

This command also stays entirely inside ignored local storage and refuses to
overwrite output. It proves the proposed source-run, business, location, and
source-record fields match the shadow schema, and prepares exact preflight checks
for collisions or drift. It does **not** connect to any database or provider,
write D1, audit or qualify a business, create contact data, or authorize a
mutation. The output says `mutationAuthorized: false`. Any future executor must
revalidate the original versioned input, reproduce the same plan from trusted
code, pass every exact preflight, and receive a separate release approval.

Before the full 50-lead labelling exercise, a ten-business integration slice can
be defined from the exact source plan:

```powershell
npm run kw:prepare-shadow-slice -- --source-plan data/kw-evaluation/plan.json --selection data/kw-evaluation/shadow-slice-selection.json --output data/kw-evaluation/shadow-slice-manifest.json
```

Riley or Aidan must first verify each selected business's identity, independent
status, city, and niche. The ten must include at least two businesses from each
pilot city and each pilot niche, and their source evidence must be no more than
90 days old. The output binds that review to the exact source plan and records
the five-step path from source/workflow through the owner dossier.

This is a scope manifest, not a run command. Every phase still needs its own
approval and receipt. The manifest authorizes no database write, live source,
Browser Rendering, storage, discovery/verification provider, consent decision,
qualification, mailbox sync, outreach, deployment, send, or spend.

The first separately approved assessment executor now exists for an ignored
local SQLite database only. Codex will prepare the invocation after Riley reviews
one record; Riley does not need to hand-author JSON. The command is:

```powershell
npm run kw:execute-assessment -- --source-plan data/kw-evaluation/plan.json --invocation data/kw-evaluation/assessment.json --database data/kw-evaluation/shadow.sqlite
```

It requires migrations 0054–0067, every exact source row, and the exact terminal
sealed website-evidence receipt to already exist in that local file. It rechecks
all alternate identities and rejects missing, changed, or multiple matches. The
approval binds one candidate, one receipt, the reviewed scoring evidence, and a
current timestamp. A successful run creates only immutable website/evidence,
qualification, and assessment rows; reachability remains zero and the route is
`RESEARCH`. It cannot load source/workflow data, discover contacts, use
Cloudflare, call a provider, spend money, or contact anyone.

## Resumable owner labelling

After all 50 selected businesses have current assessment receipts in the ignored
local database, Codex can prepare Riley's review packet with:

```powershell
npm run kw:prepare-owner-labeling -- --source-plan data/kw-evaluation/plan.json --database data/kw-evaluation/shadow.sqlite --output data/kw-evaluation/owner-labeling.json
```

The command opens the database read-only, reconstructs each current assessment
from its exact sealed receipt, and binds the result to the source-plan and
assessment contents. The output shows the business, city, niche, website audit,
five visible scores, engine label, evidence, and current review status. It never
changes the database, a score, qualification, consent, outreach, sending, a
provider, or spend. It refuses to begin review with fewer or more than the fixed
50 businesses, or when even one current exact assessment is missing, so later
cohort growth cannot invalidate completed labels.

Riley can review any convenient batch instead of finishing all 50 in one sitting.
Codex will normally prepare a separate `owner-reviews.json` file that identifies
the exact packet, contains Strong/Weak/Wrong choices, at least one reason per
choice, and an optional note. Record that batch as a new checkpoint with:

```powershell
npm run kw:record-owner-labels -- --packet data/kw-evaluation/owner-labeling.json --reviews data/kw-evaluation/owner-reviews.json --output data/kw-evaluation/owner-labeling-next.json
```

Never overwrite the prior packet. Every output names its parent and has a new
content-derived identity, so a future Codex task resumes from the latest file
without rebuilding chat history. Changed packets, duplicate decisions, unknown
leads, attempts to relabel a completed entry, and reviews dated before the packet
all fail closed. This is the durable file workflow; the owner-facing app screen
will use the same contract in a later UI milestone.

## What Riley will do

For each business, the app will show its website capture, the engine's scores,
and the proof behind every finding. Riley chooses one label:

- `Strong` — Axiom should seriously consider contacting this business.
- `Weak` — it is a real business, but the opportunity is not good enough.
- `Wrong` — wrong identity, chain/franchise, wrong market, wrong business type,
  or another hard mismatch.

Riley then chooses at least one short reason. A note is optional. No email is
sent from this review.

## Passing gate

The evaluation is complete only when:

- Exactly 50 unique businesses have current audit evidence.
- Every business has Riley's label and at least one reason.
- Each city has at least 10 businesses.
- Each niche has at least 10 businesses.
- Riley and the engine agree on at least 85% of the set.

If agreement is lower, the engine's rules are corrected and the same versioned
set is rescored. The system does not quietly change its scoring policy.
