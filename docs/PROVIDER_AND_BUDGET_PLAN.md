# Provider and budget plan

**Planning date:** 2026-09-20, America/Toronto. **Status:** proposal only. No
provider account, key, resource activation, purchase, migration, deployment, or
send is authorized by this document. The current [master plan](MASTER_PLAN.md)
is authoritative for sequencing and stop boundaries.

## Capability inventory

The repository contains a console Worker configuration with a D1 binding and a
Browser binding, and a separate shadow engine configuration with a registered
two-step Workflow class. The source contains D1 repositories, evidence/R2
contracts, queue/workflow-shaped orchestration, mailbox and AI adapter code,
and fixture/local tests. These are **built** artifacts, not proof of a live
service.

The configured console D1 and Browser bindings are **connected in configuration**
but their current remote deployment, billing state, data, and usage are
unverified. No R2 bucket, Queue, mailbox, Cloudflare Email Routing destination,
Resend account/API key, Hunter account, OpenAI account/key, Jev key, Vercel
account, paid source, or verification purchase is established by this inventory.
Public DNS observed on 2026-09-21 shows Cloudflare root MX/SPF, DMARC quarantine,
and a Resend verification token; it does not prove active forwarding, a provider
account/key, sender verification, complete DKIM, or send readiness. The shadow
Workflow is deliberately inert: no route,
schedule, queue producer/consumer, provider credential, or execution path is
present.

**Authorization** for provider activation or production sending is not granted
by this planning task; any earlier operational approval must be independently
matched to its exact scope and current conditions before use.
Checked configuration keeps cloud scrape, intake, queue, send, follow-up, and
autonomy switches off. **Verification** currently means local fixture/tests and
historical repository records only; it does not mean current remote health,
provider access, deliverability, or billing. Riley's confirmed absence of an
OpenAI API key is a fact about credentials now, not proof that no historical
OpenAI bill exists. Other account/key/billing states are unknown.

## Provider choices and validity

