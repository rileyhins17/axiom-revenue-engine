import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

import Database from "better-sqlite3";

import {
  artifactReferenceCanonicalJson,
} from "@/lib/revenue-engine/artifact-reference-projection";
import {
  PRIVATE_KW_AUTHENTICATED_OWNER_DECISION_CONFIRMATION,
  PRIVATE_KW_AUTHENTICATED_OWNER_DECISION_DECLARATION_VERSION,
  buildPrivateKwAuthenticatedOwnerDecisionRecord,
  projectPrivateKwAuthenticatedOwnerDecisionStorageRow,
} from "@/lib/revenue-engine/private-kw-authenticated-owner-decision";
import {
  PRIVATE_KW_AUTHENTICATED_OWNER_DECISION_D1_EXECUTOR_VERSION,
  loadPrivateKwAuthenticatedOwnerDecisionD1,
  persistPrivateKwAuthenticatedOwnerDecisionD1,
  requireTrustedPrivateKwAuthenticatedOwnerDecisionD1Result,
  type PrivateKwAuthenticatedOwnerDecisionD1Boundary,
  type PrivateKwAuthenticatedOwnerDecisionD1Statement,
} from "@/lib/revenue-engine/private-kw-authenticated-owner-decision-d1";
import {
  createPrivateKwOwnerDossierProgressFixture,
} from "@/lib/revenue-engine/test-support/private-kw-owner-dossier-progress-fixture";

const BINDING_KEY = Buffer.from(
  "owner-decision-durable-binding-key-v1",
  "utf8",
);
const OTHER_BINDING_KEY = Buffer.from(
  "owner-decision-durable-binding-key-v2",
  "utf8",
);
const KEY_VERSION = "owner-decision-binding-key-v1";

type Fixture = Awaited<ReturnType<typeof createPrivateKwOwnerDossierProgressFixture>>;

function declaration(fixture: Fixture) {
  return {
    declarationVersion: PRIVATE_KW_AUTHENTICATED_OWNER_DECISION_DECLARATION_VERSION,
    dossierDigest: fixture.dossierDigest,
    businessId: fixture.ownerDossier.lead.business.businessId,
    decision: "ACCEPTED_FOR_READ_ONLY_SHADOW_PROGRESS",
    rationale: "The exact synthetic owner dossier is accepted for durable boundary verification.",
    confirmation: PRIVATE_KW_AUTHENTICATED_OWNER_DECISION_CONFIRMATION,
    mode: "SHADOW",
  };
}

function session(fixture: Fixture, overrides: Record<string, unknown> = {}) {
  const decidedAtMs = Date.parse(fixture.acceptance.acceptedAt);
  return {
    sessionContractVersion: "better-auth-owner-session-v1",
    authenticationProvider: "BETTER_AUTH",
    authenticatedUserId: "user-owner-riley-durable-001",
    authenticatedSessionId: "session-owner-riley-durable-001",
    authenticatedEmail: "riley@getaxiom.ca",
    authenticatedEmailVerified: true,
    sessionCreatedAt: new Date(decidedAtMs - 60 * 60_000).toISOString(),
    sessionExpiresAt: new Date(decidedAtMs + 60 * 60_000).toISOString(),
    ...overrides,
  };
}

async function ownerDecisionFixture(
  suffix: string,
  sessionOverrides: Record<string, unknown> = {},
) {
  const fixture = await createPrivateKwOwnerDossierProgressFixture({
    suffix,
    now: new Date(Date.now() - 15 * 60_000),
  });
  const authenticatedSession = session(fixture, sessionOverrides);
  const record = buildPrivateKwAuthenticatedOwnerDecisionRecord({
    manifestValue: fixture.manifest,
    contactReviewProgressCheckpointValue: fixture.contactCheckpoint,
    ownerDossierValue: fixture.ownerDossier,
    declarationValue: declaration(fixture),
    authenticatedSessionValue: authenticatedSession,
  }, {
    bindingKey: BINDING_KEY,
    bindingKeyVersion: KEY_VERSION,
    now: () => new Date(fixture.acceptance.acceptedAt),
  });
  return { fixture, authenticatedSession, record };
}

