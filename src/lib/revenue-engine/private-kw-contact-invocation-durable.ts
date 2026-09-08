import { z } from "zod";

import {
  loadPrivateRevenueLeadAssessmentD1,
  type RevenueLeadAssessmentD1Boundary,
  type RevenueLeadAssessmentD1Statement,
} from "@/lib/revenue-engine/lead-assessment-d1";
import {
  revenueLeadAssessmentCanonicalJson,
} from "@/lib/revenue-engine/lead-assessment";
import {
  PrivateKwContactInvocationReceiptRowSchema,
  PrivateKwContactInvocationSchema,
  buildPrivateKwContactInvocationReceiptRow,
} from "@/lib/revenue-engine/private-kw-contact-invocation";
import {
  buildPrivateKwContactPersistencePlan,
  verifyPrivateKwContactPersistencePreflight,
} from "@/lib/revenue-engine/private-kw-contact-persistence";
import {
  PRIVATE_KW_SOURCE_WORKFLOW_MATERIALIZATION_VERSION,
  privateKwSourceWorkflowDigest,
} from "@/lib/revenue-engine/private-kw-source-workflow-materialization";

export const PRIVATE_KW_CONTACT_INVOCATION_DURABLE_VERSION =
  "kw-contact-invocation-durable-v1";
export const PRIVATE_KW_CONTACT_INVOCATION_DURABLE_TARGET_SCHEMA_VERSION =
  "0067_local_contact_invocation_receipts";

const TimestampSchema = z.string().datetime({ offset: true });
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const SqlValueSchema = z.union([z.string(), z.number().finite(), z.null()]);
const SqlRowSchema = z.record(z.string(), SqlValueSchema);

const BatchResultSchema = z.object({
  success: z.literal(true),
  results: z.array(SqlRowSchema).max(5_000),
  changes: z.number().int().nonnegative(),
}).strict();
const DatabaseTimeRowSchema = z.object({ databaseNow: TimestampSchema }).strict();
const TriggerRowSchema = z.object({ name: z.string(), sql: z.string().min(1) }).strict();

const SourceMaterializationAuthoritySchema = z.object({
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
}).strict();

const SourceMaterializationCoreSchema = z.object({
  materializationVersion: z.literal(PRIVATE_KW_SOURCE_WORKFLOW_MATERIALIZATION_VERSION),
  sourceImportId: z.string().trim().min(8).max(128),
  sourcePlanDigest: Sha256Schema,
  businessId: z.string().trim().min(1).max(80),
  evaluationCandidateId: z.string().trim().min(1).max(80),
  auditInputDigest: Sha256Schema,
  auditDigest: Sha256Schema,
  workflowRunId: z.string().uuid(),
  workflowReceiptId: z.string().regex(/^workflow-receipt:[a-f0-9]{64}$/),
  recordedAt: TimestampSchema,
  approval: z.unknown(),
  summary: z.object({
    sourceRuns: z.number().int().min(1).max(9),
    businesses: z.number().int().min(1).max(50),
    locations: z.number().int().min(1).max(50),
    sourceRecords: z.number().int().min(1).max(50),
    workflowRecords: z.literal(6),
  }).strict(),
  authority: SourceMaterializationAuthoritySchema,
}).strict();

const SourceMaterializationRowSchema = z.object({
  id: z.string().regex(/^kw-materialization:[a-f0-9]{64}$/),
  materializationVersion: z.literal(PRIVATE_KW_SOURCE_WORKFLOW_MATERIALIZATION_VERSION),
  sourceImportId: z.string().trim().min(8).max(128),
  sourcePlanDigest: Sha256Schema,
  businessId: z.string().trim().min(1).max(80),
  evaluationCandidateId: z.string().trim().min(1).max(80),
  workflowRunId: z.string().uuid(),
  workflowReceiptId: z.string().regex(/^workflow-receipt:[a-f0-9]{64}$/),
  sourceRunCount: z.number().int().min(1).max(9),
  businessCount: z.number().int().min(1).max(50),
  locationCount: z.number().int().min(1).max(50),
  sourceRecordCount: z.number().int().min(1).max(50),
  workflowRecordCount: z.literal(6),
  materializationDigest: Sha256Schema,
  materializationJson: z.string().min(2).max(8_388_608),
  recordedAt: TimestampSchema,
  executionKind: z.literal("IGNORED_LOCAL_SQLITE"),
  transactionKind: z.literal("BETTER_SQLITE3_IMMEDIATE"),
  localOnly: z.literal(1),
  localSourceMutationAuthorized: z.literal(1),
  localWorkflowMutationAuthorized: z.literal(1),
  localAssessmentMutationAuthorized: z.literal(0),
  schemaMutationAuthorized: z.literal(0),
  captureAuthorized: z.literal(0),
  contactDiscoveryAuthorized: z.literal(0),
  contactVerificationAuthorized: z.literal(0),
  outreachAuthorized: z.literal(0),
  sendAuthorized: z.literal(0),
  providerOperationsAuthorized: z.literal(0),
  costAuthorizedUsd: z.literal(0),
}).strict();

