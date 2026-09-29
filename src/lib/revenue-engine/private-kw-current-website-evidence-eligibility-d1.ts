import { z } from "zod";

import {
  artifactReferenceCanonicalJson,
  artifactReferenceDigest,
} from "@/lib/revenue-engine/artifact-reference-projection";
import {
  PRIVATE_KW_CURRENT_WEBSITE_EVIDENCE_ELIGIBILITY_VERSION,
  PrivateKwCurrentWebsiteEvidenceEligibilityReceiptSchema,
  requireInProcessPrivateKwCurrentWebsiteEvidenceEligibilityReceipt,
  type PrivateKwCurrentWebsiteEvidenceEligibilityReceipt,
} from "@/lib/revenue-engine/private-kw-current-website-evidence-eligibility";

export const PRIVATE_KW_WEBSITE_EVIDENCE_ELIGIBILITY_D1_EXECUTOR_VERSION =
  "kw-current-website-evidence-eligibility-d1-v1";
export const PRIVATE_KW_WEBSITE_EVIDENCE_ELIGIBILITY_TARGET_SCHEMA_VERSION =
  "0068_current_website_evidence_eligibility_receipts";

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const TimestampSchema = z.string().datetime({ offset: true });
const SqlValueSchema = z.union([z.string(), z.number().finite(), z.null()]);
const SqlRowSchema = z.record(z.string(), SqlValueSchema);
type SqlValue = z.infer<typeof SqlValueSchema>;
type SqlRow = z.infer<typeof SqlRowSchema>;

export type PrivateKwWebsiteEvidenceEligibilityD1Statement = Readonly<{
  statementId: string;
  sql: string;
  bindings: readonly SqlValue[];
}>;

export interface PrivateKwWebsiteEvidenceEligibilityD1Boundary {
  batch(
    statements: readonly PrivateKwWebsiteEvidenceEligibilityD1Statement[],
  ): Promise<readonly unknown[]>;
}

const BatchResultSchema = z.object({
  success: z.literal(true),
  results: z.array(SqlRowSchema).max(10),
  changes: z.number().int().nonnegative(),
}).strict();

const DatabaseTimeRowSchema = z.object({ databaseNow: TimestampSchema }).strict();
const TriggerRowSchema = z.object({ name: z.string(), sql: z.string().min(1) }).strict();

const REQUIRED_ELIGIBILITY_TRIGGER_MARKERS = {
  RevenueCurrentWebsiteEvidenceEligibilityReceipt_lineage_insert:
    "REVENUE_WEBSITE_EVIDENCE_ELIGIBILITY_LINEAGE_MISMATCH",
  RevenueCurrentWebsiteEvidenceEligibilityReceipt_immutable_update:
    "REVENUE_WEBSITE_EVIDENCE_ELIGIBILITY_APPEND_ONLY",
  RevenueCurrentWebsiteEvidenceEligibilityReceipt_immutable_delete:
    "REVENUE_WEBSITE_EVIDENCE_ELIGIBILITY_APPEND_ONLY",
} as const;

const ELIGIBILITY_WRITER_GUARD_PREDICATE = Object.keys(
  REQUIRED_ELIGIBILITY_TRIGGER_MARKERS,
).map(() => `EXISTS (
       SELECT 1 FROM "sqlite_master"
       WHERE "type" = 'trigger' AND "name" = ? AND instr("sql", ?) > 0
     )`).join(" AND ");
const ELIGIBILITY_WRITER_GUARD_BINDINGS = Object.entries(
  REQUIRED_ELIGIBILITY_TRIGGER_MARKERS,
).flatMap(([name, marker]) => [name, marker]);

