import { z } from "zod";

import {
  ArtifactManifestSchema,
  artifactManifestDigest,
  type ArtifactManifest,
} from "@/lib/revenue-engine/artifact-lifecycle";
import {
  artifactReferenceCanonicalJson,
  artifactReferenceDigest,
} from "@/lib/revenue-engine/artifact-reference-projection";

export const ARTIFACT_MANIFEST_AVAILABILITY_VERSION = "artifact-manifest-availability-v2";

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const TimestampSchema = z.string().datetime({ offset: true });

export const ArtifactManifestObjectAvailabilitySchema = z.object({
  kind: z.enum(["BROWSER_SCREENSHOT", "BROWSER_MEASUREMENT"]),
  artifactRef: z.string().regex(/^artifact:sha256:[a-f0-9]{64}$/),
  objectKey: z.string().trim().min(1).max(1_024),
  expectedByteLength: z.number().int().positive(),
  expectedSha256: Sha256Schema,
  expectedEtag: z.string().trim().min(1).max(200),
  state: z.enum(["PRESENT", "MISSING", "UNKNOWN"]),
  observedByteLength: z.number().int().positive().nullable(),
  observedSha256: Sha256Schema.nullable(),
  observedEtag: z.string().trim().min(1).max(200).nullable(),
}).strict().superRefine((object, context) => {
  const observed = object.observedByteLength !== null
    && object.observedSha256 !== null
    && object.observedEtag !== null;
  const absent = object.observedByteLength === null
    && object.observedSha256 === null
    && object.observedEtag === null;
  if (object.artifactRef !== `artifact:sha256:${object.expectedSha256}`) {
    context.addIssue({ code: "custom", message: "Availability object reference must match its expected digest.", path: ["artifactRef"] });
  }
  if (object.state === "PRESENT") {
    if (!observed) {
      context.addIssue({ code: "custom", message: "A present object requires complete observed HEAD metadata.", path: ["state"] });
    } else if (
      object.observedByteLength !== object.expectedByteLength
      || object.observedSha256 !== object.expectedSha256
      || object.observedEtag !== object.expectedEtag
    ) {
      context.addIssue({ code: "custom", message: "Observed HEAD metadata must match the exact manifest object.", path: ["observedSha256"] });
    }
  } else if (!absent) {
    context.addIssue({ code: "custom", message: "Missing or unknown objects cannot carry partial observed metadata.", path: ["state"] });
  }
});

export type ArtifactManifestObjectAvailability = z.infer<typeof ArtifactManifestObjectAvailabilitySchema>;

const ArtifactManifestAvailabilityReceiptCoreSchema = z.object({
  availabilityVersion: z.literal(ARTIFACT_MANIFEST_AVAILABILITY_VERSION),
  receiptId: z.string().uuid(),
  manifestId: z.string().uuid(),
  manifestDigest: Sha256Schema,
  state: z.enum(["VERIFIED_PRESENT", "MISSING", "UNKNOWN"]),
  checkedAt: TimestampSchema,
  validThrough: TimestampSchema,
  expiresAt: TimestampSchema.nullable(),
  checkerKind: z.enum(["FIXTURE", "R2_HEAD"]),
  objects: z.array(ArtifactManifestObjectAvailabilitySchema).min(1).max(10),
  objectSetDigest: Sha256Schema,
  providerReadPerformed: z.boolean(),
  providerOperationsAuthorized: z.literal(false),
  releaseAuthorized: z.literal(false),
  deletionAuthorized: z.literal(false),
  costUsd: z.literal(0),
}).strict();

