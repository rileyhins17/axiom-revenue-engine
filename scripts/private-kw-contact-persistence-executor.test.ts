import assert from "node:assert/strict";
import test from "node:test";

import Database from "better-sqlite3";

import {
  REVENUE_CONTACT_DISCOVERY_VERSION,
  REVENUE_CONTACT_EVIDENCE_VERSION,
  buildFixtureContactDiscoveryResult,
  type RevenueContactDiscoveryRequest,
} from "../src/lib/revenue-engine/contact-discovery";
import { buildRevenueContactPersistencePlan } from "../src/lib/revenue-engine/contact-persistence-plan";
import {
  PRIVATE_KW_CONTACT_PERSISTENCE_APPROVAL_CONFIRMATION,
  PRIVATE_KW_CONTACT_PERSISTENCE_VERSION,
  buildPrivateKwContactPersistencePlan,
  type PrivateKwContactPersistenceApproval,
} from "../src/lib/revenue-engine/private-kw-contact-persistence";
import {
  REVENUE_CONTACT_VERIFICATION_VERSION,
  buildFixtureContactVerificationResult,
  type RevenueContactVerificationRequest,
} from "../src/lib/revenue-engine/contact-verification";
import {
  executePrivateKwContactPersistenceForLocalDatabase,
  executePrivateKwContactPersistencePlanForLocalDatabase,
} from "./private-kw-contact-persistence-executor";
import { applyCanonicalPrivateKwMigrations } from "./private-kw-database";

const BUSINESS_ID = "business:kw-contact-executor";

function iso(milliseconds: number) {
  return new Date(milliseconds).toISOString();
}

