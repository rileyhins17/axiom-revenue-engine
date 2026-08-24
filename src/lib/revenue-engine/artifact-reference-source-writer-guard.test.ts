import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import Database from "better-sqlite3";

import {
  ARTIFACT_REFERENCE_GUARDED_SOURCE_TABLES,
  ARTIFACT_REFERENCE_IMMUTABLE_CONTROL_TABLES,
  ARTIFACT_REFERENCE_IMMUTABLE_ERROR,
  ARTIFACT_REFERENCE_SOURCE_FREEZE_ERROR,
  artifactReferenceSourceWriterGuardContract,
} from "@/lib/revenue-engine/artifact-reference-source-writer-guard";

const SHA = "a".repeat(64);
const OTHER_SHA = "b".repeat(64);
const BUSINESS_ID = "business:writer-guard";
const WORKFLOW_ID = "11111111-1111-4111-8111-111111111111";
const DEFINITION_ID = SHA;
const DELIVERY_ID = "delivery:writer-guard:1";
const ATTEMPT_ID = "22222222-2222-4222-8222-222222222222";
const LEASE_ID = "33333333-3333-4333-8333-333333333333";
const REVISION_ID = `workflow-receipt:${SHA}`;
const CLOSURE_ID = "44444444-4444-4444-8444-444444444444";
const MANIFEST_ID = "55555555-5555-4555-8555-555555555555";
const PROMOTION_ID = "66666666-6666-4666-8666-666666666666";
const USE_ID = "77777777-7777-4777-8777-777777777777";
const REPLACEMENT_USE_ID = "88888888-8888-4888-8888-888888888888";
const USE_END_ID = "99999999-9999-4999-8999-999999999999";
const AVAILABILITY_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SNAPSHOT_ATTEMPT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const COMPLETENESS_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const RECORDED_AT = "2026-08-24T12:00:00.000Z";

function freshDatabase() {
  const database = new Database(":memory:");
  database.pragma("foreign_keys = ON");
  for (const migration of [
    "0054_revenue_shadow_kernel.sql",
    "0056_durable_evidence_receipts.sql",
    "0057_fenced_evidence_resume_records.sql",
    "0058_artifact_reference_projections.sql",
    "0059_atomic_artifact_reference_snapshots.sql",
    "0060_artifact_reference_source_writer_guards.sql",
  ]) {
    database.exec(readFileSync(new URL(`../../../migrations/${migration}`, import.meta.url), "utf8"));
  }
  return database;
}

