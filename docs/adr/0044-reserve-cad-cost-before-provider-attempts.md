# ADR 0044: Reserve CAD cost before provider attempts

- Status: implemented as an inert D1 boundary; provider integration and release remain gated
- Date: 2026-09-22
- Scope: shared cost control prerequisite for paid M2 capture/storage and later provider work

## Problem

The existing `RevenueCostLedger` records incurred USD usage after work. It cannot
prevent two concurrent jobs from each seeing the same remaining budget, nor can
it safely account for a provider attempt whose outcome is unknown. The C$50
monthly ceiling needs a shared admission decision before any paid attempt.
Published free tiers and estimated prices do not prove that an account, quota,
tax treatment, or transaction is free.

## Decision

Migration `0070_revenue_cost_reservations.sql` adds a provider-independent,
append-only D1 ledger. All amounts are integer CAD micro-units. Each configured
calendar month uses canonical America/Toronto midnight boundaries and records
the price, FX, and tax versions plus fixed commitments. Its forecast is fixed
commitments + settled actuals + every unresolved hold. A reservation consumes
the worst-case quoted amount before an attempt can start. The shared budget
rejects a discretionary reservation beyond C$42.50 or the portion of C$50
reserved for essential work, and rejects any reservation beyond C$50. C$35 is
a warning threshold, not spending authority.

The typed D1 boundary admits a reservation with an atomic conditional insert
and readback. Database triggers enforce period, quote, version, and budget
rules even for a direct insert. The first committed attempt start is the only
result that returns `mayCallProvider: true`; a replay never grants a second
provider call. An uncertain attempt retains its hold. A hold can be released
only with recorded proof before an attempt starts. Settlement records the
provider's observed actual, including an overrun; an overrun reduces future
capacity rather than being hidden by the quote. Idempotency identity and exact
request fields must match on replay. Ledger records cannot be updated or
deleted through normal SQL.

This boundary grants no provider, browser, mail, queue, migration, deployment,
or spend authority by itself. It is not connected to any provider route. A
budget period must not be configured from a planning scenario: activation needs
verified account/quota, current price and quote, FX and tax basis, known fixed
and prepaid commitments, an owner-approved cash-outlay cap, a backup and
rollback path, and staging D1 acceptance. The same reservation must be wired
into the actual provider attempt path and reconciled with provider receipts
before a paid production operation. The ledger is an internal control, not a
provider balance or a guarantee against charges outside the engine.

## Alternatives and consequences

Post-hoc usage logging alone permits concurrent over-admission. Per-provider
counters cannot enforce one shared C$50 ceiling. Floating-point CAD amounts
would allow rounding differences at the threshold. The chosen shared ledger
adds explicit quote/configuration work and requires an operator to resolve
ambiguous attempts, but makes those costs and stop decisions auditable.

Local SQLite-backed D1 fakes verify concurrent admission, exact threshold and
essential-reserve behavior, replay identity, direct-SQL guards, ambiguous
holds, settlement overrun, and Toronto daylight-saving boundaries. These tests
prove the boundary logic only; they do not prove a live account, D1 migration,
current provider price, or actual spending control at a connected route.
