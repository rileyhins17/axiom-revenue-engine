import { execFileSync } from "node:child_process";
import path from "node:path";

export const REBUILD_MONITOR_BRANCH = "RileyHinsperger/axiom-revenue-engine-rebuild";
export const REBUILD_MONITOR_ROOT = "C:\\Users\\riley\\Documents\\ChatGPT\\APE";

function normalized(value: string) {
  return path.resolve(value).replaceAll("/", "\\").toLocaleLowerCase("en-CA");
}

export function isCanonicalMonitorRoot(value: string) {
  return normalized(value) === normalized(REBUILD_MONITOR_ROOT);
}

export function git(root: string, args: string[]) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024,
    windowsHide: true,
  }).trim();
}

export function requireCanonicalMonitorRepository(rootValue = process.cwd()) {
  const root = path.resolve(rootValue);
  if (!isCanonicalMonitorRoot(root)) {
    throw new Error(`The rebuild monitor runs only from ${REBUILD_MONITOR_ROOT}.`);
  }
  const gitRoot = path.resolve(git(root, ["rev-parse", "--show-toplevel"]));
  if (normalized(gitRoot) !== normalized(REBUILD_MONITOR_ROOT)) {
    throw new Error("The rebuild monitor repository root does not match the canonical path.");
  }
  if (git(root, ["branch", "--show-current"]) !== REBUILD_MONITOR_BRANCH) {
    throw new Error(`The rebuild monitor requires branch ${REBUILD_MONITOR_BRANCH}.`);
  }
  return root;
}
