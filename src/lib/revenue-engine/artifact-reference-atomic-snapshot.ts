import { z } from "zod";

import {
  ARTIFACT_REFERENCE_MAX_FRESHNESS_MS,
  artifactReferenceCanonicalJson,
  artifactReferenceDigest,
} from "@/lib/revenue-engine/artifact-reference-projection";

export const ARTIFACT_REFERENCE_ATOMIC_QUERY_CONTRACT_VERSION = "artifact-reference-atomic-query-v1";
export const ARTIFACT_REFERENCE_SNAPSHOT_ATTEMPT_VERSION = "artifact-reference-snapshot-attempt-v1";
export const ARTIFACT_REFERENCE_COMPLETENESS_RECEIPT_VERSION = "artifact-reference-completeness-receipt-v1";
export const ARTIFACT_REFERENCE_ATOMIC_PLAN_VERSION = "artifact-reference-atomic-plan-v1";
export const ARTIFACT_REFERENCE_ATOMIC_TARGET_SCHEMA_VERSION = "0059_atomic_artifact_reference_snapshots";

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const SqlValueSchema = z.union([z.string(), z.number().finite(), z.null()]);
const SqlRowSchema = z.record(z.string(), SqlValueSchema);

export const ArtifactReferenceSourceSetNameSchema = z.enum([
  "WORKFLOW_RUNS",
  "WORKFLOW_DEFINITIONS",
  "WORKFLOW_DELIVERIES",
  "WORKFLOW_ATTEMPTS",
  "WORKFLOW_LEASES",
  "WORKFLOW_RECEIPT_REVISIONS",
  "WORKFLOW_ATTEMPT_CLOSURES",
  "MANIFESTS",
  "MANIFEST_ITEMS",
  "PROMOTIONS",
  "PROMOTION_USES",
  "MANIFEST_USES",
  "EVIDENCE_USES",
  "USE_ENDS",
  "AVAILABILITY",
]);

export type ArtifactReferenceSourceSetName = z.infer<typeof ArtifactReferenceSourceSetNameSchema>;

const SOURCE_SET_ORDER = ArtifactReferenceSourceSetNameSchema.options;

const StatementSchema = z.object({
  statementId: z.string().trim().min(1).max(100),
  kind: z.enum(["PREFLIGHT", "FENCE_CLAIM", "FENCE_VERIFY", "SOURCE_READ", "POST_VERIFY"]),
  batchGroup: z.enum(["PREPARE_SNAPSHOT", "COMMIT_POSTVERIFY"]),
  sql: z.string().trim().min(1),
  bindings: z.array(SqlValueSchema).max(100),
  resultSet: ArtifactReferenceSourceSetNameSchema.nullable(),
  collisionComplete: z.boolean(),
  mustRunInSingleBatch: z.literal(true),
}).strict();

const AttemptCoreSchema = z.object({
  id: z.string().uuid(),
  attemptVersion: z.literal(ARTIFACT_REFERENCE_SNAPSHOT_ATTEMPT_VERSION),
  workflowRunId: z.string().uuid(),
  businessId: z.string().trim().min(1).max(128),
  lineageRootManifestId: z.string().uuid(),
  attemptNumber: z.number().int().min(1).max(10_000),
  fencingToken: z.number().int().min(1).max(2_147_483_647),
  ownerId: z.string().trim().min(1).max(128),
  queryContractVersion: z.literal(ARTIFACT_REFERENCE_ATOMIC_QUERY_CONTRACT_VERSION),
  queryContractDigest: Sha256Schema,
  requestDigest: Sha256Schema,
  requestedAt: z.string().datetime({ offset: true }),
  acquiredAt: z.string().datetime({ offset: true }),
  expiresAt: z.string().datetime({ offset: true }),
  mode: z.literal("SHADOW"),
  executorKind: z.literal("D1_ATOMIC_BATCH"),
}).strict();

const AttemptRecordSchema = AttemptCoreSchema.extend({
  attemptDigest: Sha256Schema,
  providerOperationsAuthorized: z.literal(0),
  releaseAuthorized: z.literal(false),
  deletionAuthorized: z.literal(false),
  costAuthorizedUsd: z.literal(0),
}).strict();

export const ArtifactReferenceAtomicPlanRequestSchema = z.object({
  attemptId: z.string().uuid(),
  workflowRunId: z.string().uuid(),
  businessId: z.string().trim().min(1).max(128),
  lineageRootManifestId: z.string().uuid(),
  attemptNumber: z.number().int().min(1).max(10_000),
  fencingToken: z.number().int().min(1).max(2_147_483_647),
  ownerId: z.string().trim().min(1).max(128),
  requestedAt: z.string().datetime({ offset: true }),
  acquiredAt: z.string().datetime({ offset: true }),
  expiresAt: z.string().datetime({ offset: true }),
  mode: z.literal("SHADOW"),
  maxCostUsd: z.literal(0),
}).strict().superRefine((request, context) => {
  const requestedAt = Date.parse(request.requestedAt);
  const acquiredAt = Date.parse(request.acquiredAt);
  const expiresAt = Date.parse(request.expiresAt);
  if (acquiredAt < requestedAt) {
    context.addIssue({ code: "custom", message: "A snapshot attempt cannot be acquired before it is requested.", path: ["acquiredAt"] });
  }
  if (expiresAt <= acquiredAt || expiresAt - acquiredAt > ARTIFACT_REFERENCE_MAX_FRESHNESS_MS) {
    context.addIssue({ code: "custom", message: "A snapshot fence must use a positive lease no longer than five minutes.", path: ["expiresAt"] });
  }
});

