import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";

import { artifactReferenceDigest } from "@/lib/revenue-engine/artifact-reference-projection";
import { buildPrivateKwOwnerAuthReadiness } from "@/lib/revenue-engine/private-kw-owner-auth-readiness";
import { buildPrivateKwOwnerAuthServerBoundary } from "@/lib/revenue-engine/private-kw-owner-auth-server-boundary";
import {
  buildPrivateKwOwnerAuthOperationClaim,
  buildPrivateKwOwnerAuthReservationObservation,
  classifyPrivateKwOwnerAuthReservation,
  PRIVATE_KW_OWNER_AUTH_MUTATION_CLAIM_EXISTS_PREDICATE,
} from "@/lib/revenue-engine/private-kw-owner-auth-idempotency-recovery";
import {
  buildPrivateKwOwnerAuthAbandonmentReceipt,
  buildPrivateKwOwnerAuthMutationAffectedRowProof,
  buildPrivateKwOwnerAuthRecoveryRetentionPolicy,
  PRIVATE_KW_OWNER_AUTH_RECOVERY_MAX_RETENTION_MS,
  PRIVATE_KW_OWNER_AUTH_RECOVERY_MIN_RETENTION_MS,
  requireInProcessPrivateKwOwnerAuthAbandonmentReceipt,
  requireInProcessPrivateKwOwnerAuthMutationAffectedRowProof,
  requireInProcessPrivateKwOwnerAuthRecoveryRetentionPolicy,
} from "@/lib/revenue-engine/private-kw-owner-auth-idempotency-recovery-proof";

function boundary() {
  const payload = { dossierDigest: "d".repeat(64), decision: "ACCEPTED" };
  const payloadDigest = artifactReferenceDigest(payload);
  const idempotencyKey = `kw-owner-mutation-idempotency:${artifactReferenceDigest({
    boundaryVersion: "kw-owner-auth-server-boundary-v1",
    owner: "RILEY",
    operation: "owner.dossier.accept",
    payloadDigest,
  })}`;
  return buildPrivateKwOwnerAuthServerBoundary({
    readinessValue: buildPrivateKwOwnerAuthReadiness({
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
      checkedAt: "2026-09-03T12:00:00.000Z",
    }),
    serverSessionValue: {
      sessionContractVersion: "better-auth-owner-session-v1",
      authenticationProvider: "BETTER_AUTH",
      authenticatedUserId: "user-riley-private",
      authenticatedSessionId: "session-riley-private",
      authenticatedEmail: "riley@getaxiom.ca",
      authenticatedEmailVerified: true,
      sessionCreatedAt: "2026-09-03T11:00:00.000Z",
      sessionExpiresAt: "2026-09-03T19:00:00.000Z",
    },
    request: {
      method: "POST",
      origin: "https://revenue.getaxiom.ca",
      headers: {
        Origin: "https://revenue.getaxiom.ca",
        "Sec-Fetch-Site": "same-origin",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Dest": "empty",
      },
      body: { sessionId: "ignored" },
    },
    operation: "owner.dossier.accept",
    payload,
    idempotencyKey,
  }, { now: () => new Date("2026-09-03T12:30:00.000Z") });
}

function claim() {
  const ownerBoundary = boundary();
  return buildPrivateKwOwnerAuthOperationClaim({
    boundaryValue: ownerBoundary,
    mutationKind: "UPDATE",
    targetTable: "RevenuePrivateKwOwnerAction",
    sql: `UPDATE "RevenuePrivateKwOwnerAction"
      SET "decision" = ?
      WHERE "id" = ? AND ${PRIVATE_KW_OWNER_AUTH_MUTATION_CLAIM_EXISTS_PREDICATE}`,
  });
}

function observationAndDecision() {
  const ownerBoundary = boundary();
  const observation = buildPrivateKwOwnerAuthReservationObservation({
    boundaryValue: ownerBoundary,
    state: "RESERVED",
    reservedAt: "2026-09-03T12:30:00.000Z",
    databaseNow: "2026-09-03T12:32:00.000Z",
    recordId: null,
    resultAvailable: false,
  });
  return {
    observation,
    decision: classifyPrivateKwOwnerAuthReservation(observation),
  };
}

