import { createHash } from "node:crypto";

import { z } from "zod";

import {
  PrivateKwImportPlanSchema,
  type PrivateKwImportPlan,
} from "@/lib/revenue-engine/private-kw-import";
import {
  buildPrivateKwPersistencePlan,
} from "@/lib/revenue-engine/private-kw-persistence-plan";
import {
  DeterministicWebsiteAuditInputSchema,
  auditWebsiteDeterministically,
} from "@/lib/revenue-engine/website-audit";

export const PRIVATE_KW_SOURCE_WORKFLOW_MATERIALIZATION_VERSION =
  "kw-private-source-workflow-materialization-v1";
export const PRIVATE_KW_CODEX_DELEGATED_SOURCE_WORKFLOW_MATERIALIZATION_VERSION =
  "kw-private-codex-source-workflow-materialization-v2";
export const PRIVATE_KW_REVIEWED_EVIDENCE_WORKFLOW_VERSION =
  "kw-private-reviewed-evidence-workflow-v1";
export const PRIVATE_KW_SOURCE_WORKFLOW_TARGET_SCHEMA_VERSION =
  "0064_local_source_workflow_materializations";
export const PRIVATE_KW_SOURCE_WORKFLOW_APPROVAL_CONFIRMATION =
  "I APPROVE THIS LOCAL SOURCE AND WORKFLOW MATERIALIZATION";
export const PRIVATE_KW_CODEX_DELEGATED_SOURCE_WORKFLOW_APPROVAL_VERSION =
  "kw-private-codex-source-workflow-approval-v2";
export const PRIVATE_KW_CODEX_SOURCE_WORKFLOW_APPROVAL_SCOPE =
  "LOCAL_SOURCE_WORKFLOW_MATERIALIZATION";
export const PRIVATE_KW_CODEX_SOURCE_WORKFLOW_APPROVAL_CONVERSATION_REF =
  "01a0c1de-dd92-7d33-827b-8aadccd47412";
export const PRIVATE_KW_CODEX_SOURCE_WORKFLOW_DELEGATION_QUOTE =
  "IM NOT DOING THE REVIEW AND DECISIONS YOU CAN DONIT YOURSELF";

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const TimestampSchema = z.string().datetime({ offset: true });
const SqlValueSchema = z.union([z.string(), z.number().finite(), z.null()]);
const MaterializationEntitySchema = z.enum([
  "SOURCE_RUN",
  "BUSINESS",
  "LOCATION",
  "SOURCE_RECORD",
  "WORKFLOW_DEFINITION",
  "WORKFLOW_RUN",
  "WORKFLOW_DELIVERY",
  "WORKFLOW_ATTEMPT",
  "WORKFLOW_RECEIPT",
  "WORKFLOW_CLOSURE",
  "MATERIALIZATION_RECEIPT",
]);

const PrivateKwSourceWorkflowOwnerApprovalSchema = z.object({
  decision: z.literal("APPROVED_FOR_LOCAL_SOURCE_WORKFLOW_MATERIALIZATION"),
  reviewedBy: z.enum(["RILEY", "AIDAN"]),
  reviewedAt: TimestampSchema,
  rationale: z.string().trim().min(10).max(500),
  confirmation: z.literal(PRIVATE_KW_SOURCE_WORKFLOW_APPROVAL_CONFIRMATION),
}).strict();

const PrivateKwSourceWorkflowCodexDelegatedApprovalSchema = z.object({
  approvalVersion: z.literal(PRIVATE_KW_CODEX_DELEGATED_SOURCE_WORKFLOW_APPROVAL_VERSION),
  decision: z.literal("APPROVED_FOR_LOCAL_SOURCE_WORKFLOW_MATERIALIZATION"),
  reviewer: z.literal("CODEX"),
  delegatedBy: z.literal("RILEY"),
  medium: z.literal("CODEX_CHAT"),
  instructionQuote: z.literal(PRIVATE_KW_CODEX_SOURCE_WORKFLOW_DELEGATION_QUOTE),
  instructionSha256: Sha256Schema,
  conversationRef: z.literal(PRIVATE_KW_CODEX_SOURCE_WORKFLOW_APPROVAL_CONVERSATION_REF),
  scope: z.literal(PRIVATE_KW_CODEX_SOURCE_WORKFLOW_APPROVAL_SCOPE),
  sourcePlanDigest: Sha256Schema,
  businessId: z.string().trim().min(1).max(128),
  evaluationCandidateId: z.string().trim().min(1).max(128),
  auditInputDigest: Sha256Schema,
  reviewedAt: TimestampSchema,
  rationale: z.string().trim().min(10).max(500),
  captureAuthorized: z.literal(false),
  contactDiscoveryAuthorized: z.literal(false),
  contactVerificationAuthorized: z.literal(false),
  outreachAuthorized: z.literal(false),
  sendAuthorized: z.literal(false),
  deploymentAuthorized: z.literal(false),
  providerOperationsAuthorized: z.literal(0),
  costAuthorizedUsd: z.literal(0),
}).strict().superRefine((approval, context) => {
  const actualDigest = createHash("sha256").update(approval.instructionQuote, "utf8").digest("hex");
  if (approval.instructionSha256 !== actualDigest) {
    context.addIssue({ code: "custom", path: ["instructionSha256"], message: "Delegation quote SHA-256 does not match the exact instruction text." });
  }
});