export const ArtifactReferenceAtomicPlanSchema = z.object({
  planVersion: z.literal(ARTIFACT_REFERENCE_ATOMIC_PLAN_VERSION),
  targetSchemaVersion: z.literal(ARTIFACT_REFERENCE_ATOMIC_TARGET_SCHEMA_VERSION),
  queryContractVersion: z.literal(ARTIFACT_REFERENCE_ATOMIC_QUERY_CONTRACT_VERSION),
  queryContractDigest: Sha256Schema,
  attempt: AttemptRecordSchema,
  statements: z.array(StatementSchema).min(20).max(40),
  sourceSetOrder: z.array(ArtifactReferenceSourceSetNameSchema).length(SOURCE_SET_ORDER.length),
  phases: z.tuple([
    z.literal("PREFLIGHT_EXACT_IDENTITIES"),
    z.literal("CLAIM_STRICTLY_HIGHER_FENCE"),
    z.literal("ATOMIC_SOURCE_READ"),
    z.literal("PURE_VALIDATE_AND_PROJECT"),
    z.literal("ATOMIC_RECHECK_INSERT_AND_POSTVERIFY"),
    z.literal("RELOAD_COMMITTED_RECEIPT"),
  ]),
  atomicity: z.object({
    provider: z.literal("CLOUDFLARE_D1"),
    api: z.literal("D1Database.batch"),
    prepareAndReadInOneBatch: z.literal(true),
    commitRechecksAllSourceSets: z.literal(true),
    rollbackWholeBatchOnFailure: z.literal(true),
    sessionsAreNotAtomicSnapshots: z.literal(true),
  }).strict(),
  commitRequirements: z.array(z.string()).length(9),
  sourceWriterFenceGuardRequired: z.literal(true),
  allSourceWritersGuarded: z.literal(false),
  completenessReceiptCreationAuthorized: z.literal(false),
  mutationAuthorized: z.literal(false),
  executionAuthorized: z.literal(false),
  projectionPersistenceAuthorized: z.literal(false),
  retentionConclusionAuthorized: z.literal(false),
  releaseAuthorized: z.literal(false),
  deletionAuthorized: z.literal(false),
  providerOperationsAuthorized: z.literal(0),
  costAuthorizedUsd: z.literal(0),
  planDigest: Sha256Schema,
}).strict().superRefine((plan, context) => {
  const sourceReads = plan.statements.filter((statement) => statement.kind === "SOURCE_READ");
  if (
    sourceReads.length !== SOURCE_SET_ORDER.length
    || sourceReads.some((statement, index) => statement.resultSet !== SOURCE_SET_ORDER[index])
    || plan.sourceSetOrder.some((setName, index) => setName !== SOURCE_SET_ORDER[index])
  ) {
    context.addIssue({ code: "custom", message: "Atomic source reads must cover every source set once and in contract order.", path: ["statements"] });
  }
  if (
    plan.queryContractDigest !== queryContractDigest()
    || sourceReads.some((statement, index) => (
      statement.statementId !== SOURCE_QUERIES[index]?.statementId
      || statement.sql !== SOURCE_QUERIES[index]?.sql
      || artifactReferenceCanonicalJson(statement.bindings) !== artifactReferenceCanonicalJson(SOURCE_QUERIES[index]?.bind(plan.attempt) ?? [])
      || statement.batchGroup !== "PREPARE_SNAPSHOT"
      || !statement.collisionComplete
    ))
  ) {
    context.addIssue({ code: "custom", message: "Atomic source reads must match the immutable versioned query contract.", path: ["queryContractDigest"] });
  }
  if (plan.statements.some((statement) => /\blimit\s+1\b/i.test(statement.sql))) {
    context.addIssue({ code: "custom", message: "Atomic snapshot SQL cannot truncate alternate collision candidates.", path: ["statements"] });
  }
  const core = { ...plan, planDigest: undefined };
  if (plan.planDigest !== artifactReferenceDigest(core)) {
    context.addIssue({ code: "custom", message: "Atomic snapshot plan digest must bind the complete plan.", path: ["planDigest"] });
  }
});

export type ArtifactReferenceAtomicPlan = z.infer<typeof ArtifactReferenceAtomicPlanSchema>;

