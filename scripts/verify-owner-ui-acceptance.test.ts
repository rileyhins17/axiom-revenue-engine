import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  attachBrowserDiagnostics,
  cssTimeToMilliseconds,
  isAllowedOwnerAcceptanceUrl,
  writeBrowserDiagnostics,
} from "./verify-owner-ui-acceptance";

test("owner UI browser networking is restricted to the exact loopback origin", () => {
  const baseUrl = "http://127.0.0.1:8787";
  assert.equal(isAllowedOwnerAcceptanceUrl(`${baseUrl}/leads`, baseUrl), true);
  assert.equal(isAllowedOwnerAcceptanceUrl("data:text/plain,fixture", baseUrl), true);
  assert.equal(isAllowedOwnerAcceptanceUrl("http://127.0.0.1:8788/leads", baseUrl), false);
  assert.equal(isAllowedOwnerAcceptanceUrl("https://directory.axiomfixtures.ca/business/one", baseUrl), false);
  assert.equal(isAllowedOwnerAcceptanceUrl("https://api.openai.com/v1/responses", baseUrl), false);
});

test("reduced-motion duration parsing handles seconds and milliseconds", () => {
  assert.equal(cssTimeToMilliseconds("0.01ms"), 0.01);
  assert.equal(cssTimeToMilliseconds("0.2s"), 200);
  assert.equal(Number.isNaN(cssTimeToMilliseconds("initial")), true);
});

test("warmup diagnostics attach before its first navigation and persist on failure", async () => {
  const source = await readFile(new URL("./verify-owner-ui-acceptance.ts", import.meta.url), "utf8");
  const newPage = source.indexOf("warmupPage = await context.newPage()");
  const attachment = source.indexOf("attachBrowserDiagnostics(warmupPage", newPage);
  const firstNavigation = source.indexOf('await warmupPage.goto("/leads"', newPage);
  assert(newPage >= 0, "warmup page creation should remain explicit");
  assert(attachment > newPage, "warmup diagnostics should attach after page creation");
  assert(attachment < firstNavigation, "warmup diagnostics must attach before first navigation");
  for (const listener of ["console", "pageerror", "requestfailed", "response"]) {
    assert.match(source, new RegExp(`page\\.on\\(\\"${listener}\\"`));
  }
  for (const kind of ["console-error", "page-error", "request-failed", "http-error"]) {
    assert.match(source, new RegExp(kind));
  }
  assert.match(source, /owner-ui-browser-diagnostics\.json/);
  assert.match(source, /JSON\.stringify\(/);

  const directory = await mkdtemp(join(tmpdir(), "owner-ui-diagnostics-"));
  try {
    await writeBrowserDiagnostics(directory, [{
      capturedAt: "2026-09-21T12:00:00.000Z",
      stage: "owner route warmup",
      kind: "http-error",
      url: "http://127.0.0.1:8787/leads",
      message: "500 Internal Server Error",
      status: 500,
    }], "owner route warmup", "http://127.0.0.1:8787/leads");
    const artifact = JSON.parse(await readFile(join(directory, "owner-ui-browser-diagnostics.json"), "utf8"));
    assert.equal(artifact.failedStage, "owner route warmup");
    assert.equal(artifact.failedUrl, "http://127.0.0.1:8787/leads");
    assert.equal(artifact.diagnostics[0].kind, "http-error");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("browser diagnostics retain event-time stage and all supported event details", () => {
  const listeners = new Map<string, (event: unknown) => void>();
  let currentUrl = "http://127.0.0.1:8787/leads";
  const page = {
    on(event: string, listener: (event: unknown) => void) {
      listeners.set(event, listener);
      return page;
    },
    url() {
      return currentUrl;
    },
  } as never;
  const diagnostics: Parameters<typeof attachBrowserDiagnostics>[2] = [];
  let stage = "owner route warmup";
  attachBrowserDiagnostics(page, () => stage, diagnostics, "http://127.0.0.1:8787");

  listeners.get("console")?.({
    type: () => "error",
    text: () => "console boom",
    location: () => ({ url: currentUrl }),
  });
  stage = "desktop leads";
  listeners.get("pageerror")?.(Object.assign(new Error("page boom"), {
    name: "TypeError",
    stack: "TypeError: page boom\n    at fixture.ts:1:1",
  }));
  stage = "desktop dossier";
  currentUrl = "http://127.0.0.1:8787/leads/business:fixture";
  listeners.get("requestfailed")?.({
    url: () => currentUrl,
    failure: () => ({ errorText: "net::ERR_FAILED" }),
  });
  stage = "desktop quality lab";
  listeners.get("response")?.({
    url: () => currentUrl,
    status: () => 503,
  });
  listeners.get("response")?.({
    url: () => "http://127.0.0.78:8787/leads",
    status: () => 503,
  });

  assert.deepEqual(diagnostics.map(({ kind, stage: capturedStage, url, message, status }) => ({
    kind, stage: capturedStage, url, message, status,
  })), [
    { kind: "console-error", stage: "owner route warmup", url: "http://127.0.0.1:8787/leads", message: "console boom", status: undefined },
    { kind: "page-error", stage: "desktop leads", url: "http://127.0.0.1:8787/leads", message: "page boom", status: undefined },
    { kind: "request-failed", stage: "desktop dossier", url: "http://127.0.0.1:8787/leads/business:fixture", message: "net::ERR_FAILED", status: undefined },
    { kind: "http-error", stage: "desktop quality lab", url: "http://127.0.0.1:8787/leads/business:fixture", message: "HTTP 503", status: 503 },
  ]);
  assert.equal(diagnostics[1]?.name, "TypeError");
  assert.match(diagnostics[1]?.stack ?? "", /page boom/);
});
