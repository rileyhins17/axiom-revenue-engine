import { createHash } from "node:crypto";

import { z } from "zod";

import {
  ARTIFACT_MAX_BATCH_ITEMS,
  ARTIFACT_MAX_ITEM_BYTES,
  ARTIFACT_STORE_CONTRACT_VERSION,
  ArtifactKindSchema,
  ArtifactRetentionClassSchema,
  ArtifactWriteReceiptSchema,
  artifactObjectKey,
  type ArtifactRetentionClass,
  type ArtifactWriteReceipt,
} from "@/lib/revenue-engine/content-addressed-artifact-store";

export const ARTIFACT_LIFECYCLE_CONTRACT_VERSION = "artifact-lifecycle-v1";
export const ARTIFACT_MANIFEST_VERSION = "artifact-manifest-v1";
export const ARTIFACT_RELEASE_CONFIRMATION = "I reviewed every listed evidence use and approve this retention decision.";

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const ArtifactRefSchema = z.string().regex(/^artifact:sha256:[a-f0-9]{64}$/);

function mediaTypeFor(kind: z.infer<typeof ArtifactKindSchema>) {
  return kind === "BROWSER_SCREENSHOT" ? "image/webp" as const : "application/json" as const;
}

const ArtifactManifestItemSchema = z
  .object({
    kind: ArtifactKindSchema,
    artifactRef: ArtifactRefSchema,
    objectKey: z.string().trim().min(1).max(1_024),
    byteLength: z.number().int().positive().max(ARTIFACT_MAX_ITEM_BYTES),
    sha256: Sha256Schema,
    etag: z.string().trim().min(1).max(200),
    uploadedAt: z.string().datetime({ offset: true }),
  })
  .strict()
  .superRefine((item, context) => {
    if (item.artifactRef !== `artifact:sha256:${item.sha256}`) {
      context.addIssue({ code: "custom", message: "Manifest artifact reference must match its digest.", path: ["artifactRef"] });
    }
  });

export const ArtifactManifestSchema = z
  .object({
    manifestVersion: z.literal(ARTIFACT_MANIFEST_VERSION),
    manifestId: z.string().uuid(),
    workflowId: z.string().uuid(),
    retentionClass: ArtifactRetentionClassSchema,
    verifiedAt: z.string().datetime({ offset: true }),
    provenance: z.object({
      receiptType: z.enum(["ARTIFACT_WRITE", "ARTIFACT_PROMOTION"]),
      receiptId: z.string().uuid(),
    }).strict(),
    items: z.array(ArtifactManifestItemSchema).min(1).max(ARTIFACT_MAX_BATCH_ITEMS),
  })
  .strict()
  .superRefine((manifest, context) => {
    if (manifest.provenance.receiptType === "ARTIFACT_PROMOTION" && manifest.manifestId !== manifest.provenance.receiptId) {
      context.addIssue({
        code: "custom",
        message: "A promoted manifest ID must match its promotion receipt ID.",
        path: ["manifestId"],
      });
    }
    if (new Set(manifest.items.map((item) => item.kind)).size !== manifest.items.length) {
      context.addIssue({ code: "custom", message: "Manifest artifact kinds must be unique.", path: ["items"] });
    }
    for (const [index, item] of manifest.items.entries()) {
      if (Date.parse(item.uploadedAt) > Date.parse(manifest.verifiedAt)) {
        context.addIssue({
          code: "custom",
          message: "Manifest items cannot be uploaded after manifest verification.",
          path: ["items", index, "uploadedAt"],
        });
      }
      if (item.objectKey !== artifactObjectKey(manifest.retentionClass, item.kind, item.sha256)) {
        context.addIssue({
          code: "custom",
          message: "Manifest object key must match its retention class, kind, and digest.",
          path: ["items", index, "objectKey"],
        });
      }
    }
  });

export type ArtifactManifest = z.infer<typeof ArtifactManifestSchema>;

export function artifactManifestFromWriteReceipt(value: ArtifactWriteReceipt): ArtifactManifest {
  const receipt = ArtifactWriteReceiptSchema.parse(value);
  if (receipt.outcome !== "COMPLETED") {
    throw new Error("Only a completed artifact write receipt can create a manifest.");
  }
  return ArtifactManifestSchema.parse({
    manifestVersion: ARTIFACT_MANIFEST_VERSION,
    manifestId: receipt.planId,
    workflowId: receipt.workflowId,
    retentionClass: receipt.retentionClass,
    verifiedAt: receipt.completedAt,
    provenance: { receiptType: "ARTIFACT_WRITE", receiptId: receipt.planId },
    items: receipt.items.map((item) => ({
      kind: item.kind,
      artifactRef: item.artifactRef,
      objectKey: item.objectKey,
      byteLength: item.byteLength,
      sha256: item.sha256,
      etag: item.etag,
      uploadedAt: item.uploadedAt,
    })),
  });
}

export const ArtifactEvidenceUseTypeSchema = z.enum([
  "QUALIFICATION_SNAPSHOT",
  "OUTREACH_APPROVAL",
  "CONSENT_EVIDENCE",
  "OUTREACH_TOUCH",
  "LEGAL_HOLD",
]);