test("abandonment receipts are append-only, content-addressed, and never issue a replacement key", () => {
  const { observation, decision } = observationAndDecision();
  const receipt = buildPrivateKwOwnerAuthAbandonmentReceipt({
    observationValue: observation,
    decisionValue: decision,
    abandonmentReason: "OPERATION_TIMEOUT",
    recordedAt: "2026-09-03T12:32:01.000Z",
  });
  assert.equal(receipt.recoveryState, "ABANDONED");
  assert.equal(receipt.recoveryAction, "BLOCK_STALE_RESERVED");
  assert.equal(receipt.replacementKey, null);
  assert.equal(receipt.sameKeyReuseAllowed, false);
  assert.equal(receipt.retention.originalReservationPreserved, true);
  assert.equal(receipt.retention.recoveryReceiptAppendOnly, true);
  assert.equal(receipt.retention.minimumRetentionMs, PRIVATE_KW_OWNER_AUTH_RECOVERY_MIN_RETENTION_MS);
  assert.equal(receipt.retention.maximumRetentionMs, PRIVATE_KW_OWNER_AUTH_RECOVERY_MAX_RETENTION_MS);
  assert.equal(receipt.authority.databaseMutationAuthorized, false);
  assert.equal(receipt.authority.costAuthorizedUsd, 0);
  assert.equal(Object.isFrozen(receipt), true);
  assert.equal(requireInProcessPrivateKwOwnerAuthAbandonmentReceipt(receipt), receipt);
  assert.throws(
    () => requireInProcessPrivateKwOwnerAuthAbandonmentReceipt(structuredClone(receipt)),
    /exact in-process owner-auth abandonment receipt/i,
  );
  assert.throws(
    () => buildPrivateKwOwnerAuthAbandonmentReceipt({
      observationValue: observation,
      decisionValue: decision,
      abandonmentReason: "MANUAL_STOP",
      recordedAt: "2026-09-03T12:31:59.999Z",
    }),
    /cannot be recorded before/i,
  );
  for (const recordedAt of ["2026-09-03T12:32:00+99:99", "2026-02-30T12:32:00Z", "not-a-time"]) {
    assert.throws(() => buildPrivateKwOwnerAuthAbandonmentReceipt({
      observationValue: observation, decisionValue: decision,
      abandonmentReason: "UNKNOWN_WRITER", recordedAt,
    }));
  }
});

test("recovery receipts reject copied or committed trust and retention policy remains validation-only", () => {
  const { observation, decision } = observationAndDecision();
  const clonedObservation = structuredClone(observation);
  assert.throws(
    () => buildPrivateKwOwnerAuthAbandonmentReceipt({
      observationValue: clonedObservation,
      decisionValue: decision,
      abandonmentReason: "UNKNOWN_WRITER",
      recordedAt: "2026-09-03T12:32:01.000Z",
    }),
    /exact in-process owner-auth reservation observation/i,
  );
  const policy = buildPrivateKwOwnerAuthRecoveryRetentionPolicy();
  assert.equal(requireInProcessPrivateKwOwnerAuthRecoveryRetentionPolicy(policy), policy);
  const otherObservation = buildPrivateKwOwnerAuthReservationObservation({
    boundaryValue: boundary(), state: "RESERVED", recordId: null, resultAvailable: false,
    reservedAt: observation.reservedAt, databaseNow: "2026-09-03T12:30:30.000Z",
  });
  assert.throws(() => buildPrivateKwOwnerAuthAbandonmentReceipt({
    observationValue: observation, decisionValue: classifyPrivateKwOwnerAuthReservation(otherObservation),
    abandonmentReason: "UNKNOWN_WRITER", recordedAt: "2026-09-03T12:32:01.000Z",
  }), /exact same reservation/);
  const committed = buildPrivateKwOwnerAuthReservationObservation({
    boundaryValue: boundary(), state: "COMMITTED",
    recordId: `kw-owner-auth-idempotency:${"a".repeat(64)}`, resultAvailable: true,
    reservedAt: observation.reservedAt, databaseNow: observation.databaseNow,
  });
  assert.throws(() => buildPrivateKwOwnerAuthAbandonmentReceipt({
    observationValue: committed, decisionValue: classifyPrivateKwOwnerAuthReservation(committed),
    abandonmentReason: "UNKNOWN_WRITER", recordedAt: "2026-09-03T12:32:01.000Z",
  }), /Only a blocked RESERVED/);
  assert.throws(
    () => requireInProcessPrivateKwOwnerAuthRecoveryRetentionPolicy(structuredClone(policy)),
    /exact in-process owner-auth recovery retention policy/i,
  );
  assert.equal(policy.deletionRequiresSeparateOwnerRelease, true);
  assert.equal(policy.authority.reservationDeleteAuthorized, false);
});

