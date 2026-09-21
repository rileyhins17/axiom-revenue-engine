import { createHash } from "node:crypto";

import { z } from "zod";

import {
  type PrivateKwImportPlan,
  PrivateKwImportPlanSchema,
} from "@/lib/revenue-engine/private-kw-import";
import {
  type PrivateKwPersistencePlan,
  buildPrivateKwPersistencePlan,
} from "@/lib/revenue-engine/private-kw-persistence-plan";
import {
  type PrivateKwShadowSliceManifest,
  PrivateKwShadowSliceManifestSchema,
} from "@/lib/revenue-engine/private-kw-shadow-slice";

export const PRIVATE_KW_M2_RESEARCH_PACKET_VERSION = "kw-m2-research-packet-v1";
export const PRIVATE_KW_M2_EXECUTION_AUTHORIZATION_VERSION = "kw-m2-execution-authorization-v1";
export const PRIVATE_KW_M2_ASSESSMENT_MAPPING_POLICY_VERSION = "kw-m2-assessment-mapping-policy-v1";
export const PRIVATE_KW_M2_OWNER_APPROVAL_VERSION = "kw-m2-owner-approval-v1";
export const PRIVATE_KW_M2_DATABASE_RECEIPT_VERSION = "kw-m2-database-receipt-v1";

const TimestampSchema = z.string().datetime({ offset: true });
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const AuthoritySchema = z.object({
  liveSourceAuthorized: z.literal(false),
  browserCaptureAuthorized: z.literal(false),
  artifactStorageAuthorized: z.literal(false),
  databaseMutationAuthorized: z.literal(false),
  contactDiscoveryExecutionAuthorized: z.literal(false),
  contactVerificationExecutionAuthorized: z.literal(false),
  consentDecisionAuthorized: z.literal(false),
  qualificationAuthorized: z.literal(false),
  mailboxSyncAuthorized: z.literal(false),
  outreachAuthorized: z.literal(false),
  sendAuthorized: z.literal(false),
  deploymentAuthorized: z.literal(false),
  providerOperationsAuthorized: z.literal(0),
  costAuthorizedUsd: z.literal(0),
}).strict();

export type PrivateKwM2Authority = z.infer<typeof AuthoritySchema>;

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right, "en-CA"))
        .map(([key, child]) => [key, canonicalValue(child)]),
    );
  }
  return value;
}

export function privateKwM2Digest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(canonicalValue(value))).digest("hex");
}

const ResearchCandidateSchema = z.object({
  businessId: z.string().trim().min(1).max(128),
  evaluationCandidateId: z.string().trim().min(1).max(128),
  businessName: z.string().trim().min(1).max(256),
  city: z.enum(["KITCHENER", "WATERLOO", "CAMBRIDGE"]),
  niche: z.enum(["ROOFING", "HVAC", "LANDSCAPING"]),
  websiteUrl: z.string().url().nullable(),
  sourceEvidenceUrl: z.string().url(),
  sourceMethod: z.literal("MANUAL_RESEARCH"),
  sourceCapturedAt: TimestampSchema,
  sourceReviewedAt: TimestampSchema,
  independenceStatus: z.literal("INDEPENDENT"),
  sourceRights: z.literal("PUBLIC_SOURCE_REVIEWED"),
  termsDecision: z.literal("PUBLIC_REVIEW_ONLY"),
  robotsDecision: z.literal("PREFLIGHT_REQUIRED_BEFORE_FETCH"),
  evidenceRetention: z.enum(["RAW_HTML_ALLOWED", "DERIVED_FACTS_ONLY", "BLOCKED"]),
  retentionReviewDate: TimestampSchema,
  stopConditions: z.array(z.enum([
    "AMBIGUOUS_IDENTITY",
    "ROBOTS_OR_TERMS_UNCLEAR",
    "SOURCE_RIGHTS_UNCLEAR",
    "PERSONAL_DATA_DOMINANT",
    "STALE_EVIDENCE",
    "OUT_OF_SCOPE",
    "RETENTION_NOT_ALLOWED",
  ])).min(1).max(7),
}).strict();