function seedSourceRows(database: Database.Database) {
  database.prepare(`INSERT INTO "RevenueBusiness" ("id", "canonicalName", "normalizedDomain", "independenceStatus", "status") VALUES (?, 'Writer Guard Roofing', 'writer-guard.example', 'INDEPENDENT', 'RESEARCH_ONLY')`).run(BUSINESS_ID);
  database.prepare(`INSERT INTO "RevenueWorkflowRun" ("id", "workflowKind", "workflowVersion", "idempotencyKey", "businessId", "mode", "orchestratorKind", "requestDigest", "requestJson", "maxCostUsd", "requestedAt") VALUES (?, 'WEBSITE_EVIDENCE', 'fixture-v1', 'writer-guard:audit', ?, 'SHADOW', 'FIXTURE', ?, '{}', 0, ?)`)
    .run(WORKFLOW_ID, BUSINESS_ID, SHA, RECORDED_AT);
  database.prepare(`INSERT INTO "RevenueWorkflowDefinition" ("id", "workflowKind", "definitionVersion", "definitionDigest", "definitionJson") VALUES (?, 'WEBSITE_EVIDENCE', 'fixture-v1', ?, '{}')`)
    .run(DEFINITION_ID, DEFINITION_ID);
  database.prepare(`INSERT INTO "RevenueWorkflowDelivery" ("id", "workflowRunId", "definitionId", "deliveryVersion", "workflowVersion", "requestDigest", "payloadDigest", "deliveryDigest", "deliveryJson", "receivedAt", "mode", "deliveryKind") VALUES (?, ?, ?, 'fixture-delivery-v1', 'fixture-v1', ?, ?, ?, '{}', ?, 'SHADOW', 'FIXTURE')`)
    .run(DELIVERY_ID, WORKFLOW_ID, DEFINITION_ID, SHA, SHA, SHA, RECORDED_AT);
  database.prepare(`INSERT INTO "RevenueWorkflowAttempt" ("id", "workflowRunId", "definitionId", "deliveryId", "attemptVersion", "workflowVersion", "requestDigest", "attemptNumber", "fencingToken", "startedAt", "attemptDigest", "attemptJson") VALUES (?, ?, ?, ?, 'fixture-website-evidence-attempt-v1', 'fixture-v1', ?, 1, 1, ?, ?, '{}')`)
    .run(ATTEMPT_ID, WORKFLOW_ID, DEFINITION_ID, DELIVERY_ID, SHA, RECORDED_AT, SHA);
  database.prepare(`INSERT INTO "RevenueWorkflowLease" ("id", "workflowRunId", "definitionId", "attemptId", "deliveryId", "leaseVersion", "workflowVersion", "requestDigest", "attemptNumber", "ownerId", "fencingToken", "acquiredAt", "expiresAt", "mode", "leaseKind", "leaseDigest", "leaseJson") VALUES (?, ?, ?, ?, ?, 'fixture-website-evidence-lease-v1', 'fixture-v1', ?, 1, 'fixture-owner', 1, ?, ?, 'SHADOW', 'FIXTURE', ?, '{}')`)
    .run(LEASE_ID, WORKFLOW_ID, DEFINITION_ID, ATTEMPT_ID, DELIVERY_ID, SHA, RECORDED_AT, "2026-08-24T12:04:00.000Z", SHA);
  database.prepare(`INSERT INTO "RevenueWorkflowReceiptRevision" ("id", "workflowRunId", "definitionId", "attemptId", "revisionVersion", "workflowVersion", "requestDigest", "attemptNumber", "status", "receiptDigest", "receiptJson", "recordedAt") VALUES (?, ?, ?, ?, 'fixture-workflow-receipt-revision-v1', 'fixture-v1', ?, 1, 'COMPLETED', ?, '{}', ?)`)
    .run(REVISION_ID, WORKFLOW_ID, DEFINITION_ID, ATTEMPT_ID, SHA, SHA, RECORDED_AT);
  database.prepare(`INSERT INTO "RevenueWorkflowAttemptClosure" ("id", "workflowRunId", "attemptId", "status", "endedAt", "terminalReceiptId", "closureDigest", "closureJson", "effectiveAt") VALUES (?, ?, ?, 'SEALED', ?, ?, ?, '{}', ?)`)
    .run(CLOSURE_ID, WORKFLOW_ID, ATTEMPT_ID, RECORDED_AT, REVISION_ID, SHA, RECORDED_AT);
  database.prepare(`INSERT INTO "RevenueArtifactManifest" ("id", "workflowRunId", "manifestVersion", "retentionClass", "provenanceReceiptType", "provenanceReceiptId", "verifiedAt", "manifestDigest", "manifestJson") VALUES (?, ?, 'artifact-manifest-v1', 'SHADOW_30D', 'ARTIFACT_WRITE', ?, ?, ?, '{}')`)
    .run(MANIFEST_ID, WORKFLOW_ID, MANIFEST_ID, RECORDED_AT, SHA);
  database.prepare(`INSERT INTO "RevenueArtifactManifestItem" ("id", "manifestId", "kind", "artifactRef", "objectKey", "byteLength", "sha256", "etag", "uploadedAt") VALUES (?, ?, 'BROWSER_MEASUREMENT', ?, 'shadow/writer-guard/measurement.json', 128, ?, 'etag-measurement', ?)`)
    .run(`${MANIFEST_ID}:BROWSER_MEASUREMENT`, MANIFEST_ID, `artifact:sha256:${SHA}`, SHA, RECORDED_AT);
  database.prepare(`INSERT INTO "RevenueArtifactEvidenceUse" ("id", "businessId", "useType", "recordId", "recordVersion", "recordedAt") VALUES (?, ?, 'QUALIFICATION_SNAPSHOT', 'qualification:writer-guard', 'qualification-v1', ?), (?, ?, 'QUALIFICATION_SNAPSHOT', 'qualification:replacement', 'qualification-v1', ?)`)
    .run(USE_ID, BUSINESS_ID, RECORDED_AT, REPLACEMENT_USE_ID, BUSINESS_ID, RECORDED_AT);
  database.prepare(`INSERT INTO "RevenueArtifactPromotionReceipt" ("id", "workflowRunId", "businessId", "sourceManifestId", "resultManifestId", "contractVersion", "sourceRetentionClass", "targetRetentionClass", "action", "outcome", "planDigest", "receiptDigest", "planJson", "receiptJson", "providerCopyPerformed", "costUsd", "completedAt") VALUES (?, ?, ?, ?, ?, 'artifact-promotion-v1', 'SHADOW_30D', 'SHADOW_30D', 'NO_COPY_REQUIRED', 'COMPLETED', ?, ?, '{}', '{}', 0, 0, ?)`)
    .run(PROMOTION_ID, WORKFLOW_ID, BUSINESS_ID, MANIFEST_ID, MANIFEST_ID, SHA, OTHER_SHA, RECORDED_AT);
  database.prepare(`INSERT INTO "RevenueArtifactPromotionUse" ("id", "promotionId", "evidenceUseId") VALUES (?, ?, ?)`)
    .run(`${PROMOTION_ID}:${USE_ID}`, PROMOTION_ID, USE_ID);
  database.prepare(`INSERT INTO "RevenueArtifactManifestEvidenceUse" ("id", "manifestId", "evidenceUseId", "viaPromotionId", "linkedAt") VALUES (?, ?, ?, ?, ?)`)
    .run(`${MANIFEST_ID}:${USE_ID}`, MANIFEST_ID, USE_ID, PROMOTION_ID, RECORDED_AT);
  database.prepare(`INSERT INTO "RevenueArtifactEvidenceUseEnd" ("id", "endVersion", "evidenceUseId", "businessId", "useType", "useDigest", "endedAt", "recordedAt", "reasonCode", "basisType", "basisRecordId", "basisRecordVersion", "basisDigest", "replacementEvidenceUseId", "replacementEvidenceUseVersion", "replacementEvidenceUseDigest", "actorUserId", "actorRole", "mode", "recorderKind", "endDigest", "endJson", "requiresRetentionReview", "releaseAuthorized", "deletionAuthorized", "providerDeleteAuthorized", "providerDeletePerformed", "costUsd") VALUES (?, 'artifact-evidence-use-end-v1', ?, ?, 'QUALIFICATION_SNAPSHOT', ?, ?, ?, 'REPLACED_BY_EVIDENCE_USE', 'EVIDENCE_USE_REPLACEMENT', ?, 'qualification-v1', ?, ?, 'qualification-v1', ?, 'owner:fixture', 'OWNER', 'SHADOW', 'FIXTURE', ?, '{}', 1, 0, 0, 0, 0, 0)`)
    .run(USE_END_ID, USE_ID, BUSINESS_ID, SHA, RECORDED_AT, RECORDED_AT, REPLACEMENT_USE_ID, OTHER_SHA, REPLACEMENT_USE_ID, OTHER_SHA, SHA);
  database.prepare(`INSERT INTO "RevenueArtifactManifestAvailabilityReceipt" ("id", "availabilityVersion", "manifestId", "state", "checkedAt", "validThrough", "expiresAt", "checkerKind", "objectSetDigest", "receiptDigest", "receiptJson", "providerReadPerformed", "providerOperationsAuthorized", "releaseAuthorized", "deletionAuthorized", "costUsd") VALUES (?, 'artifact-manifest-availability-v2', ?, 'VERIFIED_PRESENT', ?, ?, ?, 'FIXTURE', ?, ?, '{}', 0, 0, 0, 0, 0)`)
    .run(AVAILABILITY_ID, MANIFEST_ID, RECORDED_AT, "2026-08-24T12:05:00.000Z", "2026-09-23T12:00:00.000Z", SHA, OTHER_SHA);
}

