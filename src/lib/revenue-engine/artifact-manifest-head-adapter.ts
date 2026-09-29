import { z } from "zod";

import {
  ARTIFACT_STORE_CONTRACT_VERSION,
  ArtifactKindSchema,
  ArtifactRetentionClassSchema,
} from "@/lib/revenue-engine/content-addressed-artifact-store";
import {
  ArtifactManifestSchema,
  artifactManifestDigest,
} from "@/lib/revenue-engine/artifact-lifecycle";
import {
  ArtifactManifestAvailabilityReceiptSchema,
  createArtifactManifestAvailabilityReceipt,
} from "@/lib/revenue-engine/artifact-manifest-availability";
import {
  artifactReferenceCanonicalJson,
  artifactReferenceDigest,
} from "@/lib/revenue-engine/artifact-reference-projection";

export const ARTIFACT_MANIFEST_HEAD_ADAPTER_VERSION = "artifact-manifest-head-adapter-v1";
export const ARTIFACT_MANIFEST_HEAD_MAX_OBJECTS = 10;
export const ARTIFACT_MANIFEST_HEAD_MAX_FRESHNESS_MS = 5 * 60 * 1_000;

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const TimestampSchema = z.string().datetime({ offset: true });

const FixtureHeadObjectSchema = z.object({
  key: z.string().trim().min(1).max(1_024),
  size: z.number().int().positive(),
  etag: z.string().trim().min(1).max(200),
  uploadedAt: TimestampSchema,
  storageClass: z.literal("STANDARD"),
  customMetadata: z.object({
    contractVersion: z.literal(ARTIFACT_STORE_CONTRACT_VERSION),
    kind: ArtifactKindSchema,
    sha256: Sha256Schema,
    retentionClass: ArtifactRetentionClassSchema,
  }).strict(),
}).strict();

export type ArtifactManifestFixtureHeadObject = z.infer<typeof FixtureHeadObjectSchema>;

export interface ArtifactManifestFixtureHeadClient {
  kind: "FIXTURE";
  head(objectKey: string): Promise<unknown>;
}

export const ArtifactManifestHeadCheckRequestSchema = z.object({
  adapterVersion: z.literal(ARTIFACT_MANIFEST_HEAD_ADAPTER_VERSION),
  requestId: z.string().uuid(),
  receiptId: z.string().uuid(),
  requestedAt: TimestampSchema,
  checkedAt: TimestampSchema,
  validThrough: TimestampSchema,
  expiresAt: TimestampSchema.nullable(),
  mode: z.literal("SHADOW"),
  checkerKind: z.literal("FIXTURE"),
  clockKind: z.literal("FIXTURE"),
  maxObjectCount: z.literal(ARTIFACT_MANIFEST_HEAD_MAX_OBJECTS),
  maxFixtureHeadCalls: z.number().int().min(1).max(ARTIFACT_MANIFEST_HEAD_MAX_OBJECTS),
  maxProviderClassBOperations: z.literal(0),
  maxCostUsd: z.literal(0),
  manifest: ArtifactManifestSchema,
}).strict().superRefine((request, context) => {
  const requestedAt = Date.parse(request.requestedAt);
  const checkedAt = Date.parse(request.checkedAt);
  const validThrough = Date.parse(request.validThrough);
  if (requestedAt > checkedAt || checkedAt < Date.parse(request.manifest.verifiedAt)) {
    context.addIssue({ code: "custom", message: "Fixture HEAD times must follow manifest verification and request order.", path: ["checkedAt"] });
  }
  if (
    validThrough < checkedAt
    || validThrough - checkedAt > ARTIFACT_MANIFEST_HEAD_MAX_FRESHNESS_MS
  ) {
    context.addIssue({ code: "custom", message: "Fixture HEAD freshness must be non-negative and at most five minutes.", path: ["validThrough"] });
  }
  if (request.manifest.items.length > request.maxFixtureHeadCalls) {
    context.addIssue({ code: "custom", message: "Fixture HEAD call budget must cover every manifest object.", path: ["maxFixtureHeadCalls"] });
  }
  if (request.manifest.retentionClass === "SHADOW_30D") {
    if (!request.expiresAt || Date.parse(request.expiresAt) <= validThrough) {
      context.addIssue({ code: "custom", message: "Shadow HEAD checks require an object expiry later than the freshness window.", path: ["expiresAt"] });
    }
  } else if (request.expiresAt !== null) {
    context.addIssue({ code: "custom", message: "Promoted HEAD checks cannot invent automatic object expiry.", path: ["expiresAt"] });
  }
});

