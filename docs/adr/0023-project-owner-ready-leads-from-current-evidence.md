# ADR 0023 — Project owner-ready leads from current evidence

**Status:** Accepted
**Date:** 2026-08-25
**Deciders:** Riley Hinsperger and the Revenue Engine integration owner

## Context

The legacy Vault leads with record counts, email availability, and outreach
state. Those fields cannot answer Riley's actual questions: which business is
worth reviewing, why, whether the proof is current, and what legitimate route is
available. The v2 shadow tables contain the necessary business, location, source,
audit, evidence, contact, verification, and qualification records, but previously
had no owner-safe read model.

The owner view must also remain useful when no email exists. It cannot trust a
stored total alone, silently use stale evidence, allow one business's data to
contaminate another, or turn a read response into outreach authority.

## Decision

Create a versioned, deterministic `OwnerLeadProjection` and a bounded
`OwnerLeadListResponse` over the v2 shadow records.

The projection:

- keeps rebuild need, business fit, reachability, timing, and evidence confidence
  separate and recomputes the approved weighted total;
- replays current qualification from the stored scores, supported audit claims,
  current usable route, and chain/suppression blocks instead of trusting the
  stored band or route;
- treats source records as current for at most 90 days and website audits for at
  most 60 days; future, stale, mismatched, or drifted facts become explicit
  refresh work;
- rejects cross-business audit, qualification, or contact contamination;
- ranks current verified named email, verified role email, phone, form, social,
  then research, while keeping every non-email action manual;
- rejects catch-all, stale, unverified, generic/unknown-recipient email from the
  usable email route;
- shows up to three strongest exact evidence observations as “why this lead,”
  retaining URL, time, confidence, category, and artifact reference; and
- always returns read-only/shadow state with qualification, outreach, send,
  mutation, provider-operation, and cost authority false or zero.

The D1 reader uses two bounded `SELECT` contracts: at most 100 latest KW business
rows and their current contact/verification rows. It validates all JSON and
public URLs, omits malformed contact routes, reports rejected business rows with
bounded codes, and never exposes parser/provider exception details.

Expose the list through authenticated, dynamic `GET /api/v1/leads` with private
`no-store` response headers and a 1–100 limit. No other HTTP method is defined.

## Options considered

### Option A — Extend the legacy Vault query and UI

| Dimension | Assessment |
|---|---|
| Complexity | Low initially, high as legacy/v2 semantics mix |
| Safety | Weak; email and old outreach fields remain easy to over-trust |
| Owner usefulness | Limited by record-centric response shape |
| Migration path | Poor; creates more coupling to tables being retired |

**Pros:** Small immediate UI change.

**Cons:** Preserves vanity metrics, stale qualification assumptions, and legacy
table coupling.

### Option B — Read directly from every v2 table in React components

| Dimension | Assessment |
|---|---|
| Complexity | Medium, duplicated across screens |
| Safety | Inconsistent validation and freshness decisions |
| Owner usefulness | Can look good but drift between list/detail views |
| Migration path | Weak contract for API, mobile, or tests |

**Pros:** Fast screen-specific experimentation.

**Cons:** Business rules leak into UI code and become difficult to test or reuse.

### Option C — Versioned owner projection plus SELECT-only reader

| Dimension | Assessment |
|---|---|
| Complexity | Medium and isolated |
| Safety | Strong, schema-validated, fail-closed, zero-authority |
| Owner usefulness | Directly represents next lead, proof, route, and refresh need |
| Migration path | Stable contract for list, detail, mobile, and later repository changes |

**Pros:** Separates business truth from presentation, preserves non-email lead
value, and makes stale/drift behavior testable.

**Cons:** Adds an explicit mapping layer and requires complete v2 audit and
qualification rows before real businesses can appear.

## Trade-off analysis

Option C adds more source code now, but it prevents the UI from becoming another
authority surface and prevents the rebuild from deepening its legacy dependency.
The pilot is at most 50 labelled leads, so a bounded two-query read is simpler and
cheaper than introducing a cache, search service, or denormalized mutable table.
Pagination and materialization can be reconsidered only after measured need.

## Consequences

- The owner Leads UI can now be built against one stable, plain-language contract.
- A business without email can rank above a weaker business that has one.
- Bad or stale data becomes visible refresh/research work rather than a false lead.
- The API cannot approve, mutate, send, call a provider, or incur cost.
- The owner list is rendered directly in an authenticated Server Component from
  the same bounded read model rather than self-fetching its own HTTP API. It
  shows separate scores, exact evidence, the best route, and explicit empty,
  refresh, blocked, loading, rejected-data, and unavailable states.
- The owner list has no buttons, forms, direct email/phone links, provider calls,
  or write methods. The safety checker makes those constraints a release gate.
- Primary navigation and the installed-app shortcut now open `/leads`; `/vault`
  remains a legacy reference while migration is incomplete.
- Real results remain empty until v2 website/audit/qualification writers are
  separately implemented and verified; stale legacy records are not backfilled
  into current qualification automatically.
- No console or engine deployment, remote migration, provider request, mailbox
  action, or prospect contact occurred in this decision.

## Action items

1. [x] Build the owner Leads list from this contract using synthetic fixtures
   and honest current/empty/error/loading/refresh/blocked states.
2. [ ] Build the lead detail experience from the same projection without
   inventing unavailable history or evidence.
3. [ ] Add automated keyboard, responsive, accessibility, and owner-task timing
   tests.
4. [ ] Implement separately gated v2 audit/qualification persistence before a
   shadow-data staging deployment.
