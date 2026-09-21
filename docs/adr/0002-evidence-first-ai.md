# ADR 0002 — Evidence-first, provider-isolated runtime AI

> Planning update, 2026-09-20: [ADR 0039](0039-deliver-owner-workflows-before-optional-ai-and-autonomy.md)
> makes AI activation optional and separately provisioned. The OpenAI adapter
> remains source code; Riley has no OpenAI API keys. This ADR's evidence/schema/
> pinning principles remain, but its initial-provider assumption is not proof of
> account readiness or a requirement to activate OpenAI before a usable pilot.

- Status: accepted
- Date: 2026-08-16

## Decision

Use deterministic checks before AI and access runtime AI through a typed provider
interface. The initial provider is OpenAI Responses with Structured Outputs,
snapshot-pinned GPT-5.4 nano for extraction/classification/ranking and GPT-5.4
mini for visual analysis/drafting. Every job has schema, evidence, prompt/model
version, token/retry/time/cost limits, and a recorded usage result.

## Why

The legacy implementation and documentation disagreed about providers and used a
deprecated model alias. A versioned adapter prevents provider details from leaking
through qualification and outreach logic and makes evaluation/cost controls
testable.

## Consequences

- A model alias is not allowed in production defaults.
- Machine output that fails schema/evidence validation is rejected, not repaired
  into a sendable message silently.
- Upgrades require the golden evaluation set and a versioned experiment.
- The legacy DeepSeek wrapper remains only until its callers migrate and must not
  receive new features.
