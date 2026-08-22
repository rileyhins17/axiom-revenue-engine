import { createHash } from "node:crypto";

import { z } from "zod";

import {
  BrowserMeasurementDraftSchema,
  type BrowserMeasurementDraft,
} from "@/lib/revenue-engine/browser-measurement-adapter";

export const ARTIFACT_STORE_CONTRACT_VERSION = "content-addressed-artifact-store-v1";
export const ARTIFACT_KEY_VERSION = "v1";
export const ARTIFACT_MAX_BATCH_ITEMS = 10;
export const ARTIFACT_MAX_ITEM_BYTES = 5_242_880;
export const ARTIFACT_MAX_BATCH_BYTES = 12_582_912;

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const BytesSchema = z.custom<Uint8Array>(
  (value) => value instanceof Uint8Array,
  "Artifact bytes must be a Uint8Array.",
);

export const ArtifactKindSchema = z.enum([
  "BROWSER_SCREENSHOT",
  "BROWSER_MEASUREMENT",
]);

export const ArtifactRetentionClassSchema = z.enum([
  "SHADOW_30D",
  "QUALIFICATION_180D",
  "OUTREACH_ACTIVE",
  "LEGAL_HOLD",
]);

export const ARTIFACT_RETENTION_POLICIES = {
  SHADOW_30D: {
    keyPrefix: "shadow/30d/v1/",
    lifecycleExpirationDays: 30,
    automaticDeletion: true,
    requiresOwnerRelease: false,
  },
  QUALIFICATION_180D: {
    keyPrefix: "qualification/180d/v1/",
    lifecycleExpirationDays: 180,
    automaticDeletion: true,
    requiresOwnerRelease: false,
  },
  OUTREACH_ACTIVE: {
    keyPrefix: "outreach/active/v1/",
    lifecycleExpirationDays: null,
    automaticDeletion: false,
    requiresOwnerRelease: true,
  },
  LEGAL_HOLD: {
    keyPrefix: "legal-hold/v1/",
    lifecycleExpirationDays: null,
    automaticDeletion: false,
    requiresOwnerRelease: true,
  },
} as const;

export type ArtifactRetentionClass = z.infer<typeof ArtifactRetentionClassSchema>;

export function plannedArtifactLifecycleRules() {
  return [
    {
      id: "expire-shadow-evidence-after-30-days",
      enabled: true as const,
      prefix: ARTIFACT_RETENTION_POLICIES.SHADOW_30D.keyPrefix,
      expireAfterDays: ARTIFACT_RETENTION_POLICIES.SHADOW_30D.lifecycleExpirationDays,
    },
    {
      id: "expire-uncontacted-qualification-evidence-after-180-days",
      enabled: true as const,
      prefix: ARTIFACT_RETENTION_POLICIES.QUALIFICATION_180D.keyPrefix,
      expireAfterDays: ARTIFACT_RETENTION_POLICIES.QUALIFICATION_180D.lifecycleExpirationDays,
    },
  ];
}

const ArtifactHttpMetadataSchema = z
  .object({
    contentType: z.enum(["image/webp", "application/json"]),
    cacheControl: z.literal("private, no-store"),
  })
  .strict();

const ArtifactCustomMetadataSchema = z
  .object({
    contractVersion: z.literal(ARTIFACT_STORE_CONTRACT_VERSION),
    kind: ArtifactKindSchema,
    sha256: Sha256Schema,
    retentionClass: ArtifactRetentionClassSchema,
  })
  .strict();

const ArtifactWriteItemSchema = z
  .object({
    kind: ArtifactKindSchema,
    mediaType: z.enum(["image/webp", "application/json"]),
    bytes: BytesSchema,
    byteLength: z.number().int().positive().max(ARTIFACT_MAX_ITEM_BYTES),
    sha256: Sha256Schema,
    artifactRef: z.string().regex(/^artifact:sha256:[a-f0-9]{64}$/),
    objectKey: z.string().trim().min(1).max(1_024),
    storageClass: z.literal("STANDARD"),
    writeCondition: z.literal("IF_ABSENT"),
    httpMetadata: ArtifactHttpMetadataSchema,
    customMetadata: ArtifactCustomMetadataSchema,
  })
  .strict()
  .superRefine((item, context) => {
    if (item.byteLength !== item.bytes.byteLength || item.sha256 !== sha256(item.bytes)) {
      context.addIssue({
        code: "custom",
        message: "Artifact bytes, length, and SHA-256 digest must agree.",
        path: ["sha256"],
      });
    }
    if (item.artifactRef !== `artifact:sha256:${item.sha256}`) {
      context.addIssue({
        code: "custom",
        message: "Artifact reference must be derived from the content digest.",
        path: ["artifactRef"],
      });
    }
    if (item.objectKey !== artifactObjectKey(item.customMetadata.retentionClass, item.kind, item.sha256)) {
      context.addIssue({
        code: "custom",
        message: "Artifact object key must be derived from retention class, kind, and digest.",
        path: ["objectKey"],
      });
    }
    if (
      item.mediaType !== item.httpMetadata.contentType
      || item.kind !== item.customMetadata.kind
      || item.sha256 !== item.customMetadata.sha256
    ) {
      context.addIssue({
        code: "custom",
        message: "Artifact metadata must describe the exact content-addressed item.",
        path: ["customMetadata"],
      });
    }
  });