test("disposable SQLite fixture checks scoped commit, replay, and rollback after every write", (t) => {
  const ownerClaim = claim();
  const db = new Database(":memory:");
  t.after(() => db.close());
  db.exec(`
    CREATE TABLE "RevenuePrivateKwOwnerAuthIdempotency" (
      "id" TEXT PRIMARY KEY,
      "state" TEXT NOT NULL,
      "boundaryDigest" TEXT NOT NULL,
      "owner" TEXT NOT NULL,
      "operation" TEXT NOT NULL,
      "payloadDigest" TEXT NOT NULL
    );
    CREATE TABLE "RevenuePrivateKwOwnerAction" ("id" TEXT PRIMARY KEY, "decision" TEXT NOT NULL);
    CREATE TABLE "RevenuePrivateKwOwnerAuthMutationOutbox" ("id" TEXT PRIMARY KEY, "idempotencyKey" TEXT NOT NULL);
  `);
  db.prepare(`INSERT INTO "RevenuePrivateKwOwnerAction" VALUES ('action-1', 'PENDING')`).run();
  db.prepare(`INSERT INTO "RevenuePrivateKwOwnerAction" VALUES ('unrelated', 'UNCHANGED')`).run();
  const seedUnrelated = (database: Database.Database) => {
    database.prepare(`INSERT INTO "RevenuePrivateKwOwnerAuthIdempotency" VALUES ('unrelated-key', 'COMMITTED', ?, ?, ?, ?)`).run(ownerClaim.boundaryDigest, ownerClaim.owner, ownerClaim.operation, ownerClaim.payloadDigest);
    database.prepare(`INSERT INTO "RevenuePrivateKwOwnerAuthMutationOutbox" VALUES ('unrelated-event', 'unrelated-key')`).run();
  };
  seedUnrelated(db);

  const fresh = db.transaction(() => {
    const inserted = db.prepare(`INSERT INTO "RevenuePrivateKwOwnerAuthIdempotency" VALUES (?, 'RESERVED', ?, ?, ?, ?)`)
      .run(ownerClaim.idempotencyKey, ownerClaim.boundaryDigest, ownerClaim.owner, ownerClaim.operation, ownerClaim.payloadDigest).changes;
    const operationRowsAffected = db.prepare(ownerClaim.sql).run(
      "ACCEPTED",
      "action-1",
      ...ownerClaim.claimBindings,
    ).changes;
    const finalized = db.prepare(`UPDATE "RevenuePrivateKwOwnerAuthIdempotency" SET "state" = 'COMMITTED' WHERE "id" = ? AND "state" = 'RESERVED'`)
      .run(ownerClaim.idempotencyKey).changes;
    const outboxInserted = db.prepare(`INSERT INTO "RevenuePrivateKwOwnerAuthMutationOutbox" VALUES (?, ?)`)
      .run(`outbox-${ownerClaim.idempotencyKey}`, ownerClaim.idempotencyKey).changes;
    return { inserted, operationRowsAffected, finalized, outboxInserted };
  })();
  assert.deepEqual(fresh, { inserted: 1, operationRowsAffected: 1, finalized: 1, outboxInserted: 1 });
  const freshProof = buildPrivateKwOwnerAuthMutationAffectedRowProof({
    claimValue: ownerClaim,
    executionPath: "FRESH_COMMIT",
    claimMatched: true,
    operationRowsAffected: fresh.operationRowsAffected,
    idempotencyRowsInserted: fresh.inserted,
    idempotencyRowsAfter: (db.prepare(`SELECT COUNT(*) AS count FROM "RevenuePrivateKwOwnerAuthIdempotency" WHERE id = ?`).get(ownerClaim.idempotencyKey) as { count: number }).count,
    outboxRowsInserted: fresh.outboxInserted,
    outboxRowsAfter: (db.prepare(`SELECT COUNT(*) AS count FROM "RevenuePrivateKwOwnerAuthMutationOutbox" WHERE idempotencyKey = ?`).get(ownerClaim.idempotencyKey) as { count: number }).count,
    ownerMutationRowsChanged: fresh.operationRowsAffected,
    unrelatedRowsChanged: 0,
    transactionState: "COMMITTED",
    failureReason: null,
  });
  assert.equal(freshProof.executionPath, "FRESH_COMMIT");

  assert.equal(freshProof.durableExecutionProven, false);
  assert.equal(freshProof.rowCountScope, "EXACT_IDEMPOTENCY_KEY");
  const replay = db.prepare(ownerClaim.sql).run("ACCEPTED", "action-1", ...ownerClaim.claimBindings).changes;
  const replayProof = buildPrivateKwOwnerAuthMutationAffectedRowProof({
    claimValue: ownerClaim,
    executionPath: "EXACT_REPLAY",
    claimMatched: false,
    operationRowsAffected: replay,
    idempotencyRowsInserted: 0,
    idempotencyRowsAfter: 1,
    outboxRowsInserted: 0,
    outboxRowsAfter: 1,
    ownerMutationRowsChanged: 0,
    unrelatedRowsChanged: 0,
    transactionState: "COMMITTED",
    failureReason: null,
  });
  assert.equal(replayProof.executionPath, "EXACT_REPLAY");

  // This is a small transaction harness, not migration 0070 or a D1 adapter.
  for (const failAfter of ["reserve", "operation", "finalize", "outbox"]) {
    const rollbackDb = new Database(":memory:");
    try {
      const definitions = db.prepare("SELECT sql FROM sqlite_schema WHERE type = 'table'").all() as { sql: string }[];
      for (const definition of definitions) rollbackDb.exec(definition.sql);
      seedUnrelated(rollbackDb);
      rollbackDb.prepare(`INSERT INTO "RevenuePrivateKwOwnerAction" VALUES ('action-1', 'PENDING'), ('unrelated', 'UNCHANGED')`).run();
      const before = rollbackDb.prepare(`SELECT * FROM "RevenuePrivateKwOwnerAction" ORDER BY id`).all();
      assert.throws(() => rollbackDb.transaction(() => {
        rollbackDb.prepare(`INSERT INTO "RevenuePrivateKwOwnerAuthIdempotency" VALUES (?, 'RESERVED', ?, ?, ?, ?)`).run(...ownerClaim.claimBindings);
        if (failAfter === "reserve") throw new Error("fixture failure");
        assert.equal(rollbackDb.prepare(ownerClaim.sql).run("ACCEPTED", "action-1", ...ownerClaim.claimBindings).changes, 1);
        if (failAfter === "operation") throw new Error("fixture failure");
        rollbackDb.prepare(`UPDATE "RevenuePrivateKwOwnerAuthIdempotency" SET state = 'COMMITTED' WHERE id = ?`).run(ownerClaim.idempotencyKey);
        if (failAfter === "finalize") throw new Error("fixture failure");
        rollbackDb.prepare(`INSERT INTO "RevenuePrivateKwOwnerAuthMutationOutbox" VALUES ('event', ?)`).run(ownerClaim.idempotencyKey);
        throw new Error("fixture failure");
      })(), /fixture failure/);
      const count = (table: string) => {
        const column = table === "RevenuePrivateKwOwnerAuthIdempotency" ? "id" : "idempotencyKey";
        return (rollbackDb.prepare(`SELECT COUNT(*) AS count FROM "${table}" WHERE "${column}" = ?`).get(ownerClaim.idempotencyKey) as { count: number }).count;
      };
      assert.deepEqual(rollbackDb.prepare(`SELECT * FROM "RevenuePrivateKwOwnerAction" ORDER BY id`).all(), before);
      const rollbackProof = buildPrivateKwOwnerAuthMutationAffectedRowProof({
        claimValue: ownerClaim,
        executionPath: "ROLLBACK",
        claimMatched: true,
        operationRowsAffected: 0,
        idempotencyRowsInserted: 0,
        idempotencyRowsAfter: count("RevenuePrivateKwOwnerAuthIdempotency"),
        outboxRowsInserted: 0,
        outboxRowsAfter: count("RevenuePrivateKwOwnerAuthMutationOutbox"),
        ownerMutationRowsChanged: 0,
        unrelatedRowsChanged: 0,
        transactionState: "ROLLED_BACK",
        failureReason: "PROCESS_LOSS",
      });
      assert.equal(rollbackProof.executionPath, "ROLLBACK");
      assert.equal(rollbackProof.unrelatedRowsChanged, 0);
      assert.equal(rollbackProof.authority.databaseMutationAuthorized, false);
      assert.deepEqual(rollbackDb.prepare(`SELECT * FROM "RevenuePrivateKwOwnerAuthMutationOutbox"`).all(), [{ id: "unrelated-event", idempotencyKey: "unrelated-key" }]);
      assert.equal((rollbackDb.prepare(`SELECT COUNT(*) AS count FROM "RevenuePrivateKwOwnerAuthIdempotency" WHERE id = 'unrelated-key' AND state = 'COMMITTED'`).get() as { count: number }).count, 1);
    } finally {
      rollbackDb.close();
    }
  }
  assert.deepEqual(db.prepare(`SELECT * FROM "RevenuePrivateKwOwnerAction" WHERE id = 'unrelated'`).get(), { id: "unrelated", decision: "UNCHANGED" });
  assert.equal(requireInProcessPrivateKwOwnerAuthMutationAffectedRowProof(freshProof), freshProof);
  assert.throws(
    () => requireInProcessPrivateKwOwnerAuthMutationAffectedRowProof(structuredClone(freshProof)),
    /exact in-process owner-auth affected-row proof/i,
  );
});

