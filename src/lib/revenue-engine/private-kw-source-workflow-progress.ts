import { z } from "zod";

import {
  PrivateKwImportPlanSchema,
} from "@/lib/revenue-engine/private-kw-import";
import {
  PrivateKwShadowSliceManifestSchema,
} from "@/lib/revenue-engine/private-kw-shadow-slice";
import {
  PRIVATE_KW_SHADOW_PHASE_RECEIPT_VERSION,
  PrivateKwShadowSlicePhaseReceiptInputSchema,
  buildPrivateKwShadowSlicePhaseReceipt,
  privateKwShadowSliceProgressAuthority,
  type PrivateKwShadowSlicePhaseReceiptInput,
} from "@/lib/revenue-engine/private-kw-shadow-slice-progress";
import {
  buildPrivateKwSourceWorkflowMaterializationPlan,
  verifyPrivateKwSourceWorkflowPreflight,
  type PrivateKwSourceWorkflowRecordPlan,
} from "@/lib/revenue-engine/private-kw-source-workflow-materialization";

const TimestampSchema = z.string().datetime({ offset: true });

export type PrivateKwSourceWorkflowStoredRecordSnapshot = {
  entity: PrivateKwSourceWorkflowRecordPlan["entity"];
  recordId: string;
  rows: readonly Record<string, unknown>[];
};

function recordKey(record: Pick<PrivateKwSourceWorkflowStoredRecordSnapshot, "entity" | "recordId">) {
  return `${record.entity}|${record.recordId}`;
}

function verifyCompleteStoredMaterialization(
  planRecords: readonly PrivateKwSourceWorkflowRecordPlan[],
  snapshots: readonly PrivateKwSourceWorkflowStoredRecordSnapshot[],
) {
  const expectedKeys = planRecords.map(recordKey);
  const actualKeys = snapshots.map(recordKey);
  if (
    snapshots.length !== planRecords.length
    || new Set(actualKeys).size !== actualKeys.length
    || expectedKeys.some((key) => !actualKeys.includes(key))
    || actualKeys.some((key) => !expectedKeys.includes(key))
  ) {
    throw new Error("Stored source/workflow verification must cover the exact complete materialization plan.");
  }

  for (const record of planRecords) {
    const snapshot = snapshots.find((candidate) => recordKey(candidate) === recordKey(record));
    if (!snapshot) {
      throw new Error(`Stored materialization record is missing (${record.entity}:${record.recordId}).`);
    }
    const preflight = verifyPrivateKwSourceWorkflowPreflight(record, snapshot.rows);
    if (preflight.state !== "EXACT_MATCH") {
      throw new Error(`Stored materialization record is not exact (${record.entity}:${record.recordId}; ${preflight.state}).`);
    }
  }
}

export function buildPrivateKwSourceWorkflowProgressReceiptInput(input: {
  manifestValue: unknown;
  sourceValue: unknown;
  materializationValue: unknown;
  storedRecords: readonly PrivateKwSourceWorkflowStoredRecordSnapshot[];
  recordedAt: string;
}): PrivateKwShadowSlicePhaseReceiptInput {
  const manifest = PrivateKwShadowSliceManifestSchema.parse(input.manifestValue);
  const source = PrivateKwImportPlanSchema.parse(input.sourceValue);
  const recordedAt = TimestampSchema.parse(input.recordedAt);
  const plan = buildPrivateKwSourceWorkflowMaterializationPlan(source, input.materializationValue);

  if (
    manifest.sourceImportId !== source.importId
    || manifest.sourcePlanDigest !== plan.sourcePlanDigest
  ) {
    throw new Error("Source/workflow progress proof must bind the manifest's exact source plan.");
  }
  const manifestRecord = manifest.records.find((record) => record.businessId === plan.businessId);
  const sourceRecord = source.records.find((record) => record.business.id === plan.businessId);
  if (
    !manifestRecord
    || !sourceRecord
    || manifestRecord.evaluationCandidateId !== plan.evaluationCandidateId
    || manifestRecord.sourceRecordId !== sourceRecord.sourceRecord.id
    || sourceRecord.evaluationCandidateId !== plan.evaluationCandidateId
  ) {
    throw new Error("Source/workflow progress proof must identify one exact manifest business and source record.");
  }
  if (Date.parse(plan.recordedAt) < Date.parse(manifest.createdAt)) {
    throw new Error("Source/workflow materialization cannot predate the reviewed shadow-slice manifest.");
  }

  verifyCompleteStoredMaterialization(plan.records, input.storedRecords);

  const workflowReceipt = plan.records.find((record) => record.entity === "WORKFLOW_RECEIPT");
  const closure = plan.records.find((record) => record.entity === "WORKFLOW_CLOSURE");
  const materializationReceipt = plan.records.find((record) => record.entity === "MATERIALIZATION_RECEIPT");
  if (
    !workflowReceipt
    || !closure
    || !materializationReceipt
    || workflowReceipt.recordId !== plan.workflowReceiptId
    || materializationReceipt.recordId !== plan.materializationId
    || closure.expected.terminalReceiptId !== plan.workflowReceiptId
    || closure.expected.status !== "SEALED"
  ) {
    throw new Error("Source/workflow progress requires exact sealed workflow and materialization receipts.");
  }

  const receipt = PrivateKwShadowSlicePhaseReceiptInputSchema.parse({
    receiptVersion: PRIVATE_KW_SHADOW_PHASE_RECEIPT_VERSION,
    manifestId: manifest.manifestId,
    manifestDigest: manifest.manifestDigest,
    businessId: plan.businessId,
    evaluationCandidateId: plan.evaluationCandidateId,
    phase: "SOURCE_WORKFLOW",
    completedAt: plan.recordedAt,
    proof: {
      proofKind: "SOURCE_WORKFLOW_MATERIALIZATION",
      primaryReceiptId: plan.materializationId,
      primaryReceiptDigest: plan.materializationDigest,
      supportingReceipts: [{
        receiptId: plan.workflowReceiptId,
        receiptDigest: plan.workflowReceiptId.slice("workflow-receipt:".length),
      }],
    },
    previousPhaseReceipt: null,
    recordedBy: "CODEX_INTEGRATION_OWNER",
    recordedAt,
    authority: privateKwShadowSliceProgressAuthority(),
  });

  buildPrivateKwShadowSlicePhaseReceipt(manifest, receipt);
  return receipt;
}
