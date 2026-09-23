import type { D1DatabaseLike } from "@/lib/cloudflare";

const ISO_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|([+-])(\d{2}):(\d{2}))$/;
const MAX_TASKS = 100;

export type RevenueOwner = "RILEY" | "AIDAN";
export type RevenueOwnerTaskStatus = "OPEN" | "COMPLETED" | "CANCELLED";
export type RevenueOwnerTask = Readonly<{
  taskId: string;
  businessId: string;
  owner: RevenueOwner;
  actionText: string;
  dueAt: string;
  actorUserId: string;
  createdAt: string;
  status: RevenueOwnerTaskStatus;
  terminal?: Readonly<{ outcome: "COMPLETE" | "CANCEL"; actorUserId: string; note: string; createdAt: string }>;
}>;

export type CreateRevenueOwnerTaskInput = Readonly<{
  businessId: string;
  idempotencyKey: string;
  owner: RevenueOwner;
  actionText: string;
  dueAt: string;
  actorUserId: string;
}>;

export type TerminalRevenueOwnerTaskInput = Readonly<{
  businessId: string;
  taskId: string;
  idempotencyKey: string;
  outcome: "COMPLETE" | "CANCEL";
  actorUserId: string;
  note: string;
}>;

function fail(code: string): never { throw new Error(code); }

function text(value: string, name: string, maxLength: number): string {
  if (typeof value !== "string" || value.length < 1 || value.length > maxLength || value.trim() !== value || /[\u0000-\u001f\u007f]/.test(value)) {
    return fail(`${name}_INVALID`);
  }
  return value;
}

function timestamp(value: string, name: string): string {
  if (typeof value !== "string" || value.length > 40) return fail(`${name}_INVALID`);
  const match = ISO_DATE_TIME.exec(value);
  if (!match) return fail(`${name}_INVALID`);
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, zone, , offsetHourText, offsetMinuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > (daysInMonth[month - 1] ?? 0) ||
      hour > 23 || minute > 59 || second > 59) return fail(`${name}_INVALID`);
  if (zone !== "Z") {
    const offsetHour = Number(offsetHourText);
    const offsetMinute = Number(offsetMinuteText);
    if (offsetHour > 14 || offsetMinute > 59 || (offsetHour === 14 && offsetMinute !== 0)) return fail(`${name}_INVALID`);
  }
  if (!Number.isFinite(Date.parse(value))) return fail(`${name}_INVALID`);
  return value;
}

function rowText(row: Record<string, unknown>, field: string): string {
  if (typeof row[field] !== "string") return fail(`OWNER_TASK_${field.toUpperCase()}_INVALID`);
  return row[field] as string;
}

function terminal(row: Record<string, unknown> | null): RevenueOwnerTask["terminal"] {
  if (!row) return undefined;
  const outcome = row.outcome;
  if (outcome !== "COMPLETE" && outcome !== "CANCEL") return fail("OWNER_TASK_OUTCOME_INVALID");
  return { outcome, actorUserId: rowText(row, "terminalActorUserId"), note: rowText(row, "note"), createdAt: rowText(row, "terminalCreatedAt") };
}

function decodeTask(row: Record<string, unknown>): RevenueOwnerTask {
  const end = terminal(row.outcome === null || row.outcome === undefined ? null : row);
  const owner = row.owner;
  if (owner !== "RILEY" && owner !== "AIDAN") return fail("OWNER_TASK_OWNER_INVALID");
  return {
    taskId: rowText(row, "taskId"), businessId: rowText(row, "businessId"), owner,
    actionText: rowText(row, "actionText"), dueAt: rowText(row, "dueAt"), actorUserId: rowText(row, "actorUserId"), createdAt: rowText(row, "createdAt"),
    status: end ? (end.outcome === "COMPLETE" ? "COMPLETED" : "CANCELLED") : "OPEN", ...(end ? { terminal: end } : {}),
  };
}