function migratedDatabase() {
  const database = new Database(":memory:");
  database.pragma("foreign_keys = ON");
  const migrationRoot = new URL("../../../migrations/", import.meta.url);
  const migrations = readdirSync(migrationRoot)
    .filter((name) => /^(005[4-9]|006[0-9])_.*\.sql$/.test(name))
    .sort();
  assert.equal(migrations.at(0)?.startsWith("0054_"), true);
  assert.equal(migrations.at(-1)?.startsWith("0069_"), true);
  assert.equal(migrations.length, 16);
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
      fixture.ownerDossier.lead.business.normalizedDomain,
      fixture.ownerDossier.lead.business.independenceStatus,
      "ACTIVE",
    );
}

function createBoundary(database: Database.Database, options: {
  transform?: (
    statements: readonly PrivateKwAuthenticatedOwnerDecisionD1Statement[],
    results: readonly unknown[],
  ) => readonly unknown[];
} = {}) {
  let calls = 0;
  const seen: PrivateKwAuthenticatedOwnerDecisionD1Statement[][] = [];
  const transaction = database.transaction((
    statements: readonly PrivateKwAuthenticatedOwnerDecisionD1Statement[],
  ) => statements.map((item) => {
    const prepared = database.prepare(item.sql);
    if (prepared.reader) {
      return {
        success: true,
        results: prepared.all(...item.bindings) as Record<string, string | number | null>[],
        changes: 0,
      };
    }
    const result = prepared.run(...item.bindings);
    return { success: true, results: [], changes: result.changes };
  }));
  const boundary: PrivateKwAuthenticatedOwnerDecisionD1Boundary = {
    async batch(statements) {
      calls += 1;
      seen.push([...statements]);
      const results = transaction(statements);
      return options.transform?.(statements, results) ?? results;
    },
  };
  return {
    boundary,
    calls: () => calls,
    seen: () => seen,
  };
}

function countDecisions(database: Database.Database) {
  return (database.prepare(`SELECT COUNT(*) AS "count"
    FROM "RevenuePrivateKwOwnerDecision"`).get() as { count: number }).count;
}

function insertDirectUniqueConflict(
  database: Database.Database,
  record: ReturnType<typeof buildPrivateKwAuthenticatedOwnerDecisionRecord>,
) {
  const conflictingDigest = "f".repeat(64);
  const conflictingRecord = {
    ...structuredClone(record),
    recordId: `kw-owner-decision:${conflictingDigest}`,
    recordDigest: conflictingDigest,
  };
  const projection = {
    ...projectPrivateKwAuthenticatedOwnerDecisionStorageRow(record),
    id: conflictingRecord.recordId,
    decisionDigest: conflictingDigest,
    decisionJson: artifactReferenceCanonicalJson(conflictingRecord),
    recordedAt: record.preparedAt,
    transactionKind: "D1_BATCH",
  };
  const columns = Object.keys(projection);
  database.prepare(`INSERT INTO "RevenuePrivateKwOwnerDecision"
    (${columns.map((column) => `"${column}"`).join(", ")})
    VALUES (${columns.map(() => "?").join(", ")})`)
    .run(...Object.values(projection));
}

const keyDependencies = {
  bindingKey: BINDING_KEY,
  bindingKeyVersion: KEY_VERSION,
};

