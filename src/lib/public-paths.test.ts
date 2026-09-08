import assert from "node:assert/strict";
import test from "node:test";

import { isPublicPath } from "./public-paths";

test("retired control paths reach only their exact fixed retirement responses", () => {
  assert.equal(isPublicPath("/api/mcp"), true);
  assert.equal(isPublicPath("/api/mcp/extra"), false);
  assert.equal(isPublicPath("/api/mcp-lookalike"), false);
  assert.equal(isPublicPath("/api/internal/cron-tick"), true);
  assert.equal(isPublicPath("/api/internal/cron-tick/extra"), false);
  assert.equal(isPublicPath("/api/internal/other"), false);
});

test("ordinary application APIs remain session protected", () => {
  assert.equal(isPublicPath("/api/vault/leads"), false);
  assert.equal(isPublicPath("/api/v1/leads"), false);
  assert.equal(isPublicPath("/api/outreach/automation/overview"), false);
});

test("the iOS installer and profile are reachable before sign-in", () => {
  assert.equal(isPublicPath("/install"), true);
  assert.equal(isPublicPath("/installer"), false);
  assert.equal(isPublicPath("/api/ios-profile"), true);
});