export function createRevenueOwnerTaskD1Boundary(database: Pick<D1DatabaseLike, "prepare">) {
  async function createTask(input: CreateRevenueOwnerTaskInput): Promise<{ taskId: string; status: "CREATED" | "REPLAYED" }> {
    const businessId = text(input.businessId, "businessId", 160);
    const idempotencyKey = text(input.idempotencyKey, "idempotencyKey", 160);
    if (input.owner !== "RILEY" && input.owner !== "AIDAN") return fail("owner_INVALID");
    const actionText = text(input.actionText, "actionText", 500);
    const dueAt = timestamp(input.dueAt, "dueAt");
    const actorUserId = text(input.actorUserId, "actorUserId", 160);
    const taskId = `owner-task:${idempotencyKey}`;

    // One conditional INSERT is the atomic mutation. Unique constraints arbitrate
    // concurrent retries; readback below validates the complete original request.
    const inserted = await database.prepare(`INSERT INTO "RevenueOwnerTask"
      ("taskId","businessId","idempotencyKey","owner","actionText","dueAt","actorUserId")
      SELECT ?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM "RevenueBusiness" WHERE "id"=?)
      ON CONFLICT ("idempotencyKey") DO NOTHING`).bind(taskId, businessId, idempotencyKey, input.owner, actionText, dueAt, actorUserId, businessId).run();
    const existing = await database.prepare(`SELECT "taskId","businessId","idempotencyKey","owner","actionText","dueAt","actorUserId"
      FROM "RevenueOwnerTask" WHERE "idempotencyKey"=?`).bind(idempotencyKey).first<Record<string, unknown>>();
    if (!existing) {
      const business = await database.prepare(`SELECT "id" FROM "RevenueBusiness" WHERE "id"=?`).bind(businessId).first();
      if (!business) return fail("OWNER_TASK_BUSINESS_UNKNOWN");
      return fail("OWNER_TASK_CREATE_NOT_ADMITTED");
    }
    if (existing.taskId !== taskId || existing.businessId !== businessId || existing.owner !== input.owner ||
        existing.actionText !== actionText || existing.dueAt !== dueAt || existing.actorUserId !== actorUserId) {
      return fail("OWNER_TASK_IDEMPOTENCY_CONFLICT");
    }
    return { taskId, status: inserted.meta?.changes === 1 ? "CREATED" : "REPLAYED" };
  }

  async function closeTask(input: TerminalRevenueOwnerTaskInput): Promise<{ eventId: string; status: "COMPLETED" | "CANCELLED" | "REPLAYED" }> {
    const businessId = text(input.businessId, "businessId", 160);
    const taskId = text(input.taskId, "taskId", 200);
    const idempotencyKey = text(input.idempotencyKey, "idempotencyKey", 160);
    if (input.outcome !== "COMPLETE" && input.outcome !== "CANCEL") return fail("outcome_INVALID");
    const actorUserId = text(input.actorUserId, "actorUserId", 160);
    const note = text(input.note, "note", 500);
    const eventId = `owner-task-event:${idempotencyKey}`;
    const inserted = await database.prepare(`INSERT INTO "RevenueOwnerTaskTerminalEvent"
      ("eventId","idempotencyKey","taskId","outcome","actorUserId","note")
      SELECT ?,?,?,?,?,? FROM "RevenueOwnerTask" t WHERE t."taskId"=? AND t."businessId"=?
        AND NOT EXISTS (SELECT 1 FROM "RevenueOwnerTaskTerminalEvent" e WHERE e."taskId"=t."taskId")
      ON CONFLICT DO NOTHING`).bind(eventId, idempotencyKey, taskId, input.outcome, actorUserId, note, taskId, businessId).run();
    const existing = await database.prepare(`SELECT e."eventId",e."idempotencyKey",e."taskId",e."outcome",e."actorUserId",e."note",t."businessId"
      FROM "RevenueOwnerTaskTerminalEvent" e JOIN "RevenueOwnerTask" t ON t."taskId"=e."taskId"
      WHERE e."idempotencyKey"=?`).bind(idempotencyKey).first<Record<string, unknown>>();
    if (existing) {
      if (existing.eventId !== eventId || existing.taskId !== taskId || existing.businessId !== businessId || existing.outcome !== input.outcome ||
          existing.actorUserId !== actorUserId || existing.note !== note) return fail("OWNER_TASK_IDEMPOTENCY_CONFLICT");
      return { eventId, status: inserted.meta?.changes === 1 ? (input.outcome === "COMPLETE" ? "COMPLETED" : "CANCELLED") : "REPLAYED" };
    }
    const task = await database.prepare(`SELECT "taskId","businessId" FROM "RevenueOwnerTask" WHERE "taskId"=?`).bind(taskId).first<Record<string, unknown>>();
    if (!task) return fail("OWNER_TASK_UNKNOWN");
    if (task.businessId !== businessId) return fail("OWNER_TASK_BUSINESS_MISMATCH");
    const terminalRow = await database.prepare(`SELECT "taskId" FROM "RevenueOwnerTaskTerminalEvent" WHERE "taskId"=?`).bind(taskId).first();
    if (terminalRow) return fail("OWNER_TASK_ALREADY_TERMINAL");
    return fail("OWNER_TASK_TERMINAL_NOT_ADMITTED");
  }

  async function listTasks(businessIdValue: string): Promise<RevenueOwnerTask[]> {
    const businessId = text(businessIdValue, "businessId", 160);
    const rows = await database.prepare(`SELECT t."taskId",t."businessId",t."owner",t."actionText",t."dueAt",t."actorUserId",t."createdAt",
        e."outcome",e."actorUserId" AS "terminalActorUserId",e."note",e."createdAt" AS "terminalCreatedAt"
      FROM "RevenueOwnerTask" t LEFT JOIN "RevenueOwnerTaskTerminalEvent" e ON e."taskId"=t."taskId"
      WHERE t."businessId"=? ORDER BY t."createdAt" DESC,t."taskId" DESC LIMIT ${MAX_TASKS}`).bind(businessId).all<Record<string, unknown>>();
    return (rows.results ?? []).map(decodeTask);
  }

  async function getTask(businessIdValue: string, taskIdValue: string): Promise<RevenueOwnerTask | null> {
    const businessId = text(businessIdValue, "businessId", 160);
    const taskId = text(taskIdValue, "taskId", 200);
    const row = await database.prepare(`SELECT t."taskId",t."businessId",t."owner",t."actionText",t."dueAt",t."actorUserId",t."createdAt",
        e."outcome",e."actorUserId" AS "terminalActorUserId",e."note",e."createdAt" AS "terminalCreatedAt"
      FROM "RevenueOwnerTask" t LEFT JOIN "RevenueOwnerTaskTerminalEvent" e ON e."taskId"=t."taskId"
      WHERE t."businessId"=? AND t."taskId"=?`).bind(businessId, taskId).first<Record<string, unknown>>();
    return row ? decodeTask(row) : null;
  }

  return { createTask, closeTask, listTasks, getTask } as const;
}
