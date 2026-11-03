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
