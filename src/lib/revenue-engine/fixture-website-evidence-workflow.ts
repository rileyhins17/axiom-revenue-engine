import { createHash } from "node:crypto";

import { z } from "zod";

import {
  BROWSER_MEASUREMENT_ADAPTER_VERSION,
  BrowserMeasurementRequestSchema,
  createBrowserMeasurementDraft,
  defaultBrowserMeasurementPolicy,
  finalizeBrowserMeasurementDraft,
  type BrowserMeasurementRunner,
} from "@/lib/revenue-engine/browser-measurement-adapter";
import type { BrowserPageEvidence } from "@/lib/revenue-engine/browser-page-evidence";
import {
  ArtifactManifestSchema,
  artifactManifestFromWriteReceipt,
} from "@/lib/revenue-engine/artifact-lifecycle";
import {
  ArtifactWriteReceiptSchema,
  browserArtifactRefsFromReceipt,
  createBrowserArtifactWritePlan,
  executeFixtureArtifactWritePlan,
  type ArtifactWritePlan,
  type ArtifactWriteReceipt,
  type FixtureArtifactStore,
} from "@/lib/revenue-engine/content-addressed-artifact-store";
import { extractHtmlPageFacts, type HtmlPageFacts } from "@/lib/revenue-engine/html-page-facts";
import { normalizePublicWebsiteUrl } from "@/lib/revenue-engine/public-website-url";
import {
  WEBSITE_AUDIT_ASSEMBLY_VERSION,
  WebsiteAuditAssemblySchema,
  assembleWebsiteAuditInput,
  defaultWebsiteAuditAssemblyPolicy,
  type WebsiteAuditAssembly,
  type WebsiteAuditAssemblyRequest,
} from "@/lib/revenue-engine/website-audit-assembly";
import {
  DETERMINISTIC_WEBSITE_AUDIT_VERSION,
  DeterministicWebsiteAuditInputSchema,
  DeterministicWebsiteAuditResultSchema,
  ResourceProbeSchema,
  WebsitePageKindSchema,
  auditWebsiteDeterministically,
  type DeterministicWebsiteAuditResult,
} from "@/lib/revenue-engine/website-audit";
import {
  WEBSITE_CAPTURE_VERSION,
  WebsiteCaptureResultSchema,
  type WebsiteCaptureResult,
} from "@/lib/revenue-engine/website-capture";
import {
  WEBSITE_PAGE_SELECTION_VERSION,
  WebsitePageSelectionPlanSchema,
  defaultWebsitePageSelectionPolicy,
  planWebsitePages,
  type WebsitePageSelectionPlan,
} from "@/lib/revenue-engine/website-page-selection";

export const FIXTURE_WEBSITE_EVIDENCE_WORKFLOW_VERSION = "fixture-website-evidence-workflow-v1";

export const FIXTURE_WEBSITE_EVIDENCE_WORKFLOW_STEPS = [
  "CAPTURE_HOME",
  "EXTRACT_HOME",
  "SELECT_PAGES",
  "CAPTURE_SUBPAGES",
  "MEASURE_BROWSER",
  "STORE_ARTIFACTS",
  "ASSEMBLE_AUDIT",
  "RUN_AUDIT",
] as const;

export const FixtureWebsiteEvidenceWorkflowStepSchema = z.enum(FIXTURE_WEBSITE_EVIDENCE_WORKFLOW_STEPS);
export type FixtureWebsiteEvidenceWorkflowStep = z.infer<typeof FixtureWebsiteEvidenceWorkflowStepSchema>;

