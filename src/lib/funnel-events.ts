import { getDatabase } from "@/lib/cloudflare";

export const FUNNEL_POLICY_VERSION = "axiom-revenue-v2";

export type FunnelEventType =
  | "SCRAPE_JOB_CREATED"
  | "LEAD_DISCOVERED"
  | "OUTREACH_SENT"
  | "OUTREACH_FAILED"
  | "BOUNCE_DETECTED"
  | "REPLY_DETECTED"
  | "OPPORTUNITY_CREATED"
  | "DEAL_WON"
  | "DEAL_LOST";

export type RecordFunnelEventInput = {
  channel?: string | null;
  dedupeKey: string;
  eventType: FunnelEventType;
  leadId?: number | null;
  metadata?: Record<string, unknown> | null;
  occurredAt?: Date;
  outreachEmailId?: string | null;
  policyVersion?: string | null;
  score?: number | null;
  scrapeJobId?: string | null;
  scrapeTargetId?: string | null;
  sequenceId?: string | null;
  sequenceStepId?: string | null;
};

function safeMetadata(metadata: Record<string, unknown> | null | undefined) {
  if (!metadata) return null;

  try {
    return JSON.stringify(metadata);
  } catch {
    return JSON.stringify({ serializationError: true });
  }
}

/**
 * Appends one idempotent, non-blocking unit of funnel evidence. Callers choose
 * a stable dedupe key tied to the business action, not the scheduler attempt.
 */
export async function recordFunnelEvent(input: RecordFunnelEventInput) {
  const id = crypto.randomUUID();
  const occurredAt = input.occurredAt || new Date();
  return getDatabase()
    .prepare(
      `INSERT OR IGNORE INTO "FunnelEvent" (
        "id", "dedupeKey", "eventType", "leadId", "scrapeJobId", "scrapeTargetId",
        "sequenceId", "sequenceStepId", "outreachEmailId", "channel",
        "policyVersion", "score", "metadataJson", "occurredAt", "createdAt"
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      input.dedupeKey,
      input.eventType,
      input.leadId ?? null,
      input.scrapeJobId ?? null,
      input.scrapeTargetId ?? null,
      input.sequenceId ?? null,
      input.sequenceStepId ?? null,
      input.outreachEmailId ?? null,
      input.channel ?? null,
      input.policyVersion ?? FUNNEL_POLICY_VERSION,
      input.score ?? null,
      safeMetadata(input.metadata),
      occurredAt.toISOString(),
      new Date().toISOString(),
    )
    .run();
}
