import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import Database from "better-sqlite3";
import { chromium, type Browser, type BrowserContext, type Page, type Route } from "playwright";

import {
  REVENUE_CONTACT_DISCOVERY_VERSION,
  REVENUE_CONTACT_EVIDENCE_VERSION,
  buildFixtureContactDiscoveryResult,
  contactDiscoveryDigest,
  type RevenueContactDiscoveryRequest,
  type RevenueContactObservation,
} from "../src/lib/revenue-engine/contact-discovery";
import { buildRevenueContactPersistencePlan } from "../src/lib/revenue-engine/contact-persistence-plan";
import {
  REVENUE_CONTACT_VERIFICATION_VERSION,
  buildFixtureContactVerificationResult,
  type RevenueContactVerificationObservation,
  type RevenueContactVerificationRequest,
} from "../src/lib/revenue-engine/contact-verification";
import {
  PRIVATE_KW_CONTACT_PERSISTENCE_APPROVAL_CONFIRMATION,
  PRIVATE_KW_CONTACT_PERSISTENCE_VERSION,
  type PrivateKwContactPersistenceApproval,
} from "../src/lib/revenue-engine/private-kw-contact-persistence";
import { qualifyRevenueLead } from "../src/lib/revenue-engine/qualification";
import { buildCompleteOwnerLabelingPacketFixture } from "../src/lib/revenue-engine/test-support/owner-labeling-fixture";
import { splitOwnerLabelingPacket } from "../src/lib/revenue-engine/owner-labeling-blind";
import { auditWebsiteDeterministically } from "../src/lib/revenue-engine/website-audit";
import { executePrivateKwContactPersistenceForLocalDatabase } from "./private-kw-contact-persistence-executor";
import { verifyOwnerWarmupStreaming } from "./owner-ui-warmup-streaming.acceptance";
import { createM2OwnerConsoleFixture } from "./m2-owner-console-fixture";
import { readSetupFile } from "./private-kw-m2-snapshot";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(SCRIPT_DIR, "..");
const OUTPUT_ROOT = join(REPOSITORY_ROOT, "output", "playwright");
const FIXTURE_EMAIL = "owner-acceptance@getaxiom.ca";
const FIXTURE_PASSWORD = "owner-acceptance-only-password";
export const FIXTURE_BUSINESS_ID = "business:owner-acceptance-roofing";
const TEST_AUTH_SECRET = "owner-ui-acceptance-only-secret-00000000000000000000";
const AXE_PATH = createRequire(import.meta.url).resolve("axe-core/axe.min.js");
const OWNER_LIST_BUDGET_MS = 10_000;
const OWNER_DOSSIER_BUDGET_MS = 15_000;
const OWNER_M2_BUDGET_MS = 15_000;
const OWNER_TITLE_TIMEOUT_MS = 5_000;

type SqliteDatabase = InstanceType<typeof Database>;

type AxeViolation = {
  id: string;
  impact: string | null;
  help: string;
  nodes: Array<{
    target: string[];
    html: string;
    failureSummary?: string;
  }>;
};

type AcceptanceResult = {
  desktopListReadyMs: number;
  desktopDossierReadyMs: number;
  desktopM2ReadyMs: number;
  desktopWidth: number;
  mobileWidth: number;
  pagesScanned: number;
  externalRequests: number;
};

export type BrowserDiagnostic = {
  capturedAt: string;
  stage: string;
  kind: "console-error" | "page-error" | "request-failed" | "http-error" | "script-parse-error" | "runtime-exception";
  url: string;
  message: string;
  name?: string;
  stack?: string | null;
  status?: number;
  scriptId?: string;
  lineNumber?: number;
  columnNumber?: number;
  sourceArtifact?: string;
  sourceCaptureError?: string;
};

export function attachBrowserDiagnostics(
  page: Page,
  getStage: () => string,
  diagnostics: BrowserDiagnostic[],
  baseUrl: string,
) {
  const baseOrigin = new URL(baseUrl).origin;
  const record = (diagnostic: Omit<BrowserDiagnostic, "capturedAt" | "stage">) => {
    diagnostics.push({
      capturedAt: new Date().toISOString(),
      stage: getStage(),
      ...diagnostic,
    });
  };

  page.on("console", (message) => {
    if (message.type() !== "error") return;
    record({
      kind: "console-error",
      url: message.location().url || page.url(),
      message: message.text(),
    });
  });
  page.on("pageerror", (error) => {
    record({
      kind: "page-error",
      url: page.url(),
      message: error.message,
      name: error.name,
      stack: error.stack ?? null,
    });
  });
  page.on("requestfailed", (request) => {
    record({
      kind: "request-failed",
      url: request.url(),
      message: request.failure()?.errorText ?? "Request failed",
    });
  });
  page.on("response", (response) => {
    const status = response.status();
    if (status < 500 || new URL(response.url()).origin !== baseOrigin) return;
    record({
      kind: "http-error",
      url: response.url(),
      message: `HTTP ${status}`,
      status,
    });
  });
}

/** Chromium can omit the script URL and stack from a Playwright pageerror.
 * Capture parser/runtime attribution and the exact failing source before navigation loses it. */
export async function attachBrowserScriptDiagnostics(context: BrowserContext, page: Page,
  getStage: () => string, diagnostics: BrowserDiagnostic[], outputDirectory: string, sourceTimeoutMs = 5_000) {
  const session = await context.newCDPSession(page);
  const pending: Promise<void>[] = [];
  let draining = false;
  let drainPromise: Promise<void> | null = null;
  const capture = (kind: "script-parse-error" | "runtime-exception", details: {
    scriptId?: string; url?: string; lineNumber?: number; columnNumber?: number; message: string;
  }) => {
    const diagnostic: BrowserDiagnostic = { capturedAt: new Date().toISOString(), stage: getStage(), kind,
      ...details, url: details.url || page.url() };
    diagnostics.push(diagnostic);
    if (details.scriptId && draining) {
      diagnostic.sourceCaptureError = "Script source collection already closed.";
    } else if (details.scriptId) {
      const filename = `owner-ui-script-${diagnostics.length}.js.txt`;
      pending.push((async () => {
        let timeout: ReturnType<typeof setTimeout> | undefined;
        try {
          const result = await Promise.race([
            session.send("Debugger.getScriptSource", { scriptId: details.scriptId! }),
            new Promise<never>((_, reject) => {
              timeout = setTimeout(() => reject(new Error("Script source capture timed out.")), sourceTimeoutMs);
            }),
          ]);
          if (Buffer.byteLength(result.scriptSource) > 5_000_000) throw new Error("Failing script exceeded diagnostic size limit.");
          await writeFile(join(outputDirectory, filename), result.scriptSource, { flag: "wx" });
          diagnostic.sourceArtifact = filename;
        } catch (error) { diagnostic.sourceCaptureError = error instanceof Error ? error.message : String(error); }
        finally { if (timeout) clearTimeout(timeout); }
      })());
    }
  };
  session.on("Debugger.scriptFailedToParse", (details) => capture("script-parse-error", {
    scriptId: details.scriptId, url: details.url, lineNumber: details.startLine, columnNumber: details.startColumn,
    message: "Chromium failed to parse this script",
  }));
  session.on("Runtime.exceptionThrown", ({ exceptionDetails: details }) => capture("runtime-exception", {
    scriptId: details.scriptId, url: details.url, lineNumber: details.lineNumber, columnNumber: details.columnNumber,
    message: details.exception?.description ?? details.text,
  }));
  await session.send("Runtime.enable");
  await session.send("Debugger.enable");
  return () => {
    if (!drainPromise) {
      draining = true;
      drainPromise = Promise.all(pending).then(() => undefined);
    }
    return drainPromise;
  };
}

export async function writeBrowserDiagnostics(
  outputDirectory: string,
  diagnostics: BrowserDiagnostic[],
  failedStage: string,
  failedUrl: string | null,
) {
  await writeFile(
    join(outputDirectory, "owner-ui-browser-diagnostics.json"),
    `${JSON.stringify({ diagnostics, failedStage, failedUrl }, null, 2)}\n`,
    "utf8",
  );
}

type BrowserDiagnosticsWriter = (
  outputDirectory: string,
  diagnostics: BrowserDiagnostic[],
  failedStage: string,
  failedUrl: string | null,
) => Promise<void>;

export async function reportBrowserAcceptanceFailure({
  error,
  outputDirectory,
  diagnostics,
  failedStage,
  measuredPageUrl,
  warmupPageUrl,
  writeDiagnostics = writeBrowserDiagnostics,
  warn = (message) => console.warn(message),
}: {
  error: unknown;
  outputDirectory: string;
  diagnostics: BrowserDiagnostic[];
  failedStage: string;
  measuredPageUrl: string | null;
  warmupPageUrl: string | null;
  writeDiagnostics?: BrowserDiagnosticsWriter;
  warn?: (message: string) => void;
}): Promise<never> {
  const failedUrl = measuredPageUrl ?? warmupPageUrl ?? null;
  try {
    await writeDiagnostics(outputDirectory, diagnostics, failedStage, failedUrl);
  } catch {
    warn("Owner UI browser diagnostics persistence failed; primary acceptance error preserved.");
  }
  if (error instanceof Error) error.message = `${failedStage} at ${failedUrl ?? "no page"}: ${error.message}`;
  throw error;
}

export function isAllowedOwnerAcceptanceUrl(rawUrl: string, baseUrl: string) {
  const value = new URL(rawUrl);
  if (value.protocol === "data:" || value.protocol === "about:") return true;
  if (value.protocol === "blob:") return value.origin === new URL(baseUrl).origin;
  return value.origin === new URL(baseUrl).origin;
}

async function assertOwnerPageTitle(page: Page, expectedTitle: string) {
  await page.waitForFunction(
    (title) => document.title === title,
    expectedTitle,
    { timeout: OWNER_TITLE_TIMEOUT_MS },
  );
  assert.equal(await page.title(), expectedTitle);
}

export function cssTimeToMilliseconds(value: string) {
  const trimmed = value.trim();
  if (trimmed.endsWith("ms")) return Number.parseFloat(trimmed.slice(0, -2));
  if (trimmed.endsWith("s")) return Number.parseFloat(trimmed.slice(0, -1)) * 1_000;
  return Number.NaN;
}

async function freeLoopbackPort() {
  return new Promise<number>((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Could not reserve a loopback port."));
        return;
      }
      server.close((error) => error ? reject(error) : resolvePort(address.port));
    });
  });
}

async function applyMigrations(database: SqliteDatabase) {
  const migrationsDirectory = join(REPOSITORY_ROOT, "migrations");
  // This fixture exercises the existing owner/contact workflow, whose schema
  // contract is deliberately pinned to the pre-M2 0054-0068 partition.
  const migrations = (await readdir(migrationsDirectory))
    .filter((name) => /^\d{4}_.+\.sql$/.test(name) && name.slice(0, 4) <= "0068")
    .sort((left, right) => left.localeCompare(right));
  assert(migrations.length >= 60 && migrations.at(-1)?.startsWith("0068_"),
    "The owner fixture must use the complete pre-M2 migration history through 0068.");
  const postSeedMigrations = ["0071_revenue_owner_tasks.sql", "0072_revenue_business_stop.sql", "0073_revenue_contact_suppression.sql", "0074_revenue_owner_observed_replies.sql"];
  const migrationNames = await readdir(migrationsDirectory);
  for (const migration of postSeedMigrations) {
    assert(migrationNames.includes(migration), `The synthetic owner fixture requires ${migration} for owner-action acceptance.`);
  }

  database.pragma("foreign_keys = ON");
  for (const migration of migrations) {
    database.exec(await readFile(join(migrationsDirectory, migration), "utf8"));
  }
  // The contact writer used by seedOwnerLead verifies this exact baseline.
  // Add independent owner-action tables only after that seed completes.
}

async function assertNoProposedBusinessReviewPrompt(page: Page, label: string) {
  const bodyText = await page.locator("body").innerText();
  assert.equal(
    await page.getByRole("link", { name: /business review|proposed businesses/i }).count(),
    0,
    `${label} must not show a business-review link.`,
  );
  assert.doesNotMatch(
    bodyText,
    /check the proposed business list|review proposed businesses|review \d+ proposed businesses|open business review/i,
    `${label} must not prompt the owner to review the proposed business list.`,
  );
}

function fixtureTimestamp(offsetMilliseconds: number) {
  return new Date(Date.now() + offsetMilliseconds).toISOString();
}

