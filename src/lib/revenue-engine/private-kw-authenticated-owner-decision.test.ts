import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

import Database from "better-sqlite3";

import {
  PRIVATE_KW_AUTHENTICATED_OWNER_DECISION_CONFIRMATION,
  PRIVATE_KW_AUTHENTICATED_OWNER_DECISION_DECLARATION_VERSION,
  PRIVATE_KW_AUTHENTICATED_OWNER_DECISION_RECORD_VERSION,
  PrivateKwAuthenticatedOwnerDecisionRecordSchema,
  buildPrivateKwAuthenticatedOwnerDecisionRecord,
  projectPrivateKwAuthenticatedOwnerDecisionStorageRow,
  requireInProcessPrivateKwAuthenticatedOwnerDecisionRecord,
} from "@/lib/revenue-engine/private-kw-authenticated-owner-decision";
import {
  createPrivateKwOwnerDossierProgressFixture,
} from "@/lib/revenue-engine/test-support/private-kw-owner-dossier-progress-fixture";

const BINDING_KEY = Buffer.from(
  "owner-decision-contract-binding-key-01",
  "utf8",
);
const OTHER_BINDING_KEY = Buffer.from(
  "owner-decision-contract-binding-key-02",
  "utf8",
);

type Fixture = Awaited<ReturnType<typeof createPrivateKwOwnerDossierProgressFixture>>;

function declaration(fixture: Fixture, overrides: Record<string, unknown> = {}) {
  return {
    declarationVersion: PRIVATE_KW_AUTHENTICATED_OWNER_DECISION_DECLARATION_VERSION,
    dossierDigest: fixture.dossierDigest,
    businessId: fixture.ownerDossier.lead.business.businessId,
    decision: "ACCEPTED_FOR_READ_ONLY_SHADOW_PROGRESS",
    rationale: "The exact evidence and lead context are strong enough for read-only shadow progress.",
    confirmation: PRIVATE_KW_AUTHENTICATED_OWNER_DECISION_CONFIRMATION,
    mode: "SHADOW",
    ...overrides,
  };
}

function session(fixture: Fixture, overrides: Record<string, unknown> = {}) {
  const decidedAtMs = Date.parse(fixture.acceptance.acceptedAt);
  return {
    sessionContractVersion: "better-auth-owner-session-v1",
    authenticationProvider: "BETTER_AUTH",
    authenticatedUserId: "user-owner-riley-001",
    authenticatedSessionId: "session-owner-riley-001",
    authenticatedEmail: "  RILEY@GETAXIOM.CA ",
    authenticatedEmailVerified: true,
    sessionCreatedAt: new Date(decidedAtMs - 60 * 60_000).toISOString(),
    sessionExpiresAt: new Date(decidedAtMs + 60 * 60_000).toISOString(),
    ...overrides,
  };
}

function buildRecord(
  fixture: Fixture,
  options: {
    declarationValue?: unknown;
    sessionValue?: unknown;
    key?: Uint8Array;
    keyVersion?: string;
    now?: Date;
    manifestValue?: unknown;
    parentValue?: unknown;
    dossierValue?: unknown;
  } = {},
) {
  return buildPrivateKwAuthenticatedOwnerDecisionRecord({
    manifestValue: options.manifestValue ?? fixture.manifest,
    contactReviewProgressCheckpointValue: options.parentValue ?? fixture.contactCheckpoint,
    ownerDossierValue: options.dossierValue ?? fixture.ownerDossier,
    declarationValue: options.declarationValue ?? declaration(fixture),
    authenticatedSessionValue: options.sessionValue ?? session(fixture),
  }, {
    bindingKey: options.key ?? BINDING_KEY,
    bindingKeyVersion: options.keyVersion ?? "owner-decision-binding-key-v1",
    now: () => options.now ?? new Date(fixture.acceptance.acceptedAt),
  });
}

