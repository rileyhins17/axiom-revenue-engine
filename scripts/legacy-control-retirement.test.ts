import assert from "node:assert/strict";
import { test } from "node:test";
import * as mcp from "../src/app/api/mcp/route";
import * as cron from "../src/app/api/internal/cron-tick/route";
import * as claim from "../src/app/api/agent/jobs/claim/route";
import * as complete from "../src/app/api/agent/jobs/[id]/complete/route";
import * as failed from "../src/app/api/agent/jobs/[id]/failed/route";
import * as heartbeat from "../src/app/api/agent/jobs/[id]/heartbeat/route";
import * as logs from "../src/app/api/agent/jobs/[id]/logs/route";
import * as results from "../src/app/api/agent/jobs/[id]/results/route";
import { setCloudflareBindings } from "../src/lib/cloudflare";

test("retired control methods ignore all credentials, bindings and request bodies", async (context) => {
  context.mock.method(globalThis, "fetch", async () => { throw new Error("Retired routes must not use the network"); });
  setCloudflareBindings(new Proxy({}, {get(){throw new Error("Retired routes must not read bindings");}}));
  try {
    for (const routes of [mcp, cron, claim, complete, failed, heartbeat, logs, results]) for (const method of ["GET","HEAD","POST","PUT","PATCH","DELETE","OPTIONS"] as const) {
      const unreadable = new Proxy({}, {get(){throw new Error("Retired routes must not inspect a request");}});
      const response = Reflect.apply(routes[method], undefined, [unreadable, unreadable]) as Response;
      assert.equal(response.status,410);
      assert.equal(await response.text(),"");
      assert.equal(response.headers.get("cache-control"),"private, no-store");
      assert.equal(response.headers.get("access-control-allow-origin"),null);
      assert.equal(response.headers.get("www-authenticate"),null);
    }
  } finally { setCloudflareBindings(null); }
});