function claimActiveSnapshot(database: Database.Database) {
  const acquiredAt = new Date(Date.now() - 1_000).toISOString();
  const expiresAt = new Date(Date.now() + 240_000).toISOString();
  database.prepare(`INSERT INTO "RevenueArtifactReferenceSnapshotAttempt" ("id", "attemptVersion", "workflowRunId", "businessId", "lineageRootManifestId", "attemptNumber", "fencingToken", "ownerId", "queryContractVersion", "queryContractDigest", "requestDigest", "requestedAt", "acquiredAt", "expiresAt", "mode", "executorKind", "attemptDigest", "attemptJson", "providerOperationsAuthorized", "releaseAuthorized", "deletionAuthorized", "costAuthorizedUsd") VALUES (?, 'artifact-reference-snapshot-attempt-v1', ?, ?, ?, 1, 1, 'writer-guard-test', 'artifact-reference-atomic-query-v2', ?, ?, ?, ?, ?, 'SHADOW', 'D1_ATOMIC_BATCH', ?, '{}', 0, 0, 0, 0)`)
    .run(SNAPSHOT_ATTEMPT_ID, WORKFLOW_ID, BUSINESS_ID, MANIFEST_ID, SHA, OTHER_SHA, acquiredAt, acquiredAt, expiresAt, SHA);
  return { acquiredAt, expiresAt };
}