The selected platform is the existing Cloudflare console plus typed engine,
D1 for operational truth, R2 for private evidence artifacts, Workflows for
resumable steps, and a Queue only when bounded fan-out/backpressure is actually
needed. Cloudflare Workers Paid is US$5/account/month; Free includes 100,000
requests/day and 10 ms CPU/invocation. D1 Free includes 5M rows read/day,
100,000 rows written/day, and 5 GB; R2 Standard Free includes 10 GB-month,
1M Class A, 10M Class B, and free egress. Queues Free includes 10,000
operations/day; Workflows Free includes 3,000 steps/day and 1 GB-month state.
Browser Run Free includes 10 minutes/day; Paid includes 10 hours/month, then
US$0.09/browser-hour. These are published limits, not an internal spend
guarantee. ([Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/),
[D1](https://developers.cloudflare.com/d1/platform/pricing/),
[R2](https://developers.cloudflare.com/r2/pricing/),
[Queues](https://developers.cloudflare.com/queues/platform/pricing/),
[Workflows](https://developers.cloudflare.com/workflows/reference/pricing/),
[Browser Run](https://developers.cloudflare.com/browser-run/pricing/))

The selected first-pilot mail route has **zero paid mailbox seats**. Cloudflare
Email Routing is the inbound route to verified existing owner destinations;
Cloudflare's current official pricing documents inbound routing as available on
Workers Free/Paid and unlimited, while destination verification and active rules
remain account gates. Resend is the separate outbound/reply adapter candidate;
its published Free plan is a conditional $0 option, not proof of an account,
quota or verified sender. If forwarding plus the reviewed Resend or free
owner-only send-as route cannot meet reply ownership/privacy requirements, mail
activation remains blocked. Paid mailboxes and Workspace seats are out of scope
unless Riley explicitly reverses the zero-paid-mailbox decision. ([Cloudflare Email Routing pricing](https://developers.cloudflare.com/email-service/platform/pricing/),
[Cloudflare routing addresses](https://developers.cloudflare.com/email-service/configuration/email-routing-addresses/),
[Resend pricing](https://resend.com/pricing?product=transactional),
[Resend domain verification](https://resend.com/docs/add-a-domain))

Hunter Free is the proposed low-volume verifier: $0, no card, 50 shared monthly
credits across finding and verification, and 0.5 credit per verification on
its all-in-one plan. Credits reset and do not roll over; Free users cannot buy
credit packs. The shared cap must be protected for manual verification; Hunter's
optional sequence sender is not authorized. ([Free plan](https://help.hunter.io/en/articles/11060999-what-s-included-in-hunter-s-free-plan),
[credit rules](https://help.hunter.io/en/articles/1935055-email-verification-faqs))

OpenAI nano/mini remains reusable optional generative infrastructure, not a
connected dependency. The current plan's model IDs and prices must be checked
at order time against the official [OpenAI pricing page](https://developers.openai.com/api/docs/pricing);
Riley has no API key. Jev is optional after a working evidence path and does
not replace deterministic gates or generative drafting. TypeSafe publishes a
Jev price; its [Master Customer Agreement](https://typesafe.ai/legal/mca) specifies USD unless the Order says otherwise. OpenRouter lists version-named
`typesafe/jev-1.13` at US$0.042/M input with a US$5 prepaid minimum and
unspecified purchase fee; Vercel lists `typesafe-ai/jev` with a promotional
free route whose expiry and immutable version must be rechecked before use.
([TypeSafe](https://typesafe.ai/), [OpenRouter Jev](https://openrouter.ai/typesafe/jev-1.13),
[Vercel Jev](https://vercel.com/ai-gateway/models/jev))

## Exact C$50 planning example

Follow-up live catalog inspection confirms the Vercel promotion is advertised
to end September 25, 2026. See [the access investigation](research/2026-09-20-jev-vercel-access.md)
for Gateway authentication, evaluation API, account/plan eligibility, rate
limits, and budget semantics. Vercel Hobby terms restrict commercial use;
do not assume the Gateway promotion waives account terms or requires a paid
hosting migration. Any required plan fee must be added to this total budget;
the scenario below does not include a Vercel subscription. No plan was bought.

Use **US$1 = C$1.38** as a planning assumption only. Apply a uniform 13% tax
placeholder to the taxable subtotal for headroom; this is not tax advice and
actual provider tax/account treatment must be confirmed at checkout.

| Item | Monthly planning amount |
|---|---:|
| Cloudflare Email Routing inbound | C$0.00 published route price; account/destination state unverified |
| Resend Free outbound candidate | C$0.00 published plan price; account/domain/key/quota state unverified |
| Workers Paid: US$5 × 1.38 | C$6.90 |
| Domain renewal reserve | C$2.00 |
| Paid source | C$0.00 |
| Optional Jev reserve inside AI envelope | C$1.00 |
| Verification | C$0.00 (Hunter Free) |
| **Taxable subtotal assumption** | **C$9.90** |
| 13% planning tax: C$9.90 × 0.13 | C$1.287 |
| **Planning total: C$9.90 × 1.13** | **C$11.187 ≈ C$11.19** |
| **Remaining ceiling: C$50.00 − C$11.187** | **C$38.813 ≈ C$38.81** |

This is a scenario, not an active budget. The C$38.81 is contingency for
observed tax/FX, small usage, or owner-approved source/AI changes; it is not
permission to spend. A minimum prepaid order is separate from monthly accrued
use: OpenRouter's US$5 credit purchase is about C$6.90 before fees/tax and
should be shown as a cash-outlay approval even if expected monthly inference is
near zero. Unknown source pricing, unknown historical bills, and unknown
provider tax stop activation rather than receive invented allocations.

Reserve essential reply ingestion, suppression, and stop-control capacity before
optional discovery or AI. Preserve these operations within the reserved envelope;
this is not permission to exceed C$50. If provider quota, service availability or
remaining budget prevents them, stop new outreach and fall back to owner
destination monitoring and a durable local incident record. Never silently
discard suppression.

## Caps and stop levels

Use one internal monthly receipt ledger in CAD, recording provider, currency,
FX snapshot, fixed commitment, prepaid purchase, accrued usage, tax, estimate,
and evidence. A receipt is an internal accounting control; it is not a provider
balance, quota, invoice, or guarantee against provider-side overage.

The minimal reservation/settlement ledger must pass before any paid engine
provider operation, including manually triggered M2 capture/storage and M4
verification. Each attempt needs its bounded reservation receipt. Free-tier
operations still need validated account/quota state, usage evidence and an
overage stop; a published free allowance is not proof of a free actual run.

An inert D1 reservation/settlement boundary now exists in migration 0070 and
`src/lib/revenue-engine/cost-ledger-d1.ts` ([ADR 0044](adr/0044-reserve-cad-cost-before-provider-attempts.md)).
It is not configured or connected to a provider route. Do not treat its local
tests as a current account quote, a migrated production database, or approval
to incur a charge. Reconcile fixed/prepaid commitments and verify the exact
provider receipt before using this control for a live paid operation.

- **C$35 (70%)**: alert with the committed/spent/reserved forecast and remaining
  essential reserve. Review optional work; remain within each approved job cap.
- **C$42.50 (85%)**: stop all discretionary acquisition and new paid provider
  calls; preserve mailbox continuity, reply/suppression handling, audit records,
  and manual tasks; request an owner decision before resuming.
- **C$50 (100%)**: hard-stop nonessential cloud jobs, AI, source, Queue/Workflow
  fan-out, and any new outreach; retain only essential stop controls, reply and
  suppression ingestion, and records needed to close safely. Fixed provider,
  domain, or annual commitments cannot be retroactively stopped by software.

Proposed internal operational caps are 5–10 first touches/week total, 50 Hunter
credits/month shared, Browser Run <=8 hours/month on Paid (<=8 minutes/day on
Free), Queue <=5,000 operations/day, and Workflows <=2,000 steps/day. These are
internal guards, not provider guarantees. The 50-lead labelled evaluation is a
quality sample, not a weekly send quota; routine review targets about 30
minutes/week, excluding replies, sales, and delivery.

## Alternatives and recheck gate

The local operator-assisted pilot remains the zero-new-commitment alternative.
Managed CRM/outbound tools are not selected: even HubSpot Sales Starter at
US$20/seat/month monthly would cost about C$55.20 for two seats before tax,
without replacing evidence storage, inbound routing, or verification. ([HubSpot pricing](https://www.hubspot.com/pricing/sales?tier=starter))

Before any activation, recheck: current plan/currency/tax; account ownership
and recovery; provider terms, retention, and region; exact model/version and
price; prepaid minimum and refund/expiry rules; actual Cloudflare bindings and
usage; Cloudflare destination/routing and Resend deliverability/reply/suppression
readiness; source licence and price; Hunter shared-credit state; and a current
ledger receipt. Then obtain an
explicit owner approval for the exact account, cap, cohort, and cash outlay.
