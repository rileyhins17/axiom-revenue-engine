# Verified local connected calling snapshot

Tested implementation commits: Caller `e616e2b850c0e7b6896a759cb1440f5acdd760f0`, Engine `9e7d6d58df80c035a5f93bc1c484a7827e500ee1`, Orbit `ef4b97d078ddeb550700ecf0d7d575eb05c7c618`. Subsequent release documentation commits change Markdown only; the packet manifest identifies final heads and patch trees.

| Component | Final checks |
| --- | --- |
| Caller | 263 tests; types/build/package; Chrome153 and Brave154 journeys, delayed replies, dedicated-worker recovery; legacy browser |
| Engine | Safety; 975 tests; types; lint 0 errors / 8 warnings; Cloudflare build and no-upload dryrun; stock 8 and extended 10 owner-UI WCAG pages1440 / 390; zero external requests |
| Orbit | 2,305 tests / 232 files; repository/preflight; types/client+SSRbuild; actual signed handoff browser1440 / 390, WCAG and zero external requests |
| Cross-app | 3 actual signed-handler bridge tests: shared ownership/stops, reviewed conversion, correction ancestry/reordered delivery; no external transport |

Engine used physical npm-ci dependencies in a short clean Windows checkout; the final lockfile is unchanged from that installation. Its auth pin is1.6.29; Orbit's is1.7.2. Newer auth releases failed existing schema contracts. Engine's eight lint warnings are four preexisting and four unused destructuring bindings surfaced by the lint upgrade; no errors remain.

All five Important independent-review findings were fixed in one TDD pass: delayed UI response identity, unresolved callbacks, parent-before-correction delivery, missing callback zone, and strict default-off workspace activation. The initial activation provider remounted the app on account lookup and cleared search input. The unchanged owner-browser journey reproduced it; identity-bound activation state now preserves the page. No selector was weakened and the complete gate passed after this fix. No Critical or Minor findings were returned, and no second review was dispatched.

## Measured P95 over 30 samples per browser

| Browser | Visible feedback | Local durable save | Cached next brief | Synthetic source receipt |
| --- | --- | --- | --- | --- |
| Chrome 153.0.8010.53 | 0.6 ms | 8 ms | 23.3 ms | 5.6 ms |
| Brave 154.0.8037.58 | 0.6 ms | 8 ms | 23.3 ms | 5.7 ms |

Fresh headless profiles use actual IndexedDB and an in-process synthetic source. Each retained 30 physical-attempt/event/delivery/source-receipt records with no loss or duplicate fixture activity. All raw samples are retained. These are not deployed-network, peer-projection or acoustic measurements; those remain unverified.

## Owner gates still open

Phone Link/iPhone confirmations, physical hangup, both directions of audio, installed-extension service-worker suspension/restart and uncoached owner journeys remain unverified. The runnable build and checklist are the approved local fallback. Engine's configured deployed Worker was unavailable in the read-only account check; Orbit version 72 lacked a source commit annotation. Verify both deployed commits, fresh production backups/restore drills and intended account mapping before mutation. Calling and scheduledsync remain false in checked-in config.

No push, PR publication, merge, production migration/deployment, installed-extension change, live call or paid-provider action occurred. Original workspace/data are preserved. The Engine C$50/month ceiling is unchanged; a one-minute sync scheduler adds about 43,200 invocations/app/month only after its separate gate.
