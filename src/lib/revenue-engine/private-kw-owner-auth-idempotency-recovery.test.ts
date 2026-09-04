import assert from "node:assert/strict";
import test from "node:test";

import {
  artifactReferenceDigest,
} from "@/lib/revenue-engine/artifact-reference-projection";
import {
  buildPrivateKwOwnerAuthReadiness,
} from "@/lib/revenue-engine/private-kw-owner-auth-readiness";
import {
  buildPrivateKwOwnerAuthServerBoundary,
} from "@/lib/revenue-engine/private-kw-owner-auth-server-boundary";
import {
  buildPrivateKwOwnerAuthIdempotencyRecoveryPolicy,
  buildPrivateKwOwnerAuthOperationClaim,
  buildPrivateKwOwnerAuthReservationObservation,
  classifyPrivateKwOwnerAuthReservation,
  PRIVATE_KW_OWNER_AUTH_MUTATION_CLAIM_EXISTS_PREDICATE,
  PRIVATE_KW_OWNER_AUTH_MUTATION_CLAIM_PREDICATE,
  requireInProcessPrivateKwOwnerAuthIdempotencyRecoveryPolicy,
  requireInProcessPrivateKwOwnerAuthOperationClaim,
  requireInProcessPrivateKwOwnerAuthReservationRecoveryDecision,
} from "@/lib/revenue-engine/private-kw-owner-auth-idempotency-recovery";

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

test("reservation policy blocks every visible RESERVED row and replays only COMMITTED", () => {
  const policy = buildPrivateKwOwnerAuthIdempotencyRecoveryPolicy();
  assert.equal(policy.expectedMaxReservationAgeMs, 120_000);
  assert.equal(policy.visibleReservationAction, "BLOCK_AND_ESCALATE");
  assert.equal(policy.staleReservationAction, "BLOCK_AND_ESCALATE");
  assert.equal(policy.sameKeyRetryAfterReservation, "FAIL_CLOSED_UNTIL_NEW_KEY");
  assert.equal(policy.reservationMayBeFinalizedByRecovery, false);
  assert.equal(policy.reservationMayBeDeletedByRecovery, false);
  assert.equal(policy.reservationMayBeReusedByRecovery, false);
  assert.equal(requireInProcessPrivateKwOwnerAuthIdempotencyRecoveryPolicy(policy), policy);
  assert.throws(
    () => requireInProcessPrivateKwOwnerAuthIdempotencyRecoveryPolicy(structuredClone(policy)),
    /exact in-process owner-auth recovery policy/i,
  );

  const visible = classifyPrivateKwOwnerAuthReservation(buildPrivateKwOwnerAuthReservationObservation({
    boundaryValue: boundary(),
    state: "RESERVED",
    reservedAt: "2026-09-03T12:30:00.000Z",
    databaseNow: "2026-09-03T12:30:30.000Z",
    recordId: null,
    resultAvailable: false,
  }));
  assert.equal(visible.action, "BLOCK_VISIBLE_RESERVED");
  assert.equal(visible.sameKeyRetryAllowed, false);
  assert.equal(visible.recoveryReceiptRequired, true);
  assert.equal(visible.operationMutationAllowed, false);

  const stale = classifyPrivateKwOwnerAuthReservation(buildPrivateKwOwnerAuthReservationObservation({
    boundaryValue: boundary(),
    state: "RESERVED",
    reservedAt: "2026-09-03T12:30:00.000Z",
    databaseNow: "2026-09-03T12:32:00.000Z",
    recordId: null,
    resultAvailable: false,
  }));
  assert.equal(stale.action, "BLOCK_STALE_RESERVED");
  assert.equal(stale.reservationAgeMs, 120_000);

  const expired = classifyPrivateKwOwnerAuthReservation(buildPrivateKwOwnerAuthReservationObservation({
    boundaryValue: boundary(),
    state: "RESERVED",
    reservedAt: "2026-09-03T18:00:00.000Z",
    databaseNow: "2026-09-03T19:00:00.000Z",
    recordId: null,
    resultAvailable: false,
  }));
  assert.equal(expired.action, "BLOCK_EXPIRED_SESSION_RESERVED");

  const committed = classifyPrivateKwOwnerAuthReservation(buildPrivateKwOwnerAuthReservationObservation({
    boundaryValue: boundary(),
    state: "COMMITTED",
    reservedAt: "2026-09-03T12:30:00.000Z",
    databaseNow: "2026-09-03T13:00:00.000Z",
    recordId: `kw-owner-auth-idempotency:${"a".repeat(64)}`,
    resultAvailable: true,
  }));
  assert.equal(committed.action, "REPLAY_EXACT_RESULT");
  assert.equal(committed.sameKeyRetryAllowed, true);
  assert.equal(committed.recoveryReceiptRequired, false);
  assert.equal(requireInProcessPrivateKwOwnerAuthReservationRecoveryDecision(committed), committed);
  assert.throws(
    () => requireInProcessPrivateKwOwnerAuthReservationRecoveryDecision(structuredClone(committed)),
    /exact in-process owner-auth recovery decision/i,
  );
});

