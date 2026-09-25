// Re-labels the newest engine run from its stored signals with the current rules,
// writing a new run file (the original is kept). No network, no browser.
//   node node_modules/tsx/dist/cli.mjs scripts/regrade-run.mts
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { classifyEngineLead, ENGINE_LEAD_RULES_VERSION } from "../src/lib/revenue-engine/engine-lead-rules";
import type { EngineSiteSignals } from "../src/lib/revenue-engine/engine-site-capture";

const RUNS = path.join("data", "kw-evaluation", "engine-runs");
const latest = readdirSync(RUNS).filter((n) => /^run-.*\.json$/.test(n)).sort().at(-1)!;
const run = JSON.parse(readFileSync(path.join(RUNS, latest), "utf8"));
const year = new Date(run.startedAt).getUTCFullYear();
let changed = 0;
for (const result of run.results) {
  if (!result.signals || !result.websiteUrl) continue;
  const decision = classifyEngineLead(result.websiteUrl, result.signals as EngineSiteSignals, year);
  if (decision.label !== result.label) changed += 1;
  Object.assign(result, { label: decision.label, reasons: decision.reasons, codes: decision.codes });
}
run.versions = { ...run.versions, rules: ENGINE_LEAD_RULES_VERSION };
run.regradedFrom = latest;
const out = latest.replace(/\.json$/, `-regraded-${Date.now()}.json`);
writeFileSync(path.join(RUNS, out), JSON.stringify(run, null, 2));
const counts = run.results.reduce((acc: Record<string, number>, r: { label: string }) => (acc[r.label] = (acc[r.label] ?? 0) + 1, acc), {});
console.log(JSON.stringify({ from: latest, to: out, changed, counts }));
