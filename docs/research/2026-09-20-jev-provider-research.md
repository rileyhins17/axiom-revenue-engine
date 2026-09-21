# TypeSafe AI Jev provider research

**Checked:** 2026-09-20 (America/Toronto)
**Scope:** official TypeSafe documentation, official TypeSafe GitHub SDK, and TypeSafe legal pages only. No API key, account creation, or live inference was used.

## Executive finding

Jev is TypeSafe’s first “System One” model: a typed decision API that evaluates one `state` (text or JSON-like object/array) against named `Choice`, `Score`, and `Noul` questions and returns structured answers. The official endpoint is `POST https://api.typesafe.ai/v1/systemone`, authenticated with `Authorization: Bearer <API_KEY>`. The official docs currently list `jev-1.13.0` and `jev-latest` (alias currently points to `jev-1.13.0`). The earlier claims of a 2026-09-15 launch and `70–500 ms` latency are not established by the primary sources reviewed. The homepage shows one illustrative workflow completed in `0.114s`, not a latency SLA or distribution.

## API shape and primitives

The request requires `state`, `model`, and `questions`. `state` may be a string, object, or array. Each question has `type` and `instructions`; `Choice` adds a map of labels to descriptions (maximum 255 options), `Score` adds an ordered array of 2–10 rubric levels, and `Noul` is a yes/no probability with optional `true`/`false` criteria. The API reference is https://docs.typesafe.ai/api; the primitive pages are https://docs.typesafe.ai/primitives/choice, https://docs.typesafe.ai/primitives/score, and https://docs.typesafe.ai/primitives/noul.

Responses contain the answering `model`, `answers` keyed by the request question IDs, and `usage.input_tokens` / `usage.output_tokens`. Choice returns `choice`, full `probabilities`, and `confidence`; Score returns probability-weighted `score`, `legend`, `probabilities`, and `confidence`; Noul returns `noul` from 0 to 1 and has no confidence field. Confidence is derived from the probability distribution, not an independently documented calibration guarantee: https://docs.typesafe.ai/confidence.

The docs explicitly recommend putting all questions for the same state in one request: questions run in parallel and adding questions “barely changes” response time, though extra question text still consumes tokens. This is question fan-out, not a documented batch endpoint for multiple independent states. I found no official server-side prompt/result caching feature or cache-control contract. Any cache would therefore be an Axiom-side optimization and must be keyed by model version plus a canonicalized request.

Minimal verified HTTP example (from the official quick start/API shape):

```bash
curl -X POST https://api.typesafe.ai/v1/systemone \
  -H "Authorization: Bearer $TYPESAFE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "state": {"website": "https://example.com", "industry": "plumber", "observed_evidence": ["Synthetic example only"]},
    "model": "jev-1.13.0",
    "questions": {
      "service_category": {"type": "choice", "instructions": "Which broad service category best describes the supplied state? Transport shape only; this is not an Axiom qualification prompt.", "criteria": {"home_services": "A local home or property service", "professional_services": "A local professional service", "retail_or_hospitality": "A local retail, food, or hospitality business", "unknown": "Insufficient evidence to classify"}}
    }
  }'
```

The example deliberately contains no qualification claim: a website and industry alone cannot evidence rebuild need, reachability, timing, or prospect fit. A real Axiom prompt must use inspected, source-linked evidence and remain a separate approved design. Axiom should retain source URL, capture time, method, confidence, and audit version beside model output, with deterministic gates and human review in front of outreach.

## Version, limits, price, and performance

TypeSafe’s model page currently reports Jev 1.13 as `jev-1.13.0`, price `$42 / billion input tokens` or `$0.042 / million input tokens`, and free output tokens: https://docs.typesafe.ai/models. The model page does not name the currency, but the public Master Customer Agreement specifies **USD unless the Order states otherwise**. Verify the actual Order before activation; any CAD conversion remains an explicit planning assumption. The page reports 250,000 tokens/second and 1,200 requests/minute, but says limits are dynamic and can change without notice. It reports a 64k-token request context, with a 32k limit for `state` plus the longest question; input is text only (pre-process images/audio/video into text or structured fields).

`jev-latest` is the default alias and currently resolves to `jev-1.13.0`; aliases move when releases ship. Pin `jev-1.13.0` for threshold stability, log the response `model`, and deliberately re-evaluate thresholds before upgrading. The docs also list `jev-preview`, currently pointing to the same release.

The official homepage claims a particular TypeSafe workflow completed in `0.114s` versus an LLM workflow in `8.566s`, with stated comparison context on the page; this is an illustrative claim, not an independently reproducible benchmark. No official p50/p95, regional latency, uptime/SLA, or 70–500 ms range was found. Measure Axiom’s actual Cloudflare-to-API latency during an authorized staging test later.

## Validation, retries, and runtime fit

