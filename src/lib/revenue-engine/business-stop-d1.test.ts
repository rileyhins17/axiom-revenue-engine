import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import Database from "better-sqlite3";

import type { D1DatabaseLike, D1PreparedStatementLike } from "@/lib/cloudflare";
import { createRevenueBusinessStopD1Boundary } from "@/lib/revenue-engine/business-stop-d1";

const kernel = readFileSync(new URL("../../../migrations/0054_revenue_shadow_kernel.sql", import.meta.url), "utf8");
const migration = readFileSync(new URL("../../../migrations/0072_revenue_business_stop.sql", import.meta.url), "utf8");

function fixture() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(kernel);
  db.exec(migration);
  db.prepare(`INSERT INTO "RevenueBusiness" ("id","canonicalName") VALUES (?,?)`).run("business-a", "Synthetic Roofing");
  db.prepare(`INSERT INTO "RevenueBusiness" ("id","canonicalName") VALUES (?,?)`).run("business-b", "Synthetic HVAC");
  const database: D1DatabaseLike = {
    prepare(query: string) {
      let values: unknown[] = [];
      const statement = {
        bind(...bindings: unknown[]) { values = bindings; return statement; },
        async run() {
          const result = db.prepare(query).run(...values as never[]);
          return { meta: { changes: Number(result.changes), last_row_id: result.lastInsertRowid } };
        },
        async first<T = Record<string, unknown>>(column?: string): Promise<T | null> {
          const result = db.prepare(query).get(...values as never[]) as Record<string, unknown> | undefined;
          return (column && result ? result[column] : result) as T | null;
        },
        async all<T = Record<string, unknown>>() { return { results: db.prepare(query).all(...values as never[]) as T[] }; },
      };
      return statement as unknown as D1PreparedStatementLike;
    },
  };
  return { db, stops: createRevenueBusinessStopD1Boundary(database) };
}

const input = {
  businessId: "business-a", idempotencyKey: "stop-001", reason: "OWNER_DECISION" as const, source: "OWNER_ACTION" as const,
  note: "Owner has decided to stop pursuing this business.", actorUserId: "user-riley",
};

test("creates an immutable manual stop and returns the exact authoritative readback", async () => {
  const { db, stops } = fixture();
  const created = await stops.createStop(input);
  assert.equal(created.status, "CREATED");
  assert.equal(created.stop.source, "OWNER_ACTION");
  assert.equal(created.stop.reason, input.reason);
  assert.equal(created.stop.createdAt, await stops.getStop("business-a").then((saved) => saved?.createdAt));
  assert.deepEqual(await stops.createStop(input), { stopId: created.stopId, stop: created.stop, status: "REPLAYED" });
  assert.deepEqual(await stops.listStopsForBusinessIds(["business-a", "business-b"]), new Map([["business-a", created.stop]]));
  assert.equal((db.prepare(`SELECT count(*) AS count FROM "RevenueBusinessStopEvent"`).get() as { count: number }).count, 1);
  assert.throws(() => db.prepare(`UPDATE "RevenueBusinessStopEvent" SET "note"='changed' WHERE "businessId"=?`).run("business-a"), /REVENUE_BUSINESS_STOP_APPEND_ONLY/);
  assert.throws(() => db.prepare(`DELETE FROM "RevenueBusinessStopEvent" WHERE "businessId"=?`).run("business-a"), /REVENUE_BUSINESS_STOP_APPEND_ONLY/);
});

test("rejects key reuse, a second business stop, cross-business identities, and unknown businesses", async () => {
  const { db, stops } = fixture();
  await stops.createStop(input);
  await assert.rejects(stops.createStop({ ...input, note: "A different decision." }), /BUSINESS_STOP_IDEMPOTENCY_CONFLICT/);
  await assert.rejects(stops.createStop({ ...input, idempotencyKey: "stop-002" }), /BUSINESS_STOP_ALREADY_EXISTS/);
  await assert.rejects(stops.createStop({ ...input, businessId: "business-b" }), /BUSINESS_STOP_IDEMPOTENCY_CONFLICT/);
  await assert.rejects(stops.createStop({ ...input, businessId: "missing", idempotencyKey: "unknown-business" }), /BUSINESS_STOP_BUSINESS_UNKNOWN/);
  assert.equal(await stops.getStop("business-b"), null);
  assert.equal((db.prepare(`SELECT count(*) AS count FROM "RevenueBusinessStopEvent"`).get() as { count: number }).count, 1);
  assert.deepEqual(await stops.listStopsForBusinessIds([]), new Map());
});

test("validates API values and the schema rejects nullable CHECK bypasses", async () => {
  const { db, stops } = fixture();
  for (const invalid of [
    { businessId: "", idempotencyKey: "k", reason: "OTHER", note: "n", actorUserId: "a" },
    { businessId: "business-a", idempotencyKey: " ", reason: "OTHER", note: "n", actorUserId: "a" },
    { businessId: "business-a", idempotencyKey: "k", reason: "BAD", note: "n", actorUserId: "a" },
    { businessId: "business-a", idempotencyKey: "k", reason: "OTHER", source: "OTHER", note: "n", actorUserId: "a" },
    { businessId: "business-a", idempotencyKey: "k", reason: "OTHER", note: "  ", actorUserId: "a" },
    { businessId: "business-a", idempotencyKey: "k", reason: "OTHER", note: "n\n", actorUserId: "a" },
    { businessId: "business-a", idempotencyKey: "k", reason: "OTHER", note: "n", actorUserId: "a\u0000" },
    { businessId: "business-a", idempotencyKey: "k", reason: "OTHER", note: "x".repeat(501), actorUserId: "a" },
    { businessId: "business-a", idempotencyKey: "k", reason: "OTHER", note: "n", actorUserId: "x".repeat(161) },
  ]) await assert.rejects(stops.createStop(invalid as never));
  await assert.rejects(stops.createStop({ ...input, businessId: null } as never), /businessId_INVALID/);
  await assert.rejects(stops.getStop("x".repeat(161)), /businessId_INVALID/);
  await assert.rejects(stops.listStopsForBusinessIds(["business-a", "business-a"]), /businessIds_INVALID/);
  await assert.rejects(stops.listStopsForBusinessIds(Array.from({ length: 101 }, (_, index) => `b-${index}`)), /businessIds_INVALID/);
  assert.throws(() => db.prepare(`INSERT INTO "RevenueBusinessStopEvent" ("stopId","businessId","idempotencyKey","reason","source","note","actorUserId") VALUES ('s','business-a','k',NULL,'OWNER_ACTION','note','actor')`).run(), /NOT NULL/);
});
