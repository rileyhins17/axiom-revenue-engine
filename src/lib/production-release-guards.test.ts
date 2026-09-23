import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

for (const [script, expected] of [
  ["scripts/production-deploy-guard.mjs", /legacy production Worker and D1 database/],
  ["scripts/production-migration-guard.mjs", /legacy production D1 database/],
] as const) {
  test(`${script} fails closed before contacting Cloudflare`, () => {
    const result = spawnSync(process.execPath, [path.join(repoRoot, script)], { encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.match(result.stderr, expected);
    assert.doesNotMatch(result.stderr, /wrangler|fetch|network/i);
  });
}

test("deploy and remote-migration aliases point only to local guards", async () => {
  const packageJson = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8"));
  assert.equal(packageJson.scripts.deploy, "node scripts/production-deploy-guard.mjs");
  assert.equal(packageJson.scripts["db:migrate:remote"], "node scripts/production-migration-guard.mjs");
});