const PrivateKwSourceWorkflowApprovalSchema = z.union([
  PrivateKwSourceWorkflowOwnerApprovalSchema,
  PrivateKwSourceWorkflowCodexDelegatedApprovalSchema,
]);

export const PrivateKwSourceWorkflowMaterializationInputSchema = z.object({
  materializationVersion: z.enum([
    PRIVATE_KW_SOURCE_WORKFLOW_MATERIALIZATION_VERSION,
    PRIVATE_KW_CODEX_DELEGATED_SOURCE_WORKFLOW_MATERIALIZATION_VERSION,
  ]),
  sourceImportId: z.string().trim().min(8).max(128),
  sourcePlanDigest: Sha256Schema,
  businessId: z.string().trim().min(1).max(128),
  evaluationCandidateId: z.string().trim().min(1).max(128),
  auditInputDigest: Sha256Schema,
  auditInput: DeterministicWebsiteAuditInputSchema,
  evidenceCompletedAt: TimestampSchema,
  approval: PrivateKwSourceWorkflowApprovalSchema,
  mode: z.literal("SHADOW"),
  executionKind: z.literal("IGNORED_LOCAL_SQLITE"),
  localDatabaseAccessAuthorized: z.literal(true),
  localSourceMutationAuthorized: z.literal(true),
  localWorkflowMutationAuthorized: z.literal(true),
  localAssessmentMutationAuthorized: z.literal(false),
  schemaMutationAuthorized: z.literal(false),
  captureAuthorized: z.literal(false),
  contactDiscoveryAuthorized: z.literal(false),
  contactVerificationAuthorized: z.literal(false),
  outreachAuthorized: z.literal(false),
  sendAuthorized: z.literal(false),
  providerOperationsAuthorized: z.literal(0),
  costAuthorizedUsd: z.literal(0),
  deploymentAuthorized: z.literal(false).optional(),
}).strict().superRefine((input, context) => {
  if ("reviewer" in input.approval) {
    const approval = input.approval;
    if (input.materializationVersion !== PRIVATE_KW_CODEX_DELEGATED_SOURCE_WORKFLOW_MATERIALIZATION_VERSION) {
      context.addIssue({ code: "custom", path: ["materializationVersion"], message: "Codex delegation requires its versioned local materialization contract." });
    }
    const bindings: Array<[string, string, string]> = [
      ["sourcePlanDigest", approval.sourcePlanDigest, input.sourcePlanDigest],
      ["businessId", approval.businessId, input.businessId],
      ["evaluationCandidateId", approval.evaluationCandidateId, input.evaluationCandidateId],
      ["auditInputDigest", approval.auditInputDigest, input.auditInputDigest],
    ];
    for (const [field, approved, actual] of bindings) {
      if (approved !== actual) {
        context.addIssue({ code: "custom", path: ["approval", field], message: `Delegated approval must bind the exact ${field}.` });
      }
    }
    if (input.deploymentAuthorized !== false) {
      context.addIssue({ code: "custom", path: ["deploymentAuthorized"], message: "Delegated local approval must explicitly deny deployment authority." });
    }
  } else if (input.materializationVersion !== PRIVATE_KW_SOURCE_WORKFLOW_MATERIALIZATION_VERSION) {
    context.addIssue({ code: "custom", path: ["materializationVersion"], message: "The owner approval path requires its v1 materialization contract." });
  }
});

export type PrivateKwSourceWorkflowMaterializationInput = z.infer<
  typeof PrivateKwSourceWorkflowMaterializationInputSchema
>;