const EligibilityReceiptRowSchema = z.object({
  id: z.string(),
  eligibilityVersion: z.literal(PRIVATE_KW_CURRENT_WEBSITE_EVIDENCE_ELIGIBILITY_VERSION),
  receiptKind: z.literal("CURRENT_WEBSITE_EVIDENCE_ELIGIBILITY"),
  receiptDigest: Sha256Schema,
  manifestId: z.string(),
  manifestDigest: Sha256Schema,
  businessId: z.string(),
  evaluationCandidateId: z.string(),
  sourceRecordId: z.string(),
  websiteEvidenceProofId: z.string(),
  websiteEvidenceProofDigest: Sha256Schema,
  workflowRunId: z.string().uuid(),
  requestDigest: Sha256Schema,
  workflowReceiptId: z.string(),
  workflowReceiptDigest: Sha256Schema,
  auditDigest: Sha256Schema,
  artifactSetDigest: Sha256Schema,
  workflowForestDigest: Sha256Schema,
  artifactCount: z.number().int().min(2).max(5),
  artifactsDigest: Sha256Schema,
  evidenceFreshThrough: TimestampSchema,
  evaluatedAt: TimestampSchema,
  receiptJson: z.string().min(2).max(8_388_608),
  recordedAt: TimestampSchema,
  transactionKind: z.literal("D1_BATCH"),
  validationOnly: z.literal(1),
  exactTrustedExecutionInstancesRequired: z.literal(1),
  phaseInputCreationAuthorized: z.literal(0),
  progressReceiptCreationAuthorized: z.literal(0),
  phaseAdvancementAuthorized: z.literal(0),
  browserCaptureAuthorized: z.literal(0),
  artifactStorageAuthorized: z.literal(0),
  r2ReadAuthorized: z.literal(0),
  contactDiscoveryAuthorized: z.literal(0),
  qualificationAuthorized: z.literal(0),
  outreachAuthorized: z.literal(0),
  sendAuthorized: z.literal(0),
  deploymentAuthorized: z.literal(0),
  providerOperationsAuthorized: z.literal(0),
  costAuthorizedUsd: z.literal(0),
}).strict();

type EligibilityReceiptRow = z.infer<typeof EligibilityReceiptRowSchema>;

export const PrivateKwWebsiteEvidenceEligibilityD1ResultSchema = z.object({
  executorVersion: z.literal(PRIVATE_KW_WEBSITE_EVIDENCE_ELIGIBILITY_D1_EXECUTOR_VERSION),
  targetSchemaVersion: z.literal(PRIVATE_KW_WEBSITE_EVIDENCE_ELIGIBILITY_TARGET_SCHEMA_VERSION),
  executionPath: z.enum(["FRESH_COMMIT", "EXACT_REPLAY", "DURABLE_RELOAD"]),
  transactionApi: z.literal("D1Database.batch"),
  receipt: PrivateKwCurrentWebsiteEvidenceEligibilityReceiptSchema,
  receiptRecordedAt: TimestampSchema,
  databaseNow: TimestampSchema,
  freshnessState: z.enum(["NOT_YET_CURRENT", "CURRENT", "STALE"]),
  artifactCount: z.number().int().min(2).max(5),
  artifactsDigest: Sha256Schema,
  committedAndReloaded: z.literal(true),
  databaseReadPerformed: z.literal(true),
  databaseMutationPerformed: z.boolean(),
  receiptPersistenceScope: z.literal("CURRENT_WEBSITE_EVIDENCE_ELIGIBILITY_RECEIPT_ONLY"),
  runtimeConnected: z.literal(false),
  phaseInputCreationAuthorized: z.literal(false),
  progressReceiptCreationAuthorized: z.literal(false),
  phaseAdvancementAuthorized: z.literal(false),
  browserCaptureAuthorized: z.literal(false),
  artifactStorageAuthorized: z.literal(false),
  r2ReadAuthorized: z.literal(false),
  contactDiscoveryAuthorized: z.literal(false),
  qualificationAuthorized: z.literal(false),
  outreachAuthorized: z.literal(false),
  sendAuthorized: z.literal(false),
  deploymentAuthorized: z.literal(false),
  providerOperationsAuthorized: z.literal(0),
  costAuthorizedUsd: z.literal(0),
}).strict().superRefine((result, context) => {
  const committed = result.executionPath === "FRESH_COMMIT";
  if (result.databaseMutationPerformed !== committed) {
    context.addIssue({
      code: "custom",
      message: "Only a fresh eligibility receipt commit may report a database mutation.",
      path: ["databaseMutationPerformed"],
    });
  }
  if (result.artifactCount !== result.receipt.artifacts.length) {
    context.addIssue({
      code: "custom",
      message: "The durable eligibility result must retain its exact artifact count.",
      path: ["artifactCount"],
    });
  }
  if (result.artifactsDigest !== artifactReferenceDigest(result.receipt.artifacts)) {
    context.addIssue({
      code: "custom",
      message: "The durable eligibility result must bind its exact artifact set.",
      path: ["artifactsDigest"],
    });
  }
});

