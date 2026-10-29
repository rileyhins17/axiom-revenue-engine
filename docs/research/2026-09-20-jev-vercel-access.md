# Jev through Vercel AI Gateway: conditional access walkthrough

**Checked:** 2026-09-20 (America/Toronto). This is research only. No Vercel
account, key, request, payment, or provider call was made.

## What is documented now

The official Vercel catalog has a Jev route with model ID
`typesafe-ai/jev`. The Jev model page describes TypeSafe's structured
evaluation model (choices, scores, boolean probabilities), 32K context, and a
native AI SDK example using `experimental_evaluate` from `ai`. This is a typed
evaluation API, not a normal text generation call: use `evaluate({ model,
state, questions })`, not `generateText` and not an OpenAI Responses payload.
Vercel's launch note says AI SDK 7.0.105 or later exposes this API, preserves
question IDs/Choice keys, and returns TypeSafe confidence metadata. ([Jev model
page](https://vercel.com/ai-gateway/models/jev), [Vercel launch note](https://vercel.com/changelog/typesafe-ai-jev-now-available-on-ai-gateway))

The live catalog observed on September 20 shows **Free** input and output,
32K context, TypeSafe AI as provider, ZDR Yes, No Training Yes, and a release
date of September 15, 2026. The page also states that promotional pricing ends
September 25, 2026. A cached/search rendering of the same page shows $0.04/M
input, so do not treat $0.04 as the current payable rate while the promotion is
active or after it expires. Re-open the live model page/dashboard immediately
before any order; post-promotion price, rate limits, and availability are not
established here. ([TypeSafe AI catalog](https://vercel.com/ai-gateway/models/providers/typesafe-ai))

Every AI Gateway request requires Gateway authentication. Vercel documents two
choices: an `AI_GATEWAY_API_KEY` created in the Vercel dashboard, usable from
anywhere, or `VERCEL_OIDC_TOKEN`, automatically available only to deployments
running on Vercel. BYOK provider keys are optional. Therefore an Axiom Worker
running on Cloudflare could call Vercel over HTTPS with a Vercel Gateway key;
it does not need an OpenAI key or a TypeSafe key for Vercel's system-provider
route. A Cloudflare deployment cannot assume Vercel OIDC. ([Authentication and
BYOK](https://vercel.com/docs/ai-gateway/authentication-and-byok))

Vercel says every team has a Free AI Gateway tier with US$5/month included
credits after the first AI Gateway request, no commitment, and all available
models; the paid tier is prepaid credits at provider-list rates with no
Gateway markup. Once credits are purchased, the monthly free credit no longer
applies. Payment processing fees may apply. The pricing page does not state a
phone-verification or card requirement before the first free request. However,
Vercel's Terms restrict a **Hobby plan to personal, non-commercial use**. Axiom
is commercial, so “free Gateway credits” must not be treated as permission to
run a commercial Axiom workload on Hobby; the minimum compliant Vercel plan,
whether the Free Gateway tier is available under it, and any signup checks are
account/dashboard facts still requiring verification. Auto-top-up is documented
and disabled by default; leave it disabled. ([Gateway pricing](https://vercel.com/docs/ai-gateway/pricing),
[Vercel Terms](https://vercel.com/legal/terms))

The model page's live **Free** promotion is the relevant possible route, but it
does not bypass Gateway authentication, commercial-plan terms, or per-model
limits. Vercel documents that free-tier limits are per-model and a 429 can
occur; exact Jev request/token caps were not published in the sources checked.
Paid credits increase access but do not create an unlimited or quality
guarantee. Whether the Jev promotion is usable before any credit purchase, and
how it interacts with the account's free-credit balance, must be confirmed in
the signed-in dashboard. ([Vercel pricing guidance](https://vercel.com/academy/ai-gateway/ai-gateway-pricing))

Vercel's Jev announcement says Jev supports request-level ZDR and no-prompt-
training controls. The broader Gateway docs say team-wide ZDR is a Pro/
Enterprise feature and request-level ZDR availability depends on plan; the
Jev page's ZDR/No Training flags describe provider capability, not Axiom's
current entitlement. Gateway evaluation calls also appear in logs and custom
reporting. Vercel's gateway-layer deletion statement therefore does not mean
that every account-level log, usage record, or provider record disappears, nor
that Hobby commercial use is permitted. Treat TypeSafe and Vercel terms/privacy
as separate review gates. Do not send prospect PII until retention, legal basis,
region, plan controls, logging, and ZDR settings are verified in the actual
account. ([ZDR/no-training changelog](https://vercel.com/changelog/zero-data-retention-no-prompt-training-on-ai-gateway),
[Jev announcement](https://vercel.com/changelog/typesafe-ai-jev-now-available-on-ai-gateway))

## Conditional, no-spend walkthrough

1. Create or use the Axiom-owned Vercel team only if the owner approves that
   account boundary. Open the AI Gateway model list and confirm
   `typesafe-ai/jev`, the live Free/promotion state, expiry, provider, context,
   ZDR/No Training flags, and the current per-model rate limit. Record a dated
   screenshot/metadata receipt; do not click payment or enable auto-top-up.

2. In the AI Gateway dashboard, create one scoped API key only if the account
   is on a commercially permitted plan and the dashboard exposes the feature.
   Vercel documents API-key budgets with a **US$1 minimum**, daily/weekly/monthly
   or never refresh periods, and team/project/user scopes. The cap applies to
   Gateway-credit traffic using that key; BYOK spend is outside these budgets.
   A budget limits usage but does not buy credits, guarantee capacity, or make a
   hard invoice ceiling: the request that crosses the limit can complete and
   spend can end slightly over. Use a US$1 monthly key cap only after the
   signed-in entitlement and payment/credit state are confirmed, with no
   fallback provider. ([Budgets and spend limits](https://vercel.com/docs/ai-gateway/observability-and-spend/budgets))

3. Store the key only in a local ignored secret or approved Cloudflare secret
   store. For Cloudflare, call the Gateway endpoint from the server-side Worker
   and use the AI SDK evaluation API or the documented Gateway evaluation
   endpoint. Do not put the key in browser code. Pin the exact route available
   at the time of the experiment; Vercel's public Jev slug is a moving model
   name, and no immutable version is documented on the Vercel page.

4. Run a fixture-only request with a bounded state and typed questions. Validate
   the response schema, question IDs, confidence/probability fields, latency,
   usage/cost metadata, HTTP errors, and any 429 retry behavior. Record the
   Gateway request receipt. Do not use the result for qualification, consent,
   suppression, outreach, or autonomous work until the separate evaluation and
   DecisionProvider gates pass.

5. If the Free route returns 429, unavailable-model, auth, or policy errors,
   stop and record the failure. Do not retry indefinitely, buy credits, switch
   providers, or use a TypeSafe direct key without a new owner-approved packet.

## Still unverified

Commercially eligible Vercel plan, signup/phone/card checks, whether Jev's
promotion works before a credit purchase, exact free-tier rate/token caps,
post-September-25 price,
Cloudflare-to-Vercel latency, TypeSafe data-processing terms as applied through
Vercel, and production SLA are all unverified. API-key budget support and its
US$1 minimum are documented, but dashboard entitlement and the soft-cap billing
behavior must be checked in the actual team. Vercel availability removes the
need for an OpenAI or TypeSafe credential for the system route; it does not make
Jev a dependency, prove reliable capacity, satisfy Axiom's commercial terms,
or authorize spending. The safest first test remains local fixtures behind a
separate typed `DecisionProvider`, with deterministic gates and the existing
generative `AIProvider` unchanged.

The [SDK/protocol investigation](2026-09-20-jev-sdk-compatibility.md) confirms
the documented non-SDK endpoint is `POST https://ai-gateway.vercel.sh/v1/evaluate`.
Exploring this HTTP contract does not require an AI SDK upgrade. Its envelopes
still need validation before engine implementation. The actual UI handoff
reached Vercel sign-in after Get API key; no authenticated entitlement or
successful inference was established.