const SCOPED_PROMOTIONS = `WITH RECURSIVE "ScopedManifest" AS (
  SELECT "id" FROM "RevenueArtifactManifest" WHERE "workflowRunId" = ?
), "ScopedPromotion" AS (
  SELECT "id" FROM "RevenueArtifactPromotionReceipt"
  WHERE "workflowRunId" = ?
    OR "sourceManifestId" IN (SELECT "id" FROM "ScopedManifest")
    OR "resultManifestId" IN (SELECT "id" FROM "ScopedManifest")
)`;

const SCOPED_EVIDENCE_USES = `${SCOPED_PROMOTIONS}, "SeedUse"("id") AS (
  SELECT "evidenceUseId" FROM "RevenueArtifactPromotionUse" WHERE "promotionId" IN (SELECT "id" FROM "ScopedPromotion")
  UNION
  SELECT "evidenceUseId" FROM "RevenueArtifactManifestEvidenceUse"
  WHERE "manifestId" IN (SELECT "id" FROM "ScopedManifest") OR "viaPromotionId" IN (SELECT "id" FROM "ScopedPromotion")
), "ScopedUse"("id") AS (
  SELECT "id" FROM "SeedUse"
  UNION
  SELECT e."replacementEvidenceUseId" FROM "RevenueArtifactEvidenceUseEnd" e
  JOIN "ScopedUse" s ON s."id" = e."evidenceUseId"
  WHERE e."replacementEvidenceUseId" IS NOT NULL
)`;

type QueryTemplate = {
  statementId: string;
  setName: ArtifactReferenceSourceSetName;
  sql: string;
  bind: (scope: { workflowRunId: string; businessId: string; lineageRootManifestId: string }) => Array<string>;
};

const SOURCE_QUERIES: QueryTemplate[] = [
  {
    statementId: "source-workflow-runs",
    setName: "WORKFLOW_RUNS",
    sql: `SELECT * FROM "RevenueWorkflowRun"
WHERE "id" = ?
   OR ("workflowKind", "idempotencyKey") = (
     SELECT "workflowKind", "idempotencyKey" FROM "RevenueWorkflowRun" WHERE "id" = ?
   )
ORDER BY "id"`,
    bind: ({ workflowRunId }) => [workflowRunId, workflowRunId],
  },
  {
    statementId: "source-workflow-definitions",
    setName: "WORKFLOW_DEFINITIONS",
    sql: `SELECT * FROM "RevenueWorkflowDefinition"
WHERE "id" IN (SELECT "definitionId" FROM "RevenueWorkflowDelivery" WHERE "workflowRunId" = ?)
   OR "id" IN (SELECT "definitionId" FROM "RevenueWorkflowAttempt" WHERE "workflowRunId" = ?)
ORDER BY "id"`,
    bind: ({ workflowRunId }) => [workflowRunId, workflowRunId],
  },
  {
    statementId: "source-workflow-deliveries",
    setName: "WORKFLOW_DELIVERIES",
    sql: `SELECT * FROM "RevenueWorkflowDelivery" WHERE "workflowRunId" = ? ORDER BY "id"`,
    bind: ({ workflowRunId }) => [workflowRunId],
  },
  {
    statementId: "source-workflow-attempts",
    setName: "WORKFLOW_ATTEMPTS",
    sql: `SELECT * FROM "RevenueWorkflowAttempt" WHERE "workflowRunId" = ? ORDER BY "id"`,
    bind: ({ workflowRunId }) => [workflowRunId],
  },
  {
    statementId: "source-workflow-leases",
    setName: "WORKFLOW_LEASES",
    sql: `SELECT * FROM "RevenueWorkflowLease" WHERE "workflowRunId" = ? ORDER BY "id"`,
    bind: ({ workflowRunId }) => [workflowRunId],
  },
  {
    statementId: "source-workflow-receipt-revisions",
    setName: "WORKFLOW_RECEIPT_REVISIONS",
    sql: `SELECT * FROM "RevenueWorkflowReceiptRevision" WHERE "workflowRunId" = ? ORDER BY "id"`,
    bind: ({ workflowRunId }) => [workflowRunId],
  },
  {
    statementId: "source-workflow-attempt-closures",
    setName: "WORKFLOW_ATTEMPT_CLOSURES",
    sql: `SELECT c.* FROM "RevenueWorkflowAttemptClosure" c
JOIN "RevenueWorkflowAttempt" a ON a."id" = c."attemptId"
WHERE a."workflowRunId" = ? ORDER BY c."id"`,
    bind: ({ workflowRunId }) => [workflowRunId],
  },
  {
    statementId: "source-manifests",
    setName: "MANIFESTS",
    sql: `SELECT * FROM "RevenueArtifactManifest" WHERE "workflowRunId" = ? ORDER BY "id"`,
    bind: ({ workflowRunId }) => [workflowRunId],
  },
  {
    statementId: "source-manifest-items",
    setName: "MANIFEST_ITEMS",
    sql: `SELECT i.* FROM "RevenueArtifactManifestItem" i
JOIN "RevenueArtifactManifest" m ON m."id" = i."manifestId"
WHERE m."workflowRunId" = ? ORDER BY i."id"`,
    bind: ({ workflowRunId }) => [workflowRunId],
  },
  {
    statementId: "source-promotions",
    setName: "PROMOTIONS",
    sql: `${SCOPED_PROMOTIONS}
SELECT p.* FROM "RevenueArtifactPromotionReceipt" p
WHERE p."id" IN (SELECT "id" FROM "ScopedPromotion") ORDER BY p."id"`,
    bind: ({ workflowRunId }) => [workflowRunId, workflowRunId],
  },
  {
    statementId: "source-promotion-uses",
    setName: "PROMOTION_USES",
    sql: `${SCOPED_PROMOTIONS}
SELECT u.* FROM "RevenueArtifactPromotionUse" u
WHERE u."promotionId" IN (SELECT "id" FROM "ScopedPromotion") ORDER BY u."id"`,
    bind: ({ workflowRunId }) => [workflowRunId, workflowRunId],
  },
  {
    statementId: "source-manifest-uses",
    setName: "MANIFEST_USES",
    sql: `${SCOPED_PROMOTIONS}
SELECT u.* FROM "RevenueArtifactManifestEvidenceUse" u
WHERE u."manifestId" IN (SELECT "id" FROM "ScopedManifest")
   OR u."viaPromotionId" IN (SELECT "id" FROM "ScopedPromotion")
ORDER BY u."id"`,
    bind: ({ workflowRunId }) => [workflowRunId, workflowRunId],
  },
  {
    statementId: "source-evidence-uses",
    setName: "EVIDENCE_USES",
    sql: `${SCOPED_EVIDENCE_USES}
SELECT u.* FROM "RevenueArtifactEvidenceUse" u
WHERE u."id" IN (SELECT "id" FROM "ScopedUse") ORDER BY u."id"`,
    bind: ({ workflowRunId }) => [workflowRunId, workflowRunId],
  },
  {
    statementId: "source-use-ends",
    setName: "USE_ENDS",
    sql: `${SCOPED_EVIDENCE_USES}
SELECT e.* FROM "RevenueArtifactEvidenceUseEnd" e
WHERE e."evidenceUseId" IN (SELECT "id" FROM "ScopedUse") ORDER BY e."id"`,
    bind: ({ workflowRunId }) => [workflowRunId, workflowRunId],
  },
  {
    statementId: "source-availability",
    setName: "AVAILABILITY",
    sql: `SELECT a.* FROM "RevenueArtifactManifestAvailabilityReceipt" a
JOIN "RevenueArtifactManifest" m ON m."id" = a."manifestId"
WHERE m."workflowRunId" = ? ORDER BY a."id"`,
    bind: ({ workflowRunId }) => [workflowRunId],
  },
];