export type ArtifactManifestHeadCheckRequest = z.infer<typeof ArtifactManifestHeadCheckRequestSchema>;

const HeadObservationCoreSchema = z.object({
  kind: ArtifactKindSchema,
  objectKey: z.string().trim().min(1).max(1_024),
  outcome: z.enum(["MATCHED", "MISSING", "METADATA_MISMATCH", "INVALID_RESULT", "CLIENT_ERROR"]),
  observedObject: FixtureHeadObjectSchema.nullable(),
  failureCode: z.enum(["OBJECT_MISSING", "OBJECT_METADATA_MISMATCH", "INVALID_HEAD_RESULT", "HEAD_CLIENT_ERROR"]).nullable(),
}).strict();

const HeadObservationSchema = HeadObservationCoreSchema.extend({
  observationDigest: Sha256Schema,
}).strict().superRefine((observation, context) => {
  const { observationDigest: _digest, ...coreValue } = observation;
  void _digest;
  const core = HeadObservationCoreSchema.parse(coreValue);
  if (observation.observationDigest !== artifactReferenceDigest(core)) {
    context.addIssue({ code: "custom", message: "Fixture HEAD observation digest must bind its exact result.", path: ["observationDigest"] });
  }
  if (
    (observation.outcome === "MATCHED" || observation.outcome === "METADATA_MISMATCH")
      !== (observation.observedObject !== null)
  ) {
    context.addIssue({ code: "custom", message: "Only parsed fixture HEAD objects may carry observed metadata.", path: ["observedObject"] });
  }
  const expectedFailure = observation.outcome === "MATCHED"
    ? null
    : observation.outcome === "MISSING"
      ? "OBJECT_MISSING"
      : observation.outcome === "METADATA_MISMATCH"
        ? "OBJECT_METADATA_MISMATCH"
        : observation.outcome === "INVALID_RESULT"
          ? "INVALID_HEAD_RESULT"
          : "HEAD_CLIENT_ERROR";
  if (observation.failureCode !== expectedFailure) {
    context.addIssue({ code: "custom", message: "Fixture HEAD failure code must match its bounded outcome.", path: ["failureCode"] });
  }
});

const HeadExecutionCoreSchema = z.object({
  adapterVersion: z.literal(ARTIFACT_MANIFEST_HEAD_ADAPTER_VERSION),
  executionId: z.string().uuid(),
  requestDigest: Sha256Schema,
  manifestDigest: Sha256Schema,
  availabilityReceiptDigest: Sha256Schema,
  observationsDigest: Sha256Schema,
  state: z.enum(["MATCHED_FIXTURE", "MISSING_FIXTURE", "INDETERMINATE_FIXTURE"]),
  fixtureHeadCalls: z.number().int().min(1).max(ARTIFACT_MANIFEST_HEAD_MAX_OBJECTS),
  providerClassBOperationsPerformed: z.literal(0),
  costUsd: z.literal(0),
}).strict();

