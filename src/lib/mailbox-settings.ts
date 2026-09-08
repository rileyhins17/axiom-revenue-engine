import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { D1DatabaseLike } from "./cloudflare";
import { policyPlaceholders, readOperatorOwnerPolicy } from "./operator-owner-policy";

const timezone = z.string().min(1).max(100).refine((value) => {
  if (!/^[A-Za-z_]+(?:\/[A-Za-z0-9_+\-]+)*$/.test(value)) return false;
  try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; }
  catch { return false; }
});

// Capacity/delay values are derived by ensureMailboxForConnection, not owner
// overrides. Lifecycle/connection changes have separate reviewed workflows.
const settingsSchema = z.strictObject({
  label: z.string().trim().min(1).max(80).nullable().optional(),
  timezone: timezone.optional(),
}).refine((value) => Object.values(value).some((entry) => entry !== undefined));

export class InvalidMailboxSettings extends Error {
  constructor() { super("Invalid mailbox settings"); }
}

export async function updateMailboxSettings(
  database: D1DatabaseLike,
  actor: { userId: string; sessionId: string },
  mailboxId: string,
  input: unknown,
) {
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success || !mailboxId || mailboxId.length > 200) throw new InvalidMailboxSettings();
  if (!database.batch) throw new Error("Atomic mailbox settings are unavailable");
  const policy = readOperatorOwnerPolicy();
  const fields = (["label", "timezone"] as const).filter((key) => parsed.data[key] !== undefined);
  const values = fields.map((key) => parsed.data[key]!);
  const actorGuard = `EXISTS (SELECT 1 FROM "Session" s JOIN "User" actor ON actor."id"=s."userId"
    WHERE s."id"=? AND actor."id"=? AND actor."role"='admin'
      AND COALESCE(actor."banned",0)=0 AND actor."emailVerified"=1
      AND lower(actor."email") IN (${policyPlaceholders(policy.adminEmails)})
      AND julianday(s."expiresAt") > julianday('now'))`;
  const actorValues = [actor.sessionId, actor.userId, ...policy.adminEmails];
  const auditId = randomUUID();
  const results = await database.batch([
    database.prepare(`UPDATE "OutreachMailbox" SET ${fields.map((key) => `"${key}"=?`).join(",")},
      "updatedAt"=datetime('now') WHERE "id"=? AND ${actorGuard}
      AND (${fields.map((key) => `"${key}" IS NOT ?`).join(" OR ")}) RETURNING "id"`)
      .bind(...values, mailboxId, ...actorValues, ...values),
    database.prepare(`INSERT INTO "AuditEvent" ("id","actorUserId","action","targetType","targetId","metadata")
      SELECT ?,?,'mailbox.settings.updated','OutreachMailbox',?,? WHERE changes()=1 RETURNING "id"`)
      .bind(auditId, actor.userId, mailboxId, JSON.stringify({ changedFields: fields })),
    database.prepare(`SELECT * FROM "OutreachMailbox" WHERE "id"=? AND ${actorGuard}`)
      .bind(mailboxId, ...actorValues),
  ]);
  if (results[0]?.results?.length && results[1]?.results?.[0]?.id !== auditId) {
    throw new Error("Mailbox audit result unavailable");
  }
  return results[2]?.results?.[0] ?? null;
}