test("derives one content-addressed owner decision from the exact dossier and current session", async () => {
  const fixture = await createPrivateKwOwnerDossierProgressFixture({
    suffix: "authenticated-owner-decision",
  });
  const record = buildRecord(fixture);

  assert.equal(record.recordVersion, PRIVATE_KW_AUTHENTICATED_OWNER_DECISION_RECORD_VERSION);
  assert.equal(record.recordKind, "AUTHENTICATED_OWNER_DOSSIER_DECISION");
  assert.equal(record.recordId, `kw-owner-decision:${record.recordDigest}`);
  assert.equal(record.manifestId, fixture.manifest.manifestId);
  assert.equal(record.manifestDigest, fixture.manifest.manifestDigest);
  assert.equal(record.businessId, fixture.ownerDossier.lead.business.businessId);
  assert.equal(record.parentCheckpoint.checkpointId, fixture.contactCheckpoint.checkpointId);
  assert.equal(record.parentCheckpoint.checkpointDigest, fixture.contactCheckpoint.checkpointDigest);
  assert.equal(record.ownerDossier.dossierDigest, fixture.dossierDigest);
  assert.equal(record.ownerDossier.websiteSnapshotId, fixture.ownerDossier.website.snapshotId);
  assert.equal(
    record.ownerDossier.qualificationSnapshotId,
    fixture.ownerDossier.lead.qualification.snapshotId,
  );
  assert.equal(
    record.acceptanceProof.previousPhaseReceipt.contactInvocationId,
    fixture.invocation.invocationId,
  );
  assert.equal(record.decision.decidedBy, "RILEY");
  assert.equal(record.decision.decidedAt, fixture.acceptance.acceptedAt);
  assert.equal(record.authentication.authenticationProvider, "BETTER_AUTH");
  assert.equal(record.authentication.emailVerified, true);
  assert.equal(record.authentication.authorizationSource, "EXPLICIT_AXIOM_OWNER_EMAIL_ALLOWLIST");
  assert.equal(record.authentication.bindingKeyVersion, "owner-decision-binding-key-v1");
  assert.match(record.authentication.subjectBindingDigest, /^[a-f0-9]{64}$/);
  assert.match(record.authentication.sessionBindingDigest, /^[a-f0-9]{64}$/);
  assert.match(record.authentication.decisionBindingDigest, /^[a-f0-9]{64}$/);
  assert.notEqual(
    record.authentication.subjectBindingDigest,
    record.authentication.sessionBindingDigest,
  );
  assert.notEqual(
    record.authentication.sessionBindingDigest,
    record.authentication.decisionBindingDigest,
  );
  assert.equal(record.authority.contractValidationOnly, true);
  assert.equal(record.authority.currentOwnerSessionRequiredAtFutureWrite, true);
  assert.equal(record.authority.durableDecisionRecorded, false);
  assert.equal(record.authority.ownerDecisionPersistenceAuthorized, false);
  assert.equal(record.authority.phaseInputCreationAuthorized, false);
  assert.equal(record.authority.progressReceiptCreationAuthorized, false);
  assert.equal(record.authority.phaseAdvancementAuthorized, false);
  assert.equal(record.authority.databaseReadAuthorized, false);
  assert.equal(record.authority.databaseMutationAuthorized, false);
  assert.equal(record.authority.outreachAuthorized, false);
  assert.equal(record.authority.sendAuthorized, false);
  assert.equal(record.authority.deploymentAuthorized, false);
  assert.equal(record.authority.providerOperationsAuthorized, 0);
  assert.equal(record.authority.costAuthorizedUsd, 0);
  assert.equal(Object.isFrozen(record), true);
  assert.equal(Object.isFrozen(record.acceptanceProof), true);
  assert.equal(Object.isFrozen(record.authentication), true);
  assert.equal(requireInProcessPrivateKwAuthenticatedOwnerDecisionRecord(record), record);
  assert.deepEqual(PrivateKwAuthenticatedOwnerDecisionRecordSchema.parse(record), record);

  const serialized = JSON.stringify(record);
  assert.doesNotMatch(serialized, /user-owner-riley-001/i);
  assert.doesNotMatch(serialized, /session-owner-riley-001/i);
  assert.doesNotMatch(serialized, /riley@getaxiom\.ca/i);

  const exactRetry = buildRecord(fixture);
  assert.equal(exactRetry.recordId, record.recordId);
  assert.equal(exactRetry.recordDigest, record.recordDigest);
});

test("derives Aidan from the authenticated owner identity and never accepts client-selected identity or time", async () => {
  const fixture = await createPrivateKwOwnerDossierProgressFixture({
    suffix: "authenticated-owner-aidan",
  });
  const record = buildRecord(fixture, {
    sessionValue: session(fixture, {
      authenticatedUserId: "user-owner-aidan-001",
      authenticatedSessionId: "session-owner-aidan-001",
      authenticatedEmail: "aidan@getaxiom.ca",
    }),
  });
  assert.equal(record.decision.decidedBy, "AIDAN");
  assert.equal(record.decision.decidedAt, fixture.acceptance.acceptedAt);

  assert.throws(() => buildRecord(fixture, {
    declarationValue: {
      ...declaration(fixture),
      decidedBy: "RILEY",
    },
  }), /unrecognized key|decidedBy/i);
  assert.throws(() => buildRecord(fixture, {
    declarationValue: {
      ...declaration(fixture),
      decidedAt: fixture.acceptance.acceptedAt,
    },
  }), /unrecognized key|decidedAt/i);
});

