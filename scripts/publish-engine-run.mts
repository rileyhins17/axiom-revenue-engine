// Publishes the newest local engine run into the live database's EngineProspect
// table (migration 0075), so the Call list on operations.getaxiom.ca shows it.
// Upserts by business; never touches the call/visit log. Skips non-targets and
// sites that could not be checked.
//
//   node --env-file=.env.release-write node_modules/tsx/dist/cli.mjs scripts/publish-engine-run.mts [--dry-run]
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { businessDisplayName } from "../src/lib/revenue-engine/engine-site-capture";

type Result = {
  placeId: string; city: string; niche: string; websiteUrl: string | null; name: string | null; siteName?: string | null;
  phone?: string | null; address?: string | null; email?: string | null; emailMethod?: string | null; emailSourceUrl?: string | null; label: string; reasons: string[];
};

const RUNS = path.join("data", "kw-evaluation", "engine-runs");
const latest = readdirSync(RUNS).filter((name) => /^run-[\w-]+\.json$/.test(name)).sort().at(-1);
if (!latest) throw new Error("No engine run to publish.");
const run = JSON.parse(readFileSync(path.join(RUNS, latest), "utf8")) as { startedAt: string; results: Result[] };
const runId = latest.replace(/\.json$/, "");
const literal = (value: string | null | undefined) => value == null ? "NULL" : `'${value.replaceAll("'", "''")}'`;
const key = (result: Result) => result.websiteUrl ? new URL(result.websiteUrl).hostname.toLowerCase().replace(/^www\./, "") : `place:${result.placeId}`;

const rows = new Map<string, string>();
const emails: string[] = [];
for (const result of run.results) {
  if (!["STRONG", "WEAK", "NO_WEBSITE"].includes(result.label)) continue;
  if (!["KITCHENER", "WATERLOO", "CAMBRIDGE"].includes(result.city) || !["ROOFING", "HVAC", "LANDSCAPING"].includes(result.niche)) continue;
  const name = (result.websiteUrl ? businessDisplayName(result.websiteUrl, result.name, result.siteName) : result.name)?.slice(0, 200);
  if (!name) continue;
  const id = key(result);
  if (rows.has(id)) continue;
  rows.set(id, `INSERT INTO "EngineProspect" ("prospectId","placeId","name","city","niche","websiteUrl","phone","address","label","reasons","runId","firstSeenAt","lastSeenAt") VALUES (${[
    id, result.placeId.startsWith("offline-") ? null : result.placeId, name, result.city, result.niche, result.websiteUrl,
    result.phone ?? null, result.address ?? null, result.label, JSON.stringify(result.reasons.slice(0, 5)).slice(0, 2000), runId, run.startedAt, run.startedAt,
  ].map(literal).join(",")}) ON CONFLICT("prospectId") DO UPDATE SET "placeId"=excluded."placeId","name"=excluded."name","websiteUrl"=excluded."websiteUrl","phone"=COALESCE(excluded."phone","EngineProspect"."phone"),"address"=COALESCE(excluded."address","EngineProspect"."address"),"label"=excluded."label","reasons"=excluded."reasons","runId"=excluded."runId","lastSeenAt"=excluded."lastSeenAt";`);
}

for (const result of run.results) {
  const id = key(result);
  if (!rows.has(id) || !result.email || !result.emailSourceUrl || !["MAILTO_LINK", "PAGE_TEXT"].includes(result.emailMethod ?? "")) continue;
  const email = result.email.trim().toLowerCase();
  if (!/^[^\s@']+@[^\s@']+\.[a-z]{2,24}$/.test(email) || email.length > 254) continue;
  emails.push(`INSERT INTO "EngineProspectEmail" ("prospectId","email","sourceUrl","method","capturedAt","runId") VALUES (${[id, email, result.emailSourceUrl.slice(0, 300), result.emailMethod!, run.startedAt, runId].map(literal).join(",")}) ON CONFLICT("prospectId") DO UPDATE SET "email"=excluded."email","sourceUrl"=excluded."sourceUrl","method"=excluded."method","capturedAt"=excluded."capturedAt","runId"=excluded."runId";`);
}
const counts = [...run.results].reduce<Record<string, number>>((acc, result) => { acc[result.label] = (acc[result.label] ?? 0) + 1; return acc; }, {});
console.log(JSON.stringify({ run: runId, publish: rows.size, emails: emails.length, byLabel: counts }));
if (process.argv.includes("--dry-run")) process.exit(0);

const dir = mkdtempSync(path.join(os.tmpdir(), "publish-"));
const file = path.join(dir, "prospects.sql");
writeFileSync(file, [...rows.values(), ...emails].join("\n") + "\n");
try {
  const result = spawnSync(process.execPath, [path.join("node_modules", "wrangler", "bin", "wrangler.js"), "d1", "execute", "axiom-ops-omniscient", "--remote", "--config", "wrangler.production.jsonc", "--file", file, "--yes"],
    { encoding: "utf8", env: process.env, maxBuffer: 64 * 1024 * 1024 });
  const ok = /Executed \d+ (?:queries|commands)|🚣|success/i.test(result.stdout) && !/\[ERROR\]/.test(result.stdout + result.stderr);
  console.log(ok ? `Published ${rows.size} prospects to live.` : `Publish FAILED: ${(result.stdout + result.stderr).match(/\[ERROR\][^\n]*/)?.[0] ?? "unknown"}`);
  if (!ok) process.exitCode = 1;
} finally {
  rmSync(dir, { recursive: true, force: true });
}
