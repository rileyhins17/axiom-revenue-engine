import assert from "node:assert/strict";
import test from "node:test";

import {
  ARTIFACT_MANIFEST_VERSION,
  ArtifactManifestSchema,
  type ArtifactManifest,
} from "@/lib/revenue-engine/artifact-lifecycle";
import {
  ARTIFACT_MANIFEST_HEAD_ADAPTER_VERSION,
  ARTIFACT_MANIFEST_HEAD_MAX_OBJECTS,
  ArtifactManifestHeadExecutionSchema,
  inspectArtifactManifestWithFixtureHead,
  type ArtifactManifestFixtureHeadClient,
  type ArtifactManifestFixtureHeadObject,
} from "@/lib/revenue-engine/artifact-manifest-head-adapter";
import { selectFreshR2ManifestAvailability } from "@/lib/revenue-engine/artifact-manifest-availability";
import {
  ARTIFACT_STORE_CONTRACT_VERSION,
  artifactObjectKey,
} from "@/lib/revenue-engine/content-addressed-artifact-store";

const WORKFLOW_ID = "11111111-1111-4111-8111-111111111111";
const MANIFEST_ID = "22222222-2222-4222-8222-222222222222";
const REQUEST_ID = "33333333-3333-4333-8333-333333333333";
const RECEIPT_ID = "44444444-4444-4444-8444-444444444444";
const REQUESTED_AT = "2026-08-24T12:00:30.000Z";
const CHECKED_AT = "2026-08-24T12:01:00.000Z";
const VALID_THROUGH = "2026-08-24T12:05:00.000Z";
const EXPIRES_AT = "2026-09-23T12:00:00.000Z";
const SCREENSHOT_SHA = "a".repeat(64);
const MEASUREMENT_SHA = "b".repeat(64);

function manifest(retentionClass: ArtifactManifest["retentionClass"] = "SHADOW_30D") {
  return ArtifactManifestSchema.parse({
    manifestVersion: ARTIFACT_MANIFEST_VERSION,
    manifestId: MANIFEST_ID,
    workflowId: WORKFLOW_ID,
    retentionClass,
    verifiedAt: "2026-08-24T12:00:00.000Z",
    provenance: { receiptType: "ARTIFACT_WRITE", receiptId: MANIFEST_ID },
    items: [
      {
        kind: "BROWSER_SCREENSHOT",
        artifactRef: `artifact:sha256:${SCREENSHOT_SHA}`,
        objectKey: artifactObjectKey(retentionClass, "BROWSER_SCREENSHOT", SCREENSHOT_SHA),
        byteLength: 128,
        sha256: SCREENSHOT_SHA,
        etag: "etag-screenshot",
        uploadedAt: "2026-08-24T11:59:58.000Z",
      },
      {
        kind: "BROWSER_MEASUREMENT",
        artifactRef: `artifact:sha256:${MEASUREMENT_SHA}`,
        objectKey: artifactObjectKey(retentionClass, "BROWSER_MEASUREMENT", MEASUREMENT_SHA),
        byteLength: 256,
        sha256: MEASUREMENT_SHA,
        etag: "etag-measurement",
        uploadedAt: "2026-08-24T11:59:59.000Z",
      },
    ],
  });
}

function request(source = manifest()) {
  return {
    adapterVersion: ARTIFACT_MANIFEST_HEAD_ADAPTER_VERSION,
    requestId: REQUEST_ID,
    receiptId: RECEIPT_ID,
    requestedAt: REQUESTED_AT,
    checkedAt: CHECKED_AT,
    validThrough: VALID_THROUGH,
    expiresAt: source.retentionClass === "SHADOW_30D" ? EXPIRES_AT : null,
    mode: "SHADOW" as const,
    checkerKind: "FIXTURE" as const,
    clockKind: "FIXTURE" as const,
    maxObjectCount: ARTIFACT_MANIFEST_HEAD_MAX_OBJECTS,
    maxFixtureHeadCalls: ARTIFACT_MANIFEST_HEAD_MAX_OBJECTS,
    maxProviderClassBOperations: 0 as const,
    maxCostUsd: 0 as const,
    manifest: source,
  };
}

function matchingObject(source: ArtifactManifest, objectKey: string): ArtifactManifestFixtureHeadObject {
  const item = source.items.find((candidate) => candidate.objectKey === objectKey);
  assert.ok(item);
  return {
    key: item.objectKey,
    size: item.byteLength,
    etag: item.etag,
    uploadedAt: item.uploadedAt,
    storageClass: "STANDARD",
    customMetadata: {
      contractVersion: ARTIFACT_STORE_CONTRACT_VERSION,
      kind: item.kind,
      sha256: item.sha256,
      retentionClass: source.retentionClass,
    },
  };
}

function client(
  source: ArtifactManifest,
  resolve: (object: ArtifactManifestFixtureHeadObject, call: number) => unknown = (object) => object,
) {
  const calls: string[] = [];
  const value: ArtifactManifestFixtureHeadClient = {
    kind: "FIXTURE",
    async head(objectKey) {
      calls.push(objectKey);
      return resolve(matchingObject(source, objectKey), calls.length);
    },
  };
  return { client: value, calls };
}

