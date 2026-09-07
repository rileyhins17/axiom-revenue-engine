# Private rebuild monitor

The rebuild monitor is Riley's plain-English window into the Axiom Revenue
Engine rebuild. It runs only on this computer, reads the repository's persisted
checkpoint plus the live Git working-copy state, and makes no provider or
internet request.

## Open it beside a Codex task

1. Open a Codex terminal in `C:\Users\riley\Documents\ChatGPT\APE`.
2. Run `npm run rebuild-monitor` and leave that terminal running.
3. Open `http://127.0.0.1:4317` in a Codex browser panel on the right.
4. Leave the panel open while work continues. It refreshes every five seconds.

Ask Codex to **open the rebuild monitor** if you do not want to handle the local
address. Closing Codex or restarting the computer can stop the local server;
run the same command again to restore it. The current monitor state survives
because it is stored locally outside the chat transcript.

## What the screen means

- **Current milestone** says what is being built in business language.
- **State** is one of Planning, Coding, Testing, Fixing, Verification, Committed,
  Blocked, or Inactive.
- **Last verified checkpoint** is an exact tested Git commit. It is not the same
  as work that is currently being edited.
- **Working copy** says whether unfinished changes exist without exposing file
  names, diffs, terminal output, credentials, or private reasoning.
- **Rebuild stage map** is deliberately conservative. It uses Complete, In
  progress, Blocked, Not started, or Locked instead of a made-up percentage.
- **Completed / In motion / Next** gives the short owner summary.
- **Blocker / Riley action** is empty unless work truly needs a specific decision.
- **Safety** always states whether sending, production changes, outside contact,
  or spend occurred during the current rebuild milestone.

This monitor is a status surface, not an execution control. It cannot send an
email, contact a provider, deploy, migrate a database, approve a lead, or change
production.

## Agent update contract

Agents update the monitor only when the work meaningfully changes: a milestone
starts, long testing begins, a review finding requires a fix, the release gate is
being verified, a commit is fully verified and pushed, or an exact blocker needs
Riley. Routine commands and internal reasoning never become timeline entries.

Examples:

```powershell
npm run rebuild-monitor:update -- --state testing --message "The local rebuild monitor is built and its privacy and contract checks are running."

npm run rebuild-monitor:update -- --state blocked --message "The milestone is waiting for the exact staging decision." --blocker "Staging approval is required." --owner-action "Review the named release packet and supply its exact approval phrase if you want staging changed."

npm run rebuild-monitor:update -- --state committed --message "The verified monitor milestone is committed and pushed." --checkpoint
```

`--checkpoint` is accepted only after the exact committed tree passes
`npm run rebuild-monitor:prove-release` and that same commit is pushed to the
configured GitHub branch. The proof command runs the monitor check, all repository
tests, type-checking, lint, both Cloudflare dry builds, the owner-browser gate,
and the other release checks in their required sequence. The updater then proves
that local `HEAD`, its tree, its upstream, and the current GitHub branch all equal
that receipt. It derives the commit instead of trusting typed text.

Current state and the local release receipt are written atomically under the
ignored `data/rebuild-monitor/` directory. A tracked safe seed at
`docs/rebuild-monitor/seed.json` lets a fresh checkout start without inventing
status.

## Privacy and recovery

- The server is fixed to `127.0.0.1`; it cannot listen on the network.
- It refuses a OneDrive checkout and does not read environment variables.
- The page has no analytics, remote fonts, remote images, or external scripts.
- Visible text is length-bounded, single-line, schema validated, and screened
  for common credential and private-reasoning patterns.
- GitHub is the durable code/checkpoint source. The ignored local state is only
  Riley's current-machine display state and can be rebuilt from `docs/STATUS.md`
  plus the tracked seed after a machine loss.
- Google Drive is not used.

Malformed local state fails closed instead of silently showing the older seed.
If the page says its state is unavailable, ask Codex to compare the local file
with Git and `docs/STATUS.md`, move the invalid file to a dated local quarantine,
and create a new current state through `npm run rebuild-monitor:update`. Do not
delete the only copy or replace it without that comparison.

For the final checkpoint flow: commit the bounded milestone locally, run
`npm run rebuild-monitor:prove-release`, push that exact commit, confirm local,
upstream, and remote equality, and only then use the committed update with
`--checkpoint`.