export type PrivateKwWebsiteEvidenceEligibilityD1Result = z.infer<
  typeof PrivateKwWebsiteEvidenceEligibilityD1ResultSchema
>;

const trustedDurableResults = new WeakSet<object>();

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return Object.freeze(value);
}

export function requireTrustedPrivateKwWebsiteEvidenceEligibilityD1Result(
  value: unknown,
): PrivateKwWebsiteEvidenceEligibilityD1Result {
  PrivateKwWebsiteEvidenceEligibilityD1ResultSchema.parse(value);
  if (!value || typeof value !== "object" || !trustedDurableResults.has(value)) {
    throw new Error("Durable website evidence eligibility must be the exact in-process result of the private D1 reload boundary.");
  }
  return value as PrivateKwWebsiteEvidenceEligibilityD1Result;
}

export function requireCurrentPrivateKwWebsiteEvidenceEligibilityD1Result(
  value: unknown,
): PrivateKwWebsiteEvidenceEligibilityD1Result & { freshnessState: "CURRENT" } {
  const result = requireTrustedPrivateKwWebsiteEvidenceEligibilityD1Result(value);
  if (result.freshnessState !== "CURRENT") {
    throw new Error("Durable website evidence eligibility is not current at the database clock.");
  }
  return result as PrivateKwWebsiteEvidenceEligibilityD1Result & { freshnessState: "CURRENT" };
}

/**
 * Cloudflare adapter for a future separately approved D1 connection. The
 * Revenue Engine Worker, routes, queues, and scripts do not import this module.
 */
export function createCloudflarePrivateKwWebsiteEvidenceEligibilityD1Boundary(
  database: Pick<D1Database, "prepare" | "batch">,
): PrivateKwWebsiteEvidenceEligibilityD1Boundary {
  return {
    async batch(statements) {
      const prepared = statements.map((item) => database.prepare(item.sql).bind(...item.bindings));
      const results = await database.batch<SqlRow>(prepared);
      return results.map((result) => ({
        success: result.success,
        results: result.results,
        changes: result.meta.changes,
      }));
    },
  };
}

function statement(
  statementId: string,
  sql: string,
  bindings: readonly SqlValue[] = [],
): PrivateKwWebsiteEvidenceEligibilityD1Statement {
  return { statementId, sql, bindings };
}

const DATABASE_TIME_STATEMENT = statement(
  "read:eligibility_database_time",
  `SELECT strftime('%Y-%m-%dT%H:%M:%fZ', 'now') AS "databaseNow"`,
);

const ELIGIBILITY_TRIGGER_STATEMENT = statement(
  "read:eligibility_writer_guards",
  `SELECT "name", "sql" FROM "sqlite_master"
   WHERE "type" = 'trigger' AND "name" IN (${Object.keys(REQUIRED_ELIGIBILITY_TRIGGER_MARKERS).map(() => "?").join(", ")})
   ORDER BY "name"`,
  Object.keys(REQUIRED_ELIGIBILITY_TRIGGER_MARKERS),
);

const ROW_COLUMNS = [
  "id",
  "eligibilityVersion",
  "receiptKind",
  "receiptDigest",
  "manifestId",
  "manifestDigest",
  "businessId",
  "evaluationCandidateId",
  "sourceRecordId",
  "websiteEvidenceProofId",
  "websiteEvidenceProofDigest",
  "workflowRunId",
  "requestDigest",
  "workflowReceiptId",
  "workflowReceiptDigest",
  "auditDigest",
  "artifactSetDigest",
  "workflowForestDigest",
  "artifactCount",
  "artifactsDigest",
  "evidenceFreshThrough",
  "evaluatedAt",
  "receiptJson",
  "recordedAt",
  "transactionKind",
  "validationOnly",
  "exactTrustedExecutionInstancesRequired",
  "phaseInputCreationAuthorized",
  "progressReceiptCreationAuthorized",
  "phaseAdvancementAuthorized",
  "browserCaptureAuthorized",
  "artifactStorageAuthorized",
  "r2ReadAuthorized",
  "contactDiscoveryAuthorized",
  "qualificationAuthorized",
  "outreachAuthorized",
  "sendAuthorized",
  "deploymentAuthorized",
  "providerOperationsAuthorized",
  "costAuthorizedUsd",
] as const;