test("commits, exactly replays, and process-reloads one authenticated owner decision", async () => {
  const { fixture, authenticatedSession, record } = await ownerDecisionFixture(
    "owner-decision-d1-success",
  );
  const database = migratedDatabase();
  insertBusiness(database, fixture);
  const injected = createBoundary(database);

  const committed = await persistPrivateKwAuthenticatedOwnerDecisionD1(
    injected.boundary,
    record,
    authenticatedSession,
    keyDependencies,
  );
  assert.equal(
    committed.executorVersion,
    PRIVATE_KW_AUTHENTICATED_OWNER_DECISION_D1_EXECUTOR_VERSION,
  );
  assert.equal(committed.executionPath, "FRESH_COMMIT");
  assert.equal(committed.record.recordId, record.recordId);
  assert.equal(committed.record.recordDigest, record.recordDigest);
  assert.equal(committed.currentOwnerSessionRechecked, true);
  assert.equal(committed.currentOwnerSessionAtDatabaseClock, true);
  assert.equal(committed.bindingIntegrityVerified, true);
  assert.equal(committed.durableDecisionRecorded, true);
  assert.equal(committed.databaseReadPerformed, true);
  assert.equal(committed.databaseMutationPerformed, true);
  assert.equal(committed.ownerDecisionPersistenceAuthorized, false);
  assert.equal(committed.phaseInputCreationAuthorized, false);
  assert.equal(committed.progressReceiptCreationAuthorized, false);
  assert.equal(committed.phaseAdvancementAuthorized, false);
  assert.equal(committed.outreachAuthorized, false);
  assert.equal(committed.sendAuthorized, false);
  assert.equal(committed.deploymentAuthorized, false);
  assert.equal(committed.providerOperationsAuthorized, 0);
  assert.equal(committed.costAuthorizedUsd, 0);
  assert.equal(Object.isFrozen(committed), true);
  assert.equal(Object.isFrozen(committed.record), true);
  assert.equal(countDecisions(database), 1);
  assert.deepEqual(
    injected.seen()[0]?.map((item) => item.statementId),
    [
      "read:owner_decision_writer_guards",
      "insert:authenticated_owner_decision",
      "read:owner_decision_database_time",
      "read:authenticated_owner_decision",
    ],
    "the verification clock must be sampled after the database-generated recordedAt",
  );

  const replayed = await persistPrivateKwAuthenticatedOwnerDecisionD1(
    injected.boundary,
    record,
    authenticatedSession,
    keyDependencies,
  );
  assert.equal(replayed.executionPath, "EXACT_REPLAY");
  assert.equal(replayed.databaseMutationPerformed, false);
  assert.equal(replayed.record.recordDigest, record.recordDigest);
  assert.equal(countDecisions(database), 1);

  const reloaded = await loadPrivateKwAuthenticatedOwnerDecisionD1(
    injected.boundary,
    { recordId: record.recordId, recordDigest: record.recordDigest },
    keyDependencies,
  );
  assert.equal(reloaded.executionPath, "DURABLE_RELOAD");
  assert.equal(reloaded.currentOwnerSessionRechecked, false);
  assert.equal(reloaded.currentOwnerSessionAtDatabaseClock, false);
  assert.equal(reloaded.bindingIntegrityVerified, true);
  assert.equal(reloaded.databaseMutationPerformed, false);
  assert.equal(
    requireTrustedPrivateKwAuthenticatedOwnerDecisionD1Result(reloaded),
    reloaded,
  );
  assert.throws(
    () => requireTrustedPrivateKwAuthenticatedOwnerDecisionD1Result(
      structuredClone(reloaded),
    ),
    /exact in-process.*durable.*reload/i,
  );
  database.close();
});

