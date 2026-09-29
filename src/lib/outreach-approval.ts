import { getDatabase, type D1DatabaseLike } from "@/lib/cloudflare";

export type OutreachApprovalContent = {
  bodyHtml: string;
  bodyPlain: string;
  campaignKey: string | null;
  leadId: number;
  messagePolicyVersion: string | null;
  recipientEmail: string;
  sequenceId: string;
  sequenceStepId: string;
  subject: string;
  variantKey: string | null;
};

type ApprovalRecord = {
  contentDigest: string;
  decision: string;
  decidedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
};

export type ApprovalGateResult = {
  allowed: boolean;
  contentDigest: string;
  reason: "approved" | "approval_missing" | "approval_not_approved" | "approval_content_changed" | "approval_expired" | "approval_revoked";
};

function canonicalize(value: string) {
  return value.replace(/\r\n/g, "\n").trim();
}

export async function buildOutreachContentDigest(content: OutreachApprovalContent) {
  const canonical = JSON.stringify({
    bodyHtml: canonicalize(content.bodyHtml),
    bodyPlain: canonicalize(content.bodyPlain),
    campaignKey: content.campaignKey || null,
    leadId: content.leadId,
    messagePolicyVersion: content.messagePolicyVersion || null,
    recipientEmail: content.recipientEmail.trim().toLowerCase(),
    sequenceId: content.sequenceId,
    sequenceStepId: content.sequenceStepId,
    subject: canonicalize(content.subject),
    variantKey: content.variantKey || null,
  });
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function evaluateOutreachApproval(
  record: ApprovalRecord | null,
  expectedDigest: string,
  now = new Date(),
): Omit<ApprovalGateResult, "contentDigest"> {
  if (!record) return { allowed: false, reason: "approval_missing" };
  if (record.revokedAt) return { allowed: false, reason: "approval_revoked" };
  if (record.decision !== "APPROVED" || !record.decidedAt) {
    return { allowed: false, reason: "approval_not_approved" };
  }
  if (record.contentDigest !== expectedDigest) {
    return { allowed: false, reason: "approval_content_changed" };
  }
  if (record.expiresAt && new Date(record.expiresAt).getTime() <= now.getTime()) {
    return { allowed: false, reason: "approval_expired" };
  }
  return { allowed: true, reason: "approved" };
}

export async function requireOutreachApproval(
  content: OutreachApprovalContent,
  database: D1DatabaseLike = getDatabase(),
): Promise<ApprovalGateResult> {
  const contentDigest = await buildOutreachContentDigest(content);
  const record = await database
    .prepare(
      `SELECT "contentDigest", "decision", "decidedAt", "expiresAt", "revokedAt"
       FROM "OutreachApproval"
       WHERE "sequenceStepId" = ?
       ORDER BY "createdAt" DESC, "id" DESC
       LIMIT 1`,
    )
    .bind(content.sequenceStepId)
    .first<ApprovalRecord>();

  return { ...evaluateOutreachApproval(record, contentDigest), contentDigest };
}
