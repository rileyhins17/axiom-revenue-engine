import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

import Database from "better-sqlite3";

import {
  artifactReferenceCanonicalJson,
  artifactReferenceDigest,
} from "@/lib/revenue-engine/artifact-reference-projection";
import {
  PRIVATE_KW_AUTHENTICATED_OWNER_DECISION_CONFIRMATION,
  PRIVATE_KW_AUTHENTICATED_OWNER_DECISION_DECLARATION_VERSION,
  buildPrivateKwAuthenticatedOwnerDecisionRecord,
} from "@/lib/revenue-engine/private-kw-authenticated-owner-decision";
import {
  PRIVATE_KW_OWNER_DOSSIER_ACCEPT_OPERATION,
  PRIVATE_KW_OWNER_DOSSIER_ACCEPT_D1_PLAN_VERSION,
  PRIVATE_KW_OWNER_DOSSIER_ACCEPT_SCHEMA_VERSION_FENCE,
  buildPrivateKwOwnerDossierAcceptD1Plan,
  buildPrivateKwOwnerDossierAcceptOperationResult,
  buildPrivateKwOwnerDossierAcceptRequestPayload,
  materializePrivateKwOwnerDossierAcceptFreshStatements,
  requireInProcessPrivateKwOwnerDossierAcceptD1Plan,
  type PrivateKwOwnerDossierAcceptD1Statement,
} from "@/lib/revenue-engine/private-kw-owner-auth-dossier-accept-d1-plan";
import {
  commitPrivateKwOwnerAuthIdempotency,
  type PrivateKwOwnerAuthIdempotencyRecord,
  type PrivateKwOwnerAuthIdempotencyStore,
} from "@/lib/revenue-engine/private-kw-owner-auth-idempotency";
import {
  buildPrivateKwOwnerAuthMutationAffectedRowProof,
} from "@/lib/revenue-engine/private-kw-owner-auth-idempotency-recovery-proof";
import {
  buildPrivateKwOwnerAuthReadiness,
} from "@/lib/revenue-engine/private-kw-owner-auth-readiness";
import {
  PRIVATE_KW_OWNER_AUTH_SERVER_BOUNDARY_VERSION,
  buildPrivateKwOwnerAuthServerBoundary,
} from "@/lib/revenue-engine/private-kw-owner-auth-server-boundary";
import {
  createPrivateKwOwnerDossierProgressFixture,
} from "@/lib/revenue-engine/test-support/private-kw-owner-dossier-progress-fixture";

const BINDING_KEY = Buffer.from("owner-dossier-atomic-transaction-binding-v1", "utf8");
const BINDING_KEY_VERSION = "owner-dossier-atomic-binding-v1";

type Fixture = Awaited<ReturnType<typeof createPrivateKwOwnerDossierProgressFixture>>;
type PreparedContext = Awaited<ReturnType<typeof context>>;

const REQUIRED_TRIGGER_NAMES = [
  "RevenuePrivateKwOwnerAuthIdempotency_contract_insert",
  "RevenuePrivateKwOwnerAuthIdempotency_immutable_delete",
  "RevenuePrivateKwOwnerAuthIdempotency_transition_update",
  "RevenuePrivateKwOwnerAuthMutationOutbox_contract_insert",
  "RevenuePrivateKwOwnerAuthMutationOutbox_delivery_update",
  "RevenuePrivateKwOwnerAuthMutationOutbox_immutable_delete",
  "RevenuePrivateKwOwnerDecision_immutable_delete",
  "RevenuePrivateKwOwnerDecision_immutable_update",
  "RevenuePrivateKwOwnerDecision_lineage_insert",
] as const;

function declaration(fixture: Fixture) {
  return {
    declarationVersion: PRIVATE_KW_AUTHENTICATED_OWNER_DECISION_DECLARATION_VERSION,
    dossierDigest: fixture.dossierDigest,
    businessId: fixture.ownerDossier.lead.business.businessId,
    decision: "ACCEPTED_FOR_READ_ONLY_SHADOW_PROGRESS",
    rationale: "The exact synthetic owner dossier is accepted for atomic transaction verification.",
    confirmation: PRIVATE_KW_AUTHENTICATED_OWNER_DECISION_CONFIRMATION,
    mode: "SHADOW",
  };
}

function ownerSession(fixture: Fixture, owner: "RILEY" | "AIDAN" = "RILEY") {
  const decidedAt = Date.parse(fixture.acceptance.acceptedAt);
  const ownerSlug = owner.toLocaleLowerCase("en-CA");
  return {
    sessionContractVersion: "better-auth-owner-session-v1",
    authenticationProvider: "BETTER_AUTH",
    authenticatedUserId: `user-${ownerSlug}-owner-dossier-atomic`,
    authenticatedSessionId: `session-${ownerSlug}-owner-dossier-atomic`,
    authenticatedEmail: `${ownerSlug}@getaxiom.ca`,
    authenticatedEmailVerified: true,
    sessionCreatedAt: new Date(decidedAt - 60 * 60_000).toISOString(),
    sessionExpiresAt: new Date(decidedAt + 60 * 60_000).toISOString(),
  };
}

