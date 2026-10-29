# Provider and budget plan

**Planning date:** 2026-09-20; provider-policy check: 2026-09-23, America/Toronto. **Status:** proposal only. No
provider account, key, resource activation, purchase, migration, deployment, or
send is authorized by this document. Current incremental provider spend is C$0.
The current [master plan](MASTER_PLAN.md)
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
Public DNS queried on 2026-09-23 shows Cloudflare root MX/SPF, DMARC quarantine,
a Resend verification token, two distinct TXT values under `resend._domainkey`,
and SPF/MX records under `send` that point to Amazon SES infrastructure. This
proves only that public records exist; it does not prove active forwarding,
which Resend domain/account owns them, which DKIM value is current, a provider
account/key, sender verification, or policy permission/send readiness. The
Cloudflare destinations and rules remain unverified. The shadow
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

The selected inbound route has **zero paid mailbox seats**. Cloudflare Email
Routing forwards inbound messages to verified existing owner destinations.
Cloudflare's current FAQ says Email Service is intended only for transactional
email; therefore its paid outbound capability is not a selected route for cold
prospecting. Resend's current AUP expressly prohibits unsolicited messages,
including cold outreach, and requires explicit opt-in. No provider is selected
for cold email until a vendor's current policy and a lawful route are proven
compatible with Axiom's exact sending use. Owner-managed calls and separately
approved manual tasks are prioritized meanwhile. ([Cloudflare Email Service
FAQ](https://developers.cloudflare.com/email-service/reference/faq/), [Resend
Acceptable Use Policy](https://resend.com/legal/acceptable-use))

Cloudflare Email Routing is available on Workers Free and Paid with unlimited
inbound messages. Sending to arbitrary recipients requires Workers Paid, and
the published Email Sending allowance is 3,000/month before usage charges;
sends to verified destination addresses are free on either plan. These account
limits do not override the current transactional-only product guidance or prove
Axiom's actual account quota. Resend Free publishes 3,000/month, 100/day, three
domains and one webhook endpoint for US$0/month, but that published price and
capacity cannot be treated as permission for unsolicited prospecting. A
Resend Free setup may be evaluated only for explicit opt-in or transactional
messages if current terms permit that exact use and account eligibility is
verified. No account is established, no sender is connected, and current
incremental provider spend is C$0. ([Cloudflare Email Service pricing](https://developers.cloudflare.com/email-service/platform/pricing/),
[Cloudflare limits](https://developers.cloudflare.com/email-service/platform/limits/),
[Resend pricing](https://resend.com/pricing), [Resend AUP](https://resend.com/legal/acceptable-use))

Cloudflare Email Sending is a **Beta transactional alternative**, not a cold
marketing route. Do not build or activate it for prospecting under current
guidance. If an owner later evaluates it for a policy-permitted transactional
use, the app must separately prove sending-domain ownership, quota, reply/event
handling, suppression and retention. ([Cloudflare Email Service FAQ](https://developers.cloudflare.com/email-service/reference/faq/),
[Cloudflare send API](https://developers.cloudflare.com/email-service/api/send-emails/workers-api/),
[headers](https://developers.cloudflare.com/email-service/reference/headers/),
[event subscriptions](https://developers.cloudflare.com/email-service/platform/event-subscriptions/),
[limits](https://developers.cloudflare.com/email-service/platform/limits/))

**Provider-page and DNS check: 2026-09-23.** Resend's published Free plan lists
3,000 emails/month, a 100/day limit, three domains, one webhook endpoint and
30-day provider-side data retention. Its current AUP (updated 2026-08-27)
prohibits unsolicited mail, specifically cold outreach, and requires every
recipient to have explicitly opted in. Therefore this plan does not select
Resend for cold first-touch. Cloudflare's FAQ says Email Service is currently
intended only for transactional email; its paid arbitrary-recipient send
feature is not a substitute for a cold-email sender. ([Resend pricing](https://resend.com/pricing),
[Resend AUP](https://resend.com/legal/acceptable-use), [Cloudflare Email Service
FAQ](https://developers.cloudflare.com/email-service/reference/faq/))

Live public DNS confirms root Cloudflare MX records, Cloudflare SPF, DMARC
quarantine, a `resend-domain-verification` TXT token, two distinct TXT values at
`resend._domainkey`, and an Amazon SES SPF/MX pair at `send`. The duplicate DKIM
selector values require owner-account inspection; do not replace either record
based on the DNS observation alone. DNS cannot prove Cloudflare destination
ownership/rules, which Resend account owns the domain, verified sender/key,
quota/billing state, or current provider permission. A no-prospect sink round
trip can be planned after an owner verifies destinations and rules, confirms a
permitted sender route, and an approved implementation exists. No provider
activation, email, purchase or send happened in this audit; incremental provider
spend remains C$0. ([Cloudflare routing addresses](https://developers.cloudflare.com/email-service/configuration/email-routing-addresses/),
[Cloudflare route setup](https://developers.cloudflare.com/email-service/get-started/route-emails/),
[Resend domain verification](https://resend.com/docs/add-a-domain),
[Resend webhook verification](https://resend.com/docs/webhooks/verify-webhooks-requests))

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
| Cloudflare Email Routing inbound | C$0.00 published route price; account/destination/rule state unverified |
| Resend Free | C$0.00 published plan; not selected for cold email; opt-in/transactional account, domain, key and quota state unverified |
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
and recovery; provider terms for the exact recipient-consent model, retention,
and region; exact model/version and price; prepaid minimum and refund/expiry
rules; actual Cloudflare bindings and usage; Cloudflare destination/routing;
any permitted opt-in/transactional Resend deliverability, reply and suppression
readiness; source licence and price; Hunter shared-credit state; and a current
ledger receipt. A cold-email adapter remains unselected until vendor policy and
the legal route are both proven. Then obtain an
explicit owner approval for the exact account, cap, cohort, and cash outlay.