export const ArtifactManifestHeadExecutionSchema = HeadExecutionCoreSchema.extend({
  executionDigest: Sha256Schema,
  request: ArtifactManifestHeadCheckRequestSchema,
  observations: z.array(HeadObservationSchema).min(1).max(ARTIFACT_MANIFEST_HEAD_MAX_OBJECTS),
  availabilityReceipt: ArtifactManifestAvailabilityReceiptSchema,
  checkerKind: z.literal("FIXTURE"),
  providerReadPerformed: z.literal(false),
  providerOperationsAuthorized: z.literal(0),
  providerOperationsPerformed: z.literal(0),
  availabilityPersistenceAuthorized: z.literal(false),
  availabilityPersistencePerformed: z.literal(false),
  retryAuthorized: z.literal(false),
  releaseAuthorized: z.literal(false),
  deletionAuthorized: z.literal(false),
  providerDeleteAuthorized: z.literal(false),
  providerDeletePerformed: z.literal(false),
  costAuthorizedUsd: z.literal(0),
}).strict().superRefine((execution, context) => {
  const core = HeadExecutionCoreSchema.parse({
    adapterVersion: execution.adapterVersion,
    executionId: execution.executionId,
    requestDigest: execution.requestDigest,
    manifestDigest: execution.manifestDigest,
    availabilityReceiptDigest: execution.availabilityReceiptDigest,
    observationsDigest: execution.observationsDigest,
    state: execution.state,
    fixtureHeadCalls: execution.fixtureHeadCalls,
    providerClassBOperationsPerformed: execution.providerClassBOperationsPerformed,
    costUsd: execution.costUsd,
  });
  if (execution.executionDigest !== artifactReferenceDigest({ core, request: execution.request, observations: execution.observations, availabilityReceipt: execution.availabilityReceipt })) {
    context.addIssue({ code: "custom", message: "Fixture HEAD execution digest must bind its complete request and result.", path: ["executionDigest"] });
  }
  if (
    execution.requestDigest !== artifactReferenceDigest(execution.request)
    || execution.manifestDigest !== artifactManifestDigest(execution.request.manifest)
    || execution.availabilityReceiptDigest !== execution.availabilityReceipt.receiptDigest
    || execution.observationsDigest !== artifactReferenceDigest(execution.observations)
  ) {
    context.addIssue({ code: "custom", message: "Fixture HEAD execution identities must bind their exact request, manifest, observations, and availability receipt.", path: ["requestDigest"] });
  }
  const orderedItems = [...execution.request.manifest.items]
    .sort((left, right) => left.kind.localeCompare(right.kind, "en-CA") || left.objectKey.localeCompare(right.objectKey, "en-CA"));
  if (
    execution.fixtureHeadCalls !== orderedItems.length
    || execution.observations.length !== orderedItems.length
    || execution.observations.some((observation, index) => (
      observation.kind !== orderedItems[index]?.kind || observation.objectKey !== orderedItems[index]?.objectKey
    ))
  ) {
    context.addIssue({ code: "custom", message: "Fixture HEAD execution must attempt every manifest object exactly once in canonical order.", path: ["observations"] });
  }
  const expectedState = execution.observations.some((observation) => observation.outcome === "MISSING")
    ? "MISSING_FIXTURE"
    : execution.observations.every((observation) => observation.outcome === "MATCHED")
      ? "MATCHED_FIXTURE"
      : "INDETERMINATE_FIXTURE";
  const receiptState = expectedState === "MISSING_FIXTURE"
    ? "MISSING"
    : expectedState === "MATCHED_FIXTURE"
      ? "VERIFIED_PRESENT"
      : "UNKNOWN";
  if (execution.state !== expectedState || execution.availabilityReceipt.state !== receiptState) {
    context.addIssue({ code: "custom", message: "Fixture HEAD execution and availability states must derive from all exact observations.", path: ["state"] });
  }
  if (
    execution.availabilityReceipt.receiptId !== execution.request.receiptId
    || execution.availabilityReceipt.manifestId !== execution.request.manifest.manifestId
    || execution.availabilityReceipt.manifestDigest !== execution.manifestDigest
    || execution.availabilityReceipt.checkedAt !== execution.request.checkedAt
    || execution.availabilityReceipt.validThrough !== execution.request.validThrough
    || execution.availabilityReceipt.expiresAt !== execution.request.expiresAt
    || execution.availabilityReceipt.checkerKind !== "FIXTURE"
    || execution.availabilityReceipt.providerReadPerformed
  ) {
    context.addIssue({ code: "custom", message: "Fixture HEAD availability receipt must mirror its exact zero-provider request.", path: ["availabilityReceipt"] });
  }
});

export type ArtifactManifestHeadExecution = z.infer<typeof ArtifactManifestHeadExecutionSchema>;

function observation(
  item: ArtifactManifestHeadCheckRequest["manifest"]["items"][number],
  outcome: z.infer<typeof HeadObservationCoreSchema>["outcome"],
  observedObject: ArtifactManifestFixtureHeadObject | null,
) {
  const failureCode = outcome === "MATCHED"
    ? null
    : outcome === "MISSING"
      ? "OBJECT_MISSING"
      : outcome === "METADATA_MISMATCH"
        ? "OBJECT_METADATA_MISMATCH"
        : outcome === "INVALID_RESULT"
          ? "INVALID_HEAD_RESULT"
          : "HEAD_CLIENT_ERROR";
  const core = HeadObservationCoreSchema.parse({
    kind: item.kind,
    objectKey: item.objectKey,
    outcome,
    observedObject,
    failureCode,
  });
  return HeadObservationSchema.parse({ ...core, observationDigest: artifactReferenceDigest(core) });
}

