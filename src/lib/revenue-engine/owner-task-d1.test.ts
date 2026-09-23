import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import Database from "better-sqlite3";

import type { D1DatabaseLike, D1PreparedStatementLike } from "@/lib/cloudflare";
import { createRevenueOwnerTaskD1Boundary } from "@/lib/revenue-engine/owner-task-d1";

const kernel = readFileSync(new URL("../../../migrations/0054_revenue_shadow_kernel.sql", import.meta.url), "utf8");
const migration = readFileSync(new URL("../../../migrations/0071_revenue_owner_tasks.sql", import.meta.url), "utf8");

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
        async all<T = Record<string, unknown>>() {
          return { results: db.prepare(query).all(...values as never[]) as T[] };
        },
      };
      return statement as unknown as D1PreparedStatementLike;
    },
  };
  return { db, tasks: createRevenueOwnerTaskD1Boundary(database) };
}

const createInput = {
  businessId: "business-a", idempotencyKey: "create-001", owner: "RILEY" as const,
  actionText: "Review the saved business identity", dueAt: "2026-09-01T12:00:00.000Z", actorUserId: "user-riley",
};

test("owner task creation links the business, accepts stale due dates, and exact replay is mutation-free", async () => {
  const { db, tasks } = fixture();
  const created = await tasks.createTask(createInput);
  assert.equal(created.status, "CREATED");
  assert.equal((await tasks.listTasks("business-a"))[0]?.status, "OPEN");
  assert.equal((await tasks.listTasks("business-a"))[0]?.dueAt, createInput.dueAt);
  assert.deepEqual(await tasks.createTask(createInput), { ...created, status: "REPLAYED" });
  assert.equal((db.prepare(`SELECT count(*) AS count FROM "RevenueOwnerTask"`).get() as { count: number }).count, 1);
  assert.equal((await tasks.listTasks("business-b")).length, 0);
});

test("create rejects unknown businesses and same-key requests with a different body", async () => {
  const { tasks } = fixture();
  await assert.rejects(tasks.createTask({ ...createInput, businessId: "missing" }), /OWNER_TASK_BUSINESS_UNKNOWN/);
  await tasks.createTask(createInput);
  await assert.rejects(tasks.createTask({ ...createInput, businessId: "business-b" }), /OWNER_TASK_IDEMPOTENCY_CONFLICT/);
  await assert.rejects(tasks.createTask({ ...createInput, actionText: "Different action" }), /OWNER_TASK_IDEMPOTENCY_CONFLICT/);
});

test("dueAt validates Gregorian dates and timezone offset components strictly", async () => {
  const { tasks } = fixture();
  const leapDay = await tasks.createTask({ ...createInput, idempotencyKey: "leap-day-valid", dueAt: "2024-02-29T23:59:59Z" });
  assert.equal((await tasks.getTask("business-a", leapDay.taskId))?.dueAt, "2024-02-29T23:59:59Z");
  for (const [key, dueAt] of [
    ["feb-30", "2026-02-30T12:00:00Z"],
    ["non-leap-day", "2023-02-29T12:00:00Z"],
    ["hour-overflow", "2026-09-22T24:00:00Z"],
    ["offset-overflow", "2026-09-22T12:00:00+14:01"],
    ["offset-minute-overflow", "2026-09-22T12:00:00-05:60"],
  ]) {
    await assert.rejects(tasks.createTask({ ...createInput, idempotencyKey: `invalid-${key}`, dueAt }), /dueAt_INVALID/);
  }
});

