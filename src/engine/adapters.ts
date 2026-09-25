import type { DeterministicWebsiteAuditResult } from "@/lib/revenue-engine/website-audit";
import type { WebsiteCaptureResult } from "@/lib/revenue-engine/website-capture";
import type {
  RevenueContactDiscoveryRequest,
  RevenueContactDiscoveryResult,
} from "@/lib/revenue-engine/contact-discovery";
import type {
  RevenueContactVerificationRequest,
  RevenueContactVerificationResult,
} from "@/lib/revenue-engine/contact-verification";

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

export interface AuditAdapter {
  audit(input: AdapterContext & {
    businessId: string;
    businessName: string;
    niche: string;
    expectedServices: string[];
    expectedLocations: string[];
    sourceEvidenceUrl: string;
    websiteUrl: string | null;
    auditVersion: string;
  }): Promise<AdapterResult<DeterministicWebsiteAuditResult>>;
}

export interface WebsiteCaptureAdapter {
  capture(input: AdapterContext & {
    businessId: string;
    websiteUrl: string;
  }): Promise<AdapterResult<WebsiteCaptureResult>>;
}

export interface ContactAdapter {
  discover(input: AdapterContext & { request: RevenueContactDiscoveryRequest }): Promise<AdapterResult<RevenueContactDiscoveryResult>>;
}

export interface VerificationAdapter {
  verify(input: AdapterContext & { request: RevenueContactVerificationRequest }): Promise<AdapterResult<RevenueContactVerificationResult>>;
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