function fixture(hex: string, offsetMinutes = 0, reusedEvidenceCapturedAt?: string) {
  const now = Date.now() + offsetMinutes * 60_000;
  const requestedAt = iso(now - (reusedEvidenceCapturedAt ? 10 : 5) * 60_000);
  const capturedAt = reusedEvidenceCapturedAt ?? iso(now - 4 * 60_000);
  const discoveredAt = iso(now - 3 * 60_000);
  const verificationRequestedAt = iso(now - 2.5 * 60_000);
  const verifiedAt = iso(now - 2 * 60_000);
  const verifiedCompletedAt = iso(now - 1.5 * 60_000);
  const reviewedAt = iso(now - 60_000);
  const request: RevenueContactDiscoveryRequest = {
    discoveryVersion: REVENUE_CONTACT_DISCOVERY_VERSION,
    requestId: `contact-discovery-request:${hex.repeat(64)}`,
    idempotencyKey: `kw-contact-executor-${hex}`,
    businessId: BUSINESS_ID,
    websiteUrl: "https://contact-executor.axiomfixtures.ca/",
    sourceEvidenceUrl: "https://directory.axiomfixtures.ca/contact-executor",
    requestedAt,
    mode: "SHADOW",
    adapterKind: "FIXTURE",
    limits: { maxCandidates: 5, maxProviderOperations: 0, maxCostUsd: 0 },
    authority: {
      runtimeConnected: false,
      contactPersistenceAuthorized: false,
      verificationAuthorized: false,
      outreachAuthorized: false,
      sendAuthorized: false,
      providerOperationsAuthorized: 0,
      costAuthorizedUsd: 0,
    },
  };
  const discovery = buildFixtureContactDiscoveryResult({
    request,
    observations: [{
      channel: "EMAIL",
      value: "estimates@contact-executor.axiomfixtures.ca",
      label: "Published estimating address",
      personName: null,
      role: "Estimator",
      recipientKind: "ROLE",
      socialPlatform: null,
      evidence: {
        evidenceVersion: REVENUE_CONTACT_EVIDENCE_VERSION,
        sourceUrl: "https://contact-executor.axiomfixtures.ca/contact",
        capturedAt,
        method: "HTML_MAILTO",
        observation: "The synthetic public fixture exposes a role-based estimating address.",
        confidence: 99,
        publication: {
          publiclyPublished: true,
          contraryContactStatement: "NOT_OBSERVED",
          roleRelevance: "RELEVANT",
          consentBasis: "UNASSESSED",
        },
      },
    }],
    completedAt: discoveredAt,
  });
  const candidate = discovery.candidates[0]!;
  const verificationRequest: RevenueContactVerificationRequest = {
    verificationVersion: REVENUE_CONTACT_VERIFICATION_VERSION,
    requestId: `contact-verification-request:${hex.repeat(64)}`,
    idempotencyKey: `kw-contact-verification-${hex}`,
    businessId: BUSINESS_ID,
    candidate,
    requestedAt: verificationRequestedAt,
    mode: "SHADOW",
    verifierKind: "FIXTURE",
    limits: { maxProviderOperations: 0, maxCostUsd: 0 },
    authority: {
      runtimeConnected: false,
      verificationPersistenceAuthorized: false,
      qualificationPersistenceAuthorized: false,
      outreachAuthorized: false,
      sendAuthorized: false,
      providerOperationsAuthorized: 0,
      costAuthorizedUsd: 0,
    },
  };
  const verification = buildFixtureContactVerificationResult({
    request: verificationRequest,
    observation: {
      channel: "EMAIL",
      status: "DELIVERABLE",
      catchAll: false,
      provider: "FIXTURE",
      method: "FIXTURE_RECEIPT",
      evidenceReceiptId: `fixture-verification:${hex}`,
      sourceUrl: `https://verification.axiomfixtures.ca/receipts/${hex}`,
      verifiedAt,
      staleAfter: iso(now + 29 * 24 * 60 * 60_000),
      confidence: 99,
    },
    completedAt: verifiedCompletedAt,
  });
  const persistencePlan = buildRevenueContactPersistencePlan({
    discovery,
    verifications: [verification],
  });
  const approval: PrivateKwContactPersistenceApproval = {
    materializationVersion: PRIVATE_KW_CONTACT_PERSISTENCE_VERSION,
    businessId: BUSINESS_ID,
    discoveryResultId: discovery.discoveryResultId,
    discoveryResultDigest: discovery.discoveryResultDigest,
    persistencePlanDigest: persistencePlan.planDigest,
    verificationResults: [{
      verificationResultId: verification.verificationResultId,
      verificationResultDigest: verification.verificationResultDigest,
    }],
    approval: {
      decision: "APPROVED_FOR_LOCAL_CONTACT_PERSISTENCE",
      reviewedBy: "RILEY",
      reviewedAt,
      rationale: "Approved synthetic contact evidence for the local transaction executor test.",
      confirmation: PRIVATE_KW_CONTACT_PERSISTENCE_APPROVAL_CONFIRMATION,
    },
    mode: "SHADOW",
    executionKind: "IGNORED_LOCAL_SQLITE",
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
  };
  return { discovery, verification, approval };
}

function database() {
  const instance = new Database(":memory:");
  instance.pragma("foreign_keys = ON");
  applyCanonicalPrivateKwMigrations(instance);
  instance.prepare(`INSERT INTO "RevenueBusiness" ("id", "canonicalName") VALUES (?, ?)`)
    .run(BUSINESS_ID, "Synthetic KW Contact Executor");
  return instance;
}

function count(database: Database.Database, table: string) {
  return (database.prepare(`SELECT COUNT(*) AS "count" FROM "${table}"`).get() as { count: number }).count;
}