function sealSnapshot(database: Database.Database, acquiredAt: string, expiresAt: string) {
  const recordedAt = new Date().toISOString();
  database.prepare(`INSERT INTO "RevenueArtifactReferenceCompletenessReceipt" (
    "id", "receiptVersion", "snapshotAttemptId", "workflowRunId", "businessId", "lineageRootManifestId", "attemptNumber", "fencingToken",
    "queryContractVersion", "queryContractDigest", "snapshotCapturedAt", "freshUntil", "workflowRunCount", "workflowHistoryCount", "manifestCount",
    "manifestItemCount", "promotionCount", "promotionUseCount", "manifestUseCount", "evidenceUseCount", "useEndCount", "availabilityCount",
    "sourceSetProofsDigest", "sourceSetProofsJson", "sourceFactsDigest", "receiptDigest", "receiptJson", "completenessAssurance", "availabilityAssurance",
    "snapshotComplete", "committedAndReloaded", "retentionConclusionAuthorized", "projectionPersistenceAuthorized", "providerOperationsAuthorized",
    "releaseAuthorized", "deletionAuthorized", "costAuthorizedUsd", "recordedAt"
  ) VALUES (?, 'artifact-reference-completeness-receipt-v1', ?, ?, ?, ?, 1, 1, 'artifact-reference-atomic-query-v2', ?, ?, ?, 1, 6, 1, 1, 1, 1, 1, 2, 1, 1, ?, '[]', ?, ?, '{}', 'D1_ATOMIC_RECHECK_AND_RELOAD', 'R2_HEAD_PER_MANIFEST', 1, 1, 0, 0, 0, 0, 0, 0, ?)`)
    .run(COMPLETENESS_ID, SNAPSHOT_ATTEMPT_ID, WORKFLOW_ID, BUSINESS_ID, MANIFEST_ID, SHA, acquiredAt, expiresAt, SHA, OTHER_SHA, SHA, recordedAt);
  database.prepare(`INSERT INTO "RevenueArtifactReferenceSourceSetProof" ("id", "completenessReceiptId", "setOrdinal", "setName", "predicateVersion", "rowCount", "setDigest", "proofDigest", "proofJson") VALUES ('proof:workflow-runs', ?, 1, 'WORKFLOW_RUNS', 'artifact-reference-atomic-query-v2', 1, ?, ?, '{}')`)
    .run(COMPLETENESS_ID, SHA, OTHER_SHA);
}

test("guard contract covers every atomic source set and every expected database trigger", () => {
  const contract = artifactReferenceSourceWriterGuardContract();
  assert.equal(contract.sourceTables.length, 15);
  assert.equal(contract.allSourceWritersGuarded, true);
  assert.equal(contract.trustedExecutorImplemented, true);
  assert.equal(contract.completenessReceiptCreationAuthorized, false);
  assert.equal(contract.providerOperationsAuthorized, 0);

  const database = freshDatabase();
  const triggers = new Map((database.prepare(`SELECT "name", "sql" FROM sqlite_master WHERE "type" = 'trigger' ORDER BY "name"`).all() as Array<{ name: string; sql: string }>)
    .map((row) => [row.name, row.sql]));
  for (const source of ARTIFACT_REFERENCE_GUARDED_SOURCE_TABLES) {
    assert.match(triggers.get(source.insertTriggerName) || "", new RegExp(ARTIFACT_REFERENCE_SOURCE_FREEZE_ERROR));
    assert.match(triggers.get(source.updateTriggerName) || "", new RegExp(ARTIFACT_REFERENCE_IMMUTABLE_ERROR));
    assert.match(triggers.get(source.deleteTriggerName) || "", new RegExp(ARTIFACT_REFERENCE_IMMUTABLE_ERROR));
  }
  for (const control of ARTIFACT_REFERENCE_IMMUTABLE_CONTROL_TABLES) {
    assert.match(triggers.get(control.updateTriggerName) || "", new RegExp(ARTIFACT_REFERENCE_IMMUTABLE_ERROR));
    assert.match(triggers.get(control.deleteTriggerName) || "", new RegExp(ARTIFACT_REFERENCE_IMMUTABLE_ERROR));
  }
  assert.equal(triggers.size, 51);
  database.close();
});