const ResearchOwnerReviewSchema = z.object({
  state: z.literal("PENDING_OWNER_REVIEW"),
  reviewedBy: z.null(),
  reviewedAt: z.null(),
  rationale: z.string().trim().min(10).max(500),
}).strict();

const CountSummarySchema = z.object({
  selectedBusinesses: z.literal(10),
  countsByCity: z.object({
    KITCHENER: z.number().int().min(2).max(10),
    WATERLOO: z.number().int().min(2).max(10),
    CAMBRIDGE: z.number().int().min(2).max(10),
  }).strict(),
  countsByNiche: z.object({
    ROOFING: z.number().int().min(2).max(10),
    HVAC: z.number().int().min(2).max(10),
    LANDSCAPING: z.number().int().min(2).max(10),
  }).strict(),
}).strict();

export const PrivateKwM2ResearchPacketSchema = z.object({
  packetVersion: z.literal(PRIVATE_KW_M2_RESEARCH_PACKET_VERSION),
  packetId: z.string().regex(/^kw-m2-research:[a-f0-9]{64}$/),
  packetDigest: Sha256Schema,
  manifestId: z.string().regex(/^kw-shadow-slice:[a-f0-9]{64}$/),
  manifestDigest: Sha256Schema,
  sourceImportId: z.string().trim().min(8).max(128),
  sourcePlanDigest: Sha256Schema,
  createdAt: TimestampSchema,
  candidates: z.array(ResearchCandidateSchema).length(10),
  summary: CountSummarySchema,
  ownerReview: ResearchOwnerReviewSchema,
  authority: AuthoritySchema,
}).strict().superRefine((packet, context) => {
  const { packetId: _packetId, packetDigest: _packetDigest, ...core } = packet;
  void _packetId;
  void _packetDigest;
  const expected = privateKwM2Digest(core);
  if (packet.packetDigest !== expected || packet.packetId !== `kw-m2-research:${expected}`) {
    context.addIssue({ code: "custom", path: ["packetDigest"], message: "Research packet identity must bind its exact contents." });
  }
  const businessIds = new Set(packet.candidates.map((candidate) => candidate.businessId));
  const candidateIds = new Set(packet.candidates.map((candidate) => candidate.evaluationCandidateId));
  if (businessIds.size !== 10 || candidateIds.size !== 10) {
    context.addIssue({ code: "custom", path: ["candidates"], message: "Research packet candidate identities must be unique." });
  }
  const capturedAt = packet.candidates.map((candidate) => Date.parse(candidate.sourceCapturedAt));
  const reviewedAt = packet.candidates.map((candidate) => Date.parse(candidate.sourceReviewedAt));
  if (capturedAt.some((value, index) => value > reviewedAt[index]! || reviewedAt[index]! > Date.parse(packet.createdAt))) {
    context.addIssue({ code: "custom", path: ["candidates"], message: "Source evidence must be reviewed before packet creation." });
  }
  if (packet.candidates.some((candidate) => Date.parse(candidate.retentionReviewDate) < Date.parse(packet.createdAt))) {
    context.addIssue({ code: "custom", path: ["candidates"], message: "Retention review dates must remain current at packet creation." });
  }
  const countsByCity = countValues(packet.candidates.map((candidate) => candidate.city), ["KITCHENER", "WATERLOO", "CAMBRIDGE"]);
  const countsByNiche = countValues(packet.candidates.map((candidate) => candidate.niche), ["ROOFING", "HVAC", "LANDSCAPING"]);
  if (privateKwM2Digest(countsByCity) !== privateKwM2Digest(packet.summary.countsByCity) || privateKwM2Digest(countsByNiche) !== privateKwM2Digest(packet.summary.countsByNiche)) {
    context.addIssue({ code: "custom", path: ["summary"], message: "Research packet summary must match its candidates." });
  }
});

export type PrivateKwM2ResearchPacket = z.infer<typeof PrivateKwM2ResearchPacketSchema>;

const AuthorizationDecisionSchema = z.object({
  businessId: z.string().trim().min(1).max(128),
  websiteUrl: z.string().url().nullable(),
  sourceRights: z.literal("PUBLIC_SOURCE_REVIEWED"),
  termsDecision: z.literal("PUBLIC_REVIEW_ONLY"),
  robotsDecision: z.literal("PREFLIGHT_REQUIRED_BEFORE_FETCH"),
  evidenceRetention: z.enum(["RAW_HTML_ALLOWED", "DERIVED_FACTS_ONLY", "BLOCKED"]),
  stopConditions: ResearchCandidateSchema.shape.stopConditions,
}).strict();

