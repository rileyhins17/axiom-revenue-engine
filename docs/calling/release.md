# Connected calling release — September 25, 2026

The owner-authorized production rollout is active. Engine and Orbit serve the connected-calling protocol, the additive migrations are applied, and Caller 0.5.2 is installed on the owner device. The earlier local-review packet remains an immutable historical checkpoint.

## Deployed source

| Component | Source commit | Active Worker version |
| --- | --- | --- |
| Engine | `49b45523b7e9a9d444bc56cbfaa1b716977c12c5` | `ecfba54e-ce3b-4529-844f-86c2849e3219` |
| Orbit | `a950deea85eb8bad7a90169cf8ba1584d9e16b40` | `99416ffe-d510-4096-a034-b6e7864207c2` |

Engine uses its maintained production configuration and branch. Orbit includes the newer live provider-metering, policy and JEV safeguards; see its live-source reconciliation note. Existing runtime budgets, autonomy stops, email restrictions and schedules were retained. New calling is enabled only for the intended workspace in each deployment. Scheduled Caller sync remains off; ordinary durable recovery remains available. Repository defaults remain off to prevent accidental activation from generic commands.

Fresh private database exports were hashed and restored before rollout. The original rows passed preservation checks after the additive migrations. The remote migration runner rejected the Engine trigger syntax; the supported D1 file-import path applied the identical reviewed SQL and migration ledger entry after a local D1 rehearsal. No trigger or constraint was weakened. Exact receipts, rollback bookmarks and private exports are retained outside Git.

Both authenticated connection and task-list endpoints returned HTTP 200 through the real installed extension browser. The selected Engine record also passed live preparation without creating a call attempt or dialing. Matching scoped peer credentials are installed on both Workers; signed bidirectional coordination and recovery are covered by the local handler tests. No artificial production results, prospect calls or paid-provider tests were used.

## Caller verification and recovery

Caller 0.5.2 fixes native Window/Worker fetch binding and permits a fresh backup restore when the only connected metadata is an empty legacy-migration receipt. Preserved jobs, drafts, calls and other connected metadata still block destructive restore. The regression was reproduced before each fix; the complete suite now passes 265 tests, strict type checking and package checks. Real-browser connected journeys and native fetch in both Window and Worker contexts pass.

The owner workspace uses a dedicated persistent browser profile and the application's validated backup importer. Saved leads, calls, research, transcripts and history were compared with the original snapshot across restarts. Raw extension data and the old package remain backed up separately. Old command/workflow execution state is retained in that raw backup; the supported importer deliberately clears stale execution state. Credentials are absent from portable exports and release archives.

Manual Phone Link calling is the primary path. Optional ChatGPT assistance remains separate from phone facts and audio. Physical pairing, two-way audio, OS confirmation count and uncoached operator acceptance still require the owner's phone and participation. Software verification does not establish those facts.

## Rollback

Pause new calling while retaining reconciliation, receipts, results, stops and exports. Previous compatible Worker versions are Engine `0d57d86c-5bbe-41f8-872c-e5dd72153951` and Orbit `5bdde3da-d811-437d-ba9b-1e0842f5a9cc`. Retain the additive schema and accepted history. A full database restore would discard later writes and requires a separately reviewed recovery decision. Do not reinstall Caller v1 over IndexedDB v2; use a compatible hotfix or the validated export/import path. A source receipt does not prove peer delivery.
