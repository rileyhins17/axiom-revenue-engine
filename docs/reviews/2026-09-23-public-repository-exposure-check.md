# Public repository exposure check

**Checked:** 2026-09-23 UTC. **State:** containment pending; no visibility change or
history rewrite performed by this check.

## Confirmed facts

- GitHub's unauthenticated and authenticated repository API both returned
  `visibility: public` and `private: false` for
  `rileyhins17/axiom-revenue-engine`. The credential used for the authenticated
  read has repository admin permission. GitHub reported zero forks and no
  GitHub Pages site at the time of the check.
- The current tree tracks `docs/OWNER_CONTEXT.md`, whose first lines expressly
  label it private repository context and say not to publish it. The tracked
  `AGENTS.md` also describes this as a private repository. The current tree has
  740 tracked files. `data/`, `backups/`, and live `.env` files are ignored and
  are not tracked in the current tree.
- Git history contains `data/omniscient.db-wal` (889,952 bytes; blob
  `cab4de30aac18814796bef4e16d137e2ac686804`) and
  `data/omniscient.db-shm` (32,768 bytes; blob
  `f58d32687b4557d8d0b433c7f182b463a9586bda`). The WAL appeared in
  `b42649c` and was removed from the tracked tree in `d353ddf`. A local
  count-only scan of that historical blob found 16 distinct email-like strings
  and three phone-like patterns. No values were printed or copied into this
  review. The scan does not establish whether those records are synthetic or
  real, nor whether all content is recoverable.
- A targeted pattern search over reachable Git history found no obvious
  live/test API-key prefixes, Slack token prefixes, AWS access-key IDs, Google
  API key prefixes, or PEM private-key headers. This is **not** a comprehensive
  secret scan or proof that no credential was exposed.

## Containment and follow-up

1. Hold pushes of further internal operating documents until repository
   visibility is resolved. The owner has been asked for a decision to make the
   repo private. Recheck authenticated and anonymous visibility after any
   change. GitHub reports no forks and no Pages site, reducing the known
   collateral effects of that change.
2. Inspect the historical WAL locally without disclosing record values, decide
   whether it contains real contact or other protected data, and check other
   historical paths. If a secret is identified, revoke or rotate it first.
3. If sensitive data is confirmed, plan a coordinated history cleanup and
   GitHub cache/PR-reference handling. Merely changing visibility or deleting
   a file from the latest tree does not erase prior clones or cached commits.
   Do not force-push or rewrite history while the active PR and collaborators
   are uncoordinated.

No credential was created, displayed, or rotated. No GitHub setting was changed.
No release, migration, email, or outreach occurred. See GitHub's
[visibility-change effects](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/managing-repository-settings/setting-repository-visibility)
and [sensitive-data removal guidance](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository).