test("count validation rejects zero or multiple writes, mixed outcomes, and unrelated changes", () => {
  const input = {
    claimValue: claim(), executionPath: "FRESH_COMMIT" as const, claimMatched: true,
    operationRowsAffected: 1, idempotencyRowsInserted: 1, idempotencyRowsAfter: 1,
    outboxRowsInserted: 1, outboxRowsAfter: 1, ownerMutationRowsChanged: 1,
    unrelatedRowsChanged: 0, transactionState: "COMMITTED" as const, failureReason: null,
  };
  for (const field of ["operationRowsAffected", "idempotencyRowsInserted", "idempotencyRowsAfter", "outboxRowsInserted", "outboxRowsAfter", "ownerMutationRowsChanged"]) {
    for (const value of [0, 2, -1, 0.5]) {
      assert.throws(() => buildPrivateKwOwnerAuthMutationAffectedRowProof({ ...input, [field]: value }), `${field}=${value}`);
    }
  }
  for (const drift of [
    { unrelatedRowsChanged: 1 }, { claimMatched: false }, { executionPath: "EXACT_REPLAY" as const },
    { transactionState: "ROLLED_BACK" as const }, { executionPath: "ROLLBACK" as const },
    { claimValue: structuredClone(input.claimValue) },
  ]) assert.throws(() => buildPrivateKwOwnerAuthMutationAffectedRowProof({ ...input, ...drift }));
});
