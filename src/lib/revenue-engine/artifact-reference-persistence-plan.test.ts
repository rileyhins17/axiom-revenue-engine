import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import Database from "better-sqlite3";

import {
  ARTIFACT_LIFECYCLE_CONTRACT_VERSION,
  ARTIFACT_MANIFEST_VERSION,
  ArtifactManifestSchema,
  ArtifactPromotionReceiptSchema,
  artifactManifestDigest,
  createArtifactPromotionPlan,
  type ArtifactEvidenceUse,
} from "@/lib/revenue-engine/artifact-lifecycle";
import {
  ARTIFACT_EVIDENCE_USE_END_VERSION,
  ARTIFACT_REFERENCE_PROJECTION_VERSION,
  artifactReferenceCanonicalJson,
  artifactReferenceDigest,
  createArtifactEvidenceUseEndRecord,
  createArtifactReferenceProjection,
  createFixtureArtifactManifestAvailability,
  createFixtureArtifactReferenceSnapshotReceipt,
  type ArtifactReferenceSourceFacts,
} from "@/lib/revenue-engine/artifact-reference-projection";
import {
  ARTIFACT_REFERENCE_PERSISTENCE_PLAN_VERSION,
  ARTIFACT_REFERENCE_TARGET_SCHEMA_VERSION,
  buildArtifactReferencePersistencePlan,
  verifyArtifactReferencePersistencePreflight,
} from "@/lib/revenue-engine/artifact-reference-persistence-plan";
import { artifactObjectKey } from "@/lib/revenue-engine/content-addressed-artifact-store";

const BUSINESS_ID = "business:reference-persistence";
const WORKFLOW_ID = "11111111-1111-4111-8111-111111111111";
const MANIFEST_ID = "22222222-2222-4222-8222-222222222222";
const PROMOTION_ID = "33333333-3333-4333-8333-333333333333";
const ACTIVE_USE_ID = "44444444-4444-4444-8444-444444444444";
const ENDED_USE_ID = "55555555-5555-4555-8555-555555555555";
const END_ID = "66666666-6666-4666-8666-666666666666";
const PROJECTION_ID = "77777777-7777-4777-8777-777777777777";
const SNAPSHOT_AT = "2026-08-24T11:59:00.000Z";
const PROJECTED_AT = "2026-08-24T12:00:00.000Z";
const FRESH_UNTIL = "2026-08-24T12:04:00.000Z";
const SHA256 = "c".repeat(64);

const activeUse: ArtifactEvidenceUse = {
  useId: ACTIVE_USE_ID,
  useType: "QUALIFICATION_SNAPSHOT",
  recordId: "qualification:active",
  recordVersion: "v1",
  businessId: BUSINESS_ID,
  recordedAt: "2026-08-24T10:00:00.000Z",
};

const endedUse: ArtifactEvidenceUse = {
  ...activeUse,
  useId: ENDED_USE_ID,
  recordId: "qualification:ended",
};

