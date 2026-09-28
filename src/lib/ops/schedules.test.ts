import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const config = JSON.parse(readFileSync("wrangler.production.jsonc", "utf8").replace(/^\s*\/\/.*$/gm, "")) as { triggers?: { crons?: string[] } };
const worker = readFileSync("worker.mjs", "utf8");
const crons = config.triggers?.crons ?? [];

test("live schedules name their weekdays (Cloudflare's 1 is Sunday, so 1-5 meant Sunday to Thursday)", () => {
  for (const cron of crons) {
    const weekday = cron.trim().split(/\s+/)[4]!;
    assert.ok(weekday === "*" || /^[A-Z]{3}(-[A-Z]{3})?(,[A-Z]{3}(-[A-Z]{3})?)*$/.test(weekday), `${cron}: use day names, not numbers`);
  }
  assert.ok(crons.includes("0 11 * * MON-FRI"), "the lead search runs Monday to Friday at 7am Toronto");
  assert.ok(crons.includes("0 14 * * MON-FRI"), "the gated email batch runs Monday to Friday at 10am Toronto");
});

test("every live schedule has its own handler in worker.mjs, so none falls through to the legacy tick", () => {
  for (const cron of crons) assert.ok(worker.includes(`"${cron}"`), `worker.mjs does not handle "${cron}"`);
  // The numeric form is accepted too, in case Cloudflare reports a schedule that way.
  assert.ok(worker.includes(`"0 11 * * 2-6"`) && worker.includes(`"0 14 * * 2-6"`));
});
