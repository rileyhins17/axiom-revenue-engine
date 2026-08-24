import { z } from "zod";

import {
  ARTIFACT_REFERENCE_COMPLETENESS_RECEIPT_VERSION,
  ARTIFACT_REFERENCE_SOURCE_SET_ORDER,
  ArtifactReferenceAtomicObservationSchema,
  ArtifactReferenceAtomicPlanSchema,
  ArtifactReferenceCompletenessReceiptSchema,
  ArtifactReferenceSourceSetProofSchema,
  buildArtifactReferenceAtomicPlan,
  buildUntrustedArtifactReferenceSourceProof,
  type ArtifactReferenceAtomicPlan,
} from "@/lib/revenue-engine/artifact-reference-atomic-snapshot";
import {
  ArtifactReferenceDecodedSnapshotSchema,
  decodeArtifactReferenceD1SourceSnapshot,
} from "@/lib/revenue-engine/artifact-reference-d1-source-decoder";
import {
  artifactReferenceCanonicalJson,
  artifactReferenceDigest,
} from "@/lib/revenue-engine/artifact-reference-projection";
import {
  ARTIFACT_REFERENCE_GUARDED_SOURCE_TABLES,
  ARTIFACT_REFERENCE_IMMUTABLE_CONTROL_TABLES,
  ARTIFACT_REFERENCE_IMMUTABLE_ERROR,
  ARTIFACT_REFERENCE_SOURCE_FREEZE_ERROR,
} from "@/lib/revenue-engine/artifact-reference-source-writer-guard";

export const ARTIFACT_REFERENCE_D1_EXECUTOR_VERSION = "artifact-reference-d1-executor-v1";

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const SqlValueSchema = z.union([z.string(), z.number().finite(), z.null()]);
const SqlRowSchema = z.record(z.string(), SqlValueSchema);
type SqlValue = z.infer<typeof SqlValueSchema>;
type SqlRow = z.infer<typeof SqlRowSchema>;

export type ArtifactReferenceD1BatchStatement = Readonly<{
  statementId: string;
  sql: string;
  bindings: readonly SqlValue[];
}>;

export interface ArtifactReferenceD1BatchBoundary {
  batch(statements: readonly ArtifactReferenceD1BatchStatement[]): Promise<readonly unknown[]>;
}

const BatchResultSchema = z.object({
  success: z.literal(true),
  results: z.array(SqlRowSchema).max(5_000),
  changes: z.number().int().nonnegative(),
}).strict();

type BatchResult = z.infer<typeof BatchResultSchema>;

/**
 * The only Cloudflare-specific adapter in this module. It uses the generated
 * Worker types and converts D1 results into the executor's small validated
 * boundary. Nothing wires this adapter to a runtime binding yet.
 */
export function createCloudflareArtifactReferenceD1BatchBoundary(
  database: Pick<D1Database, "prepare" | "batch">,
): ArtifactReferenceD1BatchBoundary {
  return {
    async batch(statements) {
      const prepared = statements.map((statement) => database.prepare(statement.sql).bind(...statement.bindings));
      const results = await database.batch<SqlRow>(prepared);
      return results.map((result) => ({
        success: result.success,
        results: result.results,
        changes: result.meta.changes,
      }));
    },
  };
}

const SnapshotAttemptRowSchema = z.object({
  id: z.string().uuid(),
  attemptVersion: z.string(),
  workflowRunId: z.string().uuid(),
  businessId: z.string(),
  lineageRootManifestId: z.string().uuid(),
  attemptNumber: z.number().int(),
  fencingToken: z.number().int(),
  ownerId: z.string(),
  queryContractVersion: z.string(),
  queryContractDigest: Sha256Schema,
  requestDigest: Sha256Schema,
  requestedAt: z.string(),
  acquiredAt: z.string(),
  expiresAt: z.string(),
  mode: z.string(),
  executorKind: z.string(),
  attemptDigest: Sha256Schema,
  attemptJson: z.string(),
  providerOperationsAuthorized: z.literal(0),
  releaseAuthorized: z.literal(0),
  deletionAuthorized: z.literal(0),
  costAuthorizedUsd: z.literal(0),
  createdAt: z.string(),
}).strict();

const WinningAttemptRowSchema = SnapshotAttemptRowSchema.extend({
  completenessReceiptId: z.string().nullable(),
}).strict();

const CompletenessReceiptRowSchema = z.object({
  id: z.string().uuid(),
  receiptVersion: z.string(),
  snapshotAttemptId: z.string().uuid(),
  workflowRunId: z.string().uuid(),
  businessId: z.string(),
  lineageRootManifestId: z.string().uuid(),
  attemptNumber: z.number().int(),
  fencingToken: z.number().int(),
  queryContractVersion: z.string(),
  queryContractDigest: Sha256Schema,
  snapshotCapturedAt: z.string(),
  freshUntil: z.string(),
  workflowRunCount: z.number().int(),
  workflowHistoryCount: z.number().int(),
  manifestCount: z.number().int(),
  manifestItemCount: z.number().int(),
  promotionCount: z.number().int(),
  promotionUseCount: z.number().int(),
  manifestUseCount: z.number().int(),
  evidenceUseCount: z.number().int(),
  useEndCount: z.number().int(),
  availabilityCount: z.number().int(),
  sourceSetProofsDigest: Sha256Schema,
  sourceSetProofsJson: z.string(),
  sourceFactsDigest: Sha256Schema,
  receiptDigest: Sha256Schema,
  receiptJson: z.string(),
  completenessAssurance: z.string(),
  availabilityAssurance: z.string(),
  snapshotComplete: z.literal(1),
  committedAndReloaded: z.literal(1),
  retentionConclusionAuthorized: z.literal(0),
  projectionPersistenceAuthorized: z.literal(0),
  providerOperationsAuthorized: z.literal(0),
  releaseAuthorized: z.literal(0),
  deletionAuthorized: z.literal(0),
  costAuthorizedUsd: z.literal(0),
  recordedAt: z.string(),
  createdAt: z.string(),
}).strict();

