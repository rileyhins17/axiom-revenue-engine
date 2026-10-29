import { z } from "zod";

import {
  ARTIFACT_REFERENCE_SOURCE_SET_ORDER,
  ArtifactReferenceSourceSetNameSchema,
} from "@/lib/revenue-engine/artifact-reference-atomic-snapshot";

export const ARTIFACT_REFERENCE_SOURCE_WRITER_GUARD_VERSION = "artifact-reference-source-writer-guard-v2";
export const ARTIFACT_REFERENCE_GUARDED_SCHEMA_VERSION = "0060_artifact_reference_source_writer_guards";
export const ARTIFACT_REFERENCE_SOURCE_FREEZE_ERROR = "ARTIFACT_REFERENCE_SOURCE_FROZEN";
export const ARTIFACT_REFERENCE_IMMUTABLE_ERROR = "ARTIFACT_REFERENCE_APPEND_ONLY";

const ScopeKindSchema = z.enum([
  "WORKFLOW_OR_ALTERNATE_IDENTITY",
  "REFERENCED_DEFINITION",
  "DIRECT_WORKFLOW",
  "MANIFEST_WORKFLOW",
  "PROMOTION_WORKFLOW_OR_MANIFEST",
  "PROMOTION_SCOPE",
  "MANIFEST_OR_PROMOTION_SCOPE",
  "SCOPED_EVIDENCE_USE",
  "SCOPED_USE_END",
  "MANIFEST_AVAILABILITY",
]);

const GuardedSourceTableSchema = z.object({
  setName: ArtifactReferenceSourceSetNameSchema,
  tableName: z.string().regex(/^Revenue[A-Za-z]+$/),
  insertScope: ScopeKindSchema,
  insertTriggerName: z.string().regex(/^Revenue[A-Za-z]+_reference_source_freeze_insert$/),
  updateTriggerName: z.string().regex(/^Revenue[A-Za-z]+_reference_source_immutable_update$/),
  deleteTriggerName: z.string().regex(/^Revenue[A-Za-z]+_reference_source_immutable_delete$/),
}).strict();

type GuardedSourceTableInput = {
  setName: z.infer<typeof ArtifactReferenceSourceSetNameSchema>;
  tableName: string;
  insertScope: z.infer<typeof ScopeKindSchema>;
};

function guardedSourceTable(input: GuardedSourceTableInput) {
  return GuardedSourceTableSchema.parse({
    ...input,
    insertTriggerName: `${input.tableName}_reference_source_freeze_insert`,
    updateTriggerName: `${input.tableName}_reference_source_immutable_update`,
    deleteTriggerName: `${input.tableName}_reference_source_immutable_delete`,
  });
}

export const ARTIFACT_REFERENCE_GUARDED_SOURCE_TABLES = [
  guardedSourceTable({ setName: "WORKFLOW_RUNS", tableName: "RevenueWorkflowRun", insertScope: "WORKFLOW_OR_ALTERNATE_IDENTITY" }),
  guardedSourceTable({ setName: "WORKFLOW_DEFINITIONS", tableName: "RevenueWorkflowDefinition", insertScope: "REFERENCED_DEFINITION" }),
  guardedSourceTable({ setName: "WORKFLOW_DELIVERIES", tableName: "RevenueWorkflowDelivery", insertScope: "DIRECT_WORKFLOW" }),
  guardedSourceTable({ setName: "WORKFLOW_ATTEMPTS", tableName: "RevenueWorkflowAttempt", insertScope: "DIRECT_WORKFLOW" }),
  guardedSourceTable({ setName: "WORKFLOW_LEASES", tableName: "RevenueWorkflowLease", insertScope: "DIRECT_WORKFLOW" }),
  guardedSourceTable({ setName: "WORKFLOW_RECEIPT_REVISIONS", tableName: "RevenueWorkflowReceiptRevision", insertScope: "DIRECT_WORKFLOW" }),
  guardedSourceTable({ setName: "WORKFLOW_ATTEMPT_CLOSURES", tableName: "RevenueWorkflowAttemptClosure", insertScope: "DIRECT_WORKFLOW" }),
  guardedSourceTable({ setName: "MANIFESTS", tableName: "RevenueArtifactManifest", insertScope: "DIRECT_WORKFLOW" }),
  guardedSourceTable({ setName: "MANIFEST_ITEMS", tableName: "RevenueArtifactManifestItem", insertScope: "MANIFEST_WORKFLOW" }),
  guardedSourceTable({ setName: "PROMOTIONS", tableName: "RevenueArtifactPromotionReceipt", insertScope: "PROMOTION_WORKFLOW_OR_MANIFEST" }),
  guardedSourceTable({ setName: "PROMOTION_USES", tableName: "RevenueArtifactPromotionUse", insertScope: "PROMOTION_SCOPE" }),
  guardedSourceTable({ setName: "MANIFEST_USES", tableName: "RevenueArtifactManifestEvidenceUse", insertScope: "MANIFEST_OR_PROMOTION_SCOPE" }),
  guardedSourceTable({ setName: "EVIDENCE_USES", tableName: "RevenueArtifactEvidenceUse", insertScope: "SCOPED_EVIDENCE_USE" }),
  guardedSourceTable({ setName: "USE_ENDS", tableName: "RevenueArtifactEvidenceUseEnd", insertScope: "SCOPED_USE_END" }),
  guardedSourceTable({ setName: "AVAILABILITY", tableName: "RevenueArtifactManifestAvailabilityReceipt", insertScope: "MANIFEST_AVAILABILITY" }),
] as const;

