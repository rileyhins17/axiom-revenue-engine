# ADR 0028 — Version contact candidates and append verification history

**Status:** Accepted
**Date:** 2026-08-27
**Deciders:** Riley Hinsperger and the Revenue Engine integration owner

## Context

ADR 0027 separated evidence-backed contact discovery from channel verification,
but migrations 0054–0061 still had one mutable `RevenueContactPoint` row and a
loosely shaped verification table. Using the stable candidate identity as that
row's primary key would make an exact retry simple, but it would make a later
website observation impossible to record without overwriting history. Giving
every refresh a random identity would avoid updates but lose collision detection
and the relationship between successive observations of the same route.

Contact evidence also has two different lifetimes. An exact public observation
may support more than one discovery refresh, while the fact that a discovery
used it belongs to one exact candidate version. Consent is a later decision and
must not be inferred from public publication metadata or deliverability.

## Decision

Keep `candidateId` as the stable business/channel/value identity and persist a
separate immutable contact-point version whose ID binds the discovery result,
candidate ID, and candidate digest. A refreshed discovery therefore appends a
new version without overwriting the stable identity.

Migration 0062 adds the append-only tables, columns, and base guards; migration
0063 adds independent direct-SQL lineage checks. Together they provide:

- one immutable discovery receipt containing the exact validated result;
- version fields and exact candidate JSON on each future contact point;
- reusable immutable evidence claims plus discovery-owned evidence-use links;
- versioned verification result fields containing the exact result, source,
  freshness, derived owner status/action, and zero-authority receipt; and
- database triggers that reject loose future contact inserts, mismatched
  evidence use, forged verification projections, and every update/delete.

The validation-only persistence planner produces collision-complete SELECTs and
append-only INSERT statements. It requires the exact business to exist, checks
primary and alternate identities without row truncation, distinguishes fresh
plans from exact replay, and blocks incomplete parent/child record sets. Reusable
evidence may already match exactly during a fresh discovery. No executor exists,
and every database, mutation, qualification, provider, outreach, send, consent,
and cost authority remains false or zero.

The owner reader selects only the latest persisted version of each stable
candidate. It uses the latest verification's derived owner status, exposes email
deliverability only for email contacts, and preserves legacy rows through a
fallback when version fields are absent.

## Options considered

### Option A — One mutable row per stable candidate

Simple reads, but refresh requires updates, destroys exact historical evidence,
and makes deployment interruption or retry semantics ambiguous.

### Option B — Random row identity per observation

Append-only, but retries and alternate-identity collisions cannot be proven
deterministically and successive versions are hard to reconcile.

### Option C — Stable candidate identity plus content-bound versions

Adds explicit receipt and evidence-use records, but preserves exact history,
supports deterministic replay, and keeps owner-current state as a projection
rather than a mutable source of truth. This option was selected.

## Consequences

- Repeated discovery and verification append history instead of rewriting it.
- One evidence claim can be reused only when its complete content matches.
- An existing discovery receipt with a missing child record is corruption, not a
  partial retry to silently fill.
- `RevenueContactPoint.status` remains `CANDIDATE` for new versioned rows; usable
  or invalid owner state comes from the latest exact verification receipt.
- Migration 0062 makes legacy contact and verification rows immutable too, while
  leaving them readable during transition.
- Migration 0063 rejects count drift, a candidate detached from its discovery
  result, an unrelated evidence link, or a verification payload detached from
  the contact and derived owner projection.
- The schema and planner do not authorize contact discovery execution, database
  execution, consent, outreach, or sending.

## Action items

1. [x] Add migrations 0062–0063 with versioned records and database/lineage guards.
2. [x] Add deterministic persistence planning, replay/collision evaluation, and
   adversarial disposable-database tests.
3. [x] Update the synthetic owner acceptance fixture and current-route reader.
4. [ ] Build a separately approved local executor only after its source/workflow
   materialization and transactional post-verification boundary are designed.
5. [ ] Keep live providers, consent decisions, outreach, and sending behind
   separate owner and runtime release gates.
