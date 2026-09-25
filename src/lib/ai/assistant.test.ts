import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import Database from "better-sqlite3";

import type { ProspectDb } from "@/lib/revenue-engine/engine-prospects-d1";

import { askAssistant } from "./assistant";
import { ENGINE_TOOLS, runTool, UPDATE_FIX_TOOL } from "./engine-tools";
import { AiError } from "./gemini";

function database() {
  const raw = new Database(":memory:");
  for (const file of ["0075_engine_prospects_and_call_log.sql", "0076_engine_email_outreach.sql", "0077_ai_call_briefs.sql", "0079_connected_caller.sql"]) raw.exec(readFileSync(`migrations/${file}`, "utf8"));
  const insert = raw.prepare(`INSERT INTO "EngineProspect" VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  insert.run("a.example", "p1", "Acme Roofing", "KITCHENER", "ROOFING", "https://a.example/", "519-555-0101", "12 King St", "STRONG", '["No phone layout"]', "run1", "2026-09-24", "2026-09-24");
  insert.run("place:p2", "p2", "Green Lawns", "WATERLOO", "LANDSCAPING", null, "519-555-0102", null, "NO_WEBSITE", '["No website listed"]', "run1", "2026-09-24", "2026-09-24");
  raw.prepare(`INSERT INTO "EngineProspectActivity" ("activityId","idempotencyKey","prospectId","channel","outcome","note","followUpAt","actor","actorUserId") VALUES ('a1','k1','a.example','CALL','CALL_BACK','Owner Dave back Friday','2026-09-25','AIDAN','u')`).run();
  const db: ProspectDb = { prepare(sql) { const s = raw.prepare(sql); return { bind: (...v: unknown[]) => ({
    all: async <T,>() => ({ results: s.all(...v) as T[] }), first: async <T,>() => (s.get(...v) as T | undefined) ?? null, run: async () => s.run(...v),
  }) }; } };
  return { raw, db };
}
const NOW = new Date("2026-09-25T15:00:00Z");

test("tools answer from live data and never expose writes to leads", async () => {
  const { db } = database();
  const ctx = { db, actor: "RILEY" as const, source: "ASSISTANT" as const, now: NOW };
  const found = await runTool(ENGINE_TOOLS, "search_businesses", { text: "acme" }, ctx) as { total: number; businesses: { lastResult: string; lastBy: string }[] };
  assert.equal(found.total, 1);
  assert.equal(found.businesses[0]!.lastResult, "Call back later");
  const business = await runTool(ENGINE_TOOLS, "get_business", { name: "acme" }, ctx) as { history: { note: string }[] };
  assert.equal(business.history[0]!.note, "Owner Dave back Friday");
  const overview = await runTool(ENGINE_TOOLS, "get_overview", {}, ctx) as { lists: { followups: number } };
  assert.equal(overview.lists.followups, 1);
  assert.deepEqual(await runTool(ENGINE_TOOLS, "search_businesses", { text: "x", sql: "DROP" }, ctx), { error: "Invalid arguments." });
  assert.equal(ENGINE_TOOLS.some((tool) => /send|delete|update|queue|call_/.test(tool.name)), false);
});

test("fix requests can be filed from the app but only updated by developer sessions", async () => {
  const { raw, db } = database();
  const filed = await runTool(ENGINE_TOOLS, "report_problem", { summary: "Wrong label", details: "Acme's site looks fine" }, { db, actor: "AIDAN", source: "ASSISTANT" }) as { requestId: string };
  assert.deepEqual(await runTool([UPDATE_FIX_TOOL], "update_fix_request", { requestId: filed.requestId, status: "DONE" }, { db, actor: "RILEY", source: "ASSISTANT" }), { error: "Not allowed here." });
  await runTool([UPDATE_FIX_TOOL], "update_fix_request", { requestId: filed.requestId, status: "DONE", resolution: "abc123" }, { db, actor: "RILEY", source: "OWNER", allowFixUpdates: true });
  assert.deepEqual(raw.prepare(`SELECT "status","resolution","actor","source" FROM "AppFixRequest"`).get(), { status: "DONE", resolution: "abc123", actor: "AIDAN", source: "ASSISTANT" });
});

test("the assistant calls tools, answers, and records the cost of every round", async () => {
  const { raw, db } = database();
  const requests: { contents: { role: string; parts: Record<string, unknown>[] }[]; tools: unknown }[] = [];
  const fake = (async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    requests.push(body);
    const parts = requests.length === 1
      ? [{ functionCall: { name: "search_businesses", args: { list: "followups" } } }]
      : [{ text: "Call **Acme Roofing** at 519-555-0101. Dave said to call back Friday." }];
    return new Response(JSON.stringify({ candidates: [{ content: { parts } }], usageMetadata: { promptTokenCount: 3000, candidatesTokenCount: 100 } }), { status: 200 });
  }) as unknown as typeof fetch;
  const reply = await askAssistant(db, { messages: [{ role: "user", text: "Who should I call?" }] }, { apiKey: "k", actor: "AIDAN", now: NOW, fetchImpl: fake });
  assert.match(reply.text, /Acme Roofing/);
  assert.deepEqual(reply.toolsUsed, ["search_businesses"]);
  const toolResult = JSON.stringify(requests[1]!.contents.at(-1));
  assert.match(toolResult, /Acme Roofing/, "the tool result is sent back to the model");
  const usage = raw.prepare(`SELECT "feature","status","costMicroUsd" FROM "AiUsage"`).all();
  assert.deepEqual(usage, [{ feature: "ASSISTANT", status: "SETTLED", costMicroUsd: 900 }, { feature: "ASSISTANT", status: "SETTLED", costMicroUsd: 900 }]);
});

test("the assistant stops at the budget and without a key", async () => {
  const { raw, db } = database();
  await assert.rejects(() => askAssistant(db, { messages: [{ role: "user", text: "hi" }] }, { apiKey: undefined, actor: "RILEY" }), (e: unknown) => e instanceof AiError && e.code === "NOT_CONFIGURED");
  for (let i = 0; i < 50; i += 1) raw.prepare(`INSERT INTO "AiUsage" ("usageId","month","feature","model","promptVersion","status","costMicroUsd","actor") VALUES (?,?,'ASSISTANT','m','v','SETTLED',100000,'RILEY')`).run(`u${i}`, NOW.toISOString().slice(0, 7));
  let called = false;
  const fake = (async () => { called = true; return new Response("{}"); }) as unknown as typeof fetch;
  await assert.rejects(() => askAssistant(db, { messages: [{ role: "user", text: "hi" }] }, { apiKey: "k", actor: "RILEY", now: NOW, fetchImpl: fake }), (e: unknown) => e instanceof AiError && e.code === "BUDGET");
  assert.equal(called, false);
});