const SourceSetProofRowSchema = z.object({
  id: z.string(),
  completenessReceiptId: z.string().uuid(),
  setOrdinal: z.number().int(),
  setName: z.string(),
  predicateVersion: z.string(),
  rowCount: z.number().int(),
  setDigest: Sha256Schema,
  proofDigest: Sha256Schema,
  proofJson: z.string(),
  createdAt: z.string(),
}).strict();

const DatabaseTimeRowSchema = z.object({ databaseNow: z.string() }).strict();
const TriggerRowSchema = z.object({ name: z.string(), sql: z.string() }).strict();

const TrustedExecutionCoreSchema = z.object({
  executorVersion: z.literal(ARTIFACT_REFERENCE_D1_EXECUTOR_VERSION),
  executionPath: z.enum(["FRESH_COMMIT", "EXACT_SEALED_REPLAY"]),
  transactionApi: z.literal("D1Database.batch"),
  receipt: ArtifactReferenceCompletenessReceiptSchema,
  decodedSnapshot: ArtifactReferenceDecodedSnapshotSchema.nullable(),
  receiptCreationPerformed: z.boolean(),
  sourceRowsMaterialized: z.boolean(),
  committedReceiptReloaded: z.literal(true),
  transactionallyTrusted: z.literal(true),
  snapshotComplete: z.literal(true),
  retentionConclusionAuthorized: z.literal(false),
  projectionPersistenceAuthorized: z.literal(false),
  releaseAuthorized: z.literal(false),
  deletionAuthorized: z.literal(false),
  providerOperationsAuthorized: z.literal(0),
  costAuthorizedUsd: z.literal(0),
}).strict().superRefine((result, context) => {
  const fresh = result.executionPath === "FRESH_COMMIT";
  if (
    result.receiptCreationPerformed !== fresh
    || result.sourceRowsMaterialized !== fresh
    || (fresh && result.decodedSnapshot === null)
    || (!fresh && result.decodedSnapshot !== null)
  ) {
    context.addIssue({ code: "custom", message: "Trusted execution path flags must match fresh commit versus exact replay.", path: ["executionPath"] });
  }
  if (result.decodedSnapshot && result.decodedSnapshot.selectedLineage.sourceFactsDigest !== result.receipt.sourceFactsDigest) {
    context.addIssue({ code: "custom", message: "Trusted decoded facts must match the committed receipt.", path: ["decodedSnapshot"] });
  }
});

const TrustedExecutionSchema = TrustedExecutionCoreSchema.extend({
  executionDigest: Sha256Schema,
}).strict().superRefine((result, context) => {
  const { executionDigest: _executionDigest, ...core } = result;
  void _executionDigest;
  if (result.executionDigest !== artifactReferenceDigest(core)) {
    context.addIssue({ code: "custom", message: "Trusted execution digest must bind the exact reloaded result.", path: ["executionDigest"] });
  }
});

export type ArtifactReferenceTrustedD1Execution = z.infer<typeof TrustedExecutionSchema>;

const DATABASE_TIME_STATEMENT: ArtifactReferenceD1BatchStatement = {
  statementId: "executor-database-time",
  sql: `SELECT strftime('%Y-%m-%dT%H:%M:%fZ', 'now') AS "databaseNow"`,
  bindings: [],
};

const REPLAY_RECEIPT_SQL = `SELECT * FROM "RevenueArtifactReferenceCompletenessReceipt"
WHERE "snapshotAttemptId" = ? ORDER BY "id"`;

const REPLAY_PROOFS_SQL = `SELECT p.* FROM "RevenueArtifactReferenceSourceSetProof" p
JOIN "RevenueArtifactReferenceCompletenessReceipt" r ON r."id" = p."completenessReceiptId"
WHERE r."snapshotAttemptId" = ? ORDER BY p."setOrdinal", p."id"`;

const REQUIRED_TRIGGER_CONTRACTS = [
  ...ARTIFACT_REFERENCE_GUARDED_SOURCE_TABLES.flatMap((source) => [
    { name: source.insertTriggerName, table: source.tableName, operation: "INSERT", errorCode: ARTIFACT_REFERENCE_SOURCE_FREEZE_ERROR },
    { name: source.updateTriggerName, table: source.tableName, operation: "UPDATE", errorCode: ARTIFACT_REFERENCE_IMMUTABLE_ERROR },
    { name: source.deleteTriggerName, table: source.tableName, operation: "DELETE", errorCode: ARTIFACT_REFERENCE_IMMUTABLE_ERROR },
  ]),
  ...ARTIFACT_REFERENCE_IMMUTABLE_CONTROL_TABLES.flatMap((control) => [
    { name: control.updateTriggerName, table: control.tableName, operation: "UPDATE", errorCode: ARTIFACT_REFERENCE_IMMUTABLE_ERROR },
    { name: control.deleteTriggerName, table: control.tableName, operation: "DELETE", errorCode: ARTIFACT_REFERENCE_IMMUTABLE_ERROR },
  ]),
] as const;