export const ArtifactWritePlanSchema = z
  .object({
    contractVersion: z.literal(ARTIFACT_STORE_CONTRACT_VERSION),
    planId: z.string().uuid(),
    workflowId: z.string().uuid(),
    createdAt: z.string().datetime({ offset: true }),
    mode: z.literal("SHADOW"),
    storeKind: z.literal("FIXTURE"),
    providerWriteAuthorized: z.literal(false),
    maxCostUsd: z.literal(0),
    retentionClass: z.literal("SHADOW_30D"),
    items: z.array(ArtifactWriteItemSchema).min(1).max(ARTIFACT_MAX_BATCH_ITEMS),
    totalBytes: z.number().int().positive().max(ARTIFACT_MAX_BATCH_BYTES),
    rollbackPolicy: z.literal("KEEP_CONTENT_ADDRESSED_ORPHANS_FOR_LIFECYCLE"),
  })
  .strict()
  .superRefine((plan, context) => {
    const totalBytes = plan.items.reduce((sum, item) => sum + item.byteLength, 0);
    if (plan.totalBytes !== totalBytes) {
      context.addIssue({ code: "custom", message: "Artifact plan total bytes must match its items.", path: ["totalBytes"] });
    }
    if (new Set(plan.items.map((item) => item.objectKey)).size !== plan.items.length) {
      context.addIssue({ code: "custom", message: "Artifact plan object keys must be unique.", path: ["items"] });
    }
    if (plan.items.some((item) => item.customMetadata.retentionClass !== plan.retentionClass)) {
      context.addIssue({ code: "custom", message: "Every artifact item must use the plan retention class.", path: ["items"] });
    }
  });

export type ArtifactWritePlan = z.infer<typeof ArtifactWritePlanSchema>;

const StoredArtifactObjectSchema = z
  .object({
    objectKey: z.string().trim().min(1).max(1_024),
    byteLength: z.number().int().positive().max(ARTIFACT_MAX_ITEM_BYTES),
    sha256: Sha256Schema,
    etag: z.string().trim().min(1).max(200),
    uploadedAt: z.string().datetime({ offset: true }),
    storageClass: z.literal("STANDARD"),
    httpMetadata: ArtifactHttpMetadataSchema,
    customMetadata: ArtifactCustomMetadataSchema,
  })
  .strict();

const FixturePutRequestSchema = z
  .object({
    storeKind: z.literal("FIXTURE"),
    providerWriteAuthorized: z.literal(false),
    objectKey: z.string().trim().min(1).max(1_024),
    bytes: BytesSchema,
    byteLength: z.number().int().positive().max(ARTIFACT_MAX_ITEM_BYTES),
    sha256: Sha256Schema,
    storageClass: z.literal("STANDARD"),
    ifNoneMatch: z.literal("*"),
    httpMetadata: ArtifactHttpMetadataSchema,
    customMetadata: ArtifactCustomMetadataSchema,
  })
  .strict();

export type FixturePutRequest = z.infer<typeof FixturePutRequestSchema>;

const FixturePutResultSchema = z.discriminatedUnion("outcome", [
  z.object({ outcome: z.literal("CREATED"), object: StoredArtifactObjectSchema }).strict(),
  z.object({ outcome: z.literal("ALREADY_EXISTS"), object: z.null() }).strict(),
]);

export interface FixtureArtifactStore {
  kind: "FIXTURE";
  putIfAbsent(request: FixturePutRequest): Promise<unknown>;
  head(objectKey: string): Promise<unknown>;
}

