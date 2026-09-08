import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import Database from "better-sqlite3";
import { hashPassword } from "better-auth/crypto";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

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
import { auditWebsiteDeterministically } from "../src/lib/revenue-engine/website-audit";
import { executePrivateKwContactPersistenceForLocalDatabase } from "./private-kw-contact-persistence-executor";
import { verifyOwnerSessionRevocation } from "./owner-session-acceptance";
import { verifyOwnerBanLifecycle } from "./owner-ban-acceptance";
import { verifyOwnerAdmission } from "./owner-admission-acceptance";
import { postOwnerSignIn } from "./owner-auth-request";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(SCRIPT_DIR, "..");
const OUTPUT_ROOT = join(REPOSITORY_ROOT, "output", "playwright");
const FIXTURE_EMAIL = "owner-acceptance@getaxiom.ca";
const FIXTURE_ADMIN_EMAIL = "admin-owner-acceptance@getaxiom.ca";
const UNPROVISIONED_ADMIN_EMAIL = "unprovisioned-owner-acceptance@getaxiom.ca";
const FIXTURE_PASSWORD = "owner-acceptance-only-password";
const FIXTURE_BUSINESS_ID = "business:owner-acceptance-roofing";
const TEST_AUTH_SECRET = "owner-ui-acceptance-only-secret-00000000000000000000";
const AXE_PATH = createRequire(import.meta.url).resolve("axe-core/axe.min.js");
const OWNER_LIST_BUDGET_MS = 10_000;
const OWNER_DOSSIER_BUDGET_MS = 15_000;
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
  desktopWidth: number;
  mobileWidth: number;
  pagesScanned: number;
  externalRequests: number;
};

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
  const migrations = (await readdir(migrationsDirectory))
    .filter((name) => /^\d{4}_.+\.sql$/.test(name) && !name.startsWith("0070_"))
    .sort((left, right) => left.localeCompare(right));
  assert(migrations.length >= 60, "The owner fixture must include the legacy schema and operator ban guards.");

  // Disposable acceptance includes 0071's source-only security guards. The
  // unrelated 0070 outbox design remains deliberately excluded. Neither
  // migration is authorized for any live database by this local test.
  database.pragma("foreign_keys = ON");
  for (const migration of migrations) {
    database.exec(await readFile(join(migrationsDirectory, migration), "utf8"));
  }
}