export const PrivateKwM2ExecutionAuthorizationSchema = z.object({
  authorizationVersion: z.literal(PRIVATE_KW_M2_EXECUTION_AUTHORIZATION_VERSION),
  authorizationId: z.string().regex(/^kw-m2-execution:[a-f0-9]{64}$/),
  authorizationDigest: Sha256Schema,
  status: z.literal("PENDING"),
  researchPacketId: z.string().regex(/^kw-m2-research:[a-f0-9]{64}$/),
  researchPacketDigest: Sha256Schema,
  manifestId: z.string().regex(/^kw-shadow-slice:[a-f0-9]{64}$/),
  manifestDigest: Sha256Schema,
  sourcePlanDigest: Sha256Schema,
  websitePolicyVersion: z.string().trim().min(1).max(80),
  transportPolicyVersion: z.string().trim().min(1).max(80),
  createdAt: TimestampSchema,
  expiresAt: TimestampSchema,
  networkRequestCap: z.number().int().min(1).max(100),
  businessIds: z.array(z.string().trim().min(1).max(128)).length(10),
  sourceDecisions: z.array(AuthorizationDecisionSchema).length(10),
  authority: AuthoritySchema,
}).strict().superRefine((authorization, context) => {
  const { authorizationId: _authorizationId, authorizationDigest: _authorizationDigest, ...core } = authorization;
  void _authorizationId;
  void _authorizationDigest;
  const expected = privateKwM2Digest(core);
  if (authorization.authorizationDigest !== expected || authorization.authorizationId !== `kw-m2-execution:${expected}`) {
    context.addIssue({ code: "custom", path: ["authorizationDigest"], message: "Execution authorization identity must bind its exact contents." });
  }
  if (Date.parse(authorization.expiresAt) <= Date.parse(authorization.createdAt)) {
    context.addIssue({ code: "custom", path: ["expiresAt"], message: "Execution authorization must expire after creation." });
  }
  const ids = new Set(authorization.businessIds);
  const decisionIds = new Set(authorization.sourceDecisions.map((decision) => decision.businessId));
  if (ids.size !== 10 || decisionIds.size !== 10 || authorization.businessIds.some((id) => !decisionIds.has(id))) {
    context.addIssue({ code: "custom", path: ["businessIds"], message: "Authorization business IDs must match its source decisions exactly." });
  }
});

export type PrivateKwM2ExecutionAuthorization = z.infer<typeof PrivateKwM2ExecutionAuthorizationSchema>;

const ApproverSchema = z.enum(["RILEY", "AIDAN"]);
const OwnerApprovalCoreSchema = z.object({
  ownerApprovalVersion: z.literal(PRIVATE_KW_M2_OWNER_APPROVAL_VERSION),
  status: z.enum(["PENDING", "APPROVED"]),
  researchPacketId: z.string().regex(/^kw-m2-research:[a-f0-9]{64}$/),
  researchPacketDigest: Sha256Schema,
  executionAuthorizationId: z.string().regex(/^kw-m2-execution:[a-f0-9]{64}$/),
  executionAuthorizationDigest: Sha256Schema,
  manifestId: z.string().regex(/^kw-shadow-slice:[a-f0-9]{64}$/),
  manifestDigest: Sha256Schema,
  sourcePlanDigest: Sha256Schema,
  approver: ApproverSchema.nullable(),
  reviewedAt: TimestampSchema.nullable(),
  expiresAt: TimestampSchema,
  rationale: z.string().trim().min(10).max(500),
  dedicatedConfirmation: z.boolean(),
  authority: AuthoritySchema,
}).strict();

