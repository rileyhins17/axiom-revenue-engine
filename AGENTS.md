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
2. the active brief at the top of `docs/STATUS.md` (older entries are history)
3. `docs/MASTER_PLAN.md`
4. `docs/GOTCHAS.md`
5. `docs/CODEX_AGENT_PROTOCOL.md`, then the ADRs and runbook relevant to the change

Then verify `git status`, the current branch, the latest commit, and the tests
that cover the area. Do not assume a previous agent's commentary still matches
the repository or production.

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

- Google Workspace is excluded by the owner. Do not require, provision, recommend
  purchasing, or assume Workspace seats for the rebuild. Keep the sending design
  provider-neutral; existing Gmail code is legacy/reference until a non-Google
  provider and its outreach policy, capabilities and total cost are verified.
- On Riley's machine, use the non-synced checkout at
  `C:\Users\riley\Documents\ChatGPT\APE`. Do not use a OneDrive or Google Drive
  folder as the working repository. GitHub remains the remote source of truth.
- All autonomous intake, queue, follow-up, and send switches default to off.
- Missing, invalid, stale, or contradictory configuration must stop work.
- Only verified email may eventually be automated. Calls, forms, and social DMs
  are manual tasks.
- No production send, inbox sync, form submission, deployment, migration, or
  destructive database action may be used as a test.
- Never deploy or migrate without a current backup, a rollback step, and an
  explicit release gate.
- Owner deployment hold (2026-09-08): do not deploy or publish the unfinished
  app anywhere, including hosted previews, staging, or production. Continue
  local development, loopback-only previews, tests, builds and no-upload dry runs.
  This supersedes earlier incremental staging instructions. Before requesting
  release approval, demonstrate completed implementation and required local
  acceptance gates, disclose any live-only validation still outstanding, and
  obtain Riley's explicit approval for the exact release. Passing checks or
  judging the app finished does not itself authorize deployment.
- A send requires every applicable global, campaign, mailbox, contact, consent,
  verification, approval, and budget gate to pass.
- Follow-ups remain disabled until their separate evidence gate is approved.
- Keep the runtime ceiling at C$50/month unless the owner explicitly changes it.
- Secrets live in local ignored files or provider secret stores, never source,
  logs, screenshots, commits, issues, or pull requests.

## Engineering rules

- Work in one bounded milestone with an observable exit gate.
- Before coding, apply the owner-outcome work contract in
  `docs/CODEX_AGENT_PROTOCOL.md`: record the owner result, evidence, scope,
  non-goals and unresolved decisions in the active STATUS brief. A helper module
  is not a completed feature. A security milestone must close a specific risk
  with a regression proof and name any remaining integration gap.
- Keep one active delivery milestone. Inventory unfinished changes before adding
  scope; preserve them, but do not let disconnected infrastructure accumulate.
- Explicit owner corrections supersede older plans. Update OWNER_CONTEXT and the
  affected plan before implementation; never treat a proposed provider, budget
  allocation or architecture as an approved business decision.
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

## Codex delegation protocol

- `gpt-5.6-sol` is the sole orchestrator and integration owner. Project-local
  defaults use high reasoning for that role.
- Every child agent defaults to `gpt-5.6-luna` with max reasoning and low
  verbosity. Use children only for useful independent exploration, first-party
  research, focused tests, security/UI/lead-quality review, or an explicitly
  non-overlapping implementation patch. Do not delegate trivial work.
- Sol must not override a child's approved model, reasoning effort, verbosity,
  sandbox, or permissions. Any exception requires a new ADR plus Riley's explicit
  decision recorded in `docs/STATUS.md`.
- A child task packet must state the objective and exit gate, starting branch
  and commit, allowed files and commands, read/write scope, safety limits, and
  required result format.
- Before reading any project file, every child must prove that Git resolves to
  exactly `C:/Users/riley/Documents/ChatGPT/APE` and that the current branch and
  HEAD equal its task packet. A mismatch is a hard stop, not a warning. Every
  child filesystem or Git command must target that exact checkout using an
  absolute path or `git -C`; inherited working-directory state is untrusted.