function eligibilityRowValues(receipt: PrivateKwCurrentWebsiteEvidenceEligibilityReceipt) {
  return {
    id: receipt.receiptId,
    eligibilityVersion: receipt.eligibilityVersion,
    receiptKind: receipt.receiptKind,
    receiptDigest: receipt.receiptDigest,
    manifestId: receipt.manifestId,
    manifestDigest: receipt.manifestDigest,
    businessId: receipt.businessId,
    evaluationCandidateId: receipt.evaluationCandidateId,
    sourceRecordId: receipt.sourceRecordId,
    websiteEvidenceProofId: receipt.websiteEvidence.proofId,
    websiteEvidenceProofDigest: receipt.websiteEvidence.proofDigest,
    workflowRunId: receipt.persistedWorkflow.workflowId,
    requestDigest: receipt.persistedWorkflow.requestDigest,
    workflowReceiptId: receipt.websiteEvidence.workflowReceiptId,
    workflowReceiptDigest: receipt.persistedWorkflow.workflowReceiptDigest,
    auditDigest: receipt.websiteEvidence.auditDigest,
    artifactSetDigest: receipt.websiteEvidence.artifactSetDigest,
    workflowForestDigest: receipt.persistedWorkflow.workflowForestDigest,
    artifactCount: receipt.artifacts.length,
    artifactsDigest: artifactReferenceDigest(receipt.artifacts),
    evidenceFreshThrough: receipt.evidenceFreshThrough,
    evaluatedAt: receipt.evaluatedAt,
    receiptJson: artifactReferenceCanonicalJson(receipt),
    transactionKind: "D1_BATCH",
    validationOnly: 1,
    exactTrustedExecutionInstancesRequired: 1,
    phaseInputCreationAuthorized: 0,
    progressReceiptCreationAuthorized: 0,
    phaseAdvancementAuthorized: 0,
    browserCaptureAuthorized: 0,
    artifactStorageAuthorized: 0,
    r2ReadAuthorized: 0,
    contactDiscoveryAuthorized: 0,
    qualificationAuthorized: 0,
    outreachAuthorized: 0,
    sendAuthorized: 0,
    deploymentAuthorized: 0,
    providerOperationsAuthorized: 0,
    costAuthorizedUsd: 0,
  } satisfies Record<Exclude<(typeof ROW_COLUMNS)[number], "recordedAt">, SqlValue>;
}

function selectReceiptStatement(receiptId: string) {
  return statement(
    "read:website_evidence_eligibility_receipt",
    `SELECT ${ROW_COLUMNS.map((column) => `"${column}"`).join(", ")}
     FROM "RevenueCurrentWebsiteEvidenceEligibilityReceipt"
     WHERE "id" = ? ORDER BY "id"`,
    [receiptId],
  );
}

function insertReceiptStatement(receipt: PrivateKwCurrentWebsiteEvidenceEligibilityReceipt) {
  const values = eligibilityRowValues(receipt);
  const columns = Object.keys(values);
  return statement(
    "insert:website_evidence_eligibility_receipt",
    `INSERT OR IGNORE INTO "RevenueCurrentWebsiteEvidenceEligibilityReceipt"
      (${columns.map((column) => `"${column}"`).join(", ")}, "recordedAt")
     SELECT ${columns.map(() => "?").join(", ")}, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE julianday('now') >= julianday(?) AND julianday('now') < julianday(?)
       AND ${ELIGIBILITY_WRITER_GUARD_PREDICATE}`,
    [
      ...Object.values(values),
      receipt.evaluatedAt,
      receipt.evidenceFreshThrough,
      ...ELIGIBILITY_WRITER_GUARD_BINDINGS,
    ],
  );
}