export const PrivateKwM2OwnerApprovalEnvelopeSchema = OwnerApprovalCoreSchema.extend({
  ownerApprovalId: z.string().regex(/^kw-m2-owner-approval:[a-f0-9]{64}$/),
  ownerApprovalDigest: Sha256Schema,
}).superRefine((envelope, context) => {
  const { ownerApprovalId: _ownerApprovalId, ownerApprovalDigest: _ownerApprovalDigest, ...core } = envelope;
  void _ownerApprovalId;
  void _ownerApprovalDigest;
  const expected = privateKwM2Digest(core);
  if (envelope.ownerApprovalDigest !== expected || envelope.ownerApprovalId !== `kw-m2-owner-approval:${expected}`) {
    context.addIssue({ code: "custom", path: ["ownerApprovalDigest"], message: "Owner approval identity must bind its exact contents." });
  }
  if (envelope.status === "PENDING" && (envelope.approver !== null || envelope.reviewedAt !== null || envelope.dedicatedConfirmation)) {
    context.addIssue({ code: "custom", path: ["status"], message: "A pending owner candidate cannot contain an approval decision." });
  }
  if (envelope.status === "APPROVED" && (envelope.approver === null || envelope.reviewedAt === null || !envelope.dedicatedConfirmation)) {
    context.addIssue({ code: "custom", path: ["status"], message: "An approved owner envelope requires a recorded exact decision." });
  }
});

export type PrivateKwM2OwnerApprovalEnvelope = z.infer<typeof PrivateKwM2OwnerApprovalEnvelopeSchema>;

export const PrivateKwM2AssessmentMappingPolicySchema = z.object({
  mappingVersion: z.literal(PRIVATE_KW_M2_ASSESSMENT_MAPPING_POLICY_VERSION),
  mappingId: z.string().regex(/^kw-m2-assessment-mapping:[a-f0-9]{64}$/),
  mappingDigest: Sha256Schema,
  fieldNames: z.array(z.string().trim().min(1).max(100)).min(1).max(30),
  outcomeVocabulary: z.array(z.string().trim().min(1).max(80)).min(1).max(20),
  limitationVocabulary: z.array(z.string().trim().min(1).max(80)).min(1).max(20),
  fixtureOnly: z.literal(true),
  productionAssessmentApprovalAuthorized: z.literal(false),
}).strict().superRefine((mapping, context) => {
  const { mappingId: _mappingId, mappingDigest: _mappingDigest, ...core } = mapping;
  void _mappingId;
  void _mappingDigest;
  const expected = privateKwM2Digest(core);
  if (mapping.mappingDigest !== expected || mapping.mappingId !== `kw-m2-assessment-mapping:${expected}`) {
    context.addIssue({ code: "custom", path: ["mappingDigest"], message: "Mapping identity must bind its exact policy fields." });
  }
  if (new Set(mapping.fieldNames).size !== mapping.fieldNames.length) {
    context.addIssue({ code: "custom", path: ["fieldNames"], message: "Mapping fields must be unique." });
  }
});

export type PrivateKwM2AssessmentMappingPolicy = z.infer<typeof PrivateKwM2AssessmentMappingPolicySchema>;

const DatabasePathSchema = z.string().regex(/^data\/kw-evaluation\/[A-Za-z0-9._-]+\.sqlite$/);
export const PRIVATE_KW_M2_DATABASE_MIGRATION_RANGE = "0054-0068" as const;