function readiness(checkedAt: string) {
  return buildPrivateKwOwnerAuthReadiness({
    readinessVersion: "kw-owner-auth-readiness-v1",
    environment: "STAGING",
    ownerAllowlist: ["riley@getaxiom.ca", "aidan@getaxiom.ca"],
    emailVerification: {
      requiredBeforeSession: true,
      sendVerificationEmailConfigured: true,
      sendOnSignUp: true,
      sendOnSignIn: true,
      tokenLifetimeSeconds: 3_600,
    },
    multiFactor: {
      provider: "TOTP",
      enrollmentRequiredForOwners: true,
      requiredForOwnerActions: true,
      backupCodesEnabled: true,
      backupCodesEncryptedAtRest: true,
      backupCodesSingleUse: true,
      freshSessionRequiredToViewCodes: true,
      accountLockoutEnabled: true,
      maxFailedAttempts: 5,
      lockoutDurationSeconds: 900,
    },
    session: {
      serverOnlyLookup: true,
      requestBodyFieldsIgnored: true,
      secureCookie: true,
      sameSite: "lax",
      maxAgeSeconds: 86_400,
    },
    csrf: {
      originCheckEnabled: true,
      fetchMetadataChecksEnabled: true,
      trustedOriginsExact: ["https://revenue.getaxiom.ca"],
      wildcardOriginsAllowed: false,
      localhostAllowedInProduction: false,
    },
    idempotency: {
      enabled: true,
      keyIncludesOperation: true,
      keyIncludesActor: true,
      keyIncludesPayloadDigest: true,
      atomicStorage: true,
      replayReturnsSameResult: true,
    },
    checkedAt,
  });
}

function memoryStore(initial: PrivateKwOwnerAuthIdempotencyRecord | null = null):
PrivateKwOwnerAuthIdempotencyStore {
  let stored = initial;
  return {
    async insertIfAbsent(candidate) {
      if (stored) return { inserted: false, existing: stored };
      stored = structuredClone(candidate);
      return { inserted: true, existing: null };
    },
  };
}

async function context(
  suffix: string,
  options: { wrongResult?: boolean; owner?: "RILEY" | "AIDAN" } = {},
) {
  const fixture = await createPrivateKwOwnerDossierProgressFixture({
    suffix,
    now: new Date(Date.now() - 15 * 60_000),
  });
  const owner = options.owner ?? "RILEY";
  const session = ownerSession(fixture, owner);
  const record = buildPrivateKwAuthenticatedOwnerDecisionRecord({
    manifestValue: fixture.manifest,
    contactReviewProgressCheckpointValue: fixture.contactCheckpoint,
    ownerDossierValue: fixture.ownerDossier,
    declarationValue: declaration(fixture),
    authenticatedSessionValue: session,
  }, {
    bindingKey: BINDING_KEY,
    bindingKeyVersion: BINDING_KEY_VERSION,
    now: () => new Date(fixture.acceptance.acceptedAt),
  });
  const requestPayload = buildPrivateKwOwnerDossierAcceptRequestPayload(record);
  const payloadDigest = artifactReferenceDigest(requestPayload);
  const idempotencyKey = `kw-owner-mutation-idempotency:${artifactReferenceDigest({
    boundaryVersion: PRIVATE_KW_OWNER_AUTH_SERVER_BOUNDARY_VERSION,
    owner,
    operation: PRIVATE_KW_OWNER_DOSSIER_ACCEPT_OPERATION,
    payloadDigest,
  })}`;
  const decidedAt = Date.parse(fixture.acceptance.acceptedAt);
  const boundary = buildPrivateKwOwnerAuthServerBoundary({
    readinessValue: readiness(fixture.acceptance.acceptedAt),
    serverSessionValue: session,
    request: {
      method: "POST",
      origin: "https://revenue.getaxiom.ca",
      headers: {
        Origin: "https://revenue.getaxiom.ca",
        "Sec-Fetch-Site": "same-origin",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Dest": "empty",
      },
      body: { ignoredSessionId: "never-trusted" },
    },
    operation: PRIVATE_KW_OWNER_DOSSIER_ACCEPT_OPERATION,
    payload: requestPayload,
    idempotencyKey,
  }, { now: () => new Date(decidedAt + 1_000) });
  const result = options.wrongResult
    ? { outcome: "WRONG_RESULT", ownerDecisionRecordId: record.recordId }
    : buildPrivateKwOwnerDossierAcceptOperationResult(record);
  const idempotencyCommit = await commitPrivateKwOwnerAuthIdempotency({
    boundaryValue: boundary,
    resultValue: result,
  }, memoryStore(), { now: () => new Date(decidedAt + 2_000) });
  return {
    fixture,
    session,
    record,
    boundary,
    idempotencyCommit,
    plannedAt: new Date(decidedAt + 3_000).toISOString(),
  };
}