const DurableAuthoritySchema = z.object({
  proofInputOnly: z.literal(true),
  phaseInputCreationAuthorized: z.literal(false),
  progressReceiptCreationAuthorized: z.literal(false),
  phaseAdvancementAuthorized: z.literal(false),
  databaseMutationAuthorized: z.literal(false),
  sourceMutationAuthorized: z.literal(false),
  workflowMutationAuthorized: z.literal(false),
  assessmentMutationAuthorized: z.literal(false),
  contactDiscoveryExecutionAuthorized: z.literal(false),
  contactVerificationExecutionAuthorized: z.literal(false),
  consentDecisionAuthorized: z.literal(false),
  qualificationAuthorized: z.literal(false),
  outreachAuthorized: z.literal(false),
  sendAuthorized: z.literal(false),
  deploymentAuthorized: z.literal(false),
  providerOperationsAuthorized: z.literal(0),
  costAuthorizedUsd: z.literal(0),
}).strict();

export const PrivateKwContactInvocationDurableReloadSchema = z.object({
  durableVersion: z.literal(PRIVATE_KW_CONTACT_INVOCATION_DURABLE_VERSION),
  targetSchemaVersion: z.literal(PRIVATE_KW_CONTACT_INVOCATION_DURABLE_TARGET_SCHEMA_VERSION),
  executionPath: z.literal("DURABLE_RELOAD"),
  transactionApi: z.literal("RevenueLeadAssessmentD1Boundary.batch"),
  invocation: PrivateKwContactInvocationSchema,
  assessment: z.object({
    assessmentId: z.string().regex(/^assessment:[a-f0-9]{64}$/),
    assessmentDigest: Sha256Schema,
    assessedAt: TimestampSchema,
    refreshAfter: TimestampSchema,
    databaseNow: TimestampSchema,
    freshnessState: z.enum(["NOT_YET_CURRENT", "CURRENT", "STALE"]),
    exactSourceRebuilt: z.literal(true),
  }).strict(),
  sourceMaterialization: z.object({
    materializationId: z.string().regex(/^kw-materialization:[a-f0-9]{64}$/),
    materializationDigest: Sha256Schema,
    sourceImportId: z.string().trim().min(8).max(128),
    sourcePlanDigest: Sha256Schema,
    businessId: z.string().trim().min(1).max(80),
    evaluationCandidateId: z.string().trim().min(1).max(80),
    workflowRunId: z.string().uuid(),
    workflowReceiptId: z.string().regex(/^workflow-receipt:[a-f0-9]{64}$/),
    recordedAt: TimestampSchema,
  }).strict(),
  contactMaterialization: z.object({
    materializationId: z.string().regex(/^kw-contact-persistence:[a-f0-9]{64}$/),
    materializationDigest: Sha256Schema,
    discoveryReceiptId: z.string().regex(/^contact-discovery-result:[a-f0-9]{64}$/),
    discoveryResultDigest: Sha256Schema,
    recordedAt: TimestampSchema,
    exactPlanRebuilt: z.literal(true),
  }).strict(),
  invocationReceiptRecordedAt: TimestampSchema,
  databaseNow: TimestampSchema,
  evidenceFreshThrough: TimestampSchema,
  freshnessState: z.enum(["NOT_YET_CURRENT", "CURRENT", "STALE"]),
  reloadedRows: z.object({
    sourceMaterializationReceipts: z.literal(1),
    assessmentReceipts: z.literal(1),
    discoveryReceipts: z.literal(1),
    contactPointVersions: z.number().int().min(0).max(25),
    evidenceClaims: z.number().int().min(0).max(500),
    evidenceUses: z.number().int().min(0).max(500),
    verificationResults: z.number().int().min(0).max(250),
    contactMaterializationReceipts: z.literal(1),
    contactInvocationReceipts: z.literal(1),
  }).strict(),
  exactAssessmentReloaded: z.literal(true),
  exactContactPlanRebuilt: z.literal(true),
  immutableWriterGuardsVerified: z.literal(true),
  committedAndReloaded: z.literal(true),
  databaseReadPerformed: z.literal(true),
  databaseMutationPerformed: z.literal(false),
  persistenceScope: z.literal("EXACT_IMMUTABLE_CONTACT_INVOCATION_ROW_SET"),
  runtimeConnected: z.literal(false),
  authority: DurableAuthoritySchema,
}).strict().superRefine((result, context) => {
  if (
    result.invocation.invocationId !== `kw-contact-invocation:${result.invocation.invocationDigest}`
    || result.invocation.contactMaterializationId !== result.contactMaterialization.materializationId
    || result.invocation.assessment.assessmentReceiptId !== result.assessment.assessmentId
    || result.invocation.assessment.assessmentDigest !== result.assessment.assessmentDigest
  ) {
    context.addIssue({
      code: "custom",
      message: "Durable contact reload identities must bind one exact invocation, assessment, and materialization.",
      path: ["invocation"],
    });
  }
  if (result.freshnessState === "CURRENT" && result.assessment.freshnessState !== "CURRENT") {
    context.addIssue({
      code: "custom",
      message: "A current durable contact reload requires a current nested assessment reload.",
      path: ["assessment", "freshnessState"],
    });
  }
});

