# Jev deep research: access, DOM decisions, and the Axiom recommendation

**Checked:** 2026-09-20, America/Toronto. Research and documentation only. No live inference, account creation, credential generation, paid purchase, deployment, browser-agent installation, or engine implementation occurred.

## Decision

Use Vercel AI Gateway as the first access route to investigate for a small synthetic Jev experiment. Its live catalog currently advertises free promotional inference through September 25, 2026. A Gateway key can remove the need for separate OpenAI or TypeSafe credentials. This is an access recommendation, not evidence that Riley's account is provisioned: the inspected browser session reached the Vercel login screen after following Get API key.

For the Revenue Engine, the most promising browser task is choosing among already-discovered, permitted page/element candidates. Keep browser execution, source capture, factual extraction, numeric checks, authorization, and completion verification in ordinary code. Jev may help with the semantic ambiguity between those steps; it does not supply a browser, screenshot vision, arbitrary text generation, or permission to act.

Read the three detailed investigations:

- [Vercel access, cost, account eligibility and privacy](2026-09-20-jev-vercel-access.md).
- [DOM/browser evidence and evaluation design](2026-09-20-jev-dom-browser-evidence.md).
- [AI SDK/Gateway compatibility and version risks](2026-09-20-jev-sdk-compatibility.md).

## What changed from the earlier research

The [original TypeSafe launch article](https://typesafe.ai/blog/introducing-system-one-models-and-jev) establishes September 15 as the launch date and publishes a 70–500 ms end-to-end claim. Its measurements were generally made near the West Coast service. These are vendor results, not a p95 guarantee for Ontario, Vercel routing, or Cloudflare calls. The article also attributes its roughly 194x speed/445x cost headline to selected workflow evaluations and acknowledges that these are near the high end of expected gains. None is a browser-task success rate.

The [published workflow evaluation](https://evals.typesafe.ai/) covers security incidents, agent traces, invoices, and customer service. Reference answers come from a consensus of larger models, not independently established real-world outcomes. It is useful evidence for decomposing decisions into code plus narrow questions, but cannot establish Axiom prospect quality, a CASL basis, or general web-navigation reliability.

The [live Vercel catalog](https://vercel.com/ai-gateway/models/jev) showed Free input/output, a 32K context, and a September 25 promotion expiry in the inspected UI. Cached search content showed a paid input price. This discrepancy is retained deliberately: recheck the actual dashboard and rate card before calling, and do not assume an expiry timezone or future price. A free inference promotion does not include arbitrary browser hosting, helper models, or unlimited request capacity.

## Why DOM is a plausible fit

DOM means a page's programmatic structure: elements, links, labels, fields, and their relationships. A browser can turn that into a short candidate table. Instead of asking an AI to invent a selector or generate an automation script, ask it to choose one known candidate ID and a permitted operation.

Example, **illustrative only, not an observed prediction**:

```text
Goal: find the business's residential roofing services page.
Candidates: e12 = Services; e18 = Careers; e23 = Residential roofing;
            e31 = Request a quote (form submission route).
Allowed operation: OPEN_READ_ONLY_LINK or ABSTAIN.
Expected reviewed selection: e23, if its URL and context actually match.
```

The application resolves `e23` to the actual current DOM element, validates its destination and freshness, executes the permitted navigation, then captures the resulting page. The selected ID must never be treated as a trusted selector supplied by the model. If the page changed, recapture and reconsider. Independent operation/target answers must still form a legal pair; valid individual values do not prove a valid combination.

The attractive saving is fewer expensive general-model decisions and fewer browser round trips. The whole loop still includes navigation, rendering, DOM extraction, network latency, retries, validation, and any generated text. Optimizing those costs may matter more than an already inexpensive Jev call.

## Axiom fit, in priority order

| Candidate use | Expected practical value | What must remain separate |
|---|---|---|
| Rank service/about/contact links after code extracts them | Find relevant evidence with fewer pages | URL permissions, source rights, fetch limits, freshness |
| Classify an observed page's role | Distinguish service detail, directory, contact, careers, irrelevant | Exact source identity and extracted facts |
| Match a visible element to an owner-defined research action | Recover from ambiguous labels | Current element identity, visibility/actionability, allowed action |
| Flag whether bounded text supports a proposed observation | Assist review and expose uncertain cases | Citation verification; no invented explanations |
| Choose whether more evidence is needed | Stop wasteful capture or route to owner review | Deterministic completion and budget conditions |
| Judge aesthetic quality from a screenshot | Not supported by current text-only Jev | Human or separately provisioned vision model |
| Write persuasive outreach or arbitrary form text | Not a native Jev output | Approved templates, owner, or provisioned generative model |
| Decide consent, budget, suppressions, or send permission | Not delegated to Jev | Authoritative records and deterministic rules |

These are proposed experiments, not implemented features. The [master plan](../MASTER_PLAN.md) and [delivery sequence](../DELIVERY_PLAN.md) still govern activation. A local synthetic access test can establish credentials/API compatibility; it does not clear the M3 quality gate or authorize prospect interaction.

## Evidence standard before adoption

The published browser timings exclude browser setup, initial navigation and
fresh independent post-run verification. Include those costs when estimating
Axiom throughput. For scale only, the recording's 90,558 Jev input tokens at
the direct published US$0.042/M rate would be about US$0.00380; adding its
reported US$0.00006272 helper charge gives roughly US$0.00387 before browser,
hosting, taxes, and retries. This is calculated hypothetical pricing, not the
recording's invoiced total or Vercel's current promotional charge.
[Recording and measurement methodology](https://github.com/browser-use/jev-ultrafast/blob/main/docs/performance.md).

Run a separately authorized, bounded comparison on frozen DOM snapshots and read-only navigation tasks. Include exact selectors/rules as the cheapest baseline; compare Jev only where those baselines are ambiguous. Split train/tuning and test examples by website/business rather than letting similar snapshots of one page leak across partitions.

Measure correct candidate and complete-task success, harmful or unsupported proposed actions, abstention, stale-element rejection, repeated loops, source/citation integrity, owner correction time, p50/p95 latency, and total per-completed-task cost. Publish failures and all attempts, including helper-model and browser costs. A small zero-failure sample is not proof of universal safety. Human-labelled unknowns are valid outcomes; forcing every page into a positive classification can hide missing evidence.

Reject deployment if the model's exact version cannot be pinned under the repository contract, if gateway/provider retention cannot meet the selected data scope, if it requires an unavailable helper model, or if the complete workflow fails to improve owner effort or useful evidence. Do not treat adoption counts, GitHub stars, a fast video, schema conformance, or a confidence number as a quality gate.

## Actual access status

The public model route and login handoff are verified. The team, entitlement, key, quota, and successful inference are not. The user was invited to sign in privately while research continued; no password or API key is requested in chat. If signup, new credentials, payment or legal acceptance is required, complete that exact account step with the owner before claiming access is ready.
