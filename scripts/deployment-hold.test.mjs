import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const scripts = JSON.parse(read("package.json")).scripts;

test("both supported deploy commands stop at the unconditional local guard", () => {
  for (const command of ["deploy", "deploy:production"]) {
    assert.equal(scripts[command], "node scripts/production-deploy-guard.mjs");
    for (const prefix of ["pre", "post"]) {
      assert.equal(scripts[`${prefix}${command}`], undefined, "no deployment lifecycle bypass");
    }
  }
});

test("deployment guard denies without reading credentials or accepting override arguments", () => {
  // Execute only the known guard file, never a possibly regressed npm alias.
  // No parent credentials or Node startup hooks are inherited by this process.
  for (const args of [[], ["--force", "--approved", "DEPLOY AXIOM REVENUE ENGINE"]]) {
    const result = spawnSync(process.execPath, [
      fileURLToPath(new URL("scripts/production-deploy-guard.mjs", root)), ...args,
    ], { cwd: root, env: {}, encoding: "utf8", timeout: 5_000, windowsHide: true });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /Deployment is on hold/);
    assert.doesNotMatch(result.stderr, /--force|--approved/);
  }
});

test("the production job is unconditionally disabled and does not request provider credentials", () => {
  const workflow = read(".github/workflows/deploy-production.yml");
  assert.match(workflow, /^  deploy:\r?\n(?:    #[^\n]*\r?\n)*    if: \$\{\{ false \}\}\s*$/m);
  assert.doesNotMatch(workflow, /secrets\./);
  assert.match(workflow, /run: npm run deploy:production/);
});

test("local Cloudflare bundle checks remain no-upload commands", () => {
  for (const command of ["cf:dry-run", "cf:engine:dry-run"]) {
    assert.match(scripts[command], /\bwrangler deploy\b/);
    assert.match(scripts[command], /--dry-run(?:\s|$)/);
    assert.doesNotMatch(scripts[command], /[;&|]/);
  }
});
