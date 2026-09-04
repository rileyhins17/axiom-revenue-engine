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
  commitPrivateKwOwnerAuthIdempotency,
  requireInProcessPrivateKwOwnerAuthIdempotencyCommitResult,
  type PrivateKwOwnerAuthIdempotencyRecord,
  type PrivateKwOwnerAuthIdempotencyStore,
} from "@/lib/revenue-engine/private-kw-owner-auth-idempotency";

function readiness() {
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
    checkedAt: "2026-09-03T12:00:00.000Z",
  });
}

function serverSession() {
  return {
    sessionContractVersion: "better-auth-owner-session-v1",
    authenticationProvider: "BETTER_AUTH",
    authenticatedUserId: "user-riley-private",
    authenticatedSessionId: "session-riley-private",
    authenticatedEmail: "riley@getaxiom.ca",
    authenticatedEmailVerified: true,
    sessionCreatedAt: "2026-09-03T11:00:00.000Z",
    sessionExpiresAt: "2026-09-03T19:00:00.000Z",
  };
}

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
    readinessValue: readiness(),
    serverSessionValue: serverSession(),
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

function store(initial?: PrivateKwOwnerAuthIdempotencyRecord): PrivateKwOwnerAuthIdempotencyStore {
  let existing = initial ?? null;
  return {
    async insertIfAbsent(candidate) {
      if (existing) return { inserted: false, existing };
      existing = structuredClone(candidate);
      return { inserted: true, existing: null };
    },
  };
}

test("commits once and returns the exact same safe result on replay", async () => {
  const first = await commitPrivateKwOwnerAuthIdempotency({
    boundaryValue: boundary(),
    resultValue: { outcome: "ACCEPTED", receiptId: "receipt-001", count: 1 },
  }, store(), { now: () => new Date("2026-09-03T12:31:00.000Z") });
  const backingStore = store(first.record);
  const replay = await commitPrivateKwOwnerAuthIdempotency({
    boundaryValue: boundary(),
    resultValue: { outcome: "ACCEPTED", receiptId: "receipt-001", count: 1 },
  }, backingStore, { now: () => new Date("2026-09-03T12:32:00.000Z") });

  assert.equal(first.executionPath, "FRESH_COMMIT");
  assert.equal(replay.executionPath, "EXACT_REPLAY");
  assert.deepEqual(replay.result, first.result);
  assert.equal(replay.resultDigest, first.resultDigest);
  assert.equal(replay.record.recordId, first.record.recordId);
  assert.equal(replay.record.authority.mutationAuthorized, false);
  assert.equal(replay.record.authority.databaseMutationAuthorized, false);
  assert.equal(replay.record.authority.providerOperationsAuthorized, 0);
  assert.equal(requireInProcessPrivateKwOwnerAuthIdempotencyCommitResult(replay), replay);
});

test("two concurrent attempts converge on one fresh commit and one replay", async () => {
  let existing: PrivateKwOwnerAuthIdempotencyRecord | null = null;
  const atomicStore: PrivateKwOwnerAuthIdempotencyStore = {
    async insertIfAbsent(candidate) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (existing) return { inserted: false, existing };
      existing = structuredClone(candidate);
      return { inserted: true, existing: null };
    },
  };
  const [left, right] = await Promise.all([
    commitPrivateKwOwnerAuthIdempotency({
      boundaryValue: boundary(),
      resultValue: { outcome: "ACCEPTED", receiptId: "receipt-race" },
    }, atomicStore, { now: () => new Date("2026-09-03T12:31:00.000Z") }),
    commitPrivateKwOwnerAuthIdempotency({
      boundaryValue: boundary(),
      resultValue: { outcome: "ACCEPTED", receiptId: "receipt-race" },
    }, atomicStore, { now: () => new Date("2026-09-03T12:31:00.000Z") }),
  ]);

  assert.deepEqual(
    [left.executionPath, right.executionPath].sort(),
    ["EXACT_REPLAY", "FRESH_COMMIT"],
  );
  assert.equal(left.record.recordId, right.record.recordId);
  assert.deepEqual(left.result, right.result);
});

test("rejects a conflicting replay result and a forged store record", async () => {
  const first = await commitPrivateKwOwnerAuthIdempotency({
    boundaryValue: boundary(),
    resultValue: { outcome: "ACCEPTED", receiptId: "receipt-001" },
  }, store(), { now: () => new Date("2026-09-03T12:31:00.000Z") });
  await assert.rejects(
    () => commitPrivateKwOwnerAuthIdempotency({
      boundaryValue: boundary(),
      resultValue: { outcome: "REJECTED", receiptId: "receipt-001" },
    }, store(first.record), { now: () => new Date("2026-09-03T12:32:00.000Z") }),
    /conflicting intent or result/i,
  );
  const forged = structuredClone(first.record);
  forged.owner = "AIDAN";
  await assert.rejects(
    () => commitPrivateKwOwnerAuthIdempotency({
      boundaryValue: boundary(),
      resultValue: { outcome: "ACCEPTED", receiptId: "receipt-001" },
    }, store(forged), { now: () => new Date("2026-09-03T12:32:00.000Z") }),
    /recordDigest|conflicting|Idempotency/i,
  );
});

test("rejects secret-like, oversized, non-JSON, stale-session, and copied results", async () => {
  await assert.rejects(
    () => commitPrivateKwOwnerAuthIdempotency({
      boundaryValue: boundary(),
      resultValue: { sessionToken: "never-store" },
    }, store(), { now: () => new Date("2026-09-03T12:31:00.000Z") }),
    /secret-like/i,
  );
  await assert.rejects(
    () => commitPrivateKwOwnerAuthIdempotency({
      boundaryValue: boundary(),
      resultValue: { value: "x".repeat(33_000) },
    }, store(), { now: () => new Date("2026-09-03T12:31:00.000Z") }),
    /bounded JSON limit/i,
  );
  await assert.rejects(
    () => commitPrivateKwOwnerAuthIdempotency({
      boundaryValue: boundary(),
      resultValue: { value: Symbol("not-json") },
    }, store(), { now: () => new Date("2026-09-03T12:31:00.000Z") }),
    /JSON data/i,
  );
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  await assert.rejects(
    () => commitPrivateKwOwnerAuthIdempotency({
      boundaryValue: boundary(),
      resultValue: cyclic,
    }, store(), { now: () => new Date("2026-09-03T12:31:00.000Z") }),
    /cycles/i,
  );
  await assert.rejects(
    () => commitPrivateKwOwnerAuthIdempotency({
      boundaryValue: boundary(),
      resultValue: { outcome: "ACCEPTED" },
    }, store(), { now: () => new Date("2026-09-03T20:00:00.000Z") }),
    /current server session/i,
  );
  const first = await commitPrivateKwOwnerAuthIdempotency({
    boundaryValue: boundary(),
    resultValue: { outcome: "ACCEPTED" },
  }, store(), { now: () => new Date("2026-09-03T12:31:00.000Z") });
  assert.throws(
    () => requireInProcessPrivateKwOwnerAuthIdempotencyCommitResult(structuredClone(first)),
    /exact in-process owner-auth idempotency result/i,
  );
});
