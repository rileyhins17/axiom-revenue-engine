import { getDatabase } from "@/lib/cloudflare";

type AuditEventInput = {
  action: string;
  actorUserId?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  ipAddress?: string | null;
  metadata?: Record<string, unknown> | null;
};

export async function writeAuditEvent(input: AuditEventInput): Promise<void> {
  try {
    await getDatabase().prepare(`INSERT INTO "AuditEvent" ("id","actorUserId","action","targetType","targetId","ipAddress","metadata") VALUES (?,?,?,?,?,?,?)`)
      .bind(
        crypto.randomUUID(),
        input.actorUserId ?? null,
        input.action,
        input.targetType ?? null,
        input.targetId ?? null,
        input.ipAddress ?? null,
        input.metadata ? JSON.stringify(input.metadata) : null,
      )
      .run();
  } catch (error) {
    console.error("[AUDIT_WRITE_FAILED]", error);
  }
}
