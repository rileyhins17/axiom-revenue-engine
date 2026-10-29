import type { D1DatabaseLike } from "@/lib/cloudflare";

export type RevenueBusinessStopReason = "OWNER_DECISION" | "PROSPECT_REQUEST" | "OTHER";
export type RevenueBusinessStop = Readonly<{
  stopId: string;
  businessId: string;
  idempotencyKey: string;
  reason: RevenueBusinessStopReason;
  source: "OWNER_ACTION";
  note: string;
  actorUserId: string;
  createdAt: string;
}>;
export type CreateRevenueBusinessStopInput = Readonly<{
  businessId: string;
  idempotencyKey: string;
  reason: RevenueBusinessStopReason;
  source: "OWNER_ACTION";
  note: string;
  actorUserId: string;
}>;

function fail(code: string): never { throw new Error(code); }

function text(value: unknown, name: string, maxLength: number): string {
  if (typeof value !== "string" || value.length < 1 || value.length > maxLength || value.trim() !== value || /[\u0000-\u001f\u007f]/.test(value)) {
    return fail(`${name}_INVALID`);
  }
  return value;
}

function timestamp(value: unknown): string {
  if (typeof value !== "string" || value.length > 40 ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) || !Number.isFinite(Date.parse(value))) {
    return fail("BUSINESS_STOP_CREATED_AT_INVALID");
  }
  return value;
}

function decodeStop(row: Record<string, unknown>): RevenueBusinessStop {
  const stopId = text(row.stopId, "stopId", 400);
  const businessId = text(row.businessId, "businessId", 160);
  const idempotencyKey = text(row.idempotencyKey, "idempotencyKey", 160);
  const reason = row.reason;
  if (reason !== "OWNER_DECISION" && reason !== "PROSPECT_REQUEST" && reason !== "OTHER") return fail("BUSINESS_STOP_REASON_INVALID");
  if (row.source !== "OWNER_ACTION") return fail("BUSINESS_STOP_SOURCE_INVALID");
  const note = text(row.note, "note", 500);
  const actorUserId = text(row.actorUserId, "actorUserId", 160);
  const createdAt = timestamp(row.createdAt);
  return { stopId, businessId, idempotencyKey, reason, source: "OWNER_ACTION", note, actorUserId, createdAt };
}

export function createRevenueBusinessStopD1Boundary(database: Pick<D1DatabaseLike, "prepare">) {
  async function createStop(input: CreateRevenueBusinessStopInput): Promise<Readonly<{ stopId: string; stop: RevenueBusinessStop; status: "CREATED" | "REPLAYED" }>> {
    const businessId = text(input.businessId, "businessId", 160);
    const idempotencyKey = text(input.idempotencyKey, "idempotencyKey", 160);
    if (input.reason !== "OWNER_DECISION" && input.reason !== "PROSPECT_REQUEST" && input.reason !== "OTHER") return fail("reason_INVALID");
    if (input.source !== "OWNER_ACTION") return fail("source_INVALID");
    const note = text(input.note, "note", 500);
    const actorUserId = text(input.actorUserId, "actorUserId", 160);
    const stopId = `business-stop:${idempotencyKey}`;

    const inserted = await database.prepare(`INSERT INTO "RevenueBusinessStopEvent"
      ("stopId","businessId","idempotencyKey","reason","source","note","actorUserId")
      SELECT ?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM "RevenueBusiness" WHERE "id"=?)
      ON CONFLICT DO NOTHING`).bind(stopId, businessId, idempotencyKey, input.reason, "OWNER_ACTION", note, actorUserId, businessId).run();

    // Read by key first: an exact replay is valid even when a different stop
    // already exists for the business, while a reused key must never disclose it.
    const keyed = await database.prepare(`SELECT "stopId","businessId","idempotencyKey","reason","source","note","actorUserId","createdAt"
      FROM "RevenueBusinessStopEvent" WHERE "idempotencyKey"=?`).bind(idempotencyKey).first<Record<string, unknown>>();
    if (keyed) {
      const saved = decodeStop(keyed);
      if (saved.stopId !== stopId || saved.businessId !== businessId || saved.reason !== input.reason || saved.source !== "OWNER_ACTION" ||
          saved.note !== note || saved.actorUserId !== actorUserId) return fail("BUSINESS_STOP_IDEMPOTENCY_CONFLICT");
      return { stopId: saved.stopId, stop: saved, status: inserted.meta?.changes === 1 ? "CREATED" : "REPLAYED" };
    }

    const business = await database.prepare(`SELECT "id" FROM "RevenueBusiness" WHERE "id"=?`).bind(businessId).first();
    if (!business) return fail("BUSINESS_STOP_BUSINESS_UNKNOWN");
    const existing = await database.prepare(`SELECT "businessId" FROM "RevenueBusinessStopEvent" WHERE "businessId"=?`).bind(businessId).first<Record<string, unknown>>();
    if (existing) return fail("BUSINESS_STOP_ALREADY_EXISTS");
    return fail("BUSINESS_STOP_CREATE_NOT_ADMITTED");
  }

  async function getStop(businessIdValue: string): Promise<RevenueBusinessStop | null> {
    const businessId = text(businessIdValue, "businessId", 160);
    const row = await database.prepare(`SELECT "stopId","businessId","idempotencyKey","reason","source","note","actorUserId","createdAt"
      FROM "RevenueBusinessStopEvent" WHERE "businessId"=?`).bind(businessId).first<Record<string, unknown>>();
    if (!row) return null;
    const stop = decodeStop(row);
    if (stop.businessId !== businessId) return fail("BUSINESS_STOP_READ_IDENTITY_INVALID");
    return stop;
  }

  async function listStopsForBusinessIds(businessIdValues: readonly string[]): Promise<Map<string, RevenueBusinessStop>> {
    if (!Array.isArray(businessIdValues) || businessIdValues.length > 100) return fail("businessIds_INVALID");
    const businessIds = businessIdValues.map((value) => text(value, "businessId", 160));
    if (new Set(businessIds).size !== businessIds.length) return fail("businessIds_INVALID");
    const stops = new Map<string, RevenueBusinessStop>();
    if (businessIds.length === 0) return stops;
    const placeholders = businessIds.map(() => "?").join(",");
    const rows = await database.prepare(`SELECT "stopId","businessId","idempotencyKey","reason","source","note","actorUserId","createdAt"
      FROM "RevenueBusinessStopEvent" WHERE "businessId" IN (${placeholders})`).bind(...businessIds).all<Record<string, unknown>>();
    const allowed = new Set(businessIds);
    for (const row of rows.results ?? []) {
      const stop = decodeStop(row);
      if (!allowed.has(stop.businessId) || stops.has(stop.businessId)) return fail("BUSINESS_STOP_READ_IDENTITY_INVALID");
      stops.set(stop.businessId, stop);
    }
    return stops;
  }

  return { createStop, getStop, listStopsForBusinessIds } as const;
}
