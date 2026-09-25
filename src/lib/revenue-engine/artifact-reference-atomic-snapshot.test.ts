import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import Database from "better-sqlite3";

import {
  ARTIFACT_REFERENCE_ATOMIC_QUERY_CONTRACT_VERSION,
  ARTIFACT_REFERENCE_COMPLETENESS_RECEIPT_VERSION,
  ArtifactReferenceAtomicPlanSchema,
  ArtifactReferenceCompletenessReceiptSchema,
  buildArtifactReferenceAtomicPlan,
  buildUntrustedArtifactReferenceSourceProof,
  inspectArtifactReferenceCompletenessReceipt,
} from "@/lib/revenue-engine/artifact-reference-atomic-snapshot";
import { artifactReferenceCanonicalJson, artifactReferenceDigest } from "@/lib/revenue-engine/artifact-reference-projection";

const ATTEMPT_ID = "11111111-1111-4111-8111-111111111111";
const WORKFLOW_ID = "22222222-2222-4222-8222-222222222222";
const MANIFEST_ID = "33333333-3333-4333-8333-333333333333";
const RECEIPT_ID = "44444444-4444-4444-8444-444444444444";
const BUSINESS_ID = "business:atomic-reference";
const REQUESTED_AT = "2026-08-24T12:00:00.000Z";
const ACQUIRED_AT = "2026-08-24T12:00:01.000Z";
const SNAPSHOT_AT = "2026-08-24T12:00:02.000Z";
const EXPIRES_AT = "2026-08-24T12:04:01.000Z";
const SHA256 = "a".repeat(64);

function request() {
  return {
    attemptId: ATTEMPT_ID,
    workflowRunId: WORKFLOW_ID,
    businessId: BUSINESS_ID,
    lineageRootManifestId: MANIFEST_ID,
    attemptNumber: 1,
    fencingToken: 1,
    ownerId: "worker:fixture",
    requestedAt: REQUESTED_AT,
    acquiredAt: ACQUIRED_AT,
    expiresAt: EXPIRES_AT,
    mode: "SHADOW",
    maxCostUsd: 0,
  } as const;
}

function observation(plan = buildArtifactReferenceAtomicPlan(request())) {
  const sourceSets = plan.sourceSetOrder.map((setName) => ({
    setName,
    rows: ["WORKFLOW_RUNS", "WORKFLOW_DEFINITIONS", "WORKFLOW_DELIVERIES", "WORKFLOW_ATTEMPTS", "WORKFLOW_LEASES", "WORKFLOW_RECEIPT_REVISIONS", "WORKFLOW_ATTEMPT_CLOSURES", "MANIFESTS", "MANIFEST_ITEMS", "AVAILABILITY"].includes(setName)
      ? [{ id: `${setName.toLowerCase()}:1`, marker: setName }]
      : [],
  }));
  return {
    planDigest: plan.planDigest,
    snapshotCapturedAt: SNAPSHOT_AT,
    statementCount: plan.statements.filter((statement) => statement.batchGroup === "PREPARE_SNAPSHOT").length,
    batchSucceeded: true,
    transactionApi: "D1Database.batch",
    winningFenceRows: [{
      id: plan.attempt.id,
      attemptDigest: plan.attempt.attemptDigest,
      attemptNumber: plan.attempt.attemptNumber,
      fencingToken: plan.attempt.fencingToken,
    }],
    sourceSets,
  } as const;
}

