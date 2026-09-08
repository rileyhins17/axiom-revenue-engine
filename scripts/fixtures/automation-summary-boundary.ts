import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import * as jsxRuntime from "react/jsx-runtime";
import ts from "typescript";
import type { legacyClientMailFixture } from "./legacy-client-mail";

export type SummaryBoundary = "dashboard" | "automation" | "overview" | "status";
const paths: Record<SummaryBoundary, string> = {
  dashboard: "src/app/dashboard/page.tsx", automation: "src/app/automation/page.tsx",
  overview: "src/app/api/outreach/automation/overview/route.ts", status: "src/app/api/outreach/gmail/status/route.ts",
};
/** Actual entry points and summary/storage implementations. Only HTTP auth and
 * unrelated acquisition data are fake; page props are inspected before rendering.
 * The require allowlist prevents accidental new provider authority in this test. */
export function summaryBoundary(f: ReturnType<typeof legacyClientMailFixture>, kind: SummaryBoundary, owner = "owner") {
  const localRequire = createRequire(resolve("package.json"));
  const source = ts.transpileModule(readFileSync(paths[kind], "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const session = { user: { id: owner, role: owner === "member" ? "user" : "admin" }, session: { id: `${owner}-session` } };
  const exports: { default?: () => Promise<unknown>; GET?: (request: Request) => Promise<Response> } = {};
  runInNewContext(source, { exports, Response, Date, Intl, console: { log() {}, warn() {}, error() {} }, require(name: string) {
    if (name === "react/jsx-runtime") return jsxRuntime;
    if (name === "next/server") return { NextResponse: Response };
    if (name === "next/link") return { default: () => null };
    if (name === "lucide-react") return new Proxy({}, { get: () => () => null });
    if (name.startsWith("@/components/")) return new Proxy({}, { get: () => () => null });
    if (name === "@/lib/session") return {
      requireSession: async () => session,
      requireAdminSession: async () => { if (owner === "member") throw new Error("ADMIN_DENIED"); return session; },
      requireAdminApiSession: async () => owner === "member" ? { response: new Response(null, { status: 403 }) } : { session },
    };
    if (name === "@/lib/cloudflare") return { getDatabase: () => f.database };
    if (name === "@/lib/env") return { getServerEnv: () => ({ AUTONOMOUS_MAX_SENDS_PER_DAY: 0 }) };
    if (name === "@/lib/autonomous-intake") return { countAdequateLeadsToday: async () => 0, getAutonomousDailyLeadCap: () => 1 };
    if (name === "@/lib/scrape-jobs") return { listScrapeJobs: async () => [] };
    if (name === "@/lib/scrape-targets") return { listRecentScrapeTargets: async () => [], pickNextScrapeTarget: async () => null, countActiveScrapeTargets: async () => 0 };
    if (["prisma", "automation-policy", "automation-operator-view", "outreach-automation", "time", "ui/data-accuracy", "revenue-engine/owner-summary-scope"].some(path => name === `@/lib/${path}`)) {
      return localRequire(resolve("src", name.slice(2)));
    }
    assert.fail("Unexpected summary authority: " + name);
  } }, { timeout: 1000 });
  return () => kind === "overview" || kind === "status" ? exports.GET!(new Request("https://example.invalid/summary")) : exports.default!();
}