test("source and transaction records are append-only even when no snapshot is active", () => {
  const database = freshDatabase();
  seedSourceRows(database);
  const ids = new Map<string, string>([
    ["RevenueWorkflowRun", WORKFLOW_ID], ["RevenueWorkflowDefinition", DEFINITION_ID], ["RevenueWorkflowDelivery", DELIVERY_ID],
    ["RevenueWorkflowAttempt", ATTEMPT_ID], ["RevenueWorkflowLease", LEASE_ID], ["RevenueWorkflowReceiptRevision", REVISION_ID],
    ["RevenueWorkflowAttemptClosure", CLOSURE_ID], ["RevenueArtifactManifest", MANIFEST_ID],
    ["RevenueArtifactManifestItem", `${MANIFEST_ID}:BROWSER_MEASUREMENT`], ["RevenueArtifactPromotionReceipt", PROMOTION_ID],
    ["RevenueArtifactPromotionUse", `${PROMOTION_ID}:${USE_ID}`], ["RevenueArtifactManifestEvidenceUse", `${MANIFEST_ID}:${USE_ID}`],
    ["RevenueArtifactEvidenceUse", USE_ID], ["RevenueArtifactEvidenceUseEnd", USE_END_ID],
    ["RevenueArtifactManifestAvailabilityReceipt", AVAILABILITY_ID],
  ]);
  for (const source of ARTIFACT_REFERENCE_GUARDED_SOURCE_TABLES) {
    const id = ids.get(source.tableName)!;
    assert.throws(() => database.prepare(`UPDATE "${source.tableName}" SET "createdAt" = "createdAt" WHERE "id" = ?`).run(id), new RegExp(ARTIFACT_REFERENCE_IMMUTABLE_ERROR));
    assert.throws(() => database.prepare(`DELETE FROM "${source.tableName}" WHERE "id" = ?`).run(id), new RegExp(ARTIFACT_REFERENCE_IMMUTABLE_ERROR));
  }
  database.close();
});