test("builds a deterministic, complete, fail-closed D1 transaction contract", () => {
  const first = buildArtifactReferenceAtomicPlan(request());
  const second = buildArtifactReferenceAtomicPlan(request());
  assert.deepEqual(first, second);
  assert.equal(first.sourceSetOrder.length, 15);
  assert.equal(first.statements.filter((statement) => statement.kind === "SOURCE_READ").length, 15);
  assert.equal(first.statements.length, 20);
  assert.equal(first.statements.filter((statement) => statement.batchGroup === "PREPARE_SNAPSHOT").length, 19);
  assert.equal(first.statements.filter((statement) => statement.batchGroup === "COMMIT_POSTVERIFY").length, 1);
  assert.equal(first.atomicity.api, "D1Database.batch");
  assert.equal(first.atomicity.prepareAndReadInOneBatch, true);
  assert.equal(first.atomicity.commitRechecksAllSourceSets, true);
  assert.equal(first.allSourceWritersGuarded, true);
  assert.equal(first.completenessReceiptCreationAuthorized, false);
  assert.equal(first.executionAuthorized, false);
  assert.equal(first.mutationAuthorized, false);
  assert.equal(first.retentionConclusionAuthorized, false);
  assert.equal(first.releaseAuthorized, false);
  assert.equal(first.deletionAuthorized, false);
  assert.equal(first.providerOperationsAuthorized, 0);
  assert.equal(first.costAuthorizedUsd, 0);
  assert.ok(first.statements.every((statement) => !/\blimit\s+1\b/i.test(statement.sql)));
  assert.match(first.statements.find((statement) => statement.statementId === "claim-attempt-fence")!.sql, /MAX\("fencingToken"\)/);
  assert.match(first.statements.find((statement) => statement.statementId === "claim-attempt-fence")!.sql, /julianday\(a\."expiresAt"\) > julianday\('now'\)/);
  assert.match(first.statements.find((statement) => statement.statementId === "verify-winning-attempt-fence")!.sql, /higher\."fencingToken" > a\."fencingToken"/);
  assert.match(first.statements.find((statement) => statement.resultSet === "EVIDENCE_USES")!.sql, /WITH RECURSIVE/);
  assert.match(first.statements.find((statement) => statement.resultSet === "PROMOTIONS")!.sql, /"sourceManifestId"/);
  assert.match(first.statements.find((statement) => statement.resultSet === "MANIFEST_USES")!.sql, /"viaPromotionId"/);
});

test("rejects drift from the immutable source-query contract even after redigesting", () => {
  const plan = buildArtifactReferenceAtomicPlan(request());
  const statements = plan.statements.map((statement) => statement.resultSet === "MANIFESTS"
    ? { ...statement, sql: statement.sql.replace(` WHERE "workflowRunId" = ?`, "") }
    : statement);
  const { planDigest: _planDigest, ...planCore } = plan;
  void _planDigest;
  const forgedCore = { ...planCore, statements };
  const forged = { ...forgedCore, planDigest: artifactReferenceDigest(forgedCore) };
  assert.throws(() => ArtifactReferenceAtomicPlanSchema.parse(forged), /query contract/i);
});

test("rejects invalid, overlong, and exact-zero fence windows", () => {
  assert.throws(() => buildArtifactReferenceAtomicPlan({ ...request(), acquiredAt: REQUESTED_AT, expiresAt: REQUESTED_AT }), /positive lease/i);
  assert.throws(() => buildArtifactReferenceAtomicPlan({ ...request(), expiresAt: "2026-08-24T12:05:02.000Z" }), /five minutes/i);
  assert.throws(() => buildArtifactReferenceAtomicPlan({ ...request(), acquiredAt: "2026-08-24T11:59:59.000Z" }), /before it is requested/i);
});

test("creates only an explicitly untrusted proof from caller-supplied batch rows", () => {
  const plan = buildArtifactReferenceAtomicPlan(request());
  const first = buildUntrustedArtifactReferenceSourceProof(plan, observation(plan));
  const reordered = observation(plan);
  reordered.sourceSets.reverse();
  const second = buildUntrustedArtifactReferenceSourceProof(plan, reordered);
  assert.deepEqual(first, second);
  assert.equal(first.sourceSetProofs.length, 15);
  assert.equal(first.structurallyComplete, true);
  assert.equal(first.transactionallyTrusted, false);
  assert.equal(first.snapshotComplete, false);
  assert.equal(first.trustBlocker, "TRUSTED_D1_COMMIT_AND_RELOAD_EXECUTOR_NOT_IMPLEMENTED");
  assert.equal(first.retentionConclusionAuthorized, false);
  assert.equal(first.projectionPersistenceAuthorized, false);
  assert.equal(first.releaseAuthorized, false);
  assert.equal(first.deletionAuthorized, false);
});

test("blocks omitted sets, duplicate base identities, stale fences, and wrong winners", () => {
  const plan = buildArtifactReferenceAtomicPlan(request());
  const missing = observation(plan);
  missing.sourceSets.pop();
  assert.throws(() => buildUntrustedArtifactReferenceSourceProof(plan, missing), /15|length|source set/i);

  const duplicate = observation(plan);
  duplicate.sourceSets[0]!.rows.push({ ...duplicate.sourceSets[0]!.rows[0]! });
  assert.throws(() => buildUntrustedArtifactReferenceSourceProof(plan, duplicate), /duplicate primary identity/i);

  const stale = { ...observation(plan), snapshotCapturedAt: EXPIRES_AT };
  assert.throws(() => buildUntrustedArtifactReferenceSourceProof(plan, stale), /half-open fence window/i);

  const original = observation(plan);
  const wrongWinner = {
    ...original,
    winningFenceRows: [{ ...original.winningFenceRows[0]!, fencingToken: 2 }],
  };
  assert.throws(() => buildUntrustedArtifactReferenceSourceProof(plan, wrongWinner), /does not exactly match/i);
});

