import { createHash } from "node:crypto";

import { z } from "zod";

import {
  BROWSER_MEASUREMENT_ADAPTER_VERSION,
} from "@/lib/revenue-engine/browser-measurement-adapter";
import {
  BROWSER_PAGE_EVIDENCE_VERSION,
  BrowserPageEvidenceSchema,
} from "@/lib/revenue-engine/browser-page-evidence";
import {
  ARTIFACT_STORE_CONTRACT_VERSION,
  ArtifactWritePlanSchema,
  ArtifactWriteReceiptSchema,
} from "@/lib/revenue-engine/content-addressed-artifact-store";
import {
  FIXTURE_WEBSITE_EVIDENCE_WORKFLOW_STEPS,
  FIXTURE_WEBSITE_EVIDENCE_WORKFLOW_VERSION,
  FixtureWebsiteEvidenceWorkflowReceiptSchema,
  FixtureWebsiteEvidenceWorkflowRequestSchema,
  FixtureWebsiteEvidenceWorkflowStepSchema,
  type FixtureWebsiteEvidenceArtifactObservation,
  type FixtureWebsiteEvidenceCheckpointObservation,
  type FixtureWebsiteEvidenceWorkflowReceipt,
  type FixtureWebsiteEvidenceWorkflowRequest,
} from "@/lib/revenue-engine/fixture-website-evidence-workflow";
import {
  HTML_PAGE_FACTS_VERSION,
  HtmlPageFactsSchema,
} from "@/lib/revenue-engine/html-page-facts";
import {
  DETERMINISTIC_WEBSITE_AUDIT_VERSION,
  DeterministicWebsiteAuditInputSchema,
  DeterministicWebsiteAuditResultSchema,
  WebsitePageKindSchema,
  auditWebsiteDeterministically,
} from "@/lib/revenue-engine/website-audit";
import {
  WEBSITE_AUDIT_ASSEMBLY_VERSION,
  WebsiteAuditAssemblySchema,
  assembleWebsiteAuditInput,
  defaultWebsiteAuditAssemblyPolicy,
} from "@/lib/revenue-engine/website-audit-assembly";
import {
  WEBSITE_CAPTURE_VERSION,
  WebsiteCaptureResultSchema,
} from "@/lib/revenue-engine/website-capture";
import {
  WEBSITE_PAGE_SELECTION_VERSION,
  WebsitePageSelectionPlanSchema,
} from "@/lib/revenue-engine/website-page-selection";

export const FIXTURE_WEBSITE_EVIDENCE_RESUME_PLAN_VERSION = "fixture-website-evidence-resume-plan-v1";
export const FIXTURE_WEBSITE_EVIDENCE_DEFINITION_VERSION = "fixture-website-evidence-definition-v1";
export const FIXTURE_WEBSITE_EVIDENCE_CHECKPOINT_VERSION = "fixture-website-evidence-checkpoint-v1";
export const FIXTURE_WEBSITE_EVIDENCE_CHECKPOINT_LOCATOR_VERSION = "fixture-checkpoint-locator-v1";
export const FIXTURE_WEBSITE_EVIDENCE_DELIVERY_VERSION = "fixture-workflow-delivery-v1";
export const FIXTURE_WEBSITE_EVIDENCE_ATTEMPT_VERSION = "fixture-workflow-attempt-v1";
export const FIXTURE_WEBSITE_EVIDENCE_LEASE_VERSION = "fixture-workflow-lease-v1";
export const FIXTURE_WEBSITE_EVIDENCE_ARTIFACT_RECOVERY_VERSION = "fixture-artifact-recovery-v1";
export const FIXTURE_WEBSITE_EVIDENCE_RECEIPT_REVISION_VERSION = "fixture-workflow-receipt-revision-v1";
export const FIXTURE_WEBSITE_EVIDENCE_CHECKPOINT_MAX_BYTES = 8_388_608;

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const TimestampSchema = z.string().datetime({ offset: true });
const SitePathSchema = z.enum(["CAPTURED", "UNREACHABLE"]);

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right, "en-CA"))
      .map(([key, child]) => [key, canonicalValue(child)]));
  }
  return value;
}

function canonicalJson(value: unknown) {
  return JSON.stringify(canonicalValue(value));
}

function digest(value: unknown) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function byteLength(value: unknown) {
  return new TextEncoder().encode(canonicalJson(value)).byteLength;
}

