import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  ARTIFACT_DELIVERY_CONTRACT_VERSION,
  ArtifactDeliveryAuthorizationError,
  ArtifactDeliveryClaimsSchema,
  issueFixtureArtifactDeliveryGrant,
  verifyFixtureArtifactDeliveryGrant,
} from "@/lib/revenue-engine/artifact-delivery-authorization";
import {
  FixtureArtifactDeliveryExecutionSchema,
  executeFixtureArtifactDelivery,
  type FixtureArtifactDeliveryReadRequest,
  type FixturePrivateArtifactReader,
} from "@/lib/revenue-engine/artifact-delivery-fixture";

const KEY = Buffer.from("artifact-delivery-test-key-material-01", "utf8");
const OTHER_KEY = Buffer.from("artifact-delivery-test-key-material-02", "utf8");
const ISSUED_AT = "2026-08-26T16:00:00.000Z";
const REFRESH_AFTER = "2026-08-26T16:30:00.000Z";
const ARTIFACT_EXPIRES_AT = "2026-09-25T16:00:00.000Z";

function webpBytes() {
  return Buffer.from([
    0x52, 0x49, 0x46, 0x46,
    0x08, 0x00, 0x00, 0x00,
    0x57, 0x45, 0x42, 0x50,
    0x56, 0x50, 0x38, 0x20,
    0x00, 0x00, 0x00, 0x00,
  ]);
}

const SCREENSHOT_BYTES = webpBytes();
const SCREENSHOT_SHA = createHash("sha256").update(SCREENSHOT_BYTES).digest("hex");
const SCREENSHOT_REF = `artifact:sha256:${SCREENSHOT_SHA}`;

function context(overrides: Record<string, unknown> = {}) {
  return {
    authenticatedUserId: "user-owner-001",
    authenticatedSessionId: "session-private-001",
    businessId: "business-kw-001",
    websiteSnapshotId: "website-snapshot-001",
    artifactKind: "DESKTOP_SCREENSHOT",
    artifactRef: SCREENSHOT_REF,
    websiteRefreshAfter: REFRESH_AFTER,
    artifactExpiresAt: ARTIFACT_EXPIRES_AT,
    ...overrides,
  };
}

function grant(overrides: Record<string, unknown> = {}) {
  return issueFixtureArtifactDeliveryGrant({
    grantId: "743532ca-28df-4c6e-bf07-08956846c275",
    requestedTtlMs: 5 * 60 * 1_000,
    ...context(),
    ...overrides,
  }, {
    signingKey: KEY,
    now: () => new Date(ISSUED_AT),
  });
}

function assertAuthorizationCode(error: unknown, code: ArtifactDeliveryAuthorizationError["code"]) {
  assert.ok(error instanceof ArtifactDeliveryAuthorizationError);
  assert.equal(error.code, code);
  return true;
}

