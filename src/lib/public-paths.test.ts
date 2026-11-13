import assert from "node:assert/strict";
import test from "node:test";

import { isPublicPath } from "./public-paths";

test("the app's screens and APIs need a signed-in founder", () => {
  for (const path of ["/dashboard", "/fcc", "/settings", "/api/fcc/control", "/api/user/profile"]) {
    assert.equal(isPublicPath(path), false, path);
  }
});

test("sign-in, the health probe and the iOS installer are reachable before sign-in", () => {
  for (const path of ["/sign-in", "/api/auth/get-session", "/api/health", "/install", "/api/ios-profile", "/offline"]) {
    assert.equal(isPublicPath(path), true, path);
  }
  assert.equal(isPublicPath("/installer"), false);
  assert.equal(isPublicPath("/api/health/extra"), false);
});

test("the retired call and website routes are no longer public", () => {
  for (const path of ["/api/mcp", "/api/agent/jobs/claim", "/api/internal/cron-tick", "/unsubscribe", "/api/unsubscribe"]) {
    assert.equal(isPublicPath(path), false, path);
  }
});
