import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import Database from "better-sqlite3";

import type { ProspectDb } from "@/lib/revenue-engine/engine-prospects-d1";

import { getCallBrief, type BriefInput } from "./call-brief";
import { AiError } from "./gemini";

function database() {
  const raw = new Database(":memory:");
  for (const file of ["0075_engine_prospects_and_call_log.sql", "0077_ai_call_briefs.sql", "0079_connected_caller.sql"]) raw.exec(readFileSync(`migrations/${file}`, "utf8"));
  raw.prepare(`INSERT INTO "EngineProspect" VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run("a.example", "p1", "Acme Roofing", "KITCHENER", "ROOFING", "https://a.example/", "519-555-0101", null, "STRONG", '["No phone layout"]', "run1", "2026-09-24", "2026-09-24");
  const db: ProspectDb = { prepare(sql) { const s = raw.prepare(sql); return { bind: (...v: unknown[]) => ({
    all: async <T,>() => ({ results: s.all(...v) as T[] }), first: async <T,>() => (s.get(...v) as T | undefined) ?? null, run: async () => s.run(...v),
  }) }; } };
  return { raw, db };
}

const INPUT: BriefInput = { prospectId: "a.example", name: "Acme Roofing", city: "KITCHENER", niche: "ROOFING", label: "STRONG", websiteUrl: "https://a.example/", reasons: ["No phone layout: a phone shows the shrunken desktop page."], history: [] };
const GOOD = { opener: "Hi, this is Riley from Axiom Web in Kitchener. I was on your site from my phone and it shows the full desktop page shrunk down. Who looks after it for you?", talkingPoints: ["Your homepage shows the desktop layout on phones."], objections: [{ objection: "We get enough work", reply: "Makes sense. The mock-up is free, so you can decide later." }], nextStep: "Book a 15-minute look at a free mock-up." };

function fakeGemini(reply: unknown, calls: { n: number }, usage = { promptTokenCount: 900, candidatesTokenCount: 300 }): typeof fetch {
  return (async (_url: string, init: RequestInit) => {
    calls.n += 1;
    assert.equal((init.headers as Record<string, string>)["x-goog-api-key"], "test-key");
    const body = JSON.parse(String(init.body)) as { contents: { parts: { text: string }[] }[] };
    assert.match(body.contents[0]!.parts[0]!.text, /No phone layout/);
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: typeof reply === "string" ? reply : JSON.stringify(reply) }] } }], usageMetadata: usage }), { status: 200 });
  }) as unknown as typeof fetch;
}

test("a brief is generated once, cached, and its real cost recorded", async () => {
  const { raw, db } = database();
  const calls = { n: 0 };
  const first = await getCallBrief(db, INPUT, { apiKey: "test-key", caller: "AIDAN", fetchImpl: fakeGemini(GOOD, calls) });
  assert.equal(first.cached, false);
  const second = await getCallBrief(db, INPUT, { apiKey: "test-key", caller: "AIDAN", fetchImpl: fakeGemini(GOOD, calls) });
  assert.equal(second.cached, true);
  assert.equal(calls.n, 1, "cached briefs never call the model again");
  const usage = raw.prepare(`SELECT "status","costMicroUsd" FROM "AiUsage"`).all() as { status: string; costMicroUsd: number }[];
  assert.deepEqual(usage, [{ status: "SETTLED", costMicroUsd: 675 }], "900 in + 300 out = US$0.000675");
});

test("no key means no call; the monthly budget is a hard stop", async () => {
  const { raw, db } = database();
  await assert.rejects(() => getCallBrief(db, INPUT, { apiKey: undefined, caller: "RILEY" }), (e: unknown) => e instanceof AiError && e.code === "NOT_CONFIGURED");
  raw.prepare(`INSERT INTO "AiUsage" ("usageId","month","feature","model","promptVersion","status","costMicroUsd","actor") VALUES ('old',?, 'CALL_BRIEF','m','v','SETTLED',99999,'RILEY')`).run(new Date().toISOString().slice(0, 7));
  for (let i = 0; i < 49; i += 1) raw.prepare(`INSERT INTO "AiUsage" ("usageId","month","feature","model","promptVersion","status","costMicroUsd","actor") VALUES (?,?, 'CALL_BRIEF','m','v','SETTLED',100000,'RILEY')`).run(`u${i}`, new Date().toISOString().slice(0, 7));
  const calls = { n: 0 };
  await assert.rejects(() => getCallBrief(db, INPUT, { apiKey: "test-key", caller: "RILEY", fetchImpl: fakeGemini(GOOD, calls) }), (e: unknown) => e instanceof AiError && e.code === "BUDGET");
  assert.equal(calls.n, 0, "an exhausted budget never reaches the provider");
  assert.throws(() => raw.prepare(`DELETE FROM "AiUsage"`).run(), /NO_DELETE/);
});

test("invalid JSON and unsupported claims are discarded but still costed", async () => {
  const { raw, db } = database();
  const calls = { n: 0 };
  await assert.rejects(() => getCallBrief(db, INPUT, { apiKey: "test-key", caller: "RILEY", fetchImpl: fakeGemini("not json", calls) }), (e: unknown) => e instanceof AiError && e.code === "INVALID_OUTPUT");
  await assert.rejects(() => getCallBrief(db, INPUT, { apiKey: "test-key", caller: "RILEY", fetchImpl: fakeGemini({ ...GOOD, talkingPoints: ["We guarantee 30% more calls."] }, calls) }), /claim we can't back up/);
  assert.equal((raw.prepare(`SELECT COUNT(*) n FROM "AiCallBrief"`).get() as { n: number }).n, 0);
  assert.equal((raw.prepare(`SELECT COUNT(*) n FROM "AiUsage" WHERE "status"='SETTLED'`).get() as { n: number }).n, 2);
});

test("a provider failure releases its reservation", async () => {
  const { raw, db } = database();
  const failing = (async () => new Response("{}", { status: 500 })) as unknown as typeof fetch;
  await assert.rejects(() => getCallBrief(db, INPUT, { apiKey: "test-key", caller: "RILEY", fetchImpl: failing }), (e: unknown) => e instanceof AiError && e.code === "PROVIDER");
  assert.deepEqual(raw.prepare(`SELECT "status","costMicroUsd" FROM "AiUsage"`).all(), [{ status: "FAILED", costMicroUsd: 0 }]);
});