test("rejects unauthorized identities, inactive sessions, and weak or changed binding keys", async () => {
  const fixture = await createPrivateKwOwnerDossierProgressFixture({
    suffix: "authenticated-owner-session-guards",
  });
  const decidedAtMs = Date.parse(fixture.acceptance.acceptedAt);

  assert.throws(() => buildRecord(fixture, {
    sessionValue: session(fixture, { authenticatedEmail: "intruder@getaxiom.ca" }),
  }), /authorized Axiom owner/i);
  assert.throws(() => buildRecord(fixture, {
    sessionValue: session(fixture, { authenticatedEmailVerified: false }),
  }), /authenticatedEmailVerified|true/i);
  assert.throws(() => buildRecord(fixture, {
    sessionValue: session(fixture, {
      sessionCreatedAt: new Date(decidedAtMs + 1).toISOString(),
    }),
  }), /active at the decision time/i);
  assert.throws(() => buildRecord(fixture, {
    sessionValue: session(fixture, {
      sessionExpiresAt: new Date(decidedAtMs).toISOString(),
    }),
  }), /active at the decision time/i);
  assert.throws(() => buildRecord(fixture, {
    key: Buffer.from("too-short", "utf8"),
  }), /at least 32 bytes/i);
  assert.throws(() => buildRecord(fixture, {
    keyVersion: "invalid key version",
  }), /bindingKeyVersion|Invalid string/i);

  const first = buildRecord(fixture);
  const anotherKey = buildRecord(fixture, { key: OTHER_BINDING_KEY });
  assert.notEqual(first.recordDigest, anotherKey.recordDigest);
  assert.notEqual(
    first.authentication.sessionBindingDigest,
    anotherKey.authentication.sessionBindingDigest,
  );
});

test("rejects copied provenance, another parent or manifest, and dossier-window drift", async () => {
  const fixture = await createPrivateKwOwnerDossierProgressFixture({
    suffix: "authenticated-owner-provenance",
  });
  const other = await createPrivateKwOwnerDossierProgressFixture({
    suffix: "authenticated-owner-other",
  });

  assert.throws(() => buildRecord(fixture, {
    dossierValue: structuredClone(fixture.ownerDossier),
  }), /exact in-process owner lead detail response/i);
  assert.throws(() => buildRecord(fixture, {
    parentValue: structuredClone(fixture.contactCheckpoint),
  }), /exact in-process result/i);
  assert.throws(() => buildRecord(fixture, {
    manifestValue: other.manifest,
  }), /exact manifest-bound contact-review checkpoint/i);
  assert.throws(() => buildRecord(fixture, {
    now: new Date(Date.parse(fixture.ownerDossier.generatedAt) + 5 * 60_000 + 1),
  }), /within five minutes/i);

  const record = buildRecord(fixture);
  assert.throws(
    () => requireInProcessPrivateKwAuthenticatedOwnerDecisionRecord(structuredClone(record)),
    /exact in-process authenticated owner decision/i,
  );
  assert.throws(
    () => PrivateKwAuthenticatedOwnerDecisionRecordSchema.parse({
      ...structuredClone(record),
      recordDigest: "0".repeat(64),
    }),
    /identity must bind/i,
  );
});

