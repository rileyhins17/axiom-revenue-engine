import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPrivateKwOwnerAuthReadiness,
  requireInProcessPrivateKwOwnerAuthReadiness,
} from "@/lib/revenue-engine/private-kw-owner-auth-readiness";
import { artifactReferenceCanonicalJson } from "@/lib/revenue-engine/artifact-reference-projection";

function snapshot(overrides: Record<string, unknown> = {}) {
  return {
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
    ...overrides,
  };
}

test("builds one frozen, zero-authority readiness result for complete owner controls", () => {
  const readiness = buildPrivateKwOwnerAuthReadiness(snapshot());

  assert.equal(readiness.readinessKind, "OWNER_AUTHENTICATION_READINESS");
  assert.equal(readiness.state, "VALIDATED_NOT_ACTIVATED");
  assert.deepEqual(readiness.ownerAllowlist, ["aidan@getaxiom.ca", "riley@getaxiom.ca"]);
  assert.equal(readiness.controls.verifiedEmailRequired, true);
  assert.equal(readiness.controls.mfaProvider, "TOTP");
  assert.equal(readiness.controls.backupRecoveryEnabled, true);
  assert.equal(readiness.controls.serverOnlySessionLookup, true);
  assert.equal(readiness.controls.atomicIdempotency, true);
  assert.equal(readiness.authority.activationAuthorized, false);
  assert.equal(readiness.authority.databaseMutationAuthorized, false);
  assert.equal(readiness.authority.routeAuthorized, false);
  assert.equal(readiness.authority.uiMutationAuthorized, false);
  assert.equal(readiness.authority.providerOperationsAuthorized, 0);
  assert.equal(readiness.authority.costAuthorizedUsd, 0);
  assert.equal(Object.isFrozen(readiness), true);
  assert.equal(Object.isFrozen(readiness.controls), true);
  assert.equal(requireInProcessPrivateKwOwnerAuthReadiness(readiness), readiness);
  const serialized = artifactReferenceCanonicalJson(readiness);
  assert.doesNotMatch(serialized, /BETTER_AUTH_SECRET|bindingKey|sessionToken|password/i);
});

test("rejects the current weak defaults and any partial owner control", () => {
  assert.throws(() => buildPrivateKwOwnerAuthReadiness(snapshot({
    emailVerification: {
      ...snapshot().emailVerification as Record<string, unknown>,
      requiredBeforeSession: false,
    },
  })), /requiredBeforeSession|true/i);
  assert.throws(() => buildPrivateKwOwnerAuthReadiness(snapshot({
    multiFactor: {
      ...snapshot().multiFactor as Record<string, unknown>,
      enrollmentRequiredForOwners: false,
    },
  })), /enrollmentRequiredForOwners|true/i);
  assert.throws(() => buildPrivateKwOwnerAuthReadiness(snapshot({
    csrf: {
      ...snapshot().csrf as Record<string, unknown>,
      fetchMetadataChecksEnabled: false,
    },
  })), /fetchMetadataChecksEnabled|true/i);
  assert.throws(() => buildPrivateKwOwnerAuthReadiness(snapshot({
    idempotency: {
      ...snapshot().idempotency as Record<string, unknown>,
      atomicStorage: false,
    },
  })), /atomicStorage|true/i);
});

test("rejects unsafe production origins, duplicate owners, and body-controlled sessions", () => {
  assert.throws(() => buildPrivateKwOwnerAuthReadiness(snapshot({
    environment: "PRODUCTION",
    csrf: {
      ...snapshot().csrf as Record<string, unknown>,
      trustedOriginsExact: ["http://localhost:3000"],
    },
  })), /loopback|production/i);
  assert.throws(() => buildPrivateKwOwnerAuthReadiness(snapshot({
    csrf: {
      ...snapshot().csrf as Record<string, unknown>,
      trustedOriginsExact: ["https://*.getaxiom.ca"],
    },
  })), /exact origins|wildcard|URL/i);
  assert.throws(() => buildPrivateKwOwnerAuthReadiness(snapshot({
    ownerAllowlist: ["riley@getaxiom.ca", "riley@getaxiom.ca"],
  })), /exactly Riley and Aidan/i);
  assert.throws(() => buildPrivateKwOwnerAuthReadiness(snapshot({
    session: {
      ...snapshot().session as Record<string, unknown>,
      requestBodyFieldsIgnored: false,
    },
  })), /requestBodyFieldsIgnored|true/i);
});

test("copied readiness JSON cannot become trusted in-process authority", () => {
  const readiness = buildPrivateKwOwnerAuthReadiness(snapshot());
  assert.throws(
    () => requireInProcessPrivateKwOwnerAuthReadiness(structuredClone(readiness)),
    /exact in-process owner-auth readiness/i,
  );
});