function buildOwnerContactFixture(sourceCapturedAt: string, sourceEvidenceUrl: string) {
  const requestedAt = new Date(Date.parse(sourceCapturedAt) + 60_000).toISOString();
  const evidenceCapturedAt = new Date(Date.parse(sourceCapturedAt) + 2 * 60_000).toISOString();
  const discoveryCompletedAt = new Date(Date.parse(sourceCapturedAt) + 3 * 60_000).toISOString();
  const discoveryRequest: RevenueContactDiscoveryRequest = {
    discoveryVersion: REVENUE_CONTACT_DISCOVERY_VERSION,
    requestId: `contact-discovery-request:${contactDiscoveryDigest("owner-ui-contact-discovery")}`,
    idempotencyKey: "owner-ui-contact-discovery",
    businessId: FIXTURE_BUSINESS_ID,
    websiteUrl: "https://roofing.axiomfixtures.ca/",
    sourceEvidenceUrl,
    requestedAt,
    mode: "SHADOW" as const,
    adapterKind: "FIXTURE" as const,
    limits: { maxCandidates: 10, maxProviderOperations: 0 as const, maxCostUsd: 0 as const },
    authority: {
      runtimeConnected: false as const,
      contactPersistenceAuthorized: false as const,
      verificationAuthorized: false as const,
      outreachAuthorized: false as const,
      sendAuthorized: false as const,
      providerOperationsAuthorized: 0 as const,
      costAuthorizedUsd: 0 as const,
    },
  };
  const evidence = (
    method: RevenueContactObservation["evidence"]["method"],
    observation: string,
  ): RevenueContactObservation["evidence"] => ({
    evidenceVersion: REVENUE_CONTACT_EVIDENCE_VERSION,
    sourceUrl: "https://roofing.axiomfixtures.ca/contact",
    capturedAt: evidenceCapturedAt,
    method,
    observation,
    confidence: 98,
    publication: {
      publiclyPublished: true,
      contraryContactStatement: "NOT_OBSERVED" as const,
      roleRelevance: "RELEVANT" as const,
      consentBasis: "UNASSESSED" as const,
    },
  });
  const observations: RevenueContactObservation[] = [
    {
      channel: "PHONE", value: "+15195550123", label: "Main business phone", personName: null, role: null,
      recipientKind: "BUSINESS", socialPlatform: null,
      evidence: evidence("HTML_TEL", "The public contact page exposes a tap-to-call main number."),
    },
    {
      channel: "FORM", value: "https://roofing.axiomfixtures.ca/contact", label: "Contact form", personName: null, role: null,
      recipientKind: "BUSINESS", socialPlatform: null,
      evidence: evidence("HTML_FORM", "The public contact page exposes a contact form."),
    },
    {
      channel: "EMAIL", value: "hello@roofing.axiomfixtures.ca", label: "General email", personName: null, role: "Office",
      recipientKind: "ROLE", socialPlatform: null,
      evidence: evidence("HTML_MAILTO", "The public contact page exposes an office email address."),
    },
  ];
  const discovery = buildFixtureContactDiscoveryResult({ request: discoveryRequest, observations, completedAt: discoveryCompletedAt });
  const verifications = discovery.candidates
    .filter((candidate) => candidate.channel === "PHONE" || candidate.channel === "FORM")
    .map((candidate, index) => {
      const requested = new Date(Date.parse(discoveryCompletedAt) + (index + 1) * 60_000).toISOString();
      const verifiedAt = new Date(Date.parse(requested) + 60_000).toISOString();
      const completedAt = new Date(Date.parse(verifiedAt) + 60_000).toISOString();
      const staleAfter = new Date(Date.parse(verifiedAt) + 30 * 24 * 60 * 60 * 1_000).toISOString();
      const verificationRequest: RevenueContactVerificationRequest = {
        verificationVersion: REVENUE_CONTACT_VERIFICATION_VERSION,
        requestId: `contact-verification-request:${contactDiscoveryDigest(`owner-ui-contact-verification-${candidate.channel}`)}`,
        idempotencyKey: `owner-ui-contact-verification-${candidate.channel}`,
        businessId: FIXTURE_BUSINESS_ID,
        candidate,
        requestedAt: requested,
        mode: "SHADOW" as const,
        verifierKind: "FIXTURE" as const,
        limits: { maxProviderOperations: 0 as const, maxCostUsd: 0 as const },
        authority: {
          runtimeConnected: false as const,
          verificationPersistenceAuthorized: false as const,
          qualificationPersistenceAuthorized: false as const,
          outreachAuthorized: false as const,
          sendAuthorized: false as const,
          providerOperationsAuthorized: 0 as const,
          costAuthorizedUsd: 0 as const,
        },
      };
      const verificationObservation = {
        channel: candidate.channel,
        status: candidate.channel === "PHONE" ? "PUBLISHED" : "AVAILABLE",
        provider: "FIXTURE",
        method: "FIXTURE_RECEIPT",
        evidenceReceiptId: `fixture-verification:owner-ui-${candidate.channel.toLocaleLowerCase("en-CA")}`,
        sourceUrl: `https://verification.axiomfixtures.ca/receipts/${candidate.channel.toLocaleLowerCase("en-CA")}`,
        verifiedAt,
        staleAfter,
        confidence: 99,
      } as RevenueContactVerificationObservation;
      return buildFixtureContactVerificationResult({ request: verificationRequest, observation: verificationObservation, completedAt });
    });
  const persistencePlan = buildRevenueContactPersistencePlan({ discovery, verifications });
  const approval: PrivateKwContactPersistenceApproval = {
    materializationVersion: PRIVATE_KW_CONTACT_PERSISTENCE_VERSION,
    businessId: FIXTURE_BUSINESS_ID,
    discoveryResultId: discovery.discoveryResultId,
    discoveryResultDigest: discovery.discoveryResultDigest,
    persistencePlanDigest: persistencePlan.planDigest,
    verificationResults: verifications
      .map((verification) => ({
        verificationResultId: verification.verificationResultId,
        verificationResultDigest: verification.verificationResultDigest,
      }))
      .sort((left, right) => left.verificationResultId.localeCompare(right.verificationResultId, "en-CA")),
    approval: {
      decision: "APPROVED_FOR_LOCAL_CONTACT_PERSISTENCE",
      reviewedBy: "RILEY",
      reviewedAt: fixtureTimestamp(-10_000),
      rationale: "Approved the exact synthetic owner acceptance contact bundle for ignored-local persistence.",
      confirmation: PRIVATE_KW_CONTACT_PERSISTENCE_APPROVAL_CONFIRMATION,
    },
    mode: "SHADOW",
    executionKind: "IGNORED_LOCAL_SQLITE",
    localDatabaseAccessAuthorized: true,
    localContactMutationAuthorized: true,
    localVerificationMutationAuthorized: true,
    sourceMutationAuthorized: false,
    workflowMutationAuthorized: false,
    assessmentMutationAuthorized: false,
    schemaMutationAuthorized: false,
    captureAuthorized: false,
    contactDiscoveryAuthorized: false,
    contactVerificationAuthorized: false,
    consentDecisionAuthorized: false,
    qualificationAuthorized: false,
    outreachAuthorized: false,
    sendAuthorized: false,
    providerOperationsAuthorized: 0,
    costAuthorizedUsd: 0,
  };
  return { discovery, verifications, approval };
}

export function seedOwnerLead(database: SqliteDatabase) {
  const sourceCapturedAt = fixtureTimestamp(-2 * 60 * 60 * 1_000);
  const capturedAt = fixtureTimestamp(-60 * 60 * 1_000);
  const refreshAfter = new Date(Date.parse(capturedAt) + 60 * 24 * 60 * 60 * 1_000).toISOString();
  const sourceEvidenceUrl = "https://directory.axiomfixtures.ca/business/owner-acceptance-roofing";
  const websiteUrl = "http://roofing.axiomfixtures.ca/";
  const contactFixture = buildOwnerContactFixture(sourceCapturedAt, sourceEvidenceUrl);

  const audit = auditWebsiteDeterministically({
    businessId: FIXTURE_BUSINESS_ID,
    businessName: "Tri-City Roofing Fixture",
    niche: "roofing",
    expectedServices: ["roofing", "roof repair"],
    expectedLocations: ["Kitchener", "Waterloo"],
    sourceEvidenceUrl,
    siteState: "CAPTURED",
    requestedUrl: websiteUrl,
    finalUrl: websiteUrl,
    statusCode: 200,
    redirectCount: 5,
    capturedAt,
    desktopArtifactRef: "artifact:sha256:owner-acceptance-desktop",
    mobileArtifactRef: "artifact:sha256:owner-acceptance-mobile",
    domArtifactRef: "artifact:sha256:owner-acceptance-dom",
    pageSetComplete: true,
    pages: [{
      kind: "HOME",
      url: websiteUrl,
      title: null,
      metaDescription: null,
      visibleText: "Welcome to our company.",
      actions: [],
      forms: [],
      trustSignals: [],
      structuredDataTypes: [],
      contentComplete: true,
      evidenceCoverage: {
        desktopRenderCaptured: true,
        actionVisibilityComplete: true,
        formVisibilityComplete: true,
      },
    }],
    resourceProbes: [{
      url: "http://roofing.axiomfixtures.ca/missing.css",
      type: "ASSET",
      internal: true,
      statusCode: 404,
    }],
    mobile: {
      captured: true,
      horizontalOverflow: true,
      navigationUsable: false,
      textReadable: false,
      minimumTapTargetPx: 18,
    },
  });
  const qualification = qualifyRevenueLead({
    scores: {
      rebuildNeed: audit.rebuildNeedScore,
      businessFit: 86,
      reachability: 88,
      timing: 64,
      evidenceConfidence: audit.evidenceConfidence,
    },
    evidenceClaims: audit.claims,
    availableChannels: ["PHONE", "FORM"],
  });
  assert(audit.claims.length >= 3, "Synthetic dossier must contain at least three supported observations.");
  assert(qualification.totalScore >= 70, "Synthetic dossier must remain owner-reviewable.");
  assert.equal(qualification.band, "PRIORITY", "Synthetic dossier must satisfy every qualification gate.");

  const insert = database.transaction(() => {
    database.prepare(`INSERT INTO "RevenueBusiness"
      ("id", "canonicalName", "normalizedDomain", "normalizedPhone", "independenceStatus", "status", "createdAt", "updatedAt")
      VALUES (?, ?, ?, ?, 'INDEPENDENT', 'RESEARCH_ONLY', ?, ?)`)
      .run(FIXTURE_BUSINESS_ID, "Tri-City Roofing Fixture", "roofing.axiomfixtures.ca", "+15195550123", sourceCapturedAt, sourceCapturedAt);
    database.prepare(`INSERT INTO "RevenueLocation"
      ("id", "businessId", "addressLine", "city", "region", "country", "postalCode", "geoCell", "createdAt")
      VALUES (?, ?, ?, 'KITCHENER', 'ON', 'CA', 'N2G 1A1', 'kw:kitchener:fixture', ?)`)
      .run("location:owner-acceptance", FIXTURE_BUSINESS_ID, "100 King Street West", sourceCapturedAt);
    database.prepare(`INSERT INTO "RevenueSourceRun"
      ("id", "adapter", "niche", "city", "region", "country", "geoCell", "queryText", "filtersJson", "status", "resultCount", "duplicateCount", "qualifiedCount", "costUsd", "startedAt", "completedAt", "cooldownUntil", "createdAt")
      VALUES (?, 'OWNER_UI_FIXTURE', 'ROOFING', 'KITCHENER', 'ON', 'CA', 'kw:kitchener:fixture', 'synthetic owner acceptance fixture', '{}', 'COMPLETED', 1, 0, 0, 0, ?, ?, ?, ?)`)
      .run("source-run:owner-acceptance", sourceCapturedAt, sourceCapturedAt, fixtureTimestamp(90 * 24 * 60 * 60 * 1_000), sourceCapturedAt);
    database.prepare(`INSERT INTO "RevenueSourceRecord"
      ("id", "sourceRunId", "sourceOwnedId", "businessId", "rawPayloadJson", "identitySignalsJson", "capturedAt", "createdAt")
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        "source-record:owner-acceptance",
        "source-run:owner-acceptance",
        "synthetic-owner-acceptance-roofing",
        FIXTURE_BUSINESS_ID,
        JSON.stringify({ sourceEvidenceUrl, websiteUrl, niche: "ROOFING", synthetic: true }),
        JSON.stringify({ domain: "roofing.axiomfixtures.ca", phone: "+15195550123" }),
        sourceCapturedAt,
        sourceCapturedAt,
      );
    database.prepare(`INSERT INTO "RevenueWebsiteSnapshot"
      ("id", "businessId", "url", "finalUrl", "classification", "auditVersion", "desktopArtifactRef", "mobileArtifactRef", "domArtifactRef", "deterministicChecksJson", "capturedAt", "refreshAfter", "createdAt")
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        "website:owner-acceptance",
        FIXTURE_BUSINESS_ID,
        websiteUrl,
        audit.finalUrl,
        audit.classification,
        audit.auditVersion,
        audit.desktopArtifactRef,
        audit.mobileArtifactRef,
        audit.domArtifactRef,
        JSON.stringify(audit),
        capturedAt,
        refreshAfter,
        capturedAt,
      );
    const evidenceStatement = database.prepare(`INSERT INTO "RevenueEvidenceClaim"
      ("id", "businessId", "websiteSnapshotId", "category", "observation", "sourceUrl", "artifactRef", "method", "confidence", "conversionCritical", "auditVersion", "capturedAt", "createdAt")
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    audit.claims.forEach((claim) => evidenceStatement.run(
      claim.claimId,
      FIXTURE_BUSINESS_ID,
      "website:owner-acceptance",
      claim.category,
      claim.observation,
      claim.sourceUrl,
      claim.artifactRef,
      claim.method,
      claim.confidence,
      claim.conversionCritical ? 1 : 0,
      claim.auditVersion,
      claim.capturedAt,
      claim.capturedAt,
    ));
    database.prepare(`INSERT INTO "RevenueQualificationSnapshot"
      ("id", "snapshotKey", "businessId", "policyVersion", "shadowOnly", "totalScore", "rebuildNeedScore", "businessFitScore", "reachabilityScore", "timingScore", "evidenceConfidenceScore", "band", "recommendedChannel", "supportedObservationCount", "conversionCriticalCount", "failedGatesJson", "evidenceClaimIdsJson", "createdAt")
      VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        "qualification:owner-acceptance",
        "owner-ui-acceptance:qualification:v1",
        FIXTURE_BUSINESS_ID,
        qualification.policyVersion,
        qualification.totalScore,
        qualification.scores.rebuildNeed,
        qualification.scores.businessFit,
        qualification.scores.reachability,
        qualification.scores.timing,
        qualification.scores.evidenceConfidence,
        qualification.band,
        qualification.recommendedChannel,
        qualification.supportedObservationCount,
        qualification.conversionCriticalCount,
        JSON.stringify(qualification.failedGates),
        JSON.stringify(qualification.evidenceClaimIds),
        capturedAt,
      );
  });
  insert();
  const materialization = executePrivateKwContactPersistenceForLocalDatabase(database, contactFixture);
  assert.equal(materialization.executionPath, "FRESH_COMMIT");
  assert.equal(materialization.insertedRows.materializationReceipts, 1);
  assert.equal(materialization.contactDiscoveryAuthorized, false);
  assert.equal(materialization.contactVerificationAuthorized, false);
  assert.equal(materialization.consentDecisionAuthorized, false);
  assert.equal(materialization.qualificationAuthorized, false);
  assert.equal(materialization.outreachAuthorized, false);
  assert.equal(materialization.sendAuthorized, false);
  assert.equal(materialization.providerOperationsAuthorized, 0);
  assert.equal(materialization.costAuthorizedUsd, 0);
  const persistedReceipt = database.prepare(`
    SELECT "id", "businessId", "discoveryReceiptId", "consentRows",
      "outreachAuthorized", "sendAuthorized", "providerOperationsAuthorized", "costAuthorizedUsd"
    FROM "RevenuePrivateKwContactPersistenceReceipt"
    WHERE "id" = ?
  `).get(materialization.materializationId) as Record<string, unknown> | undefined;
  assert.deepEqual(persistedReceipt, {
    id: materialization.materializationId,
    businessId: FIXTURE_BUSINESS_ID,
    discoveryReceiptId: materialization.discoveryResultId,
    consentRows: 0,
    outreachAuthorized: 0,
    sendAuthorized: 0,
    providerOperationsAuthorized: 0,
    costAuthorizedUsd: 0,
  });
  const replay = executePrivateKwContactPersistenceForLocalDatabase(database, contactFixture);
  assert.equal(replay.executionPath, "EXACT_REPLAY");
  assert.deepEqual(replay.insertedRows, {
    contact: 0,
    verification: 0,
    materializationReceipts: 0,
  });
}