function migratedDatabase() {
  const database = new Database(":memory:");
  database.pragma("foreign_keys = ON");
  const migrationRoot = new URL("../../../migrations/", import.meta.url);
  const migrations = readdirSync(migrationRoot)
    .filter((name) => /^(005[4-9]|006[0-9])_.*\.sql$/.test(name))
    .sort();
  assert.equal(migrations.at(0)?.startsWith("0054_"), true);
  assert.equal(migrations.at(-1)?.startsWith("0069_"), true);
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

function insertDecision(
  database: Database.Database,
  record: ReturnType<typeof buildRecord>,
  overrides: Record<string, string | number> = {},
) {
  const projection = {
    ...projectPrivateKwAuthenticatedOwnerDecisionStorageRow(record),
    recordedAt: record.preparedAt,
    transactionKind: "D1_BATCH",
    ...overrides,
  };
  const columns = Object.keys(projection);
  database.prepare(`INSERT INTO "RevenuePrivateKwOwnerDecision"
    (${columns.map((column) => `"${column}"`).join(", ")})
    VALUES (${columns.map(() => "?").join(", ")})`)
    .run(...Object.values(projection));
}

test("migration 0069 stores only exact mirrored records and keeps the owner ledger append-only", async () => {
  const fixture = await createPrivateKwOwnerDossierProgressFixture({
    suffix: "authenticated-owner-migration",
  });
  const record = buildRecord(fixture);
  const database = migratedDatabase();
  insertBusiness(database, fixture);

  insertDecision(database, record);
  const stored = database.prepare(`SELECT * FROM "RevenuePrivateKwOwnerDecision"
    WHERE "id" = ?`).get(record.recordId) as Record<string, unknown>;
  assert.equal(stored.id, record.recordId);
  assert.equal(stored.decisionDigest, record.recordDigest);
  assert.equal(stored.acceptanceProofId, record.acceptanceProof.proofId);
  assert.equal(stored.authSessionBindingDigest, record.authentication.sessionBindingDigest);
  assert.equal(stored.decidedBy, "RILEY");
  assert.equal(stored.ownerDecisionPersistenceAuthorized, 0);
  assert.equal(stored.phaseAdvancementAuthorized, 0);
  assert.equal(stored.outreachAuthorized, 0);
  assert.equal(stored.sendAuthorized, 0);
  assert.equal(stored.providerOperationsAuthorized, 0);
  assert.equal(stored.costAuthorizedUsd, 0);
  assert.deepEqual(JSON.parse(String(stored.decisionJson)), record);

  assert.throws(
    () => database.prepare(`UPDATE "RevenuePrivateKwOwnerDecision"
      SET "preparedAt" = "preparedAt" WHERE "id" = ?`).run(record.recordId),
    /REVENUE_PRIVATE_KW_OWNER_DECISION_APPEND_ONLY/i,
  );
  assert.throws(
    () => database.prepare(`DELETE FROM "RevenuePrivateKwOwnerDecision"
      WHERE "id" = ?`).run(record.recordId),
    /REVENUE_PRIVATE_KW_OWNER_DECISION_APPEND_ONLY/i,
  );
  database.close();

  const driftedJsonDatabase = migratedDatabase();
  insertBusiness(driftedJsonDatabase, fixture);
  assert.throws(
    () => insertDecision(driftedJsonDatabase, record, {
      decisionJson: JSON.stringify({ ...record, businessId: "business-forged" }),
    }),
    /REVENUE_PRIVATE_KW_OWNER_DECISION_LINEAGE_MISMATCH/i,
  );
  driftedJsonDatabase.close();

  const authorityDatabase = migratedDatabase();
  insertBusiness(authorityDatabase, fixture);
  assert.throws(
    () => insertDecision(authorityDatabase, record, { sendAuthorized: 1 }),
    /CHECK constraint failed/i,
  );
  authorityDatabase.close();

  const jsonAuthorityDatabase = migratedDatabase();
  insertBusiness(jsonAuthorityDatabase, fixture);
  for (const [field, forbiddenValue] of [
    ["contractValidationOnly", false],
    ["fileReadAuthorized", true],
    ["fileMutationAuthorized", true],
    ["browserCaptureAuthorized", true],
    ["contactDiscoveryExecutionAuthorized", true],
    ["contactVerificationExecutionAuthorized", true],
    ["consentDecisionAuthorized", true],
    ["qualificationAuthorized", true],
    ["mailboxSyncAuthorized", true],
  ] as const) {
    const drifted = structuredClone(record) as unknown as {
      authority: Record<string, unknown>;
    };
    drifted.authority[field] = forbiddenValue;
    assert.throws(
      () => insertDecision(jsonAuthorityDatabase, record, {
        decisionJson: JSON.stringify(drifted),
      }),
      /REVENUE_PRIVATE_KW_OWNER_DECISION_LINEAGE_MISMATCH/i,
      `database trigger must reject authority drift in ${field}`,
    );
  }
  jsonAuthorityDatabase.close();

  const invalidTimestampDatabase = migratedDatabase();
  insertBusiness(invalidTimestampDatabase, fixture);
  assert.throws(
    () => insertDecision(invalidTimestampDatabase, record, {
      recordedAt: "not-a-database-timestamp",
    }),
    /CHECK constraint failed/i,
  );
  invalidTimestampDatabase.close();
});
