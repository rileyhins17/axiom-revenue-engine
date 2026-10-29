# ADR 0011 — Select high-signal pages before capture

- Status: accepted
- Date: 2026-08-22

## Decision

Create one deterministic `WebsitePageSelectionPlan` from fresh homepage HTML
facts before capturing subpages. Version 1 selects exactly one URL for each of
`SERVICE`, `ABOUT`, and `CONTACT`, in addition to the already captured `HOME`.
Each candidate retains its three role scores, eligible roles, final decision, and
plain reason codes.

Rank the three roles as one global assignment rather than three unrelated sorts.
One URL may be eligible for several roles but can fill only one. The algorithm
first maximizes required-role coverage, then total role score, then a stable URL
tie-break. Each role considers at most its ten strongest candidates, bounding the
complete search to 1,331 combinations.

Service scoring uses the configured niche and expected-service words/phrases so a
specific relevant page can beat a generic services index. About and contact
scoring recognizes common local-business wording such as “Why choose us,” “Our
team,” “Get in touch,” “Request service,” quote, estimate, booking, and
consultation.

Candidates are ineligible when they are a homepage duplicate, contain a query,
resolve to a non-HTML file, or describe policy, news/blog/resources, careers,
account/commerce, FAQ, financing, rebates, or promotions. Inputs must already be
canonical public URLs on the homepage authority. Homepage facts may be at most 24
hours old and cannot postdate the plan.

The plan is `READY` only when homepage extraction was complete and every required
role has a unique eligible URL. Otherwise it is `PARTIAL` with exact missing-role
and discovery warnings. Version 1 is deterministic fixture-only work with no
provider operation and a zero-dollar budget.

## Why

The old pipeline crawled pages mainly to find email and could repeatedly inspect
whatever links happened to look convenient. A website-rebuild recommendation
needs deliberate coverage: what the business sells, who it is, and how a customer
can act. Selecting those pages before capture makes coverage explainable,
repeatable, bounded, and relevant to lead quality.

Independent per-role sorting can select the same ambiguous page several times or
choose a generic index over the actual high-value service. Global assignment and
business-specific service signals avoid both errors without AI cost.

Treating incomplete link extraction as complete would turn “not discovered” into
“does not exist.” A partial plan must therefore remain an evidence gap rather than
authorize random extra crawling or a negative website claim.

## Consequences

- The same homepage facts and business context always produce the same ordered
  plan regardless of input-link order.
- Candidate scores and exclusions are owner-auditable; no opaque AI page choice
  controls what becomes a website weakness.
- Cross-site or unsafe URL contamination fails before planning. No candidate is
  fetched by this module.
- Query-driven sites and legitimate single-page sites may remain partial in
  version 1. That is conservative: they require a later explicit section/query
  coverage design and cannot be mislabeled as defective meanwhile.
- Sitemap discovery, section-level single-page coverage, multilingual preference,
  live capture orchestration, and persistence remain separate versioned gates.
