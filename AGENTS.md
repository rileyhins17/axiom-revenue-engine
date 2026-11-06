<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Axiom Revenue Engine operating contract

This repository is Axiom's outreach engine: the live Worker `axiom-ops-omniscient`
at operations.getaxiom.ca. It sends every campaign (cities, agencies) and the FCC filing
emails from the founders' Gmail inboxes, follows up, reads replies and bounces, and shows
the founders what happened. Campaigns: `docs/runbooks/CAMPAIGNS.md`.
The old website campaign (call lists, connected calling, lead search, website checks)
was removed on 2026-11-03; it is in git history if it is ever needed again.

## Read this before changing anything

1. `README.md`, then `docs/runbooks/FCC_CAMPAIGN.md`.
2. The top of `docs/STATUS.md` (what is live, the rollback target, open decisions).
3. `docs/GOTCHAS.md`.
4. `docs/adr/0061-upgrade-legacy-production-in-place.md` before any release.

Then verify `git status`, the branch and the latest commit. The live branch is
`codex/revenue-engine-production`; `main` is stale and must never be deployed. Do not
assume an earlier agent's notes still match the code or production.

## Rules that protect the campaign

- Never send a real email as a test. Tests use fakes; the `smtp-test` command only
  emails the sending inbox itself, and a campaign's test emails only go to `TEST_INBOXES`.
- A campaign batch sends only after its named approver approved it for the current words.
  Record an approval given outside the screen only when that founder said so.
- Any change to email wording gets a new `FCC_COPY_VERSION`, which locks sending
  until a founder's go names it. Record the go only when a founder has said so.
- Never raise daily limits, add inboxes, change who is emailed or remove a safety
  pause without both founders' yes.
- Pause is always allowed. Resume only reopens an email a founder already approved.
- The reply check and inbox checks are read-only. Never change or delete mail.
- Releases go only through `scripts/release-production.mjs` (fresh backup, checksum,
  live-settings guard, smoke test, automatic rollback), after the day's last send.
  Never use `wrangler deploy` directly; `npm run deploy` is blocked on purpose.
- Never drop or rewrite live tables. Migrations add; the next free number is 0090
  and must be added to `KNOWN` in the release script.
- This repository is public. Contact lists, the mailing address, app passwords and
  tokens live in the gitignored `outreach/` folder or in Cloudflare secrets, never
  in source, logs, commits or pull requests.
- Keep engine running cost at $0: free Cloudflare plans, no paid APIs.

## Engineering rules

- One request must never wait on work another request started. A request the browser
  cancels can leave shared in-flight work unfinished forever, and every later request
  on that copy of the Worker then hangs (see GOTCHAS WORKERS-001). No module-level
  promises or caches of anything still pending.
- Every screen loads within the time limits in `worker.mjs` and `src/lib/timeout.ts`;
  a failure shows the retrying error screen, never a hang.
- Tests whose fixtures carry real dates pin their clock.
- Commit before running the full suite: some tests read the migrations folder.

## Required verification

Before a pull request, run:

```powershell
npm run check:safety
npm test
npm run typecheck
npm run lint
npm run build:cloudflare
```

## Documentation is part of the change

Every release is written up at the top of `docs/STATUS.md` with the live version, the
rollback version and anything a founder must do. Update the README when a screen or
the sending rules change. Record only proven, recurring traps in `docs/GOTCHAS.md`,
each with the symptom, the cause and the fix.