function parseBatchResults(raw: readonly unknown[], expectedCount: number) {
  if (raw.length !== expectedCount) {
    throw new Error("D1 returned an unexpected website evidence eligibility batch result count.");
  }
  return raw.map((result) => BatchResultSchema.parse(result));
}

function parseDatabaseNow(result: z.infer<typeof BatchResultSchema>) {
  if (result.results.length !== 1) {
    throw new Error("Website evidence eligibility requires one database-time row.");
  }
  return DatabaseTimeRowSchema.parse(result.results[0]).databaseNow;
}

function assertEligibilityWriterGuards(result: z.infer<typeof BatchResultSchema>) {
  const rows = result.results.map((row) => TriggerRowSchema.parse(row));
  const expectedNames = Object.keys(REQUIRED_ELIGIBILITY_TRIGGER_MARKERS).sort((left, right) => (
    left.localeCompare(right, "en-CA")
  ));
  if (
    rows.length !== expectedNames.length
    || rows.some((row, index) => row.name !== expectedNames[index])
  ) {
    throw new Error("Durable website evidence eligibility requires every exact migration-0068 writer guard.");
  }
  for (const row of rows) {
    const marker = REQUIRED_ELIGIBILITY_TRIGGER_MARKERS[
      row.name as keyof typeof REQUIRED_ELIGIBILITY_TRIGGER_MARKERS
    ];
    if (!marker || !row.sql.includes(marker)) {
      throw new Error(`Durable website evidence eligibility writer guard drifted: ${row.name}.`);
    }
  }
}

function freshnessState(
  receipt: PrivateKwCurrentWebsiteEvidenceEligibilityReceipt,
  databaseNow: string,
) {
  if (Date.parse(databaseNow) < Date.parse(receipt.evaluatedAt)) return "NOT_YET_CURRENT" as const;
  if (Date.parse(databaseNow) >= Date.parse(receipt.evidenceFreshThrough)) return "STALE" as const;
  return "CURRENT" as const;
}

function exactReceiptFromRow(raw: SqlRow) {
  const row = EligibilityReceiptRowSchema.parse(raw);
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(row.receiptJson) as unknown;
  } catch {
    throw new Error("Stored website evidence eligibility receipt JSON is invalid.");
  }
  const receipt = PrivateKwCurrentWebsiteEvidenceEligibilityReceiptSchema.parse(parsedJson);
  const expected = eligibilityRowValues(receipt);
  const comparable = Object.fromEntries(
    Object.keys(expected).map((key) => [key, row[key as keyof EligibilityReceiptRow]]),
  );
  if (
    artifactReferenceCanonicalJson(comparable) !== artifactReferenceCanonicalJson(expected)
    || row.receiptJson !== artifactReferenceCanonicalJson(receipt)
  ) {
    throw new Error("Stored website evidence eligibility receipt does not exactly match its mirrored durable row.");
  }
  return { row, receipt };
}

function durableResult(input: {
  executionPath: "FRESH_COMMIT" | "EXACT_REPLAY" | "DURABLE_RELOAD";
  row: EligibilityReceiptRow;
  receipt: PrivateKwCurrentWebsiteEvidenceEligibilityReceipt;
  databaseNow: string;
}) {
  const parsed = PrivateKwWebsiteEvidenceEligibilityD1ResultSchema.parse({
    executorVersion: PRIVATE_KW_WEBSITE_EVIDENCE_ELIGIBILITY_D1_EXECUTOR_VERSION,
    targetSchemaVersion: PRIVATE_KW_WEBSITE_EVIDENCE_ELIGIBILITY_TARGET_SCHEMA_VERSION,
    executionPath: input.executionPath,
    transactionApi: "D1Database.batch",
    receipt: input.receipt,
    receiptRecordedAt: input.row.recordedAt,
    databaseNow: input.databaseNow,
    freshnessState: freshnessState(input.receipt, input.databaseNow),
    artifactCount: input.row.artifactCount,
    artifactsDigest: input.row.artifactsDigest,
    committedAndReloaded: true,
    databaseReadPerformed: true,
    databaseMutationPerformed: input.executionPath === "FRESH_COMMIT",
    receiptPersistenceScope: "CURRENT_WEBSITE_EVIDENCE_ELIGIBILITY_RECEIPT_ONLY",
    runtimeConnected: false,
    phaseInputCreationAuthorized: false,
    progressReceiptCreationAuthorized: false,
    phaseAdvancementAuthorized: false,
    browserCaptureAuthorized: false,
    artifactStorageAuthorized: false,
    r2ReadAuthorized: false,
    contactDiscoveryAuthorized: false,
    qualificationAuthorized: false,
    outreachAuthorized: false,
    sendAuthorized: false,
    deploymentAuthorized: false,
    providerOperationsAuthorized: 0,
    costAuthorizedUsd: 0,
  });
  const trusted = deepFreeze(parsed);
  trustedDurableResults.add(trusted);
  return trusted;
}