export type PrivateKwContactInvocationDurableReload = z.infer<
  typeof PrivateKwContactInvocationDurableReloadSchema
>;

const trustedDurableContactReloads = new WeakSet<object>();

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return Object.freeze(value);
}

export function requireTrustedPrivateKwContactInvocationDurableReload(
  value: unknown,
): PrivateKwContactInvocationDurableReload {
  PrivateKwContactInvocationDurableReloadSchema.parse(value);
  if (!value || typeof value !== "object" || !trustedDurableContactReloads.has(value)) {
    throw new Error(
      "Contact invocation persistence must be the exact in-process result of the private durable reload boundary.",
    );
  }
  return value as PrivateKwContactInvocationDurableReload;
}

export function requireCurrentPrivateKwContactInvocationDurableReload(
  value: unknown,
): PrivateKwContactInvocationDurableReload & { freshnessState: "CURRENT" } {
  const result = requireTrustedPrivateKwContactInvocationDurableReload(value);
  if (result.freshnessState !== "CURRENT") {
    throw new Error("Durable contact invocation persistence is not current at the database clock.");
  }
  return result as PrivateKwContactInvocationDurableReload & { freshnessState: "CURRENT" };
}

export const PRIVATE_KW_CONTACT_INVOCATION_REQUIRED_TRIGGER_MARKERS = {
  RevenuePrivateKwMaterializationReceipt_lineage_insert: "REVENUE_PRIVATE_KW_MATERIALIZATION_LINEAGE_MISMATCH",
  RevenuePrivateKwMaterializationReceipt_immutable_update: "REVENUE_PRIVATE_KW_MATERIALIZATION_APPEND_ONLY",
  RevenuePrivateKwMaterializationReceipt_immutable_delete: "REVENUE_PRIVATE_KW_MATERIALIZATION_APPEND_ONLY",
  RevenueContactPoint_contract_insert: "REVENUE_CONTACT_CONTRACT_REQUIRED",
  RevenueContactEvidenceUse_contract_insert: "REVENUE_CONTACT_EVIDENCE_MISMATCH",
  RevenueVerificationResult_contract_insert: "REVENUE_CONTACT_VERIFICATION_MISMATCH",
  RevenueContactDiscoveryReceipt_lineage_insert: "REVENUE_CONTACT_RECEIPT_MISMATCH",
  RevenueContactPoint_lineage_insert: "REVENUE_CONTACT_LINEAGE_MISMATCH",
  RevenueContactEvidenceUse_lineage_insert: "REVENUE_CONTACT_EVIDENCE_LINEAGE_MISMATCH",
  RevenueVerificationResult_payload_insert: "REVENUE_CONTACT_VERIFICATION_PAYLOAD_MISMATCH",
  RevenueContactDiscoveryReceipt_immutable_update: "REVENUE_CONTACT_APPEND_ONLY",
  RevenueContactDiscoveryReceipt_immutable_delete: "REVENUE_CONTACT_APPEND_ONLY",
  RevenueContactPoint_immutable_update: "REVENUE_CONTACT_APPEND_ONLY",
  RevenueContactPoint_immutable_delete: "REVENUE_CONTACT_APPEND_ONLY",
  RevenueContactEvidenceClaim_immutable_update: "REVENUE_CONTACT_APPEND_ONLY",
  RevenueContactEvidenceClaim_immutable_delete: "REVENUE_CONTACT_APPEND_ONLY",
  RevenueContactEvidenceUse_immutable_update: "REVENUE_CONTACT_APPEND_ONLY",
  RevenueContactEvidenceUse_immutable_delete: "REVENUE_CONTACT_APPEND_ONLY",
  RevenueVerificationResult_immutable_update: "REVENUE_CONTACT_APPEND_ONLY",
  RevenueVerificationResult_immutable_delete: "REVENUE_CONTACT_APPEND_ONLY",
  RevenuePrivateKwContactPersistenceReceipt_identity_insert: "REVENUE_PRIVATE_KW_CONTACT_PERSISTENCE_IDENTITY_MISMATCH",
  RevenuePrivateKwContactPersistenceReceipt_lineage_insert: "REVENUE_PRIVATE_KW_CONTACT_PERSISTENCE_LINEAGE_MISMATCH",
  RevenuePrivateKwContactPersistenceReceipt_immutable_update: "REVENUE_PRIVATE_KW_CONTACT_PERSISTENCE_APPEND_ONLY",
  RevenuePrivateKwContactPersistenceReceipt_immutable_delete: "REVENUE_PRIVATE_KW_CONTACT_PERSISTENCE_APPEND_ONLY",
  RevenuePrivateKwContactInvocationReceipt_lineage_insert: "REVENUE_PRIVATE_KW_CONTACT_INVOCATION_LINEAGE_MISMATCH",
  RevenuePrivateKwContactInvocationReceipt_immutable_update: "REVENUE_PRIVATE_KW_CONTACT_INVOCATION_APPEND_ONLY",
  RevenuePrivateKwContactInvocationReceipt_immutable_delete: "REVENUE_PRIVATE_KW_CONTACT_INVOCATION_APPEND_ONLY",
} as const;