test("reservation observations reject impossible chronology and mixed states", () => {
  assert.throws(() => buildPrivateKwOwnerAuthReservationObservation({
    boundaryValue: boundary(),
    state: "RESERVED",
    reservedAt: "2026-09-03T12:30:00.000Z",
    databaseNow: "2026-09-03T12:29:59.999Z",
    recordId: null,
    resultAvailable: false,
  }), /database clock before reservation/i);
  assert.throws(() => buildPrivateKwOwnerAuthReservationObservation({
    boundaryValue: boundary(),
    state: "RESERVED",
    reservedAt: "2026-09-03T12:30:00.000Z",
    databaseNow: "2026-09-03T12:30:01.000Z",
    recordId: `kw-owner-auth-idempotency:${"a".repeat(64)}`,
    resultAvailable: true,
  }), /RESERVED observation/i);
  assert.throws(() => buildPrivateKwOwnerAuthReservationObservation({
    boundaryValue: boundary(),
    state: "COMMITTED",
    reservedAt: "2026-09-03T12:30:00.000Z",
    databaseNow: "2026-09-03T12:30:01.000Z",
    recordId: null,
    resultAvailable: false,
  }), /COMMITTED observation/i);
});

test("operation claim binds one parameterized DML statement to the exact reservation", () => {
  const ownerBoundary = boundary();
  const sql = `UPDATE "RevenuePrivateKwOwnerAction"
    SET "decision" = ?
    WHERE ${PRIVATE_KW_OWNER_AUTH_MUTATION_CLAIM_EXISTS_PREDICATE}`;
  const claim = buildPrivateKwOwnerAuthOperationClaim({
    boundaryValue: ownerBoundary,
    mutationKind: "UPDATE",
    targetTable: "RevenuePrivateKwOwnerAction",
    sql,
  });
  assert.equal(claim.claimPredicate, PRIVATE_KW_OWNER_AUTH_MUTATION_CLAIM_EXISTS_PREDICATE);
  assert.equal(claim.claimEmbedded, true);
  assert.equal(claim.singleStatement, true);
  assert.equal(claim.mustShareD1Batch, true);
  assert.equal(claim.executableByThisContract, false);
  assert.deepEqual(claim.claimBindings, [
    ownerBoundary.idempotencyKey,
    ownerBoundary.boundaryDigest,
    ownerBoundary.owner,
    ownerBoundary.operation,
    ownerBoundary.payloadDigest,
  ]);
  assert.equal(PRIVATE_KW_OWNER_AUTH_MUTATION_CLAIM_PREDICATE.includes("state"), true);
  assert.equal(claim.authority.operationMutationAuthorized, false);
  assert.equal(claim.authority.databaseMutationAuthorized, false);
  assert.equal(claim.authority.providerOperationsAuthorized, 0);
  assert.equal(claim.authority.costAuthorizedUsd, 0);
  assert.equal(Object.isFrozen(claim), true);
  assert.equal(requireInProcessPrivateKwOwnerAuthOperationClaim(claim), claim);
  assert.throws(
    () => requireInProcessPrivateKwOwnerAuthOperationClaim(structuredClone(claim)),
    /exact in-process owner-auth operation claim/i,
  );

  assert.throws(() => buildPrivateKwOwnerAuthOperationClaim({
    boundaryValue: ownerBoundary,
    mutationKind: "UPDATE",
    targetTable: "RevenuePrivateKwOwnerAction",
    sql: `UPDATE "RevenuePrivateKwOwnerAction" SET "decision" = ? WHERE "id" = ?`,
  }), /exact reservation predicate/i);
  assert.throws(() => buildPrivateKwOwnerAuthOperationClaim({
    boundaryValue: ownerBoundary,
    mutationKind: "UPDATE",
    targetTable: "RevenuePrivateKwOwnerAction",
    sql: `${sql}; DROP TABLE "RevenuePrivateKwOwnerAction"`,
  }), /one parameterized DML/i);
  assert.throws(() => buildPrivateKwOwnerAuthOperationClaim({
    boundaryValue: ownerBoundary,
    mutationKind: "SELECT" as "UPDATE",
    targetTable: "RevenuePrivateKwOwnerAction",
    sql,
  }), /Invalid option|operation claim/i);
  assert.throws(() => buildPrivateKwOwnerAuthOperationClaim({
    boundaryValue: ownerBoundary,
    mutationKind: "UPDATE",
    targetTable: "RevenuePrivateKwOwnerAuthIdempotency",
    sql: sql.replace("RevenuePrivateKwOwnerAction", "RevenuePrivateKwOwnerAuthIdempotency"),
  }), /cannot mutate the idempotency ledger/i);
});
