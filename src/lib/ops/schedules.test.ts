import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const config = JSON.parse(readFileSync("wrangler.production.jsonc", "utf8").replace(/^\s*\/\/.*$/gm, "")) as { triggers?: { crons?: string[] } };
const worker = readFileSync("worker.mjs", "utf8");
const crons = config.triggers?.crons ?? [];

test("the live Worker runs only the health check and the FCC send tick", () => {
  assert.deepEqual(crons, ["*/15 * * * *", "* 14-19 * * *"]);
});

test("every live schedule has its own handler in worker.mjs", () => {
  for (const cron of crons) assert.ok(worker.includes(`"${cron}"`), `worker.mjs does not handle "${cron}"`);
});

test("the send tick runs the campaigns and FCC sending, the 15-minute check runs health, the reply check and the weekly numbers, and nothing else runs", async () => {
  const source = worker
    .replace(/^import[\s\S]*?from\s+"[^"]+";\s*/gm, "")
    .replace(/^export \{[^}]+\};\s*/gm, "")
    .replace("export default exportedWorker;", "return exportedWorker;");
  const runs: string[] = [];
  const deps = {
    AsyncLocalStorage: class {}, openNextWorkerModule: {}, EmailMessage: class {}, setCloudflareBindings: () => {}, clearServerEnvCache: () => {},
    runSendCron: async () => { runs.push("send"); return { fcc: {}, campaigns: {} }; },
    runFccReplyCheckCron: async () => { runs.push("reply-check"); return {}; },
    runFccWeeklyNumbersCron: async () => { runs.push("weekly-numbers"); return {}; },
    runHealthChecks: async () => { runs.push("health"); return []; },
    recordAndSelectAlerts: async () => ({ newProblems: [], reminders: [], fixed: [] }),
    alertEmail: () => null, OWNER_ALERT_INBOXES: [],
  };
  const live = new Function("deps", `const {${Object.keys(deps).join(",")}}=deps;\n${source}`)(deps) as {
    scheduled(controller: { cron: string }, env: object, ctx: { waitUntil(p: Promise<unknown>): void }): Promise<void>;
  };
  const tasks: Promise<unknown>[] = [];
  const run = async (cron: string) => { await live.scheduled({ cron }, {}, { waitUntil: (p) => tasks.push(p) }); await Promise.all(tasks); };
  await run("* 14-19 * * *");
  assert.deepEqual(runs, ["send"]);
  await run("*/15 * * * *");
  assert.deepEqual(runs.sort(), ["health", "reply-check", "send", "weekly-numbers"]);
  await run("0 11 * * MON-FRI");
  assert.equal(runs.length, 4, "a retired schedule runs nothing");
});
