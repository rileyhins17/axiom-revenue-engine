import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

import Database from "better-sqlite3";

import {
  artifactReferenceDigest,
} from "@/lib/revenue-engine/artifact-reference-projection";
import {
  PRIVATE_KW_AUTHENTICATED_OWNER_DECISION_CONFIRMATION,
  PRIVATE_KW_AUTHENTICATED_OWNER_DECISION_DECLARATION_VERSION,
  buildPrivateKwAuthenticatedOwnerDecisionRecord,
} from "@/lib/revenue-engine/private-kw-authenticated-owner-decision";
import {
  PRIVATE_KW_OWNER_DOSSIER_ACCEPT_D1_EXECUTOR_VERSION,
  createPrivateKwOwnerDossierAcceptD1Boundary,
  executePrivateKwOwnerDossierAcceptD1,
  requireInProcessPrivateKwOwnerDossierAcceptD1ExecutionResult,
  type PrivateKwOwnerDossierAcceptD1Boundary,
} from "@/lib/revenue-engine/private-kw-owner-auth-dossier-accept-d1-executor";
import {
  PRIVATE_KW_OWNER_DOSSIER_ACCEPT_OPERATION,
  PRIVATE_KW_OWNER_DOSSIER_ACCEPT_TRIGGER_DEFINITION_DIGESTS,
  buildPrivateKwOwnerDossierAcceptD1Plan,
  buildPrivateKwOwnerDossierAcceptOperationResult,
  buildPrivateKwOwnerDossierAcceptRequestPayload,
  materializePrivateKwOwnerDossierAcceptFreshStatements,
  normalizePrivateKwOwnerAuthTriggerSql,
  type PrivateKwOwnerDossierAcceptD1Statement,
} from "@/lib/revenue-engine/private-kw-owner-auth-dossier-accept-d1-plan";
import {
  commitPrivateKwOwnerAuthIdempotency,
  type PrivateKwOwnerAuthIdempotencyRecord,
  type PrivateKwOwnerAuthIdempotencyStore,
} from "@/lib/revenue-engine/private-kw-owner-auth-idempotency";
import {
  requireInProcessPrivateKwOwnerAuthMutationAffectedRowProof,
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

const BINDING_KEY = Buffer.from("owner-dossier-d1-executor-binding-v1", "utf8");
const BINDING_KEY_VERSION = "owner-dossier-d1-executor-key-v1";

type Fixture = Awaited<ReturnType<typeof createPrivateKwOwnerDossierProgressFixture>>;

function declaration(fixture: Fixture) {
  return {
    declarationVersion: PRIVATE_KW_AUTHENTICATED_OWNER_DECISION_DECLARATION_VERSION,
    dossierDigest: fixture.dossierDigest,
    businessId: fixture.ownerDossier.lead.business.businessId,
    decision: "ACCEPTED_FOR_READ_ONLY_SHADOW_PROGRESS",
    rationale: "The synthetic owner dossier is accepted for disconnected D1 execution verification.",
    confirmation: PRIVATE_KW_AUTHENTICATED_OWNER_DECISION_CONFIRMATION,
    mode: "SHADOW",
  } as const;
}

function ownerSession(fixture: Fixture) {
  const decidedAt = Date.parse(fixture.acceptance.acceptedAt);
  return {
    sessionContractVersion: "better-auth-owner-session-v1",
    authenticationProvider: "BETTER_AUTH",
    authenticatedUserId: "user-riley-owner-dossier-executor",
    authenticatedSessionId: "session-riley-owner-dossier-executor",
    authenticatedEmail: "riley@getaxiom.ca",
    authenticatedEmailVerified: true,
    sessionCreatedAt: new Date(decidedAt - 60 * 60_000).toISOString(),
    sessionExpiresAt: new Date(decidedAt + 60 * 60_000).toISOString(),
  } as const;
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

async function preparedPlan(suffix: string) {
  const fixture = await createPrivateKwOwnerDossierProgressFixture({
    suffix,
    now: new Date(Date.now() - 15 * 60_000),
  });
  const session = ownerSession(fixture);
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
  const payload = buildPrivateKwOwnerDossierAcceptRequestPayload(record);
  const payloadDigest = artifactReferenceDigest(payload);
  const idempotencyKey = `kw-owner-mutation-idempotency:${artifactReferenceDigest({
    boundaryVersion: PRIVATE_KW_OWNER_AUTH_SERVER_BOUNDARY_VERSION,
    owner: "RILEY",
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
      body: { ignoredSessionId: "not-authoritative" },
    },
    operation: PRIVATE_KW_OWNER_DOSSIER_ACCEPT_OPERATION,
    payload,
    idempotencyKey,
  }, { now: () => new Date(decidedAt + 1_000) });
  const commit = await commitPrivateKwOwnerAuthIdempotency({
    boundaryValue: boundary,
    resultValue: buildPrivateKwOwnerDossierAcceptOperationResult(record),
  }, memoryStore(), { now: () => new Date(decidedAt + 2_000) });
  const plan = buildPrivateKwOwnerDossierAcceptD1Plan({
    boundaryValue: boundary,
    idempotencyCommitResultValue: commit,
    ownerDecisionRecordValue: record,
    currentSessionValue: session,
    bindingKey: BINDING_KEY,
    bindingKeyVersion: BINDING_KEY_VERSION,
    plannedAt: new Date(decidedAt + 3_000).toISOString(),
  });
  return { fixture, plan };
}

function migratedDatabase() {
  const database = new Database(":memory:");
  database.pragma("foreign_keys = ON");
  const migrationRoot = new URL("../../../migrations/", import.meta.url);
  const migrations = readdirSync(migrationRoot)
    .filter((name) => /^(005[4-9]|006[0-9]|0070)_.*\.sql$/.test(name))
    .sort();
  migrations.forEach((migration) => {
    database.exec(readFileSync(new URL(migration, migrationRoot), "utf8"));
  });
  return database;
}

function insertBusiness(database: Database.Database, fixture: Fixture) {
  database.prepare(`INSERT INTO "RevenueBusiness"
    ("id", "canonicalName", "normalizedDomain", "independenceStatus", "status")
    VALUES (?, ?, ?, ?, ?)`)
    .run(
      fixture.ownerDossier.lead.business.businessId,
      fixture.ownerDossier.lead.business.canonicalName,
      `${artifactReferenceDigest({ businessId: fixture.ownerDossier.lead.business.businessId }).slice(0, 20)}.example`,
      fixture.ownerDossier.lead.business.independenceStatus,
      "ACTIVE",
    );
}

type PreparedSql = {
  sql: string;
  bindings: readonly unknown[];
  bind(...values: unknown[]): PreparedSql;
};

function preparedSql(sql: string, bindings: readonly unknown[] = []): PreparedSql {
  return {
    sql,
    bindings,
    bind(...values) {
      return preparedSql(sql, values);
    },
  };
}

function sqliteD1(database: Database.Database) {
  return {
    prepare(sql: string) {
      return preparedSql(sql);
    },
    async batch(statements: PreparedSql[]) {
      const run = database.transaction(() => statements.map((item) => {
        const query = database.prepare(item.sql);
        if (query.reader) {
          return {
            success: true as const,
            results: query.all(...item.bindings) as Record<string, string | number | null>[],
            meta: { changes: 0, served_by: "isolated-better-sqlite3" },
          };
        }
        const result = query.run(...item.bindings);
        return {
          success: true as const,
          results: [],
          meta: { changes: result.changes, served_by: "isolated-better-sqlite3" },
        };
      }));
      return run();
    },
  };
}

function sqliteBoundary(database: Database.Database) {
  return createPrivateKwOwnerDossierAcceptD1Boundary(sqliteD1(database));
}

function materializedFreshStatements(
  database: Database.Database,
  plan: Awaited<ReturnType<typeof preparedPlan>>["plan"],
) {
  const row = database.prepare("PRAGMA schema_version").get() as {
    schema_version: number;
  };
  return materializePrivateKwOwnerDossierAcceptFreshStatements(
    plan,
    row.schema_version,
  );
}

function dependencies() {
  return { bindingKey: BINDING_KEY, bindingKeyVersion: BINDING_KEY_VERSION };
}

test("pins the exact nine migration trigger bodies, not merely their names or markers", () => {
  const database = migratedDatabase();
  const rows = database.prepare(
    `SELECT "name", "sql" FROM "sqlite_master"
     WHERE "type" = 'trigger' AND (
       "name" LIKE 'RevenuePrivateKwOwnerDecision_%'
       OR "name" LIKE 'RevenuePrivateKwOwnerAuthIdempotency_%'
       OR "name" LIKE 'RevenuePrivateKwOwnerAuthMutationOutbox_%'
     ) ORDER BY "name"`,
  ).all() as Array<{ name: string; sql: string }>;
  assert.equal(rows.length, 9);
  for (const row of rows) {
    const expected = PRIVATE_KW_OWNER_DOSSIER_ACCEPT_TRIGGER_DEFINITION_DIGESTS[
      row.name as keyof typeof PRIVATE_KW_OWNER_DOSSIER_ACCEPT_TRIGGER_DEFINITION_DIGESTS
    ];
    assert.equal(
      artifactReferenceDigest(normalizePrivateKwOwnerAuthTriggerSql(row.sql)),
      expected,
      row.name,
    );
  }
  database.close();
});

test("commits one exact bundle, then returns a mutation-free exact replay", async () => {
  const { fixture, plan } = await preparedPlan("d1-executor-fresh-replay");
  const database = migratedDatabase();
  insertBusiness(database, fixture);
  const boundary = sqliteBoundary(database);
  const fresh = await executePrivateKwOwnerDossierAcceptD1(boundary, plan, dependencies());
  assert.equal(fresh.executorVersion, PRIVATE_KW_OWNER_DOSSIER_ACCEPT_D1_EXECUTOR_VERSION);
  assert.equal(fresh.executionPath, "FRESH_COMMIT");
  assert.equal(fresh.affectedRowProof.operationRowsAffected, 1);
  assert.equal(fresh.liveD1ExecutionProven, false);
  assert.equal(fresh.runtimeConnected, false);
  assert.equal(fresh.authority.ownerDecisionPersistenceAuthorized, false);
  assert.equal(requireInProcessPrivateKwOwnerDossierAcceptD1ExecutionResult(fresh), fresh);
  assert.equal(
    requireInProcessPrivateKwOwnerAuthMutationAffectedRowProof(fresh.affectedRowProof),
    fresh.affectedRowProof,
  );
  assert.throws(
    () => requireInProcessPrivateKwOwnerDossierAcceptD1ExecutionResult(structuredClone(fresh)),
    /exact in-process/i,
  );

  const beforeReplay = database.serialize();
  const replay = await executePrivateKwOwnerDossierAcceptD1(boundary, plan, dependencies());
  assert.equal(replay.executionPath, "EXACT_REPLAY");
  assert.equal(replay.postErrorReloadPerformed, false);
  assert.equal(replay.affectedRowProof.ownerMutationRowsChanged, 0);
  assert.deepEqual(database.serialize(), beforeReplay);
  database.close();
});

test("a losing stale-preflight race reloads the winner as one exact read-only replay", async () => {
  const { fixture, plan } = await preparedPlan("d1-executor-race");
  const database = migratedDatabase();
  insertBusiness(database, fixture);
  const direct = sqliteBoundary(database);
  let call = 0;
  const racingBoundary: PrivateKwOwnerDossierAcceptD1Boundary = {
    async batch(statements) {
      call += 1;
      if (call === 2) {
        await direct.batch(statements);
        throw new Error("simulated losing reservation race");
      }
      return await direct.batch(statements);
    },
  };
  const result = await executePrivateKwOwnerDossierAcceptD1(
    racingBoundary,
    plan,
    dependencies(),
  );
  assert.equal(call, 3);
  assert.equal(result.executionPath, "EXACT_REPLAY");
  assert.equal(result.postErrorReloadPerformed, true);
  assert.equal(result.affectedRowProof.operationRowsAffected, 0);
  database.close();
});

test("an ambiguous error after commit is recovered only by a new exact reload", async () => {
  const { fixture, plan } = await preparedPlan("d1-executor-ambiguous-commit");
  const database = migratedDatabase();
  insertBusiness(database, fixture);
  const direct = sqliteBoundary(database);
  let call = 0;
  const ambiguousBoundary: PrivateKwOwnerDossierAcceptD1Boundary = {
    async batch(statements) {
      call += 1;
      const result = await direct.batch(statements);
      if (call === 2) throw new Error("simulated response loss after commit");
      return result;
    },
  };
  const result = await executePrivateKwOwnerDossierAcceptD1(
    ambiguousBoundary,
    plan,
    dependencies(),
  );
  assert.equal(result.executionPath, "EXACT_REPLAY");
  assert.equal(result.postErrorReloadPerformed, true);
  database.close();
});

test("a drifted trigger body retaining its name and abort marker fails before mutation", async () => {
  const { fixture, plan } = await preparedPlan("d1-executor-trigger-drift");
  const database = migratedDatabase();
  insertBusiness(database, fixture);
  const name = "RevenuePrivateKwOwnerDecision_immutable_update";
  const original = database.prepare(
    `SELECT "sql" FROM "sqlite_master" WHERE "type" = 'trigger' AND "name" = ?`,
  ).pluck().get(name);
  assert.equal(typeof original, "string");
  database.exec(`DROP TRIGGER "${name}"`);
  database.exec(String(original).replace("BEGIN SELECT", "WHEN 0 BEGIN SELECT"));
  await assert.rejects(
    executePrivateKwOwnerDossierAcceptD1(sqliteBoundary(database), plan, dependencies()),
    /trigger definition drifted/i,
  );
  assert.equal(
    database.prepare(`SELECT COUNT(*) FROM "RevenuePrivateKwOwnerDecision"`).pluck().get(),
    0,
  );
  database.close();
});

test("an unexpected trigger on any guarded table fails the exact preflight", async () => {
  const { fixture, plan } = await preparedPlan("d1-executor-unexpected-trigger");
  const database = migratedDatabase();
  insertBusiness(database, fixture);
  database.exec(`CREATE TRIGGER "RevenuePrivateKwOwnerDecision_unreviewed_extra"
    BEFORE UPDATE ON "RevenuePrivateKwOwnerDecision"
    BEGIN SELECT RAISE(ABORT, 'UNREVIEWED_EXTRA_TRIGGER'); END`);
  await assert.rejects(
    executePrivateKwOwnerDossierAcceptD1(sqliteBoundary(database), plan, dependencies()),
    /unexpected target-table triggers are forbidden/i,
  );
  assert.equal(
    database.prepare(`SELECT COUNT(*) FROM "RevenuePrivateKwOwnerDecision"`).pluck().get(),
    0,
  );
  database.close();
});

test("schema drift after preflight fences the fresh write and the recovery reload", async () => {
  const { fixture, plan } = await preparedPlan("d1-executor-schema-race");
  const database = migratedDatabase();
  insertBusiness(database, fixture);
  const direct = sqliteBoundary(database);
  let call = 0;
  const boundary: PrivateKwOwnerDossierAcceptD1Boundary = {
    async batch(statements) {
      call += 1;
      if (call === 2) {
        database.exec(`CREATE TRIGGER "RevenuePrivateKwOwnerDecision_raced_extra"
          BEFORE UPDATE ON "RevenuePrivateKwOwnerDecision"
          BEGIN SELECT RAISE(ABORT, 'RACED_EXTRA_TRIGGER'); END`);
      }
      return await direct.batch(statements);
    },
  };
  await assert.rejects(
    executePrivateKwOwnerDossierAcceptD1(boundary, plan, dependencies()),
    /fresh owner action failed|unexpected target-table triggers are forbidden/i,
  );
  assert.equal(call, 3);
  for (const table of [
    "RevenuePrivateKwOwnerDecision",
    "RevenuePrivateKwOwnerAuthIdempotency",
    "RevenuePrivateKwOwnerAuthMutationOutbox",
  ]) {
    assert.equal(database.prepare(`SELECT COUNT(*) FROM "${table}"`).pluck().get(), 0);
  }
  database.close();
});

test("trigger type and owning-table metadata are part of the exact definition", async () => {
  for (const drift of [
    { type: "table" },
    { tbl_name: "RevenuePrivateKwOwnerAuthMutationOutbox" },
  ]) {
    const { fixture, plan } = await preparedPlan(
      `d1-executor-trigger-metadata-${Object.keys(drift)[0]}`,
    );
    const database = migratedDatabase();
    insertBusiness(database, fixture);
    const direct = sqliteBoundary(database);
    const boundary: PrivateKwOwnerDossierAcceptD1Boundary = {
      async batch(statements) {
        const raw = await direct.batch(statements);
        const triggerResult = raw[0] as {
          results: Array<Record<string, unknown>>;
        };
        return [
          {
            ...triggerResult,
            results: triggerResult.results.map((row, index) =>
              index === 0 ? { ...row, ...drift } : row),
          },
          ...raw.slice(1),
        ];
      },
    };
    await assert.rejects(
      executePrivateKwOwnerDossierAcceptD1(boundary, plan, dependencies()),
    );
    assert.equal(
      database.prepare(`SELECT COUNT(*) FROM "RevenuePrivateKwOwnerDecision"`).pluck().get(),
      0,
    );
    database.close();
  }
});

test("documented null mutation result arrays normalize to empty arrays", async () => {
  const { fixture, plan } = await preparedPlan("d1-executor-null-mutation-results");
  const database = migratedDatabase();
  insertBusiness(database, fixture);
  const direct = sqliteBoundary(database);
  let call = 0;
  const boundary: PrivateKwOwnerDossierAcceptD1Boundary = {
    async batch(statements) {
      call += 1;
      const raw = await direct.batch(statements);
      if (call !== 2) return raw;
      return raw.map((item, index) => {
        if (index > 3 || !item || typeof item !== "object") return item;
        return { ...item, results: null };
      });
    },
  };
  const result = await executePrivateKwOwnerDossierAcceptD1(
    boundary,
    plan,
    dependencies(),
  );
  assert.equal(result.executionPath, "FRESH_COMMIT");
  database.close();
});

test("the complete durable timestamp order is required on exact replay", async () => {
  const { fixture, plan } = await preparedPlan("d1-executor-full-chronology");
  const database = migratedDatabase();
  insertBusiness(database, fixture);
  const direct = sqliteBoundary(database);
  await executePrivateKwOwnerDossierAcceptD1(direct, plan, dependencies());
  const chronologyBoundary: PrivateKwOwnerDossierAcceptD1Boundary = {
    async batch(statements) {
      const raw = await direct.batch(statements);
      const idempotencyResult = raw[1] as {
        results: Array<Record<string, string | number | null>>;
      };
      const decisionResult = raw[2] as {
        results: Array<Record<string, string | number | null>>;
      };
      const timeResult = raw[4] as {
        results: Array<Record<string, string | number | null>>;
      };
      const committedAt = String(idempotencyResult.results[0]?.committedAt);
      const driftedDecisionAt = new Date(Date.parse(committedAt) + 1_000).toISOString();
      const laterDatabaseNow = new Date(Date.parse(committedAt) + 2_000).toISOString();
      return raw.map((item, index) => {
        if (index === 2) {
          return {
            ...decisionResult,
            results: decisionResult.results.map((row) => ({
              ...row,
              recordedAt: driftedDecisionAt,
            })),
          };
        }
        if (index === 4) {
          return {
            ...timeResult,
            results: timeResult.results.map((row) => ({
              ...row,
              databaseNow: laterDatabaseNow,
            })),
          };
        }
        return item;
      });
    },
  };
  await assert.rejects(
    executePrivateKwOwnerDossierAcceptD1(chronologyBoundary, plan, dependencies()),
    /chronology is invalid/i,
  );
  database.close();
});

test("RESERVED and partial durable states fail closed", async () => {
  const { fixture, plan } = await preparedPlan("d1-executor-reserved");
  const database = migratedDatabase();
  insertBusiness(database, fixture);
  const boundary = sqliteBoundary(database);
  const freshStatements = materializedFreshStatements(database, plan);
  await boundary.batch([freshStatements[0] as PrivateKwOwnerDossierAcceptD1Statement]);
  await assert.rejects(
    executePrivateKwOwnerDossierAcceptD1(boundary, plan, dependencies()),
    /remains RESERVED/i,
  );
  database.close();

  const partialPrepared = await preparedPlan("d1-executor-partial");
  const partialDatabase = migratedDatabase();
  insertBusiness(partialDatabase, partialPrepared.fixture);
  const partialBoundary = sqliteBoundary(partialDatabase);
  const partialFreshStatements = materializedFreshStatements(
    partialDatabase,
    partialPrepared.plan,
  );
  await partialBoundary.batch([
    partialFreshStatements[0] as PrivateKwOwnerDossierAcceptD1Statement,
    partialFreshStatements[1] as PrivateKwOwnerDossierAcceptD1Statement,
  ]);
  await assert.rejects(
    executePrivateKwOwnerDossierAcceptD1(
      partialBoundary,
      partialPrepared.plan,
      dependencies(),
    ),
    /invalid partial durable bundle/i,
  );
  partialDatabase.close();
});

test("wrong affected-row metadata is never reported as a fresh commit", async () => {
  const { fixture, plan } = await preparedPlan("d1-executor-metadata");
  const database = migratedDatabase();
  insertBusiness(database, fixture);
  const direct = sqliteBoundary(database);
  let call = 0;
  const boundary: PrivateKwOwnerDossierAcceptD1Boundary = {
    async batch(statements) {
      call += 1;
      const raw = await direct.batch(statements);
      if (call !== 2) return raw;
      return raw.map((item, index) => {
        if (index !== 0 || !item || typeof item !== "object") return item;
        const result = item as { meta: Record<string, unknown> };
        return { ...result, meta: { ...result.meta, changes: 0 } };
      });
    },
  };
  const result = await executePrivateKwOwnerDossierAcceptD1(boundary, plan, dependencies());
  assert.equal(result.executionPath, "EXACT_REPLAY");
  assert.equal(result.postErrorReloadPerformed, true);
  assert.equal(result.affectedRowProof.idempotencyRowsInserted, 0);
  database.close();
});

test("malformed boundary responses and wrong binding material cannot prove success", async () => {
  const { fixture, plan } = await preparedPlan("d1-executor-malformed");
  const database = migratedDatabase();
  insertBusiness(database, fixture);
  const direct = sqliteBoundary(database);
  const malformed: PrivateKwOwnerDossierAcceptD1Boundary = {
    async batch(statements) {
      const raw = await direct.batch(statements);
      return raw.slice(0, -1);
    },
  };
  await assert.rejects(
    executePrivateKwOwnerDossierAcceptD1(malformed, plan, dependencies()),
    /returned 4 results/i,
  );
  await assert.rejects(
    executePrivateKwOwnerDossierAcceptD1(sqliteBoundary(database), plan, {
      bindingKey: Buffer.from("wrong-owner-binding-material", "utf8"),
      bindingKeyVersion: BINDING_KEY_VERSION,
    }),
    /binding/i,
  );
  database.close();
});
