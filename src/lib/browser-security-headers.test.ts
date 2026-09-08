import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import config from "../../next.config";
import { browserSecurityHeaders } from "./browser-security-headers";

test("browser protection covers Next and bypassing static assets without changing route semantics", async () => {
  assert.deepEqual(await config.headers!(), [{ source: "/:path*", headers: browserSecurityHeaders }]);
  const lines = readFileSync(new URL("../../public/_headers", import.meta.url), "utf8")
    .split(/\r?\n/).filter(line => line.trim() && !line.startsWith("#"));
  assert.equal(lines.shift(), "/*");
  assert.deepEqual(lines, browserSecurityHeaders.map(({ key, value }) => `  ${key}: ${value}`));
  const headers = new Headers(Object.fromEntries(browserSecurityHeaders.map(({ key, value }) => [key, value])));
  assert.equal(headers.get("content-security-policy"), "frame-ancestors 'none'; object-src 'none'; base-uri 'self'");
  assert.match(headers.get("content-security-policy-report-only")!, /script-src 'self';/);
  assert.doesNotMatch(headers.get("content-security-policy-report-only")!, /unsafe-inline|unsafe-eval|report-uri|report-to/);
  for (const key of ["strict-transport-security", "cache-control", "content-type", "access-control-allow-origin"]) {
    assert.equal(headers.has(key), false, `${key} requires its own policy, not a global override`);
  }
});
