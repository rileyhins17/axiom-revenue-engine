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

test("only the six inert legacy agent route shapes bypass cookie middleware", () => {
  assert.equal(isPublicPath("/api/agent/jobs/claim"), true);
  for (const action of ["complete", "failed", "heartbeat", "logs", "results"]) {
    assert.equal(isPublicPath(`/api/agent/jobs/fixture-job/${action}`), true);
    assert.equal(isPublicPath(`/api/agent/jobs/fixture-job/${action}/extra`), false);
  }
  for (const path of ["/api/agent", "/api/agent-lookalike", "/api/agent/admin", "/api/agent/jobs/claim/extra", "/api/agent/jobs/id/new-action", "/api/agent/jobs//results"]) {
    assert.equal(isPublicPath(path), false, path);
  }
});

test("the iOS installer and profile are reachable before sign-in", () => {
  assert.equal(isPublicPath("/install"), true);
  assert.equal(isPublicPath("/installer"), false);
  assert.equal(isPublicPath("/api/ios-profile"), true);
});
