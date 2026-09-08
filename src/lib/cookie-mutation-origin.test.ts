import assert from "node:assert/strict";
import { test } from "node:test";
import { setCloudflareBindings } from "./cloudflare";
import { cookieMutationOriginStatus } from "./cookie-mutation-origin";

test("cookie mutations require exact current configured origin and consistent metadata", () => {
  const base = "https://console.example.invalid";
  const bindings = { APP_BASE_URL: `${base}/`, AUTH_ALLOWED_ORIGINS: base };
  setCloudflareBindings(bindings);
  try {
    const check = (headers: HeadersInit, method = "POST", url = base) => cookieMutationOriginStatus(
      new Request(`${url}/api/vault/bulk`, { method, headers }));
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      assert.equal(check({ origin: base, "sec-fetch-site": "same-origin" }, method), null);
      assert.equal(check({ origin: base }, method), null);
      for (const origin of ["null", `${base}/`, `${base}/path`, `${base}, ${base}`, "https://sibling.example.invalid",
        "https://console.example.invalid.attacker.invalid", "https://user@console.example.invalid", "http://console.example.invalid"]) {
        assert.equal(check({ origin, "sec-fetch-site": "same-origin" }, method), 403, origin);
      }
      for (const site of ["same-site", "cross-site", "none", "", "same-origin, same-origin"]) {
        assert.equal(check({ origin: base, "sec-fetch-site": site }, method), 403);
      }
      assert.equal(check({ referer: `${base}/`, authorization: "Bearer synthetic", "sec-fetch-site": "same-origin" }, method), 403);
    }
    bindings.AUTH_ALLOWED_ORIGINS = `${base},https://alias.example.invalid`;
    assert.equal(check({ origin: "https://alias.example.invalid" }, "POST", "https://alias.example.invalid"), null);
    assert.equal(check({ origin: "https://alias.example.invalid" }), 403, "Even approved aliases cannot mutate cross-origin.");
    assert.equal(check({ origin: base, host: "foreign.example.invalid" }), 403);
    assert.equal(check({ origin: base, host: "foreign.example.invalid", "x-forwarded-host": "console.example.invalid" }), 403);
    assert.equal(check({ origin: base, host: "console.example.invalid" }, "POST", "http://localhost:3000"), null,
      "A proxy/internal URL does not replace the configured browser origin and actual Host.");
    bindings.AUTH_ALLOWED_ORIGINS = base;
    assert.equal(check({ origin: "https://alias.example.invalid" }, "POST", "https://alias.example.invalid"), 403);
    for (const value of ["*", `${base},`, `${base}/path`, "null", "https://*.example.invalid"]) {
      bindings.AUTH_ALLOWED_ORIGINS = value;
      assert.equal(check({ origin: base }), 503, value);
    }
    setCloudflareBindings({});
    assert.equal(check({ origin: base }), 503, "Incomplete bindings cannot inherit local configuration.");
    for (const method of ["GET", "HEAD", "OPTIONS"]) assert.equal(check({}, method), null);
  } finally { setCloudflareBindings(null); }
});
