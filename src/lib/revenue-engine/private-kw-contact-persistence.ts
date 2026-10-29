import { createHash } from "node:crypto";

import { z } from "zod";

import {
  RevenueContactDiscoveryResultSchema,
  contactDiscoveryCanonicalJson,
  contactDiscoveryDigest,
  type RevenueContactDiscoveryResult,
} from "@/lib/revenue-engine/contact-discovery";
import {
  RevenueContactPersistencePlanSchema,
  buildRevenueContactPersistencePlan,
  type RevenueContactPersistencePlan,
} from "@/lib/revenue-engine/contact-persistence-plan";
import {
  RevenueContactVerificationResultSchema,
  type RevenueContactVerificationResult,
} from "@/lib/revenue-engine/contact-verification";

export const PRIVATE_KW_CONTACT_PERSISTENCE_VERSION = "kw-private-contact-persistence-v1";
export const PRIVATE_KW_CONTACT_PERSISTENCE_TARGET_SCHEMA_VERSION =
  "0066_harden_local_contact_persistence_receipts";
export const PRIVATE_KW_CONTACT_PERSISTENCE_APPROVAL_CONFIRMATION =
  "I APPROVE THIS LOCAL CONTACT PERSISTENCE";

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const TimestampSchema = z.string().datetime({ offset: true });
const SqlValueSchema = z.union([z.string(), z.number().finite(), z.null()]);
const ContactEntitySchema = z.enum([
  "BUSINESS",
  "DISCOVERY_RECEIPT",
  "CONTACT_POINT",
  "EVIDENCE_CLAIM",
  "EVIDENCE_USE",
  "VERIFICATION_RESULT",
  "MATERIALIZATION_RECEIPT",
]);

const VerificationIdentitySchema = z.object({
  verificationResultId: z.string().min(1).max(160),
  verificationResultDigest: Sha256Schema,
}).strict();

const ApprovalDecisionSchema = z.object({
  decision: z.literal("APPROVED_FOR_LOCAL_CONTACT_PERSISTENCE"),
  reviewedBy: z.enum(["RILEY", "AIDAN"]),
  reviewedAt: TimestampSchema,
  rationale: z.string().trim().min(10).max(500),
  confirmation: z.literal(PRIVATE_KW_CONTACT_PERSISTENCE_APPROVAL_CONFIRMATION),
}).strict();

export const PrivateKwContactPersistenceApprovalSchema = z.object({
  materializationVersion: z.literal(PRIVATE_KW_CONTACT_PERSISTENCE_VERSION),
  businessId: z.string().min(1).max(128),
  discoveryResultId: z.string().min(1).max(160),
  discoveryResultDigest: Sha256Schema,
  persistencePlanDigest: Sha256Schema,
  verificationResults: z.array(VerificationIdentitySchema).max(250),
  approval: ApprovalDecisionSchema,
  mode: z.literal("SHADOW"),
  executionKind: z.literal("IGNORED_LOCAL_SQLITE"),
  localDatabaseAccessAuthorized: z.literal(true),
  localContactMutationAuthorized: z.literal(true),
  localVerificationMutationAuthorized: z.literal(true),
  sourceMutationAuthorized: z.literal(false),
  workflowMutationAuthorized: z.literal(false),
  assessmentMutationAuthorized: z.literal(false),
  schemaMutationAuthorized: z.literal(false),
  captureAuthorized: z.literal(false),
  contactDiscoveryAuthorized: z.literal(false),
  contactVerificationAuthorized: z.literal(false),
  consentDecisionAuthorized: z.literal(false),
  qualificationAuthorized: z.literal(false),
  outreachAuthorized: z.literal(false),
  sendAuthorized: z.literal(false),
  providerOperationsAuthorized: z.literal(0),
  costAuthorizedUsd: z.literal(0),
}).strict().superRefine((value, context) => {
  const sorted = [...value.verificationResults].sort((left, right) =>
    left.verificationResultId.localeCompare(right.verificationResultId, "en-CA"));
  if (contactDiscoveryCanonicalJson(sorted) !== contactDiscoveryCanonicalJson(value.verificationResults)) {
    context.addIssue({ code: "custom", message: "Approved verification identities must use deterministic result-ID order.", path: ["verificationResults"] });
  }
  if (new Set(value.verificationResults.map((item) => item.verificationResultId)).size !== value.verificationResults.length) {
    context.addIssue({ code: "custom", message: "Approved verification result identities must be unique.", path: ["verificationResults"] });
  }
});