test("one terminal event completes a task; exact replay is inert and a second terminal event is rejected", async () => {
  const { db, tasks } = fixture();
  const { taskId } = await tasks.createTask(createInput);
  const closeInput = { businessId: "business-a", taskId, idempotencyKey: "close-001", outcome: "COMPLETE" as const, actorUserId: "user-aidan", note: "Owner reviewed and accepted." };
  const completed = await tasks.closeTask(closeInput);
  assert.equal(completed.status, "COMPLETED");
  assert.deepEqual(await tasks.closeTask(closeInput), { ...completed, status: "REPLAYED" });
  assert.equal((db.prepare(`SELECT count(*) AS count FROM "RevenueOwnerTaskTerminalEvent"`).get() as { count: number }).count, 1);
  const [listed] = await tasks.listTasks("business-a");
  assert.equal(listed?.status, "COMPLETED");
  assert.equal(listed?.terminal?.note, closeInput.note);
  await assert.rejects(tasks.closeTask({ ...closeInput, businessId: "business-b" }), /OWNER_TASK_IDEMPOTENCY_CONFLICT/);
  await assert.rejects(tasks.closeTask({ ...closeInput, idempotencyKey: "close-002", outcome: "CANCEL" }), /OWNER_TASK_ALREADY_TERMINAL/);
  await assert.rejects(tasks.closeTask({ ...closeInput, note: "Changed note" }), /OWNER_TASK_IDEMPOTENCY_CONFLICT/);
});

test("cancel derives CANCELLED and terminal events reject unknown tasks", async () => {
  const { tasks } = fixture();
  await assert.rejects(tasks.closeTask({ businessId: "business-a", taskId: "unknown", idempotencyKey: "close-unknown", outcome: "CANCEL", actorUserId: "user-riley", note: "Not applicable." }), /OWNER_TASK_UNKNOWN/);
  const { taskId } = await tasks.createTask({ ...createInput, idempotencyKey: "create-cancel" });
  await tasks.closeTask({ businessId: "business-a", taskId, idempotencyKey: "cancel-001", outcome: "CANCEL", actorUserId: "user-riley", note: "Owner no longer needs this." });
  assert.equal((await tasks.listTasks("business-a")).find((task) => task.taskId === taskId)?.status, "CANCELLED");
});

test("database guards prevent direct update or delete of both immutable tables", async () => {
  const { db, tasks } = fixture();
  const { taskId } = await tasks.createTask(createInput);
  await tasks.closeTask({ businessId: "business-a", taskId, idempotencyKey: "close-immutable", outcome: "COMPLETE", actorUserId: "user-riley", note: "Done." });
  assert.throws(() => db.prepare(`UPDATE "RevenueOwnerTask" SET "actionText"='changed' WHERE "taskId"=?`).run(taskId), /REVENUE_OWNER_TASK_APPEND_ONLY/);
  assert.throws(() => db.prepare(`DELETE FROM "RevenueOwnerTask" WHERE "taskId"=?`).run(taskId), /REVENUE_OWNER_TASK_APPEND_ONLY/);
  assert.throws(() => db.prepare(`UPDATE "RevenueOwnerTaskTerminalEvent" SET "note"='changed' WHERE "taskId"=?`).run(taskId), /REVENUE_OWNER_TASK_APPEND_ONLY/);
  assert.throws(() => db.prepare(`DELETE FROM "RevenueOwnerTaskTerminalEvent" WHERE "taskId"=?`).run(taskId), /REVENUE_OWNER_TASK_APPEND_ONLY/);
});

test("business scoping prevents cross-business close and getTask disclosure", async () => {
  const { db, tasks } = fixture();
  const { taskId } = await tasks.createTask(createInput);
  assert.equal(await tasks.getTask("business-b", taskId), null);
  assert.equal((await tasks.getTask("business-a", taskId))?.businessId, "business-a");
  await assert.rejects(tasks.closeTask({ businessId: "business-b", taskId, idempotencyKey: "cross-business-close", outcome: "COMPLETE", actorUserId: "user-riley", note: "Must not be appended." }), /OWNER_TASK_BUSINESS_MISMATCH/);
  assert.equal((db.prepare(`SELECT count(*) AS count FROM "RevenueOwnerTaskTerminalEvent"`).get() as { count: number }).count, 0);
  assert.equal((await tasks.getTask("business-a", taskId))?.status, "OPEN");
});

test("task listing is capped at 100 rows", async () => {
  const { tasks } = fixture();
  for (let index = 0; index < 105; index += 1) {
    await tasks.createTask({ ...createInput, idempotencyKey: `bulk-${String(index).padStart(3, "0")}`, actionText: `Synthetic action ${index}` });
  }
  assert.equal((await tasks.listTasks("business-a")).length, 100);
});
