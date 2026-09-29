import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import Database from "better-sqlite3";

import type { D1DatabaseLike, D1PreparedStatementLike } from "@/lib/cloudflare";
import { createRevenueOwnerTaskD1Boundary } from "@/lib/revenue-engine/owner-task-d1";
import { createRevenueOwnerObservedReplyD1Boundary } from "@/lib/revenue-engine/owner-observed-reply-d1";

const kernel = readFileSync(new URL("../../../migrations/0054_revenue_shadow_kernel.sql", import.meta.url), "utf8");
const tasksMigration = readFileSync(new URL("../../../migrations/0071_revenue_owner_tasks.sql", import.meta.url), "utf8");
const businessStopMigration = readFileSync(new URL("../../../migrations/0072_revenue_business_stop.sql", import.meta.url), "utf8");
const suppressionMigration = readFileSync(new URL("../../../migrations/0073_revenue_contact_suppression.sql", import.meta.url), "utf8");
const repliesMigration = readFileSync(new URL("../../../migrations/0074_revenue_owner_observed_replies.sql", import.meta.url), "utf8");

function fixture() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(kernel);
  db.exec(tasksMigration);
  db.exec(businessStopMigration);
  db.exec(suppressionMigration);
  db.exec(repliesMigration);
  db.prepare(`INSERT INTO "RevenueBusiness" ("id","canonicalName") VALUES (?,?)`).run("business-a", "Synthetic Roofing");
  db.prepare(`INSERT INTO "RevenueBusiness" ("id","canonicalName") VALUES (?,?)`).run("business-b", "Synthetic HVAC");
  db.prepare(`INSERT INTO "RevenueContactPoint" ("id","businessId","channel","value") VALUES (?,?,?,?)`).run("email-a", "business-a", "EMAIL", "owner@example.test");
  db.prepare(`INSERT INTO "RevenueContactPoint" ("id","businessId","channel","value") VALUES (?,?,?,?)`).run("email-a-v2", "business-a", "EMAIL", "owner@example.test");
  db.prepare(`INSERT INTO "RevenueContactPoint" ("id","businessId","channel","value") VALUES (?,?,?,?)`).run("phone-a", "business-a", "PHONE", "+15195550123");
  db.prepare(`INSERT INTO "RevenueContactPoint" ("id","businessId","channel","value") VALUES (?,?,?,?)`).run("email-b", "business-b", "EMAIL", "other@example.test");
  const database: D1DatabaseLike = {
    prepare(query: string) {
      let values: unknown[] = [];
      const statement = {
        bind(...bindings: unknown[]) { values = bindings; return statement; },
        async run() { const result = db.prepare(query).run(...values as never[]); return { meta: { changes: Number(result.changes), last_row_id: result.lastInsertRowid } }; },
        async first<T = Record<string, unknown>>(column?: string): Promise<T | null> {
          const result = db.prepare(query).get(...values as never[]) as Record<string, unknown> | undefined;
          return (column && result ? result[column] : result) as T | null;
        },
        async all<T = Record<string, unknown>>() { return { results: db.prepare(query).all(...values as never[]) as T[] }; },
      };
      return statement as unknown as D1PreparedStatementLike;
    },
  };
  return { db, replies: createRevenueOwnerObservedReplyD1Boundary(database), tasks: createRevenueOwnerTaskD1Boundary(database) };
}

const input = {
  businessId: "business-a", contactPointId: "email-a", idempotencyKey: "reply-001", category: "QUESTION" as const,
  summary: "Asked for a short overview of the service.", observedAt: "2026-09-23T14:00:00.000Z", owner: "RILEY" as const,
  actionText: "Send the approved overview after reviewing the business context.", dueAt: "2026-09-24T16:00:00.000Z", actorUserId: "user-riley",
};