export type PrivateKwContactPersistenceApproval = z.infer<
  typeof PrivateKwContactPersistenceApprovalSchema
>;

const ContactRecordPlanSchema = z.object({
  entity: ContactEntitySchema,
  recordId: z.string().min(1).max(220),
  ownership: z.enum(["PREREQUISITE", "GLOBAL_REUSABLE", "DISCOVERY_OWNED"]),
  selectSql: z.string().min(1).max(5_000),
  selectBindings: z.array(SqlValueSchema).max(8),
  expected: z.record(z.string().min(1).max(100), SqlValueSchema),
  expectedFingerprint: Sha256Schema,
  insertSql: z.string().min(1).max(8_000).nullable(),
  insertBindings: z.array(SqlValueSchema).max(50),
  operation: z.enum(["PREREQUISITE", "INSERT_APPEND_ONLY"]),
}).strict().superRefine((record, context) => {
  if (!/^\s*SELECT\b/i.test(record.selectSql) || /\bLIMIT\s+1\b/i.test(record.selectSql)) {
    context.addIssue({ code: "custom", message: "Contact materialization preflights must be collision-complete SELECT statements.", path: ["selectSql"] });
  }
  if (record.operation === "PREREQUISITE") {
    if (record.insertSql !== null || record.insertBindings.length !== 0 || record.entity !== "BUSINESS") {
      context.addIssue({ code: "custom", message: "Only the business prerequisite may omit an insert.", path: ["operation"] });
    }
  } else if (record.insertSql === null || !/^\s*INSERT\s+INTO\b/i.test(record.insertSql)) {
    context.addIssue({ code: "custom", message: "Contact materialization mutations must be append-only INSERT statements.", path: ["insertSql"] });
  }
  if (record.insertSql && /\b(?:UPDATE|DELETE|REPLACE|DROP|ALTER)\b/i.test(record.insertSql)) {
    context.addIssue({ code: "custom", message: "Contact materialization cannot carry destructive SQL.", path: ["insertSql"] });
  }
});

export type PrivateKwContactPersistenceRecordPlan = z.infer<typeof ContactRecordPlanSchema>;

const ContactPersistenceAuthoritySchema = z.object({
  executionKind: z.literal("IGNORED_LOCAL_SQLITE"),
  transactionKind: z.literal("BETTER_SQLITE3_IMMEDIATE"),
  localOnly: z.literal(true),
  localDatabaseAccessAuthorized: z.literal(true),
  localContactMutationAuthorized: z.literal(true),
  localVerificationMutationAuthorized: z.literal(true),
  sourceMutationAuthorized: z.literal(false),
  workflowMutationAuthorized: z.literal(false),
  assessmentMutationAuthorized: z.literal(false),
  schemaMutationAuthorized: z.literal(false),
  captureAuthorized: z.literal(false),
  contactDiscoveryAuthorized: z.literal(false),
  contactVerificationAuthorized: z.literal(false),
  consentDecisionAuthorized: z.literal(false),
  qualificationAuthorized: z.literal(false),
  outreachAuthorized: z.literal(false),
  sendAuthorized: z.literal(false),
  providerOperationsAuthorized: z.literal(0),
  costAuthorizedUsd: z.literal(0),
}).strict();