function statement(
  statementId: string,
  sql: string,
  bindings: RevenueLeadAssessmentD1Statement["bindings"] = [],
): RevenueLeadAssessmentD1Statement {
  return { statementId, sql, bindings };
}

const CONTACT_TRIGGER_STATEMENT = statement(
  "read:contact_invocation_writer_guards",
  `SELECT "name", "sql" FROM "sqlite_master"
   WHERE "type" = 'trigger' AND "name" IN (${Object.keys(PRIVATE_KW_CONTACT_INVOCATION_REQUIRED_TRIGGER_MARKERS).map(() => "?").join(", ")})
   ORDER BY "name"`,
  Object.keys(PRIVATE_KW_CONTACT_INVOCATION_REQUIRED_TRIGGER_MARKERS),
);

const CONTACT_DATABASE_TIME_STATEMENT = statement(
  "read:contact_invocation_database_time",
  `SELECT strftime('%Y-%m-%dT%H:%M:%fZ', 'now') AS "databaseNow"`,
);

const INVOCATION_RECEIPT_COLUMNS = Object.keys(
  PrivateKwContactInvocationReceiptRowSchema.shape,
) as (keyof z.infer<typeof PrivateKwContactInvocationReceiptRowSchema>)[];

function invocationReceiptStatement(identity: {
  invocationId: string;
  invocationDigest: string;
}) {
  return statement(
    "read:durable_contact_invocation_receipt",
    `SELECT ${INVOCATION_RECEIPT_COLUMNS.map((column) => `"${column}"`).join(", ")}
     FROM "RevenuePrivateKwContactInvocationReceipt"
     WHERE "id" = ? OR "invocationDigest" = ?
     ORDER BY "id"`,
    [identity.invocationId, identity.invocationDigest],
  );
}