export const FixtureWebsiteEvidenceWorkflowRequestSchema = z.object({
  workflowVersion: z.literal(FIXTURE_WEBSITE_EVIDENCE_WORKFLOW_VERSION),
  workflowId: z.string().uuid(),
  idempotencyKey: z.string().trim().min(8).max(200),
  businessId: z.string().trim().min(1).max(128),
  businessName: z.string().trim().min(1).max(256),
  niche: z.string().trim().min(1).max(128),
  expectedServices: z.array(z.string().trim().min(1).max(100)).min(1).max(20),
  expectedLocations: z.array(z.string().trim().min(1).max(100)).min(1).max(20),
  websiteUrl: z.string().url(),
  sourceEvidenceUrl: z.string().url(),
  requestedAt: z.string().datetime({ offset: true }),
  mode: z.literal("SHADOW"),
  orchestratorKind: z.literal("FIXTURE"),
  maxCostUsd: z.literal(0),
  resourceProbes: z.array(ResourceProbeSchema).max(100),
}).strict().superRefine((request, context) => {
  for (const field of ["websiteUrl", "sourceEvidenceUrl"] as const) {
    try {
      if (normalizePublicWebsiteUrl(request[field]) !== request[field]) {
        context.addIssue({ code: "custom", message: "Fixture workflow URLs must already be canonical and public.", path: [field] });
      }
    } catch (error) {
      context.addIssue({
        code: "custom",
        message: error instanceof Error ? error.message : "Fixture workflow URL is not public.",
        path: [field],
      });
    }
  }
});

export type FixtureWebsiteEvidenceWorkflowRequest = z.infer<typeof FixtureWebsiteEvidenceWorkflowRequestSchema>;

export interface FixtureWebsiteDocumentCapture {
  kind: "FIXTURE";
  capture(requestedUrl: string): Promise<unknown>;
}

export type FixtureWebsiteEvidenceDependencies = {
  capture: FixtureWebsiteDocumentCapture;
  browserRunner: BrowserMeasurementRunner;
  artifactStore: FixtureArtifactStore;
  checkpointSink?: FixtureWebsiteEvidenceCheckpointSink;
};

export type FixtureWebsiteEvidenceSubpageCheckpoint = {
  pageKind: z.infer<typeof WebsitePageKindSchema>;
  capture: WebsiteCaptureResult;
  html: HtmlPageFacts | null;
};

export type FixtureWebsiteEvidenceCheckpointObservation =
  | { step: "CAPTURE_HOME"; sitePath: "CAPTURED" | "UNREACHABLE"; completedAt: string; output: WebsiteCaptureResult }
  | { step: "EXTRACT_HOME"; sitePath: "CAPTURED"; completedAt: string; output: HtmlPageFacts }
  | { step: "SELECT_PAGES"; sitePath: "CAPTURED"; completedAt: string; output: WebsitePageSelectionPlan }
  | { step: "CAPTURE_SUBPAGES"; sitePath: "CAPTURED"; completedAt: string; output: FixtureWebsiteEvidenceSubpageCheckpoint[] }
  | { step: "MEASURE_BROWSER"; sitePath: "CAPTURED"; completedAt: string; output: BrowserPageEvidence[] }
  | { step: "STORE_ARTIFACTS"; sitePath: "CAPTURED"; completedAt: string; output: ArtifactWriteReceipt[] }
  | { step: "ASSEMBLE_AUDIT"; sitePath: "CAPTURED"; completedAt: string; output: WebsiteAuditAssembly }
  | { step: "RUN_AUDIT"; sitePath: "CAPTURED" | "UNREACHABLE"; completedAt: string; output: DeterministicWebsiteAuditResult };

export type FixtureWebsiteEvidenceArtifactObservation = {
  pageKind: z.infer<typeof WebsitePageKindSchema>;
  profile: "DESKTOP_1440X900" | "MOBILE_390X844";
  recordedAt: string;
  plan: ArtifactWritePlan;
  receipt: ArtifactWriteReceipt;
};

export interface FixtureWebsiteEvidenceCheckpointSink {
  kind: "FIXTURE";
  commit(observation: FixtureWebsiteEvidenceCheckpointObservation): Promise<void>;
  recordArtifactAttempt(observation: FixtureWebsiteEvidenceArtifactObservation): Promise<void>;
}