function fixture() {
  const manifest = ArtifactManifestSchema.parse({
    manifestVersion: ARTIFACT_MANIFEST_VERSION,
    manifestId: MANIFEST_ID,
    workflowId: WORKFLOW_ID,
    retentionClass: "SHADOW_30D",
    verifiedAt: "2026-08-24T09:00:00.000Z",
    provenance: { receiptType: "ARTIFACT_WRITE", receiptId: MANIFEST_ID },
    items: [{
      kind: "BROWSER_MEASUREMENT",
      artifactRef: `artifact:sha256:${SHA256}`,
      objectKey: artifactObjectKey("SHADOW_30D", "BROWSER_MEASUREMENT", SHA256),
      byteLength: 128,
      sha256: SHA256,
      etag: "etag-reference-persistence",
      uploadedAt: "2026-08-24T08:59:00.000Z",
    }],
  });
  const promotionPlan = createArtifactPromotionPlan({
    contractVersion: ARTIFACT_LIFECYCLE_CONTRACT_VERSION,
    promotionId: PROMOTION_ID,
    workflowId: WORKFLOW_ID,
    requestedAt: "2026-08-24T10:10:00.000Z",
    mode: "SHADOW",
    executorKind: "FIXTURE",
    providerCopyAuthorized: false,
    maxCostUsd: 0,
    businessId: BUSINESS_ID,
    sourceManifest: manifest,
    evidenceUses: [activeUse, endedUse],
  });
  assert.equal(promotionPlan.action, "COPY_REQUIRED");
  const promotionItems = promotionPlan.items.map((item) => ({
    kind: item.kind,
    artifactRef: item.artifactRef,
    objectKey: item.targetObjectKey,
    byteLength: item.byteLength,
    sha256: item.sha256,
    operation: "CREATED" as const,
    etag: "etag-reference-persistence-promoted",
    uploadedAt: "2026-08-24T10:10:00.000Z",
  }));
  const promotedManifest = ArtifactManifestSchema.parse({
    manifestVersion: ARTIFACT_MANIFEST_VERSION,
    manifestId: PROMOTION_ID,
    workflowId: WORKFLOW_ID,
    retentionClass: "QUALIFICATION_180D",
    verifiedAt: "2026-08-24T10:10:00.000Z",
    provenance: { receiptType: "ARTIFACT_PROMOTION", receiptId: PROMOTION_ID },
    items: promotionItems.map((item) => ({
      kind: item.kind,
      artifactRef: item.artifactRef,
      objectKey: item.objectKey,
      byteLength: item.byteLength,
      sha256: item.sha256,
      etag: item.etag,
      uploadedAt: item.uploadedAt,
    })),
  });
  const promotionReceipt = ArtifactPromotionReceiptSchema.parse({
    contractVersion: ARTIFACT_LIFECYCLE_CONTRACT_VERSION,
    promotionId: PROMOTION_ID,
    workflowId: WORKFLOW_ID,
    mode: "SHADOW",
    executorKind: "FIXTURE",
    providerCopyPerformed: false,
    sourceRetentionClass: "SHADOW_30D",
    targetRetentionClass: "QUALIFICATION_180D",
    action: "COPY_REQUIRED",
    plannedItemCount: promotionPlan.items.length,
    startedAt: "2026-08-24T10:10:00.000Z",
    completedAt: "2026-08-24T10:10:00.000Z",
    fixtureHeadReads: promotionPlan.items.length,
    fixtureCopyAttempts: promotionPlan.items.length,
    providerClassAOperations: 0,
    providerClassBOperations: 0,
    costUsd: 0,
    rollbackAction: "NONE_KEEP_CONTENT_ADDRESSED_ORPHANS",
    outcome: "COMPLETED",
    items: promotionItems,
    resultManifest: promotedManifest,
    failure: null,
  });
  const endRecord = createArtifactEvidenceUseEndRecord({
    endVersion: ARTIFACT_EVIDENCE_USE_END_VERSION,
    endId: END_ID,
    endedUse,
    endedAt: "2026-08-24T11:00:00.000Z",
    recordedAt: "2026-08-24T11:01:00.000Z",
    reasonCode: "RECORD_RETENTION_COMPLETE",
    basis: {
      basisType: "OWNER_RETENTION_REVIEW",
      basisRecordId: "retention-review:fixture",
      basisRecordVersion: "v1",
      basisDigest: "d".repeat(64),
    },
    replacementUse: null,
    actor: { actorUserId: "owner:fixture", role: "OWNER" },
    mode: "SHADOW",
    recorderKind: "FIXTURE",
    maxCostUsd: 0,
  });
  const facts: ArtifactReferenceSourceFacts = {
    workflowRun: { workflowRunId: WORKFLOW_ID, businessId: BUSINESS_ID, workflowKind: "WEBSITE_EVIDENCE", workflowVersion: "fixture-v1", requestDigest: "f".repeat(64) },
    manifests: [manifest, promotedManifest],
    promotions: [{ plan: promotionPlan, receipt: promotionReceipt }],
    evidenceUses: [activeUse, endedUse],
    manifestEvidenceUses: [activeUse, endedUse].map((evidenceUse) => ({
      linkId: `${PROMOTION_ID}:${evidenceUse.useId}`,
      manifestId: PROMOTION_ID,
      evidenceUse,
      viaPromotionId: PROMOTION_ID,
      linkedAt: promotionReceipt.completedAt,
    })),
    evidenceUseEnds: [endRecord],
    availability: [manifest, promotedManifest].map((item) => createFixtureArtifactManifestAvailability({
      manifestId: item.manifestId,
      availabilityVersion: "artifact-manifest-availability-v1",
      state: "VERIFIED_PRESENT",
      checkedAt: SNAPSHOT_AT,
      validThrough: FRESH_UNTIL,
      expiresAt: item.retentionClass === "SHADOW_30D" ? "2026-09-23T09:00:00.000Z" : null,
      checkerKind: "FIXTURE",
    })),
  };
  const snapshot = createFixtureArtifactReferenceSnapshotReceipt({ snapshotCapturedAt: SNAPSHOT_AT, freshUntil: FRESH_UNTIL, sourceFacts: facts });
  const projection = createArtifactReferenceProjection({
    projectionVersion: ARTIFACT_REFERENCE_PROJECTION_VERSION,
    projectionId: PROJECTION_ID,
    businessId: BUSINESS_ID,
    lineageRootManifestId: MANIFEST_ID,
    projectedAt: PROJECTED_AT,
    mode: "SHADOW",
    projectorKind: "FIXTURE",
    maxCostUsd: 0,
    sourceFacts: facts,
    snapshot,
  });
  return { manifests: [manifest, promotedManifest], promotionPlan, promotionReceipt, endRecord, projection };
}

