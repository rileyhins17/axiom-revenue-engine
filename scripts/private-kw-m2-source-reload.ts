import Database from "better-sqlite3";

import { PrivateKwImportPlanSchema } from "../src/lib/revenue-engine/private-kw-import";
import {
  buildPrivateKwSourceWorkflowMaterializationPlan,
  PrivateKwSourceWorkflowMaterializationInputSchema,
  verifyPrivateKwSourceWorkflowPreflight,
  type PrivateKwSourceWorkflowMaterializationPlan,
  type PrivateKwSourceWorkflowMaterializationInput,
} from "../src/lib/revenue-engine/private-kw-source-workflow-materialization";
import { PrivateKwShadowSliceManifestSchema, type PrivateKwShadowSliceManifest } from "../src/lib/revenue-engine/private-kw-shadow-slice";

type SourcePlan = ReturnType<typeof PrivateKwImportPlanSchema.parse>;
type Reloaded = Readonly<{
  plan: PrivateKwSourceWorkflowMaterializationPlan;
  record: PrivateKwShadowSliceManifest["records"][number];
  sourcePlan: SourcePlan;
  manifest: PrivateKwShadowSliceManifest;
  materialization: PrivateKwSourceWorkflowMaterializationInput;
}>;

const capabilities = new WeakSet<object>();

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

export function requirePrivateKwM2SourceMaterializationReload(value: object): Reloaded {
  if (!capabilities.has(value)) throw new Error("M2 source materialization reload capability is invalid or copied.");
  return value as Reloaded;
}

export function reloadPrivateKwM2SourceMaterialization(
  database: Database.Database,
  input: { sourceValue: unknown; materializationValue: unknown; manifestValue: unknown; businessId: string },
): Reloaded {
  const sourcePlan = PrivateKwImportPlanSchema.parse(input.sourceValue);
  const materialization = PrivateKwSourceWorkflowMaterializationInputSchema.parse(input.materializationValue);
  const manifest = PrivateKwShadowSliceManifestSchema.parse(input.manifestValue);
  const plan = buildPrivateKwSourceWorkflowMaterializationPlan(sourcePlan, materialization);
  if (plan.businessId !== input.businessId || materialization.businessId !== input.businessId) throw new Error("M2 source reload business identity mismatch.");
  if (manifest.sourceImportId !== sourcePlan.importId || manifest.sourcePlanDigest !== plan.sourcePlanDigest) throw new Error("M2 source reload manifest is not bound to the selected source plan.");
  const record = manifest.records.find((candidate) => candidate.businessId === input.businessId && candidate.evaluationCandidateId === plan.evaluationCandidateId);
  const selectedSourceRecord = plan.records.find((candidate) => candidate.entity === "SOURCE_RECORD" && candidate.expected.businessId === input.businessId);
  if (!record || record.sourceRecordId !== selectedSourceRecord?.recordId) throw new Error("M2 source reload manifest record does not match the selected source identities.");
  if (plan.records.at(-1)?.entity !== "MATERIALIZATION_RECEIPT") throw new Error("M2 source reload requires the materialization receipt last.");
  for (const planned of plan.records) {
    const rows = database.prepare(planned.selectSql).all(...planned.selectBindings) as Record<string, unknown>[];
    if (rows.length !== 1 || verifyPrivateKwSourceWorkflowPreflight(planned, rows).state !== "EXACT_MATCH") {
      throw new Error(`M2 source reload did not find the exact ${planned.entity} row.`);
    }
  }
  const result = deepFreeze({ plan, record, sourcePlan, manifest, materialization });
  capabilities.add(result);
  return result;
}