function queryContractDigest() {
  return artifactReferenceDigest({
    version: ARTIFACT_REFERENCE_ATOMIC_QUERY_CONTRACT_VERSION,
    sourceQueries: SOURCE_QUERIES.map(({ statementId, setName, sql }) => ({ statementId, setName, sql })),
    sourceSetOrder: SOURCE_SET_ORDER,
  });
}

export function buildArtifactReferenceAtomicPlan(value: unknown): ArtifactReferenceAtomicPlan {
  const request = ArtifactReferenceAtomicPlanRequestSchema.parse(value);
  const contractDigest = queryContractDigest();
  const requestDigest = artifactReferenceDigest({
    requestVersion: "artifact-reference-snapshot-request-v1",
    workflowRunId: request.workflowRunId,
    businessId: request.businessId,
    lineageRootManifestId: request.lineageRootManifestId,
    queryContractVersion: ARTIFACT_REFERENCE_ATOMIC_QUERY_CONTRACT_VERSION,
    queryContractDigest: contractDigest,
    requestedAt: request.requestedAt,
    mode: request.mode,
    maxCostUsd: request.maxCostUsd,
  });
  const attemptCore = AttemptCoreSchema.parse({
    id: request.attemptId,
    attemptVersion: ARTIFACT_REFERENCE_SNAPSHOT_ATTEMPT_VERSION,
    workflowRunId: request.workflowRunId,
    businessId: request.businessId,
    lineageRootManifestId: request.lineageRootManifestId,
    attemptNumber: request.attemptNumber,
    fencingToken: request.fencingToken,
    ownerId: request.ownerId,
    queryContractVersion: ARTIFACT_REFERENCE_ATOMIC_QUERY_CONTRACT_VERSION,
    queryContractDigest: contractDigest,
    requestDigest,
    requestedAt: request.requestedAt,
    acquiredAt: request.acquiredAt,
    expiresAt: request.expiresAt,
    mode: "SHADOW",
    executorKind: "D1_ATOMIC_BATCH",
  });
  const attempt = AttemptRecordSchema.parse({
    ...attemptCore,
    attemptDigest: artifactReferenceDigest(attemptCore),
    providerOperationsAuthorized: 0,
    releaseAuthorized: false,
    deletionAuthorized: false,
    costAuthorizedUsd: 0,
  });
  const attemptRow = {
    id: attempt.id,
    attemptVersion: attempt.attemptVersion,
    workflowRunId: attempt.workflowRunId,
    businessId: attempt.businessId,
    lineageRootManifestId: attempt.lineageRootManifestId,
    attemptNumber: attempt.attemptNumber,
    fencingToken: attempt.fencingToken,
    ownerId: attempt.ownerId,
    queryContractVersion: attempt.queryContractVersion,
    queryContractDigest: attempt.queryContractDigest,
    requestDigest: attempt.requestDigest,
    requestedAt: attempt.requestedAt,
    acquiredAt: attempt.acquiredAt,
    expiresAt: attempt.expiresAt,
    mode: attempt.mode,
    executorKind: attempt.executorKind,
    attemptDigest: attempt.attemptDigest,
    attemptJson: artifactReferenceCanonicalJson(attempt),
    providerOperationsAuthorized: 0,
    releaseAuthorized: 0,
    deletionAuthorized: 0,
    costAuthorizedUsd: 0,
  };
  const columns = Object.keys(attemptRow);
  const statements: z.infer<typeof StatementSchema>[] = [
    {
      statementId: "preflight-attempt-identities",
      kind: "PREFLIGHT",
      sql: `SELECT * FROM "RevenueArtifactReferenceSnapshotAttempt"
WHERE "id" = ?
   OR ("lineageRootManifestId" = ? AND "attemptNumber" = ?)
   OR ("lineageRootManifestId" = ? AND "fencingToken" = ?)
   OR "attemptDigest" = ?
ORDER BY "id"`,
      bindings: [attempt.id, attempt.lineageRootManifestId, attempt.attemptNumber, attempt.lineageRootManifestId, attempt.fencingToken, attempt.attemptDigest],
      batchGroup: "PREPARE_SNAPSHOT",
      resultSet: null,
      collisionComplete: true,
      mustRunInSingleBatch: true,
    },
    {
      statementId: "preflight-existing-completeness",
      kind: "PREFLIGHT",
      sql: `SELECT * FROM "RevenueArtifactReferenceCompletenessReceipt" WHERE "snapshotAttemptId" = ? ORDER BY "id"`,
      bindings: [attempt.id],
      batchGroup: "PREPARE_SNAPSHOT",
      resultSet: null,
      collisionComplete: true,
      mustRunInSingleBatch: true,
    },
    {
      statementId: "claim-attempt-fence",
      kind: "FENCE_CLAIM",
      batchGroup: "PREPARE_SNAPSHOT",
      sql: `INSERT OR IGNORE INTO "RevenueArtifactReferenceSnapshotAttempt" (${columns.map((column) => `"${column}"`).join(", ")})
SELECT ${columns.map(() => "?").join(", ")}
WHERE ? = COALESCE((SELECT MAX("attemptNumber") + 1 FROM "RevenueArtifactReferenceSnapshotAttempt" WHERE "lineageRootManifestId" = ?), 1)
  AND ? > COALESCE((SELECT MAX("fencingToken") FROM "RevenueArtifactReferenceSnapshotAttempt" WHERE "lineageRootManifestId" = ?), 0)
  AND NOT EXISTS (
    SELECT 1 FROM "RevenueArtifactReferenceSnapshotAttempt" a
    LEFT JOIN "RevenueArtifactReferenceCompletenessReceipt" r ON r."snapshotAttemptId" = a."id"
    WHERE a."lineageRootManifestId" = ? AND r."id" IS NULL AND julianday(a."expiresAt") > julianday(?)
  )`,
      bindings: [
        ...Object.values(attemptRow),
        attempt.attemptNumber,
        attempt.lineageRootManifestId,
        attempt.fencingToken,
        attempt.lineageRootManifestId,
        attempt.lineageRootManifestId,
        attempt.acquiredAt,
      ],
      resultSet: null,
      collisionComplete: false,
      mustRunInSingleBatch: true,
    },
    {
      statementId: "verify-winning-attempt-fence",
      kind: "FENCE_VERIFY",
      batchGroup: "PREPARE_SNAPSHOT",
      sql: `SELECT a.*, r."id" AS "completenessReceiptId"
FROM "RevenueArtifactReferenceSnapshotAttempt" a
LEFT JOIN "RevenueArtifactReferenceCompletenessReceipt" r ON r."snapshotAttemptId" = a."id"
WHERE a."id" = ?
   OR (a."lineageRootManifestId" = ? AND a."attemptNumber" = ?)
   OR (a."lineageRootManifestId" = ? AND a."fencingToken" = ?)
ORDER BY a."id"`,
      bindings: [attempt.id, attempt.lineageRootManifestId, attempt.attemptNumber, attempt.lineageRootManifestId, attempt.fencingToken],
      resultSet: null,
      collisionComplete: true,
      mustRunInSingleBatch: true,
    },
    ...SOURCE_QUERIES.map(({ statementId, setName, sql, bind }) => StatementSchema.parse({
      statementId,
      kind: "SOURCE_READ",
      batchGroup: "PREPARE_SNAPSHOT",
      sql,
      bindings: bind(request),
      resultSet: setName,
      collisionComplete: true,
      mustRunInSingleBatch: true,
    })),
    {
      statementId: "postverify-completeness-identities",
      kind: "POST_VERIFY",
      batchGroup: "COMMIT_POSTVERIFY",
      sql: `SELECT * FROM "RevenueArtifactReferenceCompletenessReceipt" WHERE "snapshotAttemptId" = ? ORDER BY "id"`,
      bindings: [attempt.id],
      resultSet: null,
      collisionComplete: true,
      mustRunInSingleBatch: true,
    },
  ];
  const core = {
    planVersion: ARTIFACT_REFERENCE_ATOMIC_PLAN_VERSION,
    targetSchemaVersion: ARTIFACT_REFERENCE_ATOMIC_TARGET_SCHEMA_VERSION,
    queryContractVersion: ARTIFACT_REFERENCE_ATOMIC_QUERY_CONTRACT_VERSION,
    queryContractDigest: contractDigest,
    attempt,
    statements,
    sourceSetOrder: SOURCE_SET_ORDER,
    phases: [
      "PREFLIGHT_EXACT_IDENTITIES",
      "CLAIM_STRICTLY_HIGHER_FENCE",
      "ATOMIC_SOURCE_READ",
      "PURE_VALIDATE_AND_PROJECT",
      "ATOMIC_RECHECK_INSERT_AND_POSTVERIFY",
      "RELOAD_COMMITTED_RECEIPT",
    ],
    atomicity: {
      provider: "CLOUDFLARE_D1",
      api: "D1Database.batch",
      prepareAndReadInOneBatch: true,
      commitRechecksAllSourceSets: true,
      rollbackWholeBatchOnFailure: true,
      sessionsAreNotAtomicSnapshots: true,
    },
    commitRequirements: [
      "re-read the exact live winning attempt and reject exact-expiry or any higher fence",
      "re-run every source query in one D1 batch and require identical set proofs",
      "validate full workflow history and one exact sealed terminal result",
      "decode canonical rows and reproduce lineage, uses, endings, and availability",
      "preflight every base and target primary plus alternate identity without row truncation",
      "insert missing parents before children with insert-if-absent semantics",
      "reload every target row and require one exact match",
      "insert completeness only after every prior recheck succeeds in the same transaction",
      "reload the committed receipt before returning any trusted completeness result",
    ],
    sourceWriterFenceGuardRequired: true,
    allSourceWritersGuarded: false,
    completenessReceiptCreationAuthorized: false,
    mutationAuthorized: false,
    executionAuthorized: false,
    projectionPersistenceAuthorized: false,
    retentionConclusionAuthorized: false,
    releaseAuthorized: false,
    deletionAuthorized: false,
    providerOperationsAuthorized: 0,
    costAuthorizedUsd: 0,
  } as const;
  return ArtifactReferenceAtomicPlanSchema.parse({ ...core, planDigest: artifactReferenceDigest(core) });
}