const WorkflowStepReceiptSchema = z.object({
  step: FixtureWebsiteEvidenceWorkflowStepSchema,
  status: z.enum(["SUCCEEDED", "PARTIAL", "SKIPPED", "FAILED"]),
  attempts: z.number().int().nonnegative().max(1),
  startedAt: z.string().datetime({ offset: true }).nullable(),
  completedAt: z.string().datetime({ offset: true }).nullable(),
  outputDigest: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  itemCount: z.number().int().nonnegative().max(100),
  warningCodes: z.array(z.string().trim().min(1).max(120)).max(100),
  failure: z.object({
    code: z.string().trim().min(1).max(100),
    message: z.string().trim().min(1).max(300),
  }).strict().nullable(),
}).strict().superRefine((receipt, context) => {
  if (receipt.status === "SKIPPED" && (receipt.attempts !== 0 || receipt.startedAt || receipt.completedAt || receipt.outputDigest || receipt.failure)) {
    context.addIssue({ code: "custom", message: "Skipped steps cannot report execution state.", path: ["status"] });
  }
  if (receipt.status !== "SKIPPED" && (receipt.attempts !== 1 || !receipt.startedAt || !receipt.completedAt)) {
    context.addIssue({ code: "custom", message: "Executed steps require one bounded attempt and timestamps.", path: ["attempts"] });
  }
  if ((receipt.status === "FAILED") !== (receipt.failure !== null)) {
    context.addIssue({ code: "custom", message: "Only failed steps can contain a failure.", path: ["failure"] });
  }
});

const WorkflowPageReceiptSchema = z.object({
  pageKind: WebsitePageKindSchema,
  requestedUrl: z.string().url(),
  captureOutcome: z.enum(["CAPTURED", "FAILED", "REJECTED"]),
  finalUrl: z.string().url().nullable(),
  htmlComplete: z.boolean(),
  browserProfilesAttempted: z.array(z.enum(["DESKTOP_1440X900", "MOBILE_390X844"])).max(2),
  browserProfilesCaptured: z.array(z.enum(["DESKTOP_1440X900", "MOBILE_390X844"])).max(2),
  artifactReceiptIds: z.array(z.string().uuid()).max(2),
}).strict();

const WorkflowBudgetSchema = z.object({
  maxCostUsd: z.literal(0),
  totalCostUsd: z.literal(0),
  providerOperations: z.literal(0),
  documentCaptureAttempts: z.number().int().nonnegative().max(4),
  browserCaptureAttempts: z.number().int().nonnegative().max(5),
  artifactWriteAttempts: z.number().int().nonnegative().max(10),
  artifactHeadReads: z.number().int().nonnegative().max(10),
  artifactBytes: z.number().int().nonnegative().max(31_457_280),
}).strict();

