import type { D1DatabaseLike } from "@/lib/cloudflare";

const ISO_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|([+-])(\d{2}):(\d{2}))$/;
const MAX_REPLIES = 100;

export type RevenueObservedReplyCategory = "INTEREST" | "QUESTION" | "NEGATIVE" | "REFERRAL" | "OUT_OF_OFFICE" | "OTHER";
export type RevenueObservedReplyTaskStatus = "OPEN" | "COMPLETED" | "CANCELLED";
export type CreateObservedReplyInput = Readonly<{
  businessId: string;
  contactPointId: string;
  idempotencyKey: string;
  category: RevenueObservedReplyCategory;
  summary: string;
  observedAt: string;
  owner: "RILEY" | "AIDAN";
  actionText: string;
  dueAt: string;
  actorUserId: string;
}>;
export type RevenueObservedReply = Readonly<{
  replyId: string;
  businessId: string;
  contactPointId: string;
  idempotencyKey: string;
  category: RevenueObservedReplyCategory;
  summary: string;
  observedAt: string;
  createdAt: string;
  taskId: string;
  owner: "RILEY" | "AIDAN";
  actionText: string;
  dueAt: string;
  actorUserId: string;
  taskStatus: RevenueObservedReplyTaskStatus;
  taskTerminal?: Readonly<{ outcome: "COMPLETE" | "CANCEL"; actorUserId: string; note: string; createdAt: string }>;
}>;
export type RevenueOpenObservedReply = RevenueObservedReply & Readonly<{ businessName: string }>;

function fail(code: string): never { throw new Error(code); }

function text(value: unknown, name: string, maxLength: number): string {
  if (typeof value !== "string" || value.length < 1 || value.length > maxLength || value.trim() !== value || /[\u0000-\u001f\u007f]/.test(value)) {
    return fail(`${name}_INVALID`);
  }
  return value;
}

function timestamp(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length > 40) return fail(`${name}_INVALID`);
  const match = ISO_DATE_TIME.exec(value);
  if (!match) return fail(`${name}_INVALID`);
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, zone, , offsetHourText, offsetMinuteText] = match;
  const year = Number(yearText), month = Number(monthText), day = Number(dayText);
  const hour = Number(hourText), minute = Number(minuteText), second = Number(secondText);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > (daysInMonth[month - 1] ?? 0) || hour > 23 || minute > 59 || second > 59) return fail(`${name}_INVALID`);
  if (zone !== "Z") {
    const offsetHour = Number(offsetHourText), offsetMinute = Number(offsetMinuteText);
    if (offsetHour > 14 || offsetMinute > 59 || (offsetHour === 14 && offsetMinute !== 0)) return fail(`${name}_INVALID`);
  }
  if (!Number.isFinite(Date.parse(value))) return fail(`${name}_INVALID`);
  return value;
}

function rowText(row: Record<string, unknown>, field: string): string {
  if (typeof row[field] !== "string") return fail(`OWNER_REPLY_${field.toUpperCase()}_INVALID`);
  return row[field] as string;
}