test("an active workflow snapshot freezes direct, indirect, recursive, and availability inserts", () => {
  const database = freshDatabase();
  seedSourceRows(database);
  const window = claimActiveSnapshot(database);

  assert.throws(() => database.prepare(`INSERT INTO "RevenueWorkflowDelivery" ("id", "workflowRunId", "definitionId", "deliveryVersion", "workflowVersion", "requestDigest", "payloadDigest", "deliveryDigest", "deliveryJson", "receivedAt", "mode", "deliveryKind") VALUES ('delivery:blocked', ?, ?, 'fixture-delivery-v1', 'fixture-v1', ?, ?, ?, '{}', ?, 'SHADOW', 'FIXTURE')`).run(WORKFLOW_ID, DEFINITION_ID, SHA, SHA, SHA, RECORDED_AT), new RegExp(ARTIFACT_REFERENCE_SOURCE_FREEZE_ERROR));
  assert.throws(() => database.prepare(`INSERT INTO "RevenueArtifactManifestItem" ("id", "manifestId", "kind", "artifactRef", "objectKey", "byteLength", "sha256", "etag", "uploadedAt") VALUES ('item:blocked', ?, 'BROWSER_SCREENSHOT', ?, 'shadow/blocked.png', 128, ?, 'etag-blocked', ?)` ).run(MANIFEST_ID, `artifact:sha256:${SHA}`, SHA, RECORDED_AT), new RegExp(ARTIFACT_REFERENCE_SOURCE_FREEZE_ERROR));
  assert.throws(() => database.prepare(`INSERT INTO "RevenueArtifactPromotionReceipt" ("id", "workflowRunId", "businessId", "sourceManifestId", "resultManifestId", "contractVersion", "sourceRetentionClass", "targetRetentionClass", "action", "outcome", "planDigest", "receiptDigest", "planJson", "receiptJson", "providerCopyPerformed", "costUsd", "completedAt") VALUES ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', ?, ?, ?, ?, 'artifact-promotion-v1', 'SHADOW_30D', 'SHADOW_30D', 'NO_COPY_REQUIRED', 'COMPLETED', ?, ?, '{}', '{}', 0, 0, ?)` ).run(WORKFLOW_ID, BUSINESS_ID, MANIFEST_ID, MANIFEST_ID, SHA, OTHER_SHA, RECORDED_AT), new RegExp(ARTIFACT_REFERENCE_SOURCE_FREEZE_ERROR));
  assert.throws(() => database.prepare(`INSERT INTO "RevenueArtifactEvidenceUseEnd" ("id", "endVersion", "evidenceUseId", "businessId", "useType", "useDigest", "endedAt", "recordedAt", "reasonCode", "basisType", "basisRecordId", "basisRecordVersion", "basisDigest", "actorUserId", "actorRole", "mode", "recorderKind", "endDigest", "endJson", "requiresRetentionReview", "releaseAuthorized", "deletionAuthorized", "providerDeleteAuthorized", "providerDeletePerformed", "costUsd") VALUES ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'artifact-evidence-use-end-v1', ?, ?, 'QUALIFICATION_SNAPSHOT', ?, ?, ?, 'RECORD_RETENTION_COMPLETE', 'OWNER_RETENTION_REVIEW', 'review:blocked', 'review-v1', ?, 'owner:fixture', 'OWNER', 'SHADOW', 'FIXTURE', ?, '{}', 1, 0, 0, 0, 0, 0)` ).run(REPLACEMENT_USE_ID, BUSINESS_ID, SHA, RECORDED_AT, RECORDED_AT, SHA, OTHER_SHA), new RegExp(ARTIFACT_REFERENCE_SOURCE_FREEZE_ERROR));
  assert.throws(() => database.prepare(`INSERT INTO "RevenueArtifactManifestAvailabilityReceipt" ("id", "availabilityVersion", "manifestId", "state", "checkedAt", "validThrough", "expiresAt", "checkerKind", "objectSetDigest", "receiptDigest", "receiptJson", "providerReadPerformed", "providerOperationsAuthorized", "releaseAuthorized", "deletionAuthorized", "costUsd") VALUES ('ffffffff-ffff-4fff-8fff-ffffffffffff', 'artifact-manifest-availability-v2', ?, 'VERIFIED_PRESENT', ?, ?, ?, 'FIXTURE', ?, ?, '{}', 0, 0, 0, 0, 0)` ).run(MANIFEST_ID, RECORDED_AT, "2026-08-24T12:06:00.000Z", "2026-09-23T12:00:00.000Z", SHA, OTHER_SHA), new RegExp(ARTIFACT_REFERENCE_SOURCE_FREEZE_ERROR));

  database.prepare(`INSERT INTO "RevenueArtifactEvidenceUse" ("id", "businessId", "useType", "recordId", "recordVersion", "recordedAt") VALUES ('12121212-1212-4212-8212-121212121212', ?, 'QUALIFICATION_SNAPSHOT', 'unrelated-use', 'qualification-v1', ?)`)
    .run(BUSINESS_ID, RECORDED_AT);

  sealSnapshot(database, window.acquiredAt, window.expiresAt);
  database.prepare(`INSERT INTO "RevenueWorkflowDelivery" ("id", "workflowRunId", "definitionId", "deliveryVersion", "workflowVersion", "requestDigest", "payloadDigest", "deliveryDigest", "deliveryJson", "receivedAt", "mode", "deliveryKind") VALUES ('delivery:after-seal', ?, ?, 'fixture-delivery-v1', 'fixture-v1', ?, ?, ?, '{}', ?, 'SHADOW', 'FIXTURE')`)
    .run(WORKFLOW_ID, DEFINITION_ID, SHA, SHA, OTHER_SHA, RECORDED_AT);

  assert.throws(() => database.prepare(`UPDATE "RevenueArtifactReferenceSnapshotAttempt" SET "ownerId" = "ownerId" WHERE "id" = ?`).run(SNAPSHOT_ATTEMPT_ID), new RegExp(ARTIFACT_REFERENCE_IMMUTABLE_ERROR));
  assert.throws(() => database.prepare(`DELETE FROM "RevenueArtifactReferenceCompletenessReceipt" WHERE "id" = ?`).run(COMPLETENESS_ID), new RegExp(ARTIFACT_REFERENCE_IMMUTABLE_ERROR));
  assert.throws(() => database.prepare(`UPDATE "RevenueArtifactReferenceSourceSetProof" SET "rowCount" = "rowCount" WHERE "id" = 'proof:workflow-runs'`).run(), new RegExp(ARTIFACT_REFERENCE_IMMUTABLE_ERROR));
  database.close();
});
