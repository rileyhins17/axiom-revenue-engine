import type { EvidenceClaim } from "@/lib/revenue-engine/evidence";

export type AdapterCostReceipt = {
  provider: string;
  operation: string;
  externalRequestId: string | null;
  costUsd: number;
  units: number;
};

export type AdapterContext = {
  workflowId: string;
  idempotencyKey: string;
  requestedAt: string;
  remainingBudgetUsd: number;
};

export type AdapterResult<T> = {
  data: T;
  cost: AdapterCostReceipt;
};

export type SourceBusinessRecord = {
  sourceRecordId: string;
  businessName: string;
  sourceUrl: string;
  websiteUrl: string | null;
  phone: string | null;
  address: string | null;
  city: string;
  niche: string;
};

export interface SourceAdapter {
  discover(input: AdapterContext & {
    coverageKey: string;
    cursor: string | null;
    limit: number;
  }): Promise<AdapterResult<{
    records: SourceBusinessRecord[];
    nextCursor: string | null;
    exhausted: boolean;
  }>>;
}

export type WebsiteAuditResult = {
  businessId: string;
  auditVersion: string;
  classification: "REBUILD" | "NO_SITE_NEW_BUILD" | "MINOR_IMPROVEMENT" | "NO_OPPORTUNITY";
  claims: EvidenceClaim[];
  desktopArtifactRef: string | null;
  mobileArtifactRef: string | null;
};

export interface AuditAdapter {
  audit(input: AdapterContext & {
    businessId: string;
    websiteUrl: string | null;
    auditVersion: string;
  }): Promise<AdapterResult<WebsiteAuditResult>>;
}

export type ContactCandidate = {
  channel: "EMAIL" | "PHONE" | "FORM" | "SOCIAL";
  value: string;
  label: string | null;
  evidenceUrl: string;
  capturedAt: string;
};

export interface ContactAdapter {
  discover(input: AdapterContext & {
    businessId: string;
    websiteUrl: string | null;
  }): Promise<AdapterResult<{ contacts: ContactCandidate[] }>>;
}

export type EmailVerificationResult = {
  address: string;
  status: "DELIVERABLE" | "UNDELIVERABLE" | "RISKY" | "UNKNOWN";
  checkedAt: string;
  staleAt: string;
  providerReceiptId: string | null;
};

export interface VerificationAdapter {
  verify(input: AdapterContext & { address: string }): Promise<AdapterResult<EmailVerificationResult>>;
}

export type ApprovedEmailDraft = {
  draftId: string;
  mailboxId: string;
  recipient: string;
  subject: string;
  plainTextBody: string;
  evidenceClaimIds: string[];
  policyVersion: string;
  approvedAt: string;
};

export interface MailboxAdapter {
  createDraft(input: AdapterContext & ApprovedEmailDraft): Promise<AdapterResult<{ providerDraftId: string }>>;
  sendApproved(input: AdapterContext & {
    draft: ApprovedEmailDraft;
    approvalId: string;
  }): Promise<AdapterResult<{ providerMessageId: string; sentAt: string }>>;
  syncReplies(input: AdapterContext & {
    mailboxId: string;
    cursor: string | null;
  }): Promise<AdapterResult<{ messageIds: string[]; nextCursor: string | null }>>;
  health(input: AdapterContext & { mailboxId: string }): Promise<AdapterResult<{
    connected: boolean;
    canSend: boolean;
    reason: string | null;
  }>>;
}