const SOURCE_MATERIALIZATION_COLUMNS = Object.keys(
  SourceMaterializationRowSchema.shape,
) as (keyof z.infer<typeof SourceMaterializationRowSchema>)[];

function sourceMaterializationStatement(invocation: z.infer<typeof PrivateKwContactInvocationSchema>) {
  return statement(
    "read:durable_contact_source_materialization",
    `SELECT ${SOURCE_MATERIALIZATION_COLUMNS.map((column) => `"${column}"`).join(", ")}
     FROM "RevenuePrivateKwMaterializationReceipt"
     WHERE "sourcePlanDigest" = ? AND "businessId" = ?
     ORDER BY "id"`,
    [invocation.sourcePlanDigest, invocation.businessId],
  );
}

function parseBatchResults(raw: readonly unknown[], expectedCount: number) {
  if (raw.length !== expectedCount) {
    throw new Error("SQL returned an unexpected durable contact batch result count.");
  }
  return raw.map((result) => {
    const parsed = BatchResultSchema.parse(result);
    if (parsed.changes !== 0) {
      throw new Error("Durable contact reload must be read-only.");
    }
    return parsed;
  });
}

async function readStatements(
  boundary: RevenueLeadAssessmentD1Boundary,
  statements: readonly RevenueLeadAssessmentD1Statement[],
) {
  const results: z.infer<typeof BatchResultSchema>[] = [];
  for (let index = 0; index < statements.length; index += 50) {
    const chunk = statements.slice(index, index + 50);
    results.push(...parseBatchResults(await boundary.batch(chunk), chunk.length));
  }
  return results;
}

function assertContactWriterGuards(result: z.infer<typeof BatchResultSchema>) {
  const rows = result.results.map((row) => TriggerRowSchema.parse(row));
  const expectedNames = Object.keys(PRIVATE_KW_CONTACT_INVOCATION_REQUIRED_TRIGGER_MARKERS).sort((left, right) => (
    left.localeCompare(right, "en-CA")
  ));
  if (
    rows.length !== expectedNames.length
    || rows.some((row, index) => row.name !== expectedNames[index])
  ) {
    throw new Error("Durable contact invocation requires every exact immutable and lineage writer guard.");
  }
  for (const row of rows) {
    const marker = PRIVATE_KW_CONTACT_INVOCATION_REQUIRED_TRIGGER_MARKERS[
      row.name as keyof typeof PRIVATE_KW_CONTACT_INVOCATION_REQUIRED_TRIGGER_MARKERS
    ];
    if (!marker || !row.sql.includes(marker)) {
      throw new Error(`Durable contact invocation writer guard drifted: ${row.name}.`);
    }
  }
}

function parseCanonicalJson(value: string, label: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new Error(`${label} JSON is invalid.`);
  }
  if (revenueLeadAssessmentCanonicalJson(parsed) !== value) {
    throw new Error(`${label} JSON is not canonical.`);
  }
  return parsed;
}

function durableInvocationFromRow(raw: z.infer<typeof SqlRowSchema>) {
  const row = PrivateKwContactInvocationReceiptRowSchema.parse(raw);
  const invocation = PrivateKwContactInvocationSchema.parse(
    parseCanonicalJson(row.invocationJson, "Durable contact invocation"),
  );
  const expected = buildPrivateKwContactInvocationReceiptRow(invocation);
  const comparable = Object.fromEntries(
    Object.keys(expected).map((key) => [key, row[key as keyof typeof row] ?? null]),
  );
  if (
    revenueLeadAssessmentCanonicalJson(comparable)
      !== revenueLeadAssessmentCanonicalJson(expected)
  ) {
    throw new Error("The durable contact invocation receipt does not exactly mirror its canonical invocation JSON.");
  }
  return { row, invocation };
}

