import assert from "node:assert/strict";
import test from "node:test";

import {
  artifactReferenceCanonicalJson,
  artifactReferenceDigest,
} from "@/lib/revenue-engine/artifact-reference-projection";
import {
  buildPrivateKwOwnerAuthReadiness,
} from "@/lib/revenue-engine/private-kw-owner-auth-readiness";
import {
  buildPrivateKwOwnerAuthServerBoundary,
  requireInProcessPrivateKwOwnerAuthServerBoundary,
} from "@/lib/revenue-engine/private-kw-owner-auth-server-boundary";

const CHECKED_AT = "2026-09-03T12:00:00.000Z";
const SESSION_CREATED = "2026-09-03T11:00:00.000Z";
const SESSION_EXPIRES = "2026-09-03T19:00:00.000Z";

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
    checkedAt: CHECKED_AT,
  });
}

function session(overrides: Record<string, unknown> = {}) {
  return {
    sessionContractVersion: "better-auth-owner-session-v1",
    authenticationProvider: "BETTER_AUTH",
    authenticatedUserId: "user-riley-private",
    authenticatedSessionId: "session-riley-private",
    authenticatedEmail: "riley@getaxiom.ca",
    authenticatedEmailVerified: true,
    sessionCreatedAt: SESSION_CREATED,
    sessionExpiresAt: SESSION_EXPIRES,
    ...overrides,
  };
}

function request(body: unknown = {}) {
  return {
    method: "POST",
    origin: "https://revenue.getaxiom.ca",
    headers: {
      Origin: "https://revenue.getaxiom.ca",
      "Sec-Fetch-Site": "same-origin",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Dest": "empty",
    },
    body,
  };
}

function buildInput(body: unknown = {}) {
  const payload = { dossierDigest: "d".repeat(64), decision: "ACCEPTED" };
  const payloadDigest = artifactReferenceDigest(payload);
  const idempotencyKey = `kw-owner-mutation-idempotency:${artifactReferenceDigest({
    boundaryVersion: "kw-owner-auth-server-boundary-v1",
    owner: "RILEY",
    operation: "owner.dossier.accept",
    payloadDigest,
  })}`;
  return {
    readinessValue: readiness(),
    serverSessionValue: session(),
    request: request(body),
    operation: "owner.dossier.accept",
    payload,
    idempotencyKey,
  };
}

test("validates only the server session and exact request policy", () => {
  const boundary = buildPrivateKwOwnerAuthServerBoundary(buildInput(), {
    now: () => new Date("2026-09-03T12:30:00.000Z"),
  });

  assert.equal(boundary.boundaryKind, "OWNER_AUTH_SERVER_REQUEST");
  assert.equal(boundary.state, "VALIDATED_NOT_ACTIVATED");
  assert.equal(boundary.owner, "RILEY");
  assert.equal(boundary.verifiedEmail, true);
  assert.equal(boundary.request.requestBodySessionFieldsIgnored, true);
  assert.equal(boundary.authority.mutationAuthorized, false);
  assert.equal(boundary.authority.databaseMutationAuthorized, false);
  assert.equal(boundary.authority.sendAuthorized, false);
  assert.equal(boundary.authority.providerOperationsAuthorized, 0);
  assert.equal(boundary.authority.costAuthorizedUsd, 0);
  assert.equal(Object.isFrozen(boundary), true);
  assert.equal(Object.isFrozen(boundary.request), true);
  assert.equal(requireInProcessPrivateKwOwnerAuthServerBoundary(boundary), boundary);
  assert.doesNotMatch(
    artifactReferenceCanonicalJson(boundary),
    /user-riley-private|session-riley-private|sessionToken|password/i,
  );
});

test("request-body identity cannot override the server session", () => {
  const emptyBody = buildPrivateKwOwnerAuthServerBoundary(buildInput(), {
    now: () => new Date("2026-09-03T12:30:00.000Z"),
  });
  const spoofedBody = buildPrivateKwOwnerAuthServerBoundary(buildInput({
    owner: "AIDAN",
    userId: "attacker",
    sessionId: "attacker-session",
    sessionToken: "attacker-token",
  }), {
    now: () => new Date("2026-09-03T12:30:00.000Z"),
  });

  assert.equal(spoofedBody.owner, "RILEY");
  assert.equal(spoofedBody.idempotencyKey, emptyBody.idempotencyKey);
  assert.equal(spoofedBody.boundaryDigest, emptyBody.boundaryDigest);
});

test("rejects stale or unverified sessions and unsafe CSRF metadata", () => {
  assert.throws(
    () => buildPrivateKwOwnerAuthServerBoundary({
      ...buildInput(),
      serverSessionValue: session({ authenticatedEmailVerified: false }),
    }, { now: () => new Date("2026-09-03T12:30:00.000Z") }),
    /true|verified/i,
  );
  assert.throws(
    () => buildPrivateKwOwnerAuthServerBoundary(buildInput(), {
      now: () => new Date("2026-09-03T20:00:00.000Z"),
    }),
    /current|session/i,
  );
  assert.throws(
    () => buildPrivateKwOwnerAuthServerBoundary({
      ...buildInput(),
      request: {
        ...request(),
        headers: {
          ...request().headers,
          "Sec-Fetch-Site": "cross-site",
        },
      },
    }, { now: () => new Date("2026-09-03T12:30:00.000Z") }),
    /Origin|Fetch Metadata|same-origin/i,
  );
  assert.throws(
    () => buildPrivateKwOwnerAuthServerBoundary({
      ...buildInput(),
      request: {
        ...request(),
        origin: "https://evil.example",
        headers: {
          ...request().headers,
          Origin: "https://evil.example",
        },
      },
    }, { now: () => new Date("2026-09-03T12:30:00.000Z") }),
    /trusted-origin|origin/i,
  );
});

test("rejects a forged idempotency key and copied boundary result", () => {
  const input = buildInput();
  assert.throws(
    () => buildPrivateKwOwnerAuthServerBoundary({ ...input, idempotencyKey: "reused-key" }, {
      now: () => new Date("2026-09-03T12:30:00.000Z"),
    }),
    /idempotency/i,
  );
  const boundary = buildPrivateKwOwnerAuthServerBoundary(input, {
    now: () => new Date("2026-09-03T12:30:00.000Z"),
  });
  assert.throws(
    () => requireInProcessPrivateKwOwnerAuthServerBoundary(structuredClone(boundary)),
    /exact in-process owner-auth server boundary/i,
  );
});