test("structural receipt parsing never upgrades untrusted JSON into trusted completeness", () => {
  const plan = buildArtifactReferenceAtomicPlan(request());
  const sourceProof = buildUntrustedArtifactReferenceSourceProof(plan, observation(plan));
  const core = {
    receiptVersion: ARTIFACT_REFERENCE_COMPLETENESS_RECEIPT_VERSION,
    receiptId: RECEIPT_ID,
    snapshotAttemptId: ATTEMPT_ID,
    workflowRunId: WORKFLOW_ID,
    businessId: BUSINESS_ID,
    lineageRootManifestId: MANIFEST_ID,
    attemptNumber: 1,
    fencingToken: 1,
    queryContractVersion: ARTIFACT_REFERENCE_ATOMIC_QUERY_CONTRACT_VERSION,
    queryContractDigest: plan.queryContractDigest,
    snapshotCapturedAt: SNAPSHOT_AT,
    freshUntil: EXPIRES_AT,
    sourceSetProofs: sourceProof.sourceSetProofs,
    sourceSetProofsDigest: sourceProof.sourceSetProofsDigest,
    sourceFactsDigest: SHA256,
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
    recordedAt: "2026-08-24T12:03:00.000Z",
  } as const;
  const receipt = ArtifactReferenceCompletenessReceiptSchema.parse({ ...core, receiptDigest: artifactReferenceDigest(core) });
  const assessment = inspectArtifactReferenceCompletenessReceipt(receipt);
  assert.equal(assessment.structurallyValid, true);
  assert.equal(assessment.trusted, false);
  assert.equal(assessment.snapshotComplete, false);
  assert.equal(assessment.reason, "TRUSTED_D1_COMMIT_AND_RELOAD_EXECUTOR_NOT_IMPLEMENTED");
  assert.equal(assessment.retentionConclusionAuthorized, false);

  assert.throws(() => ArtifactReferenceCompletenessReceiptSchema.parse({ ...receipt, receiptDigest: "b".repeat(64) }), /digest/i);
  assert.throws(() => inspectArtifactReferenceCompletenessReceipt({
    snapshotComplete: true,
    completenessAssurance: "FIXTURE_ASSERTED",
  }), /receiptVersion|unrecognized|invalid/i);
});

function freshDatabase() {
  const database = new Database(":memory:");
  database.pragma("foreign_keys = ON");
  for (const migration of [
    "0054_revenue_shadow_kernel.sql",
    "0056_durable_evidence_receipts.sql",
    "0057_fenced_evidence_resume_records.sql",
    "0058_artifact_reference_projections.sql",
    "0059_atomic_artifact_reference_snapshots.sql",
  ]) {
    database.exec(readFileSync(new URL(`../../../migrations/${migration}`, import.meta.url), "utf8"));
  }
  database.prepare(`INSERT INTO "RevenueBusiness" ("id", "canonicalName", "normalizedDomain", "independenceStatus", "status") VALUES (?, ?, ?, 'UNKNOWN', 'RESEARCH_ONLY')`)
    .run(BUSINESS_ID, "Atomic Reference Fixture", "atomic-reference.example");
  database.prepare(`INSERT INTO "RevenueWorkflowRun" ("id", "workflowKind", "workflowVersion", "idempotencyKey", "businessId", "mode", "orchestratorKind", "requestDigest", "requestJson", "maxCostUsd", "requestedAt") VALUES (?, 'WEBSITE_EVIDENCE', 'fixture-v1', 'atomic-reference', ?, 'SHADOW', 'FIXTURE', ?, '{}', 0, ?)`)
    .run(WORKFLOW_ID, BUSINESS_ID, SHA256, REQUESTED_AT);
  database.prepare(`INSERT INTO "RevenueArtifactManifest" ("id", "workflowRunId", "manifestVersion", "retentionClass", "provenanceReceiptType", "provenanceReceiptId", "verifiedAt", "manifestDigest", "manifestJson") VALUES (?, ?, 'artifact-manifest-v1', 'SHADOW_30D', 'ARTIFACT_WRITE', ?, ?, ?, '{}')`)
    .run(MANIFEST_ID, WORKFLOW_ID, MANIFEST_ID, REQUESTED_AT, SHA256);
  database.prepare(`INSERT INTO "RevenueArtifactManifestItem" ("id", "manifestId", "kind", "artifactRef", "objectKey", "byteLength", "sha256", "etag", "uploadedAt") VALUES (?, ?, 'BROWSER_MEASUREMENT', ?, ?, 128, ?, 'etag', ?)`)
    .run(`${MANIFEST_ID}:item`, MANIFEST_ID, `artifact:sha256:${SHA256}`, `shadow/${SHA256}`, SHA256, REQUESTED_AT);
  return database;
}