export const ArtifactReferenceSourceSetObservationSchema = z.object({
  setName: ArtifactReferenceSourceSetNameSchema,
  rows: z.array(SqlRowSchema).max(5_000),
}).strict();

export const ArtifactReferenceAtomicObservationSchema = z.object({
  planDigest: Sha256Schema,
  snapshotCapturedAt: z.string().datetime({ offset: true }),
  statementCount: z.number().int().positive().max(40),
  batchSucceeded: z.literal(true),
  transactionApi: z.literal("D1Database.batch"),
  winningFenceRows: z.array(SqlRowSchema).max(5),
  sourceSets: z.array(ArtifactReferenceSourceSetObservationSchema).length(SOURCE_SET_ORDER.length),
}).strict();

export const ArtifactReferenceSourceSetProofSchema = z.object({
  setOrdinal: z.number().int().min(1).max(SOURCE_SET_ORDER.length),
  setName: ArtifactReferenceSourceSetNameSchema,
  predicateVersion: z.literal(ARTIFACT_REFERENCE_ATOMIC_QUERY_CONTRACT_VERSION),
  rowCount: z.number().int().nonnegative().max(5_000),
  rowIdentities: z.array(z.string().trim().min(1)).max(5_000),
  setDigest: Sha256Schema,
  proofDigest: Sha256Schema,
}).strict();