export const PrivateKwM2DatabaseReceiptSchema = z.object({
  receiptVersion: z.literal(PRIVATE_KW_M2_DATABASE_RECEIPT_VERSION),
  receiptId: z.string().regex(/^kw-m2-database:[a-f0-9]{64}$/),
  receiptDigest: Sha256Schema,
  databasePath: DatabasePathSchema,
  fileIdentity: z.object({
    device: z.string().trim().min(1).max(200),
    inode: z.string().trim().min(1).max(200),
    byteLength: z.number().int().nonnegative(),
    modificationMarker: z.string().trim().min(1).max(200),
    sha256: Sha256Schema,
  }).strict(),
  schemaDigest: Sha256Schema,
  migrationRange: z.literal(PRIVATE_KW_M2_DATABASE_MIGRATION_RANGE),
  migrationFiles: z.array(z.string().regex(/^\d{4}_[A-Za-z0-9._-]+\.sql$/)).min(1).max(100),
  migrationsCommit: z.string().regex(/^[a-f0-9]{7,64}$/),
  backupRestore: z.object({
    backupPath: z.string().regex(/^data\/kw-evaluation\/[A-Za-z0-9._-]+\.sqlite$/),
    backupSha256: Sha256Schema,
    restoreVerified: z.literal(true),
    evidenceDigest: Sha256Schema,
  }).strict(),
  authority: z.object({
    localOnly: z.literal(true),
    remoteMigrationAuthorized: z.literal(false),
    sqlExecutionAuthorized: z.literal(false),
    providerOperationsAuthorized: z.literal(0),
    costAuthorizedUsd: z.literal(0),
  }).strict(),
}).strict().superRefine((receipt, context) => {
  const { receiptId: _receiptId, receiptDigest: _receiptDigest, ...core } = receipt;
  void _receiptId;
  void _receiptDigest;
  const expected = privateKwM2Digest(core);
  if (receipt.receiptDigest !== expected || receipt.receiptId !== `kw-m2-database:${expected}`) {
    context.addIssue({ code: "custom", path: ["receiptDigest"], message: "Database receipt identity must bind its exact contents." });
  }
  if (receipt.databasePath === receipt.backupRestore.backupPath) {
    context.addIssue({ code: "custom", path: ["backupRestore", "backupPath"], message: "Database backup must use a separate path." });
  }
});

export type PrivateKwM2DatabaseReceipt = z.infer<typeof PrivateKwM2DatabaseReceiptSchema>;

export function privateKwM2DatabaseReceiptDigest(value: Omit<PrivateKwM2DatabaseReceipt, "receiptId" | "receiptDigest" | "migrationFiles"> & { migrationFiles: readonly string[] }) {
  return privateKwM2Digest(value);
}

export function assertPrivateKwM2DatabaseReceipt(value: unknown): PrivateKwM2DatabaseReceipt {
  return PrivateKwM2DatabaseReceiptSchema.parse(value);
}

export function buildPrivateKwM2ResearchPacket(input: {
  manifest: PrivateKwShadowSliceManifest;
  sourcePlan: PrivateKwImportPlan;
  reviewedAt: string;
}): PrivateKwM2ResearchPacket {
  const manifest = PrivateKwShadowSliceManifestSchema.parse(input.manifest);
  const sourcePlan = PrivateKwImportPlanSchema.parse(input.sourcePlan);
  const persistencePlan = buildPrivateKwPersistencePlan(sourcePlan);
  if (manifest.sourceImportId !== sourcePlan.importId || manifest.sourcePlanDigest !== persistencePlan.sourcePlanDigest) {
    throw new Error("The M2 research packet requires the exact source plan bound by the manifest.");
  }
  const sourceByBusinessId = new Map(sourcePlan.records.map((record) => [record.business.id, record]));
  const candidates = manifest.records.map((record) => {
    const source = sourceByBusinessId.get(record.businessId);
    if (!source || source.evaluationCandidateId !== record.evaluationCandidateId) {
      throw new Error("The M2 research packet manifest and source plan identities do not match.");
    }
    return {
      businessId: record.businessId,
      evaluationCandidateId: record.evaluationCandidateId,
      businessName: record.businessName,
      city: record.city,
      niche: record.niche,
      websiteUrl: record.websiteUrl,
      sourceEvidenceUrl: record.sourceEvidenceUrl,
      sourceMethod: "MANUAL_RESEARCH" as const,
      sourceCapturedAt: record.sourceCapturedAt,
      sourceReviewedAt: record.sourceReview.reviewedAt,
      independenceStatus: "INDEPENDENT" as const,
      sourceRights: "PUBLIC_SOURCE_REVIEWED" as const,
      termsDecision: "PUBLIC_REVIEW_ONLY" as const,
      robotsDecision: "PREFLIGHT_REQUIRED_BEFORE_FETCH" as const,
      evidenceRetention: "DERIVED_FACTS_ONLY" as const,
      retentionReviewDate: input.reviewedAt,
      stopConditions: [
        "AMBIGUOUS_IDENTITY",
        "ROBOTS_OR_TERMS_UNCLEAR",
        "SOURCE_RIGHTS_UNCLEAR",
        "PERSONAL_DATA_DOMINANT",
        "STALE_EVIDENCE",
        "OUT_OF_SCOPE",
        "RETENTION_NOT_ALLOWED",
      ] as const,
    };
  });
  const core = {
    packetVersion: PRIVATE_KW_M2_RESEARCH_PACKET_VERSION,
    manifestId: manifest.manifestId,
    manifestDigest: manifest.manifestDigest,
    sourceImportId: sourcePlan.importId,
    sourcePlanDigest: persistencePlan.sourcePlanDigest,
    createdAt: input.reviewedAt,
    candidates,
    summary: {
      selectedBusinesses: 10 as const,
      countsByCity: manifest.summary.countsByCity,
      countsByNiche: manifest.summary.countsByNiche,
    },
    ownerReview: {
      state: "PENDING_OWNER_REVIEW" as const,
      reviewedBy: null,
      reviewedAt: null,
      rationale: "Awaiting separate owner review of this exact research packet.",
    },
    authority: zeroAuthority(),
  };
  const packetDigest = privateKwM2Digest(core);
  return PrivateKwM2ResearchPacketSchema.parse({ ...core, packetId: `kw-m2-research:${packetDigest}`, packetDigest });
}

