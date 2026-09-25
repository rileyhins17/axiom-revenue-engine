# Connected calling acceptance

This is a local candidate for owner-controlled acceptance. Automated phone transport is an inert hash; no fixture may open TEL or reach a prospect. The installed extension and its data have not been modified.

## Repeat the automated checks

Use Node 24.19.0; run `npm ci` in Caller/Engine and `pnpm install --frozen-lockfile` with pnpm10.12.1 in Orbit. Keep the three repositories beside each other.

- Caller: `npm run check`, `npm run test:connected-browser`, `npm run test:fixture-browser`; then `python tests/browser_response_race.py`, `python tests/browser_worker_recovery.py` and `python tests/browser_calling_latency.py` with the already built test bundle. Install Python Playwright if absent. `CHROMIUM_PATH` selects an existing Chrome/Brave executable. Tests use fresh headless profiles and intercept every external request.
- Engine: safety → full tests → typecheck → lint → Cloudflare build → `npx wrangler deploy --env="" --dry-run --autoconfig false` → owner UI, all sequential. Use physical dependencies in a short Windows checkout path. Wait for all test/build processes before owner UI. No upload occurs in dry run.
- Orbit: `pnpm verify`, then the release packet's real SSR handoff fixture. The cross-app bridge fixture runs from Orbit using `node --import tsx --test ../bridge-smoke.test.ts`; all HTTP transport is injected into actual local signed handlers.

Browser evidence covers first token connection, Engine call/restart, Orbit callback with exact words/time zone, reviewed client opportunity decisions and failed-sync recovery. Upgrade blocking, transaction abort/reopen, old backups and worker termination are separately exercised. Worker termination uses a dedicated WebWorker around the actual IndexedDB save, not an installed extension service worker. Real service-worker suspension/restart remains a device acceptance step.

Thirty synthetic UI call/save cycles retain every sample. Feedback means observed disabled Saving text; local save means committed IndexedDB; next ready measures the prefetched record; source sync measures the fixture receipt. Report median/P95/max separately, never as production network or acoustic timing. Peers require their own confirmed receipt. Deployed latency and audio remain unverified.

## Owner device checklist — not yet performed

Read-only inventory on this PC: Windows11 Home10.0.26300 build26300; Phone Link1.26082.108.0; Chrome153.0.8010.53; Brave154.1.96.59. iOS version, audio devices, pairing state and permissions remain unverified. Record the versions actually used at acceptance.

1. Finish the source release gate and fresh data backups first. Export the existing extension data, verify the export opens, record extension ID/version and active work, and retain the current package. Do not blindly replace or downgrade an active installation. Refresh existing ChatGPT tabs after the trusted-storage update when testing legacy Voice recovery.
2. In an isolated owner-controlled acceptance installation, connect tokens issued for the intended verified Engine/Orbit accounts. Confirm displayed operator/workspace. Wrong-account reconnection must leave the original queue isolated. Never paste production tokens into screenshots, test fixtures or this report.
3. Use a consenting owner-controlled recipient's real number. Confirm the exact number shown in Caller, the TEL handler and Phone Link; count every browser/Windows/Phone Link confirmation. Record that no number was typed. Test copy fallback using the same consented number. Never call synthetic fixture numbers.
4. Before dialing, confirm no other window/operator owns the contact. Open Phone Link; verify Caller remains Dial requested until explicit connection. Confirm connection only after the person answers, hang up physically, then confirm end in Caller. Record which actions were physical versus software confirmations.
5. Repeat disconnect/reconnect, unsupported TEL handler, side-panel close/reopen, browser restart and extension background suspension before/during/after local save. Uncertain calls must require explicit reconciliation. Saved records and pending deliveries must survive without duplicate calls, activities or sales.
6. Verify both directions of phone audio and microphone routing. Separately test optional Voice with an approved backend/use. Hearing phone audio in speakers does not prove the model receives it; hearing AI locally does not prove the recipient hears it. Record backend/device settings, interruption behavior and at least30 end-of-speech→first-audible-reply samples if acoustic latency is claimed. Manual calling does not depend on this gate.
7. Aidan and Riley each perform the five journeys using only the setup guide, without developer coaching. Record completion, mistakes, tiny text, unclear states and extra actions. These human runs have not occurred; automated fixtures do not substitute for them.

Record each observation with actor, date, exact three commits/package hash, browser/device versions, scenario, action count, result, source receipt, peer receipt and recovery. Any device blocker or lost/duplicate outcome keeps the release gate open.