function insertAttempt(database: Database.Database, plan = buildArtifactReferenceAtomicPlan(request())) {
  const attempt = plan.attempt;
  database.prepare(`INSERT INTO "RevenueArtifactReferenceSnapshotAttempt" (
    "id", "attemptVersion", "workflowRunId", "businessId", "lineageRootManifestId", "attemptNumber", "fencingToken", "ownerId",
    "queryContractVersion", "queryContractDigest", "requestDigest", "requestedAt", "acquiredAt", "expiresAt", "mode", "executorKind",
    "attemptDigest", "attemptJson", "providerOperationsAuthorized", "releaseAuthorized", "deletionAuthorized", "costAuthorizedUsd"
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0)`)
    .run(
      attempt.id,
      attempt.attemptVersion,
      attempt.workflowRunId,
      attempt.businessId,
      attempt.lineageRootManifestId,
      attempt.attemptNumber,
      attempt.fencingToken,
      attempt.ownerId,
      attempt.queryContractVersion,
      attempt.queryContractDigest,
      attempt.requestDigest,
      attempt.requestedAt,
      attempt.acquiredAt,
      attempt.expiresAt,
      attempt.mode,
      attempt.executorKind,
      attempt.attemptDigest,
      artifactReferenceCanonicalJson(attempt),
    );
  return plan;
}

