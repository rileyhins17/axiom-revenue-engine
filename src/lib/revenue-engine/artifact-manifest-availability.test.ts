import assert from "node:assert/strict";
import test from "node:test";

import {
  ARTIFACT_MANIFEST_VERSION,
  ArtifactManifestSchema,
  type ArtifactManifest,
} from "@/lib/revenue-engine/artifact-lifecycle";
import {
  ArtifactManifestAvailabilityReceiptSchema,
  artifactManifestAvailabilityObjectSetDigest,
  createArtifactManifestAvailabilityReceipt,
  selectFreshR2ManifestAvailability,
  type ArtifactManifestObjectAvailability,
} from "@/lib/revenue-engine/artifact-manifest-availability";
import { artifactObjectKey } from "@/lib/revenue-engine/content-addressed-artifact-store";

const CHECKED_AT = "2026-08-24T12:01:00.000Z";
const SNAPSHOT_AT = "2026-08-24T12:02:00.000Z";
const VALID_THROUGH = "2026-08-24T12:04:00.000Z";

function manifest(retentionClass: ArtifactManifest["retentionClass"] = "OUTREACH_ACTIVE") {
  const sha256 = "a".repeat(64);
  return ArtifactManifestSchema.parse({
    manifestVersion: ARTIFACT_MANIFEST_VERSION,
    manifestId: "11111111-1111-4111-8111-111111111111",
    workflowId: "22222222-2222-4222-8222-222222222222",
    retentionClass,
    verifiedAt: "2026-08-24T12:00:00.000Z",
    provenance: { receiptType: "ARTIFACT_WRITE", receiptId: "33333333-3333-4333-8333-333333333333" },
    items: [{
      kind: "BROWSER_SCREENSHOT",
      artifactRef: `artifact:sha256:${sha256}`,
      objectKey: artifactObjectKey(retentionClass, "BROWSER_SCREENSHOT", sha256),
      byteLength: 42,
      sha256,
      etag: "fixture-etag",
      uploadedAt: "2026-08-24T11:59:00.000Z",
    }],
  });
}

function objects(source = manifest()): ArtifactManifestObjectAvailability[] {
  return source.items.map((item) => ({
    kind: item.kind,
    artifactRef: item.artifactRef,
    objectKey: item.objectKey,
    expectedByteLength: item.byteLength,
    expectedSha256: item.sha256,
    expectedEtag: item.etag,
    state: "PRESENT",
    observedByteLength: item.byteLength,
    observedSha256: item.sha256,
    observedEtag: item.etag,
  }));
}

function receipt(options: {
  source?: ArtifactManifest;
  receiptId?: string;
  checkerKind?: "FIXTURE" | "R2_HEAD";
  checkedAt?: string;
  validThrough?: string;
  expiresAt?: string | null;
  objects?: ArtifactManifestObjectAvailability[];
} = {}) {
  const source = options.source ?? manifest();
  return createArtifactManifestAvailabilityReceipt({
    receiptId: options.receiptId ?? "44444444-4444-4444-8444-444444444444",
    manifest: source,
    checkedAt: options.checkedAt ?? CHECKED_AT,
    validThrough: options.validThrough ?? VALID_THROUGH,
    expiresAt: "expiresAt" in options
      ? options.expiresAt ?? null
      : source.retentionClass === "SHADOW_30D" ? "2026-09-20T00:00:00.000Z" : null,
    checkerKind: options.checkerKind ?? "R2_HEAD",
    objects: options.objects ?? objects(source),
  });
}

test("availability v2 binds every exact provider observation and remains zero-authority", () => {
  const source = manifest();
  const value = receipt({ source });
  assert.equal(value.objectSetDigest, artifactManifestAvailabilityObjectSetDigest(value.objects));
  assert.equal(value.providerReadPerformed, true);
  assert.equal(value.providerOperationsAuthorized, false);
  assert.equal(value.releaseAuthorized, false);
  assert.equal(value.deletionAuthorized, false);
  assert.equal(value.costUsd, 0);

  const selected = selectFreshR2ManifestAvailability({ manifests: [source], receipts: [value], snapshotCapturedAt: SNAPSHOT_AT });
  assert.deepEqual(selected.selected, [value]);
  assert.equal(selected.freshUntil, VALID_THROUGH);
  assert.equal(selected.providerOperationsAuthorized, 0);
});

test("availability v2 rejects expected-key-only claims and drifted observed metadata", () => {
  const source = manifest();
  assert.throws(() => createArtifactManifestAvailabilityReceipt({
    receiptId: "55555555-5555-4555-8555-555555555555",
    manifest: source,
    checkedAt: CHECKED_AT,
    validThrough: VALID_THROUGH,
    expiresAt: null,
    checkerKind: "R2_HEAD",
    objects: [{ ...objects(source)[0], observedSha256: "b".repeat(64) }],
  }), /Observed HEAD metadata must match/);

  const valid = receipt({ source });
  assert.throws(() => ArtifactManifestAvailabilityReceiptSchema.parse({
    ...valid,
    objectSetDigest: "c".repeat(64),
  }), /Object-set digest must bind/);
});

test("availability winner selection rejects fixture, future, stale, and ambiguous latest observations", () => {
  const source = manifest();
  assert.throws(() => selectFreshR2ManifestAvailability({
    manifests: [source],
    receipts: [receipt({ source, checkerKind: "FIXTURE" })],
    snapshotCapturedAt: SNAPSHOT_AT,
  }), /lacks one fresh verified R2 HEAD winner/);

  assert.throws(() => selectFreshR2ManifestAvailability({
    manifests: [source],
    receipts: [receipt({ source, checkedAt: "2026-08-24T12:03:00.000Z" })],
    snapshotCapturedAt: SNAPSHOT_AT,
  }), /future availability receipt/);

  assert.throws(() => selectFreshR2ManifestAvailability({
    manifests: [source],
    receipts: [receipt({ source, validThrough: "2026-08-24T12:01:30.000Z" })],
    snapshotCapturedAt: SNAPSHOT_AT,
  }), /stale at the snapshot boundary/);

  assert.throws(() => selectFreshR2ManifestAvailability({
    manifests: [source],
    receipts: [
      receipt({ source }),
      receipt({ source, receiptId: "66666666-6666-4666-8666-666666666666", checkerKind: "FIXTURE" }),
    ],
    snapshotCapturedAt: SNAPSHOT_AT,
  }), /ambiguous latest availability receipt/);
});

test("availability expiry follows the manifest retention contract", () => {
  const protectedManifest = manifest("LEGAL_HOLD");
  assert.throws(() => selectFreshR2ManifestAvailability({
    manifests: [protectedManifest],
    receipts: [receipt({ source: protectedManifest, expiresAt: "2026-09-20T00:00:00.000Z" })],
    snapshotCapturedAt: SNAPSHOT_AT,
  }), /retention expiry contract/);

  const shadowManifest = manifest("SHADOW_30D");
  assert.throws(() => selectFreshR2ManifestAvailability({
    manifests: [shadowManifest],
    receipts: [receipt({ source: shadowManifest, expiresAt: null })],
    snapshotCapturedAt: SNAPSHOT_AT,
  }), /retention expiry contract/);
});
