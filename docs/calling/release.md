# Connected calling release gate

The local code, automation and package are review candidates. No production migration, merge, deployment, token/grant setup, extension installation, live call or paid provider action has been performed. The final packet identifies exact commits, migration/package SHA-256 values, checks and remaining gates. Do not infer readiness from version0.5.0 alone.

Protocol versions: axiom-caller/2; separately signed peer coordination, call projections and contact-stop receipts. Upgrade all three components as a reviewed set. Retain the existing outreach/qualification/approval controls and C$50/month Engine ceiling. Pi/audio routing is outside the initial manual path.

## Before production changes

Verify the intended Cloudflare accounts and deployed source commits. The read-only local check could not find Engine's configured Worker in the available account (Cloudflare10007). Orbit production was observable: version72,5bdde3da-d811-437d-ba9b-1e0842f5a9cc, created2026-09-22T04:23:45Z, but no source commit annotation was provided. This is partial identity evidence, not a verified deployed commit. Resolve both mappings before rollout.

Take fresh source database exports and an extension export; hash them; restore copies into isolated local databases and verify known counts/history/current revisions without contacting real sources. Current synthetic rollback/backup tests pass only for fixtures. Production backup freshness and restoration are unverified. Retain compatible rollback code and the exact migration bytes. Existing production source ambiguity is a release blocker, not permission to pick a deployment.

## Ordered rollout after explicit owner approval

1. Apply only the reviewed additive Engine0079 and Orbit0033 calling migrations with new calling entry points disabled. Preserve legacy history and the existing auth schemas; Orbit remains Better Auth1.7.2 because later versions change its required account.issuer contract.
2. Deploy compatible source APIs with activation off; verify legacy reads and owner login using approved acceptance data. Confirm no new discovery, assessment, research, email or monitoring authority. Migration, deployment and spend are never tests.
3. Validate the exported extension data and compatible recovery build, then let the owner install/update Caller. Reconnect only the intended identities. Restored active sessions stay uncertain, and queued results require original-account reconnection.
4. After approval, set CALLER_V2_ENABLED="true" and CALLER_V2_WORKSPACE_ID to exactly "axiom" in Engine and the intended workspace ID in Orbit. Both flags default off in root and production config; tokens and peer grants cannot opt in. Missing, boolean or mismatched values stay off. Source launch controls show Calling paused until enabled. New task/preparation/reservation/arming and linked source checks are blocked while off; already-armed active heartbeats, reconciliation, results, receipts, stops and link/conversion recovery remain available. Recheck both source controls for linked calling. Create a scoped peer grant separately if linked calling is approved; confirm both records/contact explicitly. Never infer a link from matching phone/domain. Complete the device and five-journey checks in acceptance.md.
5. Keep CALLER_SYNC_ENABLED=false until the sync-only scheduler's configuration/budget gate. Immediate best-effort sync and retained outboxes are separate. A new one-minute trigger adds approximately43,200 invocations per app per30days. Do not enable general monitoring/email schedules as a side effect.

## Rollback

Disable new call entry/preparation/arming while keeping active-call reconciliation, source receipts/results, stops, durable recovery and exports available. Disable scheduled sync if faulty. Keep accepted history/stop/link tombstones and new additive tables. Roll back only to code compatible with the additive schema; never drop call tables, overwrite new outcomes with a stale source backup, or reinstall Caller v1 over IndexedDB v2. Use a compatible hotfix build or reviewed export recovery. A source receipt never proves its peer synchronized.

## Local review artifacts

The package contains source patches/commit inventory, source migrations with hashes, synthetic verification reports, the runnable extension folder/zip, browser fixtures and owner checklist. Draft PR descriptions identify exact maintained target branches; no branch is pushed or PR published without authorization for that external step. No secrets, owner data exports, node_modules or installed browser profiles belong in the packet.