const ArtifactWriteItemReceiptSchema = z
  .object({
    kind: ArtifactKindSchema,
    artifactRef: z.string().regex(/^artifact:sha256:[a-f0-9]{64}$/),
    objectKey: z.string().trim().min(1).max(1_024),
    byteLength: z.number().int().positive().max(ARTIFACT_MAX_ITEM_BYTES),
    sha256: Sha256Schema,
    operation: z.enum(["CREATED", "REUSED"]),
    etag: z.string().trim().min(1).max(200),
    uploadedAt: z.string().datetime({ offset: true }),
  })
  .strict();

const ArtifactWriteReceiptBaseSchema = z.object({
  contractVersion: z.literal(ARTIFACT_STORE_CONTRACT_VERSION),
  planId: z.string().uuid(),
  workflowId: z.string().uuid(),
  mode: z.literal("SHADOW"),
  storeKind: z.literal("FIXTURE"),
  providerWritePerformed: z.literal(false),
  retentionClass: z.literal("SHADOW_30D"),
  startedAt: z.string().datetime({ offset: true }),
  completedAt: z.string().datetime({ offset: true }),
  plannedItemCount: z.number().int().positive().max(ARTIFACT_MAX_BATCH_ITEMS),
  fixturePutAttempts: z.number().int().nonnegative().max(ARTIFACT_MAX_BATCH_ITEMS),
  fixtureHeadReads: z.number().int().nonnegative().max(ARTIFACT_MAX_BATCH_ITEMS),
  providerClassAOperations: z.literal(0),
  providerClassBOperations: z.literal(0),
  costUsd: z.literal(0),
  rollbackAction: z.literal("NONE_KEEP_CONTENT_ADDRESSED_ORPHANS"),
});

export const ArtifactWriteReceiptSchema = z.discriminatedUnion("outcome", [
  ArtifactWriteReceiptBaseSchema.extend({
    outcome: z.literal("COMPLETED"),
    items: z.array(ArtifactWriteItemReceiptSchema).min(1).max(ARTIFACT_MAX_BATCH_ITEMS),
    failure: z.null(),
  }).strict().superRefine((receipt, context) => {
    if (receipt.items.length !== receipt.plannedItemCount) {
      context.addIssue({ code: "custom", message: "Completed artifact receipt must contain every planned item.", path: ["items"] });
    }
    if (new Set(receipt.items.map((item) => item.kind)).size !== receipt.items.length) {
      context.addIssue({ code: "custom", message: "Completed artifact receipt kinds must be unique.", path: ["items"] });
    }
  }),
  ArtifactWriteReceiptBaseSchema.extend({
    outcome: z.literal("FAILED"),
    items: z.array(ArtifactWriteItemReceiptSchema).max(ARTIFACT_MAX_BATCH_ITEMS),
    failure: z.object({
      itemIndex: z.number().int().nonnegative().max(ARTIFACT_MAX_BATCH_ITEMS - 1),
      code: z.enum(["STORE_ERROR", "INVALID_RECEIPT", "EXISTING_OBJECT_MISMATCH"]),
      message: z.string().trim().min(1).max(240),
    }).strict(),
  }).strict(),
]).superRefine((receipt, context) => {
  if (receipt.fixtureHeadReads > receipt.fixturePutAttempts) {
    context.addIssue({ code: "custom", message: "Fixture head reads cannot exceed put attempts.", path: ["fixtureHeadReads"] });
  }
  if (receipt.outcome === "COMPLETED" && receipt.fixturePutAttempts !== receipt.plannedItemCount) {
    context.addIssue({ code: "custom", message: "Completed artifact receipt must attempt every planned item.", path: ["fixturePutAttempts"] });
  }
  if (receipt.outcome === "FAILED" && (
    receipt.failure.itemIndex >= receipt.plannedItemCount
    || receipt.items.length !== receipt.failure.itemIndex
    || receipt.fixturePutAttempts !== receipt.failure.itemIndex + 1
  )) {
    context.addIssue({ code: "custom", message: "Failed artifact receipt must identify the next sequential item.", path: ["failure", "itemIndex"] });
  }
});

export type ArtifactWriteReceipt = z.infer<typeof ArtifactWriteReceiptSchema>;