function durableSourceMaterializationFromRow(raw: z.infer<typeof SqlRowSchema>) {
  const row = SourceMaterializationRowSchema.parse(raw);
  const core = SourceMaterializationCoreSchema.parse(
    parseCanonicalJson(row.materializationJson, "Durable source materialization"),
  );
  const digest = privateKwSourceWorkflowDigest(core);
  const expected = {
    id: `kw-materialization:${digest}`,
    materializationVersion: core.materializationVersion,
    sourceImportId: core.sourceImportId,
    sourcePlanDigest: core.sourcePlanDigest,
    businessId: core.businessId,
    evaluationCandidateId: core.evaluationCandidateId,
    workflowRunId: core.workflowRunId,
    workflowReceiptId: core.workflowReceiptId,
    sourceRunCount: core.summary.sourceRuns,
    businessCount: core.summary.businesses,
    locationCount: core.summary.locations,
    sourceRecordCount: core.summary.sourceRecords,
    workflowRecordCount: core.summary.workflowRecords,
    materializationDigest: digest,
    materializationJson: revenueLeadAssessmentCanonicalJson(core),
    recordedAt: core.recordedAt,
    executionKind: core.authority.executionKind,
    transactionKind: core.authority.transactionKind,
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
  } as const;
  if (
    revenueLeadAssessmentCanonicalJson(row)
      !== revenueLeadAssessmentCanonicalJson(expected)
  ) {
    throw new Error("The durable source materialization receipt does not exactly mirror its canonical materialization JSON.");
  }
  return { row, core };
}

function evidenceFreshThrough(input: {
  assessmentRefreshAfter: string;
  invocation: z.infer<typeof PrivateKwContactInvocationSchema>;
}) {
  return input.invocation.review.verifications
    .map((verification) => verification.observation.staleAfter)
    .reduce((earliest, candidate) => (
      Date.parse(candidate) < Date.parse(earliest) ? candidate : earliest
    ), input.assessmentRefreshAfter);
}

function freshnessState(input: {
  databaseNow: string;
  recordedAt: string;
  freshThrough: string;
}) {
  if (Date.parse(input.databaseNow) < Date.parse(input.recordedAt)) {
    return "NOT_YET_CURRENT" as const;
  }
  if (Date.parse(input.databaseNow) >= Date.parse(input.freshThrough)) {
    return "STALE" as const;
  }
  return "CURRENT" as const;
}

/**
 * Reloads one exact ignored-local contact invocation from durable rows. The
 * caller injects a read-only SQL boundary; no Worker, route, CLI, or live
 * binding imports this module.
 */