export function buildPrivateKwM2ExecutionAuthorization(input: {
  researchPacket: PrivateKwM2ResearchPacket;
  manifest: PrivateKwShadowSliceManifest;
  sourcePlan: PrivateKwImportPlan;
  websitePolicy: { version: string; networkRequestCap: number; expiresAt: string };
}): PrivateKwM2ExecutionAuthorization {
  const packet = PrivateKwM2ResearchPacketSchema.parse(input.researchPacket);
  const manifest = PrivateKwShadowSliceManifestSchema.parse(input.manifest);
  const sourcePlan = PrivateKwImportPlanSchema.parse(input.sourcePlan);
  assertPacketSourceChain(packet, manifest, sourcePlan);
  const core = {
    authorizationVersion: PRIVATE_KW_M2_EXECUTION_AUTHORIZATION_VERSION,
    status: "PENDING" as const,
    researchPacketId: packet.packetId,
    researchPacketDigest: packet.packetDigest,
    manifestId: manifest.manifestId,
    manifestDigest: manifest.manifestDigest,
    sourcePlanDigest: packet.sourcePlanDigest,
    websitePolicyVersion: input.websitePolicy.version,
    transportPolicyVersion: "kw-m2-address-pinned-node-v1",
    createdAt: packet.createdAt,
    expiresAt: input.websitePolicy.expiresAt,
    networkRequestCap: input.websitePolicy.networkRequestCap,
    businessIds: packet.candidates.map((candidate) => candidate.businessId),
    sourceDecisions: packet.candidates.map((candidate) => ({
      businessId: candidate.businessId,
      websiteUrl: candidate.websiteUrl,
      sourceRights: candidate.sourceRights,
      termsDecision: candidate.termsDecision,
      robotsDecision: candidate.robotsDecision,
      evidenceRetention: candidate.evidenceRetention,
      stopConditions: candidate.stopConditions,
    })),
    authority: zeroAuthority(),
  };
  const authorizationDigest = privateKwM2Digest(core);
  return PrivateKwM2ExecutionAuthorizationSchema.parse({
    ...core,
    authorizationId: `kw-m2-execution:${authorizationDigest}`,
    authorizationDigest,
  });
}

