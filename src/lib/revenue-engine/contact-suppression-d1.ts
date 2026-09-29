import type { D1DatabaseLike } from "@/lib/cloudflare";

export type RevenueContactSuppressionReason = "UNSUBSCRIBE" | "COMPLAINT" | "BOUNCE";
export type RevenueContactSuppression = Readonly<{
  suppressionId: string;
  businessId: string;
  contactPointId: string;
  idempotencyKey: string;
  reason: RevenueContactSuppressionReason;
  note: string;
  actorUserId: string;
  observedAt: string;
  createdAt: string;
}>;
export type CreateRevenueContactSuppressionInput = Readonly<{
  businessId: string;
  contactPointId: string;
  idempotencyKey: string;
  reason: RevenueContactSuppressionReason;
  note: string;
  actorUserId: string;
  observedAt: string;
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
    return fail("CONTACT_SUPPRESSION_OBSERVED_AT_INVALID");
  }
  return value;
}

function normalizeContact(channelValue: unknown, contactValue: unknown): string {
  if (typeof channelValue !== "string" || typeof contactValue !== "string" || !channelValue.trim() || !contactValue.trim()) {
    return fail("CONTACT_SUPPRESSION_CONTACT_INVALID");
  }
  const channel = channelValue.trim().toUpperCase();
  const value = contactValue.trim();
  if (channel === "EMAIL") return `${channel}:${value.toLowerCase()}`;
  if (channel === "PHONE") {
    const digits = value.replace(/\D/g, "");
    if (!digits) return fail("CONTACT_SUPPRESSION_CONTACT_INVALID");
    return `${channel}:${digits}`;
  }
  return `${channel}:${value.toLowerCase()}`;
}

