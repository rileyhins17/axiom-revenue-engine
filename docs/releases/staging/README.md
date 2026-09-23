# Isolated staging console release packets

Each JSON file in this directory identifies one exact, already-tested Git commit
that could later replace the existing isolated staging console. A packet is a
review artifact, not a deployment instruction.

Every packet binds the candidate commit and tree, the exact owner UI/API blobs,
the staging Worker/D1 bindings, local release evidence, the current rollback
version, and all remaining gates. It must keep deployment, migration, providers,
mailboxes, prospect contact, and spend unauthorized.

Verify a packet locally with:

```powershell
npm run staging:verify-console-release -- docs/releases/staging/<packet>.json
```

Verification only reads the packet and local Git objects. It cannot call
Cloudflare, deploy, migrate, contact a website or prospect, use a mailbox, or
spend money. Linux CI, an exact owner approval, an authenticated staging deploy,
and post-deploy synthetic smoke checks remain separate future gates.

The newer application candidate needs migrations 0056–0074 before its owner
console can run against staging. Its separate, immutable pending packet is
[`2026-09-23-migration-console-pending.json`](2026-09-23-migration-console-pending.json).
Verify it with:

```powershell
npm run staging:verify-migration-console-release -- docs/releases/staging/2026-09-23-migration-console-pending.json
```

This prints the packet's canonical JSON SHA-256, checks that its working copy matches Git,
and binds the exact candidate, migration order, config and staging target. It
does not confirm current remote data or authorize a migration or deployment.
The packet is a frozen baseline: later export, rehearsal, approval and release
evidence belong in a new release record bound to this digest, rather than by
editing its pending fields.