export const ArtifactReferenceUntrustedSourceProofSchema = z.object({
  proofVersion: z.literal("artifact-reference-untrusted-source-proof-v1"),
  planDigest: Sha256Schema,
  queryContractDigest: Sha256Schema,
  snapshotCapturedAt: z.string().datetime({ offset: true }),
  sourceSetProofs: z.array(ArtifactReferenceSourceSetProofSchema).length(SOURCE_SET_ORDER.length),
  sourceSetProofsDigest: Sha256Schema,
  sourceBaseRowsDigest: Sha256Schema,
  structurallyComplete: z.literal(true),
  transactionallyTrusted: z.literal(false),
  snapshotComplete: z.literal(false),
  trustBlocker: z.literal("TRUSTED_D1_COMMIT_AND_RELOAD_EXECUTOR_NOT_IMPLEMENTED"),
  retentionConclusionAuthorized: z.literal(false),
  projectionPersistenceAuthorized: z.literal(false),
  releaseAuthorized: z.literal(false),
  deletionAuthorized: z.literal(false),
  providerOperationsAuthorized: z.literal(0),
  costAuthorizedUsd: z.literal(0),
}).strict();

export type ArtifactReferenceUntrustedSourceProof = z.infer<typeof ArtifactReferenceUntrustedSourceProofSchema>;