const WRITER_GUARD_PREFLIGHT: ArtifactReferenceD1BatchStatement = {
  statementId: "executor-writer-guard-schema-preflight",
  sql: `SELECT "name", "sql" FROM "sqlite_master"
WHERE "type" = 'trigger' AND "name" IN (${REQUIRED_TRIGGER_CONTRACTS.map(() => "?").join(", ")})
ORDER BY "name"`,
  bindings: REQUIRED_TRIGGER_CONTRACTS.map((contract) => contract.name),
};

function parseCanonicalJson(value: string, label: string): unknown {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
  if (artifactReferenceCanonicalJson(parsed) !== value) throw new Error(`${label} is not canonical JSON.`);
  return parsed;
}

function validateExactExecutorPlan(value: unknown) {
  const plan = ArtifactReferenceAtomicPlanSchema.parse(value);
  const rebuilt = buildArtifactReferenceAtomicPlan({
    attemptId: plan.attempt.id,
    workflowRunId: plan.attempt.workflowRunId,
    businessId: plan.attempt.businessId,
    lineageRootManifestId: plan.attempt.lineageRootManifestId,
    attemptNumber: plan.attempt.attemptNumber,
    fencingToken: plan.attempt.fencingToken,
    ownerId: plan.attempt.ownerId,
    requestedAt: plan.attempt.requestedAt,
    acquiredAt: plan.attempt.acquiredAt,
    expiresAt: plan.attempt.expiresAt,
    mode: plan.attempt.mode,
    maxCostUsd: 0,
  });
  if (artifactReferenceCanonicalJson(plan) !== artifactReferenceCanonicalJson(rebuilt)) {
    throw new Error("Trusted D1 execution requires the exact immutable atomic plan, including every control statement.");
  }
  return plan;
}

function validateWriterGuardSchema(rows: SqlRow[]) {
  if (rows.length !== REQUIRED_TRIGGER_CONTRACTS.length) {
    throw new Error(`Trusted D1 execution requires all ${REQUIRED_TRIGGER_CONTRACTS.length} source-freeze and append-only triggers.`);
  }
  const byName = new Map(rows.map((value) => {
    const row = TriggerRowSchema.parse(value);
    return [row.name, row.sql] as const;
  }));
  if (byName.size !== rows.length) throw new Error("Writer-guard schema preflight returned duplicate trigger names.");
  for (const contract of REQUIRED_TRIGGER_CONTRACTS) {
    const sql = byName.get(contract.name);
    if (!sql) throw new Error(`Required writer guard ${contract.name} is missing.`);
    const normalized = sql.replace(/\s+/g, " ").toUpperCase();
    if (
      !normalized.includes(`BEFORE ${contract.operation} ON \"${contract.table.toUpperCase()}\"`)
      || !normalized.includes(contract.errorCode)
      || (contract.operation === "INSERT" && (!normalized.includes("JULIANDAY") || !normalized.includes("'NOW'")))
    ) throw new Error(`Writer guard ${contract.name} does not match its fail-closed operation contract.`);
  }
}