The official JavaScript SDK is `@typesafe-ai/sdk` (MIT, current repository package version `0.6.0`), documented at https://github.com/typesafe-ai/typesafe-sdk-js. It performs local question validation and exposes inferred TypeScript answer types. Its source uses standard `fetch`, `AbortController`, JSON, and timers; it requires Node `>=20` in `package.json` but also accepts an injected `fetch`. Cloudflare Workers provide Web Fetch APIs, so the raw HTTP API is the lowest-risk runtime fit; the SDK may work in Workers but its declared Node engine and package/runtime assumptions should be tested in a Worker bundle before adoption. Never expose the API key in browser code; the SDK refuses browser use unless `dangerouslyAllowBrowser` is enabled.

The API documents `401`, `422`, `429`, and `529`; `429` means rate limit and `529` temporary overload. TypeSafe says to use exponential backoff and retry-after. The official JS SDK defaults are two retries, 10-second timeout per attempt, retry on 408/429/500–599 plus connection/timeouts, initial 500 ms backoff capped at 5,000 ms with 25% jitter, and respect `Retry-After`/`retry-after-ms` up to 60 seconds. There is no total retry-budget default. Axiom should bound retries at the workflow layer and make downstream queue writes idempotent.

## Privacy, retention, and terms

The privacy policy (last updated 2025-11-19) covers the APIs and says TypeSafe collects prompts, data, instructions, and other input; it will not train or fine-tune models on input and will not disclose input except to service providers. It says personal data is retained as long as reasonably necessary for service/business purposes, can be deleted when no longer necessary subject to legal retention, and services are hosted in the United States: https://typesafe.ai/legal/privacy-policy. The public DPA (last updated 2026-04-24) makes Customer the controller and TypeSafe the processor, limits Customer Personal Data processing to documented instructions/service provision, covers subprocessors and SCC/UK Addendum transfers, and sets retention to as long as necessary under the purpose, applicable law, and limitation periods: https://typesafe.ai/legal/data-processing. It also promises security measures and notice within 72 hours after becoming aware of a security incident. This remains **not** a zero-retention promise for ordinary API use.

The public Master Customer Agreement (updated 2026-09-19) governs API access through an Order/checkout/confirmation and incorporates the DPA. It grants TypeSafe rights to process Customer Data to provide services, calculate fees, derive telemetry, prevent fraud, and comply with law; it says Customer Data will not enter a model-training dataset without prior consent, while telemetry may be used to improve services. Fees are paid in US dollars unless an Order says otherwise, and taxes are extra: https://typesafe.ai/legal/mca. The Terms of Use remain site terms and say not to submit confidential/proprietary material through the Site: https://typesafe.ai/legal/terms. Keep early integration data minimized and preferably de-identified.

## Jev 1.13 limitations (official jaggedness note)

TypeSafe says `jev-1.13` reads literally and is weak at math, counting, numeric precision, date/time ordering, multi-hop indirection, and generation. Accuracy falls with irrelevant or oversized state (“context rot”); filter in code first. State is not treated as hostile by default, so prompt injection or misleading/adversarial state can move an answer. Contradictory instructions and criteria can confuse it. Separate questions do not guarantee arithmetic or semantic identities: Noul probabilities and Choice probabilities should not be treated as complements, and thresholds must not be transferred between primitives. Keep arithmetic, date comparison, invariants, and deterministic qualification gates in code. Source: https://docs.typesafe.ai/model-jaggedness/jev-1.13 (reviewed 2026-09-17).

## Decision for Axiom

Jev is technically plausible for a read-only, evidence-grounded prospect triage assist in a Cloudflare Worker, using pinned `jev-1.13.0`, schema validation of both request and response, conservative confidence thresholds, and manual review. It is not yet cleared for production outreach automation: dynamic rate limits, no public SLA, ordinary retention ambiguity, known numeric/date/adversarial-state weaknesses, and no verified live latency need resolution. The 2026-09-15 launch date and 70–500 ms claim remain unverified. The model page publishes free output tokens, while the MCA establishes USD billing unless an Order says otherwise; account-specific credit/refill application still depends on the Order/account terms.

## Official sources

- https://docs.typesafe.ai/introduction/quickstart
- https://docs.typesafe.ai/api
- https://docs.typesafe.ai/models
- https://github.com/typesafe-ai/typesafe-sdk-js
- https://raw.githubusercontent.com/typesafe-ai/typesafe-sdk-js/main/src/client.ts
- https://raw.githubusercontent.com/typesafe-ai/typesafe-sdk-js/main/src/retry.ts
- https://raw.githubusercontent.com/typesafe-ai/typesafe-sdk-js/main/src/types.ts
- https://typesafe.ai/legal/privacy-policy
- https://typesafe.ai/legal/data-processing
- https://typesafe.ai/legal/mca
- https://typesafe.ai/legal/terms
- https://docs.typesafe.ai/model-jaggedness/jev-1.13
