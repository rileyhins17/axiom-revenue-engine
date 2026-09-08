import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  REBUILD_MONITOR_STATES,
  parseRebuildMonitorReleaseProof,
  parseRebuildMonitorState,
  safeRebuildMonitorCommitTitle,
} from "@/lib/rebuild-monitor/contract";
import {
  applyRebuildMonitorUpdate,
  type RebuildMonitorCheckpoint,
} from "@/lib/rebuild-monitor/update";
import {
  REBUILD_MONITOR_BRANCH,
  git,
  requireCanonicalMonitorRepository,
} from "./rebuild-monitor-repository";
const VALUE_ARGUMENTS = new Set([
  "--state",
  "--message",
  "--milestone",
  "--completed",
  "--current",
  "--next",
  "--blocker",
  "--owner-action",
]);

function parseArgs(args: string[]) {
  const values = new Map<string, string[]>();
  const flags = new Set<string>();
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    if (!key?.startsWith("--")) throw new Error(`Unexpected argument: ${key ?? ""}`);
    if (key === "--checkpoint") {
      flags.add(key);
      continue;
    }
    if (!VALUE_ARGUMENTS.has(key)) throw new Error(`Unknown rebuild monitor option: ${key}.`);
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${key} requires a value.`);
    values.set(key, [...(values.get(key) ?? []), value]);
    index += 1;
  }
  const one = (key: string, required = false) => {
    const items = values.get(key) ?? [];
    if (items.length > 1) throw new Error(`${key} may be supplied only once.`);
    if (required && items.length !== 1) throw new Error(`${key} is required.`);
    return items[0];
  };
  return { values, flags, one };
}

function verifiedCheckpoint(root: string): {
  checkpoint: RebuildMonitorCheckpoint;
  releaseProof: ReturnType<typeof parseRebuildMonitorReleaseProof>;
} {
  if (git(root, ["status", "--porcelain"])) {
    throw new Error("A verified checkpoint can be recorded only from a clean working copy.");
  }
  const sha = git(root, ["rev-parse", "HEAD"]);
  const treeSha = git(root, ["rev-parse", "HEAD^{tree}"]);
  const proof = parseRebuildMonitorReleaseProof(JSON.parse(readFileSync(
    path.join(root, "data", "rebuild-monitor", `release-proof.${sha}.json`),
    "utf8",
  )) as unknown);
  if (proof.sha !== sha || proof.treeSha !== treeSha || proof.branch !== REBUILD_MONITOR_BRANCH) {
    throw new Error("The local release proof does not match the exact current commit and tree.");
  }
  const upstreamSha = git(root, ["rev-parse", "@{upstream}"]);
  const remoteLine = git(root, ["ls-remote", "--heads", "origin", REBUILD_MONITOR_BRANCH]);
  const remoteSha = remoteLine.split(/\s+/)[0] ?? "";
  if (upstreamSha !== sha || remoteSha !== sha) {
    throw new Error("Push the exact release-proven commit before recording it as committed.");
  }
  return {
    checkpoint: {
      sha,
      shortSha: sha.slice(0, 8),
      title: safeRebuildMonitorCommitTitle(git(root, ["log", "-1", "--format=%s"])),
      branch: REBUILD_MONITOR_BRANCH,
      verifiedAt: proof.verifiedAt,
    },
    releaseProof: proof,
  };
}

function main() {
  const root = requireCanonicalMonitorRepository();
  const parsed = parseArgs(process.argv.slice(2));
  const state = parsed.one("--state", true);
  const message = parsed.one("--message", true);
  if (!REBUILD_MONITOR_STATES.includes(state as (typeof REBUILD_MONITOR_STATES)[number])) {
    throw new Error(`--state must be one of: ${REBUILD_MONITOR_STATES.join(", ")}.`);
  }
  const now = new Date().toISOString();
  const localDirectory = path.join(root, "data", "rebuild-monitor");
  const localPath = path.join(localDirectory, "state.json");
  const seedPath = path.join(root, "docs", "rebuild-monitor", "seed.json");
  let currentValue: unknown;
  try {
    currentValue = JSON.parse(readFileSync(localPath, "utf8")) as unknown;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    currentValue = JSON.parse(readFileSync(seedPath, "utf8")) as unknown;
  }
  const blockerSummary = parsed.one("--blocker");
  const ownerAction = parsed.one("--owner-action");
  const milestone = parsed.one("--milestone");
  if ((blockerSummary && !ownerAction) || (!blockerSummary && ownerAction)) {
    throw new Error("--blocker and --owner-action must be supplied together.");
  }
  if (state !== "blocked" && (blockerSummary || ownerAction)) {
    throw new Error("Blocker details are valid only when --state is blocked.");
  }
  const verified = parsed.flags.has("--checkpoint") ? verifiedCheckpoint(root) : undefined;
  const next = applyRebuildMonitorUpdate(currentValue, {
    now,
    state: state as (typeof REBUILD_MONITOR_STATES)[number],
    message: message as string,
    ...(milestone ? { milestone } : {}),
    ...(parsed.values.has("--completed")
      ? { completed: parsed.values.get("--completed") }
      : {}),
    ...(parsed.values.has("--current")
      ? { currentWork: parsed.values.get("--current") }
      : {}),
    ...(parsed.values.has("--next") ? { nextWork: parsed.values.get("--next") } : {}),
    ...(blockerSummary && ownerAction
      ? { blocker: { summary: blockerSummary, ownerAction } }
      : {}),
    ...(verified ? verified : {}),
  });
  mkdirSync(localDirectory, { recursive: true });
  const temporaryPath = path.join(localDirectory, `state.${process.pid}.tmp`);
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(parseRebuildMonitorState(next), null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    renameSync(temporaryPath, localPath);
  } catch (error) {
    rmSync(temporaryPath, { force: true });
    throw error;
  }
  process.stdout.write(`Rebuild monitor updated: ${next.state} at ${next.updatedAt}\n`);
}

main();