async function contactFingerprint(businessId: string, channel: unknown, value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(`${businessId}\u0000${normalizeContact(channel, value)}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function decode(row: Record<string, unknown>): RevenueContactSuppression {
  const suppressionId = text(row.suppressionId, "suppressionId", 400);
  const businessId = text(row.businessId, "businessId", 160);
  const contactPointId = text(row.contactPointId, "contactPointId", 160);
  const idempotencyKey = text(row.idempotencyKey, "idempotencyKey", 160);
  const reason = row.reason;
  if (reason !== "UNSUBSCRIBE" && reason !== "COMPLAINT" && reason !== "BOUNCE") return fail("CONTACT_SUPPRESSION_REASON_INVALID");
  const note = text(row.note, "note", 300);
  const actorUserId = text(row.actorUserId, "actorUserId", 160);
  const observedAt = timestamp(row.observedAt);
  const createdAt = timestamp(row.createdAt);
  return { suppressionId, businessId, contactPointId, idempotencyKey, reason, note, actorUserId, observedAt, createdAt };
}

const columns = `"suppressionId","businessId","contactPointId","idempotencyKey","reason","note","actorUserId","observedAt","createdAt"`;

export function createRevenueContactSuppressionD1Boundary(database: Pick<D1DatabaseLike, "prepare">) {
  async function createSuppression(input: CreateRevenueContactSuppressionInput): Promise<Readonly<{
    suppressionId: string;
    suppression: RevenueContactSuppression;
    status: "CREATED" | "REPLAYED";
  }>> {
    const businessId = text(input.businessId, "businessId", 160);
    const contactPointId = text(input.contactPointId, "contactPointId", 160);
    const idempotencyKey = text(input.idempotencyKey, "idempotencyKey", 160);
    if (input.reason !== "UNSUBSCRIBE" && input.reason !== "COMPLAINT" && input.reason !== "BOUNCE") return fail("reason_INVALID");
    const note = text(input.note, "note", 300);
    const actorUserId = text(input.actorUserId, "actorUserId", 160);
    const observedAt = timestamp(input.observedAt);
    const suppressionId = `contact-suppression:${idempotencyKey}`;

    const prior = await database.prepare(`SELECT ${columns} FROM "RevenueContactSuppressionEvent" WHERE "idempotencyKey"=?`)
      .bind(idempotencyKey).first<Record<string, unknown>>();
    if (prior) {
      const saved = decode(prior);
      if (saved.suppressionId !== suppressionId || saved.businessId !== businessId || saved.contactPointId !== contactPointId ||
          saved.reason !== input.reason || saved.note !== note || saved.actorUserId !== actorUserId || saved.observedAt !== observedAt) {
        return fail("CONTACT_SUPPRESSION_IDEMPOTENCY_CONFLICT");
      }
      return { suppressionId, suppression: saved, status: "REPLAYED" };
    }

    const contact = await database.prepare(`SELECT "businessId","channel","value" FROM "RevenueContactPoint" WHERE "id"=?`)
      .bind(contactPointId).first<Record<string, unknown>>();
    if (!contact) return fail("CONTACT_SUPPRESSION_CONTACT_UNKNOWN");
    if (contact.businessId !== businessId) return fail("CONTACT_SUPPRESSION_SCOPE_INVALID");
    const fingerprint = await contactFingerprint(businessId, contact.channel, contact.value);

    const inserted = await database.prepare(`INSERT INTO "RevenueContactSuppressionEvent"
      ("suppressionId","businessId","contactPointId","contactFingerprint","idempotencyKey","reason","note","actorUserId","observedAt")
      SELECT ?,?,?,?,?,?,?,?,? WHERE EXISTS (
        SELECT 1 FROM "RevenueContactPoint" WHERE "id"=? AND "businessId"=? AND "channel"=? AND "value"=?
      ) ON CONFLICT DO NOTHING`)
      .bind(suppressionId, businessId, contactPointId, fingerprint, idempotencyKey, input.reason, note, actorUserId, observedAt,
        contactPointId, businessId, contact.channel, contact.value).run();

    // Resolve the exact key before checking scope/uniqueness so only a complete
    // byte-for-byte command replay can return the prior event.
    const keyed = await database.prepare(`SELECT ${columns} FROM "RevenueContactSuppressionEvent" WHERE "idempotencyKey"=?`)
      .bind(idempotencyKey).first<Record<string, unknown>>();
    if (keyed) {
      const saved = decode(keyed);
      if (saved.suppressionId !== suppressionId || saved.businessId !== businessId || saved.contactPointId !== contactPointId ||
          saved.reason !== input.reason || saved.note !== note || saved.actorUserId !== actorUserId || saved.observedAt !== observedAt) {
        return fail("CONTACT_SUPPRESSION_IDEMPOTENCY_CONFLICT");
      }
      return { suppressionId, suppression: saved, status: inserted.meta?.changes === 1 ? "CREATED" : "REPLAYED" };
    }

    const existing = await database.prepare(`SELECT "contactPointId" FROM "RevenueContactSuppressionEvent"
      WHERE "businessId"=? AND "contactFingerprint"=?`).bind(businessId, fingerprint).first();
    if (existing) return fail("CONTACT_SUPPRESSION_ALREADY_EXISTS");
    return fail("CONTACT_SUPPRESSION_CREATE_NOT_ADMITTED");
  }

  async function getSuppression(businessIdValue: string, contactPointIdValue: string): Promise<RevenueContactSuppression | null> {
    const businessId = text(businessIdValue, "businessId", 160);
    const contactPointId = text(contactPointIdValue, "contactPointId", 160);
    const contact = await database.prepare(`SELECT "businessId","channel","value" FROM "RevenueContactPoint" WHERE "id"=?`)
      .bind(contactPointId).first<Record<string, unknown>>();
    if (!contact) return null;
    if (contact.businessId !== businessId) return fail("CONTACT_SUPPRESSION_READ_SCOPE_INVALID");
    const fingerprint = await contactFingerprint(businessId, contact.channel, contact.value);
    const row = await database.prepare(`SELECT ${columns} FROM "RevenueContactSuppressionEvent" WHERE "businessId"=? AND "contactFingerprint"=?`)
      .bind(businessId, fingerprint).first<Record<string, unknown>>();
    if (!row) return null;
    const suppression = decode(row);
    if (suppression.businessId !== businessId) return fail("CONTACT_SUPPRESSION_READ_SCOPE_INVALID");
    return suppression;
  }

  return { createSuppression, getSuppression } as const;
}
