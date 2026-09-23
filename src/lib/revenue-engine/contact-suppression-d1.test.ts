import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import Database from "better-sqlite3";

import type { D1DatabaseLike, D1PreparedStatementLike } from "@/lib/cloudflare";
import { createRevenueContactSuppressionD1Boundary } from "@/lib/revenue-engine/contact-suppression-d1";

const kernel = readFileSync(new URL("../../../migrations/0054_revenue_shadow_kernel.sql", import.meta.url), "utf8");
const migration = readFileSync(new URL("../../../migrations/0073_revenue_contact_suppression.sql", import.meta.url), "utf8");

function fixture() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(kernel);
  db.exec(migration);
  db.prepare(`INSERT INTO "RevenueBusiness" ("id","canonicalName") VALUES (?,?)`).run("business-a", "Synthetic Roofing");
  db.prepare(`INSERT INTO "RevenueBusiness" ("id","canonicalName") VALUES (?,?)`).run("business-b", "Synthetic HVAC");
  db.prepare(`INSERT INTO "RevenueContactPoint" ("id","businessId","channel","value") VALUES (?,?,?,?)`)
    .run("contact-a", "business-a", "EMAIL", "private@example.test");
  db.prepare(`INSERT INTO "RevenueContactPoint" ("id","businessId","channel","value") VALUES (?,?,?,?)`)
    .run("contact-b", "business-b", "EMAIL", "other@example.test");
  db.prepare(`INSERT INTO "RevenueContactPoint" ("id","businessId","channel","value") VALUES (?,?,?,?)`)
    .run("contact-a-v2", "business-a", "EMAIL", "PRIVATE@example.test ");
  const database: D1DatabaseLike = {
    prepare(query: string) {
      let values: unknown[] = [];
      const statement = {
        bind(...bindings: unknown[]) { values = bindings; return statement; },
        async run() {
          const result = db.prepare(query).run(...values as never[]);
          return { meta: { changes: Number(result.changes) } };
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
  return { db, database, suppressions: createRevenueContactSuppressionD1Boundary(database) };
}

const input = {
  businessId: "business-a",
  contactPointId: "contact-a",
  idempotencyKey: "suppression-001",
  reason: "UNSUBSCRIBE" as const,
  note: "Owner personally observed an unsubscribe request.",
  actorUserId: "user-riley",
  observedAt: "2026-09-23T14:30:00.000Z",
};

test("records a permanent exact-contact suppression and replays only the identical command", async () => {
  const { db, suppressions } = fixture();
  const created = await suppressions.createSuppression(input);
  assert.equal(created.status, "CREATED");
  assert.deepEqual(created.suppression, await suppressions.getSuppression("business-a", "contact-a"));
  assert.deepEqual(await suppressions.createSuppression(input), { ...created, status: "REPLAYED" });
  for (const changed of [
    { note: "Different observation." },
    { reason: "COMPLAINT" as const },
    { observedAt: "2026-09-23T14:31:00.000Z" },
    { actorUserId: "user-aidan" },
    { businessId: "business-b" },
    { contactPointId: "contact-b" },
  ]) {
    await assert.rejects(suppressions.createSuppression({ ...input, ...changed } as typeof input), /CONTACT_SUPPRESSION_IDEMPOTENCY_CONFLICT/);
  }
  assert.equal((db.prepare(`SELECT count(*) AS count FROM "RevenueContactSuppressionEvent"`).get() as { count: number }).count, 1);
  assert.throws(() => db.prepare(`UPDATE "RevenueContactSuppressionEvent" SET "note"='changed'`).run(), /REVENUE_CONTACT_SUPPRESSION_APPEND_ONLY/);
  assert.throws(() => db.prepare(`DELETE FROM "RevenueContactSuppressionEvent"`).run(), /REVENUE_CONTACT_SUPPRESSION_APPEND_ONLY/);
});

test("rejects wrong business/contact scope, a second command for one contact, and unknown contact", async () => {
  const { db, suppressions } = fixture();
  await assert.rejects(suppressions.createSuppression({ ...input, businessId: "business-b" }), /CONTACT_SUPPRESSION_SCOPE_INVALID/);
  await assert.rejects(suppressions.createSuppression({ ...input, contactPointId: "missing" }), /CONTACT_SUPPRESSION_CONTACT_UNKNOWN/);
  await suppressions.createSuppression(input);
  await assert.rejects(suppressions.createSuppression({ ...input, idempotencyKey: "suppression-002" }), /CONTACT_SUPPRESSION_ALREADY_EXISTS/);
  assert.equal((await suppressions.getSuppression("business-a", "contact-a-v2"))?.contactPointId, "contact-a");
  await assert.rejects(suppressions.createSuppression({ ...input, contactPointId: "contact-a-v2", idempotencyKey: "suppression-003" }), /CONTACT_SUPPRESSION_ALREADY_EXISTS/);
  await assert.rejects(suppressions.getSuppression("business-b", "contact-a"), /CONTACT_SUPPRESSION_READ_SCOPE_INVALID/);
  assert.equal((db.prepare(`SELECT count(*) AS count FROM "RevenueContactSuppressionEvent"`).get() as { count: number }).count, 1);
  assert.throws(() => db.prepare(`INSERT INTO "RevenueContactSuppressionEvent"
    ("suppressionId","businessId","contactPointId","contactFingerprint","idempotencyKey","reason","note","actorUserId","observedAt")
    VALUES ('bad','business-b','contact-a',printf('%064d',0),'bad','BOUNCE','note','actor','2026-09-23T14:30:00Z')`).run(), /REVENUE_CONTACT_SUPPRESSION_SCOPE_INVALID/);
});

test("validates values and fails closed when persistence reads fail", async () => {
  const { db, suppressions } = fixture();
  for (const invalid of [
    { ...input, reason: "OTHER" },
    { ...input, note: " " },
    { ...input, note: "x".repeat(301) },
    { ...input, note: "text\nwith body" },
    { ...input, actorUserId: " " },
    { ...input, observedAt: "yesterday" },
  ]) await assert.rejects(suppressions.createSuppression(invalid as never));

  const failingDb: D1DatabaseLike = { prepare() { throw new Error("read unavailable"); } };
  await assert.rejects(createRevenueContactSuppressionD1Boundary(failingDb).createSuppression(input), /read unavailable/);
  await assert.rejects(createRevenueContactSuppressionD1Boundary(failingDb).getSuppression("business-a", "contact-a"), /read unavailable/);
  assert.equal((db.prepare(`SELECT count(*) AS count FROM "RevenueContactSuppressionEvent"`).get() as { count: number }).count, 0);
});
