# Jev / Vercel AI SDK compatibility research

**Date:** 2026-09-20 (America/Toronto)
**Scope:** official Vercel AI SDK / AI Gateway and TypeSafe-facing public material; research only. No package was installed, no request was sent, and no provider credential was inspected.

## Verified integration shape

Vercel documents Jev as an **evaluation model**, not a text-generation model. The AI SDK entry point is the experimental `experimental_evaluate` function, and Vercel says evaluation requires AI SDK 7 or later. The Jev announcement states that support begins at `ai` 7.0.105; the AI SDK 7.0.103 release notes describe the initial experimental evaluation-model v4 implementation, including typed answers, validation, retries, and cancellation. This is a recently introduced API with a deliberately experimental name, so the pilot should pin the complete `ai` and gateway package versions and treat SDK upgrades as evaluation changes.

The canonical Gateway example is:

```ts
import { experimental_evaluate as evaluate } from "ai";

const result = await evaluate({
  model: "typesafe-ai/jev",
  state: { /* bounded shared evidence */ },
  questions: {
    fit: {
      type: "choice",
      instructions: "Which service-fit category is supported?",
      criteria: { strong: "...", weak: "...", unknown: "..." },
    },
  },
});
```

The documented input is `model`, shared `state` (string, object, or array), and a map of named `questions`. Several questions are answered in parallel against the same state in one request. Question IDs and Choice keys are preserved in the answer map. The supported SDK question forms are Boolean, Choice, and Score. Boolean returns a probability for true; Choice selects a named option and may return per-option probabilities; Score uses an ordered criteria array and returns an interpolated score plus probabilities per rung. The public Vercel surface calls this Boolean form; TypeSafe’s native terminology calls the equivalent binary probability **Noul**. They must not be treated as separate business decisions or mixed into one schema without an explicit adapter mapping.

The AI Gateway provider instance form is `gateway.evaluationModel("typesafe-ai/jev")`, while a model string is resolved by the default Gateway provider. Vercel explicitly says evaluation is unavailable through its OpenAI-compatible, Anthropic-compatible, and Cohere-compatible endpoints. That confirms the proposed separate `DecisionProvider` seam: `generateStructured` or an OpenAI chat adapter is not a valid Jev transport.

For a non-SDK implementation, Vercel documents `POST https://ai-gateway.vercel.sh/v1/evaluate` with the same `model`, `state`, and `questions` fields. The documented response includes `model`, `answers`, `usage.inputTokens` / `outputTokens`, and Gateway routing/cost metadata including `originalModelId`, `resolvedProvider`, `canonicalSlug`, `finalProvider`, `generationId`, and string cost fields. A pilot ledger can therefore record the request digest, returned model/routing metadata, usage, cost string, and generation ID when present. Missing or malformed usage must remain a conservative unresolved-cost state.

## Model identity and routing

`typesafe-ai/jev` is the current Gateway model ID. The model page currently reports a 32K context and promotional/free pricing, with promotion expiry shown as September 25, 2026; those are time-sensitive account/catalog facts, not a durable price or immutable model pin. Vercel’s documentation also supports provider filtering through `providerOptions.gateway.only` and says virtual models can pin provider options. Neither public page establishes that `typesafe-ai/jev` is an immutable Jev snapshot: the Gateway ID is a route/catalog identity, while the result metadata identifies what actually ran.

The safe pilot contract is therefore to pin the SDK/package versions, record the requested model ID and complete response routing metadata, and fail closed if the returned canonical model/provider is absent or unexpected. If TypeSafe or Gateway later exposes a versioned model ID, it should be adopted only through a frozen evaluation change. `jev-latest` (if using the TypeSafe provider package) is an alias and is unsuitable as an unrecorded immutable identity. Provider fallback/order must be disabled or explicitly allowlisted for the pilot; a generic Gateway fallback could change both economics and behavior while preserving the requested model string.

## Credentials and runtime placement

**Snapshot caveat:** recording a returned route/alias is not immutable snapshot
pinning. A synthetic access experiment may explicitly document this limitation;
admission to the engine still requires the repository's version-pinning gate.
Do not silently equate a canonical slug with `jev-1.13.0`.

