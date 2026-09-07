# ADR 0058: Private local rebuild monitor

- Status: Accepted
- Date: 2026-09-06
- Decision owner: Riley Hinsperger

## Context

The rebuild spans many Codex tasks and can be interrupted by quota exhaustion,
application restarts, or lost chat context. `docs/STATUS.md` preserves detailed
engineering truth, but it is too long to function as Riley's always-visible CEO
view. A hosted dashboard would create deployment, authentication, availability,
privacy, and cost obligations before those capabilities are justified.

The monitor must distinguish a verified commit from unfinished working-copy
changes. It must show business progress without exposing secrets, raw tool logs,
file diffs, or hidden reasoning. It must also refuse synced Drive folders.

## Decision

Run a static owner-first dashboard from a small Node HTTP server fixed to
`127.0.0.1`. The browser reads one versioned, schema-validated monitor document
and a bounded live Git summary. The page renders persisted text only through DOM
text nodes and loads no external assets.

The tracked `docs/rebuild-monitor/seed.json` is the safe recovery baseline. The
current machine writes `data/rebuild-monitor/state.json`, which is already under
the repository's ignored `data/` boundary. Writes are atomic. A committed state
requires a local release receipt produced by executing the complete release gate
against the exact committed tree, followed by a push. The updater rechecks the
receipt, tree, clean working copy, upstream, and GitHub branch before deriving
the checkpoint directly from Git.

The stage map has seven master-plan stages and qualitative states. It does not
calculate a completion percentage because groundwork and commercial validation
do not have equal effort or risk.

Meaningful transitions are Planning, Coding, Testing, Fixing, Verification,
Committed, Blocked, and Inactive. A Blocked state requires the exact Riley
action. Agents update the timeline only for a real state change, not every tool
call. Repository status and the monitor are updated in the same work cycle.

## Security and authority

- The server, verifier, proof command, and updater require the exact canonical
  path and branch. Alternate clones—including every OneDrive or Google Drive
  folder—fail closed.
- The host is a constant loopback address, the server reads no environment
  variables, and strict response headers deny remote content and form actions.
- The API reveals the branch, commit title/SHA, clean/unfinished state, and
  changed-file count only. It never exposes file names or patch content.
- Bounded visible copy rejects multiline dumps, common credential forms, and
  explicit private-reasoning labels.
- The monitor has no mutation API and grants no provider, database, outreach,
  sending, deployment, migration, or spending authority.

## Consequences

Riley gets a low-maintenance screen that can remain beside the active Codex task
and accurately separates completed work from unfinished work. A fresh task can
recover from repository state without relying on the conversation.

The local server must be restarted after the computer or Codex process stops.
The ignored current-machine timeline is not a backup; exact checkpoints remain
in Git and detailed truth remains in `docs/STATUS.md`. Remote viewing and hosted
access are deliberately out of scope.

Invalid local state is shown as unavailable rather than falling back silently.
Recovery requires comparing it with Git and `docs/STATUS.md`, quarantining the
invalid file locally, and regenerating status through the validated updater.

## Verification

- `npm run rebuild-monitor:check`
- `npx tsx --test scripts/rebuild-monitor.test.ts`
- `npm run rebuild-monitor:prove-release` against the final clean commit
- Full release gate in `AGENTS.md`
