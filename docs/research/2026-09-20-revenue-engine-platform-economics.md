# Revenue Engine platform economics (2026-09-20)

## Recommendation

Keep the current modular Cloudflare design and finish it in bounded, local-first
milestones. The repository already has a console Worker, separate shadow engine,
D1 bindings, Browser binding, and disabled cron/autonomy switches. D1/R2,
Queues, and Workflows map directly to the evidence and receipt contracts. A
rewrite to a managed outbound/CRM product would add subscription and migration
cost while weakening the evidence-first and owner approval boundaries. A local
operator-assisted pilot is the right first release: fixtures or manually
prepared leads, deterministic audits, owner review, and no provider keys or
automated sends. Move selected steps to cloud only after the local gate passes.

This is an operating-cost analysis, not authorization to create resources,
connect mailboxes, buy credits, or send messages.

## Current stack economics

Cloudflare's Workers Free plan includes 100,000 requests/day and 10 ms CPU per
invocation. Workers Paid is US$5/month per account, with 10 million requests
and 30 million CPU-ms included monthly; service bindings do not add another
request fee. D1 is available on both plans: Free includes 5 million rows read
and 100,000 rows written per day plus 5 GB storage; Paid includes 25 billion
rows read, 50 million rows written, and 5 GB storage monthly before overage.
R2 Standard includes 10 GB-month storage, 1 million Class A operations, 10
million Class B operations, and free egress monthly. ([Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/),
[D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/),
[R2 pricing](https://developers.cloudflare.com/r2/pricing/))

Queues is now available on Free: 10,000 operations/day; Paid includes 1 million
operations/month, then US$0.40/million. A message normally consumes write,
read, and delete operations, and retries consume more reads. Workflows is on
both plans: Free includes 3,000 steps/day and 1 GB-month state; Paid includes
500,000 steps/month and 1 GB-month, then US$0.80/100,000 steps and US$0.20/GB
month. Workflows also consumes Workers requests/CPU. ([Queues pricing](https://developers.cloudflare.com/queues/platform/pricing/),
[Workflows pricing](https://developers.cloudflare.com/workflows/reference/pricing/))

Browser Run/Rendering is the main likely overage: Free includes 10 browser
minutes/day; Paid includes 10 browser-hours/month, then US$0.09/browser-hour,
with a separate US$2/concurrent-browser overage for Browser Sessions. ([Browser
Run pricing](https://developers.cloudflare.com/browser-run/pricing/))

These caps fit a small shadow slice if concurrency, page count, screenshot
retention, queue payload size, and retry counts are bounded. They do not prove
that a production cohort fits; instrument usage before enabling live bindings.

## Mail, verification, and public offer

Google's Canadian Business Starter page currently shows **C$11/user/month** on
flexible billing, or C$9.20/user/month on annual commitment, with 30 GB pooled
storage and custom email. The pricing page says prices exclude tax. Two real
mailboxes therefore cost C$22/month before Ontario HST on flexible billing, or
C$18.40 before tax with a one-year commitment; the latter is a commitment, not
a free monthly price. ([Google Workspace Canada pricing](https://workspace.google.com/intl/en_ca/business/))

For the initial low-volume pilot, Hunter is the only verifier budgeted: its
official Free plan is $0, requires no card, renews monthly, and gives 50 shared
credits across finding and verification. On Hunter's all-in-one plan, one
verification uses 0.5 credit, so dedicating the pool to verification permits up
to 100 charged results/month; unknown and disposable results use no credit.
Repeated verification is free within the billing period, but unused credits do
not roll over, and Free users cannot buy credit packs. The account may be shared
by the two owners, but the quota is shared. Use it as a manual verification
workbench, not its optional sequence sender. ([Hunter Free plan](https://help.hunter.io/en/articles/11060999-what-s-included-in-hunter-s-free-plan),
[credit rules](https://help.hunter.io/en/articles/1935055-email-verification-faqs),
[plan/credit limits](https://help.hunter.io/en/articles/11131690-pricing-plans-and-feature-faqs))

This supports 5–10 candidate emails/week without a verification purchase,
provided finding and verification share the 50-credit pool. If the pilot needs
more, route the excess to manual phone/form research or stop and request an
explicit budget decision; do not accumulate a large list to justify a minimum
prepaid order. ZeroBounce's US$39 minimum for 2,000 validations remains a
possible later cash outlay (about C$53.82 at the planning FX), not a recurring
C$5 line or a pilot assumption.

The current public offer is observable and should remain separate from system
economics: Axiom Web lists CAD $900 Local Launch, $1,200 Local Business
Website, $1,500 Expanded Website, and custom quoted work; standard packages
include first-year basic hosting and hosting from C$120/year afterward. ([Axiom
pricing](https://getaxiom.ca/pricing/))

## C$50 scenarios

Use **US$1 = C$1.38** only as a planning conversion; it is not a live FX quote.
Assume 13% Ontario HST for headroom, while noting that provider tax treatment
and account tax status must be confirmed at checkout. Existing actual spend,
domain renewal, source API, and mailbox state are unknown.

| Scenario | Monthly recurring | Prepaid / usage | Feasibility |
|---|---:|---:|---|
| Local operator-assisted, no provider keys | C$0 incremental | C$0; fixtures/manual review | Feasible; safest evaluation gate |
| Two Workspace mailboxes + Workers Paid | C$22 + C$6.90 = C$28.90 before tax; about C$32.66 with 13% planning tax | D1/R2/Queues/Workflows within included caps; Browser included if <=10 h/month | Feasible; leaves about C$17.34 before domain/source/AI |
| Above plus domain C$2, source C$5, Jev reserve C$1 | C$36.90 before tax; about C$40.66 if HST applies to Workspace/Cloudflare | Hunter Free verification; no prepaid order | Monthly feasible for 5–10 verified candidates/week, subject to shared credits |

The current plan's approximate C$50 allocation (C$18.40 Workspace, C$7
Cloudflare, C$7 OpenAI, C$5 source, C$5 verification, C$2 domain, C$5.60
buffer) is a planning envelope, not evidence that those commitments are
active or that C$5 buys verification. With no OpenAI API key, OpenAI usage is
currently C$0 and no API budget should be assumed. Jev remains optional and its
maximum C$1 allocation must sit inside the existing AI envelope, never be added
on top. Keep at least C$5 monthly uncommitted until real bills and taxes are
observed; if one flexible Workspace seat is not needed, defer it rather than
building a mailbox farm.

## Managed all-in-one comparison

HubSpot Sales Hub is a verifiable category benchmark: Free supports up to two
users, while Starter is listed at US$7/seat/month annually or US$20/seat/month
monthly. Two monthly Starter seats are about C$55.20 before tax, already above
the whole envelope, and still do not replace Workspace mailboxes, evidence
capture, or verification. Brevo is cheaper (Free, or Starter from US$9/month)
but is a marketing/CRM sending platform with volume/contact tiers, not a drop-in
replacement for this evidence and approval system. Neither is the recommended
primary architecture. ([HubSpot Sales pricing](https://www.hubspot.com/pricing/sales?tier=starter),
[Brevo plan pricing](https://help.brevo.com/hc/en-us/articles/208589409-About-Brevo-s-pricing-plans))

## Gates and capacity

Start with a 50-lead labelled evaluation and a 10-business shadow slice. Keep
autonomous intake, queues, follow-ups, and sends off. Set a monthly hard stop
before paid usage: reserve C$1 for optional Jev inside AI and C$5 for source
usage only after source quality is proven. Browser work should remain under 10
hours/month Paid (or 10 minutes/day Free), with a per-job browser-minute cap;
queue/workflow retries need explicit attempt identities. The initial outbound
capacity should be **5–10 first touches/week** while the owner review target is
about 30 minutes/week; that review target does not include sales replies,
delivery, or client work. The existing 50-lead labelled set is an evaluation
sample, not a weekly send quota. Expand only after two healthy review periods,
measured positive replies, bounce/complaint gates, and observed spend support it.

Cloudflare plus local pilot is economically feasible. Two paid mailboxes plus
Cloudflare is also feasible near C$33/month before tax, with Hunter Free covering
5–10 verified candidates/week if its shared quota is protected. The honest next
step is to prove the local workflow and measure real mailbox, source, browser,
verification, and review consumption before committing to a larger cloud or
managed stack.
