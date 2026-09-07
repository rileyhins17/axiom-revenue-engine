import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  parseRebuildMonitorState,
  safeRebuildMonitorCommitTitle,
} from "@/lib/rebuild-monitor/contract";
import {
  REBUILD_MONITOR_BRANCH,
  git,
  requireCanonicalMonitorRepository,
} from "./rebuild-monitor-repository";

const HOST = "127.0.0.1";
const DEFAULT_PORT = 4317;
function requestedPort() {
  const args = process.argv.slice(2);
  if (args.length === 0) return DEFAULT_PORT;
  if (args.length !== 2 || args[0] !== "--port") {
    throw new Error("Usage: npm run rebuild-monitor -- --port 4317");
  }
  const port = Number(args[1]);
  if (!Number.isInteger(port) || port < 1024 || port > 65_535) {
    throw new Error("The local monitor port must be an integer from 1024 to 65535.");
  }
  return port;
}

function readState(root: string) {
  const localPath = path.join(root, "data", "rebuild-monitor", "state.json");
  const seedPath = path.join(root, "docs", "rebuild-monitor", "seed.json");
  let content: string;
  try {
    content = readFileSync(localPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    content = readFileSync(seedPath, "utf8");
  }
  return parseRebuildMonitorState(JSON.parse(content) as unknown);
}

function workingCopy(root: string, verifiedSha: string) {
  const status = git(root, ["status", "--porcelain"]);
  const changedCount = status ? status.split(/\r?\n/).filter(Boolean).length : 0;
  const sha = git(root, ["rev-parse", "HEAD"]);
  return {
    branch: REBUILD_MONITOR_BRANCH,
    headSha: sha,
    shortHeadSha: sha.slice(0, 8),
    headTitle: safeRebuildMonitorCommitTitle(git(root, ["log", "-1", "--format=%s"])),
    status: changedCount === 0 ? "CLEAN" : "UNCOMMITTED_CHANGES",
    changedCount,
    matchesLastVerifiedCheckpoint: sha === verifiedSha,
  } as const;
}

function securityHeaders(contentType: string) {
  return {
    "Cache-Control": "no-store, max-age=0",
    "Content-Type": contentType,
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "SAMEORIGIN",
    "Content-Security-Policy": [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self'",
      "connect-src 'self'",
      "img-src 'self' data:",
      "font-src 'none'",
      "object-src 'none'",
      "base-uri 'none'",
      "frame-ancestors 'self'",
      "form-action 'none'",
    ].join("; "),
  };
}

const root = requireCanonicalMonitorRepository();
const port = requestedPort();
const assetRoot = path.join(root, "docs", "rebuild-monitor");
const assets = new Map([
  ["/", { file: "index.html", type: "text/html; charset=utf-8" }],
  ["/index.html", { file: "index.html", type: "text/html; charset=utf-8" }],
  ["/app.js", { file: "app.js", type: "text/javascript; charset=utf-8" }],
  ["/styles.css", { file: "styles.css", type: "text/css; charset=utf-8" }],
]);

const server = createServer((request, response) => {
  try {
    const url = new URL(request.url ?? "/", `http://${HOST}:${port}`);
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, securityHeaders("text/plain; charset=utf-8"));
      response.end("Method not allowed");
      return;
    }
    if (url.pathname === "/health") {
      response.writeHead(200, securityHeaders("application/json; charset=utf-8"));
      response.end(request.method === "HEAD" ? undefined : JSON.stringify({ status: "LOCAL_ONLY" }));
      return;
    }
    if (url.pathname === "/api/state") {
      const monitor = readState(root);
      const body = JSON.stringify({
        monitor,
        workingCopy: workingCopy(root, monitor.lastVerifiedCheckpoint.sha),
        servedAt: new Date().toISOString(),
      });
      response.writeHead(200, securityHeaders("application/json; charset=utf-8"));
      response.end(request.method === "HEAD" ? undefined : body);
      return;
    }
    const asset = assets.get(url.pathname);
    if (!asset) {
      response.writeHead(404, securityHeaders("text/plain; charset=utf-8"));
      response.end("Not found");
      return;
    }
    const body = readFileSync(path.join(assetRoot, asset.file));
    response.writeHead(200, securityHeaders(asset.type));
    response.end(request.method === "HEAD" ? undefined : body);
  } catch {
    response.writeHead(500, securityHeaders("application/json; charset=utf-8"));
    response.end(JSON.stringify({ status: "MONITOR_READ_FAILED" }));
  }
});

server.listen(port, HOST, () => {
  process.stdout.write(`Axiom rebuild monitor: http://${HOST}:${port}\n`);
  process.stdout.write("Local-only. Keep this terminal running while the monitor is open.\n");
});
