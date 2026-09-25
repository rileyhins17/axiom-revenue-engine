import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { parseCompiledEnvironment, sanitizeCloudflareBundle } from "./sanitize-cloudflare-bundle.mjs";

const fakeKey = "fake-openai-api-key-for-bundle-safety-test";

async function createBundle(extraContent = "export const safe = true;\n") {
  const root = await mkdtemp(path.join(tmpdir(), "axiom-bundle-safety-"));
  await mkdir(path.join(root, "cloudflare"), { recursive: true });
  await mkdir(path.join(root, "server"), { recursive: true });
  await writeFile(
    path.join(root, "cloudflare", "next-env.mjs"),
    [
      `export const production = ${JSON.stringify({ OPENAI_API_KEY: fakeKey, PUBLIC_LABEL: "Axiom" })};`,
      "export const development = {};",
      "export const test = {};",
      "",
    ].join("\n"),
  );
  await writeFile(path.join(root, "server", "handler.mjs"), extraContent);
  return root;
}

test("parseCompiledEnvironment requires all three OpenNext modes", () => {
  assert.throws(
    () => parseCompiledEnvironment("export const production = {};\n"),
    /missing development/,
  );
});

test("sanitizer removes compiled local env values and passes a clean bundle", async () => {
  const root = await createBundle();
  try {
    const result = await sanitizeCloudflareBundle(root);
    const sanitized = await readFile(path.join(root, "cloudflare", "next-env.mjs"), "utf8");

    assert.equal(result.sensitiveValuesRemoved, 1);
    assert.equal(sanitized.includes(fakeKey), false);
    assert.equal(sanitized, [
      "export const production = {};",
      "export const development = {};",
      "export const test = {};",
      "",
    ].join("\n"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("sanitizer blocks a secret copied elsewhere in the bundle", async () => {
  const root = await createBundle(`export const leaked = ${JSON.stringify(fakeKey)};\n`);
  try {
    await assert.rejects(() => sanitizeCloudflareBundle(root), /value from OPENAI_API_KEY/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("sanitizer blocks recognizable secret material without a source env value", async () => {
  const tokenShapedValue = ["sk", "proj", "x".repeat(24)].join("-");
  const root = await createBundle(`export const leaked = ${JSON.stringify(tokenShapedValue)};\n`);
  try {
    await assert.rejects(() => sanitizeCloudflareBundle(root), /OpenAI-style API key/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("sanitizer rejects ignored private data even when it contains no recognizable secret", async () => {
  for (const privatePath of [
    ["server-functions", "default", "data", "kw-evaluation", "fixture.sqlite"],
    ["server-functions", "default", "backups", "staging", "export.sql"],
    ["server-functions", "default", "output", "fixture.json"],
  ]) {
    const root = await createBundle();
    try {
      const file = path.join(root, ...privatePath);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, "synthetic fixture only");
      await assert.rejects(
        () => sanitizeCloudflareBundle(root),
        /private workspace files/,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test("sanitizer allows a dependency's own output directory", async () => {
  const root = await createBundle();
  try {
    const dependencyFile = path.join(root, "server-functions", "default", "node_modules", "next", "dist", "build", "output", "log.js");
    await mkdir(path.dirname(dependencyFile), { recursive: true });
    await writeFile(dependencyFile, "export const log = () => {};\n");
    await sanitizeCloudflareBundle(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