export const PrivateKwContactPersistencePlanSchema = z.object({
  materializationVersion: z.literal(PRIVATE_KW_CONTACT_PERSISTENCE_VERSION),
  targetSchemaVersion: z.literal(PRIVATE_KW_CONTACT_PERSISTENCE_TARGET_SCHEMA_VERSION),
  materializationId: z.string().regex(/^kw-contact-persistence:[a-f0-9]{64}$/),
  materializationDigest: Sha256Schema,
  businessId: z.string().min(1).max(128),
  discoveryResultId: z.string().min(1).max(160),
  discoveryResultDigest: Sha256Schema,
  persistencePlanDigest: Sha256Schema,
  verificationResultIds: z.array(z.string().min(1).max(160)).max(250),
  recordedAt: TimestampSchema,
  records: z.array(ContactRecordPlanSchema).min(3).max(2_001),
  summary: z.object({
    discoveryReceipts: z.literal(1),
    contactPointVersions: z.number().int().min(0).max(25),
    evidenceClaims: z.number().int().min(0).max(500),
    evidenceUses: z.number().int().min(0).max(500),
    verificationResults: z.number().int().min(0).max(250),
    materializationReceipts: z.literal(1),
    consentRows: z.literal(0),
    qualificationRows: z.literal(0),
    outreachRows: z.literal(0),
    providerOperations: z.literal(0),
    costUsd: z.literal(0),
  }).strict(),
  authority: ContactPersistenceAuthoritySchema,
  planDigest: Sha256Schema,
}).strict().superRefine((plan, context) => {
  const keys = plan.records.map((record) => `${record.entity}|${record.recordId}`);
  if (new Set(keys).size !== keys.length) {
    context.addIssue({ code: "custom", message: "Contact materialization record identities must be unique.", path: ["records"] });
  }
  if (
    plan.records.filter((record) => record.entity === "BUSINESS").length !== 1
    || plan.records.filter((record) => record.entity === "DISCOVERY_RECEIPT").length !== 1
    || plan.records.filter((record) => record.entity === "MATERIALIZATION_RECEIPT").length !== 1
  ) {
    context.addIssue({ code: "custom", message: "Contact materialization requires exactly one business, discovery receipt, and completion receipt.", path: ["records"] });
  }
  if (plan.records[0]?.entity !== "BUSINESS" || plan.records.at(-1)?.entity !== "MATERIALIZATION_RECEIPT") {
    context.addIssue({ code: "custom", message: "Contact materialization requires the business first and completion receipt last.", path: ["records"] });
  }
  const { planDigest, ...core } = plan;
  if (privateKwContactPersistenceDigest(core) !== planDigest) {
    context.addIssue({ code: "custom", message: "Contact materialization plan digest must bind the exact trusted plan.", path: ["planDigest"] });
  }
});

export type PrivateKwContactPersistencePlan = z.infer<
  typeof PrivateKwContactPersistencePlanSchema
>;

export function privateKwContactPersistenceDigest(value: unknown) {
  return createHash("sha256").update(contactDiscoveryCanonicalJson(value)).digest("hex");
}

function expectedVerificationIdentities(verifications: readonly RevenueContactVerificationResult[]) {
  return verifications
    .map((verification) => ({
      verificationResultId: verification.verificationResultId,
      verificationResultDigest: verification.verificationResultDigest,
    }))
    .sort((left, right) => left.verificationResultId.localeCompare(right.verificationResultId, "en-CA"));
}

function assertApprovalMatches(input: {
  discovery: RevenueContactDiscoveryResult;
  verifications: readonly RevenueContactVerificationResult[];
  persistencePlan: RevenueContactPersistencePlan;
  approval: PrivateKwContactPersistenceApproval;
}) {
  const { discovery, verifications, persistencePlan, approval } = input;
  if (
    approval.businessId !== discovery.businessId
    || approval.discoveryResultId !== discovery.discoveryResultId
    || approval.discoveryResultDigest !== discovery.discoveryResultDigest
    || approval.persistencePlanDigest !== persistencePlan.planDigest
  ) {
    throw new Error("Contact persistence approval must bind the exact discovery result and re-derived plan.");
  }
  const expected = expectedVerificationIdentities(verifications);
  if (contactDiscoveryCanonicalJson(approval.verificationResults) !== contactDiscoveryCanonicalJson(expected)) {
    throw new Error("Contact persistence approval must bind every exact verification result.");
  }
  const reviewedAt = Date.parse(approval.approval.reviewedAt);
  if (
    Date.parse(discovery.completedAt) > reviewedAt
    || verifications.some((verification) => Date.parse(verification.completedAt) > reviewedAt)
  ) {
    throw new Error("Contact persistence approval cannot predate discovery or verification completion.");
  }
}