function objectMatches(
  request: ArtifactManifestHeadCheckRequest,
  item: ArtifactManifestHeadCheckRequest["manifest"]["items"][number],
  object: ArtifactManifestFixtureHeadObject,
) {
  return object.key === item.objectKey
    && object.size === item.byteLength
    && object.etag === item.etag
    && object.uploadedAt === item.uploadedAt
    && object.storageClass === "STANDARD"
    && artifactReferenceCanonicalJson(object.customMetadata) === artifactReferenceCanonicalJson({
      contractVersion: ARTIFACT_STORE_CONTRACT_VERSION,
      kind: item.kind,
      sha256: item.sha256,
      retentionClass: request.manifest.retentionClass,
    });
}

export async function inspectArtifactManifestWithFixtureHead(
  value: unknown,
  client: ArtifactManifestFixtureHeadClient,
): Promise<ArtifactManifestHeadExecution> {
  const request = ArtifactManifestHeadCheckRequestSchema.parse(value);
  if (client.kind !== "FIXTURE") throw new Error("Artifact manifest HEAD adapter version 1 accepts fixture clients only.");
  const items = [...request.manifest.items]
    .sort((left, right) => left.kind.localeCompare(right.kind, "en-CA") || left.objectKey.localeCompare(right.objectKey, "en-CA"));
  const observations: z.infer<typeof HeadObservationSchema>[] = [];
  for (const item of items) {
    try {
      const result = await client.head(item.objectKey);
      if (result === null || result === undefined) {
        observations.push(observation(item, "MISSING", null));
        continue;
      }
      const parsed = FixtureHeadObjectSchema.safeParse(result);
      if (!parsed.success) {
        observations.push(observation(item, "INVALID_RESULT", null));
        continue;
      }
      observations.push(observation(
        item,
        objectMatches(request, item, parsed.data) ? "MATCHED" : "METADATA_MISMATCH",
        parsed.data,
      ));
    } catch {
      observations.push(observation(item, "CLIENT_ERROR", null));
    }
  }

  const availabilityObjects = observations.map((headObservation, index) => {
    const item = items[index]!;
    const matched = headObservation.outcome === "MATCHED";
    return {
      kind: item.kind,
      artifactRef: item.artifactRef,
      objectKey: item.objectKey,
      expectedByteLength: item.byteLength,
      expectedSha256: item.sha256,
      expectedEtag: item.etag,
      state: matched ? "PRESENT" as const : headObservation.outcome === "MISSING" ? "MISSING" as const : "UNKNOWN" as const,
      observedByteLength: matched ? item.byteLength : null,
      observedSha256: matched ? item.sha256 : null,
      observedEtag: matched ? item.etag : null,
    };
  });
  const availabilityReceipt = createArtifactManifestAvailabilityReceipt({
    receiptId: request.receiptId,
    manifest: request.manifest,
    checkedAt: request.checkedAt,
    validThrough: request.validThrough,
    expiresAt: request.expiresAt,
    checkerKind: "FIXTURE",
    objects: availabilityObjects,
  });
  const state = observations.some((headObservation) => headObservation.outcome === "MISSING")
    ? "MISSING_FIXTURE"
    : observations.every((headObservation) => headObservation.outcome === "MATCHED")
      ? "MATCHED_FIXTURE"
      : "INDETERMINATE_FIXTURE";
  const core = HeadExecutionCoreSchema.parse({
    adapterVersion: request.adapterVersion,
    executionId: request.requestId,
    requestDigest: artifactReferenceDigest(request),
    manifestDigest: artifactManifestDigest(request.manifest),
    availabilityReceiptDigest: availabilityReceipt.receiptDigest,
    observationsDigest: artifactReferenceDigest(observations),
    state,
    fixtureHeadCalls: observations.length,
    providerClassBOperationsPerformed: 0,
    costUsd: 0,
  });
  return ArtifactManifestHeadExecutionSchema.parse({
    ...core,
    executionDigest: artifactReferenceDigest({ core, request, observations, availabilityReceipt }),
    request,
    observations,
    availabilityReceipt,
    checkerKind: "FIXTURE",
    providerReadPerformed: false,
    providerOperationsAuthorized: 0,
    providerOperationsPerformed: 0,
    availabilityPersistenceAuthorized: false,
    availabilityPersistencePerformed: false,
    retryAuthorized: false,
    releaseAuthorized: false,
    deletionAuthorized: false,
    providerDeleteAuthorized: false,
    providerDeletePerformed: false,
    costAuthorizedUsd: 0,
  });
}