function planFor(prepared: PreparedContext) {
  return buildPrivateKwOwnerDossierAcceptD1Plan({
    boundaryValue: prepared.boundary,
    idempotencyCommitResultValue: prepared.idempotencyCommit,
    ownerDecisionRecordValue: prepared.record,
    currentSessionValue: prepared.session,
    bindingKey: BINDING_KEY,
    bindingKeyVersion: BINDING_KEY_VERSION,
    plannedAt: prepared.plannedAt,
  });
}

function migrateDatabase(database: Database.Database) {
  database.pragma("foreign_keys = ON");
  const migrationRoot = new URL("../../../migrations/", import.meta.url);
  const migrations = readdirSync(migrationRoot)
    .filter((name) => /^(005[4-9]|006[0-9]|0070)_.*\.sql$/.test(name))
    .sort();
  assert.equal(migrations.at(0)?.startsWith("0054_"), true);
  assert.equal(migrations.at(-1)?.startsWith("0070_"), true);
  assert.equal(migrations.length, 17);
  migrations.forEach((migration) => {
    database.exec(readFileSync(new URL(migration, migrationRoot), "utf8"));
  });
}

function migratedDatabase(path = ":memory:") {
  const database = new Database(path);
  migrateDatabase(database);
  return database;
}

function materializeFresh(
  database: Database.Database,
  plan: ReturnType<typeof planFor>,
) {
  const row = database.prepare("PRAGMA schema_version").get() as {
    schema_version: number;
  };
  return materializePrivateKwOwnerDossierAcceptFreshStatements(
    plan,
    row.schema_version,
  );
}

function insertBusiness(database: Database.Database, fixture: Fixture) {
  database.prepare(`INSERT OR IGNORE INTO "RevenueBusiness"
    ("id", "canonicalName", "normalizedDomain", "independenceStatus", "status")
    VALUES (?, ?, ?, ?, ?)`)
    .run(
      fixture.ownerDossier.lead.business.businessId,
      fixture.ownerDossier.lead.business.canonicalName,
      `${artifactReferenceDigest({
        businessId: fixture.ownerDossier.lead.business.businessId,
      }).slice(0, 20)}.example`,
      fixture.ownerDossier.lead.business.independenceStatus,
      "ACTIVE",
    );
}

type ExecutionResult = {
  statementId: string;
  changes: number;
  rows: Record<string, string | number | null>[];
};

function executeTransaction(
  database: Database.Database,
  statements: readonly PrivateKwOwnerDossierAcceptD1Statement[],
  failAfterIndex: number | null = null,
) {
  const transaction = database.transaction(() => statements.map((item, index) => {
    const prepared = database.prepare(item.sql);
    let result: ExecutionResult;
    if (prepared.reader) {
      result = {
        statementId: item.statementId,
        changes: 0,
        rows: prepared.all(...item.bindings) as Record<string, string | number | null>[],
      };
    } else {
      const mutation = prepared.run(...item.bindings);
      result = { statementId: item.statementId, changes: mutation.changes, rows: [] };
    }
    if (result.changes !== item.expectedChanges) {
      throw new Error(
        `EXPECTED_CHANGES_${item.expectedChanges}_FOR_${item.statementId}_GOT_${result.changes}`,
      );
    }
    if (failAfterIndex === index) {
      throw new Error(`INJECTED_FAILURE_AFTER_${item.statementId}`);
    }
    return result;
  }));
  return transaction();
}

function executeTransactionWithoutCountEnforcement(
  database: Database.Database,
  statements: readonly PrivateKwOwnerDossierAcceptD1Statement[],
) {
  const transaction = database.transaction(() => statements.map((item) => {
    const prepared = database.prepare(item.sql);
    if (prepared.reader) {
      return {
        statementId: item.statementId,
        changes: 0,
        rows: prepared.all(...item.bindings) as Record<string, string | number | null>[],
      } satisfies ExecutionResult;
    }
    const mutation = prepared.run(...item.bindings);
    return {
      statementId: item.statementId,
      changes: mutation.changes,
      rows: [],
    } satisfies ExecutionResult;
  }));
  return transaction();
}

function tableCount(database: Database.Database, table: string) {
  return (database.prepare(`SELECT COUNT(*) AS "count" FROM "${table}"`).get() as {
    count: number;
  }).count;
}

function scopedCount(
  database: Database.Database,
  table: string,
  column: string,
  value: string,
) {
  return (database.prepare(
    `SELECT COUNT(*) AS "count" FROM "${table}" WHERE "${column}" = ?`,
  ).get(value) as { count: number }).count;
}

function exactBundleSnapshot(
  database: Database.Database,
  plan: ReturnType<typeof planFor>,
) {
  return artifactReferenceCanonicalJson({
    decision: database.prepare(
      `SELECT * FROM "RevenuePrivateKwOwnerDecision" WHERE "id" = ?`,
    ).get(plan.ownerDecisionRecordId) ?? null,
    idempotency: database.prepare(
      `SELECT * FROM "RevenuePrivateKwOwnerAuthIdempotency" WHERE "id" = ?`,
    ).get(plan.idempotencyKey) ?? null,
    outbox: database.prepare(
      `SELECT * FROM "RevenuePrivateKwOwnerAuthMutationOutbox" WHERE "id" = ?`,
    ).get(plan.outboxEventId) ?? null,
  });
}