function rowIdentity(row: z.infer<typeof SqlRowSchema>, setName: ArtifactReferenceSourceSetName) {
  const id = row.id;
  if (typeof id !== "string" || !id.trim()) throw new Error(`${setName} source row is missing its stable id.`);
  return id;
}

export function buildUntrustedArtifactReferenceSourceProof(
  planValue: unknown,
  observationValue: unknown,
): ArtifactReferenceUntrustedSourceProof {
  const plan = ArtifactReferenceAtomicPlanSchema.parse(planValue);
  const observation = ArtifactReferenceAtomicObservationSchema.parse(observationValue);
  const prepareStatementCount = plan.statements.filter((statement) => statement.batchGroup === "PREPARE_SNAPSHOT").length;
  if (observation.planDigest !== plan.planDigest || observation.statementCount !== prepareStatementCount) {
    throw new Error("Atomic observation does not bind the exact transaction plan and statement count.");
  }
  if (
    Date.parse(observation.snapshotCapturedAt) < Date.parse(plan.attempt.acquiredAt)
    || Date.parse(observation.snapshotCapturedAt) >= Date.parse(plan.attempt.expiresAt)
  ) {
    throw new Error("Atomic observation must be captured inside the winning half-open fence window.");
  }
  if (observation.winningFenceRows.length !== 1) throw new Error("Atomic observation requires one exact winning fence row.");
  const winner = observation.winningFenceRows[0];
  if (
    winner.id !== plan.attempt.id
    || winner.attemptDigest !== plan.attempt.attemptDigest
    || winner.fencingToken !== plan.attempt.fencingToken
    || winner.attemptNumber !== plan.attempt.attemptNumber
  ) {
    throw new Error("Atomic observation fence row does not exactly match the planned attempt.");
  }
  const sourceSets = new Map<ArtifactReferenceSourceSetName, z.infer<typeof ArtifactReferenceSourceSetObservationSchema>>();
  for (const result of observation.sourceSets) {
    if (sourceSets.has(result.setName)) throw new Error(`Source set ${result.setName} appears more than once.`);
    sourceSets.set(result.setName, result);
  }
  const sourceSetProofs = SOURCE_SET_ORDER.map((setName, index) => {
    const result = sourceSets.get(setName);
    if (!result) throw new Error(`Source set ${setName} is missing from the atomic observation.`);
    const rows = [...result.rows].sort((left, right) => rowIdentity(left, setName).localeCompare(rowIdentity(right, setName), "en-CA"));
    const rowIdentities = rows.map((row) => rowIdentity(row, setName));
    if (new Set(rowIdentities).size !== rowIdentities.length) throw new Error(`Source set ${setName} contains a duplicate primary identity.`);
    const proofCore = {
      setOrdinal: index + 1,
      setName,
      predicateVersion: ARTIFACT_REFERENCE_ATOMIC_QUERY_CONTRACT_VERSION,
      rowCount: rows.length,
      rowIdentities,
      setDigest: artifactReferenceDigest(rows),
    } as const;
    return ArtifactReferenceSourceSetProofSchema.parse({ ...proofCore, proofDigest: artifactReferenceDigest(proofCore) });
  });
  const core = {
    proofVersion: "artifact-reference-untrusted-source-proof-v1",
    planDigest: plan.planDigest,
    queryContractDigest: plan.queryContractDigest,
    snapshotCapturedAt: observation.snapshotCapturedAt,
    sourceSetProofs,
    sourceSetProofsDigest: artifactReferenceDigest(sourceSetProofs),
    sourceBaseRowsDigest: artifactReferenceDigest({
      planDigest: plan.planDigest,
      queryContractDigest: plan.queryContractDigest,
      snapshotCapturedAt: observation.snapshotCapturedAt,
      sourceSetProofs,
    }),
    structurallyComplete: true,
    transactionallyTrusted: false,
    snapshotComplete: false,
    trustBlocker: "TRUSTED_D1_COMMIT_AND_RELOAD_EXECUTOR_NOT_IMPLEMENTED",
    retentionConclusionAuthorized: false,
    projectionPersistenceAuthorized: false,
    releaseAuthorized: false,
    deletionAuthorized: false,
    providerOperationsAuthorized: 0,
    costAuthorizedUsd: 0,
  } as const;
  return ArtifactReferenceUntrustedSourceProofSchema.parse(core);
}