export const ArtifactManifestAvailabilityReceiptSchema = ArtifactManifestAvailabilityReceiptCoreSchema.extend({
  receiptDigest: Sha256Schema,
}).strict().superRefine((receipt, context) => {
  const { receiptDigest: _receiptDigest, ...core } = receipt;
  void _receiptDigest;
  if (receipt.receiptDigest !== artifactReferenceDigest(core)) {
    context.addIssue({ code: "custom", message: "Availability receipt digest must bind the exact per-object observations.", path: ["receiptDigest"] });
  }
  if (receipt.objectSetDigest !== artifactManifestAvailabilityObjectSetDigest(receipt.objects)) {
    context.addIssue({ code: "custom", message: "Object-set digest must bind every exact per-object HEAD observation.", path: ["objectSetDigest"] });
  }
  if (Date.parse(receipt.validThrough) < Date.parse(receipt.checkedAt)) {
    context.addIssue({ code: "custom", message: "Availability validity cannot end before the check.", path: ["validThrough"] });
  }
  if (receipt.expiresAt && Date.parse(receipt.expiresAt) <= Date.parse(receipt.checkedAt)) {
    context.addIssue({ code: "custom", message: "A recorded object expiry must be later than the availability check.", path: ["expiresAt"] });
  }
  if ((receipt.checkerKind === "R2_HEAD") !== receipt.providerReadPerformed) {
    context.addIssue({ code: "custom", message: "Only the R2 HEAD checker may claim provider reads.", path: ["providerReadPerformed"] });
  }
  const identities = receipt.objects.map((object) => `${object.kind}:${object.objectKey}`);
  if (new Set(identities).size !== identities.length) {
    context.addIssue({ code: "custom", message: "Availability object identities must be unique.", path: ["objects"] });
  }
  const sorted = [...receipt.objects].sort(compareAvailabilityObjects);
  if (artifactReferenceCanonicalJson(sorted) !== artifactReferenceCanonicalJson(receipt.objects)) {
    context.addIssue({ code: "custom", message: "Availability objects must use canonical kind and object-key order.", path: ["objects"] });
  }
  const expectedState = receipt.objects.some((object) => object.state === "MISSING")
    ? "MISSING"
    : receipt.objects.some((object) => object.state === "UNKNOWN")
      ? "UNKNOWN"
      : "VERIFIED_PRESENT";
  if (receipt.state !== expectedState) {
    context.addIssue({ code: "custom", message: "Receipt state must be derived from all object observations.", path: ["state"] });
  }
});

export type ArtifactManifestAvailabilityReceipt = z.infer<typeof ArtifactManifestAvailabilityReceiptSchema>;

function compareAvailabilityObjects(left: ArtifactManifestObjectAvailability, right: ArtifactManifestObjectAvailability) {
  return left.kind.localeCompare(right.kind, "en-CA") || left.objectKey.localeCompare(right.objectKey, "en-CA");
}

export function artifactManifestAvailabilityObjectSetDigest(objects: ArtifactManifestObjectAvailability[]) {
  return artifactReferenceDigest([...objects].sort(compareAvailabilityObjects));
}

export function createArtifactManifestAvailabilityReceipt(value: {
  receiptId: string;
  manifest: ArtifactManifest;
  checkedAt: string;
  validThrough: string;
  expiresAt: string | null;
  checkerKind: "FIXTURE" | "R2_HEAD";
  objects: ArtifactManifestObjectAvailability[];
}) {
  const manifest = ArtifactManifestSchema.parse(value.manifest);
  const objects = [...value.objects].sort(compareAvailabilityObjects);
  const state = objects.some((object) => object.state === "MISSING")
    ? "MISSING" as const
    : objects.some((object) => object.state === "UNKNOWN")
      ? "UNKNOWN" as const
      : "VERIFIED_PRESENT" as const;
  const core = ArtifactManifestAvailabilityReceiptCoreSchema.parse({
    availabilityVersion: ARTIFACT_MANIFEST_AVAILABILITY_VERSION,
    receiptId: value.receiptId,
    manifestId: manifest.manifestId,
    manifestDigest: artifactManifestDigest(manifest),
    state,
    checkedAt: value.checkedAt,
    validThrough: value.validThrough,
    expiresAt: value.expiresAt,
    checkerKind: value.checkerKind,
    objects,
    objectSetDigest: artifactManifestAvailabilityObjectSetDigest(objects),
    providerReadPerformed: value.checkerKind === "R2_HEAD",
    providerOperationsAuthorized: false,
    releaseAuthorized: false,
    deletionAuthorized: false,
    costUsd: 0,
  });
  return ArtifactManifestAvailabilityReceiptSchema.parse({ ...core, receiptDigest: artifactReferenceDigest(core) });
}