test("reply and owner task are created atomically and an exact retry reads saved status", async () => {
  const { db, replies } = fixture();
  const created = await replies.createObservedReply(input);
  assert.equal(created.status, "CREATED");
  assert.equal(created.reply.taskStatus, "OPEN");
  assert.equal(created.reply.taskId, "owner-reply-task:reply-001");
  assert.equal((db.prepare(`SELECT count(*) AS count FROM "RevenueOwnerObservedReply"`).get() as { count: number }).count, 1);
  assert.equal((db.prepare(`SELECT count(*) AS count FROM "RevenueOwnerTask"`).get() as { count: number }).count, 1);
  assert.deepEqual(await replies.createObservedReply(input), { status: "REPLAYED", reply: created.reply });
  assert.equal((await replies.listReplies("business-a")).length, 1);
  assert.equal((await replies.listReplies("business-b")).length, 0);
});

test("same idempotency key only replays the exact command and conflicts on changed fields", async () => {
  const { replies } = fixture();
  await replies.createObservedReply(input);
  for (const changed of [
    { category: "NEGATIVE" as const }, { summary: "Changed summary." }, { observedAt: "2026-09-23T15:00:00.000Z" },
    { owner: "AIDAN" as const }, { actionText: "Different action" }, { dueAt: "2026-09-25T16:00:00.000Z" },
    { contactPointId: "email-b" }, { businessId: "business-b" },
  ]) await assert.rejects(replies.createObservedReply({ ...input, ...changed } as typeof input), /OWNER_REPLY_IDEMPOTENCY_CONFLICT/);
});

test("reply requires the exact saved email contact and rejects other businesses and channels", async () => {
  const { db, replies } = fixture();
  await assert.rejects(replies.createObservedReply({ ...input, contactPointId: "missing" }), /OWNER_REPLY_CONTACT_UNKNOWN/);
  await assert.rejects(replies.createObservedReply({ ...input, contactPointId: "email-b" }), /OWNER_REPLY_CONTACT_SCOPE_INVALID/);
  await assert.rejects(replies.createObservedReply({ ...input, contactPointId: "phone-a" }), /OWNER_REPLY_CONTACT_NOT_EMAIL/);
  assert.throws(() => db.prepare(`INSERT INTO "RevenueOwnerObservedReply"
    ("replyId","businessId","contactPointId","contactFingerprint","idempotencyKey","category","summary","observedAt","owner","actionText","dueAt","actorUserId","taskId")
    VALUES ('bad','business-a','phone-a',?,'direct-bad','OTHER','Observed by owner.','2026-09-23T14:00:00Z','RILEY','Review reply','2026-09-24T16:00:00Z','user-riley','task-bad')`).run("a".repeat(64)), /REVENUE_OWNER_REPLY_CONTACT_INVALID/);
});

test("business stop, exact contact suppression, and absent guard tables fail closed", async () => {
  const { db, replies } = fixture();
  db.prepare(`INSERT INTO "RevenueBusinessStopEvent" ("stopId","businessId","idempotencyKey","reason","note","actorUserId")
    VALUES ('stop-a','business-a','stop-key','OWNER_DECISION','Owner recorded a stop.','user-riley')`).run();
  await assert.rejects(replies.createObservedReply(input), /OWNER_REPLY_BUSINESS_STOPPED/);

  const second = fixture();
  const bytes = new TextEncoder().encode("business-a\u0000EMAIL:owner@example.test");
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const fingerprint = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  second.db.prepare(`INSERT INTO "RevenueContactSuppressionEvent"
    ("suppressionId","businessId","contactPointId","contactFingerprint","idempotencyKey","reason","note","actorUserId","observedAt")
    VALUES ('suppression-a','business-a','email-a',?, 'suppression-key','UNSUBSCRIBE','Owner observed an unsubscribe.','user-riley','2026-09-23T13:00:00Z')`).run(fingerprint);
  await assert.rejects(second.replies.createObservedReply({ ...input, contactPointId: "email-a-v2" }), /OWNER_REPLY_CONTACT_SUPPRESSED/);

  const missing = fixture();
  missing.db.exec(`DROP TABLE "RevenueContactSuppressionEvent"`);
  await assert.rejects(missing.replies.createObservedReply(input));
  assert.equal((missing.db.prepare(`SELECT count(*) AS count FROM "RevenueOwnerObservedReply"`).get() as { count: number }).count, 0);

  const missingStop = fixture();
  missingStop.db.exec(`DROP TABLE "RevenueBusinessStopEvent"`);
  await assert.rejects(missingStop.replies.createObservedReply(input));
  assert.equal((missingStop.db.prepare(`SELECT count(*) AS count FROM "RevenueOwnerObservedReply"`).get() as { count: number }).count, 0);
});