async function emailFingerprint(businessId: string, value: unknown): Promise<string> {
  if (typeof value !== "string" || !value.trim()) return fail("OWNER_REPLY_CONTACT_INVALID");
  const normalized = `EMAIL:${value.trim().toLowerCase()}`;
  const bytes = new TextEncoder().encode(`${businessId}\u0000${normalized}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function decode(row: Record<string, unknown>): RevenueObservedReply {
  const category = row.category;
  if (category !== "INTEREST" && category !== "QUESTION" && category !== "NEGATIVE" && category !== "REFERRAL" && category !== "OUT_OF_OFFICE" && category !== "OTHER") return fail("OWNER_REPLY_CATEGORY_INVALID");
  const owner = row.owner;
  if (owner !== "RILEY" && owner !== "AIDAN") return fail("OWNER_REPLY_OWNER_INVALID");
  const outcome = row.outcome;
  if (outcome !== null && outcome !== undefined && outcome !== "COMPLETE" && outcome !== "CANCEL") return fail("OWNER_REPLY_TASK_OUTCOME_INVALID");
  const taskStatus: RevenueObservedReplyTaskStatus = outcome === "COMPLETE" ? "COMPLETED" : outcome === "CANCEL" ? "CANCELLED" : "OPEN";
  const terminal = outcome ? {
    outcome,
    actorUserId: rowText(row, "terminalActorUserId"),
    note: rowText(row, "terminalNote"),
    createdAt: rowText(row, "terminalCreatedAt"),
  } as const : undefined;
  return {
    replyId: rowText(row, "replyId"), businessId: rowText(row, "businessId"), contactPointId: rowText(row, "contactPointId"),
    idempotencyKey: rowText(row, "idempotencyKey"), category, summary: rowText(row, "summary"), observedAt: rowText(row, "observedAt"),
    createdAt: rowText(row, "createdAt"), taskId: rowText(row, "taskId"), owner, actionText: rowText(row, "actionText"),
    dueAt: rowText(row, "dueAt"), actorUserId: rowText(row, "actorUserId"), taskStatus, ...(terminal ? { taskTerminal: terminal } : {}),
  };
}

const select = `SELECT r."replyId",r."businessId",r."contactPointId",r."idempotencyKey",r."category",r."summary",r."observedAt",r."createdAt",
    r."taskId",t."owner",t."actionText",t."dueAt",t."actorUserId",e."outcome",e."actorUserId" AS "terminalActorUserId",
    e."note" AS "terminalNote",e."createdAt" AS "terminalCreatedAt"
  FROM "RevenueOwnerObservedReply" r JOIN "RevenueOwnerTask" t ON t."taskId"=r."taskId"
  LEFT JOIN "RevenueOwnerTaskTerminalEvent" e ON e."taskId"=t."taskId"`;

function matches(reply: RevenueObservedReply, input: CreateObservedReplyInput, replyId: string): boolean {
  return reply.replyId === replyId && reply.businessId === input.businessId && reply.contactPointId === input.contactPointId &&
    reply.idempotencyKey === input.idempotencyKey && reply.category === input.category && reply.summary === input.summary &&
    reply.observedAt === input.observedAt && reply.owner === input.owner && reply.actionText === input.actionText &&
    reply.dueAt === input.dueAt && reply.actorUserId === input.actorUserId;
}

export function createRevenueOwnerObservedReplyD1Boundary(database: Pick<D1DatabaseLike, "prepare">) {
  async function byKey(key: string): Promise<RevenueObservedReply | null> {
    const row = await database.prepare(`${select} WHERE r."idempotencyKey"=?`).bind(key).first<Record<string, unknown>>();
    return row ? decode(row) : null;
  }

  async function createObservedReply(input: CreateObservedReplyInput): Promise<{ status: "CREATED" | "REPLAYED"; reply: RevenueObservedReply }> {
    const businessId = text(input.businessId, "businessId", 160);
    const contactPointId = text(input.contactPointId, "contactPointId", 160);
    const idempotencyKey = text(input.idempotencyKey, "idempotencyKey", 160);
    const category = input.category;
    if (!["INTEREST", "QUESTION", "NEGATIVE", "REFERRAL", "OUT_OF_OFFICE", "OTHER"].includes(category)) return fail("category_INVALID");
    const summary = text(input.summary, "summary", 300);
    const observedAt = timestamp(input.observedAt, "observedAt");
    if (input.owner !== "RILEY" && input.owner !== "AIDAN") return fail("owner_INVALID");
    const actionText = text(input.actionText, "actionText", 500);
    const dueAt = timestamp(input.dueAt, "dueAt");
    const actorUserId = text(input.actorUserId, "actorUserId", 160);
    const normalized = { ...input, businessId, contactPointId, idempotencyKey, category, summary, observedAt, actionText, dueAt, actorUserId };
    const replyId = `observed-reply:${idempotencyKey}`;
    const taskId = `owner-reply-task:${idempotencyKey}`;

    // Resolve exact replay before current-state stop guards; accepted history
    // remains readable after a later stop, while changed payloads conflict.
    const prior = await byKey(idempotencyKey);
    if (prior) {
      if (!matches(prior, normalized, replyId)) return fail("OWNER_REPLY_IDEMPOTENCY_CONFLICT");
      return { status: "REPLAYED", reply: prior };
    }

    const contact = await database.prepare(`SELECT "businessId","channel","value" FROM "RevenueContactPoint" WHERE "id"=?`).bind(contactPointId).first<Record<string, unknown>>();
    if (!contact) return fail("OWNER_REPLY_CONTACT_UNKNOWN");
    if (contact.businessId !== businessId) return fail("OWNER_REPLY_CONTACT_SCOPE_INVALID");
    if (contact.channel !== "EMAIL") return fail("OWNER_REPLY_CONTACT_NOT_EMAIL");
    const contactFingerprint = await emailFingerprint(businessId, contact.value);
    const stopped = await database.prepare(`SELECT "businessId" FROM "RevenueBusinessStopEvent" WHERE "businessId"=?`).bind(businessId).first();
    if (stopped) return fail("OWNER_REPLY_BUSINESS_STOPPED");
    const suppressed = await database.prepare(`SELECT "suppressionId" FROM "RevenueContactSuppressionEvent"
      WHERE "businessId"=? AND "contactFingerprint"=?`).bind(businessId, contactFingerprint).first();
    if (suppressed) return fail("OWNER_REPLY_CONTACT_SUPPRESSED");

    const inserted = await database.prepare(`INSERT INTO "RevenueOwnerObservedReply"
      ("replyId","businessId","contactPointId","contactFingerprint","idempotencyKey","category","summary","observedAt","owner","actionText","dueAt","actorUserId","taskId")
      SELECT ?,?,?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS (
        SELECT 1 FROM "RevenueContactPoint" c WHERE c."id"=? AND c."businessId"=? AND c."channel"='EMAIL'
      ) AND NOT EXISTS (SELECT 1 FROM "RevenueBusinessStopEvent" s WHERE s."businessId"=?)
        AND NOT EXISTS (SELECT 1 FROM "RevenueContactSuppressionEvent" s WHERE s."businessId"=? AND s."contactFingerprint"=?)
      ON CONFLICT ("idempotencyKey") DO NOTHING`)
      .bind(replyId,businessId,contactPointId,contactFingerprint,idempotencyKey,category,summary,observedAt,input.owner,actionText,dueAt,actorUserId,taskId,
        contactPointId,businessId,businessId,businessId,contactFingerprint).run();
    const saved = await byKey(idempotencyKey);
    if (saved) {
      if (!matches(saved, normalized, replyId)) return fail("OWNER_REPLY_IDEMPOTENCY_CONFLICT");
      return { status: inserted.meta?.changes === 1 ? "CREATED" : "REPLAYED", reply: saved };
    }
    const nowStopped = await database.prepare(`SELECT "businessId" FROM "RevenueBusinessStopEvent" WHERE "businessId"=?`).bind(businessId).first();
    if (nowStopped) return fail("OWNER_REPLY_BUSINESS_STOPPED");
    const nowSuppressed = await database.prepare(`SELECT "suppressionId" FROM "RevenueContactSuppressionEvent"
      WHERE "businessId"=? AND "contactFingerprint"=?`).bind(businessId, contactFingerprint).first();
    if (nowSuppressed) return fail("OWNER_REPLY_CONTACT_SUPPRESSED");
    return fail("OWNER_REPLY_CREATE_NOT_ADMITTED");
  }

  async function listReplies(businessIdValue: string): Promise<RevenueObservedReply[]> {
    const businessId = text(businessIdValue, "businessId", 160);
    const rows = await database.prepare(`${select} WHERE r."businessId"=? ORDER BY r."createdAt" DESC,r."replyId" DESC LIMIT ${MAX_REPLIES}`)
      .bind(businessId).all<Record<string, unknown>>();
    return (rows.results ?? []).map(decode);
  }

  // Cancelled reply tasks remain visible in the business detail history, while
  // Today only contains actions the owner still intends to complete.
  async function listOpenReplies(): Promise<RevenueOpenObservedReply[]> {
    const rows = await database.prepare(`SELECT r."replyId",r."businessId",r."contactPointId",r."idempotencyKey",r."category",r."summary",r."observedAt",r."createdAt",
        r."taskId",t."owner",t."actionText",t."dueAt",t."actorUserId",e."outcome",e."actorUserId" AS "terminalActorUserId",
        e."note" AS "terminalNote",e."createdAt" AS "terminalCreatedAt",b."canonicalName" AS "businessName"
      FROM "RevenueOwnerObservedReply" r JOIN "RevenueOwnerTask" t ON t."taskId"=r."taskId"
      JOIN "RevenueBusiness" b ON b."id"=r."businessId"
      LEFT JOIN "RevenueOwnerTaskTerminalEvent" e ON e."taskId"=t."taskId"
      WHERE e."outcome" IS NULL ORDER BY t."dueAt" ASC,r."createdAt" DESC,r."replyId" DESC LIMIT ${MAX_REPLIES}`)
      .all<Record<string, unknown>>();
    return (rows.results ?? []).map((row) => ({ ...decode(row), businessName: rowText(row, "businessName") }));
  }

  return { createObservedReply, listReplies, listOpenReplies } as const;
}