function columns(expected: Record<string, z.infer<typeof SqlValueSchema>>) {
  return Object.keys(expected).map((column) => `"${column}"`).join(", ");
}

function executionReceiptRecord(input: {
  materializationId: string;
  materializationCore: Record<string, unknown>;
  materializationDigest: string;
  approval: PrivateKwContactPersistenceApproval;
  persistencePlan: RevenueContactPersistencePlan;
}): PrivateKwContactPersistenceRecordPlan {
  const verificationResultIds = input.approval.verificationResults.map((item) => item.verificationResultId);
  const expected = {
    id: input.materializationId,
    materializationVersion: PRIVATE_KW_CONTACT_PERSISTENCE_VERSION,
    businessId: input.approval.businessId,
    discoveryReceiptId: input.approval.discoveryResultId,
    discoveryResultDigest: input.approval.discoveryResultDigest,
    persistencePlanDigest: input.persistencePlan.planDigest,
    materializationDigest: input.materializationDigest,
    materializationJson: contactDiscoveryCanonicalJson(input.materializationCore),
    contactPointCount: input.persistencePlan.summary.contactPointVersions,
    evidenceClaimCount: input.persistencePlan.summary.evidenceClaims,
    evidenceUseCount: input.persistencePlan.summary.evidenceUses,
    verificationResultCount: input.persistencePlan.summary.verificationResults,
    verificationResultIdsJson: contactDiscoveryCanonicalJson(verificationResultIds),
    consentRows: 0,
    reviewedBy: input.approval.approval.reviewedBy,
    recordedAt: input.approval.approval.reviewedAt,
    executionKind: "IGNORED_LOCAL_SQLITE",
    transactionKind: "BETTER_SQLITE3_IMMEDIATE",
    localOnly: 1,
    localDatabaseAccessAuthorized: 1,
    localContactMutationAuthorized: 1,
    localVerificationMutationAuthorized: 1,
    sourceMutationAuthorized: 0,
    workflowMutationAuthorized: 0,
    assessmentMutationAuthorized: 0,
    schemaMutationAuthorized: 0,
    captureAuthorized: 0,
    contactDiscoveryAuthorized: 0,
    contactVerificationAuthorized: 0,
    consentDecisionAuthorized: 0,
    qualificationAuthorized: 0,
    outreachAuthorized: 0,
    sendAuthorized: 0,
    providerOperationsAuthorized: 0,
    costAuthorizedUsd: 0,
  } satisfies Record<string, z.infer<typeof SqlValueSchema>>;
  return ContactRecordPlanSchema.parse({
    entity: "MATERIALIZATION_RECEIPT",
    recordId: input.materializationId,
    ownership: "DISCOVERY_OWNED",
    selectSql: `SELECT ${columns(expected)} FROM "RevenuePrivateKwContactPersistenceReceipt" WHERE "id" = ? OR "discoveryReceiptId" = ? ORDER BY "id"`,
    selectBindings: [input.materializationId, input.approval.discoveryResultId],
    expected,
    expectedFingerprint: privateKwContactPersistenceDigest(expected),
    insertSql: `INSERT INTO "RevenuePrivateKwContactPersistenceReceipt" (${columns(expected)}) VALUES (${Object.keys(expected).map(() => "?").join(", ")})`,
    insertBindings: Object.values(expected),
    operation: "INSERT_APPEND_ONLY",
  });
}

export function verifyPrivateKwContactPersistencePreflight(
  record: PrivateKwContactPersistenceRecordPlan,
  rows: readonly Record<string, unknown>[],
) {
  const validated = ContactRecordPlanSchema.parse(record);
  if (rows.length === 0) return { state: "MISSING" as const, matches: true };
  if (rows.length !== 1) return { state: "CONFLICT" as const, matches: false };
  const comparable = Object.fromEntries(
    Object.keys(validated.expected).map((key) => [key, rows[0]?.[key] ?? null]),
  );
  const matches = privateKwContactPersistenceDigest(comparable) === validated.expectedFingerprint;
  return { state: matches ? "EXACT_MATCH" as const : "CONFLICT" as const, matches };
}

