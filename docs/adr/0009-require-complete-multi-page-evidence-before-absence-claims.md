# ADR 0009 — Require complete multi-page evidence before absence claims

- Status: accepted
- Date: 2026-08-22

## Decision

Assemble one versioned, business-level website-audit input from selected page
captures, extracted HTML facts, Browser measurements, and completed artifact
receipts. A full page set requires one captured `HOME`, `SERVICE`, `ABOUT`, and
`CONTACT` page. Every selected page needs complete HTML plus measured desktop
render, action, and form coverage; the homepage also needs complete mobile
layout, navigation, text, action, and form measurements.

Missing, failed, or incomplete required pages make the assembly `PARTIAL`. The
deterministic audit advances to `website-audit-deterministic-v3`, in which the
absence of a usable form is a supported failure only when the complete page set
was actually observed. Partial coverage remains `UNKNOWN` and cannot create an
outreach claim.

The assembly rejects cross-business, cross-page-kind, cross-site, duplicate-URL,
noncanonical, stale, future-dated, excessive-skew, over-budget, or artifact-
receipt-mismatched evidence. Whole-business caps are five selected pages, six
Browser captures, 120 Browser seconds, 30 MiB of artifacts, 5 MiB of HTML, a
24-hour evidence age, and two hours between the oldest and newest item.

Version 1 accepts only shadow fixture inputs, authorizes no provider operation,
and has a zero-dollar budget. It is not connected to the Worker, Browser
Rendering, R2, D1, or a live website.

## Why

Checking only a homepage can make a good business look like a bad lead. Contact
forms, services, team proof, credentials, and local detail often live on separate
pages. The engine must distinguish “not found after complete inspection” from
“not observed because the page was never captured.” That distinction directly
protects lead quality and prevents generic or unsupported outreach.

Budgets and timestamps belong to the assembled business audit rather than only
individual calls. Otherwise five individually valid captures could collectively
be too old, too expensive, or too far apart to describe one current website.

## Consequences

- A complete audit is more expensive than a homepage-only audit, so future page
  selection must be bounded and deterministic.
- Non-home mobile renders are optional for version 1; homepage mobile evidence is
  mandatory because it covers the highest-value first impression and primary
  conversion path within the six-capture budget.
- Extra selected pages must also be complete or the page set remains partial;
  optional work cannot silently weaken evidence confidence.
- Artifact receipt identity, content-addressed references, workflow ownership,
  evidence freshness, and business-level budgets are verified before merge.
- Page discovery/selection and live Browser/R2 adapters remain separate release
  gates with no production authority.