test("rejects copied candidates and changed session bindings before database access", async () => {
  const { fixture, authenticatedSession, record } = await ownerDecisionFixture(
    "owner-decision-d1-preflight",
  );
  const database = migratedDatabase();
  insertBusiness(database, fixture);
  const injected = createBoundary(database);

  await assert.rejects(
    persistPrivateKwAuthenticatedOwnerDecisionD1(
      injected.boundary,
      structuredClone(record),
      authenticatedSession,
      keyDependencies,
    ),
    /exact in-process authenticated owner decision/i,
  );
  await assert.rejects(
    persistPrivateKwAuthenticatedOwnerDecisionD1(
      injected.boundary,
      record,
      { ...authenticatedSession, authenticatedSessionId: "changed-session" },
      keyDependencies,
    ),
    /session binding|authenticated owner decision/i,
  );
  await assert.rejects(
    persistPrivateKwAuthenticatedOwnerDecisionD1(
      injected.boundary,
      record,
      { ...authenticatedSession, authenticatedEmailVerified: false },
      keyDependencies,
    ),
    /authenticatedEmailVerified|verified/i,
  );
  await assert.rejects(
    persistPrivateKwAuthenticatedOwnerDecisionD1(
      injected.boundary,
      record,
      { ...authenticatedSession, authenticatedEmail: "intruder@getaxiom.ca" },
      keyDependencies,
    ),
    /authorized Axiom owner|binding/i,
  );
  await assert.rejects(
    persistPrivateKwAuthenticatedOwnerDecisionD1(
      injected.boundary,
      record,
      authenticatedSession,
      { ...keyDependencies, bindingKey: OTHER_BINDING_KEY },
    ),
    /binding integrity|binding/i,
  );
  await assert.rejects(
    persistPrivateKwAuthenticatedOwnerDecisionD1(
      injected.boundary,
      record,
      authenticatedSession,
      { ...keyDependencies, bindingKeyVersion: "owner-decision-binding-key-v2" },
    ),
    /key version|binding/i,
  );
  assert.equal(injected.calls(), 0);
  assert.equal(countDecisions(database), 0);
  database.close();
});

test("database time and writer guards fail closed without leaving a decision row", async () => {
  const shortSessionFixture = await ownerDecisionFixture(
    "owner-decision-d1-expired",
    {
      sessionExpiresAt: new Date(Date.now() - 5 * 60_000).toISOString(),
    },
  );
  const expiredDatabase = migratedDatabase();
  insertBusiness(expiredDatabase, shortSessionFixture.fixture);
  const expiredBoundary = createBoundary(expiredDatabase);
  await assert.rejects(
    persistPrivateKwAuthenticatedOwnerDecisionD1(
      expiredBoundary.boundary,
      shortSessionFixture.record,
      shortSessionFixture.authenticatedSession,
      keyDependencies,
    ),
    /current.*database clock|active.*database clock/i,
  );
  assert.equal(countDecisions(expiredDatabase), 0);
  expiredDatabase.close();

  const { fixture, authenticatedSession, record } = await ownerDecisionFixture(
    "owner-decision-d1-guard",
  );
  const guardDatabase = migratedDatabase();
  insertBusiness(guardDatabase, fixture);
  guardDatabase.exec(`DROP TRIGGER "RevenuePrivateKwOwnerDecision_immutable_update"`);
  const guardBoundary = createBoundary(guardDatabase);
  await assert.rejects(
    persistPrivateKwAuthenticatedOwnerDecisionD1(
      guardBoundary.boundary,
      record,
      authenticatedSession,
      keyDependencies,
    ),
    /every exact migration-0069 writer guard|writer guard/i,
  );
  assert.equal(countDecisions(guardDatabase), 0);
  guardDatabase.close();

  const semanticGuardDatabase = migratedDatabase();
  insertBusiness(semanticGuardDatabase, fixture);
  semanticGuardDatabase.exec(`
    DROP TRIGGER "RevenuePrivateKwOwnerDecision_lineage_insert";
    CREATE TRIGGER "RevenuePrivateKwOwnerDecision_lineage_insert"
    BEFORE INSERT ON "RevenuePrivateKwOwnerDecision"
    BEGIN SELECT 'REVENUE_PRIVATE_KW_OWNER_DECISION_LINEAGE_MISMATCH'; END;
  `);
  const semanticGuardBoundary = createBoundary(semanticGuardDatabase);
  await assert.rejects(
    persistPrivateKwAuthenticatedOwnerDecisionD1(
      semanticGuardBoundary.boundary,
      record,
      authenticatedSession,
      keyDependencies,
    ),
    /writer guard drifted/i,
  );
  assert.equal(countDecisions(semanticGuardDatabase), 0);
  semanticGuardDatabase.close();
});

