# Connected calling baseline

Implementation authorized by Aidan on September 24, 2026 (America/Toronto). Native execution, all three projects in scope.

- Source: `rileyhins17/axiom-revenue-engine`, branch `codex/revenue-engine-production`, original commit `f2f954b5b59ee7b3ce8c732292a7ff2d59200dae`.
- Source heads rechecked September 25, 2026 UTC; all three remain current. Recheck before handoff.
- Working branch: `codex/connected-calling`; separate fresh checkout.
- Runtime: Node 24.19.0; npm 11.9.0; Orbit explicitly uses pnpm 10.12.1.
- Existing migration maximum: 0078.
- Private snapshot recovery verified all Git blob, tree and original commit hashes. No content reconstruction guesses or synthetic baseline commit.

## Verification

Safety, typecheck and lint passed (4 existing lint warnings). Baseline loader run: 889 passed, 20 failed. The tsx launcher and spawned tsx children cannot bind IPC sockets here; cascading M2 fixture failures followed. One CRM date test depends on host timezone: passes under America/Toronto. These are recorded baseline failures; they are not claimed fixed. Shared protocol: 8 cases passed.

## Release boundaries

No deployment, production migration, provider activation or prospect contact. Phone Link, two-way audio, acoustic latency and Windows behavior require owner-controlled device acceptance. Orbit's inspected production-source snapshot is the maintained implementation source for this branch; its actual live deployed SHA remains unverified. Engine's release record reports a deployment; it is not independent live-commit verification.

## Freshness and compatibility

The owner requested latest source and best/newest components. Registry version inventories were captured for all three projects. Several available updates are major framework/compiler changes. The current implementation first establishes tests on the latest maintained project code, then evaluates upgrades against compatibility and real defects. No framework or lockfile was silently upgraded. Recheck remote heads and dependency advisories before release.
