import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { assertCloudflareBundleHasNoPrivateFiles } from "./assert-cloudflare-bundle-private-files.mjs";

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "axiom-private-bundle-"));
  await mkdir(path.join(root, "cloudflare"), { recursive: true });
  await writeFile(path.join(root, "cloudflare", "worker.mjs"), "export default {};");
  return root;
}

test("private bundle check accepts normal worker output", async () => {
  const root = await fixture();
  try {
    assert.equal((await assertCloudflareBundleHasNoPrivateFiles(root)).filesScanned, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("private bundle check rejects private workspace files", async () => {
  for (const relative of [
    ["server-functions", "default", "data", "private.sqlite"],
    ["server-functions", "default", "backups", "staging", "export.sql"],
    ["server-functions", "default", "output", "checkpoint.json"],
  ]) {
    const root = await fixture();
    try {
      const file = path.join(root, ...relative);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, "synthetic private fixture");
      await assert.rejects(assertCloudflareBundleHasNoPrivateFiles(root), /private workspace files/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test("private bundle check allows Next dependency output directories", async () => {
  const root = await fixture();
  try {
    const file = path.join(root, "server-functions", "default", "node_modules", "next", "dist", "build", "output", "log.js");
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, "export const log = () => {};");
    await assert.doesNotReject(assertCloudflareBundleHasNoPrivateFiles(root));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
