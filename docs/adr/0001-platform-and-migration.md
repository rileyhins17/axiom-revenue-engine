# ADR 0001 — Keep Cloudflare and migrate beside legacy

- Status: accepted
- Date: 2026-08-16

## Decision

Keep the owner console on Next.js/OpenNext/Cloudflare. Build new processing in a
separate typed Cloudflare Worker. Use Workflows for durable multi-step processing,
Queues for bounded fan-out, D1 for operational records, and R2 for screenshots and
evidence. Create new Revenue Engine resources beside legacy resources and cut over
only after shadow/reconciliation gates.

## Why

This minimizes Riley's maintenance burden and fits the C$50 runtime ceiling. A
self-managed VPS/Postgres stack would add patching, backups, monitoring,
networking, and recovery work without improving the KW pilot. Separating the
console from processing prevents request/cron CPU limits from defining the
business workflow.

## Consequences

- Legacy self-dispatch remains temporarily but receives no new responsibilities.
- Every new step must be idempotent, retry-safe, serializable, cost bounded, and
  visible through a workflow receipt.
- New resources cost money only after an explicit budget check.
- Legacy resources are retained for rollback for at least 30 stable days.