The Gateway examples require an AI Gateway API key; Vercel’s Gateway docs use `AI_GATEWAY_API_KEY`. The official TypeSafe AI SDK package separately documents `TYPESAFE_AI_API_KEY` for the direct TypeSafe provider. Gateway BYOK can also select a provider credential. These are different account and billing paths. A ChatGPT/Codex subscription is not either credential. The key must stay server-side in a Worker secret or equivalent provider secret store; it must never be sent to owner UI, committed, or placed in a client bundle. No credential or connected account is established by these docs.

Vercel documents `providerOptions.gateway.zeroDataRetention: true`, provider allowlisting, Gateway logs, custom reporting, and budgets for evaluation calls. Jev’s model page links TypeSafe terms/privacy, and Vercel’s page currently displays promotional catalog status. A DPA/no-training statement is not equivalent to zero retention for this request unless the request option, provider route, account terms, and returned route are all verified. The pilot should send only the bounded evidence packet and record the selected privacy options.

## Retry, timeout, and duplicate-cost implications

AI SDK settings documentation defines `maxRetries` (default two for general model calls) and abort/timeout controls, including `AbortSignal.timeout` and total timeouts. The evaluation release notes mention retries and cancellation, but the Gateway evaluation guide does not specify an evaluation-specific billing guarantee, idempotency key, or “no charge on timeout” rule. A timeout can occur after the provider accepted and billed the request. Automatic SDK retries can therefore create duplicate requests and duplicate cost even when the application sees one failed operation.

For the first paid or promotional run, set retry behavior explicitly rather than inheriting a default; the implementation should reserve the maximum permitted attempts, record each attempt ID, and settle or conservatively hold cost after timeout/invalid-envelope outcomes. Use an application cache keyed by exact state/questions/prompt version/model/provider-options digest. Never retry an ambiguous response automatically after a request may have reached the Gateway. Use a bounded total timeout and an offline fixture transport for all tests. The exact evaluation API support for every generic retry/timeout option must be confirmed against the pinned SDK version before implementation.

## Cloudflare compatibility and scope

The documented SDK/Gateway path is ordinary server-side TypeScript over HTTP; the public examples do not require Vercel hosting. A Cloudflare Worker can remain the application host if the pinned SDK bundle is compatible with the Worker runtime and uses the platform `fetch`/Web APIs. This is an implementation verification question, not proof from the docs: the repository must test bundle size, dependency compatibility, secret access, abort behavior, and response parsing in its Cloudflare build before activation. A direct `/v1/evaluate` adapter could reduce dependency surface, but then the repository owns protocol headers, schema validation, version compatibility, and routing metadata parsing.

## Cross-question and evidence limits

Parallel questions share one state and one round trip. Native TypeSafe evaluation describes independently evaluated questions; that does not promise logical consistency or jointly calibrated probabilities between their answers. Vercel's general structured-output LLM adapters do not preserve the same independent-question semantics. See https://vercel.com/i/what-is-jev. A Choice probability, Score distribution, Boolean probability, and provider confidence are different output fields. The application must not convert one into another, sum them into existing qualification weights, or treat a high value as evidence reliability. Use one V1 Choice question for service/business fit and a separately defined triage question, retain unknown as an explicit option, and compare against deterministic rules and owner labels. Do not use Noul/Boolean outputs as an implied qualification threshold or assume probabilities transfer across question types.

## Practical decision

The highest-confidence seam is a server-only `DecisionProvider.evaluate` contract with an offline fake, a Gateway implementation selected only after account authorization, exact Choice/Boolean/Score union validation, request-size limits, cache identity, explicit attempts/timeouts, conservative cost reservation, and returned model/routing/usage capture. Keep Jev advisory-only. The current evidence supports the protocol shape and separation from OpenAI; it does not establish immutable snapshot pinning, account readiness, retention outcome, stable pricing, exact retry billing, or Cloudflare runtime success. Those remain pre-activation checks.

## Official sources

- Vercel AI Gateway Evaluation: https://vercel.com/docs/ai-gateway/modalities/evaluation
- Vercel Jev model page: https://vercel.com/ai-gateway/models/jev
- Vercel Jev availability announcement: https://vercel.com/changelog/typesafe-ai-jev-now-available-on-ai-gateway
- AI SDK settings (retry/abort/timeout): https://ai-sdk.dev/docs/ai-sdk-core/settings
- Vercel AI Gateway provider options: https://vercel.com/docs/ai-gateway/models-and-providers/provider-options
- TypeSafe AI SDK package metadata: https://www.npmjs.com/package/@ai-sdk/typesafe-ai