export function buildPrivateKwM2OwnerApprovalCandidate(input: {
  researchPacket: PrivateKwM2ResearchPacket;
  authorization: PrivateKwM2ExecutionAuthorization;
  manifest: PrivateKwShadowSliceManifest;
  sourcePlan: PrivateKwImportPlan;
}): PrivateKwM2OwnerApprovalEnvelope {
  const packet = PrivateKwM2ResearchPacketSchema.parse(input.researchPacket);
  const authorization = PrivateKwM2ExecutionAuthorizationSchema.parse(input.authorization);
  const manifest = PrivateKwShadowSliceManifestSchema.parse(input.manifest);
  const sourcePlan = PrivateKwImportPlanSchema.parse(input.sourcePlan);
  assertPacketSourceChain(packet, manifest, sourcePlan);
  if (authorization.researchPacketId !== packet.packetId || authorization.researchPacketDigest !== packet.packetDigest) {
    throw new Error("Owner approval candidate requires the exact pending authorization for the packet.");
  }
  const core = {
    ownerApprovalVersion: PRIVATE_KW_M2_OWNER_APPROVAL_VERSION,
    status: "PENDING" as const,
    researchPacketId: packet.packetId,
    researchPacketDigest: packet.packetDigest,
    executionAuthorizationId: authorization.authorizationId,
    executionAuthorizationDigest: authorization.authorizationDigest,
    manifestId: manifest.manifestId,
    manifestDigest: manifest.manifestDigest,
    sourcePlanDigest: packet.sourcePlanDigest,
    approver: null,
    reviewedAt: null,
    expiresAt: authorization.expiresAt,
    rationale: "Awaiting a separate owner decision on the exact packet and authorization.",
    dedicatedConfirmation: false,
    authority: zeroAuthority(),
  };
  const ownerApprovalDigest = privateKwM2Digest(core);
  return PrivateKwM2OwnerApprovalEnvelopeSchema.parse({
    ...core,
    ownerApprovalId: `kw-m2-owner-approval:${ownerApprovalDigest}`,
    ownerApprovalDigest,
  });
}

export function recordPrivateKwM2OwnerApproval(
  candidate: PrivateKwM2OwnerApprovalEnvelope,
  decision: {
    approver: "RILEY" | "AIDAN";
    reviewedAt: string;
    expiresAt: string;
    rationale: string;
    dedicatedConfirmation: true;
  },
): PrivateKwM2OwnerApprovalEnvelope {
  const pending = PrivateKwM2OwnerApprovalEnvelopeSchema.parse(candidate);
  if (pending.status !== "PENDING") throw new Error("Only a pending owner candidate can be recorded as approved.");
  if (Date.parse(decision.expiresAt) <= Date.parse(decision.reviewedAt)) throw new Error("Owner approval expiry must follow its review time.");
  const core = {
    ...pending,
    status: "APPROVED" as const,
    approver: decision.approver,
    reviewedAt: decision.reviewedAt,
    expiresAt: decision.expiresAt,
    rationale: decision.rationale,
    dedicatedConfirmation: true as const,
  };
  delete (core as { ownerApprovalId?: unknown }).ownerApprovalId;
  delete (core as { ownerApprovalDigest?: unknown }).ownerApprovalDigest;
  const ownerApprovalDigest = privateKwM2Digest(core);
  return PrivateKwM2OwnerApprovalEnvelopeSchema.parse({
    ...core,
    ownerApprovalId: `kw-m2-owner-approval:${ownerApprovalDigest}`,
    ownerApprovalDigest,
  });
}

export function buildPrivateKwM2AssessmentMappingPolicy(input: {
  fieldNames: string[];
  outcomeVocabulary: string[];
  limitationVocabulary: string[];
}): PrivateKwM2AssessmentMappingPolicy {
  const core = {
    mappingVersion: PRIVATE_KW_M2_ASSESSMENT_MAPPING_POLICY_VERSION,
    fieldNames: input.fieldNames,
    outcomeVocabulary: input.outcomeVocabulary,
    limitationVocabulary: input.limitationVocabulary,
    fixtureOnly: true as const,
    productionAssessmentApprovalAuthorized: false as const,
  };
  const mappingDigest = privateKwM2Digest(core);
  return PrivateKwM2AssessmentMappingPolicySchema.parse({
    ...core,
    mappingId: `kw-m2-assessment-mapping:${mappingDigest}`,
    mappingDigest,
  });
}

