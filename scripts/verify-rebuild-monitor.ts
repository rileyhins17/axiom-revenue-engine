import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { parseRebuildMonitorState } from "@/lib/rebuild-monitor/contract";
import { requireCanonicalMonitorRepository } from "./rebuild-monitor-repository";

const root = requireCanonicalMonitorRepository(path.resolve(process.cwd()));

const assetRoot = path.join(root, "docs", "rebuild-monitor");
const seed = parseRebuildMonitorState(JSON.parse(
  readFileSync(path.join(assetRoot, "seed.json"), "utf8"),
) as unknown);
const localStatePath = path.join(root, "data", "rebuild-monitor", "state.json");
if (existsSync(localStatePath)) {
  parseRebuildMonitorState(JSON.parse(readFileSync(localStatePath, "utf8")) as unknown);
}

const html = readFileSync(path.join(assetRoot, "index.html"), "utf8");
const css = readFileSync(path.join(assetRoot, "styles.css"), "utf8");
const client = readFileSync(path.join(assetRoot, "app.js"), "utf8");
const server = readFileSync(path.join(root, "scripts", "serve-rebuild-monitor.ts"), "utf8");
const releaseProof = readFileSync(path.join(root, "scripts", "prove-rebuild-monitor-release.ts"), "utf8");
const repository = readFileSync(path.join(root, "scripts", "rebuild-monitor-repository.ts"), "utf8");
const updater = readFileSync(path.join(root, "scripts", "update-rebuild-monitor.ts"), "utf8");
for (const requiredId of [
  "milestone-heading",
  "state-badge",
  "verified-sha",
  "working-status",
  "stage-list",
  "blocker-heading",
  "timeline-list",
  "monitor-status",
]) {
  if (!html.includes(`id="${requiredId}"`)) throw new Error(`Missing monitor surface: ${requiredId}`);
}
if (/https?:\/\//i.test(`${html}\n${css}\n${client}`)) {
  throw new Error("The monitor UI must not load any external asset or service.");
}
if (/\.innerHTML\s*=|insertAdjacentHTML/i.test(client)) {
  throw new Error("Persisted monitor copy must render only through safe text nodes.");
}
if (!/<ol id="next-list"/.test(html) || /content:\s*counter\(/.test(css)) {
  throw new Error("The next-step list must use one native ordered-list announcement without a duplicate CSS counter.");
}
if (!/\.panel\s*\{[\s\S]*?min-width:\s*0/.test(css)
  || !/\.lower-grid\s*\{\s*grid-template-columns:\s*minmax\(0,\s*1fr\)/.test(css)) {
  throw new Error("The narrow owner layout must prevent intrinsic grid overflow.");
}
if (!server.includes('const HOST = "127.0.0.1"') || /process\.env/.test(server)) {
  throw new Error("The monitor server must stay fixed to loopback without environment secrets.");
}
if (!releaseProof.includes("process.env.npm_execpath")
  || !releaseProof.includes("execFileSync(process.execPath")
  || /npmExecutable|["']npm\.cmd["']/.test(releaseProof)) {
  throw new Error("The release proof must launch npm through its exact CLI path on every operating system.");
}
if (!repository.includes('REBUILD_MONITOR_ROOT = "C:\\\\Users\\\\riley\\\\Documents\\\\ChatGPT\\\\APE"')
  || !repository.includes("if (!isCanonicalMonitorRoot(root))")) {
  throw new Error("Every monitor command must require the exact canonical non-synced checkout.");
}
if (!server.includes("safeRebuildMonitorCommitTitle")
  || !updater.includes("safeRebuildMonitorCommitTitle")) {
  throw new Error("Every displayed Git subject must pass the visible-copy privacy screen.");
}
if (!updater.includes('"ls-remote", "--heads", "origin"')
  || !updater.includes("`release-proof.${sha}.json`")
  || !releaseProof.includes("REBUILD_MONITOR_RELEASE_CHECKS")) {
  throw new Error("Committed monitor state must require an exact release proof and pushed GitHub SHA.");
}
if (!client.includes("matchesLastVerifiedCheckpoint")
  || !client.includes("Clean, not verified")
  || !client.includes("Live rebuild state unavailable")) {
  throw new Error("The owner view must distinguish unverified HEAD and invalidate failed reads.");
}
if (seed.safety.spendImpactCad !== 0 || seed.safety.outboundSending !== "OFF") {
  throw new Error("The seed monitor must preserve zero-spend and no-send safety facts.");
}
process.stdout.write("Rebuild monitor verified: local-only, schema-valid, and free of external assets.\n");