const MaterializationRecordPlanSchema = z.object({
  entity: MaterializationEntitySchema,
  recordId: z.string().trim().min(1).max(200),
  selectSql: z.string().trim().min(1).max(5_000),
  selectBindings: z.array(SqlValueSchema).max(10),
  expected: z.record(z.string().trim().min(1).max(100), SqlValueSchema),
  insertSql: z.string().trim().min(1).max(5_000),
  insertBindings: z.array(SqlValueSchema).max(40),
}).strict().superRefine((record, context) => {
  if (!/^SELECT\b/i.test(record.selectSql) || /\bLIMIT\s+1\b/i.test(record.selectSql)) {
    context.addIssue({ code: "custom", message: "Materialization preflights must be collision-complete SELECT statements.", path: ["selectSql"] });
  }
  if (!/^INSERT(?:\s+OR\s+IGNORE)?\s+INTO\b/i.test(record.insertSql)) {
    context.addIssue({ code: "custom", message: "Materialization mutations must be INSERT statements.", path: ["insertSql"] });
  }
});

export type PrivateKwSourceWorkflowRecordPlan = z.infer<typeof MaterializationRecordPlanSchema>;

const MaterializationAuthoritySchema = z.object({
  executionKind: z.literal("IGNORED_LOCAL_SQLITE"),
  transactionKind: z.literal("BETTER_SQLITE3_IMMEDIATE"),
  localOnly: z.literal(true),
  localDatabaseAccessAuthorized: z.literal(true),
  localSourceMutationAuthorized: z.literal(true),
  localWorkflowMutationAuthorized: z.literal(true),
  localAssessmentMutationAuthorized: z.literal(false),
  schemaMutationAuthorized: z.literal(false),
  captureAuthorized: z.literal(false),
  contactDiscoveryAuthorized: z.literal(false),
  contactVerificationAuthorized: z.literal(false),
  outreachAuthorized: z.literal(false),
  sendAuthorized: z.literal(false),
  providerOperationsAuthorized: z.literal(0),
  costAuthorizedUsd: z.literal(0),
  deploymentAuthorized: z.literal(false).optional(),
}).strict();

export const PrivateKwSourceWorkflowMaterializationPlanSchema = z.object({
  materializationVersion: z.enum([
    PRIVATE_KW_SOURCE_WORKFLOW_MATERIALIZATION_VERSION,
    PRIVATE_KW_CODEX_DELEGATED_SOURCE_WORKFLOW_MATERIALIZATION_VERSION,
  ]),
  targetSchemaVersion: z.literal(PRIVATE_KW_SOURCE_WORKFLOW_TARGET_SCHEMA_VERSION),
  materializationId: z.string().regex(/^kw-materialization:[a-f0-9]{64}$/),
  materializationDigest: Sha256Schema,
  sourceImportId: z.string().trim().min(8).max(128),
  sourcePlanDigest: Sha256Schema,
  businessId: z.string().trim().min(1).max(128),
  evaluationCandidateId: z.string().trim().min(1).max(128),
  auditInputDigest: Sha256Schema,
  auditDigest: Sha256Schema,
  workflowRunId: z.string().uuid(),
  workflowReceiptId: z.string().regex(/^workflow-receipt:[a-f0-9]{64}$/),
  recordedAt: TimestampSchema,
  records: z.array(MaterializationRecordPlanSchema).min(11).max(220),
  summary: z.object({
    sourceRuns: z.number().int().positive().max(9),
    businesses: z.number().int().positive().max(50),
    locations: z.number().int().positive().max(50),
    sourceRecords: z.number().int().positive().max(50),
    workflowRecords: z.literal(6),
    materializationReceipts: z.literal(1),
    qualificationRows: z.literal(0),
    contactRows: z.literal(0),
    outreachRows: z.literal(0),
    providerOperations: z.literal(0),
    costUsd: z.literal(0),
  }).strict(),
  authority: MaterializationAuthoritySchema,
  planDigest: Sha256Schema,
}).strict().superRefine((plan, context) => {
  const keys = plan.records.map((record) => `${record.entity}|${record.recordId}`);
  if (new Set(keys).size !== keys.length) {
    context.addIssue({ code: "custom", message: "Materialization record identities must be unique.", path: ["records"] });
  }
  if (plan.records.at(-1)?.entity !== "MATERIALIZATION_RECEIPT") {
    context.addIssue({ code: "custom", message: "The materialization receipt must commit last.", path: ["records"] });
  }
  const { planDigest, ...core } = plan;
  if (fingerprint(core) !== planDigest) {
    context.addIssue({ code: "custom", message: "Materialization plan digest must bind the exact trusted plan.", path: ["planDigest"] });
  }
});