export async function persistPrivateKwWebsiteEvidenceEligibilityD1(
  boundary: PrivateKwWebsiteEvidenceEligibilityD1Boundary,
  receiptValue: unknown,
) {
  const receipt = requireInProcessPrivateKwCurrentWebsiteEvidenceEligibilityReceipt(receiptValue);
  const [guardResult, timeResult, insertResult, reloadResult] = parseBatchResults(await boundary.batch([
    ELIGIBILITY_TRIGGER_STATEMENT,
    DATABASE_TIME_STATEMENT,
    insertReceiptStatement(receipt),
    selectReceiptStatement(receipt.receiptId),
  ]), 4);
  assertEligibilityWriterGuards(guardResult);
  const databaseNow = parseDatabaseNow(timeResult);
  if (freshnessState(receipt, databaseNow) !== "CURRENT") {
    throw new Error("Website evidence eligibility cannot be persisted outside its database-clock freshness window.");
  }
  if (insertResult.changes > 1 || reloadResult.results.length !== 1) {
    throw new Error("Website evidence eligibility did not commit and reload exactly one durable receipt.");
  }
  const { row, receipt: reloadedReceipt } = exactReceiptFromRow(reloadResult.results[0]);
  if (reloadedReceipt.receiptDigest !== receipt.receiptDigest) {
    throw new Error("Website evidence eligibility durable receipt conflicts with the trusted in-process receipt.");
  }
  return durableResult({
    executionPath: insertResult.changes === 1 ? "FRESH_COMMIT" : "EXACT_REPLAY",
    row,
    receipt: reloadedReceipt,
    databaseNow,
  });
}

export async function loadPrivateKwWebsiteEvidenceEligibilityD1(
  boundary: PrivateKwWebsiteEvidenceEligibilityD1Boundary,
  identityValue: unknown,
) {
  const identity = z.object({
    receiptId: z.string().regex(/^website-evidence-eligibility:[a-f0-9]{64}$/),
    receiptDigest: Sha256Schema,
  }).strict().superRefine((value, context) => {
    if (value.receiptId !== `website-evidence-eligibility:${value.receiptDigest}`) {
      context.addIssue({ code: "custom", message: "Eligibility receipt identity and digest must match." });
    }
  }).parse(identityValue);
  const [guardResult, timeResult, reloadResult] = parseBatchResults(await boundary.batch([
    ELIGIBILITY_TRIGGER_STATEMENT,
    DATABASE_TIME_STATEMENT,
    selectReceiptStatement(identity.receiptId),
  ]), 3);
  assertEligibilityWriterGuards(guardResult);
  const databaseNow = parseDatabaseNow(timeResult);
  if (reloadResult.results.length !== 1) {
    throw new Error("The exact durable website evidence eligibility receipt is missing or ambiguous.");
  }
  const { row, receipt } = exactReceiptFromRow(reloadResult.results[0]);
  if (receipt.receiptDigest !== identity.receiptDigest) {
    throw new Error("The durable website evidence eligibility receipt digest does not match the requested identity.");
  }
  return durableResult({
    executionPath: "DURABLE_RELOAD",
    row,
    receipt,
    databaseNow,
  });
}
