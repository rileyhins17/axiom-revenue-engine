import { execFileSync } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  verifyStagingConsoleReleaseAgainstGit,
  type StagingConsoleGitReader,
} from "../src/lib/revenue-engine/staging-console-release";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(SCRIPT_DIR, "..");
const RELEASE_PACKET_ROOT = resolve(REPOSITORY_ROOT, "docs", "releases", "staging");
const MAX_PACKET_BYTES = 1_000_000;

function git(args: string[]) {
  return execFileSync("git", args, {
    cwd: REPOSITORY_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    windowsHide: true,
  }).trim();
}

export function resolveStagingReleasePacketPath(input: string) {
  const packetPath = resolve(REPOSITORY_ROOT, input);
  const relativePath = relative(RELEASE_PACKET_ROOT, packetPath);
  if (isAbsolute(relativePath) || relativePath === ".." || relativePath.startsWith(`..${sep}`) || extname(packetPath).toLowerCase() !== ".json") {
    throw new Error("Release packet must be one JSON file under docs/releases/staging/.");
  }
  return packetPath;
}

export function createLocalStagingConsoleGitReader(): StagingConsoleGitReader {
  return {
    commitExists(sha) {
      try {
        return git(["cat-file", "-t", `${sha}^{commit}`]) === "commit";
      } catch {
        return false;
      }
    },
    treeSha(sha) {
      return git(["show", "-s", "--format=%T", sha]);
    },
    blobSha(sha, path) {
      const line = git(["ls-tree", sha, "--", path]);
      if (!line) return null;
      const match = /^100644 blob ([0-9a-f]{40})\t/.exec(line);
      return match?.[1] ?? null;
    },
    isAncestorOfHead(sha) {
      try {
        execFileSync("git", ["merge-base", "--is-ancestor", sha, "HEAD"], {
          cwd: REPOSITORY_ROOT,
          stdio: "ignore",
          windowsHide: true,
        });
        return true;
      } catch {
        return false;
      }
    },
  };
}

export async function verifyStagingConsoleReleaseFile(input: string) {
  const packetPath = resolveStagingReleasePacketPath(input);
  const repositoryPath = relative(REPOSITORY_ROOT, packetPath).split(sep).join("/");
  let trackedPath: string;
  try {
    trackedPath = git(["ls-files", "--error-unmatch", "--", repositoryPath]);
  } catch {
    throw new Error("Release packet must be committed or staged in this repository.");
  }
  if (trackedPath !== repositoryPath) throw new Error("Release packet Git identity is ambiguous.");
  const indexBlob = git(["rev-parse", `:${repositoryPath}`]);
  const worktreeBlob = git(["hash-object", "--", repositoryPath]);
  if (indexBlob !== worktreeBlob) throw new Error("Release packet working copy does not match its staged or committed Git blob.");
  const metadata = await stat(packetPath);
  if (!metadata.isFile() || metadata.size > MAX_PACKET_BYTES) throw new Error("Release packet is missing or exceeds the 1 MB limit.");
  const parsed = JSON.parse(await readFile(packetPath, "utf8")) as unknown;
  return verifyStagingConsoleReleaseAgainstGit(parsed, createLocalStagingConsoleGitReader());
}

async function run() {
  const input = process.argv[2];
  if (!input || process.argv.length !== 3) throw new Error("Usage: npm run staging:verify-console-release -- docs/releases/staging/<packet>.json");
  const packet = await verifyStagingConsoleReleaseFile(input);
  console.log(`Verified staging packet ${packet.packetId}.`);
  console.log(`Candidate: ${packet.candidate.releaseSha}`);
  console.log(`Target: ${packet.target.workerName}`);
  console.log("Deployment authorized: false");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((error) => {
    console.error(error instanceof Error ? error.message : "Staging release packet verification failed.");
    process.exitCode = 1;
  });
}