test("separate approval atomically persists one contact bundle and replays without writes", () => {
  const db = database();
  try {
    const input = fixture("a");
    const trustedPlan = buildPrivateKwContactPersistencePlan({
      discovery: input.discovery,
      verifications: [input.verification],
      approval: input.approval,
    });
    assert.equal(trustedPlan.records.at(-1)?.entity, "MATERIALIZATION_RECEIPT");
    assert.equal(trustedPlan.authority.localContactMutationAuthorized, true);
    assert.equal(trustedPlan.authority.contactDiscoveryAuthorized, false);
    assert.equal(trustedPlan.authority.contactVerificationAuthorized, false);
    assert.equal(trustedPlan.authority.consentDecisionAuthorized, false);
    assert.equal(trustedPlan.authority.outreachAuthorized, false);
    assert.equal(trustedPlan.summary.consentRows, 0);

    const first = executePrivateKwContactPersistenceForLocalDatabase(db, {
      discovery: input.discovery,
      verifications: [input.verification],
      approval: input.approval,
    });
    assert.equal(first.executionPath, "FRESH_COMMIT");
    assert.deepEqual(first.insertedRows, { contact: 4, verification: 1, materializationReceipts: 1 });
    assert.equal(first.committedAndReloaded, true);
    assert.equal(first.sendAuthorized, false);
    assert.equal(first.providerOperationsAuthorized, 0);
    assert.equal(count(db, "RevenueContactDiscoveryReceipt"), 1);
    assert.equal(count(db, "RevenueContactPoint"), 1);
    assert.equal(count(db, "RevenueContactEvidenceClaim"), 1);
    assert.equal(count(db, "RevenueContactEvidenceUse"), 1);
    assert.equal(count(db, "RevenueVerificationResult"), 1);
    assert.equal(count(db, "RevenuePrivateKwContactPersistenceReceipt"), 1);

    const replay = executePrivateKwContactPersistenceForLocalDatabase(db, {
      discovery: input.discovery,
      verifications: [input.verification],
      approval: input.approval,
    });
    assert.equal(replay.executionPath, "EXACT_REPLAY");
    assert.deepEqual(replay.insertedRows, { contact: 0, verification: 0, materializationReceipts: 0 });
    assert.throws(
      () => db.prepare(`UPDATE "RevenuePrivateKwContactPersistenceReceipt" SET "reviewedBy" = "reviewedBy"`).run(),
      /REVENUE_PRIVATE_KW_CONTACT_PERSISTENCE_APPEND_ONLY/,
    );
  } finally {
    db.close();
  }
});

test("approval drift, stale approval, partial bundles, and receipt-less exact bundles fail closed", () => {
  const input = fixture("b");
  assert.throws(() => buildPrivateKwContactPersistencePlan({
    discovery: input.discovery,
    verifications: [input.verification],
    approval: { ...input.approval, persistencePlanDigest: "f".repeat(64) },
  }), /bind the exact discovery result and re-derived plan/i);

  const stale = fixture("c", -10);
  const staleDb = database();
  try {
    assert.throws(() => executePrivateKwContactPersistenceForLocalDatabase(staleDb, {
      discovery: stale.discovery,
      verifications: [stale.verification],
      approval: stale.approval,
    }), /outside the database clock window/i);
    assert.equal(count(staleDb, "RevenueContactDiscoveryReceipt"), 0);
  } finally {
    staleDb.close();
  }

  const partialDb = database();
  try {
    const plan = buildPrivateKwContactPersistencePlan({
      discovery: input.discovery,
      verifications: [input.verification],
      approval: input.approval,
    });
    const discoveryRecord = plan.records.find((record) => record.entity === "DISCOVERY_RECEIPT")!;
    partialDb.prepare(discoveryRecord.insertSql!).run(...discoveryRecord.insertBindings);
    assert.throws(() => executePrivateKwContactPersistenceForLocalDatabase(partialDb, {
      discovery: input.discovery,
      verifications: [input.verification],
      approval: input.approval,
    }), /partial discovery-owned contact bundle/i);
    assert.equal(count(partialDb, "RevenueContactPoint"), 0);
    assert.equal(count(partialDb, "RevenuePrivateKwContactPersistenceReceipt"), 0);
  } finally {
    partialDb.close();
  }

  const unreceiptedDb = database();
  try {
    const plan = buildPrivateKwContactPersistencePlan({
      discovery: input.discovery,
      verifications: [input.verification],
      approval: input.approval,
    });
    unreceiptedDb.transaction(() => {
      for (const record of plan.records.slice(0, -1)) {
        if (record.insertSql) unreceiptedDb.prepare(record.insertSql).run(...record.insertBindings);
      }
    })();
    assert.throws(() => executePrivateKwContactPersistenceForLocalDatabase(unreceiptedDb, {
      discovery: input.discovery,
      verifications: [input.verification],
      approval: input.approval,
    }), /without its local materialization receipt/i);
  } finally {
    unreceiptedDb.close();
  }
});