function runPrepareSnapshotBatch(database: Database.Database, plan: ReturnType<typeof buildArtifactReferenceAtomicPlan>) {
  return database.transaction(() => plan.statements
    .filter((statement) => statement.batchGroup === "PREPARE_SNAPSHOT")
    .map((statement) => {
      try {
        return statement.kind === "FENCE_CLAIM"
          ? database.prepare(statement.sql).run(...statement.bindings)
          : database.prepare(statement.sql).all(...statement.bindings);
      } catch (error) {
        throw new Error(`Generated statement ${statement.statementId} failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }))();
}

test("the generated SQL uses database time to block active work and permit a stale higher-fence takeover", () => {
  const database = freshDatabase();
  const now = Date.now();
  const first = buildArtifactReferenceAtomicPlan({
    ...request(),
    requestedAt: new Date(now - 3_000).toISOString(),
    acquiredAt: new Date(now - 2_000).toISOString(),
    expiresAt: new Date(now + 240_000).toISOString(),
  });
  const firstResults = runPrepareSnapshotBatch(database, first);
  assert.equal((firstResults[2] as Database.RunResult).changes, 1);
  assert.equal((database.prepare(`SELECT COUNT(*) AS count FROM "RevenueArtifactReferenceSnapshotAttempt"`).get() as { count: number }).count, 1);

  const activeContender = buildArtifactReferenceAtomicPlan({
    ...request(),
    attemptId: "55555555-5555-4555-8555-555555555555",
    attemptNumber: 2,
    fencingToken: 2,
    requestedAt: new Date(now - 1_000).toISOString(),
    acquiredAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 240_000).toISOString(),
  });
  const activeResults = runPrepareSnapshotBatch(database, activeContender);
  assert.equal((activeResults[2] as Database.RunResult).changes, 0);

  database.close();

  const staleDatabase = freshDatabase();
  const stale = buildArtifactReferenceAtomicPlan({
    ...request(),
    requestedAt: new Date(now - 242_000).toISOString(),
    acquiredAt: new Date(now - 241_000).toISOString(),
    expiresAt: new Date(now - 1_000).toISOString(),
  });
  insertAttempt(staleDatabase, stale);
  const staleTakeover = buildArtifactReferenceAtomicPlan({
    ...request(),
    attemptId: "66666666-6666-4666-8666-666666666666",
    attemptNumber: 2,
    fencingToken: 2,
    requestedAt: new Date(now - 3_000).toISOString(),
    acquiredAt: new Date(now - 2_000).toISOString(),
    expiresAt: new Date(now + 240_000).toISOString(),
  });
  const takeoverResults = runPrepareSnapshotBatch(staleDatabase, staleTakeover);
  assert.equal((takeoverResults[2] as Database.RunResult).changes, 1);
  assert.equal((staleDatabase.prepare(`SELECT COUNT(*) AS count FROM "RevenueArtifactReferenceSnapshotAttempt"`).get() as { count: number }).count, 2);
  staleDatabase.close();
});

test("migration 0059 enforces fenced identities, bounded receipts, and zero authority", () => {
  const database = freshDatabase();
  const plan = insertAttempt(database);
  assert.throws(() => insertAttempt(database, buildArtifactReferenceAtomicPlan({
    ...request(),
    attemptId: "55555555-5555-4555-8555-555555555555",
    attemptNumber: 1,
    fencingToken: 2,
  })), /UNIQUE constraint failed/);

  assert.throws(() => database.prepare(`INSERT INTO "RevenueArtifactManifestAvailabilityReceipt" (
    "id", "availabilityVersion", "manifestId", "state", "checkedAt", "validThrough", "expiresAt", "checkerKind", "objectSetDigest", "receiptDigest", "receiptJson",
    "providerReadPerformed", "providerOperationsAuthorized", "releaseAuthorized", "deletionAuthorized", "costUsd"
  ) VALUES (?, 'artifact-manifest-availability-v2', ?, 'VERIFIED_PRESENT', ?, ?, ?, 'FIXTURE', ?, ?, '{}', 1, 0, 0, 0, 0)`)
    .run(RECEIPT_ID, MANIFEST_ID, SNAPSHOT_AT, EXPIRES_AT, EXPIRES_AT, SHA256, "b".repeat(64)), /CHECK constraint failed/);

  database.prepare(`INSERT INTO "RevenueArtifactManifestAvailabilityReceipt" (
    "id", "availabilityVersion", "manifestId", "state", "checkedAt", "validThrough", "expiresAt", "checkerKind", "objectSetDigest", "receiptDigest", "receiptJson",
    "providerReadPerformed", "providerOperationsAuthorized", "releaseAuthorized", "deletionAuthorized", "costUsd"
  ) VALUES (?, 'artifact-manifest-availability-v2', ?, 'VERIFIED_PRESENT', ?, ?, ?, 'FIXTURE', ?, ?, '{}', 0, 0, 0, 0, 0)`)
    .run(RECEIPT_ID, MANIFEST_ID, SNAPSHOT_AT, EXPIRES_AT, EXPIRES_AT, SHA256, "b".repeat(64));

  const insertCompleteness = database.prepare(`INSERT INTO "RevenueArtifactReferenceCompletenessReceipt" (
    "id", "receiptVersion", "snapshotAttemptId", "workflowRunId", "businessId", "lineageRootManifestId", "attemptNumber", "fencingToken",
    "queryContractVersion", "queryContractDigest", "snapshotCapturedAt", "freshUntil", "workflowRunCount", "workflowHistoryCount", "manifestCount", "manifestItemCount",
    "promotionCount", "promotionUseCount", "manifestUseCount", "evidenceUseCount", "useEndCount", "availabilityCount", "sourceSetProofsDigest", "sourceSetProofsJson",
    "sourceFactsDigest", "receiptDigest", "receiptJson", "completenessAssurance", "availabilityAssurance", "snapshotComplete", "committedAndReloaded", "retentionConclusionAuthorized",
    "projectionPersistenceAuthorized", "providerOperationsAuthorized", "releaseAuthorized", "deletionAuthorized", "costAuthorizedUsd", "recordedAt"
  ) VALUES (?, ?, ?, ?, ?, ?, 1, 1, ?, ?, ?, ?, 1, 6, 1, 1, 0, 0, 0, 0, 0, 1, ?, '[]', ?, ?, '{}', 'D1_ATOMIC_RECHECK_AND_RELOAD', 'R2_HEAD_PER_MANIFEST', ?, 1, 0, 0, 0, 0, 0, 0, ?)`);
  assert.throws(() => insertCompleteness.run(
    "66666666-6666-4666-8666-666666666666",
    ARTIFACT_REFERENCE_COMPLETENESS_RECEIPT_VERSION,
    ATTEMPT_ID,
    WORKFLOW_ID,
    BUSINESS_ID,
    MANIFEST_ID,
    ARTIFACT_REFERENCE_ATOMIC_QUERY_CONTRACT_VERSION,
    plan.queryContractDigest,
    SNAPSHOT_AT,
    EXPIRES_AT,
    SHA256,
    SHA256,
    SHA256,
    0,
    EXPIRES_AT,
  ), /CHECK constraint failed/);
  database.close();
});