function sha256(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

function artifactKindSegment(kind: z.infer<typeof ArtifactKindSchema>) {
  return kind === "BROWSER_SCREENSHOT" ? "browser-screenshot" : "browser-measurement";
}

function artifactExtension(kind: z.infer<typeof ArtifactKindSchema>) {
  return kind === "BROWSER_SCREENSHOT" ? "webp" : "json";
}

export function artifactObjectKey(
  retentionClass: ArtifactRetentionClass,
  kind: z.infer<typeof ArtifactKindSchema>,
  digest: string,
) {
  const sha = Sha256Schema.parse(digest);
  const policy = ARTIFACT_RETENTION_POLICIES[retentionClass];
  return `${policy.keyPrefix}${artifactKindSegment(kind)}/${sha.slice(0, 2)}/${sha}.${artifactExtension(kind)}`;
}

function writeItem(
  retentionClass: "SHADOW_30D",
  kind: z.infer<typeof ArtifactKindSchema>,
  mediaType: "image/webp" | "application/json",
  bytes: Uint8Array,
  expectedLength: number,
  expectedDigest: string,
) {
  if (bytes.byteLength !== expectedLength || sha256(bytes) !== expectedDigest) {
    throw new Error("Browser draft artifact integrity failed before storage planning.");
  }
  return ArtifactWriteItemSchema.parse({
    kind,
    mediaType,
    bytes,
    byteLength: bytes.byteLength,
    sha256: expectedDigest,
    artifactRef: `artifact:sha256:${expectedDigest}`,
    objectKey: artifactObjectKey(retentionClass, kind, expectedDigest),
    storageClass: "STANDARD",
    writeCondition: "IF_ABSENT",
    httpMetadata: { contentType: mediaType, cacheControl: "private, no-store" },
    customMetadata: {
      contractVersion: ARTIFACT_STORE_CONTRACT_VERSION,
      kind,
      sha256: expectedDigest,
      retentionClass,
    },
  });
}

export function createBrowserArtifactWritePlan(value: BrowserMeasurementDraft): ArtifactWritePlan {
  const draft = BrowserMeasurementDraftSchema.parse(value);
  if (draft.outcome !== "CAPTURED") {
    throw new Error("Only a captured Browser measurement draft can create an artifact plan.");
  }
  const items = [
    writeItem(
      "SHADOW_30D",
      "BROWSER_SCREENSHOT",
      draft.screenshot.mediaType,
      draft.screenshot.bytes,
      draft.screenshot.byteLength,
      draft.screenshot.sha256,
    ),
    writeItem(
      "SHADOW_30D",
      "BROWSER_MEASUREMENT",
      draft.measurement.mediaType,
      draft.measurement.bytes,
      draft.measurement.byteLength,
      draft.measurement.sha256,
    ),
  ];
  return ArtifactWritePlanSchema.parse({
    contractVersion: ARTIFACT_STORE_CONTRACT_VERSION,
    planId: draft.request.requestId,
    workflowId: draft.request.workflowId,
    createdAt: draft.capturedAt,
    mode: "SHADOW",
    storeKind: "FIXTURE",
    providerWriteAuthorized: false,
    maxCostUsd: 0,
    retentionClass: "SHADOW_30D",
    items,
    totalBytes: items.reduce((sum, item) => sum + item.byteLength, 0),
    rollbackPolicy: "KEEP_CONTENT_ADDRESSED_ORPHANS_FOR_LIFECYCLE",
  });
}

function validateStoredObject(item: z.infer<typeof ArtifactWriteItemSchema>, value: unknown) {
  const object = StoredArtifactObjectSchema.parse(value);
  if (
    object.objectKey !== item.objectKey
    || object.byteLength !== item.byteLength
    || object.sha256 !== item.sha256
    || object.storageClass !== item.storageClass
    || object.httpMetadata.contentType !== item.httpMetadata.contentType
    || object.httpMetadata.cacheControl !== item.httpMetadata.cacheControl
    || JSON.stringify(object.customMetadata) !== JSON.stringify(item.customMetadata)
  ) {
    throw new Error("Stored content-addressed object does not match the planned artifact.");
  }
  return object;
}

function failureCode(error: unknown) {
  if (error instanceof z.ZodError) return "INVALID_RECEIPT" as const;
  if (error instanceof Error && error.message.includes("does not match")) return "EXISTING_OBJECT_MISMATCH" as const;
  return "STORE_ERROR" as const;
}

export async function executeFixtureArtifactWritePlan(
  value: ArtifactWritePlan,
  dependencies: { store: FixtureArtifactStore; now?: () => Date },
): Promise<ArtifactWriteReceipt> {
  const plan = ArtifactWritePlanSchema.parse(value);
  if (dependencies.store.kind !== "FIXTURE") {
    throw new Error("Artifact store contract version 1 accepts fixture stores only.");
  }
  const now = dependencies.now || (() => new Date());
  const startedAt = now().toISOString();
  const items: z.infer<typeof ArtifactWriteItemReceiptSchema>[] = [];
  let fixturePutAttempts = 0;
  let fixtureHeadReads = 0;

  for (const [itemIndex, item] of plan.items.entries()) {
    try {
      fixturePutAttempts += 1;
      const result = FixturePutResultSchema.parse(await dependencies.store.putIfAbsent(FixturePutRequestSchema.parse({
        storeKind: "FIXTURE",
        providerWriteAuthorized: false,
        objectKey: item.objectKey,
        bytes: item.bytes,
        byteLength: item.byteLength,
        sha256: item.sha256,
        storageClass: item.storageClass,
        ifNoneMatch: "*",
        httpMetadata: item.httpMetadata,
        customMetadata: item.customMetadata,
      })));
      let operation: "CREATED" | "REUSED";
      let object: z.infer<typeof StoredArtifactObjectSchema>;
      if (result.outcome === "CREATED") {
        operation = "CREATED";
        object = validateStoredObject(item, result.object);
      } else {
        operation = "REUSED";
        fixtureHeadReads += 1;
        object = validateStoredObject(item, await dependencies.store.head(item.objectKey));
      }
      items.push(ArtifactWriteItemReceiptSchema.parse({
        kind: item.kind,
        artifactRef: item.artifactRef,
        objectKey: object.objectKey,
        byteLength: object.byteLength,
        sha256: object.sha256,
        operation,
        etag: object.etag,
        uploadedAt: object.uploadedAt,
      }));
    } catch (error) {
      return ArtifactWriteReceiptSchema.parse({
        contractVersion: ARTIFACT_STORE_CONTRACT_VERSION,
        planId: plan.planId,
        workflowId: plan.workflowId,
        mode: plan.mode,
        storeKind: "FIXTURE",
        providerWritePerformed: false,
        retentionClass: plan.retentionClass,
        startedAt,
        completedAt: now().toISOString(),
        plannedItemCount: plan.items.length,
        fixturePutAttempts,
        fixtureHeadReads,
        providerClassAOperations: 0,
        providerClassBOperations: 0,
        costUsd: 0,
        rollbackAction: "NONE_KEEP_CONTENT_ADDRESSED_ORPHANS",
        outcome: "FAILED",
        items,
        failure: {
          itemIndex,
          code: failureCode(error),
          message: error instanceof Error ? error.message.slice(0, 240) : "Fixture artifact store failed.",
        },
      });
    }
  }

  return ArtifactWriteReceiptSchema.parse({
    contractVersion: ARTIFACT_STORE_CONTRACT_VERSION,
    planId: plan.planId,
    workflowId: plan.workflowId,
    mode: plan.mode,
    storeKind: "FIXTURE",
    providerWritePerformed: false,
    retentionClass: plan.retentionClass,
    startedAt,
    completedAt: now().toISOString(),
    plannedItemCount: plan.items.length,
    fixturePutAttempts,
    fixtureHeadReads,
    providerClassAOperations: 0,
    providerClassBOperations: 0,
    costUsd: 0,
    rollbackAction: "NONE_KEEP_CONTENT_ADDRESSED_ORPHANS",
    outcome: "COMPLETED",
    items,
    failure: null,
  });
}

export function browserArtifactRefsFromReceipt(
  planValue: unknown,
  receiptValue: unknown,
) {
  const plan = ArtifactWritePlanSchema.parse(planValue);
  const receipt = ArtifactWriteReceiptSchema.parse(receiptValue);
  if (receipt.outcome !== "COMPLETED") throw new Error("Failed artifact writes cannot produce Browser evidence references.");
  if (receipt.planId !== plan.planId || receipt.workflowId !== plan.workflowId) {
    throw new Error("Artifact receipt does not belong to this Browser measurement plan.");
  }
  const screenshot = receipt.items.find((item) => item.kind === "BROWSER_SCREENSHOT");
  const measurement = receipt.items.find((item) => item.kind === "BROWSER_MEASUREMENT");
  if (!screenshot || !measurement) throw new Error("Browser artifact receipt is incomplete.");
  for (const received of [screenshot, measurement]) {
    const planned = plan.items.find((item) => item.kind === received.kind);
    if (!planned || (
      received.artifactRef !== planned.artifactRef
      || received.objectKey !== planned.objectKey
      || received.byteLength !== planned.byteLength
      || received.sha256 !== planned.sha256
    )) {
      throw new Error("Browser artifact receipt item does not match its content-addressed plan.");
    }
  }
  return {
    screenshotArtifactRef: screenshot.artifactRef,
    measurementArtifactRef: measurement.artifactRef,
  };
}
