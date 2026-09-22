<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Axiom Revenue Engine operating contract

This private repository is the durable source of truth for Axiom Web's internal
Revenue Engine. A chat transcript is never the source of truth.

## Read this before changing anything

Read, in order:

1. `docs/OWNER_CONTEXT.md`
2. `docs/STATUS.md`
3. `docs/MASTER_PLAN.md`
4. `docs/GOTCHAS.md`
5. the ADRs and runbook relevant to the change

Then verify `git status`, the current branch, the latest commit, and the tests
that cover the area. Do not assume a previous agent's commentary still matches
the repository or production.

Master Plan v2 (2026-09-20) is the current roadmap. Read its delivery, operating,
provider/budget and validation companions only as relevant to the milestone.
Archived documents and earlier experiment plans are historical context, not
current execution authority. Distinguish built, connected, authorized and
verified capabilities; model names or adapter files do not prove API access.
New milestone gates should complete an owner workflow or resolve a demonstrated
blocker. Do not expand disconnected infrastructure merely because a further
abstraction is possible. This planning revision grants no implementation,
provider, deployment, migration or outreach authority.

## Product rule

Optimize for qualified opportunities and customers, not scraped rows, generated
messages, or send volume. Lead value, website rebuild need, reachability, timing,
and evidence confidence remain separate and visible. An email address is a
channel, not proof that a business is qualified.

Every claim used for qualification or outreach must retain its source URL,
capture time, method, confidence, and audit version. Never invent client results,
revenue impact, urgency, familiarity, or case studies. Portfolio concepts are not
paying-client proof.

## Safety rules

- All autonomous intake, queue, follow-up, and send switches default to off.
- Missing, invalid, stale, or contradictory configuration must stop work.
- Only verified email may eventually be automated. Calls, forms, and social DMs
  are manual tasks.
- No production send, inbox sync, form submission, deployment, migration, or
  destructive database action may be used as a test.
- Never deploy or migrate without a current backup, a rollback step, and an
  explicit release gate.
- A send requires every applicable global, campaign, mailbox, contact, consent,
  verification, approval, and budget gate to pass.
- Follow-ups remain disabled until their separate evidence gate is approved.
- Keep the runtime ceiling at C$50/month unless the owner explicitly changes it.
- Secrets live in local ignored files or provider secret stores, never source,
  logs, screenshots, commits, issues, or pull requests.

## Engineering rules

- Work in one bounded milestone with an observable exit gate.
- Capture legacy behavior with tests before removing it.
- Prefer typed adapters and small domain modules over adding to the legacy
  orchestration or scraper files.
- Mutations must be idempotent; workflow steps must be retry-safe and resumable.
- Use deterministic checks before AI. Machine-consumed AI output must be schema
  validated, model/prompt versioned, evidence grounded, and cost bounded.
- Use snapshot-pinned runtime model identifiers. Model upgrades require the
  golden evaluation set.
- Use generated Cloudflare binding types and validate config against Wrangler's
  bundled schema. Use Queues/Workflows for new long-running work.
- Do not silently rewrite production prompts, thresholds, targeting, budgets, or
  autonomy. Propose a versioned experiment and require approval.
- Subagents are for independent, bounded audits, research, or non-overlapping
  implementation. One integration owner owns shared files and final verification.

## Required verification

During work, run targeted tests. Before a checkpoint or pull request, run:

```powershell
npm run check:safety
npm test
npm run typecheck
npm run lint
npm run build:cloudflare
npx wrangler deploy --env="" --dry-run --autoconfig false
```

Automated tests must use fakes or mail sinks and must never contact prospects.
Run `npm run test:owner-ui` only after every Next/OpenNext/Cloudflare build or dry
run has exited. Those commands share `.next`; running them concurrently can swap
browser assets mid-request and produce a false intermittent `SyntaxError`.
Owner acceptance requires the completed production `.next/BUILD_ID` and uses
`next start`; do not replace it with `next dev` or clear the completed build.
Longer development runs can evict and rewrite already-warmed shared chunks.
Before browser warmup, finish authenticated local HTTP preparation of every
owner route. Then await each warmup page's `load` event before opening another
route: an SSR heading does not prove async script completion. Keep the delayed
script streaming regression in the owner browser gate and retain browser errors.

## Documentation is part of the change

Every meaningful checkpoint updates `docs/STATUS.md`. Update the README when the
operator or setup experience changes. Record durable architectural decisions in
`docs/adr/`; record only proven recurring traps in `docs/GOTCHAS.md`.

A gotcha entry needs a symptom, root cause, proven fix, prevention/test, affected
area, and verifying commit. A repeated gotcha becomes an automated test or a rule
in this file. Retire entries that are no longer possible.

Before ending a work cycle, record the verified commit, current production and
automation state, completed gate, blockers, owner decisions, spend impact, and
the next three concrete actions in `docs/STATUS.md`.