- Child agents never spawn more agents, use OneDrive or Google Drive, expose
  secrets, contact prospects, use live providers/resources, deploy, migrate,
  commit, push, merge, rebase, or change production controls.
- Children return a concise `Result`, `Evidence`, `Checks`, `Risks`, and `Next
  action` summary instead of raw logs. Their summary is evidence for Sol to
  verify; it never replaces repository tests or a clean checkpoint. `Checks`
  must include the attested repository root, branch, and starting HEAD. Sol must
  reject a report that names another root or commit.
- Sol owns milestone selection, shared files and durable docs, safety review,
  integration, the complete release gate, atomic commits, branch pushes, and
  any future proposal to merge into `main`.
- Run no more than three children concurrently. Read-only work may be parallel.
  Parallel writers require separate worktrees and non-overlapping file ownership;
  otherwise serialize them.
- Before accepting a write-capable child result, Sol must compare the starting
  commit, declared allowlist, and `git diff --name-only` output and reject any
  out-of-scope file. A read-only role must never receive broader runtime access.
- The full operating protocol and role definitions live in
  `docs/CODEX_AGENT_PROTOCOL.md` and `.codex/agents/`.

## Rebuild monitor protocol

- Riley's private status surface is the loopback-only rebuild monitor documented
  in `docs/REBUILD_MONITOR.md`. It must run only from
  `C:\Users\riley\Documents\ChatGPT\APE` and must never be hosted or copied to
  OneDrive or Google Drive.
- Update it only on a meaningful transition: milestone start, long testing,
  fixing a review finding, release verification, verified commit/push, a true
  blocker, or inactivity. Do not turn routine commands into timeline noise.
- The only work states are Planning, Coding, Testing, Fixing, Verification,
  Committed, Blocked, and Inactive. A Blocked state must name the exact Riley
  action. A Committed state requires a release receipt for the exact commit plus
  local/upstream/GitHub equality; cleanliness alone is not verification.
- Keep the verified checkpoint separate from unfinished working-copy status.
  Never show secrets, environment values, file diffs, file names, raw tool logs,
  private reasoning, or chain-of-thought in the monitor.
- The monitor has zero operational authority. Its safety facts remain no sends,
  no production changes, no external prospect contact, no paid provider work,
  and C$0 unless Riley separately authorizes a future milestone that changes one
  of those facts.
- After the bounded milestone is committed locally, run
  `npm run rebuild-monitor:prove-release`, push that exact proven commit, verify
  local/upstream/remote equality, and only then record `--checkpoint`. Update
  both the monitor and `docs/STATUS.md` in the same work cycle.

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

Do not repeat successful broad checks between small edits unless changed scope,
a failure or an unresolved risk justifies them. Required checkpoint/release gates
still apply in full. Documentation-only working-copy edits may be checked with
relevant policy checks and diff/link review, but cannot be called a verified
release or pushed without the existing exact-commit release process.

Automated tests must use fakes or mail sinks and must never contact prospects.
Run `npm run test:owner-ui` only after every Next/OpenNext/Cloudflare build or dry
run has exited. Those commands share `.next`; running them concurrently can swap
browser assets mid-request and produce a false intermittent `SyntaxError`.
When changing the saved-email activity view or its reader, also run
`npm run test:saved-email-ui` after builds/dry runs exit. This loopback-only fixture
uses the real component, built CSS and saved-history handler with synthetic auth
and storage; it is not proof of the full application sign-in or reply approval UI.
When changing legacy email display boundaries, run `npm run test:legacy-email-ui`
after builds/dry runs exit. It renders the actual client-page props, ClientProfile
and shared message viewer against synthetic authentication and disposable storage.
Do not treat it as proof of dashboard/automation summaries or full application login.
When changing dashboard/automation mail summaries or saved mailbox status, run
the summary privacy/D1 tests and `npm run test:owner-ui`. Its authenticated
desktop/mobile summary-to-message checks are separate from the isolated viewer
fixtures. Preserve the difference between shared business data and private mail.

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