test("concurrent same-key submissions produce one reply and one task", async () => {
  const { db, replies } = fixture();
  const results = await Promise.all([replies.createObservedReply(input), replies.createObservedReply(input)]);
  assert.deepEqual(results.map((result) => result.status).sort(), ["CREATED", "REPLAYED"]);
  assert.equal((db.prepare(`SELECT count(*) AS count FROM "RevenueOwnerObservedReply"`).get() as { count: number }).count, 1);
  assert.equal((db.prepare(`SELECT count(*) AS count FROM "RevenueOwnerTask"`).get() as { count: number }).count, 1);
});

test("terminal task changes appear on the reply readback and only open tasks feed Today", async () => {
  const { replies, tasks } = fixture();
  const created = await replies.createObservedReply(input);
  await tasks.closeTask({ businessId: input.businessId, taskId: created.reply.taskId, idempotencyKey: "complete-reply", outcome: "COMPLETE", actorUserId: "user-riley", note: "Reviewed and handled." });
  const completed = (await replies.listReplies(input.businessId))[0];
  assert.equal(completed?.taskStatus, "COMPLETED");
  assert.equal((await replies.listOpenReplies()).length, 0);

  const cancelled = await replies.createObservedReply({ ...input, idempotencyKey: "reply-cancelled" });
  await tasks.closeTask({ businessId: input.businessId, taskId: cancelled.reply.taskId, idempotencyKey: "cancel-reply", outcome: "CANCEL", actorUserId: "user-riley", note: "Reassigned to another owner workflow." });
  const detail = (await replies.listReplies(input.businessId)).find((reply) => reply.replyId === cancelled.reply.replyId);
  assert.equal(detail?.taskStatus, "CANCELLED");
  assert.equal((await replies.listOpenReplies()).length, 0);
});

test("Today readback includes business name and sorts open replies by earliest due time", async () => {
  const { replies } = fixture();
  await replies.createObservedReply({ ...input, idempotencyKey: "later", dueAt: "2026-09-25T12:00:00Z" });
  await replies.createObservedReply({ ...input, idempotencyKey: "earlier", dueAt: "2026-09-24T12:00:00Z" });
  const rows = await replies.listOpenReplies();
  assert.equal(rows[0]?.idempotencyKey, "earlier");
  assert.equal(rows[0]?.businessName, "Synthetic Roofing");
  assert.equal(rows.every((row) => row.taskStatus === "OPEN"), true);
});

test("reply rows are immutable and a failed task creation rolls back the reply", async () => {
  const { db, replies } = fixture();
  db.prepare(`INSERT INTO "RevenueOwnerTask" ("taskId","businessId","idempotencyKey","owner","actionText","dueAt","actorUserId")
    VALUES ('owner-reply-task:collision','business-a','owner-reply:collision','RILEY','Existing task','2026-09-24T12:00:00Z','user-riley')`).run();
  await assert.rejects(replies.createObservedReply({ ...input, idempotencyKey: "collision" }));
  assert.equal((db.prepare(`SELECT count(*) AS count FROM "RevenueOwnerObservedReply"`).get() as { count: number }).count, 0);
  const created = await replies.createObservedReply(input);
  assert.throws(() => db.prepare(`UPDATE "RevenueOwnerObservedReply" SET "summary"='changed' WHERE "replyId"=?`).run(created.reply.replyId), /REVENUE_OWNER_REPLY_APPEND_ONLY/);
  assert.throws(() => db.prepare(`DELETE FROM "RevenueOwnerObservedReply" WHERE "replyId"=?`).run(created.reply.replyId), /REVENUE_OWNER_REPLY_APPEND_ONLY/);
});
