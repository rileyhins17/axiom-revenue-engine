# Jev economics and routing research (2026-09-20)

## Decision

The cheapest simple path, if TypeSafe grants access, is a direct TypeSafe
adapter using a pinned Jev version. TypeSafe publishes Jev at **$0.042 per
million input tokens** and says output is free. Its [Master Customer Agreement](https://typesafe.ai/legal/mca)
specifies USD unless the Order says otherwise. Its launch post describes early access. That is a price
claim, not proof of access, SLA, quota, retention terms, or a production
contract. ([TypeSafe product page](https://typesafe.ai/),
[launch post](https://typesafe.ai/blog/introducing-system-one-models-and-jev))

If direct access is unavailable, the most concrete fallback found is OpenRouter
`typesafe/jev-1.13`, which lists TypeSafe as the provider at US$0.042/M input,
free output, 32K context, and a pinned release date. OpenRouter requires
prepaid credits (US$5 minimum transaction); it passes model pricing through but
charges a small, currently unspecified credit-purchase fee. Do not enable auto
recharge. ([OpenRouter Jev 1.13](https://openrouter.ai/typesafe/jev-1.13),
[credits/fees support](https://openrouter.ai/support/),
[terms, prepaid minimum](https://openrouter.ai/terms))

OpenRouter is likely the lowest-friction shared billing/fallback route if its
decision endpoint matches the adapter contract. Pin `jev-1.13`, not a moving
latest alias. Vercel AI Gateway also now lists Jev through TypeSafe AI as a
free promotional provider, with a `typesafe-ai/jev` model slug; the page says
the promotion ends September 25, 2026. Its model/provider docs expose routing
and model discovery, but this is not evidence of an immutable Jev version.
([Vercel Jev page](https://vercel.com/ai-gateway/models/jev), [model/provider
docs](https://vercel.com/docs/ai-gateway/models-and-providers))

The repository's existing `AIProvider.generateStructured` is for generative
structured output and cannot host Jev's decision interface directly. Jev needs
a separate typed `DecisionProvider` adapter; preserve `AIProvider` for LLM
generation and escalation.

## Cost model

**Owner clarification:** Riley has no OpenAI API keys. All nano/mini comparisons below are hypothetical architecture scenarios, not current spend, an available fallback, or demonstrated savings. A Jev-only pilot can compare against deterministic results and owner labels; OpenAI onboarding is optional and separately authorized.

All amounts below are USD model charges, converted only for planning at **US$1
= C$1.38**. This is an explicit budgeting assumption, not a live FX quote;
actual card conversion, tax, and OpenRouter fees are excluded. “Lead” means one
decision input. The table assumes a 20% call allowance for ordinary transient
retries (1.2x Jev input); it does not claim that rate is observed. A low
confidence result should route to review or a separately budgeted LLM; rerunning
the same question is not an optimization. A generative escalation adds that
model's input and output charges.

| Leads | 1,000 tokens | 3,000 tokens | 8,000 tokens |
|---:|---:|---:|---:|
| 50 | US$0.0025 / C$0.0035 | US$0.0076 / C$0.0104 | US$0.0202 / C$0.0278 |
| 200 | US$0.0101 / C$0.0139 | US$0.0302 / C$0.0417 | US$0.0806 / C$0.1113 |
| 1,000 | US$0.0504 / C$0.0696 | US$0.1512 / C$0.2087 | US$0.4032 / C$0.5564 |
| 10,000 | US$0.5040 / C$0.6955 | US$1.5120 / C$2.0866 | US$4.0320 / C$5.5642 |

Formula: leads × tokens × 1.2 × $0.042 / 1,000,000. At 10,000 leads and
8,000 tokens, this illustrative retry allowance is about C$5.56 before
escalation. That is token cost only; it does not imply C$50 remains available.
The existing plan allocates approximately C$7/month to OpenAI, so reserve at
most **C$1 inside that existing AI envelope** for an initial Jev experiment.
Existing actual spend, tax, and FX remain unknown.

For a directly comparable repository fallback, the official OpenAI pricing
page lists `gpt-5.4-nano` at US$0.20/M input and US$1.25/M output, and
`gpt-5.4-mini` at US$0.75/M input and US$4.50/M output. At a 3,000-input /
300-output baseline, all-nano costs **US$0.000975/lead**. Jev with the
illustrative 20% retry allowance costs **US$0.0001512/lead**. With 20% of
leads falling back to nano, the mixed cost is:

`0.0001512 + (0.20 × 0.000975) = US$0.0003462/lead`.

Against all-nano, that is a saving of **US$0.12576 (C$0.1735) at 200 leads**
and **US$0.6288 (C$0.8677) at 1,000 leads**, using the explicit US$1=C$1.38
planning conversion. This excludes implementation/review cost and makes no
quality or ROI claim. ([OpenAI API pricing](https://developers.openai.com/api/docs/pricing))

Vercel AI Gateway has US$5/month included free credit until the first purchase,
then pay-as-you-go credits, with no markup and provider-list pricing. The Jev
model page confirms a current TypeSafe route and free promotion, subject to the
expiry above. ([Vercel AI Gateway pricing](https://vercel.com/docs/ai-gateway/pricing))

Cloudflare Workers AI has 10,000 free Neurons/day; paid use is US$0.011 per
1,000 Neurons and the Workers Paid plan is US$5/month. The current official
catalogue/pricing pages reviewed do not establish Jev as a Cloudflare-hosted
model. Treat Cloudflare as an infrastructure/billing option only after a live
catalogue and contract check. ([Workers AI catalogue](https://developers.cloudflare.com/workers-ai/models/),
[Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/))

## Where Jev belongs

Keep deterministic code for identity resolution, suppression/legal gates,
threshold calculations, URL/HTTPS/redirect checks, evidence freshness,
deduplication, budget ceilings, and workflow state. These have exact rules and
are cheaper, auditable, and safer in code. Jev is a candidate for fuzzy,
structured decisions such as route selection, classification, evidence-backed
scoring, or escalation when rules are brittle. It cannot generate outreach
copy. Low confidence must route to review or a separately budgeted LLM.

There is no honest engineering-cost break-even against deterministic code from
published prices: code has a build/maintenance cost, while Jev has per-call
cost and unknown access/terms. The practical break-even test is an offline
50-lead labelled evaluation: Jev must improve qualified routing or owner time
enough to justify integration and review overhead. Until that evidence exists,
use Jev only behind an off-by-default, pinned adapter and retain deterministic
fallbacks.

## Unknowns to resolve before implementation

Account access, applicable current quotas, exact order/billing terms and taxes,
version lifecycle, SLA, and Cloudflare exposure remain unverified. Public TypeSafe
privacy, DPA, and customer terms exist; see the provider research note for their
purpose-based retention and USD default. Vercel's promotional availability is verified but its
immutable versioning is not. No subscription, required top-up beyond
OpenRouter's US$5 minimum, markup beyond OpenRouter's unspecified purchase fee,
or existing Axiom provider spend is known. Re-check these before account setup
or release planning.