test("a failed final receipt rolls back the complete contact transaction", () => {
  const db = database();
  try {
    const input = fixture("d");
    const plan = buildPrivateKwContactPersistencePlan({
      discovery: input.discovery,
      verifications: [input.verification],
      approval: input.approval,
    });
    db.exec(`CREATE TRIGGER "fixture_contact_materialization_failure"
      BEFORE INSERT ON "RevenuePrivateKwContactPersistenceReceipt"
      BEGIN SELECT RAISE(ABORT, 'FIXTURE_CONTACT_MATERIALIZATION_FAILURE'); END;`);
    assert.throws(
      () => executePrivateKwContactPersistencePlanForLocalDatabase(db, plan),
      /FIXTURE_CONTACT_MATERIALIZATION_FAILURE/,
    );
    assert.equal(count(db, "RevenueContactDiscoveryReceipt"), 0);
    assert.equal(count(db, "RevenueContactPoint"), 0);
    assert.equal(count(db, "RevenueContactEvidenceClaim"), 0);
    assert.equal(count(db, "RevenueContactEvidenceUse"), 0);
    assert.equal(count(db, "RevenueVerificationResult"), 0);
    assert.equal(count(db, "RevenuePrivateKwContactPersistenceReceipt"), 0);
  } finally {
    db.close();
  }
});

test("a later approved discovery can reuse exact global evidence and append a new version", () => {
  const db = database();
  try {
    const first = fixture("e");
    executePrivateKwContactPersistenceForLocalDatabase(db, {
      discovery: first.discovery,
      verifications: [first.verification],
      approval: first.approval,
    });
    const second = fixture("f", 1, first.discovery.candidates[0]!.evidenceClaims[0]!.capturedAt);
    const result = executePrivateKwContactPersistenceForLocalDatabase(db, {
      discovery: second.discovery,
      verifications: [second.verification],
      approval: second.approval,
    });
    assert.equal(result.executionPath, "FRESH_COMMIT");
    assert.deepEqual(result.insertedRows, { contact: 3, verification: 1, materializationReceipts: 1 });
    assert.equal(count(db, "RevenueContactDiscoveryReceipt"), 2);
    assert.equal(count(db, "RevenueContactPoint"), 2);
    assert.equal(count(db, "RevenueContactEvidenceClaim"), 1);
    assert.equal(count(db, "RevenueContactEvidenceUse"), 2);
    assert.equal(count(db, "RevenuePrivateKwContactPersistenceReceipt"), 2);
  } finally {
    db.close();
  }
});

test("direct SQL cannot forge an incomplete materialization receipt", () => {
  const db = database();
  try {
    const input = fixture("9");
    const plan = buildPrivateKwContactPersistencePlan({
      discovery: input.discovery,
      verifications: [input.verification],
      approval: input.approval,
    });
    const receipt = plan.records.at(-1)!;
    assert.throws(
      () => db.prepare(receipt.insertSql!).run(...receipt.insertBindings),
      /(?:FOREIGN KEY|REVENUE_PRIVATE_KW_CONTACT_PERSISTENCE_LINEAGE_MISMATCH)/,
    );
  } finally {
    db.close();
  }
});