function deterministicUuid(seed: string) {
  const hash = createHash("sha256").update(seed).digest("hex").slice(0, 32).split("");
  hash[12] = "4";
  hash[16] = ((Number.parseInt(hash[16], 16) & 0x3) | 0x8).toString(16);
  const value = hash.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

const DefinitionStepSchema = z.object({
  step: z.string().trim().min(1).max(80),
  ordinal: z.number().int().positive().max(100),
  capturedDependencies: z.array(z.string().trim().min(1).max(80)).max(4),
  unreachableDependencies: z.array(z.string().trim().min(1).max(80)).max(4),
  resumeMode: z.enum(["DIRECT", "RECONCILE_ARTIFACTS", "FINALIZE_ONLY"]),
}).strict();

export const FixtureWebsiteEvidenceDefinitionDescriptorSchema = z.object({
  descriptorVersion: z.string().trim().min(1).max(100),
  workflowKind: z.literal("WEBSITE_EVIDENCE"),
  workflowVersion: z.string().trim().min(1).max(100),
  graphVersion: z.string().trim().min(1).max(100),
  checkpointCodecVersion: z.string().trim().min(1).max(100),
  componentVersions: z.record(z.string().trim().min(1).max(100), z.string().trim().min(1).max(100)),
  steps: z.array(DefinitionStepSchema).min(1).max(100),
  definitionDigest: Sha256Schema,
}).strict().superRefine((descriptor, context) => {
  const { definitionDigest, ...core } = descriptor;
  if (digest(core) !== definitionDigest) {
    context.addIssue({ code: "custom", message: "Workflow definition digest must bind the exact graph and component versions.", path: ["definitionDigest"] });
  }
  if (new Set(descriptor.steps.map((step) => step.step)).size !== descriptor.steps.length) {
    context.addIssue({ code: "custom", message: "Workflow definition step names must be unique.", path: ["steps"] });
  }
  if (new Set(descriptor.steps.map((step) => step.ordinal)).size !== descriptor.steps.length) {
    context.addIssue({ code: "custom", message: "Workflow definition step ordinals must be unique.", path: ["steps"] });
  }
});

export type FixtureWebsiteEvidenceDefinitionDescriptor = z.infer<typeof FixtureWebsiteEvidenceDefinitionDescriptorSchema>;

export function currentFixtureWebsiteEvidenceDefinition(): FixtureWebsiteEvidenceDefinitionDescriptor {
  const core = {
    descriptorVersion: FIXTURE_WEBSITE_EVIDENCE_DEFINITION_VERSION,
    workflowKind: "WEBSITE_EVIDENCE" as const,
    workflowVersion: FIXTURE_WEBSITE_EVIDENCE_WORKFLOW_VERSION,
    graphVersion: "fixture-website-evidence-graph-v1",
    checkpointCodecVersion: FIXTURE_WEBSITE_EVIDENCE_CHECKPOINT_VERSION,
    componentVersions: {
      capture: WEBSITE_CAPTURE_VERSION,
      htmlFacts: HTML_PAGE_FACTS_VERSION,
      pageSelection: WEBSITE_PAGE_SELECTION_VERSION,
      browserMeasurement: BROWSER_MEASUREMENT_ADAPTER_VERSION,
      browserEvidence: BROWSER_PAGE_EVIDENCE_VERSION,
      artifactStore: ARTIFACT_STORE_CONTRACT_VERSION,
      auditAssembly: WEBSITE_AUDIT_ASSEMBLY_VERSION,
      audit: DETERMINISTIC_WEBSITE_AUDIT_VERSION,
    },
    steps: [
      { step: "CAPTURE_HOME", ordinal: 1, capturedDependencies: [], unreachableDependencies: [], resumeMode: "DIRECT" as const },
      { step: "EXTRACT_HOME", ordinal: 2, capturedDependencies: ["CAPTURE_HOME"], unreachableDependencies: [], resumeMode: "DIRECT" as const },
      { step: "SELECT_PAGES", ordinal: 3, capturedDependencies: ["EXTRACT_HOME"], unreachableDependencies: [], resumeMode: "DIRECT" as const },
      { step: "CAPTURE_SUBPAGES", ordinal: 4, capturedDependencies: ["SELECT_PAGES"], unreachableDependencies: [], resumeMode: "DIRECT" as const },
      { step: "MEASURE_BROWSER", ordinal: 5, capturedDependencies: ["CAPTURE_SUBPAGES"], unreachableDependencies: [], resumeMode: "RECONCILE_ARTIFACTS" as const },
      { step: "STORE_ARTIFACTS", ordinal: 6, capturedDependencies: ["MEASURE_BROWSER"], unreachableDependencies: [], resumeMode: "DIRECT" as const },
      { step: "ASSEMBLE_AUDIT", ordinal: 7, capturedDependencies: ["STORE_ARTIFACTS"], unreachableDependencies: [], resumeMode: "DIRECT" as const },
      { step: "RUN_AUDIT", ordinal: 8, capturedDependencies: ["ASSEMBLE_AUDIT"], unreachableDependencies: ["CAPTURE_HOME"], resumeMode: "FINALIZE_ONLY" as const },
    ],
  };
  return FixtureWebsiteEvidenceDefinitionDescriptorSchema.parse({ ...core, definitionDigest: digest(core) });
}

export function fixtureWebsiteEvidenceRequestDigest(value: FixtureWebsiteEvidenceWorkflowRequest) {
  return digest(FixtureWebsiteEvidenceWorkflowRequestSchema.parse(value));
}

export const FixtureWorkflowDeliveryRecordSchema = z.object({
  deliveryVersion: z.literal(FIXTURE_WEBSITE_EVIDENCE_DELIVERY_VERSION),
  deliveryId: z.string().trim().min(8).max(200),
  workflowId: z.string().uuid(),
  workflowVersion: z.string().trim().min(1).max(100),
  definitionDigest: Sha256Schema,
  requestDigest: Sha256Schema,
  payloadDigest: Sha256Schema,
  receivedAt: TimestampSchema,
  mode: z.literal("SHADOW"),
  deliveryKind: z.literal("FIXTURE"),
}).strict().superRefine((record, context) => {
  if (record.payloadDigest !== record.requestDigest) {
    context.addIssue({ code: "custom", message: "Fixture delivery payload must be the exact workflow request.", path: ["payloadDigest"] });
  }
});

export type FixtureWorkflowDeliveryRecord = z.infer<typeof FixtureWorkflowDeliveryRecordSchema>;

export const FixtureWorkflowAttemptSnapshotSchema = z.object({
  attemptVersion: z.literal(FIXTURE_WEBSITE_EVIDENCE_ATTEMPT_VERSION),
  attemptId: z.string().uuid(),
  workflowId: z.string().uuid(),
  workflowVersion: z.string().trim().min(1).max(100),
  definitionDigest: Sha256Schema,
  requestDigest: Sha256Schema,
  deliveryId: z.string().trim().min(8).max(200),
  attemptNumber: z.number().int().positive().max(10_000),
  fencingToken: z.number().int().positive().max(2_147_483_647),
  status: z.enum(["RUNNING", "FAILED", "SEALED", "ABANDONED"]),
  startedAt: TimestampSchema,
  endedAt: TimestampSchema.nullable(),
  terminalReceiptId: z.string().trim().min(1).max(200).nullable(),
}).strict().superRefine((attempt, context) => {
  const ended = attempt.status !== "RUNNING";
  if (ended !== Boolean(attempt.endedAt)) {
    context.addIssue({ code: "custom", message: "Only an ended attempt may have an end timestamp.", path: ["endedAt"] });
  }
  if ((attempt.status === "SEALED") !== Boolean(attempt.terminalReceiptId)) {
    context.addIssue({ code: "custom", message: "Only a sealed attempt may link a terminal receipt.", path: ["terminalReceiptId"] });
  }
});

export type FixtureWorkflowAttemptSnapshot = z.infer<typeof FixtureWorkflowAttemptSnapshotSchema>;

export const FixtureWorkflowLeaseClaimSchema = z.object({
  leaseVersion: z.literal(FIXTURE_WEBSITE_EVIDENCE_LEASE_VERSION),
  leaseId: z.string().uuid(),
  workflowId: z.string().uuid(),
  workflowVersion: z.string().trim().min(1).max(100),
  definitionDigest: Sha256Schema,
  requestDigest: Sha256Schema,
  attemptId: z.string().uuid(),
  attemptNumber: z.number().int().positive().max(10_000),
  deliveryId: z.string().trim().min(8).max(200),
  ownerId: z.string().trim().min(1).max(200),
  fencingToken: z.number().int().positive().max(2_147_483_647),
  acquiredAt: TimestampSchema,
  expiresAt: TimestampSchema,
  mode: z.literal("SHADOW"),
  leaseKind: z.literal("FIXTURE"),
}).strict().superRefine((lease, context) => {
  if (Date.parse(lease.expiresAt) <= Date.parse(lease.acquiredAt)) {
    context.addIssue({ code: "custom", message: "A workflow lease must expire after it is acquired.", path: ["expiresAt"] });
  }
});

export type FixtureWorkflowLeaseClaim = z.infer<typeof FixtureWorkflowLeaseClaimSchema>;

const SubpageCheckpointSchema = z.object({
  pageKind: WebsitePageKindSchema,
  capture: WebsiteCaptureResultSchema,
  html: HtmlPageFactsSchema.nullable(),
}).strict().superRefine((page, context) => {
  if (page.pageKind === "HOME") {
    context.addIssue({ code: "custom", message: "Subpage checkpoints cannot duplicate the homepage.", path: ["pageKind"] });
  }
  if ((page.capture.outcome === "CAPTURED") !== Boolean(page.html)) {
    context.addIssue({ code: "custom", message: "Only a captured subpage can retain extracted HTML facts.", path: ["html"] });
  }
  if (page.html && (page.html.pageKind !== page.pageKind || page.html.url !== page.capture.finalUrl)) {
    context.addIssue({ code: "custom", message: "Subpage HTML must match its capture kind and final URL.", path: ["html"] });
  }
});

const CheckpointPayloadBaseSchema = z.object({
  checkpointVersion: z.literal(FIXTURE_WEBSITE_EVIDENCE_CHECKPOINT_VERSION),
  checkpointId: z.string().uuid(),
  workflowId: z.string().uuid(),
  workflowVersion: z.literal(FIXTURE_WEBSITE_EVIDENCE_WORKFLOW_VERSION),
  definitionDigest: Sha256Schema,
  requestDigest: Sha256Schema,
  attemptId: z.string().uuid(),
  attemptNumber: z.number().int().positive().max(10_000),
  fencingToken: z.number().int().positive().max(2_147_483_647),
  sitePath: SitePathSchema,
  completedAt: TimestampSchema,
});

export const FixtureWebsiteEvidenceCheckpointPayloadSchema = z.discriminatedUnion("step", [
  CheckpointPayloadBaseSchema.extend({ step: z.literal("CAPTURE_HOME"), output: WebsiteCaptureResultSchema }).strict(),
  CheckpointPayloadBaseSchema.extend({ step: z.literal("EXTRACT_HOME"), sitePath: z.literal("CAPTURED"), output: HtmlPageFactsSchema }).strict(),
  CheckpointPayloadBaseSchema.extend({ step: z.literal("SELECT_PAGES"), sitePath: z.literal("CAPTURED"), output: WebsitePageSelectionPlanSchema }).strict(),
  CheckpointPayloadBaseSchema.extend({ step: z.literal("CAPTURE_SUBPAGES"), sitePath: z.literal("CAPTURED"), output: z.array(SubpageCheckpointSchema).max(3) }).strict(),
  CheckpointPayloadBaseSchema.extend({ step: z.literal("MEASURE_BROWSER"), sitePath: z.literal("CAPTURED"), output: z.array(BrowserPageEvidenceSchema).max(5) }).strict(),
  CheckpointPayloadBaseSchema.extend({ step: z.literal("STORE_ARTIFACTS"), sitePath: z.literal("CAPTURED"), output: z.array(ArtifactWriteReceiptSchema).max(5) }).strict().superRefine((payload, context) => {
    if (payload.output.some((receipt) => receipt.outcome !== "COMPLETED")) {
      context.addIssue({ code: "custom", message: "A committed storage checkpoint may contain only completed artifact receipts.", path: ["output"] });
    }
  }),
  CheckpointPayloadBaseSchema.extend({ step: z.literal("ASSEMBLE_AUDIT"), sitePath: z.literal("CAPTURED"), output: WebsiteAuditAssemblySchema }).strict(),
  CheckpointPayloadBaseSchema.extend({ step: z.literal("RUN_AUDIT"), output: DeterministicWebsiteAuditResultSchema }).strict(),
]);

export type FixtureWebsiteEvidenceCheckpointPayload = z.infer<typeof FixtureWebsiteEvidenceCheckpointPayloadSchema>;

const CheckpointDependencySchema = z.object({
  checkpointId: z.string().uuid(),
  payloadDigest: Sha256Schema,
}).strict();

const CheckpointLocatorSchema = z.object({
  locatorVersion: z.literal(FIXTURE_WEBSITE_EVIDENCE_CHECKPOINT_LOCATOR_VERSION),
  locatorKind: z.literal("FIXTURE_CONTENT_ADDRESS"),
  payloadRef: z.string().regex(/^fixture-checkpoint:sha256:[a-f0-9]{64}$/),
  payloadDigest: Sha256Schema,
  payloadByteLength: z.number().int().positive().max(FIXTURE_WEBSITE_EVIDENCE_CHECKPOINT_MAX_BYTES),
}).strict().superRefine((locator, context) => {
  if (locator.payloadRef !== `fixture-checkpoint:sha256:${locator.payloadDigest}`) {
    context.addIssue({ code: "custom", message: "Checkpoint locator reference must match its payload digest.", path: ["payloadRef"] });
  }
});

export const FixtureWebsiteEvidenceCheckpointRecordSchema = z.object({
  checkpointVersion: z.string().trim().min(1).max(100),
  checkpointId: z.string().uuid(),
  workflowId: z.string().uuid(),
  workflowVersion: z.string().trim().min(1).max(100),
  definitionDigest: Sha256Schema,
  requestDigest: Sha256Schema,
  attemptId: z.string().uuid(),
  attemptNumber: z.number().int().positive().max(10_000),
  fencingToken: z.number().int().positive().max(2_147_483_647),
  step: z.string().trim().min(1).max(80),
  stepOrdinal: z.number().int().positive().max(100),
  sitePath: SitePathSchema,
  commitState: z.enum(["PREPARED", "COMMITTED"]),
  outputDigest: Sha256Schema,
  locator: CheckpointLocatorSchema,
  dependencies: z.array(CheckpointDependencySchema).max(4),
  completedAt: TimestampSchema,
  recordedAt: TimestampSchema,
}).strict().superRefine((record, context) => {
  const canonical = [...record.dependencies].sort((left, right) => left.checkpointId.localeCompare(right.checkpointId, "en-CA"));
  if (canonicalJson(canonical) !== canonicalJson(record.dependencies)) {
    context.addIssue({ code: "custom", message: "Checkpoint dependencies must use canonical checkpoint-ID order.", path: ["dependencies"] });
  }
  if (new Set(record.dependencies.map((dependency) => dependency.checkpointId)).size !== record.dependencies.length) {
    context.addIssue({ code: "custom", message: "Checkpoint dependencies must be unique.", path: ["dependencies"] });
  }
});

export type FixtureWebsiteEvidenceCheckpointRecord = z.infer<typeof FixtureWebsiteEvidenceCheckpointRecordSchema>;

export const FixtureWebsiteEvidenceCheckpointBundleSchema = z.object({
  record: FixtureWebsiteEvidenceCheckpointRecordSchema,
  payload: z.unknown(),
}).strict();

export type FixtureWebsiteEvidenceCheckpointBundle = z.infer<typeof FixtureWebsiteEvidenceCheckpointBundleSchema>;

export const FixtureArtifactRecoveryRecordSchema = z.object({
  recoveryVersion: z.literal(FIXTURE_WEBSITE_EVIDENCE_ARTIFACT_RECOVERY_VERSION),
  recoveryId: z.string().uuid(),
  workflowId: z.string().uuid(),
  workflowVersion: z.string().trim().min(1).max(100),
  definitionDigest: Sha256Schema,
  requestDigest: Sha256Schema,
  attemptId: z.string().uuid(),
  attemptNumber: z.number().int().positive().max(10_000),
  fencingToken: z.number().int().positive().max(2_147_483_647),
  pageKind: WebsitePageKindSchema,
  profile: z.enum(["DESKTOP_1440X900", "MOBILE_390X844"]),
  planId: z.string().uuid(),
  planDigest: Sha256Schema,
  receiptDigest: Sha256Schema,
  plan: ArtifactWritePlanSchema,
  receipt: ArtifactWriteReceiptSchema,
  recordedAt: TimestampSchema,
}).strict().superRefine((record, context) => {
  if (record.planId !== record.plan.planId || record.planId !== record.receipt.planId) {
    context.addIssue({ code: "custom", message: "Artifact recovery identity must match its plan and receipt.", path: ["planId"] });
  }
  if (record.workflowId !== record.plan.workflowId || record.workflowId !== record.receipt.workflowId) {
    context.addIssue({ code: "custom", message: "Artifact recovery plan and receipt must belong to the workflow.", path: ["workflowId"] });
  }
  if (digest(record.plan) !== record.planDigest || digest(record.receipt) !== record.receiptDigest) {
    context.addIssue({ code: "custom", message: "Artifact recovery digests must bind the exact plan and receipt.", path: ["receiptDigest"] });
  }
  if (record.plan.items.length !== record.receipt.plannedItemCount) {
    context.addIssue({ code: "custom", message: "Artifact recovery receipt count must match its plan.", path: ["receipt", "plannedItemCount"] });
  }
  for (const [index, item] of record.receipt.items.entries()) {
    const planned = record.plan.items[index];
    if (!planned || planned.kind !== item.kind || planned.objectKey !== item.objectKey || planned.sha256 !== item.sha256 || planned.byteLength !== item.byteLength) {
      context.addIssue({ code: "custom", message: "Artifact recovery receipt items must match the exact sequential plan.", path: ["receipt", "items", index] });
    }
  }
});

export type FixtureArtifactRecoveryRecord = z.infer<typeof FixtureArtifactRecoveryRecordSchema>;

export const FixtureWorkflowReceiptRevisionSchema = z.object({
  revisionVersion: z.literal(FIXTURE_WEBSITE_EVIDENCE_RECEIPT_REVISION_VERSION),
  receiptId: z.string().trim().min(1).max(200),
  workflowId: z.string().uuid(),
  workflowVersion: z.string().trim().min(1).max(100),
  definitionDigest: Sha256Schema,
  requestDigest: Sha256Schema,
  attemptId: z.string().uuid(),
  attemptNumber: z.number().int().positive().max(10_000),
  receiptDigest: Sha256Schema,
  receipt: z.unknown(),
  recordedAt: TimestampSchema,
}).strict();

export type FixtureWorkflowReceiptRevision = z.infer<typeof FixtureWorkflowReceiptRevisionSchema>;

function captureSummary(capture: z.infer<typeof WebsiteCaptureResultSchema>) {
  return {
    captureVersion: capture.captureVersion,
    outcome: capture.outcome,
    requestedUrl: capture.requestedUrl,
    finalUrl: capture.finalUrl,
    statusCode: capture.statusCode,
    redirectCount: capture.redirectCount,
    bodyBytes: capture.bodyBytes,
    capturedAt: capture.capturedAt,
    failure: capture.failure,
  };
}

function observationOutputDigest(observation: FixtureWebsiteEvidenceCheckpointObservation) {
  if (observation.step === "CAPTURE_HOME") return digest(captureSummary(observation.output));
  if (observation.step === "CAPTURE_SUBPAGES") return digest(observation.output.map((page) => captureSummary(page.capture)));
  return digest(observation.output);
}

function payloadOutputDigest(payload: FixtureWebsiteEvidenceCheckpointPayload) {
  if (payload.step === "CAPTURE_HOME") return digest(captureSummary(payload.output));
  if (payload.step === "CAPTURE_SUBPAGES") return digest(payload.output.map((page) => captureSummary(page.capture)));
  return digest(payload.output);
}

function expectedDependencySteps(step: string, sitePath: z.infer<typeof SitePathSchema>) {
  const definition = currentFixtureWebsiteEvidenceDefinition();
  const descriptor = definition.steps.find((candidate) => candidate.step === step);
  if (!descriptor) return null;
  return sitePath === "CAPTURED" ? descriptor.capturedDependencies : descriptor.unreachableDependencies;
}

function checkpointOrdinal(step: string) {
  return currentFixtureWebsiteEvidenceDefinition().steps.find((candidate) => candidate.step === step)?.ordinal ?? null;
}

export function createFixtureWebsiteEvidenceCheckpointCommit(input: {
  request: FixtureWebsiteEvidenceWorkflowRequest;
  definition: FixtureWebsiteEvidenceDefinitionDescriptor;
  attempt: FixtureWorkflowAttemptSnapshot;
  lease: FixtureWorkflowLeaseClaim;
  observation: FixtureWebsiteEvidenceCheckpointObservation;
  dependencies: FixtureWebsiteEvidenceCheckpointBundle[];
  commitState?: "PREPARED" | "COMMITTED";
  recordedAt: string;
}): FixtureWebsiteEvidenceCheckpointBundle {
  const request = FixtureWebsiteEvidenceWorkflowRequestSchema.parse(input.request);
  const definition = FixtureWebsiteEvidenceDefinitionDescriptorSchema.parse(input.definition);
  const attempt = FixtureWorkflowAttemptSnapshotSchema.parse(input.attempt);
  const lease = FixtureWorkflowLeaseClaimSchema.parse(input.lease);
  const observation = input.observation;
  const requestDigest = fixtureWebsiteEvidenceRequestDigest(request);
  if (
    definition.definitionDigest !== currentFixtureWebsiteEvidenceDefinition().definitionDigest
    || attempt.workflowId !== request.workflowId
    || lease.workflowId !== request.workflowId
    || attempt.attemptId !== lease.attemptId
    || attempt.attemptNumber !== lease.attemptNumber
    || attempt.fencingToken !== lease.fencingToken
    || attempt.workflowVersion !== request.workflowVersion
    || lease.workflowVersion !== request.workflowVersion
    || attempt.definitionDigest !== definition.definitionDigest
    || lease.definitionDigest !== definition.definitionDigest
    || attempt.requestDigest !== requestDigest
    || lease.requestDigest !== requestDigest
  ) {
    throw new Error("Checkpoint commit requires one exact current request, definition, attempt, and fenced lease.");
  }
  if (Date.parse(observation.completedAt) < Date.parse(lease.acquiredAt) || Date.parse(observation.completedAt) >= Date.parse(lease.expiresAt)) {
    throw new Error("Checkpoint commit must occur while its exact fenced lease is active.");
  }
  const expectedSteps = expectedDependencySteps(observation.step, observation.sitePath);
  if (!expectedSteps) throw new Error("Checkpoint observation step is not in the current workflow definition.");
  const dependencyPayloads = input.dependencies.map((bundle) => FixtureWebsiteEvidenceCheckpointPayloadSchema.parse(bundle.payload));
  for (const [index, bundle] of input.dependencies.entries()) {
    const dependency = dependencyPayloads[index];
    if (
      !dependency
      || bundle.record.commitState !== "COMMITTED"
      || bundle.record.checkpointId !== dependency.checkpointId
      || bundle.record.locator.payloadDigest !== digest(dependency)
      || bundle.record.locator.payloadByteLength !== byteLength(dependency)
      || bundle.record.workflowId !== request.workflowId
      || bundle.record.workflowVersion !== request.workflowVersion
      || bundle.record.definitionDigest !== definition.definitionDigest
      || bundle.record.requestDigest !== requestDigest
      || dependency.sitePath !== observation.sitePath
      || Date.parse(dependency.completedAt) > Date.parse(observation.completedAt)
    ) {
      throw new Error(`Checkpoint ${observation.step} requires exact committed dependencies from the same request and site path.`);
    }
  }
  const suppliedSteps = dependencyPayloads.map((payload) => payload.step).sort((left, right) => left.localeCompare(right, "en-CA"));
  const canonicalExpected = [...expectedSteps].sort((left, right) => left.localeCompare(right, "en-CA"));
  if (canonicalJson(suppliedSteps) !== canonicalJson(canonicalExpected)) {
    throw new Error(`Checkpoint ${observation.step} requires its exact dependency set.`);
  }
  const outputDigest = observationOutputDigest(observation);
  const checkpointId = deterministicUuid(`${attempt.attemptId}:${observation.step}:${observation.sitePath}:${outputDigest}`);
  const payload = FixtureWebsiteEvidenceCheckpointPayloadSchema.parse({
    checkpointVersion: FIXTURE_WEBSITE_EVIDENCE_CHECKPOINT_VERSION,
    checkpointId,
    workflowId: request.workflowId,
    workflowVersion: request.workflowVersion,
    definitionDigest: definition.definitionDigest,
    requestDigest,
    attemptId: attempt.attemptId,
    attemptNumber: attempt.attemptNumber,
    fencingToken: attempt.fencingToken,
    step: observation.step,
    sitePath: observation.sitePath,
    completedAt: observation.completedAt,
    output: observation.output,
  });
  const payloadDigest = digest(payload);
  const payloadByteLength = byteLength(payload);
  if (payloadByteLength > FIXTURE_WEBSITE_EVIDENCE_CHECKPOINT_MAX_BYTES) {
    throw new Error("Checkpoint payload exceeds the bounded fixture payload limit.");
  }
  const dependencies = input.dependencies.map((bundle) => ({
    checkpointId: bundle.record.checkpointId,
    payloadDigest: bundle.record.locator.payloadDigest,
  })).sort((left, right) => left.checkpointId.localeCompare(right.checkpointId, "en-CA"));
  const ordinal = checkpointOrdinal(observation.step);
  if (!ordinal) throw new Error("Checkpoint step does not have a current ordinal.");
  const record = FixtureWebsiteEvidenceCheckpointRecordSchema.parse({
    checkpointVersion: FIXTURE_WEBSITE_EVIDENCE_CHECKPOINT_VERSION,
    checkpointId,
    workflowId: request.workflowId,
    workflowVersion: request.workflowVersion,
    definitionDigest: definition.definitionDigest,
    requestDigest,
    attemptId: attempt.attemptId,
    attemptNumber: attempt.attemptNumber,
    fencingToken: attempt.fencingToken,
    step: observation.step,
    stepOrdinal: ordinal,
    sitePath: observation.sitePath,
    commitState: input.commitState || "COMMITTED",
    outputDigest,
    locator: {
      locatorVersion: FIXTURE_WEBSITE_EVIDENCE_CHECKPOINT_LOCATOR_VERSION,
      locatorKind: "FIXTURE_CONTENT_ADDRESS",
      payloadRef: `fixture-checkpoint:sha256:${payloadDigest}`,
      payloadDigest,
      payloadByteLength,
    },
    dependencies,
    completedAt: observation.completedAt,
    recordedAt: input.recordedAt,
  });
  return FixtureWebsiteEvidenceCheckpointBundleSchema.parse({ record, payload });
}

export function createFixtureWebsiteEvidenceCheckpointChain(input: {
  request: FixtureWebsiteEvidenceWorkflowRequest;
  definition: FixtureWebsiteEvidenceDefinitionDescriptor;
  attempt: FixtureWorkflowAttemptSnapshot;
  lease: FixtureWorkflowLeaseClaim;
  observations: FixtureWebsiteEvidenceCheckpointObservation[];
  recordedAt: string;
}) {
  const byStep = new Map<string, FixtureWebsiteEvidenceCheckpointBundle>();
  const bundles: FixtureWebsiteEvidenceCheckpointBundle[] = [];
  for (const observation of input.observations) {
    const dependencySteps = expectedDependencySteps(observation.step, observation.sitePath);
    if (!dependencySteps) throw new Error("Checkpoint observation uses an unknown workflow step.");
    const dependencies = dependencySteps.map((step) => {
      const dependency = byStep.get(step);
      if (!dependency) throw new Error(`Checkpoint observation is missing committed dependency ${step}.`);
      return dependency;
    });
    const bundle = createFixtureWebsiteEvidenceCheckpointCommit({
      ...input,
      observation,
      dependencies,
    });
    byStep.set(observation.step, bundle);
    bundles.push(bundle);
  }
  return bundles;
}

export function createFixtureArtifactRecoveryRecord(input: {
  request: FixtureWebsiteEvidenceWorkflowRequest;
  definition: FixtureWebsiteEvidenceDefinitionDescriptor;
  attempt: FixtureWorkflowAttemptSnapshot;
  lease: FixtureWorkflowLeaseClaim;
  observation: FixtureWebsiteEvidenceArtifactObservation;
}): FixtureArtifactRecoveryRecord {
  const request = FixtureWebsiteEvidenceWorkflowRequestSchema.parse(input.request);
  const definition = FixtureWebsiteEvidenceDefinitionDescriptorSchema.parse(input.definition);
  const attempt = FixtureWorkflowAttemptSnapshotSchema.parse(input.attempt);
  const lease = FixtureWorkflowLeaseClaimSchema.parse(input.lease);
  const requestDigest = fixtureWebsiteEvidenceRequestDigest(request);
  if (
    definition.definitionDigest !== currentFixtureWebsiteEvidenceDefinition().definitionDigest
    || attempt.workflowId !== request.workflowId
    || lease.workflowId !== request.workflowId
    || attempt.attemptId !== lease.attemptId
    || attempt.attemptNumber !== lease.attemptNumber
    || attempt.fencingToken !== lease.fencingToken
    || attempt.workflowVersion !== request.workflowVersion
    || lease.workflowVersion !== request.workflowVersion
    || attempt.definitionDigest !== definition.definitionDigest
    || lease.definitionDigest !== definition.definitionDigest
    || attempt.requestDigest !== requestDigest
    || lease.requestDigest !== requestDigest
  ) throw new Error("Artifact recovery requires one exact current request, definition, attempt, and fenced lease.");
  if (Date.parse(input.observation.recordedAt) < Date.parse(lease.acquiredAt) || Date.parse(input.observation.recordedAt) >= Date.parse(lease.expiresAt)) {
    throw new Error("Artifact recovery receipt must be recorded while its fenced lease is active.");
  }
  const planDigest = digest(input.observation.plan);
  const receiptDigest = digest(input.observation.receipt);
  return FixtureArtifactRecoveryRecordSchema.parse({
    recoveryVersion: FIXTURE_WEBSITE_EVIDENCE_ARTIFACT_RECOVERY_VERSION,
    recoveryId: deterministicUuid(`${attempt.attemptId}:${input.observation.plan.planId}:${receiptDigest}`),
    workflowId: request.workflowId,
    workflowVersion: request.workflowVersion,
    definitionDigest: definition.definitionDigest,
    requestDigest,
    attemptId: attempt.attemptId,
    attemptNumber: attempt.attemptNumber,
    fencingToken: attempt.fencingToken,
    pageKind: input.observation.pageKind,
    profile: input.observation.profile,
    planId: input.observation.plan.planId,
    planDigest,
    receiptDigest,
    plan: input.observation.plan,
    receipt: input.observation.receipt,
    recordedAt: input.observation.recordedAt,
  });
}

export function createFixtureWorkflowReceiptRevision(input: {
  request: FixtureWebsiteEvidenceWorkflowRequest;
  definition: FixtureWebsiteEvidenceDefinitionDescriptor;
  attempt: FixtureWorkflowAttemptSnapshot;
  receipt: FixtureWebsiteEvidenceWorkflowReceipt;
  recordedAt: string;
}): FixtureWorkflowReceiptRevision {
  const request = FixtureWebsiteEvidenceWorkflowRequestSchema.parse(input.request);
  const definition = FixtureWebsiteEvidenceDefinitionDescriptorSchema.parse(input.definition);
  const attempt = FixtureWorkflowAttemptSnapshotSchema.parse(input.attempt);
  const receipt = FixtureWebsiteEvidenceWorkflowReceiptSchema.parse(input.receipt);
  const requestDigest = fixtureWebsiteEvidenceRequestDigest(request);
  if (
    receipt.workflowId !== request.workflowId
    || receipt.workflowVersion !== request.workflowVersion
    || receipt.idempotencyKey !== request.idempotencyKey
    || receipt.businessId !== request.businessId
    || attempt.workflowId !== request.workflowId
    || attempt.workflowVersion !== request.workflowVersion
    || definition.definitionDigest !== currentFixtureWebsiteEvidenceDefinition().definitionDigest
    || attempt.definitionDigest !== definition.definitionDigest
    || attempt.requestDigest !== requestDigest
  ) throw new Error("Workflow receipt revision must match the exact request, definition, and attempt.");
  const receiptDigest = digest(receipt);
  return FixtureWorkflowReceiptRevisionSchema.parse({
    revisionVersion: FIXTURE_WEBSITE_EVIDENCE_RECEIPT_REVISION_VERSION,
    receiptId: `workflow-receipt:${receiptDigest}`,
    workflowId: request.workflowId,
    workflowVersion: request.workflowVersion,
    definitionDigest: definition.definitionDigest,
    requestDigest,
    attemptId: attempt.attemptId,
    attemptNumber: attempt.attemptNumber,
    receiptDigest,
    receipt,
    recordedAt: input.recordedAt,
  });
}

export const FixtureWebsiteEvidenceResumeRequestSchema = z.object({
  resumePlanVersion: z.literal(FIXTURE_WEBSITE_EVIDENCE_RESUME_PLAN_VERSION),
  plannedAt: TimestampSchema,
  mode: z.literal("SHADOW"),
  plannerKind: z.literal("FIXTURE"),
  maxCostUsd: z.literal(0),
  workflowRequest: FixtureWebsiteEvidenceWorkflowRequestSchema,
  definition: FixtureWebsiteEvidenceDefinitionDescriptorSchema,
  currentDelivery: FixtureWorkflowDeliveryRecordSchema,
  persistedDeliveries: z.array(FixtureWorkflowDeliveryRecordSchema).max(100),
  attempts: z.array(FixtureWorkflowAttemptSnapshotSchema).max(100),
  leases: z.array(FixtureWorkflowLeaseClaimSchema).max(200),
  receiptRevisions: z.array(FixtureWorkflowReceiptRevisionSchema).max(100),
  checkpoints: z.array(FixtureWebsiteEvidenceCheckpointBundleSchema).max(800),
  artifactRecoveries: z.array(FixtureArtifactRecoveryRecordSchema).max(500),
}).strict();

export type FixtureWebsiteEvidenceResumeRequest = z.infer<typeof FixtureWebsiteEvidenceResumeRequestSchema>;

const ResumeContinuationSchema = z.object({
  mode: z.enum(["RESTART_FROM_ZERO", "RESUME_AFTER_CHECKPOINT", "RECONCILE_ARTIFACTS", "FINALIZE_RECEIPT"]),
  checkpointId: z.string().uuid().nullable(),
  completedStep: FixtureWebsiteEvidenceWorkflowStepSchema.nullable(),
  nextStep: FixtureWebsiteEvidenceWorkflowStepSchema.nullable(),
  sitePath: SitePathSchema.nullable(),
  dependencyCheckpointIds: z.array(z.string().uuid()).max(FIXTURE_WEBSITE_EVIDENCE_WORKFLOW_STEPS.length),
  artifactReconciliation: z.object({
    mode: z.enum(["NONE", "EXACT_RECORDED_PLANS", "ALL_DETERMINISTIC_PLANS"]),
    planIds: z.array(z.string().uuid()).max(20),
    objectKeys: z.array(z.string().trim().min(1).max(1_024)).max(40),
    rollbackDeletionAuthorized: z.literal(false),
  }).strict(),
}).strict();

const ProposedAttemptSchema = z.object({
  attemptId: z.string().uuid(),
  attemptNumber: z.number().int().positive().max(10_000),
  leaseId: z.string().uuid(),
  requiredFencingToken: z.number().int().positive().max(2_147_483_647),
  deliveryId: z.string().trim().min(8).max(200),
}).strict();

const ActiveLeaseSchema = z.object({
  leaseId: z.string().uuid(),
  attemptId: z.string().uuid(),
  attemptNumber: z.number().int().positive(),
  deliveryId: z.string().trim().min(8).max(200),
  ownerId: z.string().trim().min(1).max(200),
  fencingToken: z.number().int().positive(),
  expiresAt: TimestampSchema,
}).strict();

const ResumeSummarySchema = z.object({
  deliveries: z.number().int().nonnegative().max(100),
  attempts: z.number().int().nonnegative().max(100),
  leases: z.number().int().nonnegative().max(200),
  receiptRevisions: z.number().int().nonnegative().max(100),
  checkpointRecords: z.number().int().nonnegative().max(800),
  committedCheckpoints: z.number().int().nonnegative().max(800),
  preparedCheckpoints: z.number().int().nonnegative().max(800),
  artifactRecoveryRecords: z.number().int().nonnegative().max(500),
  duplicateDelivery: z.boolean(),
  providerOperations: z.literal(0),
  costUsd: z.literal(0),
}).strict();

export const FixtureWebsiteEvidenceResumePlanSchema = z.object({
  resumePlanVersion: z.literal(FIXTURE_WEBSITE_EVIDENCE_RESUME_PLAN_VERSION),
  plannedAt: TimestampSchema,
  mode: z.literal("SHADOW"),
  plannerKind: z.literal("FIXTURE"),
  maxCostUsd: z.literal(0),
  workflowId: z.string().uuid(),
  businessId: z.string().trim().min(1).max(128),
  deliveryId: z.string().trim().min(8).max(200),
  requestDigest: Sha256Schema,
  definitionDigest: Sha256Schema,
  decision: z.enum(["BLOCKED", "RETURN_TERMINAL", "WAIT_ACTIVE_LEASE", "REQUEST_FENCED_LEASE", "REQUEST_FENCED_TAKEOVER"]),
  reasonCode: z.string().trim().min(1).max(100),
  reason: z.string().trim().min(1).max(500),
  terminalReceiptId: z.string().trim().min(1).max(200).nullable(),
  terminalReceiptDigest: Sha256Schema.nullable(),
  activeLease: ActiveLeaseSchema.nullable(),
  proposedAttempt: ProposedAttemptSchema.nullable(),
  continuation: ResumeContinuationSchema.nullable(),
  requiredPreconditions: z.array(z.string().trim().min(1).max(160)).max(30),
  warnings: z.array(z.string().trim().min(1).max(160)).max(30),
  summary: ResumeSummarySchema,
  planDigest: Sha256Schema,
  mutationAuthorized: z.literal(false),
  executionAuthorized: z.literal(false),
  providerOperationsAuthorized: z.literal(0),
  costAuthorizedUsd: z.literal(0),
}).strict().superRefine((plan, context) => {
  const { planDigest, ...core } = plan;
  if (digest(core) !== planDigest) {
    context.addIssue({ code: "custom", message: "Resume plan digest must bind the exact zero-authority decision.", path: ["planDigest"] });
  }
  if ((plan.decision === "RETURN_TERMINAL") !== Boolean(plan.terminalReceiptId && plan.terminalReceiptDigest)) {
    context.addIssue({ code: "custom", message: "Only a terminal decision may return a terminal receipt.", path: ["terminalReceiptId"] });
  }
  if ((plan.decision === "WAIT_ACTIVE_LEASE") !== Boolean(plan.activeLease)) {
    context.addIssue({ code: "custom", message: "Only a wait decision may expose an active lease.", path: ["activeLease"] });
  }
  const proposes = plan.decision === "REQUEST_FENCED_LEASE" || plan.decision === "REQUEST_FENCED_TAKEOVER";
  if (proposes !== Boolean(plan.proposedAttempt && plan.continuation)) {
    context.addIssue({ code: "custom", message: "Only a fenced lease request may propose an attempt and continuation.", path: ["proposedAttempt"] });
  }
});

export type FixtureWebsiteEvidenceResumePlan = z.infer<typeof FixtureWebsiteEvidenceResumePlanSchema>;

type SemanticContext = {
  request: FixtureWebsiteEvidenceResumeRequest;
  requestDigest: string;
  definitionDigest: string;
  duplicateDelivery: boolean;
  deliveries: FixtureWorkflowDeliveryRecord[];
  attempts: FixtureWorkflowAttemptSnapshot[];
  leases: FixtureWorkflowLeaseClaim[];
  receiptRevisions: FixtureWorkflowReceiptRevision[];
  checkpoints: FixtureWebsiteEvidenceCheckpointBundle[];
  artifactRecoveries: FixtureArtifactRecoveryRecord[];
};

function dedupeExact<T>(items: T[], identity: (item: T) => string) {
  const result = new Map<string, T>();
  let conflict: string | null = null;
  for (const item of [...items].sort((left, right) => identity(left).localeCompare(identity(right), "en-CA"))) {
    const id = identity(item);
    const existing = result.get(id);
    if (existing && canonicalJson(existing) !== canonicalJson(item)) conflict ||= id;
    else result.set(id, item);
  }
  return { items: [...result.values()], conflict };
}

function summary(context: SemanticContext) {
  return {
    deliveries: context.deliveries.length,
    attempts: context.attempts.length,
    leases: context.leases.length,
    receiptRevisions: context.receiptRevisions.length,
    checkpointRecords: context.checkpoints.length,
    committedCheckpoints: context.checkpoints.filter((bundle) => bundle.record.commitState === "COMMITTED").length,
    preparedCheckpoints: context.checkpoints.filter((bundle) => bundle.record.commitState === "PREPARED").length,
    artifactRecoveryRecords: context.artifactRecoveries.length,
    duplicateDelivery: context.duplicateDelivery,
    providerOperations: 0 as const,
    costUsd: 0 as const,
  };
}

function finalizePlan(
  context: SemanticContext,
  decision: Omit<z.input<typeof FixtureWebsiteEvidenceResumePlanSchema>,
    "resumePlanVersion" | "plannedAt" | "mode" | "plannerKind" | "maxCostUsd" | "workflowId" | "businessId" |
    "deliveryId" | "requestDigest" | "definitionDigest" | "summary" | "planDigest" | "mutationAuthorized" |
    "executionAuthorized" | "providerOperationsAuthorized" | "costAuthorizedUsd">,
) {
  const core = {
    resumePlanVersion: FIXTURE_WEBSITE_EVIDENCE_RESUME_PLAN_VERSION,
    plannedAt: context.request.plannedAt,
    mode: "SHADOW" as const,
    plannerKind: "FIXTURE" as const,
    maxCostUsd: 0 as const,
    workflowId: context.request.workflowRequest.workflowId,
    businessId: context.request.workflowRequest.businessId,
    deliveryId: context.request.currentDelivery.deliveryId,
    requestDigest: context.requestDigest,
    definitionDigest: context.definitionDigest,
    ...decision,
    requiredPreconditions: [...new Set(decision.requiredPreconditions)].sort((left, right) => left.localeCompare(right, "en-CA")),
    warnings: [...new Set(decision.warnings)].sort((left, right) => left.localeCompare(right, "en-CA")),
    summary: summary(context),
    mutationAuthorized: false as const,
    executionAuthorized: false as const,
    providerOperationsAuthorized: 0 as const,
    costAuthorizedUsd: 0 as const,
  };
  return FixtureWebsiteEvidenceResumePlanSchema.parse({ ...core, planDigest: digest(core) });
}

function blocked(context: SemanticContext, reasonCode: string, reason: string, warnings: string[] = []) {
  return finalizePlan(context, {
    decision: "BLOCKED",
    reasonCode,
    reason,
    terminalReceiptId: null,
    terminalReceiptDigest: null,
    activeLease: null,
    proposedAttempt: null,
    continuation: null,
    requiredPreconditions: ["Resolve the recorded integrity or compatibility conflict before any new execution attempt."],
    warnings,
  });
}

type SemanticIssue = {
  reasonCode: string;
  reason: string;
  warnings?: string[];
};

type ValidCheckpoint = {
  bundle: FixtureWebsiteEvidenceCheckpointBundle;
  payload: FixtureWebsiteEvidenceCheckpointPayload;
};

function issue(reasonCode: string, reason: string, warnings: string[] = []): SemanticIssue {
  return { reasonCode, reason, warnings };
}

function sameWorkflowIdentity(context: SemanticContext, value: {
  workflowId: string;
  workflowVersion: string;
  definitionDigest: string;
  requestDigest: string;
}) {
  return value.workflowId === context.request.workflowRequest.workflowId
    && value.workflowVersion === context.request.workflowRequest.workflowVersion
    && value.definitionDigest === context.definitionDigest
    && value.requestDigest === context.requestDigest;
}

function findAttempt(context: SemanticContext, attemptId: string) {
  return context.attempts.find((attempt) => attempt.attemptId === attemptId) ?? null;
}

function findLease(context: SemanticContext, attemptId: string, fencingToken: number) {
  return context.leases.find((lease) => lease.attemptId === attemptId && lease.fencingToken === fencingToken) ?? null;
}

function higherFenceExistedAt(context: SemanticContext, fencingToken: number, eventAt: string) {
  const eventTime = Date.parse(eventAt);
  return context.leases.some((lease) => lease.fencingToken > fencingToken && Date.parse(lease.acquiredAt) <= eventTime);
}

function validateDefinitionAndDeliveries(context: SemanticContext): SemanticIssue | null {
  const currentDefinition = currentFixtureWebsiteEvidenceDefinition();
  if (canonicalJson(context.request.definition) !== canonicalJson(currentDefinition)) {
    return issue(
      "WORKFLOW_DEFINITION_DRIFT",
      "Persisted work uses a workflow graph or component version that this planner cannot replay safely.",
      ["Version 1 has no implicit checkpoint compatibility map; migrate or restart through an approved versioned path."],
    );
  }

  const request = context.request.workflowRequest;
  const current = context.request.currentDelivery;
  if (!sameWorkflowIdentity(context, current) || current.payloadDigest !== context.requestDigest) {
    return issue("CURRENT_DELIVERY_IDENTITY_MISMATCH", "The current delivery is not bound to the exact workflow request and definition.");
  }
  if (Date.parse(current.receivedAt) < Date.parse(request.requestedAt)) {
    return issue("CURRENT_DELIVERY_TIME_INVALID", "The current delivery predates the workflow request it claims to carry.");
  }
  for (const delivery of context.deliveries) {
    if (!sameWorkflowIdentity(context, delivery) || delivery.payloadDigest !== context.requestDigest) {
      return issue("DELIVERY_IDENTITY_MISMATCH", `Delivery ${delivery.deliveryId} is not bound to the exact workflow request and definition.`);
    }
    if (Date.parse(delivery.receivedAt) < Date.parse(request.requestedAt)) {
      return issue("DELIVERY_TIME_INVALID", `Delivery ${delivery.deliveryId} predates the workflow request.`);
    }
  }
  return null;
}

function validateAttemptHistory(context: SemanticContext): SemanticIssue | null {
  const deliveryIds = new Set(context.deliveries.map((delivery) => delivery.deliveryId));
  const attempts = [...context.attempts].sort((left, right) => left.attemptNumber - right.attemptNumber);
  if (new Set(attempts.map((attempt) => attempt.attemptNumber)).size !== attempts.length) {
    return issue("ATTEMPT_NUMBER_CONFLICT", "Two persisted attempts claim the same attempt number.");
  }
  if (new Set(attempts.map((attempt) => attempt.fencingToken)).size !== attempts.length) {
    return issue("ATTEMPT_FENCE_CONFLICT", "Two persisted attempts claim the same fencing token.");
  }
  if (attempts.filter((attempt) => attempt.status === "RUNNING").length > 1) {
    return issue("MULTIPLE_RUNNING_ATTEMPTS", "More than one workflow attempt is marked running.");
  }
  for (const [index, attempt] of attempts.entries()) {
    if (attempt.attemptNumber !== index + 1) {
      return issue("ATTEMPT_HISTORY_GAP", "Attempt numbers must be derived from one contiguous durable history beginning at one.");
    }
    if (!sameWorkflowIdentity(context, attempt) || !deliveryIds.has(attempt.deliveryId)) {
      return issue("ATTEMPT_IDENTITY_MISMATCH", `Attempt ${attempt.attemptId} is not bound to this request, definition, and a known delivery.`);
    }
    if (attempt.endedAt && Date.parse(attempt.endedAt) < Date.parse(attempt.startedAt)) {
      return issue("ATTEMPT_TIME_INVALID", `Attempt ${attempt.attemptId} ends before it starts.`);
    }
    if (index > 0 && attempt.fencingToken <= attempts[index - 1].fencingToken) {
      return issue("ATTEMPT_FENCE_NOT_MONOTONIC", "Fencing tokens must increase monotonically with durable attempt numbers.");
    }
  }

  return null;
}

function validateLeaseHistory(context: SemanticContext): SemanticIssue | null {
  const attempts = [...context.attempts].sort((left, right) => left.attemptNumber - right.attemptNumber);
  if (new Set(context.leases.map((lease) => lease.fencingToken)).size !== context.leases.length) {
    return issue("LEASE_FENCE_CONFLICT", "More than one lease claim uses the same fencing token.");
  }
  for (const lease of context.leases) {
    const attempt = findAttempt(context, lease.attemptId);
    if (
      !sameWorkflowIdentity(context, lease)
      || !attempt
      || lease.attemptNumber !== attempt.attemptNumber
      || lease.deliveryId !== attempt.deliveryId
      || lease.fencingToken !== attempt.fencingToken
    ) {
      return issue("LEASE_IDENTITY_MISMATCH", `Lease ${lease.leaseId} is not the exact fenced claim for its attempt.`);
    }
    if (Date.parse(lease.acquiredAt) < Date.parse(attempt.startedAt)) {
      return issue("LEASE_TIME_INVALID", `Lease ${lease.leaseId} predates its attempt.`);
    }
  }
  for (const attempt of attempts) {
    const claims = context.leases.filter((lease) => lease.attemptId === attempt.attemptId && lease.fencingToken === attempt.fencingToken);
    if (claims.length !== 1) {
      return issue("ATTEMPT_LEASE_MISSING_OR_AMBIGUOUS", `Attempt ${attempt.attemptId} must have exactly one durable fenced lease claim.`);
    }
  }
  return null;
}

function validateVersionMetadata(context: SemanticContext): SemanticIssue | null {
  for (const checkpoint of context.checkpoints) {
    if (
      checkpoint.record.checkpointVersion !== FIXTURE_WEBSITE_EVIDENCE_CHECKPOINT_VERSION
      || !sameWorkflowIdentity(context, checkpoint.record)
      || checkpointOrdinal(checkpoint.record.step) !== checkpoint.record.stepOrdinal
    ) {
      return issue("CHECKPOINT_VERSION_OR_IDENTITY_DRIFT", `Checkpoint ${checkpoint.record.checkpointId} cannot be interpreted under the current workflow definition.`);
    }
  }
  for (const recovery of context.artifactRecoveries) {
    if (!sameWorkflowIdentity(context, recovery)) {
      return issue("ARTIFACT_RECOVERY_IDENTITY_DRIFT", `Artifact recovery ${recovery.recoveryId} is not bound to the current request and definition.`);
    }
  }
  return null;
}

function validateReceiptRevisions(context: SemanticContext): {
  issue: SemanticIssue | null;
  terminal: FixtureWorkflowReceiptRevision | null;
} {
  const terminal: FixtureWorkflowReceiptRevision[] = [];
  for (const revision of context.receiptRevisions) {
    if (!sameWorkflowIdentity(context, revision)) {
      return { issue: issue("RECEIPT_VERSION_OR_IDENTITY_DRIFT", `Receipt revision ${revision.receiptId} cannot be interpreted under the current definition.`), terminal: null };
    }
    const attempt = findAttempt(context, revision.attemptId);
    if (!attempt || revision.attemptNumber !== attempt.attemptNumber) {
      return { issue: issue("RECEIPT_ATTEMPT_MISMATCH", `Receipt revision ${revision.receiptId} is not linked to an exact persisted attempt.`), terminal: null };
    }
    const parsed = FixtureWebsiteEvidenceWorkflowReceiptSchema.safeParse(revision.receipt);
    if (!parsed.success) {
      return { issue: issue("RECEIPT_PAYLOAD_INVALID", `Receipt revision ${revision.receiptId} has an invalid current-version payload.`), terminal: null };
    }
    const receipt = parsed.data;
    if (
      digest(receipt) !== revision.receiptDigest
      || revision.receiptId !== `workflow-receipt:${revision.receiptDigest}`
      || receipt.workflowId !== context.request.workflowRequest.workflowId
      || receipt.workflowVersion !== context.request.workflowRequest.workflowVersion
      || receipt.idempotencyKey !== context.request.workflowRequest.idempotencyKey
      || receipt.businessId !== context.request.workflowRequest.businessId
    ) {
      return { issue: issue("RECEIPT_DIGEST_OR_IDENTITY_MISMATCH", `Receipt revision ${revision.receiptId} does not bind its exact payload and request.`), terminal: null };
    }
    const isTerminal = receipt.status === "COMPLETED" || receipt.status === "PARTIAL";
    if (isTerminal) {
      if (attempt.status !== "SEALED" || attempt.terminalReceiptId !== revision.receiptId) {
        return { issue: issue("TERMINAL_RECEIPT_NOT_SEALED", `Terminal receipt ${revision.receiptId} is not sealed by its exact attempt.`), terminal: null };
      }
      terminal.push(revision);
    } else if (attempt.status === "SEALED") {
      return { issue: issue("SEALED_ATTEMPT_HAS_FAILED_RECEIPT", `Sealed attempt ${attempt.attemptId} points at a failed workflow receipt.`), terminal: null };
    }
  }
  for (const attempt of context.attempts.filter((candidate) => candidate.status === "SEALED")) {
    if (!context.receiptRevisions.some((revision) => revision.receiptId === attempt.terminalReceiptId && revision.attemptId === attempt.attemptId)) {
      return { issue: issue("SEALED_ATTEMPT_RECEIPT_MISSING", `Sealed attempt ${attempt.attemptId} has no exact terminal receipt revision.`), terminal: null };
    }
  }
  if (new Set(terminal.map((revision) => revision.receiptDigest)).size > 1) {
    return { issue: issue("CONFLICTING_TERMINAL_RECEIPTS", "Durable history contains more than one distinct terminal business result."), terminal: null };
  }
  return {
    issue: null,
    terminal: [...terminal].sort((left, right) => left.receiptId.localeCompare(right.receiptId, "en-CA"))[0] ?? null,
  };
}

function dependencyPayload(
  checkpoint: ValidCheckpoint,
  step: string,
  byId: Map<string, ValidCheckpoint>,
): FixtureWebsiteEvidenceCheckpointPayload | null {
  const visited = new Set<string>();
  const pending = [...checkpoint.bundle.record.dependencies.map((dependency) => dependency.checkpointId)];
  while (pending.length > 0) {
    const id = pending.shift();
    if (!id || visited.has(id)) continue;
    visited.add(id);
    const dependency = byId.get(id);
    if (!dependency) return null;
    if (dependency.payload.step === step) return dependency.payload;
    pending.push(...dependency.bundle.record.dependencies.map((candidate) => candidate.checkpointId));
  }
  return null;
}

function dependencyClosureIds(checkpoint: ValidCheckpoint, byId: Map<string, ValidCheckpoint>) {
  const visited = new Set<string>();
  const pending = [...checkpoint.bundle.record.dependencies.map((dependency) => dependency.checkpointId)];
  while (pending.length > 0) {
    const id = pending.shift();
    if (!id || visited.has(id)) continue;
    visited.add(id);
    const dependency = byId.get(id);
    if (dependency) pending.push(...dependency.bundle.record.dependencies.map((candidate) => candidate.checkpointId));
  }
  return [...visited].sort((left, right) => left.localeCompare(right, "en-CA"));
}

function validateCheckpointRelationships(
  context: SemanticContext,
  checkpoint: ValidCheckpoint,
  byId: Map<string, ValidCheckpoint>,
): SemanticIssue | null {
  const request = context.request.workflowRequest;
  const payload = checkpoint.payload;

  if (payload.step === "CAPTURE_HOME") {
    if (payload.output.requestedUrl !== request.websiteUrl) {
      return issue("CHECKPOINT_CAPTURE_IDENTITY_MISMATCH", "Homepage capture checkpoint does not match the requested website URL.");
    }
    if ((payload.sitePath === "CAPTURED") !== (payload.output.outcome === "CAPTURED")) {
      return issue("CHECKPOINT_SITE_PATH_MISMATCH", "Homepage checkpoint path does not match its capture outcome.");
    }
    if (payload.sitePath === "UNREACHABLE" && payload.output.outcome === "REJECTED") {
      return issue("CHECKPOINT_REJECTED_CANONICAL_URL", "A canonical fixture homepage cannot be replayed as a rejected capture.");
    }
    return null;
  }

  const capture = dependencyPayload(checkpoint, "CAPTURE_HOME", byId);
  if (!capture || capture.step !== "CAPTURE_HOME") {
    return issue("CHECKPOINT_ANCESTOR_MISSING", `Checkpoint ${payload.step} cannot resolve its homepage ancestor.`);
  }

  if (payload.step === "EXTRACT_HOME") {
    if (
      capture.output.outcome !== "CAPTURED"
      || payload.output.pageKind !== "HOME"
      || payload.output.url !== capture.output.finalUrl
      || payload.output.capturedAt !== capture.output.capturedAt
      || payload.output.captureVersion !== capture.output.captureVersion
    ) {
      return issue("CHECKPOINT_HTML_CAPTURE_MISMATCH", "Homepage HTML facts are not derived from the exact captured homepage.");
    }
    return null;
  }

  const homeHtml = dependencyPayload(checkpoint, "EXTRACT_HOME", byId);
  if (!homeHtml || homeHtml.step !== "EXTRACT_HOME") {
    return issue("CHECKPOINT_ANCESTOR_MISSING", `Checkpoint ${payload.step} cannot resolve its homepage HTML ancestor.`);
  }

  if (payload.step === "SELECT_PAGES") {
    const selectedHome = payload.output.selectedPages.find((page) => page.pageKind === "HOME");
    if (
      payload.output.businessId !== request.businessId
      || payload.output.sourceCapturedAt !== homeHtml.output.capturedAt
      || selectedHome?.url !== homeHtml.output.url
    ) {
      return issue("CHECKPOINT_PAGE_SELECTION_MISMATCH", "Page selection is not grounded in the exact business and homepage facts.");
    }
    return null;
  }

  const selection = dependencyPayload(checkpoint, "SELECT_PAGES", byId);
  if (!selection || selection.step !== "SELECT_PAGES") {
    return issue("CHECKPOINT_ANCESTOR_MISSING", `Checkpoint ${payload.step} cannot resolve its page-selection ancestor.`);
  }

  if (payload.step === "CAPTURE_SUBPAGES") {
    const selected = selection.output.selectedPages
      .filter((page) => page.pageKind !== "HOME")
      .map((page) => ({ pageKind: page.pageKind, requestedUrl: page.url }));
    const captured = payload.output.map((page) => ({ pageKind: page.pageKind, requestedUrl: page.capture.requestedUrl }));
    if (canonicalJson(selected) !== canonicalJson(captured)) {
      return issue("CHECKPOINT_SUBPAGE_SELECTION_MISMATCH", "Subpage checkpoints are not the exact selected page set in deterministic order.");
    }
    return null;
  }

  const subpages = dependencyPayload(checkpoint, "CAPTURE_SUBPAGES", byId);
  if (!subpages || subpages.step !== "CAPTURE_SUBPAGES") {
    return issue("CHECKPOINT_ANCESTOR_MISSING", `Checkpoint ${payload.step} cannot resolve its subpage-capture ancestor.`);
  }

  if (payload.step === "MEASURE_BROWSER") {
    const pageInputs = [
      { pageKind: "HOME" as const, capture: capture.output, html: homeHtml.output },
      ...subpages.output,
    ].filter((page) => page.capture.outcome === "CAPTURED" && page.html);
    const expected = pageInputs.flatMap((page) => (
      page.pageKind === "HOME"
        ? ["DESKTOP_1440X900", "MOBILE_390X844"] as const
        : ["DESKTOP_1440X900"] as const
    ).map((profile) => ({
      key: `${page.pageKind}:${profile}`,
      requestedUrl: page.capture.finalUrl,
    }))).sort((left, right) => left.key.localeCompare(right.key, "en-CA"));
    const actual = payload.output.map((evidence) => ({
      key: `${evidence.pageKind}:${evidence.profile}`,
      requestedUrl: evidence.requestedUrl,
      businessId: evidence.businessId,
    })).sort((left, right) => left.key.localeCompare(right.key, "en-CA"));
    if (
      new Set(actual.map((entry) => entry.key)).size !== actual.length
      || canonicalJson(expected.map(({ key, requestedUrl }) => ({ key, requestedUrl })))
        !== canonicalJson(actual.map(({ key, requestedUrl }) => ({ key, requestedUrl })))
      || actual.some((entry) => entry.businessId !== request.businessId)
    ) {
      return issue("CHECKPOINT_BROWSER_COVERAGE_MISMATCH", "Browser evidence is not the exact bounded profile set for the captured pages.");
    }
    return null;
  }

  const measurement = dependencyPayload(checkpoint, "MEASURE_BROWSER", byId);
  if (!measurement || measurement.step !== "MEASURE_BROWSER") {
    return issue("CHECKPOINT_ANCESTOR_MISSING", `Checkpoint ${payload.step} cannot resolve its Browser-measurement ancestor.`);
  }

  if (payload.step === "STORE_ARTIFACTS") {
    const expectedPlanIds = measurement.output
      .filter((evidence) => evidence.outcome === "CAPTURED")
      .map((evidence) => evidence.captureId)
      .sort((left, right) => left.localeCompare(right, "en-CA"));
    const actualPlanIds = payload.output.map((receipt) => receipt.planId)
      .sort((left, right) => left.localeCompare(right, "en-CA"));
    if (
      new Set(actualPlanIds).size !== actualPlanIds.length
      || canonicalJson(expectedPlanIds) !== canonicalJson(actualPlanIds)
      || payload.output.some((receipt) => receipt.workflowId !== request.workflowId)
    ) {
      return issue("CHECKPOINT_ARTIFACT_SET_MISMATCH", "Stored artifact receipts do not exactly cover every successful Browser capture.");
    }
    return null;
  }

  const stored = dependencyPayload(checkpoint, "STORE_ARTIFACTS", byId);
  if (!stored || stored.step !== "STORE_ARTIFACTS") {
    return issue("CHECKPOINT_ANCESTOR_MISSING", `Checkpoint ${payload.step} cannot resolve its artifact-storage ancestor.`);
  }

  if (payload.step === "ASSEMBLE_AUDIT") {
    const receipts = new Map(stored.output.map((receipt) => [receipt.planId, receipt]));
    const browserByPage = new Map<string, typeof measurement.output>();
    for (const evidence of measurement.output) {
      const existing = browserByPage.get(evidence.pageKind) ?? [];
      existing.push(evidence);
      browserByPage.set(evidence.pageKind, existing);
    }
    const pages = [
      { pageKind: "HOME" as const, capture: capture.output, html: homeHtml.output },
      ...subpages.output,
    ].map((page) => ({
      ...page,
      browser: browserByPage.get(page.pageKind) ?? [],
      artifactReceipts: (browserByPage.get(page.pageKind) ?? [])
        .filter((evidence) => evidence.outcome === "CAPTURED")
        .map((evidence) => receipts.get(evidence.captureId))
        .filter((receipt): receipt is z.infer<typeof ArtifactWriteReceiptSchema> => Boolean(receipt)),
    }));
    let expected: z.infer<typeof WebsiteAuditAssemblySchema>;
    try {
      expected = assembleWebsiteAuditInput({
        assemblyVersion: WEBSITE_AUDIT_ASSEMBLY_VERSION,
        assemblyId: deterministicUuid(`${request.workflowId}:audit-assembly`),
        workflowId: request.workflowId,
        assembledAt: request.requestedAt,
        mode: "SHADOW",
        assemblerKind: "FIXTURE",
        maxCostUsd: 0,
        businessId: request.businessId,
        businessName: request.businessName,
        niche: request.niche,
        expectedServices: request.expectedServices,
        expectedLocations: request.expectedLocations,
        sourceEvidenceUrl: request.sourceEvidenceUrl,
        policy: defaultWebsiteAuditAssemblyPolicy(),
        pages,
        resourceProbes: request.resourceProbes,
      });
    } catch {
      return issue("CHECKPOINT_ASSEMBLY_INPUT_INVALID", "The dependency-closed evidence chain cannot reproduce a valid audit assembly.");
    }
    if (canonicalJson(expected) !== canonicalJson(payload.output)) {
      return issue("CHECKPOINT_ASSEMBLY_DIVERGED", "Audit assembly does not exactly reproduce from its dependency-closed evidence chain.");
    }
    return null;
  }

  if (payload.step === "RUN_AUDIT") {
    let expected: z.infer<typeof DeterministicWebsiteAuditResultSchema>;
    if (payload.sitePath === "CAPTURED") {
      const assembly = dependencyPayload(checkpoint, "ASSEMBLE_AUDIT", byId);
      if (!assembly || assembly.step !== "ASSEMBLE_AUDIT") {
        return issue("CHECKPOINT_ANCESTOR_MISSING", "Captured audit checkpoint cannot resolve its assembly ancestor.");
      }
      expected = auditWebsiteDeterministically(assembly.output.auditInput);
    } else {
      const input = DeterministicWebsiteAuditInputSchema.parse({
        businessId: request.businessId,
        businessName: request.businessName,
        niche: request.niche,
        expectedServices: request.expectedServices,
        expectedLocations: request.expectedLocations,
        sourceEvidenceUrl: request.sourceEvidenceUrl,
        siteState: "UNREACHABLE",
        requestedUrl: capture.output.requestedUrl,
        finalUrl: null,
        statusCode: capture.output.statusCode,
        redirectCount: capture.output.redirectCount,
        capturedAt: capture.output.capturedAt,
        desktopArtifactRef: null,
        mobileArtifactRef: null,
        domArtifactRef: null,
        pageSetComplete: false,
        pages: [],
        resourceProbes: [],
        mobile: {
          captured: false,
          horizontalOverflow: null,
          navigationUsable: null,
          textReadable: null,
          minimumTapTargetPx: null,
        },
      });
      expected = auditWebsiteDeterministically(input);
    }
    if (canonicalJson(expected) !== canonicalJson(payload.output)) {
      return issue("CHECKPOINT_AUDIT_DIVERGED", "Audit output does not exactly reproduce from its deterministic dependency.");
    }
  }
  return null;
}

function validateCheckpoints(context: SemanticContext): {
  issue: SemanticIssue | null;
  valid: ValidCheckpoint[];
  byId: Map<string, ValidCheckpoint>;
} {
  const valid: ValidCheckpoint[] = [];
  for (const bundle of context.checkpoints) {
    const record = bundle.record;
    if (
      record.checkpointVersion !== FIXTURE_WEBSITE_EVIDENCE_CHECKPOINT_VERSION
      || !sameWorkflowIdentity(context, record)
      || checkpointOrdinal(record.step) !== record.stepOrdinal
    ) {
      return { issue: issue("CHECKPOINT_VERSION_OR_IDENTITY_DRIFT", `Checkpoint ${record.checkpointId} cannot be interpreted under the current workflow definition.`), valid: [], byId: new Map() };
    }
    const parsed = FixtureWebsiteEvidenceCheckpointPayloadSchema.safeParse(bundle.payload);
    if (!parsed.success) {
      return { issue: issue("CHECKPOINT_PAYLOAD_INVALID", `Checkpoint ${record.checkpointId} has an invalid current-version payload.`), valid: [], byId: new Map() };
    }
    const payload = parsed.data;
    if (
      payload.checkpointId !== record.checkpointId
      || payload.workflowId !== record.workflowId
      || payload.workflowVersion !== record.workflowVersion
      || payload.definitionDigest !== record.definitionDigest
      || payload.requestDigest !== record.requestDigest
      || payload.attemptId !== record.attemptId
      || payload.attemptNumber !== record.attemptNumber
      || payload.fencingToken !== record.fencingToken
      || payload.step !== record.step
      || payload.sitePath !== record.sitePath
      || payload.completedAt !== record.completedAt
      || digest(payload) !== record.locator.payloadDigest
      || byteLength(payload) !== record.locator.payloadByteLength
      || record.locator.payloadRef !== `fixture-checkpoint:sha256:${record.locator.payloadDigest}`
      || payloadOutputDigest(payload) !== record.outputDigest
    ) {
      return { issue: issue("CHECKPOINT_DIGEST_OR_METADATA_MISMATCH", `Checkpoint ${record.checkpointId} does not bind its exact payload and metadata.`), valid: [], byId: new Map() };
    }
    if (Date.parse(record.recordedAt) < Date.parse(record.completedAt)) {
      return { issue: issue("CHECKPOINT_TIME_INVALID", `Checkpoint ${record.checkpointId} was recorded before it completed.`), valid: [], byId: new Map() };
    }
    const attempt = findAttempt(context, record.attemptId);
    const lease = findLease(context, record.attemptId, record.fencingToken);
    if (
      !attempt
      || !lease
      || record.attemptNumber !== attempt.attemptNumber
      || record.fencingToken !== attempt.fencingToken
      || Date.parse(record.completedAt) < Date.parse(lease.acquiredAt)
      || Date.parse(record.completedAt) >= Date.parse(lease.expiresAt)
    ) {
      return { issue: issue("CHECKPOINT_FENCE_INVALID", `Checkpoint ${record.checkpointId} was not committed under its exact active fenced lease.`), valid: [], byId: new Map() };
    }
    if (higherFenceExistedAt(context, record.fencingToken, record.completedAt)) {
      return { issue: issue("STALE_WORKER_CHECKPOINT", `Checkpoint ${record.checkpointId} was written after a higher fencing token had been acquired.`), valid: [], byId: new Map() };
    }
    valid.push({ bundle, payload });
  }

  const byId = new Map(valid.map((checkpoint) => [checkpoint.bundle.record.checkpointId, checkpoint]));
  for (const checkpoint of valid) {
    const record = checkpoint.bundle.record;
    const expectedSteps = expectedDependencySteps(record.step, record.sitePath);
    if (!expectedSteps) return { issue: issue("CHECKPOINT_STEP_UNKNOWN", `Checkpoint ${record.checkpointId} uses an unknown step.`), valid, byId };
    const dependencies: ValidCheckpoint[] = [];
    for (const reference of record.dependencies) {
      const dependency = byId.get(reference.checkpointId);
      if (!dependency || dependency.bundle.record.commitState !== "COMMITTED" || dependency.bundle.record.locator.payloadDigest !== reference.payloadDigest) {
        return { issue: issue("CHECKPOINT_DEPENDENCY_NOT_COMMITTED", `Checkpoint ${record.checkpointId} does not reference an exact committed dependency.`), valid, byId };
      }
      dependencies.push(dependency);
    }
    const actualSteps = dependencies.map((dependency) => dependency.payload.step).sort((left, right) => left.localeCompare(right, "en-CA"));
    const canonicalExpected = [...expectedSteps].sort((left, right) => left.localeCompare(right, "en-CA"));
    if (
      canonicalJson(actualSteps) !== canonicalJson(canonicalExpected)
      || dependencies.some((dependency) => (
        dependency.payload.sitePath !== record.sitePath
        || dependency.bundle.record.stepOrdinal >= record.stepOrdinal
        || Date.parse(dependency.bundle.record.completedAt) > Date.parse(record.completedAt)
      ))
    ) {
      return { issue: issue("CHECKPOINT_DEPENDENCY_GRAPH_INVALID", `Checkpoint ${record.checkpointId} is not dependency-closed on the current workflow graph.`), valid, byId };
    }
  }

  const committedByStep = new Map<string, ValidCheckpoint[]>();
  for (const checkpoint of valid.filter((candidate) => candidate.bundle.record.commitState === "COMMITTED")) {
    const group = committedByStep.get(checkpoint.payload.step) ?? [];
    group.push(checkpoint);
    committedByStep.set(checkpoint.payload.step, group);
  }
  for (const [step, checkpoints] of committedByStep) {
    const exactOutputs = new Set(checkpoints.map((checkpoint) => `${checkpoint.payload.sitePath}:${digest(checkpoint.payload.output)}`));
    if (exactOutputs.size > 1) {
      return { issue: issue("COMMITTED_CHECKPOINT_DIVERGENCE", `Committed ${step} checkpoints contain different full outputs or site paths.`), valid, byId };
    }
  }

  for (const checkpoint of valid) {
    const relationshipIssue = validateCheckpointRelationships(context, checkpoint, byId);
    if (relationshipIssue) return { issue: relationshipIssue, valid, byId };
  }
  return { issue: null, valid, byId };
}

type ArtifactRecoveryAnalysis = {
  issue: SemanticIssue | null;
  mode: "NONE" | "EXACT_RECORDED_PLANS" | "ALL_DETERMINISTIC_PLANS";
  planIds: string[];
  objectKeys: string[];
  warnings: string[];
};

function validateArtifactRecoveries(
  context: SemanticContext,
  checkpoints: ValidCheckpoint[],
): ArtifactRecoveryAnalysis {
  const measureOutputs = checkpoints
    .filter((checkpoint) => checkpoint.payload.step === "MEASURE_BROWSER")
    .flatMap((checkpoint) => checkpoint.payload.step === "MEASURE_BROWSER" ? checkpoint.payload.output : []);
  const evidenceByPlanId = new Map(measureOutputs
    .filter((evidence) => evidence.outcome === "CAPTURED")
    .map((evidence) => [evidence.captureId, evidence]));
  const recoveryByPlan = new Map<string, FixtureArtifactRecoveryRecord[]>();

  for (const recovery of context.artifactRecoveries) {
    if (!sameWorkflowIdentity(context, recovery)) {
      return { issue: issue("ARTIFACT_RECOVERY_IDENTITY_DRIFT", `Artifact recovery ${recovery.recoveryId} is not bound to the current request and definition.`), mode: "NONE", planIds: [], objectKeys: [], warnings: [] };
    }
    const attempt = findAttempt(context, recovery.attemptId);
    const lease = findLease(context, recovery.attemptId, recovery.fencingToken);
    if (
      !attempt
      || !lease
      || recovery.attemptNumber !== attempt.attemptNumber
      || recovery.fencingToken !== attempt.fencingToken
      || Date.parse(recovery.recordedAt) < Date.parse(lease.acquiredAt)
      || Date.parse(recovery.recordedAt) >= Date.parse(lease.expiresAt)
    ) {
      return { issue: issue("ARTIFACT_RECOVERY_FENCE_INVALID", `Artifact recovery ${recovery.recoveryId} was not recorded under its exact active fenced lease.`), mode: "NONE", planIds: [], objectKeys: [], warnings: [] };
    }
    if (higherFenceExistedAt(context, recovery.fencingToken, recovery.recordedAt)) {
      return { issue: issue("STALE_WORKER_ARTIFACT_RECEIPT", `Artifact recovery ${recovery.recoveryId} was recorded after a higher fencing token had been acquired.`), mode: "NONE", planIds: [], objectKeys: [], warnings: [] };
    }
    if (recovery.receipt.outcome === "FAILED" && (
      recovery.receipt.failure.code === "INVALID_RECEIPT"
      || recovery.receipt.failure.code === "EXISTING_OBJECT_MISMATCH"
    )) {
      return {
        issue: issue(
          "ARTIFACT_INTEGRITY_CONFLICT",
          `Artifact plan ${recovery.planId} reported ${recovery.receipt.failure.code}; automatic replay cannot prove content identity.`,
          ["Preserve the object and receipt; investigate integrity before any retry."],
        ),
        mode: "NONE",
        planIds: [],
        objectKeys: [],
        warnings: [],
      };
    }
    const evidence = evidenceByPlanId.get(recovery.planId);
    if (evidence && (
      evidence.pageKind !== recovery.pageKind
      || evidence.profile !== recovery.profile
      || recovery.receipt.items.some((item) => (
        item.artifactRef !== (item.kind === "BROWSER_SCREENSHOT" ? evidence.screenshotArtifactRef : evidence.measurementArtifactRef)
      ))
    )) {
      return { issue: issue("ARTIFACT_EVIDENCE_MISMATCH", `Artifact recovery ${recovery.recoveryId} does not match its Browser evidence.`), mode: "NONE", planIds: [], objectKeys: [], warnings: [] };
    }
    const group = recoveryByPlan.get(recovery.planId) ?? [];
    group.push(recovery);
    recoveryByPlan.set(recovery.planId, group);
  }

  for (const [planId, records] of recoveryByPlan) {
    if (new Set(records.map((record) => record.planDigest)).size > 1) {
      return { issue: issue("ARTIFACT_PLAN_DIVERGENCE", `Artifact plan ${planId} has more than one exact write plan.`), mode: "NONE", planIds: [], objectKeys: [], warnings: [] };
    }
    const completed = records.filter((record) => record.receipt.outcome === "COMPLETED");
    const completedItems = new Set(completed.map((record) => digest(record.receipt.items.map((item) => ({
      kind: item.kind,
      artifactRef: item.artifactRef,
      objectKey: item.objectKey,
      byteLength: item.byteLength,
      sha256: item.sha256,
      etag: item.etag,
      uploadedAt: item.uploadedAt,
    })))));
    if (completedItems.size > 1) {
      return { issue: issue("ARTIFACT_RECEIPT_DIVERGENCE", `Artifact plan ${planId} has conflicting completed object identities.`), mode: "NONE", planIds: [], objectKeys: [], warnings: [] };
    }
  }

  const committedStoreReceipts = checkpoints
    .filter((checkpoint) => checkpoint.bundle.record.commitState === "COMMITTED" && checkpoint.payload.step === "STORE_ARTIFACTS")
    .flatMap((checkpoint) => checkpoint.payload.step === "STORE_ARTIFACTS" ? checkpoint.payload.output : []);
  for (const receipt of committedStoreReceipts) {
    const exact = recoveryByPlan.get(receipt.planId)?.some((record) => record.receiptDigest === digest(receipt));
    if (!exact) {
      return { issue: issue("STORE_CHECKPOINT_RECOVERY_MISSING", `Committed artifact receipt ${receipt.planId} has no exact retained write plan and receipt.`), mode: "NONE", planIds: [], objectKeys: [], warnings: [] };
    }
  }

  const committedPlanIds = new Set(committedStoreReceipts.map((receipt) => receipt.planId));
  const needsExact = [...recoveryByPlan.entries()].filter(([planId, records]) => (
    !committedPlanIds.has(planId)
    && records.some((record) => (
      record.receipt.outcome === "COMPLETED"
      || (record.receipt.outcome === "FAILED" && record.receipt.failure.code === "STORE_ERROR")
    ))
  ));

  const preparedExpectedPlanIds = checkpoints
    .filter((checkpoint) => checkpoint.bundle.record.commitState === "PREPARED")
    .flatMap((checkpoint) => {
      if (checkpoint.payload.step === "MEASURE_BROWSER") {
        return checkpoint.payload.output.filter((evidence) => evidence.outcome === "CAPTURED").map((evidence) => evidence.captureId);
      }
      if (checkpoint.payload.step === "STORE_ARTIFACTS") return checkpoint.payload.output.map((receipt) => receipt.planId);
      return [];
    });
  const missingPreparedRecovery = preparedExpectedPlanIds.some((planId) => !recoveryByPlan.has(planId));
  if (missingPreparedRecovery) {
    return {
      issue: null,
      mode: "ALL_DETERMINISTIC_PLANS",
      planIds: [],
      objectKeys: [],
      warnings: ["A prepared Browser or storage checkpoint lacks an exact write receipt; reconcile every deterministic plan before continuing."],
    };
  }
  if (needsExact.length === 0) return { issue: null, mode: "NONE", planIds: [], objectKeys: [], warnings: [] };
  return {
    issue: null,
    mode: "EXACT_RECORDED_PLANS",
    planIds: needsExact.map(([planId]) => planId).sort((left, right) => left.localeCompare(right, "en-CA")),
    objectKeys: [...new Set(needsExact.flatMap(([, records]) => records[0].plan.items.map((item) => item.objectKey)))]
      .sort((left, right) => left.localeCompare(right, "en-CA")),
    warnings: ["Content-addressed side effects are retained; replay must reconcile exact recorded plans without deleting orphan objects."],
  };
}

function snapshotTimeIssue(context: SemanticContext): SemanticIssue | null {
  const plannedAt = Date.parse(context.request.plannedAt);
  if (Date.parse(context.request.workflowRequest.requestedAt) > plannedAt) {
    return issue("PLANNER_CLOCK_PRECEDES_REQUEST", "The trusted planner time predates the workflow request.");
  }
  const events: Array<{ label: string; at: string }> = [
    ...context.deliveries.map((record) => ({ label: `delivery ${record.deliveryId}`, at: record.receivedAt })),
    ...context.attempts.flatMap((record) => [
      { label: `attempt ${record.attemptId} start`, at: record.startedAt },
      ...(record.endedAt ? [{ label: `attempt ${record.attemptId} end`, at: record.endedAt }] : []),
    ]),
    ...context.leases.map((record) => ({ label: `lease ${record.leaseId} acquisition`, at: record.acquiredAt })),
    ...context.receiptRevisions.map((record) => ({ label: `receipt ${record.receiptId}`, at: record.recordedAt })),
    ...context.checkpoints.map((record) => ({ label: `checkpoint ${record.record.checkpointId}`, at: record.record.recordedAt })),
    ...context.artifactRecoveries.map((record) => ({ label: `artifact recovery ${record.recoveryId}`, at: record.recordedAt })),
  ];
  const future = events.find((event) => Date.parse(event.at) > plannedAt);
  return future ? issue("SNAPSHOT_CONTAINS_FUTURE_EVENT", `Trusted planner time predates ${future.label}.`) : null;
}

function latestCommittedCheckpoint(checkpoints: ValidCheckpoint[]): ValidCheckpoint | null {
  return checkpoints
    .filter((checkpoint) => checkpoint.bundle.record.commitState === "COMMITTED")
    .sort((left, right) => (
      right.bundle.record.stepOrdinal - left.bundle.record.stepOrdinal
      || right.bundle.record.fencingToken - left.bundle.record.fencingToken
      || right.bundle.record.attemptNumber - left.bundle.record.attemptNumber
      || right.bundle.record.recordedAt.localeCompare(left.bundle.record.recordedAt, "en-CA")
      || right.bundle.record.checkpointId.localeCompare(left.bundle.record.checkpointId, "en-CA")
    )).at(0) ?? null;
}

function continuationFor(
  checkpoints: ValidCheckpoint[],
  byId: Map<string, ValidCheckpoint>,
  artifact: ArtifactRecoveryAnalysis,
) {
  let latest = latestCommittedCheckpoint(checkpoints);
  if (latest?.payload.step === "MEASURE_BROWSER") {
    const fallbackId = latest.bundle.record.dependencies.find((dependency) => byId.get(dependency.checkpointId)?.payload.step === "CAPTURE_SUBPAGES")?.checkpointId;
    latest = fallbackId ? byId.get(fallbackId) ?? null : null;
  }

  let nextStep: z.infer<typeof FixtureWebsiteEvidenceWorkflowStepSchema> | null = "CAPTURE_HOME";
  if (latest) {
    if (latest.payload.step === "CAPTURE_HOME") nextStep = latest.payload.sitePath === "UNREACHABLE" ? "RUN_AUDIT" : "EXTRACT_HOME";
    else if (latest.payload.step === "EXTRACT_HOME") nextStep = "SELECT_PAGES";
    else if (latest.payload.step === "SELECT_PAGES") nextStep = "CAPTURE_SUBPAGES";
    else if (latest.payload.step === "CAPTURE_SUBPAGES") nextStep = "MEASURE_BROWSER";
    else if (latest.payload.step === "STORE_ARTIFACTS") nextStep = "ASSEMBLE_AUDIT";
    else if (latest.payload.step === "ASSEMBLE_AUDIT") nextStep = "RUN_AUDIT";
    else if (latest.payload.step === "RUN_AUDIT") nextStep = null;
  }

  const requiresArtifactReconciliation = artifact.mode !== "NONE"
    || checkpoints.some((checkpoint) => checkpoint.bundle.record.commitState === "COMMITTED" && checkpoint.payload.step === "MEASURE_BROWSER")
      && !checkpoints.some((checkpoint) => checkpoint.bundle.record.commitState === "COMMITTED" && checkpoint.payload.step === "STORE_ARTIFACTS");
  const artifactMode = artifact.mode !== "NONE"
    ? artifact.mode
    : requiresArtifactReconciliation ? "ALL_DETERMINISTIC_PLANS" as const : "NONE" as const;
  const mode = latest?.payload.step === "RUN_AUDIT"
    ? "FINALIZE_RECEIPT" as const
    : requiresArtifactReconciliation
      ? "RECONCILE_ARTIFACTS" as const
      : latest ? "RESUME_AFTER_CHECKPOINT" as const : "RESTART_FROM_ZERO" as const;

  return {
    mode,
    checkpointId: latest?.bundle.record.checkpointId ?? null,
    completedStep: latest?.payload.step ?? null,
    nextStep,
    sitePath: latest?.payload.sitePath ?? null,
    dependencyCheckpointIds: latest ? dependencyClosureIds(latest, byId) : [],
    artifactReconciliation: {
      mode: artifactMode,
      planIds: artifactMode === "EXACT_RECORDED_PLANS" ? artifact.planIds : [],
      objectKeys: artifactMode === "EXACT_RECORDED_PLANS" ? artifact.objectKeys : [],
      rollbackDeletionAuthorized: false as const,
    },
  };
}

function semanticResumePlan(context: SemanticContext): FixtureWebsiteEvidenceResumePlan {
  for (const validation of [
    snapshotTimeIssue(context),
    validateDefinitionAndDeliveries(context),
    validateAttemptHistory(context),
    validateVersionMetadata(context),
  ]) {
    if (validation) return blocked(context, validation.reasonCode, validation.reason, validation.warnings);
  }

  const receipts = validateReceiptRevisions(context);
  if (receipts.issue) return blocked(context, receipts.issue.reasonCode, receipts.issue.reason, receipts.issue.warnings);

  if (receipts.terminal) {
    return finalizePlan(context, {
      decision: "RETURN_TERMINAL",
      reasonCode: "TERMINAL_RECEIPT_ALREADY_SEALED",
      reason: "A deterministic completed or partial business result is already sealed; no lease or replay is needed.",
      terminalReceiptId: receipts.terminal.receiptId,
      terminalReceiptDigest: receipts.terminal.receiptDigest,
      activeLease: null,
      proposedAttempt: null,
      continuation: null,
      requiredPreconditions: [],
      warnings: context.duplicateDelivery ? ["The current delivery is an exact duplicate of durable delivery history."] : [],
    });
  }

  const leaseHistoryIssue = validateLeaseHistory(context);
  if (leaseHistoryIssue) return blocked(context, leaseHistoryIssue.reasonCode, leaseHistoryIssue.reason, leaseHistoryIssue.warnings);

  const plannedAt = Date.parse(context.request.plannedAt);
  const active = context.leases.filter((lease) => {
    const attempt = findAttempt(context, lease.attemptId);
    return attempt?.status === "RUNNING" && Date.parse(lease.expiresAt) > plannedAt;
  });
  if (active.length > 1) {
    return blocked(context, "MULTIPLE_ACTIVE_LEASES", "More than one running fenced lease is active at the trusted planner time.");
  }
  if (active.length === 1) {
    const lease = active[0];
    return finalizePlan(context, {
      decision: "WAIT_ACTIVE_LEASE",
      reasonCode: "ACTIVE_FENCED_LEASE",
      reason: "The current attempt still owns an unexpired fenced lease; duplicate execution must wait.",
      terminalReceiptId: null,
      terminalReceiptDigest: null,
      activeLease: {
        leaseId: lease.leaseId,
        attemptId: lease.attemptId,
        attemptNumber: lease.attemptNumber,
        deliveryId: lease.deliveryId,
        ownerId: lease.ownerId,
        fencingToken: lease.fencingToken,
        expiresAt: lease.expiresAt,
      },
      proposedAttempt: null,
      continuation: null,
      requiredPreconditions: ["Re-read durable terminal state after the active lease expires or the current owner seals the attempt."],
      warnings: context.duplicateDelivery ? ["The current delivery is an exact duplicate of durable delivery history."] : [],
    });
  }

  const checkpointValidation = validateCheckpoints(context);
  if (checkpointValidation.issue) {
    return blocked(context, checkpointValidation.issue.reasonCode, checkpointValidation.issue.reason, checkpointValidation.issue.warnings);
  }
  const artifact = validateArtifactRecoveries(context, checkpointValidation.valid);
  if (artifact.issue) return blocked(context, artifact.issue.reasonCode, artifact.issue.reason, artifact.issue.warnings);

  if (context.artifactRecoveries.length > 0 && checkpointValidation.valid.length === 0) {
    return blocked(context, "ARTIFACT_RECOVERY_WITHOUT_CHECKPOINT", "Artifact side effects exist without a dependency-closed checkpoint chain.");
  }

  const continuation = continuationFor(checkpointValidation.valid, checkpointValidation.byId, artifact);
  const maxAttempt = context.attempts.reduce((maximum, attempt) => Math.max(maximum, attempt.attemptNumber), 0);
  const maxFence = context.attempts.reduce((maximum, attempt) => Math.max(maximum, attempt.fencingToken), 0);
  const attemptNumber = maxAttempt + 1;
  const requiredFencingToken = maxFence + 1;
  const attemptId = deterministicUuid(`${context.request.workflowRequest.workflowId}:${context.request.currentDelivery.deliveryId}:attempt:${attemptNumber}:fence:${requiredFencingToken}`);
  const leaseId = deterministicUuid(`${attemptId}:lease:${requiredFencingToken}`);
  const takeover = context.attempts.length > 0 || context.leases.length > 0 || checkpointValidation.valid.length > 0;
  return finalizePlan(context, {
    decision: takeover ? "REQUEST_FENCED_TAKEOVER" : "REQUEST_FENCED_LEASE",
    reasonCode: takeover ? "STALE_OR_INTERRUPTED_WORK_RESUMABLE" : "FRESH_WORK_READY_FOR_LEASE",
    reason: takeover
      ? "Durable history has no terminal result or active lease, and the dependency-closed checkpoint chain can be resumed under a higher fence."
      : "No durable execution exists; a first fenced lease may be requested before execution.",
    terminalReceiptId: null,
    terminalReceiptDigest: null,
    activeLease: null,
    proposedAttempt: {
      attemptId,
      attemptNumber,
      leaseId,
      requiredFencingToken,
      deliveryId: context.request.currentDelivery.deliveryId,
    },
    continuation,
    requiredPreconditions: [
      "Atomically confirm no terminal receipt exists before creating the proposed attempt.",
      `Atomically acquire fencing token ${requiredFencingToken}; a different token invalidates this plan.`,
      "Persist the exact attempt, lease, checkpoint payloads, locators, and artifact receipts before any separate executor is allowed to run.",
      "Re-run this zero-authority planner after any durable-state change.",
    ],
    warnings: [
      ...artifact.warnings,
      ...(context.duplicateDelivery ? ["The current delivery is an exact duplicate of durable delivery history."] : []),
    ],
  });
}

export function buildFixtureWebsiteEvidenceResumePlan(value: unknown): FixtureWebsiteEvidenceResumePlan {
  const request = FixtureWebsiteEvidenceResumeRequestSchema.parse(value);
  const requestDigest = fixtureWebsiteEvidenceRequestDigest(request.workflowRequest);
  const persistedDuplicate = request.persistedDeliveries.find((delivery) => delivery.deliveryId === request.currentDelivery.deliveryId) ?? null;

  const deliveries = dedupeExact([...request.persistedDeliveries, request.currentDelivery], (delivery) => delivery.deliveryId);
  const attempts = dedupeExact(request.attempts, (attempt) => attempt.attemptId);
  const leases = dedupeExact(request.leases, (lease) => lease.leaseId);
  const receiptRevisions = dedupeExact(request.receiptRevisions, (revision) => revision.receiptId);
  const checkpoints = dedupeExact(request.checkpoints, (checkpoint) => checkpoint.record.checkpointId);
  const artifactRecoveries = dedupeExact(request.artifactRecoveries, (recovery) => recovery.recoveryId);

  const context: SemanticContext = {
    request,
    requestDigest,
    definitionDigest: request.definition.definitionDigest,
    duplicateDelivery: Boolean(persistedDuplicate && canonicalJson(persistedDuplicate) === canonicalJson(request.currentDelivery)),
    deliveries: deliveries.items,
    attempts: attempts.items,
    leases: leases.items,
    receiptRevisions: receiptRevisions.items,
    checkpoints: checkpoints.items,
    artifactRecoveries: artifactRecoveries.items,
  };

  const conflicts: Array<[string | null, string, string]> = [
    [deliveries.conflict, "DELIVERY_IDENTITY_CONFLICT", "Two durable delivery records share an ID but not exact content."],
    [attempts.conflict, "ATTEMPT_IDENTITY_CONFLICT", "Two durable attempt records share an ID but not exact content."],
    [leases.conflict, "LEASE_IDENTITY_CONFLICT", "Two durable lease claims share an ID but not exact content."],
    [receiptRevisions.conflict, "RECEIPT_IDENTITY_CONFLICT", "Two durable receipt revisions share an ID but not exact content."],
    [checkpoints.conflict, "CHECKPOINT_IDENTITY_CONFLICT", "Two durable checkpoints share an ID but not exact content."],
    [artifactRecoveries.conflict, "ARTIFACT_RECOVERY_IDENTITY_CONFLICT", "Two artifact recovery records share an ID but not exact content."],
  ];
  const conflict = conflicts.find(([identity]) => identity);
  if (conflict) return blocked(context, conflict[1], `${conflict[2]} Conflicting identity: ${conflict[0]}.`);

  try {
    return semanticResumePlan(context);
  } catch (error) {
    return blocked(
      context,
      "SEMANTIC_VALIDATION_FAILED_CLOSED",
      error instanceof Error
        ? `The durable snapshot could not be proven safe: ${error.message.slice(0, 300)}`
        : "The durable snapshot could not be proven safe.",
    );
  }
}
