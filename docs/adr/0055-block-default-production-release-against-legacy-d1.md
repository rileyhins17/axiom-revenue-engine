# ADR 0055 — Block default production release against legacy D1

**Status:** accepted for the current release candidate, 2026-09-23.

## Context

The protected production workflow checked out an exact `main` commit, ran
tests, and called `npm run deploy:production`. That alias invoked a raw Wrangler
deploy with the root `wrangler.jsonc`. Although its Worker name was the new
Revenue Engine console, its `DB` binding pointed at the 223 MB legacy
`axiom-ops-omniscient` production D1. A deploy could therefore give new routes
read/write access to legacy records and fail on missing newer schema without
any migration. The parallel `db:migrate:production` alias directly targeted the
same legacy database. The workflow's `backup_reference` validator checked
string shape only; it did not verify an export, checksum, restore or target ID.
Protected GitHub approval and green CI did not close these target-identity gaps.

## Decision

Both `deploy:production` and `db:migrate:production` now invoke explicit
fail-closed guards. The safety check verifies those aliases and ensures the
protected workflow calls the guard directly, avoiding npm lifecycle hooks.
The workflow also requires the release SHA to equal the current
`main` tip, so a caller cannot select an older ancestor with an unguarded
deploy script. The existing root config remains for legacy compatibility and
no-upload checks, but it is **not** an approved production target for the new
console. The isolated staging config remains available under its own backup,
migration and release gates. This change performs no deployment or migration.

## Re-enabling production release

Prepare a dedicated production Wrangler config and an isolated, named D1 whose
IDs are verified live. Reject the known legacy and staging names/IDs. Use the
same explicit config for dry run and upload. Bind the release packet and backup
reference to the exact account, Worker, D1 UUID, commit, export path and SHA-256;
verify the export contents and rehearse restore before any schema change. Prove
staging owner flows, rollback and safety state first, then review a new
protected workflow and guard change. An approval phrase, unchecked checksum
string, Time Travel bookmark, or old staging packet alone cannot re-enable
release. Do not weaken these guards simply to make the current workflow green.

## Verification and consequences

`npm run check:safety` fails if either alias becomes raw or the workflow stops
using the guarded deploy path. Direct invocations of the two npm production
aliases exit nonzero before Wrangler is called. Full CI still checks app code,
but production dispatch intentionally stops until the isolated target and
verified recovery path exist. This is a deliberate availability tradeoff to
protect the legacy database and avoid a false production-ready claim.