export function assertPrivateKwM2ApprovalChain(input: {
  researchPacket: PrivateKwM2ResearchPacket;
  authorization: PrivateKwM2ExecutionAuthorization;
  ownerEnvelope: PrivateKwM2OwnerApprovalEnvelope;
  manifest: PrivateKwShadowSliceManifest;
  sourcePlan: PrivateKwImportPlan;
  phase: "PREPARE" | "ROBOTS" | "GET" | "ASSESSMENT";
  now?: string;
}) {
  const packet = PrivateKwM2ResearchPacketSchema.parse(input.researchPacket);
  const authorization = PrivateKwM2ExecutionAuthorizationSchema.parse(input.authorization);
  const ownerEnvelope = PrivateKwM2OwnerApprovalEnvelopeSchema.parse(input.ownerEnvelope);
  const manifest = PrivateKwShadowSliceManifestSchema.parse(input.manifest);
  const sourcePlan = PrivateKwImportPlanSchema.parse(input.sourcePlan);
  assertPacketSourceChain(packet, manifest, sourcePlan);
  if (authorization.researchPacketId !== packet.packetId || authorization.researchPacketDigest !== packet.packetDigest || authorization.manifestId !== manifest.manifestId || authorization.manifestDigest !== manifest.manifestDigest || authorization.sourcePlanDigest !== packet.sourcePlanDigest) {
    throw new Error("Execution authorization does not match the exact packet, manifest, or source plan.");
  }
  const expectedDecisions = packet.candidates.map((candidate) => ({
    businessId: candidate.businessId,
    websiteUrl: candidate.websiteUrl,
    sourceRights: candidate.sourceRights,
    termsDecision: candidate.termsDecision,
    robotsDecision: candidate.robotsDecision,
    evidenceRetention: candidate.evidenceRetention,
    stopConditions: candidate.stopConditions,
  }));
  if (privateKwM2Digest(authorization.businessIds) !== privateKwM2Digest(packet.candidates.map((candidate) => candidate.businessId)) || privateKwM2Digest(authorization.sourceDecisions) !== privateKwM2Digest(expectedDecisions)) {
    throw new Error("Execution authorization source decisions do not match the exact research packet.");
  }
  if (ownerEnvelope.researchPacketId !== packet.packetId || ownerEnvelope.researchPacketDigest !== packet.packetDigest || ownerEnvelope.executionAuthorizationId !== authorization.authorizationId || ownerEnvelope.executionAuthorizationDigest !== authorization.authorizationDigest || ownerEnvelope.manifestId !== manifest.manifestId || ownerEnvelope.manifestDigest !== manifest.manifestDigest || ownerEnvelope.sourcePlanDigest !== packet.sourcePlanDigest) {
    throw new Error("Owner approval does not match the exact packet and authorization chain.");
  }
  if (input.phase !== "PREPARE") {
    if (ownerEnvelope.status !== "APPROVED") throw new Error("Robots and website GET require a separately recorded APPROVED owner envelope.");
    const now = Date.parse(input.now ?? new Date().toISOString());
    if (ownerEnvelope.reviewedAt === null || now < Date.parse(ownerEnvelope.reviewedAt) || now >= Date.parse(ownerEnvelope.expiresAt)) {
      throw new Error("The APPROVED owner envelope is missing a valid review window.");
    }
  }
  return true as const;
}

function assertPacketSourceChain(packet: PrivateKwM2ResearchPacket, manifest: PrivateKwShadowSliceManifest, sourcePlan: PrivateKwImportPlan) {
  const persistencePlan: PrivateKwPersistencePlan = buildPrivateKwPersistencePlan(sourcePlan);
  if (packet.manifestId !== manifest.manifestId || packet.manifestDigest !== manifest.manifestDigest || packet.sourceImportId !== sourcePlan.importId || packet.sourcePlanDigest !== persistencePlan.sourcePlanDigest || manifest.sourceImportId !== sourcePlan.importId || manifest.sourcePlanDigest !== persistencePlan.sourcePlanDigest) {
    throw new Error("The research packet, manifest, and source plan must share exact durable identities.");
  }
}

function zeroAuthority(): PrivateKwM2Authority {
  return {
    liveSourceAuthorized: false,
    browserCaptureAuthorized: false,
    artifactStorageAuthorized: false,
    databaseMutationAuthorized: false,
    contactDiscoveryExecutionAuthorized: false,
    contactVerificationExecutionAuthorized: false,
    consentDecisionAuthorized: false,
    qualificationAuthorized: false,
    mailboxSyncAuthorized: false,
    outreachAuthorized: false,
    sendAuthorized: false,
    deploymentAuthorized: false,
    providerOperationsAuthorized: 0,
    costAuthorizedUsd: 0,
  };
}

function countValues<T extends string>(values: readonly T[], keys: readonly T[]) {
  return Object.fromEntries(keys.map((key) => [key, values.filter((value) => value === key).length])) as Record<T, number>;
}