const ControlTableSchema = z.object({
  tableName: z.string().regex(/^RevenueArtifactReference[A-Za-z]+$/),
  updateTriggerName: z.string().regex(/^RevenueArtifactReference[A-Za-z]+_immutable_update$/),
  deleteTriggerName: z.string().regex(/^RevenueArtifactReference[A-Za-z]+_immutable_delete$/),
}).strict();

function controlTable(tableName: string) {
  return ControlTableSchema.parse({
    tableName,
    updateTriggerName: `${tableName}_immutable_update`,
    deleteTriggerName: `${tableName}_immutable_delete`,
  });
}

export const ARTIFACT_REFERENCE_IMMUTABLE_CONTROL_TABLES = [
  controlTable("RevenueArtifactReferenceSnapshotAttempt"),
  controlTable("RevenueArtifactReferenceCompletenessReceipt"),
  controlTable("RevenueArtifactReferenceSourceSetProof"),
] as const;

export const ArtifactReferenceSourceWriterGuardContractSchema = z.object({
  guardVersion: z.literal(ARTIFACT_REFERENCE_SOURCE_WRITER_GUARD_VERSION),
  targetSchemaVersion: z.literal(ARTIFACT_REFERENCE_GUARDED_SCHEMA_VERSION),
  sourceTables: z.array(GuardedSourceTableSchema).length(ARTIFACT_REFERENCE_SOURCE_SET_ORDER.length),
  immutableControlTables: z.array(ControlTableSchema).length(ARTIFACT_REFERENCE_IMMUTABLE_CONTROL_TABLES.length),
  activeWindow: z.literal("acquiredAt <= database-now < expiresAt"),
  sealedAttemptUnlocksWriters: z.literal(true),
  providerAvailabilityMustPrecedeClaim: z.literal(true),
  databaseTriggersAreRequired: z.literal(true),
  applicationChecksAreSufficient: z.literal(false),
  allSourceWritersGuarded: z.literal(true),
  trustedExecutorImplemented: z.literal(true),
  completenessReceiptCreationAuthorized: z.literal(false),
  projectionPersistenceAuthorized: z.literal(false),
  retentionConclusionAuthorized: z.literal(false),
  releaseAuthorized: z.literal(false),
  deletionAuthorized: z.literal(false),
  providerOperationsAuthorized: z.literal(0),
  costAuthorizedUsd: z.literal(0),
}).strict().superRefine((contract, context) => {
  const names = contract.sourceTables.map((item) => item.setName);
  if (names.some((name, index) => name !== ARTIFACT_REFERENCE_SOURCE_SET_ORDER[index])) {
    context.addIssue({
      code: "custom",
      message: "Source-writer guards must follow and cover the immutable atomic source-set order.",
      path: ["sourceTables"],
    });
  }
  const tableNames = new Set(contract.sourceTables.map((item) => item.tableName));
  const triggerNames = new Set(contract.sourceTables.flatMap((item) => [
    item.insertTriggerName,
    item.updateTriggerName,
    item.deleteTriggerName,
  ]));
  if (tableNames.size !== contract.sourceTables.length || triggerNames.size !== contract.sourceTables.length * 3) {
    context.addIssue({ code: "custom", message: "Every atomic source table requires three unique database triggers.", path: ["sourceTables"] });
  }
});

export type ArtifactReferenceSourceWriterGuardContract = z.infer<typeof ArtifactReferenceSourceWriterGuardContractSchema>;

export function artifactReferenceSourceWriterGuardContract(): ArtifactReferenceSourceWriterGuardContract {
  return ArtifactReferenceSourceWriterGuardContractSchema.parse({
    guardVersion: ARTIFACT_REFERENCE_SOURCE_WRITER_GUARD_VERSION,
    targetSchemaVersion: ARTIFACT_REFERENCE_GUARDED_SCHEMA_VERSION,
    sourceTables: ARTIFACT_REFERENCE_GUARDED_SOURCE_TABLES,
    immutableControlTables: ARTIFACT_REFERENCE_IMMUTABLE_CONTROL_TABLES,
    activeWindow: "acquiredAt <= database-now < expiresAt",
    sealedAttemptUnlocksWriters: true,
    providerAvailabilityMustPrecedeClaim: true,
    databaseTriggersAreRequired: true,
    applicationChecksAreSufficient: false,
    allSourceWritersGuarded: true,
    trustedExecutorImplemented: true,
    completenessReceiptCreationAuthorized: false,
    projectionPersistenceAuthorized: false,
    retentionConclusionAuthorized: false,
    releaseAuthorized: false,
    deletionAuthorized: false,
    providerOperationsAuthorized: 0,
    costAuthorizedUsd: 0,
  });
}