function request() {
  const value = fixture();
  return {
    fixture: value,
    persistence: {
      persistencePlanVersion: ARTIFACT_REFERENCE_PERSISTENCE_PLAN_VERSION,
      targetSchemaVersion: ARTIFACT_REFERENCE_TARGET_SCHEMA_VERSION,
      plannedAt: "2026-08-24T12:01:00.000Z",
      mode: "SHADOW",
      plannerKind: "FIXTURE",
      maxCostUsd: 0,
      evidenceUseEnds: [{ record: value.endRecord, evidenceUse: endedUse, replacementUse: null }],
      projections: [value.projection],
    } as const,
  };
}

function freshDatabase(withBaseRows = true) {
  const database = new Database(":memory:");
  database.pragma("foreign_keys = ON");
  for (const migration of ["0054_revenue_shadow_kernel.sql", "0056_durable_evidence_receipts.sql", "0058_artifact_reference_projections.sql"]) {
    database.exec(readFileSync(new URL(`../../../migrations/${migration}`, import.meta.url), "utf8"));
  }
  if (!withBaseRows) return database;
  const { fixture: value } = request();
  database.prepare(`INSERT INTO "RevenueBusiness" ("id", "canonicalName", "normalizedDomain", "independenceStatus", "status") VALUES (?, ?, ?, 'UNKNOWN', 'RESEARCH_ONLY')`)
    .run(BUSINESS_ID, "Reference Persistence Fixture", "reference-persistence.example");
  database.prepare(`INSERT INTO "RevenueWorkflowRun" ("id", "workflowKind", "workflowVersion", "idempotencyKey", "businessId", "mode", "orchestratorKind", "requestDigest", "requestJson", "maxCostUsd", "requestedAt") VALUES (?, 'WEBSITE_EVIDENCE', 'fixture-v1', 'reference-persistence', ?, 'SHADOW', 'FIXTURE', ?, '{}', 0, ?)`)
    .run(WORKFLOW_ID, BUSINESS_ID, "f".repeat(64), "2026-08-24T08:00:00.000Z");
  for (const manifest of value.manifests) {
    database.prepare(`INSERT INTO "RevenueArtifactManifest" ("id", "workflowRunId", "manifestVersion", "retentionClass", "provenanceReceiptType", "provenanceReceiptId", "verifiedAt", "manifestDigest", "manifestJson") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(manifest.manifestId, WORKFLOW_ID, manifest.manifestVersion, manifest.retentionClass, manifest.provenance.receiptType, manifest.provenance.receiptId, manifest.verifiedAt, artifactManifestDigest(manifest), artifactReferenceCanonicalJson(manifest));
  }
  for (const evidenceUse of [activeUse, endedUse]) {
    database.prepare(`INSERT INTO "RevenueArtifactEvidenceUse" ("id", "businessId", "useType", "recordId", "recordVersion", "recordedAt") VALUES (?, ?, ?, ?, ?, ?)`)
      .run(evidenceUse.useId, evidenceUse.businessId, evidenceUse.useType, evidenceUse.recordId, evidenceUse.recordVersion, evidenceUse.recordedAt);
  }
  database.prepare(`INSERT INTO "RevenueArtifactPromotionReceipt" ("id", "workflowRunId", "businessId", "sourceManifestId", "resultManifestId", "contractVersion", "sourceRetentionClass", "targetRetentionClass", "action", "outcome", "planDigest", "receiptDigest", "planJson", "receiptJson", "providerCopyPerformed", "costUsd", "completedAt") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?)`)
    .run(PROMOTION_ID, WORKFLOW_ID, BUSINESS_ID, MANIFEST_ID, PROMOTION_ID, value.promotionReceipt.contractVersion, value.promotionReceipt.sourceRetentionClass, value.promotionReceipt.targetRetentionClass, value.promotionReceipt.action, value.promotionReceipt.outcome, artifactReferenceDigest(value.promotionPlan), artifactReferenceDigest(value.promotionReceipt), artifactReferenceCanonicalJson(value.promotionPlan), artifactReferenceCanonicalJson(value.promotionReceipt), value.promotionReceipt.completedAt);
  for (const evidenceUse of [activeUse, endedUse]) {
    database.prepare(`INSERT INTO "RevenueArtifactPromotionUse" ("id", "promotionId", "evidenceUseId") VALUES (?, ?, ?)`)
      .run(`${PROMOTION_ID}:${evidenceUse.useId}`, PROMOTION_ID, evidenceUse.useId);
    database.prepare(`INSERT INTO "RevenueArtifactManifestEvidenceUse" ("id", "manifestId", "evidenceUseId", "viaPromotionId", "linkedAt") VALUES (?, ?, ?, ?, ?)`)
      .run(`${PROMOTION_ID}:${evidenceUse.useId}`, PROMOTION_ID, evidenceUse.useId, PROMOTION_ID, value.promotionReceipt.completedAt);
  }
  return database;
}

function insertPlan(database: Database.Database, plan: ReturnType<typeof buildArtifactReferencePersistencePlan>) {
  for (const preflight of plan.preflights) {
    const rows = database.prepare(preflight.selectSql).all(...preflight.bindings) as Record<string, unknown>[];
    assert.deepEqual(verifyArtifactReferencePersistencePreflight(preflight, rows), { state: "MISSING", matches: true, matchCount: 0 });
  }
  for (const mutation of plan.mutations) database.prepare(mutation.sql).run(...mutation.bindings);
}

function count(database: Database.Database, table: string) {
  return (database.prepare(`SELECT COUNT(*) AS count FROM "${table}"`).get() as { count: number }).count;
}

test("builds a deterministic collision-complete reference plan with no authority", () => {
  const value = request();
  const first = buildArtifactReferencePersistencePlan(value.persistence);
  const second = buildArtifactReferencePersistencePlan(value.persistence);
  assert.deepEqual(first, second);
  assert.equal(first.summary.evidenceUseEnds, 1);
  assert.equal(first.summary.projections, 1);
  assert.equal(first.summary.projectionUses, 2);
  assert.equal(first.summary.assignments, 1);
  assert.ok(first.preflights.every((item) => item.rejectMultipleMatches && !/\bLIMIT\s+1\b/i.test(item.selectSql)));
  assert.ok(first.mutations.every((item) => item.operation === "INSERT_IF_ABSENT" && !/\b(?:UPDATE|DELETE)\b/i.test(item.sql)));
  assert.equal(first.mutationAuthorized, false);
  assert.equal(first.retentionReleaseAuthorized, false);
  assert.equal(first.deletionAuthorized, false);
  assert.equal(first.providerDeleteAuthorized, false);
  assert.equal(first.costAuthorizedUsd, 0);
});

test("migration 0058 accepts exact history and a repeat remains idempotent", () => {
  const plan = buildArtifactReferencePersistencePlan(request().persistence);
  const database = freshDatabase();
  try {
    insertPlan(database, plan);
    assert.equal(count(database, "RevenueArtifactEvidenceUseEnd"), 1);
    assert.equal(count(database, "RevenueArtifactReferenceProjection"), 1);
    assert.equal(count(database, "RevenueArtifactReferenceProjectionUse"), 2);
    assert.equal(count(database, "RevenueArtifactReferenceProjectionAssignment"), 1);
    assert.deepEqual(database.prepare(`SELECT "releaseAuthorized", "deletionAuthorized", "providerDeleteAuthorized", "providerDeletePerformed", "costAuthorizedUsd" FROM "RevenueArtifactReferenceProjection"`).get(), {
      releaseAuthorized: 0,
      deletionAuthorized: 0,
      providerDeleteAuthorized: 0,
      providerDeletePerformed: 0,
      costAuthorizedUsd: 0,
    });
    for (const preflight of plan.preflights) {
      const rows = database.prepare(preflight.selectSql).all(...preflight.bindings) as Record<string, unknown>[];
      assert.deepEqual(verifyArtifactReferencePersistencePreflight(preflight, rows), { state: "EXACT_MATCH", matches: true, matchCount: 1 });
    }
    for (const mutation of plan.mutations) database.prepare(mutation.sql).run(...mutation.bindings);
    assert.equal(count(database, "RevenueArtifactReferenceProjection"), 1);
  } finally {
    database.close();
  }
});

test("drift, alternate identity collisions, and multiple matches are rejected", () => {
  const plan = buildArtifactReferencePersistencePlan(request().persistence);
  const database = freshDatabase();
  try {
    insertPlan(database, plan);
    database.prepare(`UPDATE "RevenueArtifactReferenceProjection" SET "state" = 'INDETERMINATE', "unassignedUseCount" = 1`).run();
    const preflight = plan.preflights.find((item) => item.entity === "REFERENCE_PROJECTION");
    assert.ok(preflight);
    const drift = database.prepare(preflight.selectSql).all(...preflight.bindings) as Record<string, unknown>[];
    assert.deepEqual(verifyArtifactReferencePersistencePreflight(preflight, drift), { state: "CONFLICT", matches: false, matchCount: 1 });
    assert.deepEqual(verifyArtifactReferencePersistencePreflight(preflight, [preflight.expected, { ...preflight.expected, id: "other" }]), {
      state: "CONFLICT",
      matches: false,
      matchCount: 2,
    });
  } finally {
    database.close();
  }

  const alternate = freshDatabase();
  try {
    const endMutation = plan.mutations.find((item) => item.entity === "EVIDENCE_USE_END");
    const endPreflight = plan.preflights.find((item) => item.entity === "EVIDENCE_USE_END");
    assert.ok(endMutation && endPreflight);
    alternate.prepare(endMutation.sql).run("88888888-8888-4888-8888-888888888888", ...endMutation.bindings.slice(1));
    const rows = alternate.prepare(endPreflight.selectSql).all(...endPreflight.bindings) as Record<string, unknown>[];
    assert.deepEqual(verifyArtifactReferencePersistencePreflight(endPreflight, rows), { state: "CONFLICT", matches: false, matchCount: 1 });
  } finally {
    alternate.close();
  }
});

test("projection endings require exact bundles and foreign keys reject missing base history", () => {
  const value = request();
  assert.throws(() => buildArtifactReferencePersistencePlan({ ...value.persistence, evidenceUseEnds: [] }), /exact evidence-use ending persistence bundle/i);
  const plan = buildArtifactReferencePersistencePlan(value.persistence);
  const database = freshDatabase(false);
  try {
    assert.throws(() => database.prepare(plan.mutations[0]!.sql).run(...plan.mutations[0]!.bindings), /FOREIGN KEY constraint failed/);
  } finally {
    database.close();
  }
});

test("replacement persistence rejects wrong identity, business, time, and version", () => {
  const replacementUse: ArtifactEvidenceUse = {
    ...activeUse,
    useId: "88888888-8888-4888-8888-888888888888",
    recordId: "qualification:replacement",
    recordedAt: "2026-08-24T10:30:00.000Z",
  };
  const record = createArtifactEvidenceUseEndRecord({
    endVersion: ARTIFACT_EVIDENCE_USE_END_VERSION,
    endId: "99999999-9999-4999-8999-999999999999",
    endedUse,
    endedAt: "2026-08-24T11:00:00.000Z",
    recordedAt: "2026-08-24T11:01:00.000Z",
    reasonCode: "REPLACED_BY_EVIDENCE_USE",
    basis: {
      basisType: "EVIDENCE_USE_REPLACEMENT",
      basisRecordId: replacementUse.useId,
      basisRecordVersion: replacementUse.recordVersion,
      basisDigest: artifactReferenceDigest(replacementUse),
    },
    replacementUse,
    actor: { actorUserId: "owner:fixture", role: "OWNER" },
    mode: "SHADOW",
    recorderKind: "FIXTURE",
    maxCostUsd: 0,
  });
  const base = request().persistence;
  const planRequest = (candidate: ArtifactEvidenceUse | null) => ({
    ...base,
    evidenceUseEnds: [{ record, evidenceUse: endedUse, replacementUse: candidate }],
    projections: [],
  });
  assert.doesNotThrow(() => buildArtifactReferencePersistencePlan(planRequest(replacementUse)));
  assert.throws(() => buildArtifactReferencePersistencePlan(planRequest(null)), /exact same-business replacement/i);
  assert.throws(() => buildArtifactReferencePersistencePlan(planRequest({ ...replacementUse, useId: "aaaaaaaa-1111-4111-8111-111111111111" })), /exact same-business replacement/i);
  assert.throws(() => buildArtifactReferencePersistencePlan(planRequest({ ...replacementUse, businessId: "business:other" })), /exact same-business replacement/i);
  assert.throws(() => buildArtifactReferencePersistencePlan(planRequest({ ...replacementUse, recordVersion: "v2" })), /exact same-business replacement/i);
  assert.throws(() => buildArtifactReferencePersistencePlan(planRequest({ ...replacementUse, recordedAt: "2026-08-24T11:30:00.000Z" })), /exact same-business replacement/i);
});

test("migration 0058 rejects forged ending semantics and non-hex digests directly", () => {
  const plan = buildArtifactReferencePersistencePlan(request().persistence);
  const mutation = plan.mutations.find((item) => item.entity === "EVIDENCE_USE_END");
  assert.ok(mutation);
  const columns = [...mutation.sql.slice(mutation.sql.indexOf("("), mutation.sql.indexOf(") VALUES")).matchAll(/"([^"]+)"/g)]
    .map((match) => match[1]!);
  const bindingFor = (changes: Record<string, string>) => {
    const bindings = [...mutation.bindings];
    for (const [column, value] of Object.entries(changes)) {
      const index = columns.indexOf(column);
      assert.notEqual(index, -1);
      bindings[index] = value;
    }
    return bindings;
  };
  const database = freshDatabase();
  const strictInsertSql = mutation.sql.replace("INSERT OR IGNORE", "INSERT");
  try {
    assert.throws(() => database.prepare(strictInsertSql).run(...bindingFor({
      reasonCode: "REPLACED_BY_EVIDENCE_USE",
      basisType: "EVIDENCE_USE_REPLACEMENT",
    })), /CHECK constraint failed/);
    assert.throws(() => database.prepare(strictInsertSql).run(...bindingFor({ useDigest: "g".repeat(64) })), /CHECK constraint failed/);
  } finally {
    database.close();
  }
});