test("a different row with the same unique proof cannot impersonate an exact replay", async () => {
  const { fixture, authenticatedSession, record } = await ownerDecisionFixture(
    "owner-decision-d1-unique-conflict",
  );
  const database = migratedDatabase();
  insertBusiness(database, fixture);
  insertDirectUniqueConflict(database, record);
  assert.equal(countDecisions(database), 1);

  await assert.rejects(
    persistPrivateKwAuthenticatedOwnerDecisionD1(
      createBoundary(database).boundary,
      record,
      authenticatedSession,
      keyDependencies,
    ),
    /did not commit and reload exactly one durable row/i,
  );
  assert.equal(countDecisions(database), 1);
  database.close();
});

test("durable reload rejects wrong HMAC material, missing rows, and mirrored-row drift", async () => {
  const { fixture, authenticatedSession, record } = await ownerDecisionFixture(
    "owner-decision-d1-reload-guards",
  );
  const database = migratedDatabase();
  insertBusiness(database, fixture);
  const injected = createBoundary(database);
  await persistPrivateKwAuthenticatedOwnerDecisionD1(
    injected.boundary,
    record,
    authenticatedSession,
    keyDependencies,
  );

  await assert.rejects(
    loadPrivateKwAuthenticatedOwnerDecisionD1(
      injected.boundary,
      { recordId: record.recordId, recordDigest: record.recordDigest },
      { ...keyDependencies, bindingKey: OTHER_BINDING_KEY },
    ),
    /binding integrity|HMAC/i,
  );
  await assert.rejects(
    loadPrivateKwAuthenticatedOwnerDecisionD1(
      injected.boundary,
      {
        recordId: `kw-owner-decision:${"0".repeat(64)}`,
        recordDigest: "0".repeat(64),
      },
      keyDependencies,
    ),
    /missing or ambiguous/i,
  );

  const drifted = createBoundary(database, {
    transform(statements, results) {
      return results.map((result, index) => {
        if (statements[index]?.statementId !== "read:authenticated_owner_decision") {
          return result;
        }
        const parsed = result as {
          success: true;
          results: Record<string, string | number | null>[];
          changes: number;
        };
        return {
          ...parsed,
          results: parsed.results.map((row) => ({
            ...row,
            sourceRecordId: "forged-source-record",
          })),
        };
      });
    },
  });
  await assert.rejects(
    loadPrivateKwAuthenticatedOwnerDecisionD1(
      drifted.boundary,
      { recordId: record.recordId, recordDigest: record.recordDigest },
      keyDependencies,
    ),
    /exactly match.*mirrored durable row/i,
  );
  assert.equal(countDecisions(database), 1);
  database.close();
});

test("the injected transaction can mutate only the authenticated owner-decision ledger", async () => {
  const { fixture, authenticatedSession, record } = await ownerDecisionFixture(
    "owner-decision-d1-sql-scope",
  );
  const database = migratedDatabase();
  insertBusiness(database, fixture);
  const injected = createBoundary(database);
  await persistPrivateKwAuthenticatedOwnerDecisionD1(
    injected.boundary,
    record,
    authenticatedSession,
    keyDependencies,
  );

  const firstBatch = injected.seen()[0] ?? [];
  assert.deepEqual(
    firstBatch.map((statement) => statement.statementId),
    [
      "read:owner_decision_writer_guards",
      "insert:authenticated_owner_decision",
      "read:owner_decision_database_time",
      "read:authenticated_owner_decision",
    ],
  );
  const mutationSql = firstBatch
    .filter((statement) => /\b(?:INSERT|UPDATE|DELETE)\b/i.test(statement.sql))
    .map((statement) => statement.sql);
  assert.equal(mutationSql.length, 1);
  assert.match(mutationSql[0] ?? "", /INSERT OR IGNORE INTO "RevenuePrivateKwOwnerDecision"/);
  assert.doesNotMatch(mutationSql[0] ?? "", /\b(?:UPDATE|DELETE)\b/i);
  database.close();
});