export const FixtureWebsiteEvidenceWorkflowReceiptSchema = z.object({
  workflowVersion: z.literal(FIXTURE_WEBSITE_EVIDENCE_WORKFLOW_VERSION),
  workflowId: z.string().uuid(),
  idempotencyKey: z.string().trim().min(8).max(200),
  businessId: z.string().trim().min(1).max(128),
  requestedAt: z.string().datetime({ offset: true }),
  completedAt: z.string().datetime({ offset: true }),
  mode: z.literal("SHADOW"),
  orchestratorKind: z.literal("FIXTURE"),
  status: z.enum(["COMPLETED", "PARTIAL", "FAILED"]),
  sitePath: z.enum(["CAPTURED", "UNREACHABLE"]).nullable(),
  steps: z.array(WorkflowStepReceiptSchema).length(FIXTURE_WEBSITE_EVIDENCE_WORKFLOW_STEPS.length),
  pages: z.array(WorkflowPageReceiptSchema).max(4),
  artifactManifests: z.array(ArtifactManifestSchema).max(5),
  pageSelection: WebsitePageSelectionPlanSchema.nullable(),
  auditAssembly: WebsiteAuditAssemblySchema.nullable(),
  audit: DeterministicWebsiteAuditResultSchema.nullable(),
  budget: WorkflowBudgetSchema,
  failure: z.object({
    step: FixtureWebsiteEvidenceWorkflowStepSchema,
    code: z.string().trim().min(1).max(100),
    message: z.string().trim().min(1).max(300),
  }).strict().nullable(),
}).strict().superRefine((receipt, context) => {
  if (receipt.steps.some((step, index) => step.step !== FIXTURE_WEBSITE_EVIDENCE_WORKFLOW_STEPS[index])) {
    context.addIssue({ code: "custom", message: "Workflow steps must use the fixed checkpoint order.", path: ["steps"] });
  }
  if ((receipt.status === "FAILED") !== (receipt.failure !== null)) {
    context.addIssue({ code: "custom", message: "Only failed workflows can contain a workflow failure.", path: ["failure"] });
  }
  if (receipt.status === "FAILED" && receipt.audit !== null) {
    context.addIssue({ code: "custom", message: "A failed workflow cannot publish a website audit.", path: ["audit"] });
  }
  if (receipt.status !== "FAILED" && (!receipt.sitePath || !receipt.audit)) {
    context.addIssue({ code: "custom", message: "A completed or partial workflow requires a site path and audit.", path: ["audit"] });
  }
  if (receipt.sitePath === "CAPTURED" && (!receipt.pageSelection || !receipt.auditAssembly || receipt.pages.length === 0)) {
    context.addIssue({ code: "custom", message: "Captured-site workflow requires selection, assembly, and page receipts.", path: ["sitePath"] });
  }
  if (receipt.sitePath === "UNREACHABLE" && (receipt.pageSelection || receipt.auditAssembly || receipt.pages.length !== 1)) {
    context.addIssue({ code: "custom", message: "Unreachable-site workflow cannot contain successful page-set evidence.", path: ["sitePath"] });
  }
  if (receipt.status === "COMPLETED" && receipt.sitePath === "CAPTURED" && (
    receipt.pageSelection?.status !== "READY" || receipt.auditAssembly?.status !== "READY"
  )) {
    context.addIssue({ code: "custom", message: "A complete captured-site workflow requires ready selection and assembly.", path: ["status"] });
  }
  if (receipt.status === "PARTIAL" && receipt.sitePath !== "CAPTURED") {
    context.addIssue({ code: "custom", message: "Only a captured site with evidence gaps can be partial.", path: ["status"] });
  }
  const pageArtifactIds = receipt.pages
    .flatMap((page) => page.artifactReceiptIds)
    .sort((left, right) => left.localeCompare(right, "en-CA"));
  const manifestIds = receipt.artifactManifests
    .map((manifest) => manifest.manifestId)
    .sort((left, right) => left.localeCompare(right, "en-CA"));
  if (
    new Set(manifestIds).size !== manifestIds.length
    || JSON.stringify(pageArtifactIds) !== JSON.stringify(manifestIds)
  ) {
    context.addIssue({ code: "custom", message: "Artifact manifests must exactly match successful page artifact receipts.", path: ["artifactManifests"] });
  }
  if (receipt.artifactManifests.some((manifest) => manifest.workflowId !== receipt.workflowId)) {
    context.addIssue({ code: "custom", message: "Artifact manifests must belong to the website workflow.", path: ["artifactManifests"] });
  }
});

export type FixtureWebsiteEvidenceWorkflowReceipt = z.infer<typeof FixtureWebsiteEvidenceWorkflowReceiptSchema>;

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right, "en-CA"))
      .map(([key, child]) => [key, canonicalValue(child)]));
  }
  return value;
}

function digest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(canonicalValue(value))).digest("hex");
}