const ArtifactEvidenceUseSchema = z
  .object({
    useId: z.string().uuid(),
    useType: ArtifactEvidenceUseTypeSchema,
    recordId: z.string().trim().min(1).max(128),
    recordVersion: z.string().trim().min(1).max(100),
    businessId: z.string().trim().min(1).max(128),
    recordedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export type ArtifactEvidenceUse = z.infer<typeof ArtifactEvidenceUseSchema>;

const RETENTION_RANK: Record<ArtifactRetentionClass, number> = {
  SHADOW_30D: 0,
  QUALIFICATION_180D: 1,
  OUTREACH_ACTIVE: 2,
  LEGAL_HOLD: 3,
};

function retentionRequiredByUses(uses: ArtifactEvidenceUse[]): ArtifactRetentionClass {
  if (uses.some((use) => use.useType === "LEGAL_HOLD")) return "LEGAL_HOLD";
  if (uses.some((use) => ["OUTREACH_APPROVAL", "CONSENT_EVIDENCE", "OUTREACH_TOUCH"].includes(use.useType))) {
    return "OUTREACH_ACTIVE";
  }
  return "QUALIFICATION_180D";
}

const ArtifactPromotionRequestSchema = z
  .object({
    contractVersion: z.literal(ARTIFACT_LIFECYCLE_CONTRACT_VERSION),
    promotionId: z.string().uuid(),
    workflowId: z.string().uuid(),
    requestedAt: z.string().datetime({ offset: true }),
    mode: z.literal("SHADOW"),
    executorKind: z.literal("FIXTURE"),
    providerCopyAuthorized: z.literal(false),
    maxCostUsd: z.literal(0),
    businessId: z.string().trim().min(1).max(128),
    sourceManifest: ArtifactManifestSchema,
    evidenceUses: z.array(ArtifactEvidenceUseSchema).min(1).max(50),
  })
  .strict()
  .superRefine((request, context) => {
    if (request.sourceManifest.workflowId !== request.workflowId) {
      context.addIssue({ code: "custom", message: "Source manifest must belong to the promotion workflow.", path: ["sourceManifest", "workflowId"] });
    }
    if (new Set(request.evidenceUses.map((use) => use.useId)).size !== request.evidenceUses.length) {
      context.addIssue({ code: "custom", message: "Evidence-use IDs must be unique.", path: ["evidenceUses"] });
    }
    const requestedMs = Date.parse(request.requestedAt);
    if (Date.parse(request.sourceManifest.verifiedAt) > requestedMs) {
      context.addIssue({ code: "custom", message: "Source manifest cannot be verified after the promotion request.", path: ["sourceManifest", "verifiedAt"] });
    }
    for (const [index, use] of request.evidenceUses.entries()) {
      if (use.businessId !== request.businessId) {
        context.addIssue({ code: "custom", message: "Every evidence use must belong to the promotion business.", path: ["evidenceUses", index, "businessId"] });
      }
      if (Date.parse(use.recordedAt) > requestedMs) {
        context.addIssue({ code: "custom", message: "Evidence use cannot be recorded after the promotion request.", path: ["evidenceUses", index, "recordedAt"] });
      }
    }
  });

export type ArtifactPromotionRequest = z.infer<typeof ArtifactPromotionRequestSchema>;

const ArtifactPromotionItemSchema = z
  .object({
    kind: ArtifactKindSchema,
    artifactRef: ArtifactRefSchema,
    byteLength: z.number().int().positive().max(ARTIFACT_MAX_ITEM_BYTES),
    sha256: Sha256Schema,
    sourceObjectKey: z.string().trim().min(1).max(1_024),
    targetObjectKey: z.string().trim().min(1).max(1_024),
    mediaType: z.enum(["image/webp", "application/json"]),
    storageClass: z.literal("STANDARD"),
    copyCondition: z.literal("IF_ABSENT"),
    metadataPolicy: z.literal("REPLACE_RETENTION_METADATA"),
  })
  .strict();

const ArtifactPromotionPlanBaseSchema = z.object({
  contractVersion: z.literal(ARTIFACT_LIFECYCLE_CONTRACT_VERSION),
  promotionId: z.string().uuid(),
  workflowId: z.string().uuid(),
  requestedAt: z.string().datetime({ offset: true }),
  mode: z.literal("SHADOW"),
  executorKind: z.literal("FIXTURE"),
  providerCopyAuthorized: z.literal(false),
  maxCostUsd: z.literal(0),
  businessId: z.string().trim().min(1).max(128),
  sourceManifest: ArtifactManifestSchema,
  evidenceUses: z.array(ArtifactEvidenceUseSchema).min(1).max(50),
  requiredRetentionClass: ArtifactRetentionClassSchema,
  targetRetentionClass: ArtifactRetentionClassSchema,
});

export const ArtifactPromotionPlanSchema = z.discriminatedUnion("action", [
  ArtifactPromotionPlanBaseSchema.extend({
    action: z.literal("NO_COPY_REQUIRED"),
    items: z.array(ArtifactPromotionItemSchema).length(0),
  }).strict(),
  ArtifactPromotionPlanBaseSchema.extend({
    action: z.literal("COPY_REQUIRED"),
    items: z.array(ArtifactPromotionItemSchema).min(1).max(ARTIFACT_MAX_BATCH_ITEMS),
  }).strict(),
]).superRefine((plan, context) => {
  const requiredRetentionClass = retentionRequiredByUses(plan.evidenceUses);
  const expectedTargetClass = RETENTION_RANK[plan.sourceManifest.retentionClass] >= RETENTION_RANK[requiredRetentionClass]
    ? plan.sourceManifest.retentionClass
    : requiredRetentionClass;
  if (plan.requiredRetentionClass !== requiredRetentionClass) {
    context.addIssue({ code: "custom", message: "Promotion required retention must be derived from its evidence uses.", path: ["requiredRetentionClass"] });
  }
  if (plan.targetRetentionClass !== expectedTargetClass) {
    context.addIssue({ code: "custom", message: "Promotion target must be the minimum class that preserves current and required retention.", path: ["targetRetentionClass"] });
  }
  if (plan.sourceManifest.workflowId !== plan.workflowId) {
    context.addIssue({ code: "custom", message: "Promotion source manifest must belong to its workflow.", path: ["sourceManifest", "workflowId"] });
  }
  if (Date.parse(plan.sourceManifest.verifiedAt) > Date.parse(plan.requestedAt)) {
    context.addIssue({ code: "custom", message: "Promotion request cannot predate source verification.", path: ["requestedAt"] });
  }
  if (new Set(plan.evidenceUses.map((use) => use.useId)).size !== plan.evidenceUses.length) {
    context.addIssue({ code: "custom", message: "Promotion evidence-use IDs must be unique.", path: ["evidenceUses"] });
  }
  for (const [index, use] of plan.evidenceUses.entries()) {
    if (use.businessId !== plan.businessId) {
      context.addIssue({ code: "custom", message: "Promotion evidence use must belong to its business.", path: ["evidenceUses", index, "businessId"] });
    }
    if (Date.parse(use.recordedAt) > Date.parse(plan.requestedAt)) {
      context.addIssue({ code: "custom", message: "Promotion evidence use cannot postdate the request.", path: ["evidenceUses", index, "recordedAt"] });
    }
  }
  if (plan.action === "NO_COPY_REQUIRED" && plan.targetRetentionClass !== plan.sourceManifest.retentionClass) {
    context.addIssue({ code: "custom", message: "A no-copy promotion must keep the source retention class.", path: ["action"] });
  }
  if (plan.action === "COPY_REQUIRED" && plan.targetRetentionClass === plan.sourceManifest.retentionClass) {
    context.addIssue({ code: "custom", message: "A copy promotion must change the retention class.", path: ["action"] });
  }
  if (plan.action === "COPY_REQUIRED" && plan.items.length !== plan.sourceManifest.items.length) {
    context.addIssue({ code: "custom", message: "Copy promotion must include every source manifest item.", path: ["items"] });
  }
  for (const [index, item] of plan.items.entries()) {
    const source = plan.sourceManifest.items[index];
    if (
      !source
      || item.kind !== source.kind
      || item.artifactRef !== source.artifactRef
      || item.byteLength !== source.byteLength
      || item.sha256 !== source.sha256
      || item.sourceObjectKey !== source.objectKey
      || item.targetObjectKey !== artifactObjectKey(plan.targetRetentionClass, item.kind, item.sha256)
      || item.mediaType !== mediaTypeFor(item.kind)
    ) {
      context.addIssue({ code: "custom", message: "Promotion items must preserve source identity under the target retention prefix.", path: ["items", index] });
    }
  }
});

export type ArtifactPromotionPlan = z.infer<typeof ArtifactPromotionPlanSchema>;

export function createArtifactPromotionPlan(value: unknown): ArtifactPromotionPlan {
  const request = ArtifactPromotionRequestSchema.parse(value);
  const requiredRetentionClass = retentionRequiredByUses(request.evidenceUses);
  const sourceClass = request.sourceManifest.retentionClass;
  const copyRequired = RETENTION_RANK[sourceClass] < RETENTION_RANK[requiredRetentionClass];
  const targetRetentionClass = copyRequired ? requiredRetentionClass : sourceClass;
  return ArtifactPromotionPlanSchema.parse({
    ...request,
    requiredRetentionClass,
    targetRetentionClass,
    action: copyRequired ? "COPY_REQUIRED" : "NO_COPY_REQUIRED",
    items: copyRequired ? request.sourceManifest.items.map((item) => ({
      kind: item.kind,
      artifactRef: item.artifactRef,
      byteLength: item.byteLength,
      sha256: item.sha256,
      sourceObjectKey: item.objectKey,
      targetObjectKey: artifactObjectKey(targetRetentionClass, item.kind, item.sha256),
      mediaType: mediaTypeFor(item.kind),
      storageClass: "STANDARD",
      copyCondition: "IF_ABSENT",
      metadataPolicy: "REPLACE_RETENTION_METADATA",
    })) : [],
  });
}

const LifecycleObjectSchema = z.object({
  objectKey: z.string().trim().min(1).max(1_024),
  byteLength: z.number().int().positive().max(ARTIFACT_MAX_ITEM_BYTES),
  sha256: Sha256Schema,
  etag: z.string().trim().min(1).max(200),
  uploadedAt: z.string().datetime({ offset: true }),
  storageClass: z.literal("STANDARD"),
  httpMetadata: z.object({
    contentType: z.enum(["image/webp", "application/json"]),
    cacheControl: z.literal("private, no-store"),
  }).strict(),
  customMetadata: z.object({
    contractVersion: z.literal(ARTIFACT_STORE_CONTRACT_VERSION),
    kind: ArtifactKindSchema,
    sha256: Sha256Schema,
    retentionClass: ArtifactRetentionClassSchema,
  }).strict(),
}).strict();

export type LifecycleObject = z.infer<typeof LifecycleObjectSchema>;

const FixtureCopyRequestSchema = z.object({
  executorKind: z.literal("FIXTURE"),
  providerCopyAuthorized: z.literal(false),
  sourceObjectKey: z.string().trim().min(1).max(1_024),
  targetObjectKey: z.string().trim().min(1).max(1_024),
  byteLength: z.number().int().positive().max(ARTIFACT_MAX_ITEM_BYTES),
  sha256: Sha256Schema,
  kind: ArtifactKindSchema,
  mediaType: z.enum(["image/webp", "application/json"]),
  targetRetentionClass: ArtifactRetentionClassSchema,
  ifNoneMatch: z.literal("*"),
}).strict();

export type FixtureCopyRequest = z.infer<typeof FixtureCopyRequestSchema>;

const FixtureCopyResultSchema = z.discriminatedUnion("outcome", [
  z.object({ outcome: z.literal("CREATED"), object: LifecycleObjectSchema }).strict(),
  z.object({ outcome: z.literal("ALREADY_EXISTS"), object: z.null() }).strict(),
]);

export interface FixtureArtifactLifecycleStore {
  kind: "FIXTURE";
  head(objectKey: string): Promise<unknown>;
  copyIfAbsent(request: FixtureCopyRequest): Promise<unknown>;
}

const PromotionItemReceiptSchema = z.object({
  kind: ArtifactKindSchema,
  artifactRef: ArtifactRefSchema,
  objectKey: z.string().trim().min(1).max(1_024),
  byteLength: z.number().int().positive().max(ARTIFACT_MAX_ITEM_BYTES),
  sha256: Sha256Schema,
  operation: z.enum(["CREATED", "REUSED"]),
  etag: z.string().trim().min(1).max(200),
  uploadedAt: z.string().datetime({ offset: true }),
}).strict().superRefine((item, context) => {
  if (item.artifactRef !== `artifact:sha256:${item.sha256}`) {
    context.addIssue({ code: "custom", message: "Promotion receipt reference must match its digest.", path: ["artifactRef"] });
  }
});

const ArtifactPromotionReceiptBaseSchema = z.object({
  contractVersion: z.literal(ARTIFACT_LIFECYCLE_CONTRACT_VERSION),
  promotionId: z.string().uuid(),
  workflowId: z.string().uuid(),
  mode: z.literal("SHADOW"),
  executorKind: z.literal("FIXTURE"),
  providerCopyPerformed: z.literal(false),
  sourceRetentionClass: ArtifactRetentionClassSchema,
  targetRetentionClass: ArtifactRetentionClassSchema,
  action: z.enum(["NO_COPY_REQUIRED", "COPY_REQUIRED"]),
  plannedItemCount: z.number().int().nonnegative().max(ARTIFACT_MAX_BATCH_ITEMS),
  startedAt: z.string().datetime({ offset: true }),
  completedAt: z.string().datetime({ offset: true }),
  fixtureHeadReads: z.number().int().nonnegative().max(ARTIFACT_MAX_BATCH_ITEMS * 2),
  fixtureCopyAttempts: z.number().int().nonnegative().max(ARTIFACT_MAX_BATCH_ITEMS),
  providerClassAOperations: z.literal(0),
  providerClassBOperations: z.literal(0),
  costUsd: z.literal(0),
  rollbackAction: z.literal("NONE_KEEP_CONTENT_ADDRESSED_ORPHANS"),
});

export const ArtifactPromotionReceiptSchema = z.discriminatedUnion("outcome", [
  ArtifactPromotionReceiptBaseSchema.extend({
    outcome: z.literal("COMPLETED"),
    items: z.array(PromotionItemReceiptSchema).max(ARTIFACT_MAX_BATCH_ITEMS),
    resultManifest: ArtifactManifestSchema,
    failure: z.null(),
  }).strict(),
  ArtifactPromotionReceiptBaseSchema.extend({
    outcome: z.literal("FAILED"),
    items: z.array(PromotionItemReceiptSchema).max(ARTIFACT_MAX_BATCH_ITEMS),
    resultManifest: z.null(),
    failure: z.object({
      itemIndex: z.number().int().nonnegative().max(ARTIFACT_MAX_BATCH_ITEMS - 1),
      code: z.enum(["SOURCE_MISSING", "SOURCE_MISMATCH", "TARGET_MISMATCH", "INVALID_RECEIPT", "STORE_ERROR"]),
      message: z.string().trim().min(1).max(240),
    }).strict(),
  }).strict(),
]).superRefine((receipt, context) => {
  if (Date.parse(receipt.completedAt) < Date.parse(receipt.startedAt)) {
    context.addIssue({ code: "custom", message: "Promotion completion cannot predate its start.", path: ["completedAt"] });
  }
  if (RETENTION_RANK[receipt.targetRetentionClass] < RETENTION_RANK[receipt.sourceRetentionClass]) {
    context.addIssue({ code: "custom", message: "Promotion receipt cannot shorten retention.", path: ["targetRetentionClass"] });
  }
  if (receipt.action === "NO_COPY_REQUIRED") {
    if (
      receipt.sourceRetentionClass !== receipt.targetRetentionClass
      || receipt.plannedItemCount !== 0
      || receipt.items.length !== 0
      || receipt.fixtureCopyAttempts !== 0
      || receipt.fixtureHeadReads !== 0
    ) {
      context.addIssue({ code: "custom", message: "No-copy receipts cannot report copy work or a retention change.", path: ["action"] });
    }
  } else if (receipt.sourceRetentionClass === receipt.targetRetentionClass || receipt.plannedItemCount === 0) {
    context.addIssue({ code: "custom", message: "Copy receipts require a non-empty promotion to a different class.", path: ["action"] });
  }
  for (const [index, item] of receipt.items.entries()) {
    if (item.objectKey !== artifactObjectKey(receipt.targetRetentionClass, item.kind, item.sha256)) {
      context.addIssue({ code: "custom", message: "Promotion receipt key must match its target retention, kind, and digest.", path: ["items", index, "objectKey"] });
    }
  }
  if (receipt.outcome === "COMPLETED") {
    if (receipt.action === "COPY_REQUIRED" && (
      receipt.items.length !== receipt.plannedItemCount
      || receipt.fixtureCopyAttempts !== receipt.plannedItemCount
      || receipt.resultManifest.manifestId !== receipt.promotionId
    )) {
      context.addIssue({ code: "custom", message: "Completed copy receipt must reconcile every planned item.", path: ["items"] });
    }
    if (receipt.resultManifest.retentionClass !== receipt.targetRetentionClass) {
      context.addIssue({ code: "custom", message: "Result manifest must use the receipt target retention class.", path: ["resultManifest", "retentionClass"] });
    }
    if (receipt.action === "COPY_REQUIRED" && JSON.stringify(receipt.resultManifest.items) !== JSON.stringify(receipt.items.map((item) => ({
      kind: item.kind,
      artifactRef: item.artifactRef,
      objectKey: item.objectKey,
      byteLength: item.byteLength,
      sha256: item.sha256,
      etag: item.etag,
      uploadedAt: item.uploadedAt,
    })))) {
      context.addIssue({ code: "custom", message: "Result manifest items must exactly match the completed receipt.", path: ["resultManifest", "items"] });
    }
  } else if (
    receipt.failure.itemIndex >= receipt.plannedItemCount
    || receipt.items.length !== receipt.failure.itemIndex
    || receipt.fixtureCopyAttempts > receipt.failure.itemIndex + 1
  ) {
    context.addIssue({ code: "custom", message: "Failed promotion receipt must identify the next sequential item.", path: ["failure", "itemIndex"] });
  }
});

export type ArtifactPromotionReceipt = z.infer<typeof ArtifactPromotionReceiptSchema>;

export function artifactManifestFromPromotionReceipt(
  planValue: ArtifactPromotionPlan,
  receiptValue: ArtifactPromotionReceipt,
): ArtifactManifest {
  const plan = ArtifactPromotionPlanSchema.parse(planValue);
  const receipt = ArtifactPromotionReceiptSchema.parse(receiptValue);
  if (receipt.outcome !== "COMPLETED") {
    throw new Error("A failed artifact promotion cannot create a result manifest.");
  }
  if (
    receipt.promotionId !== plan.promotionId
    || receipt.workflowId !== plan.workflowId
    || receipt.sourceRetentionClass !== plan.sourceManifest.retentionClass
    || receipt.targetRetentionClass !== plan.targetRetentionClass
    || receipt.action !== plan.action
    || receipt.plannedItemCount !== plan.items.length
  ) {
    throw new Error("Artifact promotion receipt does not match its exact plan.");
  }
  if (plan.action === "NO_COPY_REQUIRED") {
    if (JSON.stringify(receipt.resultManifest) !== JSON.stringify(plan.sourceManifest)) {
      throw new Error("No-copy artifact promotion must preserve the exact source manifest.");
    }
    return receipt.resultManifest;
  }
  for (const [index, item] of receipt.items.entries()) {
    const planned = plan.items[index];
    if (
      !planned
      || item.kind !== planned.kind
      || item.artifactRef !== planned.artifactRef
      || item.objectKey !== planned.targetObjectKey
      || item.byteLength !== planned.byteLength
      || item.sha256 !== planned.sha256
    ) {
      throw new Error("Artifact promotion receipt items do not match their exact plan.");
    }
  }
  return receipt.resultManifest;
}

function lifecycleObjectFor(
  item: z.infer<typeof ArtifactPromotionItemSchema>,
  retentionClass: ArtifactRetentionClass,
  value: unknown,
) {
  const object = LifecycleObjectSchema.parse(value);
  if (
    object.objectKey !== artifactObjectKey(retentionClass, item.kind, item.sha256)
    || object.byteLength !== item.byteLength
    || object.sha256 !== item.sha256
    || object.storageClass !== "STANDARD"
    || object.httpMetadata.contentType !== item.mediaType
    || object.httpMetadata.cacheControl !== "private, no-store"
    || object.customMetadata.contractVersion !== ARTIFACT_STORE_CONTRACT_VERSION
    || object.customMetadata.kind !== item.kind
    || object.customMetadata.sha256 !== item.sha256
    || object.customMetadata.retentionClass !== retentionClass
  ) {
    throw new Error(`Stored ${retentionClass} object does not match the lifecycle plan.`);
  }
  return object;
}

function promotionFailureCode(error: unknown) {
  if (error instanceof z.ZodError) return "INVALID_RECEIPT" as const;
  if (error instanceof Error && error.message.includes("source object is missing")) return "SOURCE_MISSING" as const;
  if (error instanceof Error && error.message.includes("Lifecycle source")) return "SOURCE_MISMATCH" as const;
  if (error instanceof Error && (error.message.includes("Lifecycle target") || error.message.includes("Stored "))) return "TARGET_MISMATCH" as const;
  return "STORE_ERROR" as const;
}

function manifestFromPromotionItems(
  plan: ArtifactPromotionPlan,
  verifiedAt: string,
  items: z.infer<typeof PromotionItemReceiptSchema>[],
) {
  return ArtifactManifestSchema.parse({
    manifestVersion: ARTIFACT_MANIFEST_VERSION,
    manifestId: plan.promotionId,
    workflowId: plan.workflowId,
    retentionClass: plan.targetRetentionClass,
    verifiedAt,
    provenance: { receiptType: "ARTIFACT_PROMOTION", receiptId: plan.promotionId },
    items: items.map((item) => ({
      kind: item.kind,
      artifactRef: item.artifactRef,
      objectKey: item.objectKey,
      byteLength: item.byteLength,
      sha256: item.sha256,
      etag: item.etag,
      uploadedAt: item.uploadedAt,
    })),
  });
}

export async function executeFixtureArtifactPromotion(
  value: ArtifactPromotionPlan,
  dependencies: { store: FixtureArtifactLifecycleStore; now?: () => Date },
): Promise<ArtifactPromotionReceipt> {
  const plan = ArtifactPromotionPlanSchema.parse(value);
  if (dependencies.store.kind !== "FIXTURE") throw new Error("Artifact lifecycle version 1 accepts fixture stores only.");
  const now = dependencies.now || (() => new Date());
  const startedAt = now().toISOString();
  if (plan.action === "NO_COPY_REQUIRED") {
    return ArtifactPromotionReceiptSchema.parse({
      contractVersion: ARTIFACT_LIFECYCLE_CONTRACT_VERSION,
      promotionId: plan.promotionId,
      workflowId: plan.workflowId,
      mode: plan.mode,
      executorKind: plan.executorKind,
      providerCopyPerformed: false,
      sourceRetentionClass: plan.sourceManifest.retentionClass,
      targetRetentionClass: plan.targetRetentionClass,
      action: plan.action,
      plannedItemCount: 0,
      startedAt,
      completedAt: now().toISOString(),
      fixtureHeadReads: 0,
      fixtureCopyAttempts: 0,
      providerClassAOperations: 0,
      providerClassBOperations: 0,
      costUsd: 0,
      rollbackAction: "NONE_KEEP_CONTENT_ADDRESSED_ORPHANS",
      outcome: "COMPLETED",
      items: [],
      resultManifest: plan.sourceManifest,
      failure: null,
    });
  }

  const items: z.infer<typeof PromotionItemReceiptSchema>[] = [];
  let fixtureHeadReads = 0;
  let fixtureCopyAttempts = 0;
  for (const [itemIndex, item] of plan.items.entries()) {
    try {
      fixtureHeadReads += 1;
      const sourceValue = await dependencies.store.head(item.sourceObjectKey);
      if (sourceValue === null || sourceValue === undefined) throw new Error("Lifecycle source object is missing.");
      let sourceObject: LifecycleObject;
      try {
        sourceObject = lifecycleObjectFor(item, plan.sourceManifest.retentionClass, sourceValue);
      } catch (error) {
        throw new Error(`Lifecycle source ${error instanceof Error ? error.message : "object mismatch."}`);
      }
      if (sourceObject.etag !== plan.sourceManifest.items[itemIndex]?.etag) {
        throw new Error("Lifecycle source object does not match its verified manifest.");
      }
      if (sourceObject.uploadedAt !== plan.sourceManifest.items[itemIndex]?.uploadedAt) {
        throw new Error("Lifecycle source object timestamp does not match its verified manifest.");
      }

      fixtureCopyAttempts += 1;
      const copyRequest = FixtureCopyRequestSchema.parse({
        executorKind: "FIXTURE",
        providerCopyAuthorized: false,
        sourceObjectKey: item.sourceObjectKey,
        targetObjectKey: item.targetObjectKey,
        byteLength: item.byteLength,
        sha256: item.sha256,
        kind: item.kind,
        mediaType: item.mediaType,
        targetRetentionClass: plan.targetRetentionClass,
        ifNoneMatch: "*",
      });
      const copy = FixtureCopyResultSchema.parse(await dependencies.store.copyIfAbsent(copyRequest));
      let targetObject: LifecycleObject;
      let operation: "CREATED" | "REUSED";
      if (copy.outcome === "CREATED") {
        targetObject = lifecycleObjectFor(item, plan.targetRetentionClass, copy.object);
        operation = "CREATED";
      } else {
        fixtureHeadReads += 1;
        const targetValue = await dependencies.store.head(item.targetObjectKey);
        if (targetValue === null || targetValue === undefined) throw new Error("Lifecycle target object does not match the lifecycle plan.");
        targetObject = lifecycleObjectFor(item, plan.targetRetentionClass, targetValue);
        operation = "REUSED";
      }
      items.push(PromotionItemReceiptSchema.parse({
        kind: item.kind,
        artifactRef: item.artifactRef,
        objectKey: item.targetObjectKey,
        byteLength: item.byteLength,
        sha256: item.sha256,
        operation,
        etag: targetObject.etag,
        uploadedAt: targetObject.uploadedAt,
      }));
    } catch (error) {
      return ArtifactPromotionReceiptSchema.parse({
        contractVersion: ARTIFACT_LIFECYCLE_CONTRACT_VERSION,
        promotionId: plan.promotionId,
        workflowId: plan.workflowId,
        mode: plan.mode,
        executorKind: plan.executorKind,
        providerCopyPerformed: false,
        sourceRetentionClass: plan.sourceManifest.retentionClass,
        targetRetentionClass: plan.targetRetentionClass,
        action: plan.action,
        plannedItemCount: plan.items.length,
        startedAt,
        completedAt: now().toISOString(),
        fixtureHeadReads,
        fixtureCopyAttempts,
        providerClassAOperations: 0,
        providerClassBOperations: 0,
        costUsd: 0,
        rollbackAction: "NONE_KEEP_CONTENT_ADDRESSED_ORPHANS",
        outcome: "FAILED",
        items,
        resultManifest: null,
        failure: {
          itemIndex,
          code: promotionFailureCode(error),
          message: error instanceof Error ? error.message.slice(0, 240) : "Unknown fixture promotion failure.",
        },
      });
    }
  }
  const completedAt = now().toISOString();
  return ArtifactPromotionReceiptSchema.parse({
    contractVersion: ARTIFACT_LIFECYCLE_CONTRACT_VERSION,
    promotionId: plan.promotionId,
    workflowId: plan.workflowId,
    mode: plan.mode,
    executorKind: plan.executorKind,
    providerCopyPerformed: false,
    sourceRetentionClass: plan.sourceManifest.retentionClass,
    targetRetentionClass: plan.targetRetentionClass,
    action: plan.action,
    plannedItemCount: plan.items.length,
    startedAt,
    completedAt,
    fixtureHeadReads,
    fixtureCopyAttempts,
    providerClassAOperations: 0,
    providerClassBOperations: 0,
    costUsd: 0,
    rollbackAction: "NONE_KEEP_CONTENT_ADDRESSED_ORPHANS",
    outcome: "COMPLETED",
    items,
    resultManifest: manifestFromPromotionItems(plan, completedAt, items),
    failure: null,
  });
}

const ArtifactReleaseRequestSchema = z
  .object({
    contractVersion: z.literal(ARTIFACT_LIFECYCLE_CONTRACT_VERSION),
    releaseId: z.string().uuid(),
    businessId: z.string().trim().min(1).max(128),
    decidedAt: z.string().datetime({ offset: true }),
    mode: z.literal("SHADOW"),
    recorderKind: z.literal("FIXTURE"),
    providerDeleteAuthorized: z.literal(false),
    maxCostUsd: z.literal(0),
    manifest: ArtifactManifestSchema,
    activeEvidenceUses: z.array(ArtifactEvidenceUseSchema).min(1).max(50),
    reviewedUseIds: z.array(z.string().uuid()).min(1).max(50),
    actor: z.object({
      actorUserId: z.string().trim().min(1).max(128),
      role: z.enum(["OWNER", "COMPLIANCE"]),
    }).strict(),
    decision: z.enum(["KEEP_PROTECTED", "RELEASE_APPROVED"]),
    reasonCode: z.enum([
      "ACTIVE_REFERENCE_REMAINS",
      "RETENTION_REVIEW_INCOMPLETE",
      "OUTREACH_RETENTION_REVIEW_COMPLETE",
      "LEGAL_HOLD_CLEARED",
    ]),
    rationale: z.string().trim().min(20).max(500),
    confirmation: z.literal(ARTIFACT_RELEASE_CONFIRMATION).nullable(),
  })
  .strict()
  .superRefine((request, context) => {
    if (!["OUTREACH_ACTIVE", "LEGAL_HOLD"].includes(request.manifest.retentionClass)) {
      context.addIssue({ code: "custom", message: "Only protected retention classes accept an owner/compliance release decision.", path: ["manifest", "retentionClass"] });
    }
    if (new Set(request.activeEvidenceUses.map((use) => use.useId)).size !== request.activeEvidenceUses.length) {
      context.addIssue({ code: "custom", message: "Active evidence-use IDs must be unique.", path: ["activeEvidenceUses"] });
    }
    const activeIds = [...request.activeEvidenceUses.map((use) => use.useId)].sort();
    const reviewedIds = [...new Set(request.reviewedUseIds)].sort();
    if (
      new Set(request.reviewedUseIds).size !== request.reviewedUseIds.length
      || activeIds.length !== reviewedIds.length
      || activeIds.some((id, index) => id !== reviewedIds[index])
    ) {
      context.addIssue({ code: "custom", message: "Every active evidence use must be reviewed exactly once.", path: ["reviewedUseIds"] });
    }
    if (Date.parse(request.manifest.verifiedAt) > Date.parse(request.decidedAt)) {
      context.addIssue({ code: "custom", message: "A retention decision cannot predate manifest verification.", path: ["decidedAt"] });
    }
    if (RETENTION_RANK[request.manifest.retentionClass] < RETENTION_RANK[retentionRequiredByUses(request.activeEvidenceUses)]) {
      context.addIssue({ code: "custom", message: "Protected manifest retention does not satisfy the evidence uses under review.", path: ["manifest", "retentionClass"] });
    }
    for (const [index, use] of request.activeEvidenceUses.entries()) {
      if (use.businessId !== request.businessId) {
        context.addIssue({ code: "custom", message: "Every active evidence use must belong to the release business.", path: ["activeEvidenceUses", index, "businessId"] });
      }
      if (Date.parse(use.recordedAt) > Date.parse(request.decidedAt)) {
        context.addIssue({ code: "custom", message: "An evidence use cannot postdate its retention decision.", path: ["activeEvidenceUses", index, "recordedAt"] });
      }
    }
    if (request.decision === "RELEASE_APPROVED") {
      if (request.confirmation !== ARTIFACT_RELEASE_CONFIRMATION) {
        context.addIssue({ code: "custom", message: "Release approval requires the exact owner/compliance confirmation.", path: ["confirmation"] });
      }
      const expectedReason = request.manifest.retentionClass === "LEGAL_HOLD"
        ? "LEGAL_HOLD_CLEARED"
        : "OUTREACH_RETENTION_REVIEW_COMPLETE";
      if (request.reasonCode !== expectedReason) {
        context.addIssue({ code: "custom", message: "Release reason must match the protected retention class.", path: ["reasonCode"] });
      }
    } else {
      if (request.confirmation !== null) {
        context.addIssue({ code: "custom", message: "A keep-protected decision cannot carry release confirmation.", path: ["confirmation"] });
      }
      if (!["ACTIVE_REFERENCE_REMAINS", "RETENTION_REVIEW_INCOMPLETE"].includes(request.reasonCode)) {
        context.addIssue({ code: "custom", message: "Keep-protected decisions require a non-release reason.", path: ["reasonCode"] });
      }
    }
  });

export type ArtifactReleaseRequest = z.infer<typeof ArtifactReleaseRequestSchema>;

export const ArtifactReleaseRecordSchema = z.object({
  contractVersion: z.literal(ARTIFACT_LIFECYCLE_CONTRACT_VERSION),
  releaseId: z.string().uuid(),
  businessId: z.string().trim().min(1).max(128),
  decidedAt: z.string().datetime({ offset: true }),
  mode: z.literal("SHADOW"),
  recorderKind: z.literal("FIXTURE"),
  retentionClass: z.enum(["OUTREACH_ACTIVE", "LEGAL_HOLD"]),
  manifestId: z.string().uuid(),
  manifestDigest: Sha256Schema,
  evidenceUseDigest: Sha256Schema,
  reviewedUseIds: z.array(z.string().uuid()).min(1).max(50),
  actor: z.object({
    actorUserId: z.string().trim().min(1).max(128),
    role: z.enum(["OWNER", "COMPLIANCE"]),
  }).strict(),
  decision: z.enum(["KEEP_PROTECTED", "RELEASE_APPROVED"]),
  reasonCode: z.string().trim().min(1).max(100),
  rationale: z.string().trim().min(20).max(500),
  releaseApproved: z.boolean(),
  requiresFreshReferenceCheckBeforeDeletion: z.literal(true),
  requiresSeparateDeletionReleaseGate: z.literal(true),
  providerDeleteAuthorized: z.literal(false),
  providerDeletePerformed: z.literal(false),
  costUsd: z.literal(0),
  decisionDigest: Sha256Schema,
}).strict().superRefine((record, context) => {
  if (record.releaseApproved !== (record.decision === "RELEASE_APPROVED")) {
    context.addIssue({ code: "custom", message: "Release approval flag must match the recorded decision.", path: ["releaseApproved"] });
  }
  if (new Set(record.reviewedUseIds).size !== record.reviewedUseIds.length) {
    context.addIssue({ code: "custom", message: "Release record use IDs must be unique.", path: ["reviewedUseIds"] });
  }
  if (JSON.stringify(record.reviewedUseIds) !== JSON.stringify([...record.reviewedUseIds].sort((left, right) => left.localeCompare(right, "en-CA")))) {
    context.addIssue({ code: "custom", message: "Release record use IDs must use canonical order.", path: ["reviewedUseIds"] });
  }
  const expectedReason = record.retentionClass === "LEGAL_HOLD"
    ? "LEGAL_HOLD_CLEARED"
    : "OUTREACH_RETENTION_REVIEW_COMPLETE";
  if (record.releaseApproved && record.reasonCode !== expectedReason) {
    context.addIssue({ code: "custom", message: "Approved release reason must match its retention class.", path: ["reasonCode"] });
  }
  if (!record.releaseApproved && !["ACTIVE_REFERENCE_REMAINS", "RETENTION_REVIEW_INCOMPLETE"].includes(record.reasonCode)) {
    context.addIssue({ code: "custom", message: "Keep-protected record requires a non-release reason.", path: ["reasonCode"] });
  }
  const decisionCore = {
    contractVersion: record.contractVersion,
    releaseId: record.releaseId,
    businessId: record.businessId,
    decidedAt: record.decidedAt,
    retentionClass: record.retentionClass,
    manifestId: record.manifestId,
    manifestDigest: record.manifestDigest,
    evidenceUseDigest: record.evidenceUseDigest,
    reviewedUseIds: record.reviewedUseIds,
    actor: record.actor,
    decision: record.decision,
    reasonCode: record.reasonCode,
    rationale: record.rationale,
  };
  if (record.decisionDigest !== stableDigest(decisionCore)) {
    context.addIssue({ code: "custom", message: "Release decision digest must bind the exact decision content.", path: ["decisionDigest"] });
  }
});

export type ArtifactReleaseRecord = z.infer<typeof ArtifactReleaseRecordSchema>;

function stableDigest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function createArtifactReleaseRecord(value: unknown): ArtifactReleaseRecord {
  const request = ArtifactReleaseRequestSchema.parse(value);
  const manifest = {
    ...request.manifest,
    items: [...request.manifest.items].sort((left, right) => left.kind.localeCompare(right.kind, "en-CA")),
  };
  const uses = [...request.activeEvidenceUses].sort((left, right) => left.useId.localeCompare(right.useId, "en-CA"));
  const reviewedUseIds = [...request.reviewedUseIds].sort((left, right) => left.localeCompare(right, "en-CA"));
  const manifestDigest = stableDigest(manifest);
  const evidenceUseDigest = stableDigest(uses);
  const decisionCore = {
    contractVersion: ARTIFACT_LIFECYCLE_CONTRACT_VERSION,
    releaseId: request.releaseId,
    businessId: request.businessId,
    decidedAt: request.decidedAt,
    retentionClass: request.manifest.retentionClass,
    manifestId: request.manifest.manifestId,
    manifestDigest,
    evidenceUseDigest,
    reviewedUseIds,
    actor: request.actor,
    decision: request.decision,
    reasonCode: request.reasonCode,
    rationale: request.rationale,
  };
  return ArtifactReleaseRecordSchema.parse({
    ...decisionCore,
    mode: request.mode,
    recorderKind: request.recorderKind,
    releaseApproved: request.decision === "RELEASE_APPROVED",
    requiresFreshReferenceCheckBeforeDeletion: true,
    requiresSeparateDeletionReleaseGate: true,
    providerDeleteAuthorized: false,
    providerDeletePerformed: false,
    costUsd: 0,
    decisionDigest: stableDigest(decisionCore),
  });
}
