import { getDatabase, type D1DatabaseLike } from "@/lib/cloudflare";
import { z } from "zod";

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
  reason: "approved" | "approval_missing" | "approval_not_approved" | "approval_content_changed" | "approval_expired" | "approval_revoked" | "approval_invalid_time";
};

const approvalTimestamp = z.iso.datetime({ offset: true });

function parseApprovalTimestamp(value: string | null) {
  if (typeof value !== "string") return null;
  // SQLite CURRENT_TIMESTAMP is UTC but lacks a timezone suffix. Never interpret
  // that stored form in the host's local timezone; reject ambiguous ISO local time.
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
    ? `${value.replace(" ", "T")}Z` : value;
  if (!approvalTimestamp.safeParse(normalized).success) return null;
  const timestamp = Date.parse(normalized);
  return Number.isFinite(timestamp) ? timestamp : null;
}

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
  if (record.revokedAt !== null) return { allowed: false, reason: "approval_revoked" };
  if (record.decision !== "APPROVED" || !record.decidedAt) {
    return { allowed: false, reason: "approval_not_approved" };
  }
  if (record.contentDigest !== expectedDigest) {
    return { allowed: false, reason: "approval_content_changed" };
  }
  const nowMs = now.getTime();
  const decidedMs = parseApprovalTimestamp(record.decidedAt);
  const expiresMs = record.expiresAt === null ? null : parseApprovalTimestamp(record.expiresAt);
  if (!Number.isFinite(nowMs) || decidedMs === null || decidedMs > nowMs
    || (record.expiresAt !== null && (expiresMs === null || expiresMs <= decidedMs))) {
    return { allowed: false, reason: "approval_invalid_time" };
  }
  if (expiresMs !== null && expiresMs <= nowMs) {
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
      `SELECT "contentDigest", "decision", "decidedAt", "expiresAt", "revokedAt", "createdAt"
       FROM "OutreachApproval"
       WHERE "sequenceStepId" = ?
       ORDER BY CASE WHEN julianday("createdAt") IS NULL THEN 1 ELSE 0 END DESC,
         julianday("createdAt") DESC, rowid DESC
       LIMIT 1`,
    )
    .bind(content.sequenceStepId)
    .first<ApprovalRecord & { createdAt: string }>();

  if (record) {
    const createdMs = parseApprovalTimestamp(record.createdAt);
    const decidedMs = parseApprovalTimestamp(record.decidedAt);
    if (createdMs === null || createdMs > Date.now()
      || (decidedMs !== null && decidedMs < createdMs)) {
      return { allowed: false, contentDigest, reason: "approval_invalid_time" };
    }
  }

  return { ...evaluateOutreachApproval(record, contentDigest), contentDigest };
}
