import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  REBUILD_MONITOR_RELEASE_CHECKS,
  parseRebuildMonitorReleaseProof,
} from "@/lib/rebuild-monitor/contract";
import {
  REBUILD_MONITOR_BRANCH,
  git,
  requireCanonicalMonitorRepository,
} from "./rebuild-monitor-repository";

function npmCliPath() {
  const candidate = process.env.npm_execpath;
  if (!candidate || !path.isAbsolute(candidate) || path.basename(candidate).toLowerCase() !== "npm-cli.js") {
    throw new Error("Run the release proof through npm so its exact CLI can be invoked safely.");
  }
  return candidate;
}

function runCheck(root: string, check: string) {
  process.stdout.write(`\nRebuild release gate: ${check}\n`);
  execFileSync(process.execPath, [npmCliPath(), "run", check], {
    cwd: root,
    stdio: "inherit",
    windowsHide: true,
  });
}

function main() {
  const root = requireCanonicalMonitorRepository();
  if (git(root, ["status", "--porcelain"])) {
    throw new Error("Commit the bounded milestone before proving its exact release gate.");
  }
  const sha = git(root, ["rev-parse", "HEAD"]);
  const treeSha = git(root, ["rev-parse", "HEAD^{tree}"]);
  for (const check of REBUILD_MONITOR_RELEASE_CHECKS) runCheck(root, check);
  if (git(root, ["status", "--porcelain"])) {
    throw new Error("The release gate changed the tracked working copy; no proof was recorded.");
  }
  if (git(root, ["rev-parse", "HEAD"]) !== sha
    || git(root, ["rev-parse", "HEAD^{tree}"]) !== treeSha) {
    throw new Error("The commit changed while the release gate was running.");
  }
  const proof = parseRebuildMonitorReleaseProof({
    proofVersion: "axiom-rebuild-monitor-release-v2",
    sha,
    treeSha,
    branch: REBUILD_MONITOR_BRANCH,
    verifiedAt: new Date().toISOString(),
    checks: REBUILD_MONITOR_RELEASE_CHECKS,
  });
  const directory = path.join(root, "data", "rebuild-monitor");
  const destination = path.join(directory, `release-proof.${sha}.json`);
  const temporary = path.join(directory, `release-proof.${sha}.${process.pid}.tmp`);
  mkdirSync(directory, { recursive: true });
  if (existsSync(destination)) {
    const existing = parseRebuildMonitorReleaseProof(JSON.parse(
      readFileSync(destination, "utf8"),
    ) as unknown);
    if (existing.sha !== proof.sha || existing.treeSha !== proof.treeSha) {
      throw new Error("The existing release proof conflicts with the exact commit.");
    }
    process.stdout.write(`\nExisting exact release proof retained for ${sha.slice(0, 8)}. Push this exact commit before recording it as committed.\n`);
    return;
  }
  try {
    writeFileSync(temporary, `${JSON.stringify(proof, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    renameSync(temporary, destination);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
  process.stdout.write(`\nRelease proof recorded for ${sha.slice(0, 8)}. Push this exact commit before recording it as committed.\n`);
}

main();
