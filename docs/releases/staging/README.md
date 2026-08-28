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
