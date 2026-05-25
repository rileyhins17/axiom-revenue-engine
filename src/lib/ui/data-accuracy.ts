import { isAdequateAutonomousLead } from "@/lib/automation-policy";
import {
  BLOCKED_ROLE_LOCAL_PARTS,
  isLeadOutreachEligible,
  OWNER_EMAIL_MIN_CONFIDENCE,
  STAFF_EMAIL_MIN_CONFIDENCE,
} from "@/lib/lead-qualification";

export const SENDABLE_MAILBOX_STATUSES = ["ACTIVE", "WARMING"] as const;

export function startOfUtcDay(date: Date = new Date()): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0));
}

export function sqlDateTime(date: Date): string {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

export function adequateLeadWhereClause(scoreParameter = "?") {
  const localPart = `LOWER(substr(trim("email"), 1, instr(trim("email"), '@') - 1))`;
  const blockedLocalParts = Array.from(BLOCKED_ROLE_LOCAL_PARTS)
    .map((part) => `'${part.replaceAll("'", "''")}'`)
    .join(", ");

  return `"axiomScore" >= ${scoreParameter}
         AND (
           (LOWER(COALESCE("emailType",'')) = 'owner' AND COALESCE("emailConfidence", 0) >= ${OWNER_EMAIL_MIN_CONFIDENCE})
           OR (LOWER(COALESCE("emailType",'')) = 'staff' AND COALESCE("emailConfidence", 0) >= ${STAFF_EMAIL_MIN_CONFIDENCE})
         )
         AND COALESCE("email",'') != ''
         AND LOWER(COALESCE("emailFlags",'')) NOT LIKE '%bounced%'
         AND LOWER(COALESCE("emailFlags",'')) NOT LIKE '%no_mx%'
         AND LOWER(COALESCE("emailFlags",'')) NOT LIKE '%generic_prefix%'
         AND ${localPart} NOT IN (${blockedLocalParts})
         AND ${localPart} NOT GLOB 'info.*'
         AND ${localPart} NOT GLOB 'contact.*'
         AND ${localPart} NOT GLOB 'sales.*'
         AND ${localPart} NOT GLOB 'office.*'
         AND ${localPart} NOT GLOB 'support.*'
         AND COALESCE("isArchived", 0) = 0`;
}

export function isAdequateAutonomousLeadRow(
  lead: Parameters<typeof isAdequateAutonomousLead>[0] & Parameters<typeof isLeadOutreachEligible>[0],
) {
  return isAdequateAutonomousLead(lead) && isLeadOutreachEligible(lead);
}

export function calculateReplyRate(sent: number, replied: number): number {
  if (!Number.isFinite(sent) || sent <= 0) return 0;
  return Math.round((Math.max(0, replied) / sent) * 100);
}

export function isSendableMailbox(mailbox: {
  gmailConnectionId?: string | null;
  status?: string | null;
}) {
  return Boolean(
    mailbox.gmailConnectionId &&
      SENDABLE_MAILBOX_STATUSES.includes(mailbox.status as (typeof SENDABLE_MAILBOX_STATUSES)[number]),
  );
}

export function resolveGlobalDailySendCap(options: {
  envCap?: number | null;
  mailboxCaps: Array<number | null | undefined>;
  fallbackPerMailboxCap: number;
  expectedMailboxCount?: number;
}): number {
  if (typeof options.envCap === "number" && Number.isFinite(options.envCap) && options.envCap > 0) {
    return options.envCap;
  }

  const mailboxCapTotal = options.mailboxCaps.reduce<number>((sum, cap) => {
    const numeric = Number(cap || 0);
    return sum + (Number.isFinite(numeric) && numeric > 0 ? numeric : 0);
  }, 0);
  if (mailboxCapTotal > 0) return mailboxCapTotal;

  return options.fallbackPerMailboxCap * Math.max(1, options.expectedMailboxCount ?? 1);
}

export type MilestoneSignals = {
  dealStage: string | null | undefined;
  proposalSentAt?: Date | string | null;
  signedAt?: Date | string | null;
  projectStartDate?: Date | string | null;
  deliveredAt?: Date | string | null;
  retainedAt?: Date | string | null;
};

export function getProjectMilestoneChecks(signals: MilestoneSignals) {
  return {
    proposal: Boolean(signals.proposalSentAt),
    signed: Boolean(signals.signedAt),
    kickoff: false,
    started: Boolean(signals.projectStartDate),
    review: false,
    delivered: Boolean(signals.deliveredAt || signals.dealStage === "DELIVERED"),
    retained: Boolean(signals.retainedAt || signals.dealStage === "RETAINED"),
  };
}