export function buildPrivateKwContactPersistencePlan(input: {
  discovery: RevenueContactDiscoveryResult;
  verifications?: readonly RevenueContactVerificationResult[];
  approval: PrivateKwContactPersistenceApproval;
}): PrivateKwContactPersistencePlan {
  const discovery = RevenueContactDiscoveryResultSchema.parse(input.discovery);
  const verifications = (input.verifications ?? []).map((value) =>
    RevenueContactVerificationResultSchema.parse(value));
  const approval = PrivateKwContactPersistenceApprovalSchema.parse(input.approval);
  const persistencePlan = RevenueContactPersistencePlanSchema.parse(
    buildRevenueContactPersistencePlan({ discovery, verifications }),
  );
  assertApprovalMatches({ discovery, verifications, persistencePlan, approval });

  const mutationByKey = new Map(
    persistencePlan.mutations.map((mutation) => [`${mutation.entity}|${mutation.recordId}`, mutation]),
  );
  const records = persistencePlan.preflights.map((preflight) => {
    const mutation = mutationByKey.get(`${preflight.entity}|${preflight.recordId}`);
    return ContactRecordPlanSchema.parse({
      entity: preflight.entity,
      recordId: preflight.recordId,
      ownership: preflight.ownership,
      selectSql: `${preflight.selectSql} ORDER BY "id"`,
      selectBindings: preflight.bindings,
      expected: preflight.expected,
      expectedFingerprint: preflight.expectedFingerprint,
      insertSql: mutation?.sql ?? null,
      insertBindings: mutation?.bindings ?? [],
      operation: mutation ? "INSERT_APPEND_ONLY" : "PREREQUISITE",
    });
  });

  const authority = {
    executionKind: "IGNORED_LOCAL_SQLITE",
    transactionKind: "BETTER_SQLITE3_IMMEDIATE",
    localOnly: true,
    localDatabaseAccessAuthorized: true,
    localContactMutationAuthorized: true,
    localVerificationMutationAuthorized: true,
    sourceMutationAuthorized: false,
    workflowMutationAuthorized: false,
    assessmentMutationAuthorized: false,
    schemaMutationAuthorized: false,
    captureAuthorized: false,
    contactDiscoveryAuthorized: false,
    contactVerificationAuthorized: false,
    consentDecisionAuthorized: false,
    qualificationAuthorized: false,
    outreachAuthorized: false,
    sendAuthorized: false,
    providerOperationsAuthorized: 0,
    costAuthorizedUsd: 0,
  } as const;
  const summary = {
    ...persistencePlan.summary,
    materializationReceipts: 1 as const,
  };
  const verificationResultIds = approval.verificationResults.map((item) => item.verificationResultId);
  const materializationCore = {
    materializationVersion: PRIVATE_KW_CONTACT_PERSISTENCE_VERSION,
    businessId: discovery.businessId,
    discoveryResultId: discovery.discoveryResultId,
    discoveryResultDigest: discovery.discoveryResultDigest,
    persistencePlanDigest: persistencePlan.planDigest,
    verificationResultIds,
    approval: approval.approval,
    summary,
    authority,
  };
  const materializationDigest = privateKwContactPersistenceDigest(materializationCore);
  const materializationId = `kw-contact-persistence:${materializationDigest}`;
  records.push(executionReceiptRecord({
    materializationId,
    materializationCore,
    materializationDigest,
    approval,
    persistencePlan,
  }));

  const core = {
    materializationVersion: PRIVATE_KW_CONTACT_PERSISTENCE_VERSION,
    targetSchemaVersion: PRIVATE_KW_CONTACT_PERSISTENCE_TARGET_SCHEMA_VERSION,
    materializationId,
    materializationDigest,
    businessId: discovery.businessId,
    discoveryResultId: discovery.discoveryResultId,
    discoveryResultDigest: discovery.discoveryResultDigest,
    persistencePlanDigest: persistencePlan.planDigest,
    verificationResultIds,
    recordedAt: approval.approval.reviewedAt,
    records,
    summary,
    authority,
  };
  return PrivateKwContactPersistencePlanSchema.parse({
    ...core,
    planDigest: contactDiscoveryDigest(core),
  });
}