test("private delivery grants are short-lived, session-bound, and contain no storage location", () => {
  const issued = grant();
  assert.equal(issued.contractVersion, ARTIFACT_DELIVERY_CONTRACT_VERSION);
  assert.equal(issued.expiresAt, "2026-08-26T16:05:00.000Z");
  assert.equal(issued.deliveryPath, `/api/v1/artifacts/delivery/${issued.token}`);
  assert.deepEqual(issued.authority, {
    authenticatedSessionRequired: true,
    exactDossierMatchRequired: true,
    runtimeConnected: false,
    providerReadAuthorized: false,
    providerOperationsAuthorized: 0,
    mutationAuthorized: false,
    outreachAuthorized: false,
    sendAuthorized: false,
    costAuthorizedUsd: 0,
  });

  const verified = verifyFixtureArtifactDeliveryGrant(issued.token, context(), {
    signingKey: KEY,
    now: () => new Date("2026-08-26T16:04:59.999Z"),
  });
  assert.equal(verified.artifactRef, SCREENSHOT_REF);
  assert.equal(verified.artifactKind, "DESKTOP_SCREENSHOT");
  assert.equal(Object.isFrozen(verified), true);

  const payload = Buffer.from(issued.token.split(".")[1]!, "base64url").toString("utf8");
  assert.doesNotMatch(payload, /user-owner-001|session-private-001|shadow\/|\.webp|r2\.dev|https?:\/\//i);
  assert.doesNotMatch(issued.token, /user-owner-001|session-private-001/);
});

test("tampering, another session, another dossier, and another key all fail closed", () => {
  const issued = grant();
  const segments = issued.token.split(".");
  const decoded = JSON.parse(Buffer.from(segments[1]!, "base64url").toString("utf8")) as Record<string, unknown>;
  const tamperedPayload = Buffer.from(JSON.stringify({ ...decoded, businessId: "business-kw-999" }), "utf8").toString("base64url");
  const tampered = `${segments[0]}.${tamperedPayload}.${segments[2]}`;

  assert.throws(
    () => verifyFixtureArtifactDeliveryGrant(tampered, context(), { signingKey: KEY, now: () => new Date(ISSUED_AT) }),
    (error) => assertAuthorizationCode(error, "INVALID_GRANT"),
  );
  assert.throws(
    () => verifyFixtureArtifactDeliveryGrant(issued.token, context(), { signingKey: OTHER_KEY, now: () => new Date(ISSUED_AT) }),
    (error) => assertAuthorizationCode(error, "INVALID_GRANT"),
  );

  for (const changed of [
    { authenticatedUserId: "user-owner-002" },
    { authenticatedSessionId: "session-private-002" },
    { businessId: "business-kw-002" },
    { websiteSnapshotId: "website-snapshot-002" },
    { artifactKind: "MOBILE_SCREENSHOT" },
    { artifactRef: `artifact:sha256:${"a".repeat(64)}` },
    { websiteRefreshAfter: "2026-08-26T16:31:00.000Z" },
    { artifactExpiresAt: "2026-09-25T16:01:00.000Z" },
  ]) {
    assert.throws(
      () => verifyFixtureArtifactDeliveryGrant(issued.token, context(changed), { signingKey: KEY, now: () => new Date(ISSUED_AT) }),
      (error) => assertAuthorizationCode(error, "CONTEXT_MISMATCH"),
    );
  }
});

test("grant issuance and verification enforce evidence expiry and a five-minute ceiling", () => {
  const issued = grant({
    requestedTtlMs: 5 * 60 * 1_000,
    websiteRefreshAfter: "2026-08-26T16:02:30.000Z",
  });
  assert.equal(issued.expiresAt, "2026-08-26T16:02:30.000Z");

  assert.throws(
    () => verifyFixtureArtifactDeliveryGrant(issued.token, context({ websiteRefreshAfter: "2026-08-26T16:02:30.000Z" }), {
      signingKey: KEY,
      now: () => new Date("2026-08-26T15:59:59.999Z"),
    }),
    (error) => assertAuthorizationCode(error, "NOT_YET_VALID"),
  );
  assert.throws(
    () => verifyFixtureArtifactDeliveryGrant(issued.token, context({ websiteRefreshAfter: "2026-08-26T16:02:30.000Z" }), {
      signingKey: KEY,
      now: () => new Date("2026-08-26T16:02:30.000Z"),
    }),
    (error) => assertAuthorizationCode(error, "EXPIRED"),
  );
  assert.throws(
    () => verifyFixtureArtifactDeliveryGrant(issued.token, context({ websiteRefreshAfter: "2026-08-26T16:02:30.000Z" }), {
      signingKey: KEY,
      now: () => new Date(Number.NaN),
    }),
    (error) => assertAuthorizationCode(error, "INVALID_GRANT"),
  );
  assert.throws(
    () => grant({ requestedTtlMs: 5 * 60 * 1_000 + 1 }),
    /Too big|less than or equal to 300000/i,
  );
  assert.throws(
    () => grant({ artifactExpiresAt: "2026-08-26T16:00:04.999Z" }),
    (error) => assertAuthorizationCode(error, "EXPIRED"),
  );
  assert.throws(
    () => issueFixtureArtifactDeliveryGrant({
      grantId: "743532ca-28df-4c6e-bf07-08956846c275",
      requestedTtlMs: 5_000,
      ...context(),
    }, { signingKey: Buffer.from("too-short"), now: () => new Date(ISSUED_AT) }),
    /at least 32 bytes/i,
  );
  assert.throws(
    () => ArtifactDeliveryClaimsSchema.parse({
      ...verifyFixtureArtifactDeliveryGrant(grant().token, context(), { signingKey: KEY, now: () => new Date(ISSUED_AT) }),
      expiresAt: "2026-08-26T16:05:00.001Z",
    }),
    /maximum lifetime/i,
  );
});

function reader(resolve: (request: FixtureArtifactDeliveryReadRequest) => unknown) {
  const calls: FixtureArtifactDeliveryReadRequest[] = [];
  const value: FixturePrivateArtifactReader = {
    kind: "FIXTURE",
    async readByArtifactRef(request) {
      calls.push(request);
      return resolve(request);
    },
  };
  return { calls, reader: value };
}

function screenshotObject(overrides: Record<string, unknown> = {}) {
  return {
    artifactRef: SCREENSHOT_REF,
    bytes: SCREENSHOT_BYTES,
    byteLength: SCREENSHOT_BYTES.byteLength,
    sha256: SCREENSHOT_SHA,
    mediaType: "image/webp",
    ...overrides,
  };
}

test("fixture delivery validates exact WebP bytes and returns hardened same-origin headers", async () => {
  const issued = grant();
  const fixture = reader(() => screenshotObject());
  const result = await executeFixtureArtifactDelivery({ token: issued.token, expected: context() }, {
    signingKey: KEY,
    reader: fixture.reader,
    now: () => new Date("2026-08-26T16:01:00.000Z"),
  });

  assert.deepEqual(FixtureArtifactDeliveryExecutionSchema.parse(result), result);
  assert.deepEqual(fixture.calls, [{
    readerKind: "FIXTURE",
    providerReadAuthorized: false,
    artifactRef: SCREENSHOT_REF,
    mediaType: "image/webp",
    maxBytes: 5_242_880,
  }]);
  assert.equal(result.providerReadPerformed, false);
  assert.equal(result.providerOperationsAuthorized, 0);
  assert.equal(result.costUsd, 0);
  assert.equal(result.response.headers["Cache-Control"], "private, no-store, max-age=0");
  assert.equal(result.response.headers.Vary, "Cookie");
  assert.equal(result.response.headers["Cross-Origin-Resource-Policy"], "same-origin");
  assert.equal(result.response.headers["X-Content-Type-Options"], "nosniff");
  assert.equal(result.response.headers["Content-Disposition"], 'inline; filename="axiom-evidence.webp"');
  assert.equal(result.response.headers.ETag, `"${SCREENSHOT_SHA}"`);
  assert.deepEqual(Array.from(result.response.body), Array.from(SCREENSHOT_BYTES));
  assert.notEqual(result.response.body, SCREENSHOT_BYTES);
  assert.doesNotMatch(JSON.stringify(result.response.headers), /business-kw|website-snapshot|shadow\//i);
});

test("invalid or mislabeled fixture bytes never become a private image response", async () => {
  const issued = grant();
  const cases = [
    screenshotObject({ artifactRef: `artifact:sha256:${"a".repeat(64)}` }),
    screenshotObject({ sha256: "b".repeat(64) }),
    screenshotObject({ byteLength: SCREENSHOT_BYTES.byteLength + 1 }),
    screenshotObject({ bytes: Buffer.from("<html>not an image</html>", "utf8") }),
  ];
  for (const candidate of cases) {
    const fixture = reader(() => candidate);
    await assert.rejects(
      executeFixtureArtifactDelivery({ token: issued.token, expected: context() }, {
        signingKey: KEY,
        reader: fixture.reader,
        now: () => new Date("2026-08-26T16:01:00.000Z"),
      }),
      /invalid screenshot bytes|Invalid string|expected/i,
    );
  }

  const notCalled = reader(() => screenshotObject());
  await assert.rejects(
    executeFixtureArtifactDelivery({ token: issued.token, expected: context({ authenticatedSessionId: "wrong-session" }) }, {
      signingKey: KEY,
      reader: notCalled.reader,
      now: () => new Date("2026-08-26T16:01:00.000Z"),
    }),
    (error) => assertAuthorizationCode(error, "CONTEXT_MISMATCH"),
  );
  assert.equal(notCalled.calls.length, 0);
});

test("DOM artifacts and raw storage identifiers are outside the delivery contract", () => {
  assert.throws(() => grant({ artifactKind: "DOM" }), /Invalid option/i);
  assert.throws(() => grant({ artifactRef: "shadow/30d/v1/browser-screenshot/aa/file.webp" }), /Invalid string|expected string/i);
});
