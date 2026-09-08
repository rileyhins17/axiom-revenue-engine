import assert from "node:assert/strict";
import { test } from "node:test";
import * as mcp from "../src/app/api/mcp/route";
import * as cron from "../src/app/api/internal/cron-tick/route";
import { setCloudflareBindings } from "../src/lib/cloudflare";

test("retired control methods ignore all credentials, bindings and request bodies", async (context) => {
  context.mock.method(globalThis, "fetch", async () => { throw new Error("Retired routes must not use the network"); });
  setCloudflareBindings(new Proxy({}, {get(){throw new Error("Retired routes must not read bindings");}}));
  try {
    for (const routes of [mcp, cron]) for (const method of ["GET","HEAD","POST","PUT","PATCH","DELETE","OPTIONS"] as const) {
      const unreadable = new Proxy({}, {get(){throw new Error("Retired routes must not inspect a request");}});
      const response = Reflect.apply(routes[method], undefined, [unreadable]) as Response;
      assert.equal(response.status,410);
      assert.equal(await response.text(),"");
      assert.equal(response.headers.get("cache-control"),"private, no-store");
      assert.equal(response.headers.get("access-control-allow-origin"),null);
      assert.equal(response.headers.get("www-authenticate"),null);
    }
  } finally { setCloudflareBindings(null); }
});
