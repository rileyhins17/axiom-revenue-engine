import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import Database from "better-sqlite3";
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
import { qualifyRevenueLead } from "../src/lib/revenue-engine/qualification";
import { auditWebsiteDeterministically } from "../src/lib/revenue-engine/website-audit";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(SCRIPT_DIR, "..");
const OUTPUT_ROOT = join(REPOSITORY_ROOT, "output", "playwright");
const FIXTURE_EMAIL = "owner-acceptance@getaxiom.ca";
const FIXTURE_PASSWORD = "owner-acceptance-only-password";
const FIXTURE_BUSINESS_ID = "business:owner-acceptance-roofing";
const TEST_AUTH_SECRET = "owner-ui-acceptance-only-secret-00000000000000000000";
const AXE_PATH = createRequire(import.meta.url).resolve("axe-core/axe.min.js");
const OWNER_LIST_BUDGET_MS = 10_000;
const OWNER_DOSSIER_BUDGET_MS = 15_000;

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
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .sort((left, right) => left.localeCompare(right));
  assert(migrations.length >= 60, "The owner fixture must use the complete migration history.");

  database.pragma("foreign_keys = ON");
  for (const migration of migrations) {
    database.exec(await readFile(join(migrationsDirectory, migration), "utf8"));
  }
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
  return buildRevenueContactPersistencePlan({ discovery, verifications });
}

function seedOwnerLead(database: SqliteDatabase) {
  const sourceCapturedAt = fixtureTimestamp(-2 * 60 * 60 * 1_000);
  const capturedAt = fixtureTimestamp(-60 * 60 * 1_000);
  const refreshAfter = new Date(Date.parse(capturedAt) + 60 * 24 * 60 * 60 * 1_000).toISOString();
  const sourceEvidenceUrl = "https://directory.axiomfixtures.ca/business/owner-acceptance-roofing";
  const websiteUrl = "http://roofing.axiomfixtures.ca/";
  const contactPersistencePlan = buildOwnerContactFixture(sourceCapturedAt, sourceEvidenceUrl);

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
    for (const mutation of contactPersistencePlan.mutations) {
      database.prepare(mutation.sql).run(...mutation.bindings);
    }
  });
  insert();
}

function startNextServer(baseUrl: string, databasePath: string, logLines: string[]) {
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
    AUTH_ADMIN_EMAILS: "",
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
  const child = spawn(process.execPath, [nextBinary, "dev", "--webpack", "-H", "127.0.0.1", "-p", port], {
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
  assert.equal(await page.locator("h1").count(), 1, `${label} must have one primary heading.`);
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

async function runBrowserAcceptance(baseUrl: string, outputDirectory: string) {
  let browser: Browser | null = null;
  let page: Page | null = null;
  const externalRequests: string[] = [];
  const browserErrors: string[] = [];
  const badResponses: string[] = [];
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
    page = await context.newPage();
    page.on("console", (message) => {
      if (message.type() === "error") browserErrors.push(`${stage} console: ${message.text()}`);
    });
    page.on("pageerror", (error) => browserErrors.push(`${stage} pageerror: ${error.stack ?? error.message}`));
    page.on("response", (response) => {
      if (response.url().startsWith(baseUrl) && response.status() >= 500) badResponses.push(`${response.status()} ${response.url()}`);
    });

    stage = "desktop leads warmup";
    await page.goto("/leads", { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { level: 1, name: "Leads" }).waitFor();
    await page.getByRole("link", { name: /Open evidence dossier/i }).first().waitFor();
    await waitForOwnerContent(page);

    stage = "desktop leads";
    const listStart = performance.now();
    await page.goto("/leads", { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { level: 1, name: "Leads" }).waitFor();
    await page.getByRole("link", { name: /Open evidence dossier/i }).first().waitFor();
    const desktopListReadyMs = Math.round(performance.now() - listStart);
    assert(desktopListReadyMs <= OWNER_LIST_BUDGET_MS, `The next owner lead was not discoverable within ${OWNER_LIST_BUDGET_MS} ms.`);
    assert.equal(await page.title(), "Leads | Axiom Revenue Engine");
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
    const desktopDossierReadyMs = Math.round(performance.now() - dossierStart);
    assert(desktopDossierReadyMs <= OWNER_DOSSIER_BUDGET_MS, `The lead rationale was not visible within ${OWNER_DOSSIER_BUDGET_MS} ms.`);
    assert.equal(await page.title(), "Lead dossier | Axiom Revenue Engine");
    assert((await page.getByRole("link", { name: "Inspect proof" }).count()) >= 3, "The dossier must expose at least three inspectable observations.");
    await assertWcag(page, "desktop dossier");
    await assertReadOnlyOwnerSurface(page, "desktop dossier");
    await assertResponsive(page, "desktop dossier");
    await assertReducedMotion(page, "desktop dossier");

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
    await page.getByRole("link", { name: /Open evidence dossier/i }).first().click();
    await page.getByRole("heading", { level: 1, name: "Tri-City Roofing Fixture" }).waitFor();
    await assertWcag(page, "mobile dossier");
    await assertReadOnlyOwnerSurface(page, "mobile dossier");
    await assertResponsive(page, "mobile dossier");
    await assertReducedMotion(page, "mobile dossier");
    await assertMobileNavigationClear(page);

    assert.deepEqual(externalRequests, [], "The owner acceptance browser attempted an external request.");
    assert.deepEqual(browserErrors, [], `Browser errors: ${browserErrors.join(" | ")}`);
    assert.deepEqual(badResponses, [], `Local server failures: ${badResponses.join(" | ")}`);
    await context.close();
    return {
      desktopListReadyMs,
      desktopDossierReadyMs,
      desktopWidth,
      mobileWidth,
      pagesScanned: 4,
      externalRequests: externalRequests.length,
    } satisfies AcceptanceResult;
  } catch (error) {
    if (page) await page.screenshot({ path: join(outputDirectory, "owner-ui-failure.png"), fullPage: true }).catch(() => undefined);
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
    seedOwnerLead(database);
    database.close();
    const port = await freeLoopbackPort();
    const baseUrl = `http://127.0.0.1:${port}`;
    server = startNextServer(baseUrl, databasePath, serverLogs);
    await waitForServer(baseUrl, server);
    result = await runBrowserAcceptance(baseUrl, outputDirectory);
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