async function runBatch(
  boundary: ArtifactReferenceD1BatchBoundary,
  phase: string,
  statements: readonly ArtifactReferenceD1BatchStatement[],
): Promise<BatchResult[]> {
  let raw: readonly unknown[];
  try {
    raw = await boundary.batch(statements);
  } catch (error) {
    throw new Error(`${phase} D1 batch failed: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
  if (raw.length !== statements.length) throw new Error(`${phase} D1 batch returned ${raw.length} results for ${statements.length} statements.`);
  return raw.map((result, index) => {
    const parsed = BatchResultSchema.safeParse(result);
    if (!parsed.success) throw new Error(`${phase} statement ${statements[index]?.statementId ?? index} returned an invalid D1 result.`);
    return parsed.data;
  });
}

function parseDatabaseTime(result: BatchResult, plan: ArtifactReferenceAtomicPlan, label: string) {
  if (result.results.length !== 1) throw new Error(`${label} requires one database-time row.`);
  const { databaseNow } = DatabaseTimeRowSchema.parse(result.results[0]);
  const now = Date.parse(databaseNow);
  if (!Number.isFinite(now)) throw new Error(`${label} returned an invalid database timestamp.`);
  if (now < Date.parse(plan.attempt.acquiredAt) || now >= Date.parse(plan.attempt.expiresAt)) {
    throw new Error(`${label} is outside the winning half-open fence window.`);
  }
  return databaseNow;
}

function validateAttemptRow(value: unknown, plan: ArtifactReferenceAtomicPlan) {
  const row = SnapshotAttemptRowSchema.parse(value);
  const parsedAttempt = parseCanonicalJson(row.attemptJson, "Snapshot attempt JSON");
  if (artifactReferenceCanonicalJson(parsedAttempt) !== artifactReferenceCanonicalJson(plan.attempt)) {
    throw new Error("Snapshot attempt JSON does not exactly match the planned attempt.");
  }
  const expected = plan.attempt;
  const mirrors = {
    id: row.id,
    attemptVersion: row.attemptVersion,
    workflowRunId: row.workflowRunId,
    businessId: row.businessId,
    lineageRootManifestId: row.lineageRootManifestId,
    attemptNumber: row.attemptNumber,
    fencingToken: row.fencingToken,
    ownerId: row.ownerId,
    queryContractVersion: row.queryContractVersion,
    queryContractDigest: row.queryContractDigest,
    requestDigest: row.requestDigest,
    requestedAt: row.requestedAt,
    acquiredAt: row.acquiredAt,
    expiresAt: row.expiresAt,
    mode: row.mode,
    executorKind: row.executorKind,
    attemptDigest: row.attemptDigest,
  };
  const expectedMirrors = {
    id: expected.id,
    attemptVersion: expected.attemptVersion,
    workflowRunId: expected.workflowRunId,
    businessId: expected.businessId,
    lineageRootManifestId: expected.lineageRootManifestId,
    attemptNumber: expected.attemptNumber,
    fencingToken: expected.fencingToken,
    ownerId: expected.ownerId,
    queryContractVersion: expected.queryContractVersion,
    queryContractDigest: expected.queryContractDigest,
    requestDigest: expected.requestDigest,
    requestedAt: expected.requestedAt,
    acquiredAt: expected.acquiredAt,
    expiresAt: expected.expiresAt,
    mode: expected.mode,
    executorKind: expected.executorKind,
    attemptDigest: expected.attemptDigest,
  };
  if (artifactReferenceCanonicalJson(mirrors) !== artifactReferenceCanonicalJson(expectedMirrors)) {
    throw new Error("Snapshot attempt columns do not exactly mirror the planned attempt.");
  }
  return row;
}

function validateAttemptCollisions(rows: SqlRow[], plan: ArtifactReferenceAtomicPlan) {
  if (rows.length > 1) throw new Error("Snapshot attempt preflight found an alternate-identity collision.");
  return rows.length === 1 ? validateAttemptRow(rows[0], plan) : null;
}

function validateWinningAttempt(rows: SqlRow[], plan: ArtifactReferenceAtomicPlan) {
  if (rows.length !== 1) throw new Error("Snapshot executor requires one exact active winning fence and no higher fence.");
  const winner = WinningAttemptRowSchema.parse(rows[0]);
  const { completenessReceiptId: _receiptId, ...attemptRow } = winner;
  void _receiptId;
  validateAttemptRow(attemptRow, plan);
  return winner;
}

function sourceProofId(receiptId: string, ordinal: number) {
  return `artifact-reference-source-proof:${receiptId}:${String(ordinal).padStart(2, "0")}`;
}

function sourceCount(receipt: z.infer<typeof ArtifactReferenceCompletenessReceiptSchema>, setName: typeof ARTIFACT_REFERENCE_SOURCE_SET_ORDER[number]) {
  const proof = receipt.sourceSetProofs.find((candidate) => candidate.setName === setName);
  if (!proof) throw new Error(`Completeness receipt is missing ${setName}.`);
  return proof.rowCount;
}

function receiptRow(receipt: z.infer<typeof ArtifactReferenceCompletenessReceiptSchema>): Record<string, SqlValue> {
  return {
    id: receipt.receiptId,
    receiptVersion: receipt.receiptVersion,
    snapshotAttemptId: receipt.snapshotAttemptId,
    workflowRunId: receipt.workflowRunId,
    businessId: receipt.businessId,
    lineageRootManifestId: receipt.lineageRootManifestId,
    attemptNumber: receipt.attemptNumber,
    fencingToken: receipt.fencingToken,
    queryContractVersion: receipt.queryContractVersion,
    queryContractDigest: receipt.queryContractDigest,
    snapshotCapturedAt: receipt.snapshotCapturedAt,
    freshUntil: receipt.freshUntil,
    workflowRunCount: sourceCount(receipt, "WORKFLOW_RUNS"),
    workflowHistoryCount: [
      "WORKFLOW_DEFINITIONS", "WORKFLOW_DELIVERIES", "WORKFLOW_ATTEMPTS", "WORKFLOW_LEASES",
      "WORKFLOW_RECEIPT_REVISIONS", "WORKFLOW_ATTEMPT_CLOSURES",
    ].reduce((count, setName) => count + sourceCount(receipt, setName as typeof ARTIFACT_REFERENCE_SOURCE_SET_ORDER[number]), 0),
    manifestCount: sourceCount(receipt, "MANIFESTS"),
    manifestItemCount: sourceCount(receipt, "MANIFEST_ITEMS"),
    promotionCount: sourceCount(receipt, "PROMOTIONS"),
    promotionUseCount: sourceCount(receipt, "PROMOTION_USES"),
    manifestUseCount: sourceCount(receipt, "MANIFEST_USES"),
    evidenceUseCount: sourceCount(receipt, "EVIDENCE_USES"),
    useEndCount: sourceCount(receipt, "USE_ENDS"),
    availabilityCount: sourceCount(receipt, "AVAILABILITY"),
    sourceSetProofsDigest: receipt.sourceSetProofsDigest,
    sourceSetProofsJson: artifactReferenceCanonicalJson(receipt.sourceSetProofs),
    sourceFactsDigest: receipt.sourceFactsDigest,
    receiptDigest: receipt.receiptDigest,
    receiptJson: artifactReferenceCanonicalJson(receipt),
    completenessAssurance: receipt.completenessAssurance,
    availabilityAssurance: receipt.availabilityAssurance,
    snapshotComplete: 1,
    committedAndReloaded: 1,
    retentionConclusionAuthorized: 0,
    projectionPersistenceAuthorized: 0,
    providerOperationsAuthorized: 0,
    releaseAuthorized: 0,
    deletionAuthorized: 0,
    costAuthorizedUsd: 0,
    recordedAt: receipt.recordedAt,
  };
}

function proofRows(receipt: z.infer<typeof ArtifactReferenceCompletenessReceiptSchema>) {
  return receipt.sourceSetProofs.map((proof) => ({
    id: sourceProofId(receipt.receiptId, proof.setOrdinal),
    completenessReceiptId: receipt.receiptId,
    setOrdinal: proof.setOrdinal,
    setName: proof.setName,
    predicateVersion: proof.predicateVersion,
    rowCount: proof.rowCount,
    setDigest: proof.setDigest,
    proofDigest: proof.proofDigest,
    proofJson: artifactReferenceCanonicalJson(proof),
  } satisfies Record<string, SqlValue>));
}

function validatePersistedReceipt(
  receiptRows: SqlRow[],
  persistedProofRows: SqlRow[],
  plan: ArtifactReferenceAtomicPlan,
  expectedReceipt?: z.infer<typeof ArtifactReferenceCompletenessReceiptSchema>,
) {
  if (receiptRows.length !== 1) throw new Error("Committed completeness reload requires one exact receipt row.");
  const row = CompletenessReceiptRowSchema.parse(receiptRows[0]);
  const receipt = ArtifactReferenceCompletenessReceiptSchema.parse(parseCanonicalJson(row.receiptJson, "Completeness receipt JSON"));
  if (expectedReceipt && artifactReferenceCanonicalJson(receipt) !== artifactReferenceCanonicalJson(expectedReceipt)) {
    throw new Error("Committed completeness receipt differs from the executor candidate.");
  }
  if (
    receipt.snapshotAttemptId !== plan.attempt.id
    || receipt.workflowRunId !== plan.attempt.workflowRunId
    || receipt.businessId !== plan.attempt.businessId
    || receipt.lineageRootManifestId !== plan.attempt.lineageRootManifestId
    || receipt.attemptNumber !== plan.attempt.attemptNumber
    || receipt.fencingToken !== plan.attempt.fencingToken
    || receipt.queryContractVersion !== plan.queryContractVersion
    || receipt.queryContractDigest !== plan.queryContractDigest
  ) throw new Error("Committed completeness receipt does not bind the exact planned attempt.");
  if (
    Date.parse(receipt.snapshotCapturedAt) < Date.parse(plan.attempt.acquiredAt)
    || Date.parse(receipt.snapshotCapturedAt) >= Date.parse(plan.attempt.expiresAt)
    || Date.parse(receipt.freshUntil) > Date.parse(plan.attempt.expiresAt)
  ) throw new Error("Committed completeness receipt falls outside its exact attempt window.");

  const expectedRow = receiptRow(receipt);
  for (const [column, expected] of Object.entries(expectedRow)) {
    if (row[column as keyof typeof row] !== expected) throw new Error(`Completeness receipt column ${column} does not mirror its canonical receipt.`);
  }

  if (persistedProofRows.length !== ARTIFACT_REFERENCE_SOURCE_SET_ORDER.length) {
    throw new Error("Committed completeness reload requires all 15 source-set proof rows.");
  }
  const decodedProofs = persistedProofRows.map((value) => {
    const proofRow = SourceSetProofRowSchema.parse(value);
    const proof = ArtifactReferenceSourceSetProofSchema.parse(parseCanonicalJson(proofRow.proofJson, `Source-set proof ${proofRow.id}`));
    const expected = {
      id: sourceProofId(receipt.receiptId, proof.setOrdinal),
      completenessReceiptId: receipt.receiptId,
      setOrdinal: proof.setOrdinal,
      setName: proof.setName,
      predicateVersion: proof.predicateVersion,
      rowCount: proof.rowCount,
      setDigest: proof.setDigest,
      proofDigest: proof.proofDigest,
      proofJson: artifactReferenceCanonicalJson(proof),
    };
    for (const [column, expectedValue] of Object.entries(expected)) {
      if (proofRow[column as keyof typeof proofRow] !== expectedValue) throw new Error(`Source-set proof column ${column} does not mirror ${proof.setName}.`);
    }
    return proof;
  }).sort((left, right) => left.setOrdinal - right.setOrdinal);
  if (artifactReferenceCanonicalJson(decodedProofs) !== artifactReferenceCanonicalJson(receipt.sourceSetProofs)) {
    throw new Error("Persisted source-set proof rows differ from the completeness receipt.");
  }
  return receipt;
}

function trustedResult(
  executionPath: "FRESH_COMMIT" | "EXACT_SEALED_REPLAY",
  receipt: z.infer<typeof ArtifactReferenceCompletenessReceiptSchema>,
  decodedSnapshot: z.infer<typeof ArtifactReferenceDecodedSnapshotSchema> | null,
) {
  const fresh = executionPath === "FRESH_COMMIT";
  const core = TrustedExecutionCoreSchema.parse({
    executorVersion: ARTIFACT_REFERENCE_D1_EXECUTOR_VERSION,
    executionPath,
    transactionApi: "D1Database.batch",
    receipt,
    decodedSnapshot,
    receiptCreationPerformed: fresh,
    sourceRowsMaterialized: fresh,
    committedReceiptReloaded: true,
    transactionallyTrusted: true,
    snapshotComplete: true,
    retentionConclusionAuthorized: false,
    projectionPersistenceAuthorized: false,
    releaseAuthorized: false,
    deletionAuthorized: false,
    providerOperationsAuthorized: 0,
    costAuthorizedUsd: 0,
  });
  return TrustedExecutionSchema.parse({ ...core, executionDigest: artifactReferenceDigest(core) });
}

function preflightAttemptStatement(plan: ArtifactReferenceAtomicPlan): ArtifactReferenceD1BatchStatement {
  const statement = plan.statements.find((candidate) => candidate.statementId === "preflight-attempt-identities");
  if (!statement) throw new Error("Atomic plan is missing the attempt identity preflight.");
  return statement;
}

async function loadExactReplay(
  boundary: ArtifactReferenceD1BatchBoundary,
  plan: ArtifactReferenceAtomicPlan,
): Promise<z.infer<typeof ArtifactReferenceCompletenessReceiptSchema> | null> {
  const results = await runBatch(boundary, "exact replay reload", [
    WRITER_GUARD_PREFLIGHT,
    preflightAttemptStatement(plan),
    { statementId: "reload-replay-receipt", sql: REPLAY_RECEIPT_SQL, bindings: [plan.attempt.id] },
    { statementId: "reload-replay-proofs", sql: REPLAY_PROOFS_SQL, bindings: [plan.attempt.id] },
  ]);
  validateWriterGuardSchema(results[0]?.results ?? []);
  validateAttemptCollisions(results[1]?.results ?? [], plan);
  const receipts = results[2]?.results ?? [];
  if (receipts.length === 0) {
    if ((results[3]?.results.length ?? 0) !== 0) throw new Error("Orphan source-set proofs exist without a completeness receipt.");
    return null;
  }
  if (!results[1] || results[1].results.length !== 1) throw new Error("A completeness receipt exists without its exact planned attempt.");
  return validatePersistedReceipt(receipts, results[3]?.results ?? [], plan);
}

function planStatements(plan: ArtifactReferenceAtomicPlan, group: "PREPARE_SNAPSHOT" | "COMMIT_POSTVERIFY") {
  return plan.statements.filter((statement) => statement.batchGroup === group).map((statement) => ({
    statementId: statement.statementId,
    sql: statement.sql,
    bindings: statement.bindings,
  } satisfies ArtifactReferenceD1BatchStatement));
}

function observationFromResults(
  plan: ArtifactReferenceAtomicPlan,
  snapshotCapturedAt: string,
  statements: ArtifactReferenceD1BatchStatement[],
  results: BatchResult[],
) {
  const resultById = new Map(statements.map((statement, index) => [statement.statementId, results[index]]));
  const winningFenceRows = resultById.get("verify-winning-attempt-fence")?.results ?? [];
  validateWinningAttempt(winningFenceRows, plan);
  const sourceSets = plan.statements.filter((statement) => statement.kind === "SOURCE_READ").map((statement) => ({
    setName: statement.resultSet,
    rows: resultById.get(statement.statementId)?.results ?? [],
  }));
  return ArtifactReferenceAtomicObservationSchema.parse({
    planDigest: plan.planDigest,
    snapshotCapturedAt,
    statementCount: statements.length,
    batchSucceeded: true,
    transactionApi: "D1Database.batch",
    winningFenceRows,
    sourceSets,
  });
}

function minTimestamp(left: string, right: string) {
  return Date.parse(left) <= Date.parse(right) ? left : right;
}

function createReceipt(
  plan: ArtifactReferenceAtomicPlan,
  decoded: z.infer<typeof ArtifactReferenceDecodedSnapshotSchema>,
  sourceSetProofs: z.infer<typeof ArtifactReferenceSourceSetProofSchema>[],
  recordedAt: string,
) {
  const freshUntil = minTimestamp(decoded.selectedAvailabilityFreshUntil, plan.attempt.expiresAt);
  if (Date.parse(recordedAt) >= Date.parse(freshUntil)) throw new Error("Completeness receipt would already be stale at commit time.");
  const core = {
    receiptVersion: ARTIFACT_REFERENCE_COMPLETENESS_RECEIPT_VERSION,
    receiptId: crypto.randomUUID(),
    snapshotAttemptId: plan.attempt.id,
    workflowRunId: plan.attempt.workflowRunId,
    businessId: plan.attempt.businessId,
    lineageRootManifestId: plan.attempt.lineageRootManifestId,
    attemptNumber: plan.attempt.attemptNumber,
    fencingToken: plan.attempt.fencingToken,
    queryContractVersion: plan.queryContractVersion,
    queryContractDigest: plan.queryContractDigest,
    snapshotCapturedAt: decoded.snapshotCapturedAt,
    freshUntil,
    sourceSetProofs,
    sourceSetProofsDigest: artifactReferenceDigest(sourceSetProofs),
    sourceFactsDigest: decoded.selectedLineage.sourceFactsDigest,
    completenessAssurance: "D1_ATOMIC_RECHECK_AND_RELOAD",
    availabilityAssurance: "R2_HEAD_PER_MANIFEST",
    snapshotComplete: true,
    committedAndReloaded: true,
    retentionConclusionAuthorized: false,
    projectionPersistenceAuthorized: false,
    providerOperationsAuthorized: 0,
    releaseAuthorized: false,
    deletionAuthorized: false,
    costAuthorizedUsd: 0,
    recordedAt,
  } as const;
  return ArtifactReferenceCompletenessReceiptSchema.parse({ ...core, receiptDigest: artifactReferenceDigest(core) });
}

function insertColumns(table: string, row: Record<string, SqlValue>, conditionSql = "", conditionBindings: SqlValue[] = []): ArtifactReferenceD1BatchStatement {
  const columns = Object.keys(row);
  return {
    statementId: `insert-${table}`,
    sql: `INSERT INTO "${table}" (${columns.map((column) => `"${column}"`).join(", ")})\nSELECT ${columns.map(() => "?").join(", ")}${conditionSql}`,
    bindings: [...Object.values(row), ...conditionBindings],
  };
}

function commitStatements(
  plan: ArtifactReferenceAtomicPlan,
  receipt: z.infer<typeof ArtifactReferenceCompletenessReceiptSchema>,
) {
  const parentCondition = `
WHERE julianday(?) > julianday('now')
  AND EXISTS (
    SELECT 1 FROM "RevenueArtifactReferenceSnapshotAttempt" a
    WHERE a."id" = ? AND a."attemptDigest" = ?
      AND a."lineageRootManifestId" = ? AND a."attemptNumber" = ? AND a."fencingToken" = ?
      AND julianday(a."acquiredAt") <= julianday('now') AND julianday(a."expiresAt") > julianday('now')
      AND NOT EXISTS (
        SELECT 1 FROM "RevenueArtifactReferenceSnapshotAttempt" higher
        WHERE higher."lineageRootManifestId" = a."lineageRootManifestId" AND higher."fencingToken" > a."fencingToken"
      )
  )`;
  const parent = insertColumns("RevenueArtifactReferenceCompletenessReceipt", receiptRow(receipt), parentCondition, [
    receipt.freshUntil,
    plan.attempt.id,
    plan.attempt.attemptDigest,
    plan.attempt.lineageRootManifestId,
    plan.attempt.attemptNumber,
    plan.attempt.fencingToken,
  ]);
  const children = proofRows(receipt).map((row, index) => ({
    ...insertColumns("RevenueArtifactReferenceSourceSetProof", row, `\nWHERE EXISTS (SELECT 1 FROM "RevenueArtifactReferenceCompletenessReceipt" WHERE "id" = ? AND "receiptDigest" = ?)`, [receipt.receiptId, receipt.receiptDigest]),
    statementId: `insert-source-proof-${String(index + 1).padStart(2, "0")}`,
  }));
  const winner = plan.statements.find((statement) => statement.statementId === "verify-winning-attempt-fence");
  if (!winner) throw new Error("Atomic plan is missing the winning-fence verification.");
  return [
    { ...parent, statementId: "insert-completeness-receipt" },
    ...children,
    { statementId: "postverify-winning-fence", sql: winner.sql, bindings: winner.bindings },
    { statementId: "postverify-completeness-receipt", sql: REPLAY_RECEIPT_SQL, bindings: [plan.attempt.id] },
    { statementId: "postverify-source-proofs", sql: REPLAY_PROOFS_SQL, bindings: [plan.attempt.id] },
  ];
}

async function targetPreflight(
  boundary: ArtifactReferenceD1BatchBoundary,
  plan: ArtifactReferenceAtomicPlan,
  receipt: z.infer<typeof ArtifactReferenceCompletenessReceiptSchema>,
) {
  const ids = proofRows(receipt).map((row) => String(row.id));
  const receiptSql = `SELECT * FROM "RevenueArtifactReferenceCompletenessReceipt"
WHERE "id" = ? OR "snapshotAttemptId" = ? OR "receiptDigest" = ?
   OR ("lineageRootManifestId" = ? AND "receiptVersion" = ? AND "snapshotCapturedAt" = ?)
ORDER BY "id"`;
  const proofSql = `SELECT * FROM "RevenueArtifactReferenceSourceSetProof"
WHERE "completenessReceiptId" = ? OR "id" IN (${ids.map(() => "?").join(", ")})
ORDER BY "id"`;
  const winner = plan.statements.find((statement) => statement.statementId === "verify-winning-attempt-fence");
  if (!winner) throw new Error("Atomic plan is missing the winning-fence verification.");
  const statements: ArtifactReferenceD1BatchStatement[] = [
    DATABASE_TIME_STATEMENT,
    { statementId: "preflight-winning-fence", sql: winner.sql, bindings: winner.bindings },
    {
      statementId: "preflight-completeness-targets",
      sql: receiptSql,
      bindings: [receipt.receiptId, receipt.snapshotAttemptId, receipt.receiptDigest, receipt.lineageRootManifestId, receipt.receiptVersion, receipt.snapshotCapturedAt],
    },
    { statementId: "preflight-proof-targets", sql: proofSql, bindings: [receipt.receiptId, ...ids] },
  ];
  const results = await runBatch(boundary, "target collision preflight", statements);
  const databaseNow = parseDatabaseTime(results[0]!, plan, "Target collision preflight");
  if (Date.parse(databaseNow) >= Date.parse(receipt.freshUntil)) throw new Error("Target collision preflight reached the receipt freshness boundary.");
  validateWinningAttempt(results[1]?.results ?? [], plan);
  return { receiptRows: results[2]?.results ?? [], proofRows: results[3]?.results ?? [] };
}

/**
 * Executes the private, fail-closed D1 completeness protocol. The caller can
 * choose a validated plan, but cannot supply rows, timestamps, proofs, receipt
 * identities, or a trusted result. No provider, projection, retention, release,
 * deletion, outreach, or cost authority is granted.
 */
export async function executeArtifactReferenceD1Snapshot(
  boundary: ArtifactReferenceD1BatchBoundary,
  planValue: unknown,
): Promise<ArtifactReferenceTrustedD1Execution> {
  const plan = validateExactExecutorPlan(planValue);
  const replay = await loadExactReplay(boundary, plan);
  if (replay) return trustedResult("EXACT_SEALED_REPLAY", replay, null);

  const prepareStatements = planStatements(plan, "PREPARE_SNAPSHOT");
  const prepareResults = await runBatch(boundary, "claim and source read", [DATABASE_TIME_STATEMENT, ...prepareStatements]);
  const snapshotCapturedAt = parseDatabaseTime(prepareResults[0]!, plan, "Claim and source read");
  const planResults = prepareResults.slice(1);
  const resultById = new Map(prepareStatements.map((statement, index) => [statement.statementId, planResults[index]]));
  validateAttemptCollisions(resultById.get("preflight-attempt-identities")?.results ?? [], plan);
  if ((resultById.get("preflight-existing-completeness")?.results.length ?? 0) > 0) {
    const racedReplay = await loadExactReplay(boundary, plan);
    if (!racedReplay) throw new Error("Completeness appeared during prepare but exact replay reload failed.");
    return trustedResult("EXACT_SEALED_REPLAY", racedReplay, null);
  }
  const claim = resultById.get("claim-attempt-fence");
  if (!claim || claim.changes > 1) throw new Error("Snapshot claim returned an invalid mutation count.");
  const observation = observationFromResults(plan, snapshotCapturedAt, prepareStatements, planResults);
  const decoded = decodeArtifactReferenceD1SourceSnapshot(plan, observation);
  const initialProof = buildUntrustedArtifactReferenceSourceProof(plan, observation);

  const winner = plan.statements.find((statement) => statement.statementId === "verify-winning-attempt-fence");
  if (!winner) throw new Error("Atomic plan is missing the winning-fence verification.");
  const sourceReads = plan.statements.filter((statement) => statement.kind === "SOURCE_READ").map((statement) => ({
    statementId: statement.statementId,
    sql: statement.sql,
    bindings: statement.bindings,
  } satisfies ArtifactReferenceD1BatchStatement));
  const recheckStatements: ArtifactReferenceD1BatchStatement[] = [
    DATABASE_TIME_STATEMENT,
    { statementId: "recheck-winning-fence", sql: winner.sql, bindings: winner.bindings },
    ...sourceReads,
  ];
  const recheckResults = await runBatch(boundary, "source recheck", recheckStatements);
  const recordedAt = parseDatabaseTime(recheckResults[0]!, plan, "Source recheck");
  validateWinningAttempt(recheckResults[1]?.results ?? [], plan);
  const recheckObservation = ArtifactReferenceAtomicObservationSchema.parse({
    planDigest: plan.planDigest,
    snapshotCapturedAt,
    statementCount: prepareStatements.length,
    batchSucceeded: true,
    transactionApi: "D1Database.batch",
    winningFenceRows: recheckResults[1]?.results ?? [],
    sourceSets: sourceReads.map((statement, index) => ({
      setName: plan.statements.find((candidate) => candidate.statementId === statement.statementId)?.resultSet,
      rows: recheckResults[index + 2]?.results ?? [],
    })),
  });
  const recheckProof = buildUntrustedArtifactReferenceSourceProof(plan, recheckObservation);
  const recheckDecoded = decodeArtifactReferenceD1SourceSnapshot(plan, recheckObservation);
  if (
    recheckProof.sourceSetProofsDigest !== initialProof.sourceSetProofsDigest
    || recheckProof.sourceBaseRowsDigest !== initialProof.sourceBaseRowsDigest
    || recheckDecoded.decodedFactsDigest !== decoded.decodedFactsDigest
  ) throw new Error("Atomic source recheck drifted before completeness commit.");

  const receipt = createReceipt(plan, decoded, initialProof.sourceSetProofs, recordedAt);
  const collisions = await targetPreflight(boundary, plan, receipt);
  if (collisions.receiptRows.length > 0 || collisions.proofRows.length > 0) {
    const racedReplay = await loadExactReplay(boundary, plan);
    if (racedReplay) return trustedResult("EXACT_SEALED_REPLAY", racedReplay, null);
    throw new Error("Completeness target preflight found a divergent primary or alternate identity collision.");
  }

  const commit = commitStatements(plan, receipt);
  let commitResults: BatchResult[];
  try {
    commitResults = await runBatch(boundary, "completeness commit", commit);
  } catch (error) {
    const racedReplay = await loadExactReplay(boundary, plan);
    if (racedReplay) return trustedResult("EXACT_SEALED_REPLAY", racedReplay, null);
    throw error;
  }
  if (commitResults[0]?.changes !== 1 || commitResults.slice(1, 16).some((result) => result.changes !== 1)) {
    throw new Error("Completeness commit did not insert exactly one parent and all 15 proof children.");
  }
  validateWinningAttempt(commitResults[16]?.results ?? [], plan);
  validatePersistedReceipt(commitResults[17]?.results ?? [], commitResults[18]?.results ?? [], plan, receipt);

  const reloaded = await loadExactReplay(boundary, plan);
  if (!reloaded || artifactReferenceCanonicalJson(reloaded) !== artifactReferenceCanonicalJson(receipt)) {
    throw new Error("Committed completeness receipt failed its independent reload.");
  }
  return trustedResult("FRESH_COMMIT", reloaded, decoded);
}