export async function loadPrivateKwContactInvocationDurable(
  boundary: RevenueLeadAssessmentD1Boundary,
  identityValue: unknown,
): Promise<PrivateKwContactInvocationDurableReload> {
  const identity = z.object({
    invocationId: z.string().regex(/^kw-contact-invocation:[a-f0-9]{64}$/),
    invocationDigest: Sha256Schema,
  }).strict().parse(identityValue);

  const [guardResult, invocationResult] = await readStatements(boundary, [
    CONTACT_TRIGGER_STATEMENT,
    invocationReceiptStatement(identity),
  ]);
  assertContactWriterGuards(guardResult);
  if (invocationResult.results.length !== 1) {
    throw new Error("The exact durable contact invocation receipt is missing or ambiguous.");
  }
  const { row: invocationRow, invocation } = durableInvocationFromRow(
    invocationResult.results[0],
  );
  if (
    invocation.invocationId !== identity.invocationId
    || invocation.invocationDigest !== identity.invocationDigest
  ) {
    throw new Error("The durable contact invocation identity does not match the requested invocation.");
  }

  const assessmentReload = await loadPrivateRevenueLeadAssessmentD1(boundary, {
    assessmentId: invocation.assessment.assessmentReceiptId,
    assessmentDigest: invocation.assessment.assessmentDigest,
  });
  const assessment = assessmentReload.assessment;
  if (
    assessment.workflow.workflowReceiptId !== invocation.assessment.workflowReceiptId
    || assessment.websiteSnapshotId !== invocation.assessment.websiteSnapshotId
    || assessment.qualificationSnapshotId !== invocation.assessment.qualificationSnapshotId
    || assessment.business.id !== invocation.businessId
    || assessment.business.canonicalName !== invocation.review.business.canonicalName
    || assessment.assessedAt !== invocation.review.assessment.assessedAt
    || assessment.audit.classification !== invocation.review.assessment.classification
    || assessment.qualification.scores.rebuildNeed !== invocation.review.assessment.scores.rebuildNeed
    || assessment.qualification.scores.businessFit !== invocation.review.assessment.scores.businessFit
    || assessment.qualification.scores.timing !== invocation.review.assessment.scores.timing
    || assessment.qualification.scores.evidenceConfidence !== invocation.review.assessment.scores.evidenceConfidence
  ) {
    throw new Error("The durable contact invocation does not bind the exact reloaded assessment.");
  }

  const contactPlan = buildPrivateKwContactPersistencePlan({
    discovery: invocation.review.discovery,
    verifications: invocation.review.verifications,
    approval: invocation.approval.persistenceApproval,
  });
  if (
    contactPlan.materializationId !== invocation.contactMaterializationId
    || contactPlan.businessId !== invocation.businessId
    || contactPlan.recordedAt !== invocationRow.recordedAt
  ) {
    throw new Error("The durable contact invocation does not bind its exact re-derived materialization plan.");
  }

  const rowStatements = contactPlan.records.map((record, index) => statement(
    `read:durable_contact_plan:${index}:${record.entity}:${record.recordId}`,
    record.selectSql,
    record.selectBindings,
  ));
  const [sourceResult, ...contactResults] = await readStatements(boundary, [
    sourceMaterializationStatement(invocation),
    ...rowStatements,
  ]);
  if (sourceResult.results.length !== 1) {
    throw new Error("The durable contact invocation's exact source materialization is missing or ambiguous.");
  }
  const source = durableSourceMaterializationFromRow(sourceResult.results[0]);
  if (
    source.core.sourceImportId !== invocation.sourceImportId
    || source.core.sourcePlanDigest !== invocation.sourcePlanDigest
    || source.core.businessId !== invocation.businessId
    || source.core.evaluationCandidateId !== invocation.review.draft.evaluationCandidateId
  ) {
    throw new Error("The durable source, assessment, review, and contact invocation lineage do not match exactly.");
  }
  contactPlan.records.forEach((record, index) => {
    const result = contactResults[index];
    if (!result || verifyPrivateKwContactPersistencePreflight(record, result.results).state !== "EXACT_MATCH") {
      throw new Error(`Durable contact row failed exact reload: ${record.entity}:${record.recordId}.`);
    }
  });

  const materializationRecord = contactPlan.records.at(-1);
  if (materializationRecord?.entity !== "MATERIALIZATION_RECEIPT") {
    throw new Error("Durable contact invocation requires one final materialization receipt.");
  }
  const materializationExpected = materializationRecord.expected;
  const freshThrough = evidenceFreshThrough({
    assessmentRefreshAfter: assessment.refreshAfter,
    invocation,
  });
  if (
    Date.parse(source.core.recordedAt) > Date.parse(assessment.assessedAt)
    || Date.parse(assessment.assessedAt) > Date.parse(invocationRow.recordedAt)
    || Date.parse(invocation.review.discovery.completedAt) > Date.parse(invocationRow.recordedAt)
    || invocation.review.verifications.some((verification) => (
      Date.parse(verification.completedAt) > Date.parse(invocationRow.recordedAt)
    ))
  ) {
    throw new Error("Durable source, assessment, contact evidence, and approval chronology is invalid.");
  }

  // Read the database clock only after every durable row has been reloaded and
  // checked. An earlier clock could let evidence expire while this proof was
  // still being assembled and incorrectly classify that history as current.
  const [timeResult] = await readStatements(boundary, [CONTACT_DATABASE_TIME_STATEMENT]);
  if (timeResult.results.length !== 1) {
    throw new Error("Durable contact invocation reload requires one final database-time row.");
  }
  const { databaseNow } = DatabaseTimeRowSchema.parse(timeResult.results[0]);
  if (Date.parse(databaseNow) < Date.parse(assessmentReload.databaseNow)) {
    throw new Error("The final durable contact database clock cannot precede the assessment reload clock.");
  }

  const parsed = PrivateKwContactInvocationDurableReloadSchema.parse({
    durableVersion: PRIVATE_KW_CONTACT_INVOCATION_DURABLE_VERSION,
    targetSchemaVersion: PRIVATE_KW_CONTACT_INVOCATION_DURABLE_TARGET_SCHEMA_VERSION,
    executionPath: "DURABLE_RELOAD",
    transactionApi: "RevenueLeadAssessmentD1Boundary.batch",
    invocation,
    assessment: {
      assessmentId: assessment.assessmentId,
      assessmentDigest: assessment.assessmentDigest,
      assessedAt: assessment.assessedAt,
      refreshAfter: assessment.refreshAfter,
      databaseNow: assessmentReload.databaseNow,
      freshnessState: assessmentReload.freshnessState,
      exactSourceRebuilt: assessmentReload.exactSourceRebuilt,
    },
    sourceMaterialization: {
      materializationId: source.row.id,
      materializationDigest: source.row.materializationDigest,
      sourceImportId: source.row.sourceImportId,
      sourcePlanDigest: source.row.sourcePlanDigest,
      businessId: source.row.businessId,
      evaluationCandidateId: source.row.evaluationCandidateId,
      workflowRunId: source.row.workflowRunId,
      workflowReceiptId: source.row.workflowReceiptId,
      recordedAt: source.row.recordedAt,
    },
    contactMaterialization: {
      materializationId: contactPlan.materializationId,
      materializationDigest: contactPlan.materializationDigest,
      discoveryReceiptId: contactPlan.discoveryResultId,
      discoveryResultDigest: contactPlan.discoveryResultDigest,
      recordedAt: contactPlan.recordedAt,
      exactPlanRebuilt: true,
    },
    invocationReceiptRecordedAt: invocationRow.recordedAt,
    databaseNow,
    evidenceFreshThrough: freshThrough,
    freshnessState: freshnessState({
      databaseNow,
      recordedAt: invocationRow.recordedAt,
      freshThrough,
    }),
    reloadedRows: {
      sourceMaterializationReceipts: 1,
      assessmentReceipts: 1,
      discoveryReceipts: contactPlan.summary.discoveryReceipts,
      contactPointVersions: contactPlan.summary.contactPointVersions,
      evidenceClaims: contactPlan.summary.evidenceClaims,
      evidenceUses: contactPlan.summary.evidenceUses,
      verificationResults: contactPlan.summary.verificationResults,
      contactMaterializationReceipts: contactPlan.summary.materializationReceipts,
      contactInvocationReceipts: 1,
    },
    exactAssessmentReloaded: true,
    exactContactPlanRebuilt: true,
    immutableWriterGuardsVerified: true,
    committedAndReloaded: true,
    databaseReadPerformed: true,
    databaseMutationPerformed: false,
    persistenceScope: "EXACT_IMMUTABLE_CONTACT_INVOCATION_ROW_SET",
    runtimeConnected: false,
    authority: {
      proofInputOnly: true,
      phaseInputCreationAuthorized: false,
      progressReceiptCreationAuthorized: false,
      phaseAdvancementAuthorized: false,
      databaseMutationAuthorized: false,
      sourceMutationAuthorized: false,
      workflowMutationAuthorized: false,
      assessmentMutationAuthorized: false,
      contactDiscoveryExecutionAuthorized: false,
      contactVerificationExecutionAuthorized: false,
      consentDecisionAuthorized: false,
      qualificationAuthorized: false,
      outreachAuthorized: false,
      sendAuthorized: false,
      deploymentAuthorized: false,
      providerOperationsAuthorized: 0,
      costAuthorizedUsd: 0,
    },
  });
  if (
    materializationExpected.id !== parsed.contactMaterialization.materializationId
    || materializationExpected.materializationDigest !== parsed.contactMaterialization.materializationDigest
    || materializationExpected.recordedAt !== parsed.contactMaterialization.recordedAt
  ) {
    throw new Error("The durable contact materialization receipt does not match the re-derived final plan receipt.");
  }
  const trusted = deepFreeze(parsed);
  trustedDurableContactReloads.add(trusted);
  return trusted;
}