export function validateArtifactManifestAvailabilityAgainstManifest(value: {
  receipt: unknown;
  manifest: unknown;
  snapshotCapturedAt: string;
}) {
  const receipt = ArtifactManifestAvailabilityReceiptSchema.parse(value.receipt);
  const manifest = ArtifactManifestSchema.parse(value.manifest);
  const snapshotCapturedAt = TimestampSchema.parse(value.snapshotCapturedAt);
  if (receipt.manifestId !== manifest.manifestId || receipt.manifestDigest !== artifactManifestDigest(manifest)) {
    throw new Error(`Availability receipt ${receipt.receiptId} does not bind manifest ${manifest.manifestId}.`);
  }
  const expected = [...manifest.items].sort((left, right) => left.kind.localeCompare(right.kind, "en-CA"));
  if (receipt.objects.length !== expected.length) {
    throw new Error(`Availability receipt ${receipt.receiptId} does not cover every manifest object.`);
  }
  for (const [index, item] of expected.entries()) {
    const observed = receipt.objects[index];
    if (
      !observed
      || observed.kind !== item.kind
      || observed.artifactRef !== item.artifactRef
      || observed.objectKey !== item.objectKey
      || observed.expectedByteLength !== item.byteLength
      || observed.expectedSha256 !== item.sha256
      || observed.expectedEtag !== item.etag
    ) {
      throw new Error(`Availability receipt ${receipt.receiptId} has an incomplete or drifted object set.`);
    }
  }
  const checkedAt = Date.parse(receipt.checkedAt);
  const snapshotAt = Date.parse(snapshotCapturedAt);
  if (checkedAt < Date.parse(manifest.verifiedAt) || checkedAt > snapshotAt) {
    throw new Error(`Availability receipt ${receipt.receiptId} is outside the manifest and snapshot time boundary.`);
  }
  if (Date.parse(receipt.validThrough) < snapshotAt || (receipt.expiresAt && Date.parse(receipt.expiresAt) <= snapshotAt)) {
    throw new Error(`Availability receipt ${receipt.receiptId} is stale at the snapshot boundary.`);
  }
  if ((manifest.retentionClass === "SHADOW_30D") !== (receipt.expiresAt !== null)) {
    throw new Error(`Availability receipt ${receipt.receiptId} does not follow the manifest retention expiry contract.`);
  }
  if (receipt.expiresAt && Date.parse(receipt.validThrough) > Date.parse(receipt.expiresAt)) {
    throw new Error(`Availability receipt ${receipt.receiptId} claims validity beyond object expiry.`);
  }
  return receipt;
}

export function selectFreshR2ManifestAvailability(value: {
  manifests: ArtifactManifest[];
  receipts: ArtifactManifestAvailabilityReceipt[];
  snapshotCapturedAt: string;
}) {
  const manifests = value.manifests.map((manifest) => ArtifactManifestSchema.parse(manifest));
  const receipts = value.receipts.map((receipt) => ArtifactManifestAvailabilityReceiptSchema.parse(receipt));
  const manifestIds = new Set(manifests.map((manifest) => manifest.manifestId));
  if (manifests.length === 0 || manifestIds.size !== manifests.length) {
    throw new Error("Availability selection requires a non-empty unique manifest set.");
  }
  if (receipts.some((receipt) => !manifestIds.has(receipt.manifestId))) {
    throw new Error("Availability source rows contain a receipt outside the validated manifest set.");
  }
  const snapshotAt = Date.parse(value.snapshotCapturedAt);
  if (!Number.isFinite(snapshotAt)) throw new Error("Availability snapshot time is invalid.");

  const selected = manifests.map((manifest) => {
    const candidates = receipts.filter((receipt) => receipt.manifestId === manifest.manifestId);
    if (candidates.length === 0) throw new Error(`Manifest ${manifest.manifestId} has no availability receipt.`);
    if (candidates.some((receipt) => Date.parse(receipt.checkedAt) > snapshotAt)) {
      throw new Error(`Manifest ${manifest.manifestId} has a future availability receipt.`);
    }
    const latestAt = Math.max(...candidates.map((receipt) => Date.parse(receipt.checkedAt)));
    const winners = candidates.filter((receipt) => Date.parse(receipt.checkedAt) === latestAt);
    if (winners.length !== 1) throw new Error(`Manifest ${manifest.manifestId} has an ambiguous latest availability receipt.`);
    const winner = winners[0];
    if (winner.checkerKind !== "R2_HEAD" || !winner.providerReadPerformed || winner.state !== "VERIFIED_PRESENT") {
      throw new Error(`Manifest ${manifest.manifestId} lacks one fresh verified R2 HEAD winner.`);
    }
    return validateArtifactManifestAvailabilityAgainstManifest({
      receipt: winner,
      manifest,
      snapshotCapturedAt: value.snapshotCapturedAt,
    });
  }).sort((left, right) => left.manifestId.localeCompare(right.manifestId, "en-CA"));

  return {
    selected,
    freshUntil: selected.reduce((earliest, receipt) => {
      const boundary = receipt.expiresAt && Date.parse(receipt.expiresAt) < Date.parse(receipt.validThrough)
        ? receipt.expiresAt
        : receipt.validThrough;
      return !earliest || Date.parse(boundary) < Date.parse(earliest) ? boundary : earliest;
    }, null as string | null) as string,
    availabilityDigest: artifactReferenceDigest(selected),
    providerOperationsAuthorized: 0 as const,
    releaseAuthorized: false as const,
    deletionAuthorized: false as const,
    costAuthorizedUsd: 0 as const,
  };
}