const CompletenessReceiptCoreSchema = z.object({
  receiptVersion: z.literal(ARTIFACT_REFERENCE_COMPLETENESS_RECEIPT_VERSION),
  receiptId: z.string().uuid(),
  snapshotAttemptId: z.string().uuid(),
  workflowRunId: z.string().uuid(),
  businessId: z.string().trim().min(1).max(128),
  lineageRootManifestId: z.string().uuid(),
  attemptNumber: z.number().int().min(1).max(10_000),
  fencingToken: z.number().int().min(1).max(2_147_483_647),
  queryContractVersion: z.literal(ARTIFACT_REFERENCE_ATOMIC_QUERY_CONTRACT_VERSION),
  queryContractDigest: Sha256Schema,
  snapshotCapturedAt: z.string().datetime({ offset: true }),
  freshUntil: z.string().datetime({ offset: true }),
  sourceSetProofs: z.array(ArtifactReferenceSourceSetProofSchema).length(SOURCE_SET_ORDER.length),
  sourceSetProofsDigest: Sha256Schema,
  sourceFactsDigest: Sha256Schema,
  completenessAssurance: z.literal("D1_ATOMIC_RECHECK_AND_RELOAD"),
  availabilityAssurance: z.literal("R2_HEAD_PER_MANIFEST"),
  snapshotComplete: z.literal(true),
  committedAndReloaded: z.literal(true),
  retentionConclusionAuthorized: z.literal(false),
  projectionPersistenceAuthorized: z.literal(false),
  providerOperationsAuthorized: z.literal(0),
  releaseAuthorized: z.literal(false),
  deletionAuthorized: z.literal(false),
  costAuthorizedUsd: z.literal(0),
  recordedAt: z.string().datetime({ offset: true }),
}).strict();

export const ArtifactReferenceCompletenessReceiptSchema = CompletenessReceiptCoreSchema.extend({
  receiptDigest: Sha256Schema,
}).strict().superRefine((receipt, context) => {
  const { receiptDigest: _receiptDigest, ...receiptCore } = receipt;
  void _receiptDigest;
  const core = CompletenessReceiptCoreSchema.parse(receiptCore);
  if (receipt.receiptDigest !== artifactReferenceDigest(core)) {
    context.addIssue({ code: "custom", message: "Completeness receipt digest must bind the exact transaction-sealed receipt.", path: ["receiptDigest"] });
  }
  if (receipt.sourceSetProofsDigest !== artifactReferenceDigest(receipt.sourceSetProofs)) {
    context.addIssue({ code: "custom", message: "Completeness receipt must bind every exact source-set proof.", path: ["sourceSetProofsDigest"] });
  }
  if (receipt.sourceSetProofs.some((proof, index) => proof.setName !== SOURCE_SET_ORDER[index] || proof.setOrdinal !== index + 1)) {
    context.addIssue({ code: "custom", message: "Completeness source-set proofs must be complete and ordered.", path: ["sourceSetProofs"] });
  }
  if (
    Date.parse(receipt.freshUntil) < Date.parse(receipt.snapshotCapturedAt)
    || Date.parse(receipt.freshUntil) - Date.parse(receipt.snapshotCapturedAt) > ARTIFACT_REFERENCE_MAX_FRESHNESS_MS
    || Date.parse(receipt.recordedAt) < Date.parse(receipt.snapshotCapturedAt)
  ) {
    context.addIssue({ code: "custom", message: "Completeness receipt timestamps exceed the bounded snapshot window.", path: ["freshUntil"] });
  }
});

export function inspectArtifactReferenceCompletenessReceipt(value: unknown) {
  const receipt = ArtifactReferenceCompletenessReceiptSchema.parse(value);
  return {
    receipt,
    structurallyValid: true as const,
    trusted: false as const,
    snapshotComplete: false as const,
    reason: "TRUSTED_D1_COMMIT_AND_RELOAD_EXECUTOR_NOT_IMPLEMENTED" as const,
    retentionConclusionAuthorized: false as const,
    projectionPersistenceAuthorized: false as const,
    releaseAuthorized: false as const,
    deletionAuthorized: false as const,
    providerOperationsAuthorized: 0 as const,
    costAuthorizedUsd: 0 as const,
  };
}