test("fixture HEAD inspects every manifest object but cannot impersonate an R2 winner", async () => {
  const source = manifest();
  const harness = client(source);
  const result = await inspectArtifactManifestWithFixtureHead(request(source), harness.client);
  assert.deepEqual(ArtifactManifestHeadExecutionSchema.parse(result), result);
  assert.equal(result.state, "MATCHED_FIXTURE");
  assert.equal(result.fixtureHeadCalls, source.items.length);
  assert.equal(result.availabilityReceipt.state, "VERIFIED_PRESENT");
  assert.equal(result.availabilityReceipt.checkerKind, "FIXTURE");
  assert.equal(result.availabilityReceipt.providerReadPerformed, false);
  assert.equal(result.providerClassBOperationsPerformed, 0);
  assert.equal(result.providerOperationsAuthorized, 0);
  assert.equal(result.providerOperationsPerformed, 0);
  assert.equal(result.availabilityPersistenceAuthorized, false);
  assert.equal(result.availabilityPersistencePerformed, false);
  assert.equal(result.retryAuthorized, false);
  assert.equal(result.releaseAuthorized, false);
  assert.equal(result.deletionAuthorized, false);
  assert.equal(result.providerDeleteAuthorized, false);
  assert.equal(result.providerDeletePerformed, false);
  assert.equal(result.costAuthorizedUsd, 0);
  assert.equal(result.costUsd, 0);
  assert.deepEqual(harness.calls, [...source.items]
    .sort((left, right) => left.kind.localeCompare(right.kind, "en-CA") || left.objectKey.localeCompare(right.objectKey, "en-CA"))
    .map((item) => item.objectKey));
  assert.throws(() => selectFreshR2ManifestAvailability({
    manifests: [source],
    receipts: [result.availabilityReceipt],
    snapshotCapturedAt: CHECKED_AT,
  }), /lacks one fresh verified R2 HEAD winner/);
});

test("missing, mismatched, malformed, and failed fixture HEAD results stay explicit and powerless", async () => {
  const source = manifest();
  const missing = client(source, (_object, call) => call === 1 ? null : _object);
  const missingResult = await inspectArtifactManifestWithFixtureHead(request(source), missing.client);
  assert.equal(missingResult.state, "MISSING_FIXTURE");
  assert.equal(missingResult.availabilityReceipt.state, "MISSING");
  assert.equal(missingResult.observations[0]?.failureCode, "OBJECT_MISSING");
  assert.equal(missingResult.observations.length, source.items.length);

  const mismatched = client(source, (object, call) => call === 1 ? { ...object, etag: "drifted-etag" } : object);
  const mismatchResult = await inspectArtifactManifestWithFixtureHead(request(source), mismatched.client);
  assert.equal(mismatchResult.state, "INDETERMINATE_FIXTURE");
  assert.equal(mismatchResult.availabilityReceipt.state, "UNKNOWN");
  assert.equal(mismatchResult.observations[0]?.outcome, "METADATA_MISMATCH");
  assert.equal(mismatchResult.availabilityReceipt.objects[0]?.observedEtag, null);

  const malformed = client(source, (_object, call) => call === 1 ? { key: "partial" } : _object);
  const malformedResult = await inspectArtifactManifestWithFixtureHead(request(source), malformed.client);
  assert.equal(malformedResult.observations[0]?.failureCode, "INVALID_HEAD_RESULT");
  assert.equal(malformedResult.state, "INDETERMINATE_FIXTURE");

  const failed = client(source, (object, call) => {
    if (call === 1) throw new Error("fixture secret must not escape");
    return object;
  });
  const failedResult = await inspectArtifactManifestWithFixtureHead(request(source), failed.client);
  assert.equal(failedResult.observations[0]?.failureCode, "HEAD_CLIENT_ERROR");
  assert.equal(failedResult.state, "INDETERMINATE_FIXTURE");
  assert.doesNotMatch(JSON.stringify(failedResult), /fixture secret/i);
  assert.ok([missingResult, mismatchResult, malformedResult, failedResult].every((result) => (
    result.providerOperationsAuthorized === 0
    && result.providerOperationsPerformed === 0
    && result.availabilityPersistenceAuthorized === false
    && result.releaseAuthorized === false
    && result.deletionAuthorized === false
    && result.costUsd === 0
  )));
});

test("fixture HEAD retries are deterministic and exact metadata drift changes the bound result", async () => {
  const source = manifest();
  const first = await inspectArtifactManifestWithFixtureHead(request(source), client(source).client);
  const second = await inspectArtifactManifestWithFixtureHead(request(source), client(source).client);
  assert.deepEqual(second, first);

  const drifted = await inspectArtifactManifestWithFixtureHead(
    request(source),
    client(source, (object, call) => call === 2 ? { ...object, size: object.size + 1 } : object).client,
  );
  assert.notEqual(drifted.executionDigest, first.executionDigest);
  assert.equal(drifted.state, "INDETERMINATE_FIXTURE");
  assert.throws(
    () => ArtifactManifestHeadExecutionSchema.parse({ ...first, availabilityPersistenceAuthorized: true }),
    /Invalid input|false/i,
  );
});

test("freshness, call caps, and retention expiry fail before the fixture client runs", async () => {
  const source = manifest();
  const harness = client(source);
  await assert.rejects(
    () => inspectArtifactManifestWithFixtureHead({ ...request(source), maxFixtureHeadCalls: 1 }, harness.client),
    /call budget must cover every manifest object/i,
  );
  await assert.rejects(
    () => inspectArtifactManifestWithFixtureHead({ ...request(source), validThrough: "2026-08-24T12:06:01.000Z" }, harness.client),
    /at most five minutes/i,
  );
  await assert.rejects(
    () => inspectArtifactManifestWithFixtureHead({ ...request(source), expiresAt: null }, harness.client),
    /Shadow HEAD checks require an object expiry/i,
  );
  const promoted = manifest("QUALIFICATION_180D");
  await assert.rejects(
    () => inspectArtifactManifestWithFixtureHead({ ...request(promoted), expiresAt: EXPIRES_AT }, harness.client),
    /Promoted HEAD checks cannot invent automatic object expiry/i,
  );
  assert.equal(harness.calls.length, 0);
});