function seedCommittedBundle(
  database: Database.Database,
  prepared: PreparedContext,
  plan: ReturnType<typeof planFor>,
) {
  insertBusiness(database, prepared.fixture);
  executeTransaction(database, materializeFresh(database, plan));
  return exactBundleSnapshot(database, plan);
}

function seedExactDecisionWithoutIdempotency(
  database: Database.Database,
  plan: ReturnType<typeof planFor>,
) {
  executeTransaction(database, materializeFresh(database, plan).slice(0, 2));
  const triggerName = "RevenuePrivateKwOwnerAuthIdempotency_immutable_delete";
  const triggerSql = database.prepare(
    `SELECT "sql" FROM "sqlite_master" WHERE "type" = 'trigger' AND "name" = ?`,
  ).pluck().get(triggerName);
  if (typeof triggerSql !== "string") throw new Error("Required test trigger is missing.");
  database.exec(`DROP TRIGGER "${triggerName}"`);
  database.prepare(
    `DELETE FROM "RevenuePrivateKwOwnerAuthIdempotency" WHERE "idempotencyKey" = ?`,
  ).run(plan.idempotencyKey);
  database.exec(triggerSql);
}

test("builds one exact source-only owner dossier transaction with aborting fresh inserts", async () => {
  const prepared = await context("owner-dossier-atomic-plan");
  const plan = buildPrivateKwOwnerDossierAcceptD1Plan({
    boundaryValue: prepared.boundary,
    idempotencyCommitResultValue: prepared.idempotencyCommit,
    ownerDecisionRecordValue: prepared.record,
    currentSessionValue: prepared.session,
    bindingKey: BINDING_KEY,
    bindingKeyVersion: BINDING_KEY_VERSION,
    plannedAt: prepared.plannedAt,
  });

  assert.equal(plan.planVersion, PRIVATE_KW_OWNER_DOSSIER_ACCEPT_D1_PLAN_VERSION);
  assert.equal(plan.planId, `kw-owner-dossier-accept-d1-plan:${plan.planDigest}`);
  assert.equal(plan.operation, PRIVATE_KW_OWNER_DOSSIER_ACCEPT_OPERATION);
  assert.equal(plan.ownerDecisionRecordId, prepared.record.recordId);
  assert.equal(plan.ownerDecisionRecordDigest, prepared.record.recordDigest);
  assert.equal(plan.operationClaim.targetTable, "RevenuePrivateKwOwnerDecision");
  assert.match(plan.operationClaim.sql, /^INSERT INTO "RevenuePrivateKwOwnerDecision"/);
  assert.match(plan.operationClaim.sql, /RevenuePrivateKwOwnerAuthIdempotency/);
  assert.deepEqual(plan.freshBatchStatements.map((item) => item.statementId), plan.freshBatchOrder);
  assert.deepEqual(
    plan.freshBatchStatements.slice(0, 4).map((item) => item.expectedChanges),
    [1, 1, 1, 1],
  );
  assert.doesNotMatch(plan.freshBatchStatements[0]?.sql ?? "", /INSERT OR IGNORE/i);
  assert.doesNotMatch(plan.freshBatchStatements[3]?.sql ?? "", /INSERT OR IGNORE/i);
  assert.match(plan.freshBatchStatements[2]?.sql ?? "", /RevenuePrivateKwOwnerDecision/);
  assert.match(
    plan.freshBatchStatements[2]?.sql ?? "",
    /CASE WHEN changes\(\) = 1 THEN 'COMMITTED' ELSE NULL END/,
  );
  assert.match(plan.freshBatchStatements[3]?.sql ?? "", /SELECT "recordId"[\s\S]*state" = 'COMMITTED'/);
  assert.equal(plan.transactionFailureBehavior, "ANY_STATEMENT_ERROR_ROLLS_BACK_WHOLE_D1_BATCH");
  assert.equal(plan.replayBehavior, "READ_EXACT_COMMITTED_BUNDLE_WITHOUT_MUTATION");
  assert.equal(plan.runtimeConnected, false);
  assert.equal(plan.migrationApplied, false);
  assert.equal(plan.authority.ownerDecisionPersistenceAuthorized, false);
  assert.equal(plan.authority.outreachAuthorized, false);
  assert.equal(plan.authority.sendAuthorized, false);
  assert.equal(plan.authority.costAuthorizedUsd, 0);
  assert.equal(plan.authority.exactSchemaVersionFenceRequired, true);
  assert.equal(
    plan.freshBatchStatements.flatMap((item) => item.bindings)
      .filter((value) => value === PRIVATE_KW_OWNER_DOSSIER_ACCEPT_SCHEMA_VERSION_FENCE)
      .length,
    2,
  );
  const materialized = materializePrivateKwOwnerDossierAcceptFreshStatements(plan, 42);
  assert.equal(Object.isFrozen(materialized), true);
  assert.equal(
    materialized.flatMap((item) => item.bindings)
      .filter((value) => value === PRIVATE_KW_OWNER_DOSSIER_ACCEPT_SCHEMA_VERSION_FENCE)
      .length,
    0,
  );
  assert.equal(
    materialized.flatMap((item) => item.bindings).filter((value) => value === 42).length,
    2,
  );
  assert.throws(
    () => materializePrivateKwOwnerDossierAcceptFreshStatements(plan, -1),
  );
  assert.equal(Object.isFrozen(plan), true);
  assert.equal(requireInProcessPrivateKwOwnerDossierAcceptD1Plan(plan), plan);
  assert.throws(
    () => requireInProcessPrivateKwOwnerDossierAcceptD1Plan(structuredClone(plan)),
    /exact in-process owner dossier|exact in-process reservation claim/i,
  );
  const digestDrift = {
    ...structuredClone(plan),
    operationClaim: plan.operationClaim,
    plannedAt: new Date(Date.parse(plan.plannedAt) + 1_000).toISOString(),
  };
  assert.throws(
    () => requireInProcessPrivateKwOwnerDossierAcceptD1Plan(digestDrift),
    /identity must bind its exact content/i,
  );
});

test("exact migration 0069 plus 0070 commits once and replays only by reading the bundle", async () => {
  const prepared = await context("owner-dossier-atomic-success");
  const unrelated = await context("owner-dossier-atomic-unrelated-success", {
    owner: "AIDAN",
  });
  const plan = planFor(prepared);
  const unrelatedPlan = planFor(unrelated);
  const database = migratedDatabase();
  const unrelatedBefore = seedCommittedBundle(database, unrelated, unrelatedPlan);
  insertBusiness(database, prepared.fixture);

  const preflight = executeTransaction(database, plan.preflightStatements);
  assert.equal(preflight[0]?.rows.length, 9);
  assert.deepEqual(
    preflight[0]?.rows.map((row) => row.name),
    [...REQUIRED_TRIGGER_NAMES],
  );
  assert.equal(
    preflight[0]?.rows.every((row) =>
      typeof row.name === "string"
      && typeof row.sql === "string"
      && row.sql.includes("RAISE(ABORT")),
    true,
  );
  assert.equal(preflight[1]?.rows.length, 0);
  assert.equal(preflight[2]?.rows.length, 0);
  assert.equal(preflight[3]?.rows.length, 0);

  const fresh = executeTransaction(database, materializeFresh(database, plan));
  assert.deepEqual(fresh.slice(0, 4).map((item) => item.changes), [1, 1, 1, 1]);
  assert.equal(fresh[4]?.rows.length, 1);
  assert.equal(fresh[5]?.rows.length, 1);
  assert.equal(fresh[6]?.rows.length, 1);
  assert.equal(fresh[7]?.rows.length, 1);
  const committedRow = fresh[4]?.rows[0] ?? {};
  const decisionRow = fresh[5]?.rows[0] ?? {};
  const outboxRow = fresh[6]?.rows[0] ?? {};
  assert.equal(committedRow.state, "COMMITTED");
  assert.equal(committedRow.recordId, prepared.idempotencyCommit.record.recordId);
  assert.equal(
    artifactReferenceCanonicalJson(JSON.parse(String(committedRow.resultJson))),
    artifactReferenceCanonicalJson(prepared.idempotencyCommit.record),
  );
  assert.equal(decisionRow.id, prepared.record.recordId);
  assert.equal(decisionRow.decisionDigest, prepared.record.recordDigest);
  assert.equal(
    artifactReferenceCanonicalJson(JSON.parse(String(decisionRow.decisionJson))),
    artifactReferenceCanonicalJson(prepared.record),
  );
  assert.equal(outboxRow.id, plan.outboxEventId);
  assert.equal(outboxRow.idempotencyKey, plan.idempotencyKey);
  assert.equal(outboxRow.recordId, plan.idempotencyRecordId);
  const expectedEventCore = {
    eventVersion: "kw-owner-auth-outbox-v1",
    eventKind: "OWNER_AUTH_MUTATION_COMMITTED",
    idempotencyKey: plan.idempotencyKey,
    recordId: plan.idempotencyRecordId,
    owner: prepared.boundary.owner,
    operation: plan.operation,
    payloadDigest: plan.payloadDigest,
    recordDigest: plan.idempotencyRecordDigest,
    state: "COMMITTED",
    authority: {
      deliveryAuthorized: 0,
      providerOperationsAuthorized: 0,
      costAuthorizedUsd: 0,
    },
  };
  const expectedEvent = {
    ...expectedEventCore,
    eventId: `kw-owner-auth-outbox:${artifactReferenceDigest(expectedEventCore)}`,
    eventDigest: artifactReferenceDigest(expectedEventCore),
  };
  assert.equal(
    artifactReferenceCanonicalJson(JSON.parse(String(outboxRow.eventJson))),
    artifactReferenceCanonicalJson(expectedEvent),
  );
  const unrelatedRowsChanged = exactBundleSnapshot(database, unrelatedPlan) === unrelatedBefore
    ? 0
    : 1;
  assert.equal(unrelatedRowsChanged, 0);

  const idempotencyRowsAfter = scopedCount(
    database,
    "RevenuePrivateKwOwnerAuthIdempotency",
    "idempotencyKey",
    plan.idempotencyKey,
  );
  const outboxRowsAfter = scopedCount(
    database,
    "RevenuePrivateKwOwnerAuthMutationOutbox",
    "idempotencyKey",
    plan.idempotencyKey,
  );

  const countProof = buildPrivateKwOwnerAuthMutationAffectedRowProof({
    claimValue: plan.operationClaim,
    executionPath: "FRESH_COMMIT",
    claimMatched: true,
    operationRowsAffected: fresh[1]?.changes ?? -1,
    idempotencyRowsInserted: fresh[0]?.changes ?? -1,
    idempotencyRowsAfter,
    outboxRowsInserted: fresh[3]?.changes ?? -1,
    outboxRowsAfter,
    ownerMutationRowsChanged: fresh[1]?.changes ?? -1,
    unrelatedRowsChanged,
    transactionState: "COMMITTED",
    failureReason: null,
  });
  assert.equal(countProof.executionPath, "FRESH_COMMIT");
  assert.equal(countProof.rowCountScope, "EXACT_IDEMPOTENCY_KEY");

  const beforeReplay = database.serialize();
  const replay = executeTransaction(database, plan.replayStatements);
  assert.equal(replay[0]?.rows.length, 9);
  assert.equal(replay[1]?.rows.length, 1);
  assert.equal(replay[2]?.rows.length, 1);
  assert.equal(replay[3]?.rows.length, 1);
  assert.deepEqual(replay[1]?.rows, fresh[4]?.rows);
  assert.deepEqual(replay[2]?.rows, fresh[5]?.rows);
  assert.deepEqual(replay[3]?.rows, fresh[6]?.rows);
  assert.equal(
    artifactReferenceCanonicalJson(JSON.parse(String(replay[1]?.rows[0]?.resultJson))),
    artifactReferenceCanonicalJson(prepared.idempotencyCommit.record),
  );
  assert.equal(
    artifactReferenceCanonicalJson(JSON.parse(String(replay[2]?.rows[0]?.decisionJson))),
    artifactReferenceCanonicalJson(prepared.record),
  );
  assert.equal(
    artifactReferenceCanonicalJson(JSON.parse(String(replay[3]?.rows[0]?.eventJson))),
    artifactReferenceCanonicalJson(JSON.parse(String(fresh[6]?.rows[0]?.eventJson))),
  );
  assert.deepEqual(database.serialize(), beforeReplay);
  assert.equal(exactBundleSnapshot(database, unrelatedPlan), unrelatedBefore);
  const replayProof = buildPrivateKwOwnerAuthMutationAffectedRowProof({
    claimValue: plan.operationClaim,
    executionPath: "EXACT_REPLAY",
    claimMatched: false,
    operationRowsAffected: 0,
    idempotencyRowsInserted: 0,
    idempotencyRowsAfter: scopedCount(
      database,
      "RevenuePrivateKwOwnerAuthIdempotency",
      "idempotencyKey",
      plan.idempotencyKey,
    ),
    outboxRowsInserted: 0,
    outboxRowsAfter: scopedCount(
      database,
      "RevenuePrivateKwOwnerAuthMutationOutbox",
      "idempotencyKey",
      plan.idempotencyKey,
    ),
    ownerMutationRowsChanged: 0,
    unrelatedRowsChanged: 0,
    transactionState: "COMMITTED",
    failureReason: null,
  });
  assert.equal(replayProof.executionPath, "EXACT_REPLAY");
  assert.equal(tableCount(database, "RevenuePrivateKwOwnerDecision"), 2);
  assert.equal(tableCount(database, "RevenuePrivateKwOwnerAuthIdempotency"), 2);
  assert.equal(tableCount(database, "RevenuePrivateKwOwnerAuthMutationOutbox"), 2);
  database.close();
});

test("two stale preflights deterministically converge on one commit and one exact replay", async () => {
  const prepared = await context("owner-dossier-atomic-race");
  const plan = planFor(prepared);
  const database = migratedDatabase();
  assert.equal(database.memory, true);
  insertBusiness(database, prepared.fixture);
  assert.equal(executeTransaction(database, plan.preflightStatements)[1]?.rows.length, 0);
  assert.equal(executeTransaction(database, plan.preflightStatements)[1]?.rows.length, 0);
  const fresh = executeTransaction(database, materializeFresh(database, plan));
  assert.throws(
    () => executeTransaction(database, materializeFresh(database, plan)),
    /UNIQUE constraint failed.*OwnerAuthIdempotency/i,
  );
  const replay = executeTransaction(database, plan.replayStatements);
  assert.deepEqual(replay[1]?.rows, fresh[4]?.rows);
  assert.deepEqual(replay[2]?.rows, fresh[5]?.rows);
  assert.deepEqual(replay[3]?.rows, fresh[6]?.rows);
  assert.equal(tableCount(database, "RevenuePrivateKwOwnerDecision"), 1);
  assert.equal(tableCount(database, "RevenuePrivateKwOwnerAuthIdempotency"), 1);
  assert.equal(tableCount(database, "RevenuePrivateKwOwnerAuthMutationOutbox"), 1);
  database.close();
});

test("failure after every statement and missing guards roll back the complete concrete action", async () => {
  const prepared = await context("owner-dossier-atomic-rollback");
  const unrelated = await context("owner-dossier-atomic-unrelated-rollback", {
    owner: "AIDAN",
  });
  const plan = planFor(prepared);
  const unrelatedPlan = planFor(unrelated);
  for (let failAfter = 0; failAfter < plan.freshBatchStatements.length; failAfter += 1) {
    const database = migratedDatabase();
    const unrelatedBefore = seedCommittedBundle(database, unrelated, unrelatedPlan);
    insertBusiness(database, prepared.fixture);
    assert.throws(
      () => executeTransaction(database, materializeFresh(database, plan), failAfter),
      /INJECTED_FAILURE_AFTER_/,
    );
    assert.equal(scopedCount(
      database, "RevenuePrivateKwOwnerDecision", "id", plan.ownerDecisionRecordId,
    ), 0);
    assert.equal(scopedCount(
      database, "RevenuePrivateKwOwnerAuthIdempotency", "idempotencyKey", plan.idempotencyKey,
    ), 0);
    assert.equal(scopedCount(
      database, "RevenuePrivateKwOwnerAuthMutationOutbox", "idempotencyKey", plan.idempotencyKey,
    ), 0);
    assert.equal(exactBundleSnapshot(database, unrelatedPlan), unrelatedBefore);
    database.close();
  }

  for (const triggerName of REQUIRED_TRIGGER_NAMES) {
    const guardDatabase = migratedDatabase();
    const unrelatedBefore = seedCommittedBundle(guardDatabase, unrelated, unrelatedPlan);
    insertBusiness(guardDatabase, prepared.fixture);
    guardDatabase.exec(`DROP TRIGGER "${triggerName}"`);
    assert.throws(
      () => executeTransaction(guardDatabase, materializeFresh(guardDatabase, plan)),
      /EXPECTED_CHANGES|CONTRACT_MISMATCH|NOT NULL constraint failed/i,
    );
    assert.equal(scopedCount(
      guardDatabase, "RevenuePrivateKwOwnerDecision", "id", plan.ownerDecisionRecordId,
    ), 0);
    assert.equal(scopedCount(
      guardDatabase,
      "RevenuePrivateKwOwnerAuthIdempotency",
      "idempotencyKey",
      plan.idempotencyKey,
    ), 0);
    assert.equal(scopedCount(
      guardDatabase,
      "RevenuePrivateKwOwnerAuthMutationOutbox",
      "idempotencyKey",
      plan.idempotencyKey,
    ), 0);
    assert.equal(exactBundleSnapshot(guardDatabase, unrelatedPlan), unrelatedBefore);
    guardDatabase.close();
  }
});

test("the SQL dependency chain aborts a zero-row operation even without JavaScript count checks", async () => {
  const prepared = await context("owner-dossier-atomic-zero-row");
  const plan = planFor(prepared);
  const database = migratedDatabase();
  insertBusiness(database, prepared.fixture);
  seedExactDecisionWithoutIdempotency(database, plan);
  const preflight = executeTransaction(database, plan.preflightStatements);
  assert.equal(preflight[0]?.rows.length, 9);
  assert.equal(preflight[1]?.rows.length, 0);
  assert.equal(preflight[2]?.rows.length, 1);
  assert.equal(preflight[3]?.rows.length, 0);
  const operation = plan.freshBatchStatements[1];
  assert.ok(operation);
  const reservationBindingIndex = operation.bindings.findIndex(
    (binding) => binding === plan.idempotencyKey,
  );
  assert.notEqual(reservationBindingIndex, -1);
  const driftedOperation = {
    ...operation,
    bindings: operation.bindings.map((binding, index) =>
      index === reservationBindingIndex
        ? `kw-owner-mutation-idempotency:${"0".repeat(64)}`
        : binding),
  };
  const driftedStatements = materializeFresh(database, plan).map((statement, index) =>
    index === 1 ? driftedOperation : statement);

  assert.throws(
    () => executeTransactionWithoutCountEnforcement(database, driftedStatements),
    /NOT NULL constraint failed|CONTRACT_MISMATCH|INVALID_TRANSITION/i,
  );
  assert.equal(scopedCount(
    database, "RevenuePrivateKwOwnerDecision", "id", plan.ownerDecisionRecordId,
  ), 1);
  assert.equal(scopedCount(
    database, "RevenuePrivateKwOwnerAuthIdempotency", "idempotencyKey", plan.idempotencyKey,
  ), 0);
  assert.equal(scopedCount(
    database, "RevenuePrivateKwOwnerAuthMutationOutbox", "idempotencyKey", plan.idempotencyKey,
  ), 0);
  database.close();
});

test("read-only replay exposes every partial committed bundle and never looks exact", async () => {
  const prepared = await context("owner-dossier-atomic-partial-replay");
  const plan = planFor(prepared);
  const cases = [
    {
      table: "RevenuePrivateKwOwnerDecision",
      column: "id",
      value: plan.ownerDecisionRecordId,
      trigger: "RevenuePrivateKwOwnerDecision_immutable_delete",
      expectedRows: [1, 0, 1],
      disableForeignKeys: false,
    },
    {
      table: "RevenuePrivateKwOwnerAuthMutationOutbox",
      column: "id",
      value: plan.outboxEventId,
      trigger: "RevenuePrivateKwOwnerAuthMutationOutbox_immutable_delete",
      expectedRows: [1, 1, 0],
      disableForeignKeys: false,
    },
    {
      table: "RevenuePrivateKwOwnerAuthIdempotency",
      column: "idempotencyKey",
      value: plan.idempotencyKey,
      trigger: "RevenuePrivateKwOwnerAuthIdempotency_immutable_delete",
      expectedRows: [0, 1, 1],
      disableForeignKeys: true,
    },
  ] as const;

  for (const partial of cases) {
    const database = migratedDatabase();
    insertBusiness(database, prepared.fixture);
    executeTransaction(database, materializeFresh(database, plan));
    const triggerSql = database.prepare(
      `SELECT "sql" FROM "sqlite_master" WHERE "type" = 'trigger' AND "name" = ?`,
    ).pluck().get(partial.trigger);
    if (typeof triggerSql !== "string") throw new Error("Required test trigger is missing.");
    if (partial.disableForeignKeys) database.pragma("foreign_keys = OFF");
    database.exec(`DROP TRIGGER "${partial.trigger}"`);
    database.prepare(
      `DELETE FROM "${partial.table}" WHERE "${partial.column}" = ?`,
    ).run(partial.value);
    database.exec(triggerSql);

    const beforeReplay = database.serialize();
    const replay = executeTransaction(database, plan.replayStatements);
    assert.equal(replay[0]?.rows.length, 9);
    const replayRowCounts = replay.slice(1, 4).map((result) => result.rows.length);
    assert.deepEqual(replayRowCounts, [...partial.expectedRows]);
    assert.equal(replayRowCounts.every((count) => count === 1), false);
    assert.deepEqual(database.serialize(), beforeReplay);
    database.close();
  }
});

test("copied trust, wrong results, session drift, and invalid planning time fail before SQL", async () => {
  const prepared = await context("owner-dossier-atomic-reject");
  const base = {
    boundaryValue: prepared.boundary,
    idempotencyCommitResultValue: prepared.idempotencyCommit,
    ownerDecisionRecordValue: prepared.record,
    currentSessionValue: prepared.session,
    bindingKey: BINDING_KEY,
    bindingKeyVersion: BINDING_KEY_VERSION,
    plannedAt: prepared.plannedAt,
  };
  assert.throws(
    () => buildPrivateKwOwnerDossierAcceptRequestPayload(structuredClone(prepared.record)),
    /exact in-process authenticated owner decision/i,
  );
  assert.throws(
    () => buildPrivateKwOwnerDossierAcceptD1Plan({
      ...base,
      boundaryValue: structuredClone(prepared.boundary),
    }),
    /exact in-process owner-auth server boundary/i,
  );
  assert.throws(
    () => buildPrivateKwOwnerDossierAcceptD1Plan({
      ...base,
      currentSessionValue: { ...prepared.session, authenticatedSessionId: "another-session" },
    }),
    /binding integrity/i,
  );
  for (const plannedAt of [
    "not-a-time",
    "2026-02-30T12:00:00Z",
    prepared.session.sessionExpiresAt,
  ]) {
    assert.throws(() => buildPrivateKwOwnerDossierAcceptD1Plan({ ...base, plannedAt }));
  }

  const wrong = await context("owner-dossier-atomic-wrong-result", { wrongResult: true });
  assert.throws(
    () => buildPrivateKwOwnerDossierAcceptD1Plan({
      boundaryValue: wrong.boundary,
      idempotencyCommitResultValue: wrong.idempotencyCommit,
      ownerDecisionRecordValue: wrong.record,
      currentSessionValue: wrong.session,
      bindingKey: BINDING_KEY,
      bindingKeyVersion: BINDING_KEY_VERSION,
      plannedAt: wrong.plannedAt,
    }),
    /exact boundary, session, decision, request, and idempotency result/i,
  );
});