function deterministicUuid(seed: string) {
  const hash = createHash("sha256").update(seed).digest("hex").slice(0, 32).split("");
  hash[12] = "4";
  hash[16] = ((Number.parseInt(hash[16], 16) & 0x3) | 0x8).toString(16);
  const value = hash.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function initialSteps(): Record<FixtureWebsiteEvidenceWorkflowStep, z.infer<typeof WorkflowStepReceiptSchema>> {
  return FIXTURE_WEBSITE_EVIDENCE_WORKFLOW_STEPS.reduce((receipts, step) => {
    receipts[step] = WorkflowStepReceiptSchema.parse({
      step,
      status: "SKIPPED",
      attempts: 0,
      startedAt: null,
      completedAt: null,
      outputDigest: null,
      itemCount: 0,
      warningCodes: [],
      failure: null,
    });
    return receipts;
  }, {} as Record<FixtureWebsiteEvidenceWorkflowStep, z.infer<typeof WorkflowStepReceiptSchema>>);
}

function captureSummary(capture: WebsiteCaptureResult) {
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

function successStep(step: FixtureWebsiteEvidenceWorkflowStep, at: string, output: unknown, itemCount: number, warnings: string[] = [], partial = false) {
  return WorkflowStepReceiptSchema.parse({
    step,
    status: partial ? "PARTIAL" : "SUCCEEDED",
    attempts: 1,
    startedAt: at,
    completedAt: at,
    outputDigest: digest(output),
    itemCount,
    warningCodes: [...new Set(warnings)].sort((left, right) => left.localeCompare(right, "en-CA")),
    failure: null,
  });
}

function failedStep(step: FixtureWebsiteEvidenceWorkflowStep, at: string, code: string, message: string) {
  return WorkflowStepReceiptSchema.parse({
    step,
    status: "FAILED",
    attempts: 1,
    startedAt: at,
    completedAt: at,
    outputDigest: null,
    itemCount: 0,
    warningCodes: [],
    failure: { code, message: message.slice(0, 300) },
  });
}

function pageReceipt(page: {
  pageKind: z.infer<typeof WebsitePageKindSchema>;
  capture: WebsiteCaptureResult;
  html: HtmlPageFacts | null;
  browser: BrowserPageEvidence[];
  artifactReceipts: ArtifactWriteReceipt[];
}) {
  return WorkflowPageReceiptSchema.parse({
    pageKind: page.pageKind,
    requestedUrl: page.capture.requestedUrl,
    captureOutcome: page.capture.outcome,
    finalUrl: page.capture.finalUrl,
    htmlComplete: Boolean(page.html?.complete),
    browserProfilesAttempted: page.browser.map((evidence) => evidence.profile),
    browserProfilesCaptured: page.browser.filter((evidence) => evidence.outcome === "CAPTURED").map((evidence) => evidence.profile),
    artifactReceiptIds: page.artifactReceipts.map((receipt) => receipt.planId),
  });
}

function unreachableAudit(request: FixtureWebsiteEvidenceWorkflowRequest, capture: WebsiteCaptureResult) {
  const input = DeterministicWebsiteAuditInputSchema.parse({
    businessId: request.businessId,
    businessName: request.businessName,
    niche: request.niche,
    expectedServices: request.expectedServices,
    expectedLocations: request.expectedLocations,
    sourceEvidenceUrl: request.sourceEvidenceUrl,
    siteState: "UNREACHABLE",
    requestedUrl: capture.requestedUrl,
    finalUrl: null,
    statusCode: capture.statusCode,
    redirectCount: capture.redirectCount,
    capturedAt: capture.capturedAt,
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
  return auditWebsiteDeterministically(input);
}

function viewport(profile: "DESKTOP_1440X900" | "MOBILE_390X844") {
  return profile === "DESKTOP_1440X900"
    ? { width: 1_440, height: 900, deviceScaleFactor: 1, isMobile: false, hasTouch: false }
    : { width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true };
}

export async function runFixtureWebsiteEvidenceWorkflow(
  value: unknown,
  dependencies: FixtureWebsiteEvidenceDependencies,
): Promise<FixtureWebsiteEvidenceWorkflowReceipt> {
  const request = FixtureWebsiteEvidenceWorkflowRequestSchema.parse(value);
  if (
    dependencies.capture.kind !== "FIXTURE"
    || dependencies.browserRunner.kind !== "FIXTURE"
    || dependencies.artifactStore.kind !== "FIXTURE"
    || (dependencies.checkpointSink && dependencies.checkpointSink.kind !== "FIXTURE")
  ) {
    throw new Error("Website evidence workflow version 1 accepts fixture dependencies only.");
  }
  const steps = initialSteps();
  const at = request.requestedAt;
  let currentStep: FixtureWebsiteEvidenceWorkflowStep = "CAPTURE_HOME";
  let documentCaptureAttempts = 0;
  let browserCaptureAttempts = 0;
  let artifactWriteAttempts = 0;
  let artifactHeadReads = 0;
  let artifactBytes = 0;
  let pageSelection: WebsitePageSelectionPlan | null = null;
  let auditAssembly: WebsiteAuditAssembly | null = null;
  let audit: DeterministicWebsiteAuditResult | null = null;
  const pages: Array<{
    pageKind: z.infer<typeof WebsitePageKindSchema>;
    capture: WebsiteCaptureResult;
    html: HtmlPageFacts | null;
    browser: BrowserPageEvidence[];
    artifactReceipts: ArtifactWriteReceipt[];
  }> = [];

  const workflowReceipt = (
    status: "COMPLETED" | "PARTIAL" | "FAILED",
    sitePath: "CAPTURED" | "UNREACHABLE" | null,
    failure: { step: FixtureWebsiteEvidenceWorkflowStep; code: string; message: string } | null,
  ) => FixtureWebsiteEvidenceWorkflowReceiptSchema.parse({
    workflowVersion: request.workflowVersion,
    workflowId: request.workflowId,
    idempotencyKey: request.idempotencyKey,
    businessId: request.businessId,
    requestedAt: request.requestedAt,
    completedAt: at,
    mode: request.mode,
    orchestratorKind: request.orchestratorKind,
    status,
    sitePath,
    steps: FIXTURE_WEBSITE_EVIDENCE_WORKFLOW_STEPS.map((step) => steps[step]),
    pages: pages.map(pageReceipt),
    artifactManifests: pages
      .flatMap((page) => page.artifactReceipts)
      .map(artifactManifestFromWriteReceipt),
    pageSelection,
    auditAssembly,
    audit,
    budget: {
      maxCostUsd: 0,
      totalCostUsd: 0,
      providerOperations: 0,
      documentCaptureAttempts,
      browserCaptureAttempts,
      artifactWriteAttempts,
      artifactHeadReads,
      artifactBytes,
    },
    failure,
  });

  try {
    documentCaptureAttempts += 1;
    const homeCapture = WebsiteCaptureResultSchema.parse(await dependencies.capture.capture(request.websiteUrl));
    if (homeCapture.requestedUrl !== request.websiteUrl) throw new Error("Fixture homepage capture does not match its requested URL.");
    pages.push({ pageKind: "HOME", capture: homeCapture, html: null, browser: [], artifactReceipts: [] });
    steps.CAPTURE_HOME = successStep("CAPTURE_HOME", at, captureSummary(homeCapture), 1, [], homeCapture.outcome !== "CAPTURED");

    if (homeCapture.outcome !== "CAPTURED") {
      if (homeCapture.outcome === "REJECTED") throw new Error("A canonical fixture homepage cannot return a rejected capture.");
      await dependencies.checkpointSink?.commit({
        step: "CAPTURE_HOME",
        sitePath: "UNREACHABLE",
        completedAt: at,
        output: homeCapture,
      });
      currentStep = "RUN_AUDIT";
      audit = unreachableAudit(request, homeCapture);
      steps.RUN_AUDIT = successStep("RUN_AUDIT", at, audit, 1);
      await dependencies.checkpointSink?.commit({
        step: "RUN_AUDIT",
        sitePath: "UNREACHABLE",
        completedAt: at,
        output: audit,
      });
      return workflowReceipt("COMPLETED", "UNREACHABLE", null);
    }
    await dependencies.checkpointSink?.commit({
      step: "CAPTURE_HOME",
      sitePath: "CAPTURED",
      completedAt: at,
      output: homeCapture,
    });

    currentStep = "EXTRACT_HOME";
    const homeHtml = await extractHtmlPageFacts(homeCapture, "HOME");
    pages[0].html = homeHtml;
    steps.EXTRACT_HOME = successStep("EXTRACT_HOME", at, homeHtml, 1, homeHtml.warnings, !homeHtml.complete);
    await dependencies.checkpointSink?.commit({ step: "EXTRACT_HOME", sitePath: "CAPTURED", completedAt: at, output: homeHtml });

    currentStep = "SELECT_PAGES";
    pageSelection = planWebsitePages({
      selectionVersion: WEBSITE_PAGE_SELECTION_VERSION,
      selectionId: deterministicUuid(`${request.workflowId}:page-selection`),
      businessId: request.businessId,
      businessName: request.businessName,
      niche: request.niche,
      expectedServices: request.expectedServices,
      plannedAt: at,
      mode: "SHADOW",
      plannerKind: "DETERMINISTIC_FIXTURE",
      maxCostUsd: 0,
      policy: defaultWebsitePageSelectionPolicy(),
      homepageFacts: homeHtml,
    });
    steps.SELECT_PAGES = successStep("SELECT_PAGES", at, pageSelection, pageSelection.selectedPages.length, pageSelection.warnings, pageSelection.status === "PARTIAL");
    await dependencies.checkpointSink?.commit({ step: "SELECT_PAGES", sitePath: "CAPTURED", completedAt: at, output: pageSelection });

    currentStep = "CAPTURE_SUBPAGES";
    for (const selectedPage of pageSelection.selectedPages.filter((page) => page.pageKind !== "HOME")) {
      documentCaptureAttempts += 1;
      const capture = WebsiteCaptureResultSchema.parse(await dependencies.capture.capture(selectedPage.url));
      if (capture.requestedUrl !== selectedPage.url) throw new Error("Fixture subpage capture does not match its selected URL.");
      const html = capture.outcome === "CAPTURED" ? await extractHtmlPageFacts(capture, selectedPage.pageKind) : null;
      pages.push({ pageKind: selectedPage.pageKind, capture, html, browser: [], artifactReceipts: [] });
    }
    const unavailablePages = pages.filter((page) => page.capture.outcome !== "CAPTURED");
    steps.CAPTURE_SUBPAGES = successStep(
      "CAPTURE_SUBPAGES",
      at,
      pages.slice(1).map((page) => captureSummary(page.capture)),
      Math.max(0, pages.length - 1),
      unavailablePages.map((page) => `page_unavailable:${page.pageKind}`),
      unavailablePages.length > 0 || pageSelection.status === "PARTIAL",
    );
    await dependencies.checkpointSink?.commit({
      step: "CAPTURE_SUBPAGES",
      sitePath: "CAPTURED",
      completedAt: at,
      output: pages.slice(1).map((page) => ({ pageKind: page.pageKind, capture: page.capture, html: page.html })),
    });

    currentStep = "MEASURE_BROWSER";
    const successfulPages = pages.filter((page) => page.capture.outcome === "CAPTURED" && page.html);
    for (const page of successfulPages) {
      const finalUrl = page.capture.finalUrl;
      if (!finalUrl) throw new Error("Captured fixture page lost its final URL before Browser measurement.");
      const profiles = page.pageKind === "HOME"
        ? ["DESKTOP_1440X900", "MOBILE_390X844"] as const
        : ["DESKTOP_1440X900"] as const;
      for (const profile of profiles) {
        browserCaptureAttempts += 1;
        const requestId = deterministicUuid(`${request.workflowId}:${page.pageKind}:${finalUrl}:${profile}`);
        const browserRequest = BrowserMeasurementRequestSchema.parse({
          adapterVersion: BROWSER_MEASUREMENT_ADAPTER_VERSION,
          requestId,
          workflowId: request.workflowId,
          businessId: request.businessId,
          pageKind: page.pageKind,
          requestedUrl: finalUrl,
          profile,
          viewport: viewport(profile),
          requestedAt: at,
          mode: "SHADOW",
          runnerKind: "FIXTURE",
          maxCostUsd: 0,
          artifactWriteAuthorized: false,
          policy: defaultBrowserMeasurementPolicy(),
        });
        const draft = await createBrowserMeasurementDraft(browserRequest, {
          runner: dependencies.browserRunner,
          now: () => new Date(at),
        });
        if (draft.outcome !== "CAPTURED") {
          page.browser.push(finalizeBrowserMeasurementDraft(draft, null));
          continue;
        }

        currentStep = "STORE_ARTIFACTS";
        const writePlan = createBrowserArtifactWritePlan(draft);
        const writeReceipt = ArtifactWriteReceiptSchema.parse(await executeFixtureArtifactWritePlan(writePlan, {
          store: dependencies.artifactStore,
          now: () => new Date(at),
        }));
        await dependencies.checkpointSink?.recordArtifactAttempt({
          pageKind: page.pageKind,
          profile,
          recordedAt: at,
          plan: writePlan,
          receipt: writeReceipt,
        });
        artifactWriteAttempts += writeReceipt.fixturePutAttempts;
        artifactHeadReads += writeReceipt.fixtureHeadReads;
        artifactBytes += writeReceipt.items.reduce((sum, item) => sum + item.byteLength, 0);
        if (writeReceipt.outcome !== "COMPLETED") {
          throw new Error(`Artifact persistence failed at item ${writeReceipt.failure.itemIndex}: ${writeReceipt.failure.code}.`);
        }
        page.artifactReceipts.push(writeReceipt);
        page.browser.push(finalizeBrowserMeasurementDraft(draft, browserArtifactRefsFromReceipt(writePlan, writeReceipt)));
        currentStep = "MEASURE_BROWSER";
      }
    }
    const browserEvidence = pages.flatMap((page) => page.browser);
    const browserFailures = browserEvidence.filter((evidence) => evidence.outcome !== "CAPTURED");
    steps.MEASURE_BROWSER = successStep(
      "MEASURE_BROWSER",
      at,
      browserEvidence,
      browserEvidence.length,
      browserFailures.map((evidence) => `browser_unavailable:${evidence.pageKind}:${evidence.profile}`),
      browserFailures.length > 0,
    );
    await dependencies.checkpointSink?.commit({
      step: "MEASURE_BROWSER",
      sitePath: "CAPTURED",
      completedAt: at,
      output: browserEvidence,
    });
    const artifactReceipts = pages.flatMap((page) => page.artifactReceipts);
    steps.STORE_ARTIFACTS = successStep(
      "STORE_ARTIFACTS",
      at,
      artifactReceipts,
      artifactReceipts.length,
      [],
      browserFailures.length > 0,
    );
    await dependencies.checkpointSink?.commit({
      step: "STORE_ARTIFACTS",
      sitePath: "CAPTURED",
      completedAt: at,
      output: artifactReceipts,
    });

    currentStep = "ASSEMBLE_AUDIT";
    auditAssembly = assembleWebsiteAuditInput({
      assemblyVersion: WEBSITE_AUDIT_ASSEMBLY_VERSION,
      assemblyId: deterministicUuid(`${request.workflowId}:audit-assembly`),
      workflowId: request.workflowId,
      assembledAt: at,
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
      pages: pages.map((page) => ({
        pageKind: page.pageKind,
        capture: page.capture,
        html: page.html,
        browser: page.browser,
        artifactReceipts: page.artifactReceipts,
      })),
      resourceProbes: request.resourceProbes,
    } satisfies WebsiteAuditAssemblyRequest);
    steps.ASSEMBLE_AUDIT = successStep("ASSEMBLE_AUDIT", at, auditAssembly, auditAssembly.pages.length, auditAssembly.warnings, auditAssembly.status === "PARTIAL");
    await dependencies.checkpointSink?.commit({ step: "ASSEMBLE_AUDIT", sitePath: "CAPTURED", completedAt: at, output: auditAssembly });

    currentStep = "RUN_AUDIT";
    audit = auditWebsiteDeterministically(auditAssembly.auditInput);
    steps.RUN_AUDIT = successStep("RUN_AUDIT", at, audit, 1, audit.manualReviewReasons, auditAssembly.status === "PARTIAL");
    await dependencies.checkpointSink?.commit({ step: "RUN_AUDIT", sitePath: "CAPTURED", completedAt: at, output: audit });
    const partial = pageSelection.status === "PARTIAL" || auditAssembly.status === "PARTIAL";
    return workflowReceipt(partial ? "PARTIAL" : "COMPLETED", "CAPTURED", null);
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 300) : "Unknown fixture website evidence workflow failure.";
    steps[currentStep] = failedStep(currentStep, at, "fixture_workflow_failed", message);
    audit = null;
    auditAssembly = null;
    return workflowReceipt("FAILED", null, { step: currentStep, code: "fixture_workflow_failed", message });
  }
}

export const FIXTURE_WEBSITE_EVIDENCE_AUDIT_VERSION = DETERMINISTIC_WEBSITE_AUDIT_VERSION;
export const FIXTURE_WEBSITE_EVIDENCE_CAPTURE_VERSION = WEBSITE_CAPTURE_VERSION;