// Synthetic account in the disposable acceptance database only. This is not
// an operator provisioning command and must never target an existing database.
async function seedOwnerAccount(database: SqliteDatabase) {
  const now = new Date().toISOString();
  const userId = "owner-acceptance-user";
  const passwordHash = await hashPassword(FIXTURE_PASSWORD);
  database.transaction(() => {
    for (const account of [
      { id: userId, email: FIXTURE_EMAIL, role: "user" },
      { id: "owner-acceptance-admin", email: FIXTURE_ADMIN_EMAIL, role: "admin" },
    ]) {
      database.prepare(`INSERT INTO "User"
        (id, name, email, emailVerified, role, createdAt, updatedAt)
        VALUES (?, ?, ?, 1, ?, ?, ?)`)
        .run(account.id, "Owner Acceptance", account.email, account.role, now, now);
      database.prepare(`INSERT INTO "Account"
        (id, accountId, providerId, userId, password, createdAt, updatedAt)
        VALUES (?, ?, 'credential', ?, ?, ?, ?)`)
        .run(`${account.id}-credential`, account.id, account.id, passwordHash, now, now);
    }
  })();
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

function seedOwnerLead(database: SqliteDatabase) {
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
    mobileArtifactRef: null,
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
      captured: false,
      horizontalOverflow: null,
      navigationUsable: null,
      textReadable: null,
      minimumTapTargetPx: null,
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

async function startNextServer(baseUrl: string, databasePath: string, logLines: string[]) {
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
    AUTH_ALLOWED_EMAILS: `${FIXTURE_EMAIL},${FIXTURE_ADMIN_EMAIL},${UNPROVISIONED_ADMIN_EMAIL}`,
    // An approval ceiling, not role assignment: the primary fixture remains a
    // stored ordinary user except during explicit role-revocation tests.
    AUTH_ADMIN_EMAILS: `${FIXTURE_EMAIL},${FIXTURE_ADMIN_EMAIL},${UNPROVISIONED_ADMIN_EMAIL}`,
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
  const capture = (chunk: string) => {
    const safe = chunk.replaceAll(TEST_AUTH_SECRET, "[test-secret-redacted]");
    logLines.push(...safe.split(/\r?\n/).filter(Boolean));
    if (logLines.length > 200) logLines.splice(0, logLines.length - 200);
  };
  const launch = (args: string[], timeout?: number) => {
    const child = spawn(process.execPath, [nextBinary, ...args], {
      cwd: REPOSITORY_ROOT,
      // Both build and server use the same explicit fake credentials and DB.
      env: childEnvironment as unknown as NodeJS.ProcessEnv,
      stdio: ["ignore", "pipe", "pipe"], windowsHide: true, timeout,
    });
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", capture);
    child.stderr?.on("data", capture);
    return child;
  };
  // Development on-demand compilation can race its own manifests even after
  // warmup. Test an immutable production build, not a live-recompiling server.
  const build = launch(["build", "--webpack"], 180_000);
  await new Promise<void>((resolveBuild, rejectBuild) => {
    build.once("error", rejectBuild);
    build.once("exit", (code) => code === 0 ? resolveBuild()
      : rejectBuild(new Error(`Isolated owner acceptance build failed (code ${code}).`)));
  });
  return launch(["start", "-H", "127.0.0.1", "-p", port]);
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
  // Exercise the real anonymous endpoint, including the previously vulnerable
  // approved-but-not-yet-provisioned admin identity. No test-only server bypass.
  for (const email of [UNPROVISIONED_ADMIN_EMAIL, "stranger@axiomfixtures.ca", FIXTURE_EMAIL]) {
    const denied = await context.request.post(`${baseUrl}/api/auth/sign-up/email`, {
      data: { name: "Untrusted Registration", email, password: FIXTURE_PASSWORD, role: "admin" },
      headers: { origin: baseUrl },
    });
    assert.equal(denied.status(), 403, "Public signup must deny every address, including approved admins.");
    assert.equal((await context.cookies(baseUrl)).some((cookie) => cookie.name.includes("session")), false,
      "Rejected registration must not establish a session.");
  }
  const deniedSignIn = await postOwnerSignIn(context.request, baseUrl, {
    data: { email: UNPROVISIONED_ADMIN_EMAIL, password: FIXTURE_PASSWORD },
    headers: { origin: baseUrl },
  });
  assert.equal(deniedSignIn.status(), 401, "A rejected signup must not create usable credentials.");

  const registrationPage = await context.newPage();
  await registrationPage.goto(`${baseUrl}/sign-up`, { waitUntil: "domcontentloaded" });
  await registrationPage.getByRole("heading", { name: "Registration is closed", exact: true }).waitFor();
  assert.equal(await registrationPage.locator("form, input").count(), 0, "Closed registration must expose no form.");
  await registrationPage.close();

  const response = await postOwnerSignIn(context.request, baseUrl, {
    data: { email: FIXTURE_EMAIL, password: FIXTURE_PASSWORD },
    headers: { origin: baseUrl },
  });
  const body = await response.text();
  assert.equal(response.ok(), true, `Fixture sign-in failed (${response.status()}): ${body.slice(0, 300)}`);
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

async function assertReadOnlyOwnerSurface(page: Page, label: string) {
  const unsafe = await page.locator("[data-owner-content] button, [data-owner-content] form, [data-owner-content] a[href^='mailto:'], [data-owner-content] a[href^='tel:']").count();
  assert.equal(unsafe, 0, `${label} unexpectedly exposes a mutation or direct-contact control.`);
  assert.equal(await page.locator("main#main-content").count(), 1, `${label} must have one main landmark.`);
  // Production navigation can retain inactive page DOM. Assert both the
  // rendered and accessible heading, not detached-from-view history entries.
  assert.equal(await page.locator("h1:visible").count(), 1, `${label} must have one visible primary heading.`);
  assert.equal(await page.getByRole("heading", { level: 1 }).count(), 1, `${label} must have one accessible primary heading.`);
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
  await page.locator("body").focus();
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

async function runBrowserAcceptance(baseUrl: string, outputDirectory: string, databasePath: string) {
  let browser: Browser | null = null;
  let page: Page | null = null;
  const externalRequests: string[] = [];
  const browserErrors: string[] = [];
  const badResponses: string[] = [];
  const ownerLabelingPacket = buildCompleteOwnerLabelingPacketFixture();
  const firstEvaluationBusiness = ownerLabelingPacket.entries[0]!.businessName;
  let stage = "startup";
  try {
    browser = await chromium.launch({ headless: true });
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

    // Warm authenticated handlers with denied/no-op requests before measuring.
    assert.equal((await context.request.get("/api/admin/users")).status(), 403);
    assert.equal((await context.request.patch("/api/user/profile", {
      data: {}, headers: { origin: baseUrl },
    })).status(), 400);

    // Warm server-side reads in a disposable page before measuring the owner's
    // interaction time. The compiled production assets remain unchanged.
    stage = "owner route warmup";
    const warmupPage = await context.newPage();
    await warmupPage.goto("/leads", { waitUntil: "domcontentloaded" });
    await warmupPage.getByRole("heading", { level: 1, name: "Leads" }).waitFor();
    await warmupPage.goto(`/leads/${FIXTURE_BUSINESS_ID}`, { waitUntil: "domcontentloaded" });
    await warmupPage.getByRole("heading", { level: 1, name: "Tri-City Roofing Fixture" }).waitFor();
    await warmupPage.goto("/leads/evaluation", { waitUntil: "domcontentloaded" });
    await warmupPage.getByRole("heading", { level: 1, name: "Quality Lab" }).waitFor();
    await warmupPage.locator("[data-quality-lab-ready='true']").waitFor();
    await warmupPage.close();

    page = await context.newPage();
    page.on("console", (message) => {
      if (message.type() === "error") browserErrors.push(`${stage} console: ${message.text()}`);
    });
    page.on("pageerror", (error) => browserErrors.push(`${stage} pageerror: ${JSON.stringify({
      name: error.name,
      message: error.message,
      stack: error.stack ?? null,
    })}`));
    page.on("response", (response) => {
      if (response.url().startsWith(baseUrl) && response.status() >= 500) badResponses.push(`${response.status()} ${response.url()}`);
    });

    stage = "desktop leads";
    const listStart = performance.now();
    await page.goto("/leads", { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { level: 1, name: "Leads" }).waitFor();
    await page.getByRole("link", { name: /Open evidence dossier/i }).first().waitFor();
    const desktopListReadyMs = Math.round(performance.now() - listStart);
    assert(desktopListReadyMs <= OWNER_LIST_BUDGET_MS, `The next owner lead was not discoverable within ${OWNER_LIST_BUDGET_MS} ms.`);
    await assertOwnerPageTitle(page, "Leads | Axiom Revenue Engine");
    await assertWcag(page, "desktop leads");
    await assertReadOnlyOwnerSurface(page, "desktop leads");
    const desktopWidth = await assertResponsive(page, "desktop leads");
    await assertReducedMotion(page, "desktop leads");
    await assertKeyboardFlow(page);

    stage = "desktop dossier";
    const dossierStart = performance.now();
    await page.keyboard.press("Enter");
    await page.getByRole("heading", { level: 1, name: "Tri-City Roofing Fixture" }).waitFor();
    await page.getByRole("heading", { level: 2, name: "Why this is a strong lead" }).waitFor();
    await page.getByRole("heading", { level: 2, name: "Website evidence" }).waitFor();
    await page.getByRole("heading", { level: 2, name: "Contact review not recorded" }).waitFor();
    await page.getByText("+15195550123", { exact: true }).waitFor();
    await page.getByText("https://roofing.axiomfixtures.ca/contact", { exact: true }).waitFor();
    await page.getByText("hello@roofing.axiomfixtures.ca", { exact: true }).waitFor();
    const desktopDossierReadyMs = Math.round(performance.now() - dossierStart);
    assert(desktopDossierReadyMs <= OWNER_DOSSIER_BUDGET_MS, `The lead rationale was not visible within ${OWNER_DOSSIER_BUDGET_MS} ms.`);
    await assertOwnerPageTitle(page, "Lead dossier | Axiom Revenue Engine");
    assert((await page.getByRole("link", { name: "Inspect proof" }).count()) >= 3, "The dossier must expose at least three inspectable observations.");
    await assertWcag(page, "desktop dossier");
    await assertReadOnlyOwnerSurface(page, "desktop dossier");
    await assertResponsive(page, "desktop dossier");
    await assertReducedMotion(page, "desktop dossier");

    stage = "desktop quality lab";
    await page.goto("/leads/evaluation", { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { level: 1, name: "Quality Lab" }).waitFor();
    await page.locator("[data-quality-lab-ready='true']").waitFor();
    await assertOwnerPageTitle(page, "Quality Lab | Axiom Revenue Engine");
    await page.locator('input[type="file"][aria-label="Choose owner-review checkpoint"]:enabled:visible').setInputFiles({
      name: "owner-labeling-checkpoint.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(ownerLabelingPacket)),
    });
    await page.getByRole("heading", { level: 2, name: firstEvaluationBusiness }).waitFor();
    await page.getByText("Verified the exact 50-business checkpoint. No outreach was enabled.").waitFor();
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
    await page.locator("[data-quality-lab-ready='true']").waitFor();
    await page.locator('input[type="file"][aria-label="Choose owner-review checkpoint"]:enabled:visible').setInputFiles({
      name: "owner-labeling-checkpoint.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(ownerLabelingPacket)),
    });
    await page.getByText("Verified the exact checkpoint and restored this browser's draft.").waitFor();
    assert.equal(await page.getByRole("button", { name: /^Strong/ }).getAttribute("aria-pressed"), "true");
    assert.equal(await page.getByRole("checkbox", { name: "Good commercial fit" }).isChecked(), true);

    stage = "mobile leads";
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/leads", { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { level: 1, name: "Leads" }).waitFor();
    await page.getByRole("link", { name: /Open evidence dossier/i }).first().waitFor();
    await waitForOwnerContent(page);
    await assertWcag(page, "mobile leads");
    await assertReadOnlyOwnerSurface(page, "mobile leads");
    const mobileWidth = await assertResponsive(page, "mobile leads");

    stage = "mobile dossier";
    await openMobileDossier(page);
    await page.getByRole("heading", { level: 1, name: "Tri-City Roofing Fixture" }).waitFor();
    await page.getByRole("heading", { level: 2, name: "Contact review not recorded" }).waitFor();
    await assertWcag(page, "mobile dossier");
    await assertReadOnlyOwnerSurface(page, "mobile dossier");
    await assertResponsive(page, "mobile dossier");
    await assertReducedMotion(page, "mobile dossier");
    await assertMobileNavigationClear(page);

    stage = "mobile quality lab";
    await page.goto("/leads/evaluation", { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { level: 1, name: "Quality Lab" }).waitFor();
    await page.locator("[data-quality-lab-ready='true']").waitFor();
    await page.locator('input[type="file"][aria-label="Choose owner-review checkpoint"]:enabled:visible').setInputFiles({
      name: "owner-labeling-checkpoint.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(ownerLabelingPacket)),
    });
    await page.getByRole("heading", { level: 2, name: firstEvaluationBusiness }).waitFor();
    assert.equal(await page.getByRole("button", { name: /^Strong/ }).getAttribute("aria-pressed"), "true");
    await assertWcag(page, "mobile quality lab");
    await assertResponsive(page, "mobile quality lab");
    await assertReducedMotion(page, "mobile quality lab");

    assert.deepEqual(externalRequests, [], "The owner acceptance browser attempted an external request.");
    assert.deepEqual(browserErrors, [], `Browser errors: ${browserErrors.join(" | ")}`);
    assert.deepEqual(badResponses, [], `Local server failures: ${badResponses.join(" | ")}`);
    // Lifecycle tests switch identities deliberately. An old rendered page must
    // not keep fetching/refetching sessions while those cookie jars are changed.
    await page.close();
    page = null;
    stage = "owner admission";
    const authDatabase = new Database(databasePath, { fileMustExist: true });
    try {
      // Independent lifecycle scenarios share one disposable DB. Reset only its
      // fake rate windows between scenarios; retain the real configured limit.
      authDatabase.prepare('DELETE FROM "RateLimitWindow"').run();
      await verifyOwnerAdmission({ context, baseUrl, database: authDatabase,
        credentials: { email: FIXTURE_EMAIL, password: FIXTURE_PASSWORD } });
      stage = "owner session revocation";
      authDatabase.prepare('DELETE FROM "RateLimitWindow"').run();
      await verifyOwnerSessionRevocation({
        context, baseUrl, database: authDatabase, fixtureSecret: TEST_AUTH_SECRET,
        credentials: { email: FIXTURE_EMAIL, password: FIXTURE_PASSWORD },
      });
      stage = "owner ban lifecycle";
      authDatabase.prepare('DELETE FROM "RateLimitWindow"').run();
      await verifyOwnerBanLifecycle({
        context, baseUrl, database: authDatabase,
        owner: { email: FIXTURE_EMAIL, password: FIXTURE_PASSWORD },
        administrator: { email: FIXTURE_ADMIN_EMAIL, password: FIXTURE_PASSWORD },
      });
    } finally {
      authDatabase.close();
    }
    assert.deepEqual(externalRequests, [], "Session acceptance must not contact any external origin.");
    await context.close();
    return {
      desktopListReadyMs,
      desktopDossierReadyMs,
      desktopWidth,
      mobileWidth,
      pagesScanned: 6,
      externalRequests: externalRequests.length,
    } satisfies AcceptanceResult;
  } catch (error) {
    if (page) await page.screenshot({ path: join(outputDirectory, "owner-ui-failure.png"), fullPage: true }).catch(() => undefined);
    if (error instanceof Error) error.message = `${stage} at ${page?.url() ?? "no page"}: ${error.message}`;
    throw error;
  } finally {
    await browser?.close().catch(() => undefined);
  }
}

async function run() {
  await mkdir(OUTPUT_ROOT, { recursive: true });
  const outputDirectory = join(OUTPUT_ROOT, `owner-ui-${process.pid}-${Date.now()}`);
  await mkdir(outputDirectory, { recursive: true });
  const databasePath = join(outputDirectory, "owner-ui-fixture.db");
  const database = new Database(databasePath);
  const serverLogs: string[] = [];
  let server: ChildProcess | null = null;
  let success = false;
  let result: AcceptanceResult | null = null;
  try {
    await applyMigrations(database);
    await seedOwnerAccount(database);
    seedOwnerLead(database);
    const originalUsers = database.prepare('SELECT id, email, role FROM "User" ORDER BY id').all();
    const originalAccounts = database.prepare('SELECT id, accountId, providerId, userId FROM "Account" ORDER BY id').all();
    database.close();
    const port = await freeLoopbackPort();
    const baseUrl = `http://127.0.0.1:${port}`;
    // Clear only this repository's generated artifacts, then compile a fresh
    // fixture-only production build. Never reuse a different environment's build.
    await rm(join(REPOSITORY_ROOT, ".next"), { recursive: true, force: true });
    server = await startNextServer(baseUrl, databasePath, serverLogs);
    await waitForServer(baseUrl, server);
    result = await runBrowserAcceptance(baseUrl, outputDirectory, databasePath);
    const verifiedDatabase = new Database(databasePath, { readonly: true });
    try {
      assert.deepEqual(verifiedDatabase.prepare('SELECT id, email, role FROM "User" ORDER BY id').all(),
        originalUsers, "Rejected signup must not create or promote any user.");
      assert.deepEqual(verifiedDatabase.prepare('SELECT id, accountId, providerId, userId FROM "Account" ORDER BY id').all(),
        originalAccounts, "Rejected signup must not create or change any credential account.");
    } finally {
      verifiedDatabase.close();
    }
    success = true;
  } catch (error) {
    await writeFile(join(outputDirectory, "next-server.log"), `${serverLogs.join("\n")}\n`, "utf8");
    console.error(`Owner UI acceptance failed. Safe artifacts: ${outputDirectory}`);
    throw error;
  } finally {
    if (database.open) database.close();
    await stopServer(server);
    if (success) await rm(outputDirectory, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
  }
  assert(result, "Owner UI acceptance completed without a result.");
  console.log("Owner UI acceptance passed.");
  console.log(`Desktop list ready: ${result.desktopListReadyMs} ms (budget ${OWNER_LIST_BUDGET_MS} ms)`);
  console.log(`Desktop dossier ready: ${result.desktopDossierReadyMs} ms (budget ${OWNER_DOSSIER_BUDGET_MS} ms)`);
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