function startNextServer(baseUrl: string, databasePath: string, logLines: string[], m2RunPath: string) {
  const port = new URL(baseUrl).port;
  const nextBinary = join(REPOSITORY_ROOT, "node_modules", "next", "dist", "bin", "next");
  const childEnvironment: Record<string, string | undefined> = {};
  for (const key of [
    "APPDATA",
    "CI",
    "HOME",
    "LOCALAPPDATA",
    "NODE_OPTIONS",
    "PATH",
    "Path",
    "PATHEXT",
    "SystemRoot",
    "TEMP",
    "TMP",
    "TMPDIR",
    "USERPROFILE",
    "WINDIR",
  ]) {
    if (process.env[key] !== undefined) childEnvironment[key] = process.env[key];
  }
  Object.assign(childEnvironment, {
    APP_BASE_URL: baseUrl,
    AGENT_SHARED_SECRET: "",
    AUTH_ALLOWED_EMAILS: FIXTURE_EMAIL,
    AUTH_ADMIN_EMAILS: FIXTURE_EMAIL,
    AXIOM_LOCAL_SYNTHETIC_SIGNUP: "1",
    AXIOM_M2_LOCAL_REVIEW_ENABLED: "1",
    AXIOM_M2_LOCAL_REVIEW_RUN: m2RunPath,
    AUTH_ALLOWED_ORIGINS: baseUrl,
    AUTONOMOUS_INTAKE_ENABLED: "false",
    AUTONOMOUS_QUEUE_ENABLED: "false",
    AUTONOMOUS_SEND_ENABLED: "false",
    AUTONOMOUS_DAILY_LEAD_INTAKE_CAP: "0",
    AUTONOMOUS_MAX_SENDS_PER_DAY: "0",
    AUTONOMOUS_MAX_FOLLOW_UP_SENDS_PER_DAY: "0",
    CLOUD_SCRAPE_ENABLED: "false",
    CLOUD_SCRAPE_DETAIL_PAGES_ENABLED: "false",
    BETTER_AUTH_SECRET: TEST_AUTH_SECRET,
    DATABASE_PATH: databasePath,
    DEEPSEEK_API_KEY: "",
    GMAIL_CLIENT_ID: "",
    GMAIL_CLIENT_SECRET: "",
    MCP_API_TOKEN: "",
    NEXT_TELEMETRY_DISABLED: "1",
    OPENAI_API_KEY: "",
  });
  const child = spawn(process.execPath, [nextBinary, "start", "-H", "127.0.0.1", "-p", port], {
    cwd: REPOSITORY_ROOT,
    // Generated Cloudflare globals intentionally narrow production env values.
    // This isolated child uses explicit synthetic values instead.
    env: childEnvironment as unknown as NodeJS.ProcessEnv,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  const capture = (chunk: string) => {
    const safe = chunk.replaceAll(TEST_AUTH_SECRET, "[test-secret-redacted]");
    logLines.push(...safe.split(/\r?\n/).filter(Boolean));
    if (logLines.length > 200) logLines.splice(0, logLines.length - 200);
  };
  child.stdout?.on("data", capture);
  child.stderr?.on("data", capture);
  return child;
}

async function waitForServer(baseUrl: string, child: ChildProcess) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Next.js exited before readiness with code ${child.exitCode}.`);
    try {
      const response = await fetch(`${baseUrl}/sign-in`, { redirect: "manual", signal: AbortSignal.timeout(2_000) });
      if (response.status < 500) return;
    } catch {
      // The local server is still compiling or binding its loopback socket.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  throw new Error("Next.js did not become ready within 90 seconds.");
}

async function stopServer(child: ChildProcess | null) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise<void>((resolveExit) => child.once("exit", () => resolveExit())),
    new Promise<void>((resolveWait) => setTimeout(resolveWait, 5_000)),
  ]);
  if (child.exitCode === null) {
    child.kill("SIGKILL");
    await Promise.race([
      new Promise<void>((resolveExit) => child.once("exit", () => resolveExit())),
      new Promise<void>((resolveWait) => setTimeout(resolveWait, 2_000)),
    ]);
  }
}

async function authenticate(context: BrowserContext, baseUrl: string) {
  const response = await context.request.post(`${baseUrl}/api/auth/sign-up/email`, {
    data: { name: "Owner Acceptance", email: FIXTURE_EMAIL, password: FIXTURE_PASSWORD },
    headers: { origin: baseUrl },
  });
  const body = await response.text();
  assert.equal(response.ok(), true, `Fixture sign-up failed (${response.status()}): ${body.slice(0, 300)}`);
  // The signup hook promotes the stored owner after the initial session was
  // created. Sign in again so the fixture tests a current admin session.
  await context.clearCookies();
  const signIn = await context.request.post(`${baseUrl}/api/auth/sign-in/email`, {
    data: { email: FIXTURE_EMAIL, password: FIXTURE_PASSWORD },
    headers: { origin: baseUrl },
  });
  assert.equal(signIn.ok(), true, `Fixture sign-in failed (${signIn.status()}).`);
  const signedIn = await signIn.json() as { user?: { role?: string } };
  assert.equal(signedIn.user?.role, "admin", "Owner acceptance requires the freshly promoted admin role.");
  const cookies = await context.cookies(baseUrl);
  assert(cookies.some((cookie) => cookie.name.includes("session")), "Fixture authentication did not set a session cookie.");
}

async function waitForOwnerContent(page: Page) {
  await page.locator("[data-owner-content]").waitFor({ state: "visible" });
  await page.evaluate(async () => {
    if (document.fonts?.ready) await document.fonts.ready;
  });
}

async function axeViolations(page: Page) {
  await page.addScriptTag({ path: AXE_PATH });
  return page.evaluate(async () => {
    type AxeResult = { violations: AxeViolation[] };
    type AxeRuntime = { run: (root: Document, options: unknown) => Promise<AxeResult> };
    const runtime = (globalThis as typeof globalThis & { axe: AxeRuntime }).axe;
    const result = await runtime.run(document, {
      runOnly: {
        type: "tag",
        values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"],
      },
      resultTypes: ["violations"],
    });
    return result.violations;
  });
}

function summarizeViolations(label: string, violations: AxeViolation[]) {
  return violations.map((violation) => {
    const nodes = violation.nodes.slice(0, 3).map((node) =>
      `${node.target.join(" ")} :: ${node.failureSummary ?? node.html}`,
    ).join(" | ");
    return `${label} ${violation.id} (${violation.impact ?? "unknown"}): ${violation.help} :: ${nodes}`;
  }).join("\n");
}

async function assertWcag(page: Page, label: string) {
  const violations = await axeViolations(page);
  assert.equal(violations.length, 0, summarizeViolations(label, violations));
}

async function layoutWidth(page: Page) {
  return page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
}

async function assertResponsive(page: Page, label: string) {
  const width = await layoutWidth(page);
  assert(width.scrollWidth <= width.clientWidth + 1, `${label} overflows horizontally: ${JSON.stringify(width)}`);
  const controls = await page.locator("[data-owner-content] a[href], [data-owner-content] button").evaluateAll((elements) =>
    elements.filter((element) => {
      // Closed disclosure content has a measurable layout box in Chromium but
      // is not a pointer target until its summary is opened.
      if (element.closest("details:not([open])")) return false;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
    }).map((element) => {
      const rect = element.getBoundingClientRect();
      return { text: element.getAttribute("aria-label") ?? element.textContent?.trim() ?? "", width: rect.width, height: rect.height };
    }),
  );
  const tooSmall = controls.filter((control) => control.width < 24 || control.height < 24);
  assert.deepEqual(tooSmall, [], `${label} has pointer targets smaller than 24 CSS pixels.`);
  return width.clientWidth;
}

async function assertReadOnlyOwnerSurface(page: Page, label: string, scopeSelector = "[data-owner-content]") {
  const scope = page.locator(scopeSelector);
  assert.equal(await scope.count(), 1, `${label} must expose exactly one read-only content scope (${scopeSelector}).`);
  const unsafe = await scope.locator("button, form, a[href^='mailto:'], a[href^='tel:']").count();
  assert.equal(unsafe, 0, `${label} unexpectedly exposes a mutation or direct-contact control.`);
  assert.equal(await page.locator("main#main-content").count(), 1, `${label} must have one main landmark.`);
  assert.equal(await page.locator("h1").count(), 1, `${label} must have one primary heading.`);
}

function torontoDateTimeInput(daysAhead = 7) {
  const date = new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1_000);
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date).map(({ type, value }) => [type, value]));
  return `${parts.year}-${parts.month}-${parts.day}T12:00`;
}

async function assertReducedMotion(page: Page, label: string) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const violations = await page.locator("[data-owner-content] *, .v2-sidebar *, .v2-header *, nav[aria-label='Primary'] *").evaluateAll((elements) => elements.flatMap((element) => {
    const style = getComputedStyle(element);
    const durations = `${style.animationDuration},${style.transitionDuration}`
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    const moving = durations.filter((value) => {
      const milliseconds = value.endsWith("ms")
        ? Number.parseFloat(value.slice(0, -2))
        : value.endsWith("s")
          ? Number.parseFloat(value.slice(0, -1)) * 1_000
          : Number.NaN;
      return Number.isFinite(milliseconds) && milliseconds > 0.011;
    });
    return moving.length > 0 ? [{ tag: element.tagName, className: element.className, durations: moving }] : [];
  }));
  assert.deepEqual(violations, [], `${label} retains motion when reduced motion is requested.`);
  const scrollBehavior = await page.locator("html").evaluate((element) => getComputedStyle(element).scrollBehavior);
  assert.notEqual(scrollBehavior, "smooth", `${label} retains smooth scrolling under reduced motion.`);
}

async function assertKeyboardFlow(page: Page) {
  // Start from a fresh document: the preceding disclosure click leaves the
  // browser's sequential focus position inside the legacy panel.
  await page.reload({ waitUntil: "domcontentloaded" });
  // Next may still be streaming the loading skeleton after DOMContentLoaded.
  // Wait for the actual owner page before focusing its disclosure.
  await page.getByRole("heading", { name: "Assessed businesses", exact: true }).waitFor({ state: "visible" });
  await assertNoProposedBusinessReviewPrompt(page, "Keyboard Businesses page");
  await page.waitForLoadState("networkidle");
  await page.waitForFunction(() => document.body !== null);
  await page.evaluate(() => document.body.focus());
  await page.keyboard.press("Tab");
  const firstFocus = await page.evaluate(() => ({
    text: document.activeElement?.textContent?.trim(),
    visible: document.activeElement instanceof HTMLElement
      ? document.activeElement.getBoundingClientRect().width > 0 && document.activeElement.getBoundingClientRect().height > 0
      : false,
  }));
  assert.equal(firstFocus.text, "Skip to main content", "The skip link must be the first keyboard stop.");
  assert.equal(firstFocus.visible, true, "The skip link must become visible when focused.");
  await page.keyboard.press("Enter");
  assert.equal(await page.evaluate(() => document.activeElement?.id), "main-content", "The skip link must move focus to the main landmark.");

  const legacySummary = page.locator("summary:visible").filter({ hasText: "How business records are assessed" }).first();
  await legacySummary.focus();
  await page.keyboard.press("Enter");
  assert.equal(await legacySummary.evaluate((element) => element.parentElement?.hasAttribute("open")), true,
    "The legacy lead preview must open from the keyboard.");

  let foundDossierLink = false;
  for (let step = 0; step < 40; step += 1) {
    await page.keyboard.press("Tab");
    const focused = await page.evaluate(() => ({
      label: document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.textContent?.trim() ?? "",
      href: document.activeElement instanceof HTMLAnchorElement ? document.activeElement.getAttribute("href") : null,
      outline: document.activeElement instanceof HTMLElement ? getComputedStyle(document.activeElement).outlineStyle : "none",
      boxShadow: document.activeElement instanceof HTMLElement ? getComputedStyle(document.activeElement).boxShadow : "none",
    }));
    if (focused.label.includes("Open evidence dossier")) {
      assert.match(focused.href ?? "", /^\/leads\//);
      assert(focused.outline !== "none" || focused.boxShadow !== "none", "The dossier link needs a visible keyboard focus indicator.");
      foundDossierLink = true;
      break;
    }
  }
  assert.equal(foundDossierLink, true, "The evidence dossier must be reachable within 40 Tab presses.");
}

async function openLegacyLeadPreview(page: Page) {
  await page.waitForLoadState("networkidle");
  const summary = page.locator("summary:visible").filter({ hasText: "How business records are assessed" }).first();
  await summary.click();
  await page.getByRole("list", { name: "Legacy scored businesses" }).waitFor();
}

async function assertMobileNavigationClear(page: Page) {
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.locator("[data-owner-content] [role='note']").last().waitFor({ state: "visible" });
  const geometry = await page.evaluate(() => {
    const note = document.querySelector("[data-owner-content] [role='note']:last-of-type")?.getBoundingClientRect();
    const navigation = document.querySelector("nav[aria-label='Primary']")?.getBoundingClientRect();
    return note && navigation ? { noteBottom: note.bottom, navigationTop: navigation.top } : null;
  });
  assert(geometry, "The mobile dossier must expose its final safety note and primary navigation.");
  assert(geometry.noteBottom <= geometry.navigationTop + 1, `The mobile navigation obscures the dossier safety note: ${JSON.stringify(geometry)}`);
}

async function openMobileDossier(page: Page) {
  const link = page.getByRole("link", { name: /Open evidence dossier/i }).first();
  await link.evaluate((element) => element.scrollIntoView({ block: "center", inline: "nearest" }));
  const stableRectangle = await link.evaluate(async (element) => {
    let previous: DOMRect | null = null;
    let stableFrames = 0;
    for (let frame = 0; frame < 120; frame += 1) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const current = element.getBoundingClientRect();
      const unchanged = previous
        && Math.abs(current.left - previous.left) < 0.25
        && Math.abs(current.top - previous.top) < 0.25
        && Math.abs(current.width - previous.width) < 0.25
        && Math.abs(current.height - previous.height) < 0.25;
      stableFrames = unchanged ? stableFrames + 1 : 0;
      previous = current;
      if (stableFrames >= 5) {
        return {
          left: current.left,
          top: current.top,
          width: current.width,
          height: current.height,
        };
      }
    }
    throw new Error("The mobile dossier action did not reach a stable pointer rectangle.");
  });
  const geometry = await page.evaluate(() => {
    const dossierLink = [...document.querySelectorAll("a")].find((element) =>
      element.textContent?.includes("Open evidence dossier"),
    )?.getBoundingClientRect();
    const navigation = document.querySelector("nav[aria-label='Primary']")?.getBoundingClientRect();
    return dossierLink && navigation ? {
      linkTop: dossierLink.top,
      linkBottom: dossierLink.bottom,
      navigationTop: navigation.top,
    } : null;
  });
  assert(geometry, "The mobile lead must expose its dossier action and primary navigation.");
  assert(
    geometry.linkBottom <= geometry.navigationTop + 1,
    `The mobile navigation obscures the dossier action: ${JSON.stringify(geometry)}`,
  );
  assert(geometry.linkTop >= 0, `The mobile dossier action is above the visible viewport: ${JSON.stringify(geometry)}`);
  assert.equal(await link.getAttribute("href"), `/leads/${FIXTURE_BUSINESS_ID}`);
  const pointerTarget = await link.evaluate((element) => {
    const rectangle = element.getBoundingClientRect();
    const targetX = rectangle.left + rectangle.width / 2;
    const targetY = rectangle.top + rectangle.height / 2;
    const hit = document.elementFromPoint(
      targetX,
      targetY,
    );
    return {
      targetX,
      targetY,
      hitTag: hit?.tagName ?? null,
      hitText: hit?.textContent?.trim() ?? null,
      ownedByLink: hit === element || element.contains(hit) || hit?.closest("a") === element,
    };
  });
  const clickRectangle = await link.evaluate((element) => {
    const rectangle = element.getBoundingClientRect();
    return {
      left: rectangle.left,
      top: rectangle.top,
      width: rectangle.width,
      height: rectangle.height,
    };
  });
  assert(
    Math.abs(stableRectangle.left - clickRectangle.left) < 0.25
      && Math.abs(stableRectangle.top - clickRectangle.top) < 0.25
      && Math.abs(stableRectangle.width - clickRectangle.width) < 0.25
      && Math.abs(stableRectangle.height - clickRectangle.height) < 0.25,
    `The mobile dossier action moved after its stable pointer rectangle was proven: ${JSON.stringify({ stableRectangle, clickRectangle })}`,
  );
  assert(pointerTarget.ownedByLink, `The mobile dossier link does not own its pointer target: ${JSON.stringify(pointerTarget)}`);
  await Promise.all([
    page.waitForURL(new RegExp(`/leads/${FIXTURE_BUSINESS_ID}$`)),
    page.mouse.click(pointerTarget.targetX, pointerTarget.targetY),
  ]);
}

export async function warmOwnerAcceptanceRoutes(page: Page, extraRoutes: string[] = []) {
  // The first streamed SSR response can load layout.js while Next's on-demand
  // client compilation is rewriting it. Finish route preparation without any
  // browser reading scripts, then load those scripts before the next navigation.
  for (const route of ["/leads", `/leads/${FIXTURE_BUSINESS_ID}`, "/leads/evaluation", ...extraRoutes]) {
    const response = await page.context().request.get(route);
    try {
      assert.equal(response.status(), 200, `Owner route preparation failed: ${route}`);
      await response.body();
    } finally {
      await response.dispose();
    }
  }
  // SSR headings precede async script completion. Starting the next compilation
  // can rewrite a shared dev chunk while the previous response is still reading it.
  await page.goto("/leads", { waitUntil: "load" });
  await page.getByRole("heading", { level: 1, name: "Businesses" }).waitFor();
  await page.goto(`/leads/${FIXTURE_BUSINESS_ID}`, { waitUntil: "load" });
  await page.getByRole("heading", { level: 1, name: "Tri-City Roofing Fixture" }).waitFor();
  await page.goto("/leads/evaluation", { waitUntil: "load" });
  await page.getByRole("heading", { level: 1, name: "Quality Lab" }).waitFor();
  await page.locator("[data-quality-lab-ready='true']:visible").waitFor();
  for (const route of extraRoutes) await page.goto(route, { waitUntil: "load" });
}

async function assertBusinessStopRoutesBlocked(page: Page) {
  const routes = page.locator('section[aria-labelledby="reachable-routes"] ul > li');
  const routeCount = await routes.count();
  assert(routeCount >= 3, "The synthetic dossier must keep its email, phone, and form routes visible for stop verification.");
  for (let index = 0; index < routeCount; index += 1) {
    assert.equal(await routes.nth(index).getByText("Blocked", { exact: true }).count(), 1,
      `Recorded route ${index + 1} must be visibly blocked by the owner stop.`);
  }
}

async function assertM2Review(page: Page, fixture: Awaited<ReturnType<typeof createM2OwnerConsoleFixture>>, label: string) {
  await page.getByRole("heading", { level: 1, name: "Business review" }).waitFor();
  await assertOwnerPageTitle(page, "Business Review | Axiom Revenue Engine");
  const businesses = page.getByRole("list", { name: "Businesses to review", exact: true }).locator(":scope > li");
  assert.equal(await businesses.count(), 10, `${label} must account for all ten businesses.`);
  const expected = ["Website captured", "More research needed", "Review stopped", "Review stopped", "Website captured",
    "More research needed", "Website captured", "Website captured", "Website captured", "More research needed"];
  for (const [index, business] of fixture.selected.entries()) {
    const entry = businesses.nth(index);
    await entry.getByRole("button", { name: `Open ${business.businessName} review` }).waitFor();
    await entry.getByText(expected[index]!, { exact: true }).waitFor();
  }
  const mobile = (page.viewportSize()?.width ?? 1440) < 768;
  if (mobile) {
    const filterGroup = page.getByRole("group", { name: "Filter businesses" });
    const filterLayout = await filterGroup.evaluate((group) => {
      const buttons = [...group.querySelectorAll("button")].map((button) => button.getBoundingClientRect());
      return {
        clientWidth: group.clientWidth,
        scrollWidth: group.scrollWidth,
        buttonTops: buttons.map((rect) => rect.top),
      };
    });
    assert.equal(new Set(filterLayout.buttonTops).size, 2,
      `${label} mobile filters must fit in two visible rows: ${JSON.stringify(filterLayout)}`);
    assert(filterLayout.scrollWidth <= filterLayout.clientWidth + 1,
      `${label} mobile filters must fit without horizontal scrolling: ${JSON.stringify(filterLayout)}`);
    await filterGroup.getByRole("button", { name: "Stopped 2" }).click();
    assert.equal(await page.getByRole("list", { name: "Businesses to review", exact: true }).locator(":scope > li").count(), 2,
      `${label} must apply the stopped filter.`);
    await filterGroup.getByRole("button", { name: "All 10" }).click();
    assert.equal(await page.getByRole("list", { name: "Businesses to review", exact: true }).locator(":scope > li").count(), 10,
      `${label} must restore all businesses from the first filter.`);
  }
  const firstDetail = page.getByRole("region", { name: `${fixture.selected[0]!.businessName} website review` });
  if (mobile) assert.equal(await firstDetail.isVisible(), false, `${label} must open a business before showing its dossier.`);
  else await firstDetail.waitFor();
  await businesses.nth(4).getByRole("button", { name: `Open ${fixture.selected[4]!.businessName} review` }).click();
  const derivedDetail = page.getByRole("region", { name: `${fixture.selected[4]!.businessName} website review` });
  await derivedDetail.waitFor();
  assert.equal(await page.getByRole("region", { name: /website review$/ }).count(), 1, `${label} must render only the selected dossier.`);
  await derivedDetail.getByText("Pages and source links").click();
  const pageClues = derivedDetail.getByText(/Page clues: Page title/).first();
  await pageClues.waitFor();
  await pageClues.click();
  await derivedDetail.getByText(/Page title: found · Search description: not found/).first().waitFor();
  await derivedDetail.getByText(/Links to other pages:.*service.*about.*contact/).first().waitFor();
  await pageClues.click();
  await derivedDetail.getByText(/Website fit, mobile experience, and contact readiness are not assessed here/).waitFor();
  await derivedDetail.getByText("No outreach is authorized from this review. No message or call can be sent here.").waitFor();
  assert.equal(await derivedDetail.getByRole("link", { name: "Open business website" }).count(), 1);
  if (mobile) {
    assert.equal(await page.getByRole("list", { name: "Businesses to review", exact: true }).isVisible(), false);
    await assertWcag(page, `${label} selected detail`);
    await derivedDetail.getByRole("button", { name: "Back to businesses" }).click();
    await page.getByRole("list", { name: "Businesses to review", exact: true }).waitFor();
    assert.equal(await businesses.nth(4).getByRole("button").getAttribute("aria-pressed"), "true");
  }
  assert.equal(await page.locator("[data-owner-content] input[type='file'], [data-owner-content] form").count(), 0);
  assert.equal(await page.locator("[data-owner-content] form, [data-owner-content] button[type='submit'], [data-owner-content] a[href^='mailto:'], [data-owner-content] a[href^='tel:']").count(), 0,
    `${label} must not expose a send, contact, or submission control.`);
  assert.equal(await page.locator("main#main-content").count(), 1);
  assert.equal(await page.locator("h1").count(), 1);
  await assertResponsive(page, label);
  await assertReducedMotion(page, label);
  await assertWcag(page, label);
}

async function assertM2MobileNavigationClear(page: Page, titleSelector: string, finalSelector: string, label: string) {
  await page.evaluate(() => window.scrollTo(0, 0));
  const top = await page.evaluate((selector) => {
    const header = document.querySelector("header.owner-topbar")?.getBoundingClientRect();
    const title = document.querySelector(selector)?.getBoundingClientRect();
    return header && title ? { headerBottom: header.bottom, titleTop: title.top } : null;
  }, titleSelector);
  assert(top && top.headerBottom <= top.titleTop + 1, `${label} top navigation obscures the title: ${JSON.stringify(top)}`);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const bottom = await page.evaluate((selector) => {
    const finalElement = document.querySelector(selector)?.getBoundingClientRect();
    const navigation = document.querySelector("nav[aria-label='Primary']")?.getBoundingClientRect();
    return finalElement && navigation ? { contentBottom: finalElement.bottom, navigationTop: navigation.top } : null;
  }, finalSelector);
  assert(bottom && bottom.contentBottom <= bottom.navigationTop + 1, `${label} bottom navigation obscures the final content: ${JSON.stringify(bottom)}`);
  await page.evaluate(() => window.scrollTo(0, 0));
}

async function runBrowserAcceptance(baseUrl: string, outputDirectory: string, m2Fixture: Awaited<ReturnType<typeof createM2OwnerConsoleFixture>>) {
  let browser: Browser | null = null;
  let page: Page | null = null;
  let warmupPage: Page | null = null;
  const externalRequests: string[] = [];
  const diagnostics: BrowserDiagnostic[] = [];
  const drainScriptDiagnostics: Array<() => Promise<void>> = [];
  const ownerLabelingPacket = buildCompleteOwnerLabelingPacketFixture();
  const ownerLabelingSplit = splitOwnerLabelingPacket(ownerLabelingPacket);
  const firstEvaluationBusiness = ownerLabelingPacket.entries[0]!.businessName;
  let stage = "startup";
  try {
    browser = await chromium.launch({ headless: true });
    await verifyOwnerWarmupStreaming(browser, warmOwnerAcceptanceRoutes);
    const context = await browser.newContext({
      baseURL: baseUrl,
      colorScheme: "dark",
      reducedMotion: "reduce",
      serviceWorkers: "block",
      viewport: { width: 1440, height: 1_000 },
    });
    await context.route("**/*", async (route) => {
      const requestUrl = route.request().url();
      if (isAllowedOwnerAcceptanceUrl(requestUrl, baseUrl)) await route.continue();
      else {
        externalRequests.push(requestUrl);
        await route.abort("blockedbyclient");
      }
    });
    await authenticate(context, baseUrl);

    // Warm immutable production assets before the measured run. The separate
    // streaming regression still exercises development route-preparation order.
    stage = "owner route warmup";
    warmupPage = await context.newPage();
    attachBrowserDiagnostics(warmupPage, () => stage, diagnostics, baseUrl);
    drainScriptDiagnostics.push(await attachBrowserScriptDiagnostics(context, warmupPage, () => stage, diagnostics, outputDirectory));
    await warmOwnerAcceptanceRoutes(warmupPage, ["/leads/m2", "/dashboard", "/automation", "/clients", "/settings"]);
    await warmupPage.close();

    stage = "owner-action authentication gate";
    const anonymous = await browser.newContext({ baseURL: baseUrl, serviceWorkers: "block" });
    await anonymous.route("**/*", async (route) => {
      const url = route.request().url();
      if (isAllowedOwnerAcceptanceUrl(url, baseUrl)) await route.continue();
      else { externalRequests.push(url); await route.abort("blockedbyclient"); }
    });
    const taskApiPath = `/api/v1/leads/${encodeURIComponent(FIXTURE_BUSINESS_ID)}/tasks`;
    const stopApiPath = `/api/v1/leads/${encodeURIComponent(FIXTURE_BUSINESS_ID)}/stops`;
    const replyApiPath = `/api/v1/leads/${encodeURIComponent(FIXTURE_BUSINESS_ID)}/replies`;
    const anonymousRepliesResponse = await anonymous.request.get(replyApiPath, { maxRedirects: 0 });
    assert.equal(anonymousRepliesResponse.status(), 401, "Anonymous reply listing must be rejected.");
    await anonymousRepliesResponse.dispose();
    const anonymousReplyCreate = await anonymous.request.post(replyApiPath, {
      maxRedirects: 0,
      data: {
        idempotencyKey: randomUUID(), contactPointId: "unknown", category: "QUESTION",
        summary: "Unauthenticated synthetic reply probe", observedAt: new Date().toISOString(),
        owner: "RILEY", action: "Do not save", dueAt: new Date().toISOString(),
      },
    });
    assert.equal(anonymousReplyCreate.status(), 401, "Anonymous reply creation must be rejected.");
    await anonymousReplyCreate.dispose();
    const anonymousTasksResponse = await anonymous.request.get(taskApiPath, { maxRedirects: 0 });
    assert.equal(anonymousTasksResponse.status(), 401,
      `Anonymous owner-task listing must return HTTP 401, got ${anonymousTasksResponse.status()}.`);
    const anonymousTasksBody = await anonymousTasksResponse.text();
    assert(!anonymousTasksBody.includes("Tri-City Roofing Fixture") && !anonymousTasksBody.includes("owner-acceptance"),
      "Anonymous owner-task listing exposed fixture business data.");
    await anonymousTasksResponse.dispose();
    const anonymousCreateResponse = await anonymous.request.post(taskApiPath, {
      maxRedirects: 0,
      data: {
        operation: "CREATE",
        idempotencyKey: randomUUID(),
        owner: "RILEY",
        action: "Unauthenticated owner-task acceptance probe",
        dueAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000).toISOString(),
      },
    });
    assert.equal(anonymousCreateResponse.status(), 401,
      `Anonymous owner-task creation must return HTTP 401, got ${anonymousCreateResponse.status()}.`);
    await anonymousCreateResponse.dispose();

    const anonymousStopResponse = await anonymous.request.get(stopApiPath, { maxRedirects: 0 });
    assert.equal(anonymousStopResponse.status(), 401,
      `Anonymous business-stop read must return HTTP 401, got ${anonymousStopResponse.status()}.`);
    await anonymousStopResponse.dispose();
    const anonymousStopCreateResponse = await anonymous.request.post(stopApiPath, {
      maxRedirects: 0,
      data: { idempotencyKey: randomUUID(), reason: "OWNER_DECISION", note: "Unauthenticated stop acceptance probe." },
    });
    assert.equal(anonymousStopCreateResponse.status(), 401,
      `Anonymous business-stop creation must return HTTP 401, got ${anonymousStopCreateResponse.status()}.`);
    await anonymousStopCreateResponse.dispose();

    stage = "M2 authentication gate";
    const anonymousPage = await anonymous.newPage();
    const anonymousErrors: string[] = [];
    anonymousPage.on("pageerror", (error) => anonymousErrors.push(error.message));
    // Next's streaming redirect can have HTTP 200 with a client redirect marker.
    // Verify the actual destination and absence of data, not a non-streaming status.
    const anonymousResponse = await anonymous.request.get("/leads/m2", { maxRedirects: 0 });
    const anonymousBody = await anonymousResponse.text();
    for (const business of m2Fixture.selected) assert(!anonymousBody.includes(business.businessName), "Unauthenticated M2 response exposed a business.");
    await anonymousResponse.dispose();
    await anonymousPage.goto("/leads/m2", { waitUntil: "load" });
    await anonymousPage.waitForURL("**/sign-in");
    assert.equal(await anonymousPage.getByRole("list", { name: "Businesses to review", exact: true }).count(), 0);
    assert.deepEqual(anonymousErrors, [], "Unauthenticated redirect raised a script error.");
    await anonymous.close();

    stage = "owner-action same-origin gate";
    const authenticatedTasks = await context.request.get(taskApiPath);
    assert.equal(authenticatedTasks.status(), 200, "An authenticated owner must be able to read saved tasks.");
    await authenticatedTasks.dispose();
    const crossSiteCreate = await context.request.post(taskApiPath, {
      headers: { Origin: "https://untrusted.example.invalid" },
      data: {
        operation: "CREATE", idempotencyKey: randomUUID(), owner: "RILEY",
        action: "Cross-site request must not create a task", dueAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000).toISOString(),
      },
    });
    assert.equal(crossSiteCreate.status(), 403, "An authenticated cross-site task mutation must be rejected.");
    assert.equal((await crossSiteCreate.json() as { code?: string }).code, "ORIGIN_REJECTED");
    await crossSiteCreate.dispose();
    const crossSiteReplyCreate = await context.request.post(replyApiPath, {
      headers: { Origin: "https://untrusted.example.invalid" },
      data: {
        idempotencyKey: randomUUID(), contactPointId: "unknown", category: "QUESTION",
        summary: "Cross-site reply must not save", observedAt: new Date().toISOString(),
        owner: "RILEY", action: "Do not save", dueAt: new Date().toISOString(),
      },
    });
    assert.equal(crossSiteReplyCreate.status(), 403, "An authenticated cross-site reply mutation must be rejected.");
    await crossSiteReplyCreate.dispose();
    const crossSiteStopCreate = await context.request.post(stopApiPath, {
      headers: { Origin: "https://untrusted.example.invalid" },
      data: { idempotencyKey: randomUUID(), reason: "OWNER_DECISION", note: "Cross-site stop mutation must be rejected." },
    });
    assert.equal(crossSiteStopCreate.status(), 403, "An authenticated cross-site business-stop mutation must be rejected.");
    assert.equal((await crossSiteStopCreate.json() as { code?: string }).code, "ORIGIN_REJECTED");
    await crossSiteStopCreate.dispose();
    const initialStopResponse = await context.request.get(stopApiPath);
    assert.equal(initialStopResponse.status(), 200, "An authenticated owner must be able to read saved business-stop state.");
    assert.deepEqual(await initialStopResponse.json(), { stop: null }, "The fresh synthetic business must start with no owner stop.");
    await initialStopResponse.dispose();

    page = await context.newPage();
    attachBrowserDiagnostics(page, () => stage, diagnostics, baseUrl);
    drainScriptDiagnostics.push(await attachBrowserScriptDiagnostics(context, page, () => stage, diagnostics, outputDirectory));

    stage = "desktop leads";
    const listStart = performance.now();
    await page.goto("/leads", { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { level: 1, name: "Businesses" }).waitFor();
    await page.getByRole("heading", { name: "Assessed businesses", exact: true }).waitFor();
    await assertNoProposedBusinessReviewPrompt(page, "Desktop Businesses");
    await page.screenshot({ path: join(outputDirectory, "leads-desktop.png"), fullPage: true });
    await openLegacyLeadPreview(page);
    await page.getByRole("link", { name: /Open evidence dossier/i }).first().waitFor();
    const desktopListReadyMs = Math.round(performance.now() - listStart);
    assert(desktopListReadyMs <= OWNER_LIST_BUDGET_MS, `The next owner lead was not discoverable within ${OWNER_LIST_BUDGET_MS} ms.`);
    await assertOwnerPageTitle(page, "Businesses | Axiom Revenue Engine");
    await assertWcag(page, "desktop leads");
    await assertReadOnlyOwnerSurface(page, "desktop leads");
    const desktopWidth = await assertResponsive(page, "desktop leads");
    await assertReducedMotion(page, "desktop leads");
    await assertKeyboardFlow(page);

    stage = "desktop dossier";
    const dossierStart = performance.now();
    await page.keyboard.press("Enter");
    await page.getByRole("heading", { level: 1, name: "Tri-City Roofing Fixture" }).waitFor();
    await page.locator("section[aria-labelledby='owner-next-step']").getByText("Next action", { exact: true }).waitFor();
    await page.getByText(/Website finding/).first().waitFor();
    await page.getByRole("heading", { level: 2, name: "Do not contact" }).waitFor();
    await page.getByRole("heading", { level: 2, name: "Owner tasks" }).waitFor();
    const researchDetails = page.locator("details").filter({ has: page.getByText("Research details", { exact: true }) }).first();
    await researchDetails.locator(":scope > summary").waitFor();
    assert.equal(await researchDetails.getAttribute("open"), null, "Technical research should start closed behind the owner controls.");
    await researchDetails.locator(":scope > summary").click();
    await page.getByRole("heading", { level: 2, name: "Why the old score flagged this business" }).waitFor();
    await page.getByRole("heading", { level: 2, name: "Contact review not recorded" }).waitFor();
    const recordedRoutes = page.locator("section[aria-labelledby='reachable-routes']");
    await recordedRoutes.getByText("+15195550123", { exact: true }).waitFor();
    await recordedRoutes.getByText("https://roofing.axiomfixtures.ca/contact", { exact: true }).waitFor();
    await recordedRoutes.getByText("hello@roofing.axiomfixtures.ca", { exact: true }).waitFor();
    const desktopDossierReadyMs = Math.round(performance.now() - dossierStart);
    assert(desktopDossierReadyMs <= OWNER_DOSSIER_BUDGET_MS, `The lead rationale was not visible within ${OWNER_DOSSIER_BUDGET_MS} ms.`);
    await assertOwnerPageTitle(page, "Business details | Axiom Revenue Engine");
    const fullAudit = researchDetails.locator("details").filter({ has: page.getByText("Full website audit and evidence details", { exact: true }) }).first();
    await fullAudit.locator("summary").waitFor();
    assert.equal(await fullAudit.getAttribute("open"), null, "The full audit should start closed so owner actions remain easy to find.");
    await fullAudit.locator("summary").click();
    await page.getByRole("heading", { level: 2, name: "Website evidence" }).waitFor();
    assert((await page.getByRole("link", { name: "Inspect proof" }).count()) >= 3, "The dossier must expose at least three inspectable observations.");
    await fullAudit.locator("summary").click();
    await researchDetails.locator(":scope > summary").click();
    await assertWcag(page, "desktop dossier");
    await assertReadOnlyOwnerSurface(page, "desktop dossier", "[data-owner-readonly-dossier] > details");
    await assertResponsive(page, "desktop dossier");
    await assertReducedMotion(page, "desktop dossier");
    await page.evaluate(() => { if (document.scrollingElement) document.scrollingElement.scrollTop = 0; });
    await page.screenshot({ path: join(outputDirectory, "dossier-desktop.png"), fullPage: true });

    stage = "desktop owner-task creation";
    await page.getByRole("heading", { level: 2, name: "Owner tasks" }).waitFor();
    await page.getByText("No saved owner tasks for this business yet.", { exact: true }).waitFor();
    const taskAction = "Review the synthetic website evidence";
    await page.getByRole("textbox", { name: "Next action" }).fill(taskAction);
    await page.getByRole("combobox", { name: "Owner" }).selectOption("RILEY");
    await page.getByLabel("Due time (Toronto)").fill(torontoDateTimeInput());
    const createKeys: string[] = [];
    const taskRoutePattern = "**/api/v1/leads/**/tasks";
    const simulateLostCreateResponse = async (route: Route) => {
      if (new URL(route.request().url()).pathname !== taskApiPath || route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      const command = JSON.parse(route.request().postData() ?? "{}") as { operation?: string; idempotencyKey?: string };
      if (command.operation !== "CREATE") {
        await route.continue();
        return;
      }
      assert.equal(typeof command.idempotencyKey, "string", "Owner task mutation needs an idempotency key.");
      createKeys.push(command.idempotencyKey!);
      if (createKeys.length === 1) {
        const accepted = await route.fetch();
        const responseBody = await accepted.json().catch(() => null) as { code?: string } | null;
        assert.equal(accepted.status(), 200,
          `The first task creation must save before its response is lost (code ${responseBody?.code ?? "none"}; request origin ${route.request().headers()["origin"] ?? "missing"}; request host ${route.request().headers()["host"] ?? "missing"}; fetch site ${route.request().headers()["sec-fetch-site"] ?? "missing"}; URL origin ${new URL(route.request().url()).origin}).`);
        await accepted.dispose();
        await route.abort("failed");
      } else {
        await route.continue();
      }
    };
    await page.route(taskRoutePattern, simulateLostCreateResponse);
    await page.getByRole("button", { name: "Save task" }).click();
    await page.locator("p[role='status']").filter({ hasText: /fetch|network|task change/i }).waitFor();
    await page.getByRole("button", { name: "Save task" }).click();
    const ownerTaskList = page.getByRole("list", { name: "Saved owner tasks" });
    const createdTaskRow = ownerTaskList.locator("li").filter({ hasText: taskAction });
    await createdTaskRow.waitFor({ state: "visible" });
    await createdTaskRow.getByText("Riley", { exact: true }).waitFor();
    await createdTaskRow.getByText("Open", { exact: true }).waitFor();
    await page.getByText("Task saved.", { exact: true }).waitFor();
    assert.equal(createKeys.length, 2, "The owner must make exactly one controlled retry after a lost response.");
    assert.equal(createKeys[1], createKeys[0], "A retry after an uncertain accepted create must reuse its idempotency key.");
    await page.unroute(taskRoutePattern, simulateLostCreateResponse);
    await assertWcag(page, "desktop owner tasks");

    stage = "desktop owner-task persistence after reload";
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { level: 2, name: "Owner tasks" }).waitFor();
    const persistedTaskRow = page.getByRole("list", { name: "Saved owner tasks" }).locator("li").filter({ hasText: taskAction });
    await persistedTaskRow.waitFor({ state: "visible" });
    assert.equal(await page.getByRole("list", { name: "Saved owner tasks" }).locator("li").count(), 1,
      "The uncertain accepted create and safe retry must persist one task only.");
    await persistedTaskRow.getByText("Riley", { exact: true }).waitFor();
    await persistedTaskRow.getByText("Open", { exact: true }).waitFor();

    stage = "desktop owner-task completion";
    await persistedTaskRow.getByRole("button", { name: `Complete task: ${taskAction}` }).click();
    await page.getByText("Task saved.", { exact: true }).waitFor();
    await persistedTaskRow.getByText("Completed", { exact: true }).waitFor();
    assert.equal(await persistedTaskRow.getByRole("button", { name: `Complete task: ${taskAction}` }).count(), 0,
      "A completed task must no longer expose the completion action.");

    stage = "desktop owner-task terminal state after reload";
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { level: 2, name: "Owner tasks" }).waitFor();
    const completedTaskRow = page.getByRole("list", { name: "Saved owner tasks" }).locator("li").filter({ hasText: taskAction });
    await completedTaskRow.waitFor({ state: "visible" });
    await completedTaskRow.getByText("Completed", { exact: true }).waitFor();
    assert.equal(await completedTaskRow.getByRole("button", { name: /^(Complete|Cancel) task:/ }).count(), 0,
      "A terminal task must not expose completion or cancellation actions after reload.");

    stage = "desktop owner-observed reply";
    const replyPanel = page.locator("section[aria-labelledby='owner-observed-reply-title']");
    await replyPanel.getByRole("heading", { name: "Observed email replies" }).waitFor();
    await replyPanel.getByRole("button", { name: "Add reply" }).click();
    assert.match(await replyPanel.getByRole("combobox", { name: "Email contact" }).locator("option:checked").textContent() ?? "",
      /hello@roofing\.axiomfixtures\.ca/, "A manually observed reply must use the exact saved email contact.");
    await replyPanel.getByRole("combobox", { name: "Reply type" }).selectOption("QUESTION");
    await replyPanel.getByLabel("When received (Toronto)").fill(torontoDateTimeInput(-2));
    await replyPanel.getByRole("textbox", { name: "Short factual summary" }).fill("Asked to discuss website timing next week.");
    const replyAction = "Call about website timing";
    await replyPanel.getByRole("textbox", { name: "Next action" }).fill(replyAction);
    await replyPanel.getByRole("combobox", { name: "Owner" }).selectOption("AIDAN");
    await replyPanel.getByLabel("Action due (Toronto)").fill(torontoDateTimeInput(-1));
    await replyPanel.getByRole("button", { name: "Save reply" }).click();
    await replyPanel.getByRole("list", { name: "Saved email replies" }).getByText("Asked to discuss website timing next week.", { exact: true }).waitFor();
    const savedReplyResponse = await context.request.get(replyApiPath);
    assert.equal(savedReplyResponse.status(), 200, "The saved reply should be readable after creation.");
    const savedReplyBody = await savedReplyResponse.json() as { replies?: Array<{ taskId?: string; status?: string; contactPointId?: string }> };
    assert.equal(savedReplyBody.replies?.length, 1, "The owner should have exactly one recorded synthetic reply.");
    assert(savedReplyBody.replies?.[0]?.taskId, "The reply must have a durable linked action.");
    assert.equal(savedReplyBody.replies?.[0]?.status, "OPEN", "A new reply action must remain open.");
    await savedReplyResponse.dispose();
    await assertWcag(page, "desktop observed email replies");

    stage = "today owner-recorded overdue reply";
    await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
    const ownerReplyAttention = page.getByRole("list", { name: "Immediate owner actions" }).locator("li").filter({ hasText: replyAction });
    await ownerReplyAttention.waitFor();
    await ownerReplyAttention.getByText(/Owner-recorded reply · Overdue/).waitFor();
    await ownerReplyAttention.getByText("Tri-City Roofing Fixture", { exact: true }).waitFor();

    stage = "observed reply persistence and completion";
    await page.goto(`/leads/${encodeURIComponent(FIXTURE_BUSINESS_ID)}`, { waitUntil: "domcontentloaded" });
    const persistedReplyPanel = page.locator("section[aria-labelledby='owner-observed-reply-title']");
    await persistedReplyPanel.getByText("Asked to discuss website timing next week.", { exact: true }).waitFor();
    const replyTaskRow = page.getByRole("list", { name: "Saved owner tasks" }).locator("li").filter({ hasText: replyAction });
    await replyTaskRow.waitFor();
    await replyTaskRow.getByText("Open", { exact: true }).waitFor();
    await replyTaskRow.getByRole("button", { name: `Complete task: ${replyAction}` }).click();
    await replyTaskRow.getByText("Completed", { exact: true }).waitFor();
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator("section[aria-labelledby='owner-observed-reply-title']").getByText(/Next: .*Completed/).waitFor();
    await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
    assert.equal(await page.locator("section[aria-labelledby='today-attention']").getByText(replyAction, { exact: false }).count(), 0,
      "Completing the linked owner task must remove the reply from Today's open queue.");
    await page.goto(`/leads/${encodeURIComponent(FIXTURE_BUSINESS_ID)}`, { waitUntil: "domcontentloaded" });

    stage = "desktop observed email stop";
    await page.getByRole("button", { name: /Review \d+ email contacts?/ }).click();
    await page.getByRole("combobox", { name: "Email contact to review" }).waitFor();
    assert.match(await page.getByRole("combobox", { name: "Email contact to review" }).locator("option:checked").textContent() ?? "", /hello@roofing\.axiomfixtures\.ca/, "The selected contact must show the exact email before a permanent stop.");
    await page.getByText("This permanently blocks hello@roofing.axiomfixtures.ca for this business.", { exact: true }).waitFor();
    await page.getByRole("combobox", { name: "Observed event" }).selectOption("UNSUBSCRIBE");
    await page.getByRole("textbox", { name: "Short observation summary" }).fill("Owner observed an unsubscribe request in the synthetic fixture.");
    await page.getByRole("checkbox", { name: /I personally observed this event/ }).check();
    await page.getByRole("button", { name: "Record do not email" }).click();
    await page.getByText("Do not email this contact", { exact: true }).waitFor();
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: /Review \d+ email contacts?/ }).click();
    await page.getByText("Do not email this contact", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Close" }).click();

    // Keep one open fixture action so the stop can prove that completion is
    // blocked and cancellation remains available.
    const openTaskAction = "Call the synthetic business";
    const openTaskResponse = await context.request.post(taskApiPath, {
      headers: { Origin: baseUrl },
      data: {
        operation: "CREATE", idempotencyKey: randomUUID(), owner: "AIDAN",
        action: openTaskAction, dueAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000).toISOString(),
      },
    });
    assert.equal(openTaskResponse.status(), 200, "The fixture needs one open task before the business stop.");
    const openTaskBody = await openTaskResponse.json() as { task?: { taskId?: string } };
    const openTaskId = openTaskBody.task?.taskId;
    assert(openTaskId, "The open fixture task needs a durable identity.");
    await openTaskResponse.dispose();

    stage = "desktop owner business stop";
    const stopNote = "Owner decision: do not contact this synthetic business.";
    const capturedStopCommands: Array<{ idempotencyKey?: string; reason?: string; note?: string }> = [];
    const captureStopCommand = (request: import("playwright").Request) => {
      if (new URL(request.url()).pathname !== stopApiPath || request.method() !== "POST") return;
      capturedStopCommands.push(JSON.parse(request.postData() ?? "{}") as { idempotencyKey?: string; reason?: string; note?: string });
    };
    page.on("request", captureStopCommand);
    await page.getByRole("heading", { level: 2, name: "Do not contact" }).waitFor();
    await page.getByLabel("Reason").selectOption("OWNER_DECISION");
    await page.getByLabel("Note").fill(stopNote);
    await page.getByRole("button", { name: "Record do not contact" }).click();
    await page.getByText("Contact stop saved and verified. The business dossier is refreshing.", { exact: true }).waitFor();
    await page.getByText("Contact stopped", { exact: true }).waitFor();
    assert.deepEqual(capturedStopCommands.map(({ reason, note }) => ({ reason, note })), [{ reason: "OWNER_DECISION", note: stopNote }],
      "The UI must submit the owner's exact selected stop reason and note once.");
    const stopIdempotencyKey = capturedStopCommands[0]?.idempotencyKey;
    assert.equal(typeof stopIdempotencyKey, "string", "The UI stop command must carry an idempotency key.");
    assert(stopIdempotencyKey, "The UI stop command must carry a non-empty idempotency key.");
    page.off("request", captureStopCommand);

    const savedStopResponse = await context.request.get(stopApiPath);
    assert.equal(savedStopResponse.status(), 200, "The authenticated owner must be able to read the saved business stop.");
    const savedStopBody = await savedStopResponse.json() as { stop?: { stopId?: string; businessId?: string; reason?: string; source?: string; note?: string } | null };
    assert.equal(savedStopBody.stop?.businessId, FIXTURE_BUSINESS_ID);
    assert.equal(savedStopBody.stop?.reason, "OWNER_DECISION");
    assert.equal(savedStopBody.stop?.source, "OWNER_ACTION");
    assert.equal(savedStopBody.stop?.note, stopNote);
    const savedStopId = savedStopBody.stop?.stopId;
    assert(savedStopId, "The authoritative saved stop must include its durable identity.");
    await savedStopResponse.dispose();

    const exactReplayResponse = await context.request.post(stopApiPath, {
      headers: { Origin: baseUrl },
      data: { idempotencyKey: stopIdempotencyKey, reason: "OWNER_DECISION", note: stopNote },
    });
    assert(exactReplayResponse.ok(), `Exact same-key stop replay must succeed (${exactReplayResponse.status()}).`);
    const replayedStopBody = await exactReplayResponse.json() as { stop?: { stopId?: string; reason?: string; note?: string } };
    assert.equal(replayedStopBody.stop?.stopId, savedStopId, "Exact replay must return the same durable stop record.");
    assert.equal(replayedStopBody.stop?.reason, "OWNER_DECISION");
    assert.equal(replayedStopBody.stop?.note, stopNote);
    await exactReplayResponse.dispose();

    stage = "desktop owner business stop after reload";
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { level: 2, name: "Do not contact" }).waitFor();
    await page.getByText("Contact stopped", { exact: true }).waitFor();
    await page.getByText("Owner decision", { exact: true }).waitFor();
    await page.getByText(stopNote, { exact: true }).waitFor();
    const stoppedResearch = page.locator("details").filter({ has: page.getByText("Research details", { exact: true }) }).first();
    await stoppedResearch.locator(":scope > summary").click();
    await page.getByRole("heading", { level: 2, name: "Every recorded route" }).waitFor();
    await page.getByText("Contact status: Do not contact", { exact: true }).waitFor();
    await assertBusinessStopRoutesBlocked(page);
    await stoppedResearch.locator(":scope > summary").click();
    const stoppedTaskRow = page.getByRole("list", { name: "Saved owner tasks" }).locator("li").filter({ hasText: openTaskAction });
    await stoppedTaskRow.waitFor({ state: "visible" });
    assert.equal(await stoppedTaskRow.getByRole("button", { name: `Complete task: ${openTaskAction}` }).count(), 0,
      "An open task must not offer completion after the business is stopped.");
    assert.equal(await page.getByRole("button", { name: "Save task" }).count(), 0,
      "A stopped business must not offer new owner tasks.");
    await stoppedTaskRow.getByRole("button", { name: `Cancel task: ${openTaskAction}` }).waitFor();

    const blockedCreate = await context.request.post(taskApiPath, {
      headers: { Origin: baseUrl },
      data: {
        operation: "CREATE", idempotencyKey: randomUUID(), owner: "RILEY",
        action: "Contact after stop must be blocked", dueAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000).toISOString(),
      },
    });
    assert.equal(blockedCreate.status(), 409, "A stop must block task creation at the API and storage boundary.");
    assert.equal((await blockedCreate.json() as { code?: string }).code, "OWNER_TASK_BUSINESS_STOPPED");
    await blockedCreate.dispose();
    const blockedComplete = await context.request.post(taskApiPath, {
      headers: { Origin: baseUrl },
      data: { operation: "COMPLETE", idempotencyKey: randomUUID(), taskId: openTaskId, note: "Must not complete after stop." },
    });
    assert.equal(blockedComplete.status(), 409, "A stop must block task completion at the API and storage boundary.");
    assert.equal((await blockedComplete.json() as { code?: string }).code, "OWNER_TASK_BUSINESS_STOPPED");
    await blockedComplete.dispose();
    await stoppedTaskRow.getByRole("button", { name: `Cancel task: ${openTaskAction}` }).click();
    await stoppedTaskRow.getByText("Cancelled", { exact: true }).waitFor();

    stage = "ranked leads owner stop";
    await page.goto("/leads", { waitUntil: "domcontentloaded" });
    await openLegacyLeadPreview(page);
    const rankedLeads = page.getByRole("list", { name: "Legacy scored businesses" });
    const stoppedLead = rankedLeads.locator("li").filter({ hasText: "Tri-City Roofing Fixture" });
    await stoppedLead.waitFor({ state: "visible" });
    assert(await stoppedLead.getByText("Blocked", { exact: true }).count() > 0,
      "The ranked lead must visibly report its durable owner stop as blocked.");

    stage = "desktop quality lab";
    await page.goto("/leads/evaluation", { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { level: 1, name: "Quality Lab" }).waitFor();
    await page.locator("[data-quality-lab-ready='true']:visible").waitFor();
    await assertOwnerPageTitle(page, "Quality Lab | Axiom Revenue Engine");
    const blindValidation = page.waitForResponse((response) => response.url().endsWith("/api/v1/leads/evaluation/validate"));
    await page.locator("input[aria-label='Choose blind owner-review dossiers']:visible:enabled").setInputFiles({
      name: "owner-labeling-blind.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(ownerLabelingSplit.blindPacket)),
    });
    const blindResponse = await blindValidation;
    const blindRequestBody = blindResponse.request().postData() ?? "";
    const blindResponseBody = await blindResponse.text();
    for (const forbidden of ["engineAssessment", "scores", "agreementPercent", "agreements", "ready", "gateReasons", "classification", "severity", "conversionCritical", "manualReviewReasons"]) {
      assert.equal(blindRequestBody.includes(`"${forbidden}":`), false, `Blind upload exposed ${forbidden}.`);
      assert.equal(blindResponseBody.includes(`"${forbidden}":`), false, `Blind response exposed ${forbidden}.`);
    }
    await page.getByRole("heading", { level: 2, name: firstEvaluationBusiness }).waitFor();
    await page.getByText("Verified the exact 50 blind dossiers. No outreach was enabled.").waitFor();
    await page.getByText("Engine verdict hidden", { exact: true }).first().waitFor();
    await page.getByRole("button", { name: /^Strong/ }).click();
    await page.getByRole("checkbox", { name: "Good commercial fit" }).check();
    assert.equal(await page.getByRole("button", { name: "Download first pass" }).isEnabled(), false,
      "One judgment must not open the assessment sidecar before the full blind cohort is judged.");
    assert.equal(await page.getByRole("button", { name: "Reveal engine verdict" }).count(), 0);

    // Core tests cover every decision rule; preload synthetic browser drafts so
    // this acceptance can verify the full-cohort gate without 150 UI clicks.
    await page.evaluate(({ packetDigest, leadIds }) => {
      const firstPassDecisions = Object.fromEntries(leadIds.map((leadId) => [leadId, {
        label: "STRONG", reasons: ["GOOD_COMMERCIAL_FIT"], notes: "Synthetic independent first pass.",
      }]));
      localStorage.setItem(`axiom-owner-labels:${packetDigest}`, JSON.stringify({
        draftVersion: "owner-labeling-draft-v2", packetDigest, reviewedBy: "RILEY",
        firstPassDecisions, revealedLeadIds: [], legacyRevealedLeadIds: [], decisions: {},
      }));
    }, { packetDigest: ownerLabelingPacket.packetDigest, leadIds: ownerLabelingPacket.entries.map((entry) => entry.leadId) });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator("[data-quality-lab-ready='true']:visible").waitFor();
    await page.locator("input[aria-label='Choose blind owner-review dossiers']:visible:enabled").setInputFiles({
      name: "owner-labeling-blind.json", mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(ownerLabelingSplit.blindPacket)),
    });
    await page.getByText("Verified the blind dossiers and restored this browser's first-pass draft.").waitFor();
    const firstPassDownloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download first pass" }).click();
    const firstPassDownload = await firstPassDownloadPromise;
    const firstPassPath = await firstPassDownload.path();
    assert(firstPassPath, "Quality Lab must download the complete blind first pass.");
    const firstPassExport = JSON.parse(await readFile(firstPassPath, "utf8")) as Record<string, unknown>;
    assert.equal((firstPassExport.decisions as Array<unknown>).length, 50);
    assert.equal(firstPassExport.packetDigest, ownerLabelingPacket.packetDigest);
    assert.equal(JSON.stringify(firstPassExport).includes("engineAssessment"), false);
    assert.equal(await page.getByRole("button", { name: "Reveal engine verdict" }).count(), 0,
      "The score file must still be absent after first-pass export.");
    await page.locator("input[aria-label='Choose matching engine assessments']:visible:enabled").setInputFiles({
      name: "owner-labeling-assessments.json", mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(ownerLabelingSplit.assessmentSidecar)),
    });
    await page.getByText("Assessment file matched. You can now compare your first-pass judgment with the engine, then record a final judgment.").waitFor();
    await page.getByRole("button", { name: "Reveal engine verdict" }).click();
    await page.getByText("Before reveal, you said").waitFor();
    await page.getByRole("button", { name: /^Strong/ }).click();
    await page.getByRole("checkbox", { name: "Good commercial fit" }).check();
    assert.equal(await page.getByRole("button", { name: /^Strong/ }).getAttribute("aria-pressed"), "true");
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download 1 review" }).click();
    const download = await downloadPromise;
    const downloadedPath = await download.path();
    assert(downloadedPath, "Quality Lab must download an immutable owner-review checkpoint.");
    const submission = JSON.parse(await readFile(downloadedPath, "utf8")) as Record<string, unknown>;
    assert.equal(submission.packetDigest, ownerLabelingPacket.packetDigest);
    assert.equal((submission.decisions as Array<{ label: string }>)[0]?.label, "STRONG");
    assert.equal((submission.firstPassDecisions as Array<{ label: string }>)[0]?.label, "STRONG");
    assert.equal(submission.databaseMutationAuthorized, false);
    assert.equal(submission.qualificationAuthorized, false);
    assert.equal(submission.outreachAuthorized, false);
    assert.equal(submission.sendAuthorized, false);
    assert.equal(submission.providerOperationsAuthorized, 0);
    assert.equal(submission.costAuthorizedUsd, 0);
    assert.equal(await page.locator("a[href^='mailto:'], a[href^='tel:']").count(), 0);
    await assertWcag(page, "desktop quality lab");
    await assertResponsive(page, "desktop quality lab");
    await assertReducedMotion(page, "desktop quality lab");

    stage = "desktop quality lab resume";
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator("[data-quality-lab-ready='true']:visible").waitFor();
    await page.locator("input[aria-label='Choose blind owner-review dossiers']:visible:enabled").setInputFiles({
      name: "owner-labeling-blind.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(ownerLabelingSplit.blindPacket)),
    });
    await page.getByText("Verified the blind dossiers and restored this browser's first-pass draft.").waitFor();
    await page.locator("input[aria-label='Choose matching engine assessments']:visible:enabled").setInputFiles({
      name: "owner-labeling-assessments.json", mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(ownerLabelingSplit.assessmentSidecar)),
    });
    await page.getByText("Assessment file matched. You can now compare your first-pass judgment with the engine, then record a final judgment.").waitFor();
    assert.equal(await page.getByRole("button", { name: /^Strong/ }).getAttribute("aria-pressed"), "true");
    assert.equal(await page.getByRole("checkbox", { name: "Good commercial fit" }).isChecked(), true);

    stage = "desktop M2 research console";
    const m2Start = performance.now();
    await page.goto("/leads/m2", { waitUntil: "domcontentloaded" });
    await page.getByRole("list", { name: "Businesses to review", exact: true }).waitFor();
    const desktopM2ReadyMs = Math.round(performance.now() - m2Start);
    assert(desktopM2ReadyMs <= OWNER_M2_BUDGET_MS, `The durable M2 review exceeded ${OWNER_M2_BUDGET_MS} ms.`);
    await assertM2Review(page, m2Fixture, "desktop M2 review");
    await page.screenshot({ path: join(outputDirectory, "m2-review-desktop.png"), fullPage: true });

    stage = "desktop Today safety";
    await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { level: 1, name: "Today" }).waitFor();
    await page.getByRole("heading", { name: "No actions due right now", exact: true }).waitFor();
    await assertNoProposedBusinessReviewPrompt(page, "Desktop Today");
    assert.equal(await page.getByText("Safety gated", { exact: true }).count(), 0,
      "The owner shell must not imply that safety is verified through a static badge.");
    assert.equal(await page.getByText("prod", { exact: true }).count(), 0,
      "The owner shell must not display a hard-coded production label.");
    assert.equal(await page.getByText("Connect Gmail in Settings to restore outbound capacity", { exact: false }).count(), 0,
      "The Today view must not direct an owner into the quarantined Gmail setup route.");
    assert.equal(await page.getByRole("link", { name: "Connect now" }).count(), 0,
      "The Today view must not offer Gmail OAuth as the next owner action.");
    await assertResponsive(page, "desktop Today safety");
    await assertWcag(page, "desktop Today safety");
    await page.screenshot({ path: join(outputDirectory, "today-desktop.png"), fullPage: true });

    stage = "desktop Outreach";
    await page.goto("/automation", { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { level: 1, name: "Follow-through" }).waitFor();
    await page.getByRole("heading", { name: "Email is not ready" }).waitFor();
    await page.getByRole("heading", { name: "Client follow-ups" }).waitFor();
    await page.getByRole("heading", { name: "Automation stop" }).waitFor();
    await assertNoProposedBusinessReviewPrompt(page, "Desktop Outreach");
    assert.equal(await page.getByRole("link", { name: /Connect Gmail/i }).count(), 0);
    await assertResponsive(page, "desktop Outreach");
    await assertWcag(page, "desktop Outreach");
    await page.screenshot({ path: join(outputDirectory, "outreach-desktop.png"), fullPage: true });

    stage = "desktop Revenue";
    await page.goto("/clients", { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { level: 1, name: "Clients & opportunities" }).waitFor();
    assert.equal(await page.getByText("Collected revenue", { exact: true }).count(), 0);
    await page.getByRole("heading", { name: "Your next follow-up" }).waitFor();
    await page.locator("#main-content").getByText("Your relationship board is ready", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Add client" }).waitFor();
    assert.equal(await page.getByRole("region", { name: /Deal stages/ }).count(), 0,
      "An empty client board should not show a long row of empty stages.");
    await assertResponsive(page, "desktop Revenue");
    await assertWcag(page, "desktop Revenue");
    await page.screenshot({ path: join(outputDirectory, "revenue-desktop.png"), fullPage: true });

    stage = "desktop Settings";
    await page.goto("/settings", { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { level: 1, name: "Settings & safety" }).waitFor();
    await page.getByRole("heading", { name: "Business email readiness" }).waitFor();
    assert.equal(await page.getByRole("link", { name: /Connect Gmail/i }).count(), 0);
    await assertResponsive(page, "desktop Settings");
    await assertWcag(page, "desktop Settings");
    await page.screenshot({ path: join(outputDirectory, "settings-desktop.png"), fullPage: true });

    stage = "mobile leads";
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/leads", { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { level: 1, name: "Businesses" }).waitFor();
    await page.getByRole("heading", { name: "Assessed businesses", exact: true }).waitFor();
    await assertNoProposedBusinessReviewPrompt(page, "Mobile Businesses");
    await page.screenshot({ path: join(outputDirectory, "leads-mobile.png"), fullPage: true });
    await openLegacyLeadPreview(page);
    await page.getByRole("link", { name: /Open evidence dossier/i }).first().waitFor();
    await waitForOwnerContent(page);
    await assertWcag(page, "mobile leads");
    await assertReadOnlyOwnerSurface(page, "mobile leads");
    const mobileWidth = await assertResponsive(page, "mobile leads");

    stage = "mobile dossier";
    await openMobileDossier(page);
    await page.getByRole("heading", { level: 1, name: "Tri-City Roofing Fixture" }).waitFor();
    await page.getByRole("heading", { level: 2, name: "Contact review not recorded" }).waitFor();
    await page.getByRole("heading", { level: 2, name: "Do not contact" }).waitFor();
    await page.getByText("Contact stopped", { exact: true }).waitFor();
    await page.getByText("Owner decision", { exact: true }).waitFor();
    await page.getByText("Owner decision: do not contact this synthetic business.", { exact: true }).waitFor();
    const mobileResearch = page.locator("details").filter({ has: page.getByText("Research details", { exact: true }) }).first();
    await mobileResearch.locator(":scope > summary").click();
    await assertBusinessStopRoutesBlocked(page);
    await mobileResearch.locator(":scope > summary").click();
    await page.getByRole("list", { name: "Saved owner tasks" }).getByText("Completed", { exact: true }).first().waitFor();
    await assertWcag(page, "mobile dossier");
    await assertReadOnlyOwnerSurface(page, "mobile dossier", "[data-owner-readonly-dossier] > details");
    await assertResponsive(page, "mobile dossier");
    await assertReducedMotion(page, "mobile dossier");
    await assertMobileNavigationClear(page);
    // A viewport capture is enough to verify the phone layout. Capturing the
    // entire long legacy evidence document can stall Chromium before the next
    // owner route, even after the image file has been written.
    await page.screenshot({ path: join(outputDirectory, "dossier-mobile.png"), timeout: 15_000 });
    console.log("Mobile dossier checked; opening Quality Lab.");

    stage = "mobile quality lab";
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/leads/evaluation", { waitUntil: "domcontentloaded" });
    console.log("Mobile Quality Lab page loaded.");
    await page.getByRole("heading", { level: 1, name: "Quality Lab" }).waitFor();
    await page.locator("[data-quality-lab-ready='true']:visible").waitFor();
    console.log("Mobile Quality Lab is ready; loading the synthetic checkpoint.");
    await page.locator("input[aria-label='Choose blind owner-review dossiers']:visible:enabled").setInputFiles({
      name: "owner-labeling-blind.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(ownerLabelingSplit.blindPacket)),
    });
    await page.getByRole("heading", { level: 2, name: firstEvaluationBusiness }).waitFor();
    console.log("Mobile Quality Lab checkpoint loaded.");
    assert.equal(await page.getByRole("button", { name: /^Strong/ }).getAttribute("aria-pressed"), "true");
    await assertWcag(page, "mobile quality lab");
    await assertResponsive(page, "mobile quality lab");
    await assertReducedMotion(page, "mobile quality lab");
    console.log("Mobile Quality Lab checks passed; opening Business Review.");

    stage = "mobile M2 research console";
    await page.goto("/leads/m2", { waitUntil: "domcontentloaded" });
    await assertM2Review(page, m2Fixture, "mobile M2 review");
    await assertM2MobileNavigationClear(page, "[data-owner-content] h1", "[aria-label='Businesses to review'] > li:last-child", "mobile M2 queue");
    await page.screenshot({ path: join(outputDirectory, "m2-review-mobile.png") });
    await page.getByRole("button", { name: `Open ${m2Fixture.selected[4]!.businessName} review` }).click();
    await page.getByRole("region", { name: `${m2Fixture.selected[4]!.businessName} website review` }).waitFor();
    await assertM2MobileNavigationClear(page, "[aria-label$='website review'] h2", "[aria-label$='website review'] > div:last-child > p:last-child", "mobile M2 detail");
    await page.screenshot({ path: join(outputDirectory, "m2-review-mobile-detail.png") });

    stage = "mobile Today safety";
    await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { level: 1, name: "Today" }).waitFor();
    await page.getByRole("heading", { name: "No actions due right now", exact: true }).waitFor();
    await assertNoProposedBusinessReviewPrompt(page, "Mobile Today");
    assert.equal(await page.getByRole("link", { name: "Connect now" }).count(), 0,
      "The phone Today view must not offer Gmail OAuth as the next owner action.");
    await assertResponsive(page, "mobile Today safety");
    await assertWcag(page, "mobile Today safety");
    await page.screenshot({ path: join(outputDirectory, "today-mobile.png"), fullPage: true });

    stage = "mobile Outreach";
    await page.goto("/automation", { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { level: 1, name: "Follow-through" }).waitFor();
    await page.getByRole("heading", { name: "Email is not ready" }).waitFor();
    await page.getByRole("heading", { name: "Client follow-ups" }).waitFor();
    await assertNoProposedBusinessReviewPrompt(page, "Mobile Outreach");
    await assertResponsive(page, "mobile Outreach");
    await assertWcag(page, "mobile Outreach");
    await page.screenshot({ path: join(outputDirectory, "outreach-mobile.png"), fullPage: true });

    stage = "mobile Revenue";
    await page.goto("/clients", { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { level: 1, name: "Clients & opportunities" }).waitFor();
    await page.getByRole("heading", { name: "Your next follow-up" }).waitFor();
    await page.locator("#main-content").getByText("Your relationship board is ready", { exact: true }).waitFor();
    assert.equal(await page.getByText("No clients in this stage yet").count(), 0,
      "An empty phone board should not repeat every stage before its empty state.");
    await assertResponsive(page, "mobile Revenue");
    await assertWcag(page, "mobile Revenue");
    await page.screenshot({ path: join(outputDirectory, "revenue-mobile.png"), fullPage: true });

    stage = "mobile Settings";
    await page.goto("/settings", { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { level: 1, name: "Settings & safety" }).waitFor();
    await page.getByRole("heading", { name: "Emergency stop", exact: true }).waitFor();
    await assertResponsive(page, "mobile Settings");
    await assertWcag(page, "mobile Settings");
    await page.screenshot({ path: join(outputDirectory, "settings-mobile.png"), fullPage: true });

    assert.deepEqual(externalRequests, [], "The owner acceptance browser attempted an external request.");
    console.log("Final owner pages rendered; collecting browser diagnostics.");
    await Promise.all(drainScriptDiagnostics.map((drain) => drain()));
    console.log("Browser diagnostics collected; closing the owner session.");
    // CDP events attribute failures; caught/revoked exceptions are not new acceptance gates.
    // Preserve the existing uncaught pageerror and console-error gates.
    const intentionalLostResponse = diagnostics.filter((diagnostic) =>
      diagnostic.kind === "console-error" &&
      diagnostic.stage === "desktop owner-task creation" &&
      diagnostic.url === `${baseUrl}${taskApiPath}` &&
      diagnostic.message === "Failed to load resource: net::ERR_FAILED");
    assert.equal(intentionalLostResponse.length, 1, "The retry exercise must account for exactly one deliberately lost local response.");
    const browserErrors = diagnostics.filter((diagnostic) =>
      (diagnostic.kind === "console-error" || diagnostic.kind === "page-error") &&
      !intentionalLostResponse.includes(diagnostic));
    const badResponses = diagnostics.filter((diagnostic) => diagnostic.kind === "http-error");
    assert.deepEqual(browserErrors, [], `Browser errors: ${browserErrors.map((diagnostic) => `${diagnostic.stage} ${diagnostic.kind}: ${diagnostic.message}`).join(" | ")}`);
    assert.deepEqual(badResponses, [], `Local server failures: ${badResponses.map((diagnostic) => `${diagnostic.status} ${diagnostic.url}`).join(" | ")}`);
    await context.close();
    return {
      desktopListReadyMs,
      desktopDossierReadyMs,
      desktopM2ReadyMs,
      desktopWidth,
      mobileWidth,
      pagesScanned: 17,
      externalRequests: externalRequests.length,
    } satisfies AcceptanceResult;
  } catch (error) {
    console.error(`Owner UI browser step failed at ${stage}: ${error instanceof Error ? error.message : String(error)}`);
    await Promise.all(drainScriptDiagnostics.map((drain) => drain()));
    if (page) await page.screenshot({ path: join(outputDirectory, "owner-ui-failure.png"), fullPage: true }).catch(() => undefined);
    return await reportBrowserAcceptanceFailure({
      error,
      outputDirectory,
      diagnostics,
      failedStage: stage,
      measuredPageUrl: page?.url() ?? null,
      warmupPageUrl: warmupPage?.url() ?? null,
    });
  } finally {
    await browser?.close().catch(() => undefined);
  }
}

async function run() {
  const buildId = await readFile(join(REPOSITORY_ROOT, ".next", "BUILD_ID"), "utf8").catch(() => "");
  assert(buildId.trim(), "Owner UI acceptance requires a completed production build. Run npm run build:cloudflare first.");
  await mkdir(OUTPUT_ROOT, { recursive: true });
  const outputDirectory = join(OUTPUT_ROOT, `owner-ui-${process.pid}-${Date.now()}`);
  await mkdir(outputDirectory, { recursive: true });
  const databasePath = join(outputDirectory, "owner-ui-fixture.db");
  const database = new Database(databasePath);
  const serverLogs: string[] = [];
  let server: ChildProcess | null = null;
  let success = false;
  let result: AcceptanceResult | null = null;
  let m2Fixture: Awaited<ReturnType<typeof createM2OwnerConsoleFixture>> | null = null;
  try {
    await applyMigrations(database);
    seedOwnerLead(database);
    database.exec(await readFile(join(REPOSITORY_ROOT, "migrations", "0071_revenue_owner_tasks.sql"), "utf8"));
    database.exec(await readFile(join(REPOSITORY_ROOT, "migrations", "0072_revenue_business_stop.sql"), "utf8"));
    database.exec(await readFile(join(REPOSITORY_ROOT, "migrations", "0073_revenue_contact_suppression.sql"), "utf8"));
    database.exec(await readFile(join(REPOSITORY_ROOT, "migrations", "0074_revenue_owner_observed_replies.sql"), "utf8"));
    database.close();
    m2Fixture = await createM2OwnerConsoleFixture();
    const m2DatabaseIdentity = readSetupFile(resolve(m2Fixture.databasePath)).identity;
    const port = await freeLoopbackPort();
    const baseUrl = `http://127.0.0.1:${port}`;
    // Use the completed build unchanged: development page eviction can rewrite
    // layout.js during longer owner workflows even after initial route warmup.
    server = startNextServer(baseUrl, databasePath, serverLogs, m2Fixture.runPath);
    await waitForServer(baseUrl, server);
    result = await runBrowserAcceptance(baseUrl, outputDirectory, m2Fixture);
    assert.deepEqual(readSetupFile(resolve(m2Fixture.databasePath)).identity, m2DatabaseIdentity, "Browser inspection must leave the M2 database unchanged.");
    for (const name of [
      "m2-review-desktop.png", "m2-review-mobile.png", "m2-review-mobile-detail.png",
      "today-desktop.png", "today-mobile.png",
      "leads-desktop.png", "leads-mobile.png", "dossier-desktop.png", "dossier-mobile.png",
      "outreach-desktop.png", "outreach-mobile.png",
      "revenue-desktop.png", "revenue-mobile.png",
      "settings-desktop.png", "settings-mobile.png",
    ]) {
      await copyFile(join(outputDirectory, name), join(OUTPUT_ROOT, name));
    }
    success = true;
  } catch (error) {
    await writeFile(join(outputDirectory, "next-server.log"), `${serverLogs.join("\n")}\n`, "utf8");
    console.error(`Owner UI acceptance failed. Safe artifacts: ${outputDirectory}`);
    throw error;
  } finally {
    if (database.open) database.close();
    await stopServer(server);
    await m2Fixture?.cleanup();
    if (success) await rm(outputDirectory, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
  }
  assert(result, "Owner UI acceptance completed without a result.");
  console.log("Owner UI acceptance passed.");
  console.log(`Desktop list ready: ${result.desktopListReadyMs} ms (budget ${OWNER_LIST_BUDGET_MS} ms)`);
  console.log(`Desktop dossier ready: ${result.desktopDossierReadyMs} ms (budget ${OWNER_DOSSIER_BUDGET_MS} ms)`);
  console.log(`Desktop M2 review ready: ${result.desktopM2ReadyMs} ms (budget ${OWNER_M2_BUDGET_MS} ms)`);
  console.log("Owner task lifecycle: lost-response retry, create, reload, complete, reload verified; anonymous and cross-site API writes rejected.");
  console.log(`Responsive widths: desktop ${result.desktopWidth}px, mobile ${result.mobileWidth}px`);
  console.log(`WCAG pages scanned: ${result.pagesScanned}; external requests: ${result.externalRequests}`);
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  run().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