export type PrivateKwSourceWorkflowMaterializationPlan = z.infer<
  typeof PrivateKwSourceWorkflowMaterializationPlanSchema
>;

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

export function privateKwSourceWorkflowCanonicalJson(value: unknown) {
  return JSON.stringify(canonicalValue(value));
}

export function privateKwSourceWorkflowDigest(value: unknown) {
  return fingerprint(value);
}

function fingerprint(value: unknown) {
  return createHash("sha256")
    .update(privateKwSourceWorkflowCanonicalJson(value))
    .digest("hex");
}

function deterministicUuid(seed: string) {
  const hash = createHash("sha256").update(seed).digest("hex").slice(0, 32).split("");
  hash[12] = "4";
  hash[16] = ((Number.parseInt(hash[16], 16) & 0x3) | 0x8).toString(16);
  const value = hash.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function normalizeComparable(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en-CA")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function columns(expected: Record<string, z.infer<typeof SqlValueSchema>>) {
  return Object.keys(expected).map((column) => `"${column}"`).join(", ");
}

function recordPlan(input: {
  entity: z.infer<typeof MaterializationEntitySchema>;
  table: string;
  recordId: string;
  expected: Record<string, z.infer<typeof SqlValueSchema>>;
  alternateWhere?: string;
  alternateBindings?: z.infer<typeof SqlValueSchema>[];
  insertSql?: string;
  insertBindings?: z.infer<typeof SqlValueSchema>[];
}): PrivateKwSourceWorkflowRecordPlan {
  const where = input.alternateWhere ? `"id" = ? OR (${input.alternateWhere})` : `"id" = ?`;
  const selectBindings = [input.recordId, ...(input.alternateBindings ?? [])];
  return MaterializationRecordPlanSchema.parse({
    entity: input.entity,
    recordId: input.recordId,
    selectSql: `SELECT ${columns(input.expected)} FROM "${input.table}" WHERE ${where} ORDER BY "id"`,
    selectBindings,
    expected: input.expected,
    insertSql: input.insertSql
      ?? `INSERT INTO "${input.table}" (${columns(input.expected)}) VALUES (${Object.keys(input.expected).map(() => "?").join(", ")})`,
    insertBindings: input.insertBindings ?? Object.values(input.expected),
  });
}

function definitionDescriptor() {
  const core = {
    definitionVersion: "kw-private-reviewed-evidence-definition-v1",
    workflowKind: "WEBSITE_EVIDENCE",
    workflowVersion: PRIVATE_KW_REVIEWED_EVIDENCE_WORKFLOW_VERSION,
    importKind: "OWNER_REVIEWED_LOCAL_EVIDENCE",
    inputContract: "DETERMINISTIC_WEBSITE_AUDIT_INPUT_V4",
    steps: ["RE_DERIVE_DETERMINISTIC_AUDIT", "SEAL_REVIEWED_RECEIPT"],
    authority: {
      captureAuthorized: false,
      providerOperationsAuthorized: 0,
      costAuthorizedUsd: 0,
    },
  };
  return { ...core, definitionDigest: fingerprint(core) };
}

function assertSelectedEvidence(
  source: PrivateKwImportPlan,
  input: PrivateKwSourceWorkflowMaterializationInput,
) {
  const selected = source.records.find((record) => record.business.id === input.businessId);
  if (!selected || selected.evaluationCandidateId !== input.evaluationCandidateId) {
    throw new Error("Materialization approval must select one exact private KW evaluation candidate.");
  }
  const auditInputDigest = fingerprint(input.auditInput);
  if (auditInputDigest !== input.auditInputDigest) {
    throw new Error("Materialization approval does not bind the exact deterministic audit input.");
  }
  if (
    input.auditInput.businessId !== selected.business.id
    || input.auditInput.businessName !== selected.business.canonicalName
    || normalizeComparable(input.auditInput.niche) !== normalizeComparable(selected.niche)
    || input.auditInput.sourceEvidenceUrl !== selected.sourceRecord.sourceEvidenceUrl
  ) {
    throw new Error("Deterministic audit identity must match the exact approved source record.");
  }
  const expectedCity = normalizeComparable(selected.location.city);
  if (!input.auditInput.expectedLocations.some((location) => normalizeComparable(location) === expectedCity)) {
    throw new Error("Deterministic audit locations must include the approved business city.");
  }
  const expectedNiche = normalizeComparable(selected.niche);
  if (!input.auditInput.expectedServices.some((service) => normalizeComparable(service).includes(expectedNiche))) {
    throw new Error("Deterministic audit services must include the approved business niche.");
  }
  if (selected.sourceRecord.websiteUrl === null) {
    if (input.auditInput.siteState !== "NO_SITE" || input.auditInput.requestedUrl || input.auditInput.finalUrl) {
      throw new Error("A source record without a website requires an exact NO_SITE audit input.");
    }
  } else if (
    input.auditInput.siteState === "NO_SITE"
    || input.auditInput.requestedUrl !== selected.sourceRecord.websiteUrl
  ) {
    throw new Error("A source record with a website requires an audit of that exact canonical URL.");
  }
  const sourceCapturedAt = Date.parse(selected.sourceRecord.capturedAt);
  const auditCapturedAt = Date.parse(input.auditInput.capturedAt);
  const evidenceCompletedAt = Date.parse(input.evidenceCompletedAt);
  const reviewedAt = Date.parse(input.approval.reviewedAt);
  if (
    sourceCapturedAt > auditCapturedAt
    || auditCapturedAt > evidenceCompletedAt
    || evidenceCompletedAt > reviewedAt
  ) {
    throw new Error("Source capture, audit capture, evidence completion, and approval must be chronologically ordered.");
  }
  const artifactRefs = [
    input.auditInput.desktopArtifactRef,
    input.auditInput.mobileArtifactRef,
    input.auditInput.domArtifactRef,
  ].filter((value): value is string => value !== null);
  if (artifactRefs.some((value) => !/^artifact:sha256:[a-f0-9]{64}$/.test(value))) {
    throw new Error("Materialized audit artifacts must use content-addressed references.");
  }
  return selected;
}

export function verifyPrivateKwSourceWorkflowPreflight(
  record: PrivateKwSourceWorkflowRecordPlan,
  rows: readonly Record<string, unknown>[],
) {
  const validated = MaterializationRecordPlanSchema.parse(record);
  if (rows.length === 0) return { state: "MISSING" as const, matches: true };
  if (rows.length !== 1) return { state: "CONFLICT" as const, matches: false };
  const comparable = Object.fromEntries(
    Object.keys(validated.expected).map((key) => [key, rows[0][key] ?? null]),
  );
  const matches = fingerprint(comparable) === fingerprint(validated.expected);
  return { state: matches ? "EXACT_MATCH" as const : "CONFLICT" as const, matches };
}

export function buildPrivateKwSourceWorkflowMaterializationPlan(
  sourceValue: unknown,
  inputValue: unknown,
): PrivateKwSourceWorkflowMaterializationPlan {
  const source = PrivateKwImportPlanSchema.parse(sourceValue);
  const input = PrivateKwSourceWorkflowMaterializationInputSchema.parse(inputValue);
  const sourcePlan = buildPrivateKwPersistencePlan(source);
  if (
    input.sourceImportId !== source.importId
    || input.sourcePlanDigest !== sourcePlan.sourcePlanDigest
  ) {
    throw new Error("Materialization approval must bind the exact private KW source plan.");
  }
  const selected = assertSelectedEvidence(source, input);
  const audit = auditWebsiteDeterministically(input.auditInput);
  const auditDigest = fingerprint(audit);
  const definition = definitionDescriptor();
  const workflowSeed = `${sourcePlan.sourcePlanDigest}|${selected.business.id}|${input.auditInputDigest}`;
  const workflowRunId = deterministicUuid(`workflow|${workflowSeed}`);
  const workflowIdempotencyKey = `kw-reviewed-evidence:${fingerprint(workflowSeed)}`;
  const request = {
    requestVersion: "kw-private-reviewed-evidence-request-v1",
    workflowId: workflowRunId,
    workflowVersion: PRIVATE_KW_REVIEWED_EVIDENCE_WORKFLOW_VERSION,
    idempotencyKey: workflowIdempotencyKey,
    businessId: selected.business.id,
    evaluationCandidateId: selected.evaluationCandidateId,
    sourceImportId: source.importId,
    sourcePlanDigest: sourcePlan.sourcePlanDigest,
    auditInputDigest: input.auditInputDigest,
    requestedAt: selected.sourceRecord.capturedAt,
    mode: "SHADOW",
    orchestratorKind: "LOCAL_REVIEWED_IMPORT",
    maxCostUsd: 0,
    authority: {
      captureAuthorized: false,
      providerOperationsAuthorized: 0,
      costAuthorizedUsd: 0,
    },
  };
  const requestDigest = fingerprint(request);
  const deliveryId = deterministicUuid(`delivery|${workflowSeed}`);
  const delivery = {
    deliveryVersion: "kw-private-reviewed-evidence-delivery-v1",
    deliveryId,
    workflowId: workflowRunId,
    workflowVersion: PRIVATE_KW_REVIEWED_EVIDENCE_WORKFLOW_VERSION,
    definitionDigest: definition.definitionDigest,
    requestDigest,
    payloadDigest: requestDigest,
    receivedAt: selected.sourceRecord.capturedAt,
    mode: "SHADOW",
    deliveryKind: "FIXTURE",
    importKind: "OWNER_REVIEWED_LOCAL_EVIDENCE",
  };
  const deliveryDigest = fingerprint(delivery);
  const attemptId = deterministicUuid(`attempt|${workflowSeed}`);
  const attempt = {
    attemptVersion: "kw-private-reviewed-evidence-attempt-v1",
    attemptId,
    workflowId: workflowRunId,
    workflowVersion: PRIVATE_KW_REVIEWED_EVIDENCE_WORKFLOW_VERSION,
    definitionDigest: definition.definitionDigest,
    requestDigest,
    deliveryId,
    attemptNumber: 1,
    fencingToken: 1,
    startedAt: selected.sourceRecord.capturedAt,
    executionKind: "OWNER_REVIEWED_LOCAL_IMPORT",
  };
  const attemptDigest = fingerprint(attempt);
  const receipt = {
    workflowVersion: PRIVATE_KW_REVIEWED_EVIDENCE_WORKFLOW_VERSION,
    workflowId: workflowRunId,
    businessId: selected.business.id,
    completedAt: input.evidenceCompletedAt,
    mode: "SHADOW",
    status: "COMPLETED",
    audit,
    budget: { totalCostUsd: 0, providerOperations: 0 },
    source: {
      sourceImportId: source.importId,
      sourcePlanDigest: sourcePlan.sourcePlanDigest,
      evaluationCandidateId: selected.evaluationCandidateId,
      auditInputDigest: input.auditInputDigest,
      importKind: "OWNER_REVIEWED_LOCAL_EVIDENCE",
    },
    authority: {
      captureAuthorized: false,
      contactDiscoveryAuthorized: false,
      outreachAuthorized: false,
      sendAuthorized: false,
      providerOperationsAuthorized: 0,
      costAuthorizedUsd: 0,
      ...("reviewer" in input.approval ? { deploymentAuthorized: false as const } : {}),
    },
  };
  const receiptDigest = fingerprint(receipt);
  const workflowReceiptId = `workflow-receipt:${receiptDigest}`;
  const closureId = `workflow-closure:${fingerprint(`${attemptId}|${workflowReceiptId}`)}`;
  const closure = {
    closureVersion: "kw-private-reviewed-evidence-closure-v1",
    closureId,
    workflowId: workflowRunId,
    attemptId,
    status: "SEALED",
    endedAt: input.approval.reviewedAt,
    terminalReceiptId: workflowReceiptId,
    effectiveAt: input.approval.reviewedAt,
  };
  const closureDigest = fingerprint(closure);

  const sourceMutationByKey = new Map(
    sourcePlan.mutations.map((mutation) => [`${mutation.entity}|${mutation.recordId}`, mutation]),
  );
  const records: PrivateKwSourceWorkflowRecordPlan[] = sourcePlan.preflights.map((preflight) => {
    const mutation = sourceMutationByKey.get(`${preflight.entity}|${preflight.recordId}`);
    if (!mutation) throw new Error("Trusted source persistence plan is missing a matching mutation.");
    return MaterializationRecordPlanSchema.parse({
      entity: preflight.entity,
      recordId: preflight.recordId,
      selectSql: `${preflight.selectSql} ORDER BY "id"`,
      selectBindings: preflight.bindings,
      expected: preflight.expected,
      insertSql: mutation.sql,
      insertBindings: mutation.bindings,
    });
  });

  const definitionExpected = {
    id: definition.definitionDigest,
    workflowKind: "WEBSITE_EVIDENCE",
    definitionVersion: definition.definitionVersion,
    definitionDigest: definition.definitionDigest,
    definitionJson: privateKwSourceWorkflowCanonicalJson(definition),
  };
  records.push(recordPlan({
    entity: "WORKFLOW_DEFINITION",
    table: "RevenueWorkflowDefinition",
    recordId: definition.definitionDigest,
    expected: definitionExpected,
    alternateWhere: `"workflowKind" = ? AND "definitionVersion" = ?`,
    alternateBindings: ["WEBSITE_EVIDENCE", definition.definitionVersion],
  }));

  const runExpected = {
    id: workflowRunId,
    workflowKind: "WEBSITE_EVIDENCE",
    workflowVersion: PRIVATE_KW_REVIEWED_EVIDENCE_WORKFLOW_VERSION,
    idempotencyKey: workflowIdempotencyKey,
    businessId: selected.business.id,
    mode: "SHADOW",
    orchestratorKind: "LOCAL_REVIEWED_IMPORT",
    requestDigest,
    requestJson: privateKwSourceWorkflowCanonicalJson(request),
    maxCostUsd: 0,
    requestedAt: selected.sourceRecord.capturedAt,
  };
  records.push(recordPlan({
    entity: "WORKFLOW_RUN",
    table: "RevenueWorkflowRun",
    recordId: workflowRunId,
    expected: runExpected,
    alternateWhere: `"workflowKind" = ? AND "idempotencyKey" = ?`,
    alternateBindings: ["WEBSITE_EVIDENCE", workflowIdempotencyKey],
  }));

  const deliveryExpected = {
    id: deliveryId,
    workflowRunId,
    definitionId: definition.definitionDigest,
    deliveryVersion: delivery.deliveryVersion,
    workflowVersion: delivery.workflowVersion,
    requestDigest,
    payloadDigest: requestDigest,
    deliveryDigest,
    deliveryJson: privateKwSourceWorkflowCanonicalJson(delivery),
    receivedAt: delivery.receivedAt,
    mode: "SHADOW",
    deliveryKind: "FIXTURE",
  };
  records.push(recordPlan({
    entity: "WORKFLOW_DELIVERY",
    table: "RevenueWorkflowDelivery",
    recordId: deliveryId,
    expected: deliveryExpected,
    alternateWhere: `"workflowRunId" = ?`,
    alternateBindings: [workflowRunId],
  }));

  const attemptExpected = {
    id: attemptId,
    workflowRunId,
    definitionId: definition.definitionDigest,
    deliveryId,
    attemptVersion: attempt.attemptVersion,
    workflowVersion: attempt.workflowVersion,
    requestDigest,
    attemptNumber: 1,
    fencingToken: 1,
    startedAt: attempt.startedAt,
    attemptDigest,
    attemptJson: privateKwSourceWorkflowCanonicalJson(attempt),
  };
  records.push(recordPlan({
    entity: "WORKFLOW_ATTEMPT",
    table: "RevenueWorkflowAttempt",
    recordId: attemptId,
    expected: attemptExpected,
    alternateWhere: `("workflowRunId" = ? AND "attemptNumber" = ?) OR ("workflowRunId" = ? AND "fencingToken" = ?)`,
    alternateBindings: [workflowRunId, 1, workflowRunId, 1],
  }));

  const receiptExpected = {
    id: workflowReceiptId,
    workflowRunId,
    definitionId: definition.definitionDigest,
    attemptId,
    revisionVersion: "kw-private-reviewed-evidence-receipt-v1",
    workflowVersion: PRIVATE_KW_REVIEWED_EVIDENCE_WORKFLOW_VERSION,
    requestDigest,
    attemptNumber: 1,
    status: "COMPLETED",
    receiptDigest,
    receiptJson: privateKwSourceWorkflowCanonicalJson(receipt),
    recordedAt: input.approval.reviewedAt,
  };
  records.push(recordPlan({
    entity: "WORKFLOW_RECEIPT",
    table: "RevenueWorkflowReceiptRevision",
    recordId: workflowReceiptId,
    expected: receiptExpected,
    alternateWhere: `"attemptId" = ? OR ("workflowRunId" = ? AND "receiptDigest" = ?)`,
    alternateBindings: [attemptId, workflowRunId, receiptDigest],
  }));

  const closureExpected = {
    id: closureId,
    workflowRunId,
    attemptId,
    status: "SEALED",
    endedAt: input.approval.reviewedAt,
    terminalReceiptId: workflowReceiptId,
    closureDigest,
    closureJson: privateKwSourceWorkflowCanonicalJson(closure),
    effectiveAt: input.approval.reviewedAt,
  };
  records.push(recordPlan({
    entity: "WORKFLOW_CLOSURE",
    table: "RevenueWorkflowAttemptClosure",
    recordId: closureId,
    expected: closureExpected,
    alternateWhere: `"attemptId" = ?`,
    alternateBindings: [attemptId],
  }));

  const materializationCore = {
    materializationVersion: input.materializationVersion,
    sourceImportId: source.importId,
    sourcePlanDigest: sourcePlan.sourcePlanDigest,
    businessId: selected.business.id,
    evaluationCandidateId: selected.evaluationCandidateId,
    auditInputDigest: input.auditInputDigest,
    auditDigest,
    workflowRunId,
    workflowReceiptId,
    recordedAt: input.approval.reviewedAt,
    approval: input.approval,
    summary: {
      sourceRuns: sourcePlan.summary.sourceRuns,
      businesses: sourcePlan.summary.businesses,
      locations: sourcePlan.summary.locations,
      sourceRecords: sourcePlan.summary.sourceRecords,
      workflowRecords: 6,
    },
    authority: {
      executionKind: "IGNORED_LOCAL_SQLITE",
      transactionKind: "BETTER_SQLITE3_IMMEDIATE",
      localOnly: true,
      localDatabaseAccessAuthorized: true,
      localSourceMutationAuthorized: true,
      localWorkflowMutationAuthorized: true,
      localAssessmentMutationAuthorized: false,
      schemaMutationAuthorized: false,
      captureAuthorized: false,
      contactDiscoveryAuthorized: false,
      contactVerificationAuthorized: false,
      outreachAuthorized: false,
      sendAuthorized: false,
      providerOperationsAuthorized: 0,
      costAuthorizedUsd: 0,
      ...("reviewer" in input.approval ? { deploymentAuthorized: false as const } : {}),
    },
  } as const;
  const materializationDigest = fingerprint(materializationCore);
  const materializationId = `kw-materialization:${materializationDigest}`;
  const materializationExpected = {
    id: materializationId,
    materializationVersion: input.materializationVersion,
    sourceImportId: source.importId,
    sourcePlanDigest: sourcePlan.sourcePlanDigest,
    businessId: selected.business.id,
    evaluationCandidateId: selected.evaluationCandidateId,
    workflowRunId,
    workflowReceiptId,
    sourceRunCount: sourcePlan.summary.sourceRuns,
    businessCount: sourcePlan.summary.businesses,
    locationCount: sourcePlan.summary.locations,
    sourceRecordCount: sourcePlan.summary.sourceRecords,
    workflowRecordCount: 6,
    materializationDigest,
    materializationJson: privateKwSourceWorkflowCanonicalJson(materializationCore),
    recordedAt: input.approval.reviewedAt,
    executionKind: "IGNORED_LOCAL_SQLITE",
    transactionKind: "BETTER_SQLITE3_IMMEDIATE",
    localOnly: 1,
    localSourceMutationAuthorized: 1,
    localWorkflowMutationAuthorized: 1,
    localAssessmentMutationAuthorized: 0,
    schemaMutationAuthorized: 0,
    captureAuthorized: 0,
    contactDiscoveryAuthorized: 0,
    contactVerificationAuthorized: 0,
    outreachAuthorized: 0,
    sendAuthorized: 0,
    providerOperationsAuthorized: 0,
    costAuthorizedUsd: 0,
  };
  records.push(recordPlan({
    entity: "MATERIALIZATION_RECEIPT",
    table: "RevenuePrivateKwMaterializationReceipt",
    recordId: materializationId,
    expected: materializationExpected,
    alternateWhere: `"sourcePlanDigest" = ? AND "workflowReceiptId" = ?`,
    alternateBindings: [sourcePlan.sourcePlanDigest, workflowReceiptId],
  }));

  const core = {
    materializationVersion: input.materializationVersion,
    targetSchemaVersion: PRIVATE_KW_SOURCE_WORKFLOW_TARGET_SCHEMA_VERSION,
    materializationId,
    materializationDigest,
    sourceImportId: source.importId,
    sourcePlanDigest: sourcePlan.sourcePlanDigest,
    businessId: selected.business.id,
    evaluationCandidateId: selected.evaluationCandidateId,
    auditInputDigest: input.auditInputDigest,
    auditDigest,
    workflowRunId,
    workflowReceiptId,
    recordedAt: input.approval.reviewedAt,
    records,
    summary: {
      sourceRuns: sourcePlan.summary.sourceRuns,
      businesses: sourcePlan.summary.businesses,
      locations: sourcePlan.summary.locations,
      sourceRecords: sourcePlan.summary.sourceRecords,
      workflowRecords: 6,
      materializationReceipts: 1,
      qualificationRows: 0,
      contactRows: 0,
      outreachRows: 0,
      providerOperations: 0,
      costUsd: 0,
    },
    authority: materializationCore.authority,
  };
  return PrivateKwSourceWorkflowMaterializationPlanSchema.parse({
    ...core,
    planDigest: fingerprint(core),
  });
}
