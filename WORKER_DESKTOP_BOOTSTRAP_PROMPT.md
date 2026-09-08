# Legacy Windows launcher notes

This file is retained only for the existing local Windows launcher. It is not the
Revenue Engine source of truth and must not be used to bootstrap project work.

Repository: `https://github.com/rileyhins17/axiom-revenue-engine`

Before launcher maintenance, read `AGENTS.md`, `docs/OWNER_CONTEXT.md`,
`docs/STATUS.md`, `docs/GOTCHAS.md`, `README.md`, and `setup.md`. Preserve local
secrets and uncommitted work. Do not run live cron, Gmail, inbox-sync, form, social,
or production migration/deploy actions as verification.

The launcher may start/stop the local legacy worker, persist its machine-local
name and repository path, and create a hidden-shell Desktop shortcut. It must not
claim the Revenue Engine or production is healthy without real checks. New durable
processing belongs in the Cloudflare Workflow/Queue architecture described in
`docs/MASTER_PLAN.md`; do not add new orchestration to the launcher.

Verify PowerShell syntax, exact process targeting, local-only behavior, and the
relevant repository checks before committing launcher changes.
