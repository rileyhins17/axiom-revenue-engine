import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { lstat, open, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { buildPrivateKwM2OwnerApprovalCandidate } from "../src/lib/revenue-engine/private-kw-m2-authorization";
import { createPrivateKwM2AssessmentFixture, createPrivateKwM2AssessmentFixtureTransport } from "../src/lib/revenue-engine/test-support/private-kw-m2-assessment-fixture";
import { writePrivateKwJson } from "./private-kw-files";
import { capturePrivateKwM2Html, runCapturePrivateKwM2HtmlCli, PRIVATE_KW_M2_HTML_CAPTURE_LOCK_PATH } from "./capture-private-kw-m2-html";

const NOW = new Date("2026-09-21T15:00:00.000Z");
const ROOT = path.resolve(fileURLToPath(new URL("../", import.meta.url)));

async function withRequest(request: unknown, action: (path: string) => Promise<void>) {
  const file = `data/kw-evaluation/m2-cli-test-${randomUUID()}.json`;
  await writePrivateKwJson(file, request);
  try { await action(file); } finally {
    try { await unlink(new URL(`../${file}`, import.meta.url)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
}

test("preflight is read-only and reports a pending owner envelope", async () => {
  const fixture = await createPrivateKwM2AssessmentFixture({ now: NOW });
  const pending = buildPrivateKwM2OwnerApprovalCandidate({ ...fixture.chain });
  await withRequest({ ...fixture.request, ownerEnvelope: pending, requestId: randomUUID() }, async (file) => {
    const result = await capturePrivateKwM2Html([file], { clock: () => new Date(NOW) });
    assert.equal(result.status, "OWNER_APPROVAL_REQUIRED");
    assert.equal(result.currentRequestCount, 0);
  });
});

test("fake execute followed by verify performs no second transport request", async () => {
  const fixture = await createPrivateKwM2AssessmentFixture({ now: NOW });
  const request = { ...fixture.request, requestId: randomUUID() };
  const transport = createPrivateKwM2AssessmentFixtureTransport(NOW);
  await withRequest(request, async (file) => {
    const result = await capturePrivateKwM2Html([file, "--execute"], {
      clock: () => new Date(NOW),
      dependencies: { transport, receiptStore: fixture.receiptStore, store: fixture.evidenceStore },
    });
    assert.equal(result.status, "COMPLETE");
    assert.ok(result.operationId);
    const replayed = await capturePrivateKwM2Html([file, "--execute"], {
      clock: () => new Date(NOW),
      dependencies: { transport, receiptStore: fixture.receiptStore, store: fixture.evidenceStore },
    });
    assert.equal(replayed.status, "COMPLETE");
    assert.equal(replayed.currentRequestCount, 0);
    assert.equal(replayed.recordedNetworkRequestCount, result.recordedNetworkRequestCount);
    const verified = await capturePrivateKwM2Html([file, "--verify"], {
      clock: () => new Date(NOW), dependencies: { receiptStore: fixture.receiptStore, store: fixture.evidenceStore },
    });
    assert.equal(verified.status, "COMPLETE");
    assert.equal(verified.currentRequestCount, 0);
    assert.equal(verified.recordedNetworkRequestCount, result.recordedNetworkRequestCount);
  });
});

test("native execute survives a fresh deny-network verify process", async () => {
  const now = new Date();
  const fixture = await createPrivateKwM2AssessmentFixture({ now });
  const request = { ...fixture.request, requestId: randomUUID() };
  const transport = createPrivateKwM2AssessmentFixtureTransport(now);
  const preload = path.join(ROOT, "data", "kw-evaluation", `m2-cli-deny-network-${randomUUID()}.cjs`);
  const denyNetwork = `
const deny = () => { throw new Error("NETWORK_ACCESS_FORBIDDEN_IN_VERIFY"); };
const dns = require("node:dns"); dns.lookup = deny; dns.lookupService = deny; dns.promises.lookup = deny;
const net = require("node:net"); net.connect = deny; net.createConnection = deny; net.Socket.prototype.connect = deny;
const tls = require("node:tls"); tls.connect = deny;
const http = require("node:http"); http.request = deny; http.get = deny;
const https = require("node:https"); https.request = deny; https.get = deny;
global.fetch = deny;
require("node:module").syncBuiltinESMExports();
`;
  await writeFile(preload, denyNetwork, { flag: "wx" });
  try {
    await withRequest(request, async (file) => {
      const requestFile = path.resolve(ROOT, file);
      const before = await readFile(requestFile);
      const executed = await capturePrivateKwM2Html([file, "--execute"], {
        clock: () => new Date(now), dependencies: { transport },
      });
      assert.equal(executed.status, "COMPLETE");
      assert.ok(Number(executed.recordedNetworkRequestCount) > 0);
      const verifiedOutput = execFileSync(process.execPath, ["--require", preload, "--import", "tsx", "scripts/capture-private-kw-m2-html.ts", file, "--verify"], { cwd: ROOT, encoding: "utf8" });
      const verified = JSON.parse(verifiedOutput.trim()) as Record<string, unknown>;
      assert.equal(verified.status, executed.status);
      assert.equal(verified.operationId, executed.operationId);
      assert.equal(verified.currentRequestCount, 0);
      assert.equal(verified.recordedNetworkRequestCount, executed.recordedNetworkRequestCount);
      assert.deepEqual(await readFile(requestFile), before);
    });
  } finally {
    try { await unlink(preload); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
});

test("approved preflight is ready without transport, while pending execute stops before lock or transport", async () => {
  const fixture = await createPrivateKwM2AssessmentFixture({ now: NOW });
  let requests = 0;
  const transport = createPrivateKwM2AssessmentFixtureTransport(NOW);
  const countingTransport = { ...transport, request: async (...args: Parameters<typeof transport.request>) => { requests += 1; return transport.request(...args); } };
  await withRequest({ ...fixture.request, requestId: randomUUID() }, async (file) => {
    const ready = await capturePrivateKwM2Html([file], { clock: () => new Date(NOW), dependencies: { transport: countingTransport, receiptStore: fixture.receiptStore, store: fixture.evidenceStore } });
    assert.equal(ready.status, "READY_FOR_CAPTURE");
    assert.equal(ready.currentRequestCount, 0);
    assert.equal(requests, 0);
  });
  const pending = buildPrivateKwM2OwnerApprovalCandidate({ ...fixture.chain });
  await withRequest({ ...fixture.request, ownerEnvelope: pending, requestId: randomUUID() }, async (file) => {
    await assert.rejects(capturePrivateKwM2Html([file, "--execute"], { clock: () => new Date(NOW), dependencies: { transport: countingTransport, receiptStore: fixture.receiptStore, store: fixture.evidenceStore } }), /APPROVED/);
    assert.equal(requests, 0);
    await assert.rejects(lstat(PRIVATE_KW_M2_HTML_CAPTURE_LOCK_PATH), { code: "ENOENT" });
  });
});

test("future, expired, forged, mismatched, and non-NEW requests stop before transport", async () => {
  const fixture = await createPrivateKwM2AssessmentFixture({ now: NOW });
  let requests = 0;
  const transport = createPrivateKwM2AssessmentFixtureTransport(NOW);
  const countingTransport = { ...transport, request: async (...args: Parameters<typeof transport.request>) => { requests += 1; return transport.request(...args); } };
  const cases: Array<[string, unknown, Date, RegExp]> = [
    ["future request", { ...fixture.request, requestId: randomUUID(), requestedAt: "2026-09-21T15:01:00.000Z" }, NOW, /not in the future/],
    ["expired approval", { ...fixture.request, requestId: randomUUID() }, new Date("2026-10-01T15:00:00.000Z"), /expired|review window/],
    ["forged business", { ...fixture.request, requestId: randomUUID(), businessId: "business:forged" }, NOW, /outside|identity|mismatch|approved website/],
    ["mismatched manifest", { ...fixture.request, requestId: randomUUID(), manifest: { ...fixture.request.manifest as object, manifestDigest: "0".repeat(64) } }, NOW, /digest|match|identity/],
    ["non-NEW execute", { ...fixture.request, requestId: randomUUID(), replayMode: "EXACT_REPLAY" }, NOW, /NEW/],
  ];
  for (const [name, request, clock, expected] of cases) {
    await withRequest(request, async (file) => {
      await assert.rejects(capturePrivateKwM2Html([file, "--execute"], { clock: () => new Date(clock), dependencies: { transport: countingTransport, receiptStore: fixture.receiptStore, store: fixture.evidenceStore } }), expected, name);
      await assert.rejects(lstat(PRIVATE_KW_M2_HTML_CAPTURE_LOCK_PATH), { code: "ENOENT" });
    });
  }
  assert.equal(requests, 0);
});

test("CLI runner returns exit 1 and prints FAILED for a failed execute result", async () => {
  const fixture = await createPrivateKwM2AssessmentFixture({ now: NOW, outcome: "HOMEPAGE_FAILED" });
  const request = { ...fixture.request, requestId: randomUUID() };
  const file = `data/kw-evaluation/m2-cli-failed-${randomUUID()}.json`;
  await writePrivateKwJson(file, request);
  let stdout = "";
  let stderr = "";
  try {
    const exitCode = await runCapturePrivateKwM2HtmlCli([file, "--execute"], {
      clock: () => new Date(NOW),
      dependencies: { transport: createPrivateKwM2AssessmentFixtureTransport(NOW, "HOMEPAGE_FAILED"), receiptStore: fixture.receiptStore, store: fixture.evidenceStore },
    }, { stdout: (value) => { stdout += value; }, stderr: (value) => { stderr += value; } });
    assert.equal(exitCode, 1, `stdout=${stdout} stderr=${stderr}`);
    assert.match(stdout, /"status":"FAILED"/);
    assert.equal(stderr, "");
  } finally {
    try { await unlink(new URL(`../${file}`, import.meta.url)); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
});

test("an unsealed failed capture cannot be treated as a successful verify", async () => {
  const fixture = await createPrivateKwM2AssessmentFixture({ now: NOW, outcome: "HOMEPAGE_FAILED" });
  await withRequest(fixture.request, async (file) => {
    await assert.rejects(capturePrivateKwM2Html([file, "--verify"], { clock: () => new Date(NOW), dependencies: { receiptStore: fixture.receiptStore, store: fixture.evidenceStore } }), /REPLAY_MISSING/);
  });
});

test("argument errors and a foreign lock fail closed", async () => {
  await assert.rejects(capturePrivateKwM2Html([], { clock: () => new Date(NOW) }), /Usage/);
  await assert.rejects(capturePrivateKwM2Html(["data/kw-evaluation/x.json", "--execute", "--verify"], { clock: () => new Date(NOW) }), /Usage/);
  await withRequest({ owner: process.pid }, async (file) => {
    await assert.rejects(capturePrivateKwM2Html([file, "--execute"], { clock: () => new Date(NOW) }), /invalid|expected|request/i);
  });
  let foreign;
  try { foreign = await open(PRIVATE_KW_M2_HTML_CAPTURE_LOCK_PATH, "wx", 0o600); }
  catch (error) { throw new Error(`Test lock already exists; refusing to touch it: ${String(error)}`); }
  const foreignIdentity = await foreign.stat({ bigint: true });
  await foreign.writeFile("foreign\n", "utf8");
  try {
    const fixture = await createPrivateKwM2AssessmentFixture({ now: NOW });
    await withRequest({ ...fixture.request, requestId: randomUUID() }, async (file) => {
      await assert.rejects(capturePrivateKwM2Html([file, "--execute"], { clock: () => new Date(NOW), dependencies: { receiptStore: fixture.receiptStore, store: fixture.evidenceStore, transport: createPrivateKwM2AssessmentFixtureTransport(NOW) } }), /already running/);
    });
  } finally {
    await foreign.close();
    try {
      const current = await lstat(PRIVATE_KW_M2_HTML_CAPTURE_LOCK_PATH, { bigint: true });
      if (current.isFile() && !current.isSymbolicLink() && current.dev === foreignIdentity.dev && current.ino === foreignIdentity.ino) await unlink(PRIVATE_KW_M2_HTML_CAPTURE_LOCK_PATH);
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
});
