import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import Database from "better-sqlite3";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

import { verifyOwnerWarmupStreaming } from "./owner-ui-warmup-streaming.acceptance";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(SCRIPT_DIR, "..");
const OUTPUT_ROOT = join(REPOSITORY_ROOT, "output", "playwright");
// getM2OwnerIdentityActor only recognizes these two literal addresses; the
// fixture signs in as Riley so /api/prospects/activity accepts its writes.
const FIXTURE_EMAIL = "riley@getaxiom.ca";
const FIXTURE_PASSWORD = "owner-acceptance-only-password";
const TEST_AUTH_SECRET = "owner-ui-acceptance-only-secret-00000000000000000000";
const AXE_PATH = createRequire(import.meta.url).resolve("axe-core/axe.min.js");
const DESKTOP_VIEWPORT = { width: 1440, height: 1000 };
const MOBILE_VIEWPORT = { width: 390, height: 844 };

type SqliteDatabase = InstanceType<typeof Database>;

type AxeViolation = {
  id: string;
  impact: string | null;
  help: string;
  nodes: Array<{ target: string[]; html: string; failureSummary?: string }>;
};

type AcceptanceResult = {
  pagesScanned: number;
  externalRequests: number;
  desktopWidth: number;
  mobileWidth: number;
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
    diagnostics.push({ capturedAt: new Date().toISOString(), stage: getStage(), ...diagnostic });
  };
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    record({ kind: "console-error", url: message.location().url || page.url(), message: message.text() });
  });
  page.on("pageerror", (error) => {
    record({ kind: "page-error", url: page.url(), message: error.message, name: error.name, stack: error.stack ?? null });
  });
  page.on("requestfailed", (request) => {
    record({ kind: "request-failed", url: request.url(), message: request.failure()?.errorText ?? "Request failed" });
  });
  page.on("response", (response) => {
    const status = response.status();
    if (status < 500 || new URL(response.url()).origin !== baseOrigin) return;
    record({ kind: "http-error", url: response.url(), message: `HTTP ${status}`, status });
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

// Kept for scripts/verify-owner-ui-acceptance.test.ts, which unit-tests this
// generic CSS-duration parser independently of the browser acceptance flow.
export function cssTimeToMilliseconds(value: string) {
  const trimmed = value.trim();
  if (trimmed.endsWith("ms")) return Number.parseFloat(trimmed.slice(0, -2));
  if (trimmed.endsWith("s")) return Number.parseFloat(trimmed.slice(0, -1)) * 1_000;
  return Number.NaN;
}

export function isAllowedOwnerAcceptanceUrl(rawUrl: string, baseUrl: string) {
  const value = new URL(rawUrl);
  if (value.protocol === "data:" || value.protocol === "about:") return true;
  if (value.protocol === "blob:") return value.origin === new URL(baseUrl).origin;
  return value.origin === new URL(baseUrl).origin;
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
  // The new owner app (Today / Call list / Settings) needs the full schema
  // history through connected calling, including the legacy-write guards.
  const migrations = (await readdir(migrationsDirectory))
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .sort((left, right) => left.localeCompare(right));
  assert(migrations.at(-1)?.startsWith("0079_"),
    "The owner fixture must apply every migration through 0079_connected_caller.");
  database.pragma("foreign_keys = ON");
  for (const migration of migrations) {
    database.exec(await readFile(join(migrationsDirectory, migration), "utf8"));
  }
}

function fixtureTimestamp(offsetMilliseconds: number) {
  return new Date(Date.now() + offsetMilliseconds).toISOString();
}

export function torontoToday(offsetDays = 0) {
  const date = new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1_000);
  return date.toLocaleDateString("en-CA", { timeZone: "America/Toronto" });
}

export const FIXTURE_PROSPECTS = [
  {
    prospectId: "prospect:sunrise-roofing", name: "Sunrise Roofing Co", city: "KITCHENER", niche: "ROOFING",
    websiteUrl: "https://sunrise-roofing.example.com", phone: "+15195550111", address: "45 King Street West",
    label: "STRONG" as const, reasons: ["Site has no contact page", "Not mobile friendly"],
  },
  {
    prospectId: "prospect:waterloo-comfort-hvac", name: "Waterloo Comfort HVAC", city: "WATERLOO", niche: "HVAC",
    websiteUrl: null, phone: "+15195550122", address: null,
    label: "NO_WEBSITE" as const, reasons: ["No website found"],
  },
  {
    prospectId: "prospect:cambridge-green-landscaping", name: "Cambridge Green Landscaping", city: "CAMBRIDGE", niche: "LANDSCAPING",
    websiteUrl: "https://cambridge-green-landscaping.example.com", phone: "+15195550133", address: "12 Water Street",
    label: "WEAK" as const, reasons: ["Site looks fine"],
  },
  {
    prospectId: "prospect:kitchener-peak-roofing", name: "Kitchener Peak Roofing", city: "KITCHENER", niche: "ROOFING",
    websiteUrl: null, phone: null, address: "88 Frederick Street",
    label: "NO_WEBSITE" as const, reasons: ["No website found", "Listed address only"],
  },
  {
    prospectId: "prospect:boundary-hvac-services", name: "Boundary HVAC Services", city: "WATERLOO", niche: "HVAC",
    websiteUrl: "https://boundary-hvac.example.com", phone: "+15195550144", address: "200 University Avenue West",
    label: "STRONG" as const, reasons: ["No mobile menu", "Broken contact form"],
  },
  {
    prospectId: "prospect:cambridge-landscape-pros", name: "Cambridge Landscape Pros", city: "CAMBRIDGE", niche: "LANDSCAPING",
    websiteUrl: "https://cambridge-landscape-pros.example.com", phone: "+15195550155", address: null,
    label: "STRONG" as const, reasons: ["Outdated design", "No service pages"],
  },
] as const;

/** Six synthetic *.example businesses: a mix of STRONG (weak site), NO_WEBSITE
 * and WEAK, with a mix of phone/address presence, seeded with no activity. */
export function seedEngineProspects(database: SqliteDatabase) {
  const firstSeenAt = fixtureTimestamp(-14 * 24 * 60 * 60 * 1_000);
  const lastSeenAt = fixtureTimestamp(-60 * 60 * 1_000);
  const insert = database.prepare(`INSERT INTO "EngineProspect"
    ("prospectId","placeId","name","city","niche","websiteUrl","phone","address","label","reasons","runId","firstSeenAt","lastSeenAt")
    VALUES (?,NULL,?,?,?,?,?,?,?,?,'run:owner-ui-acceptance',?,?)`);
  const seed = database.transaction(() => {
    for (const prospect of FIXTURE_PROSPECTS) {
      insert.run(
        prospect.prospectId, prospect.name, prospect.city, prospect.niche,
        prospect.websiteUrl, prospect.phone, prospect.address, prospect.label,
        JSON.stringify(prospect.reasons), firstSeenAt, lastSeenAt,
      );
    }
    // Automatic sending stays off for the fixture regardless of the table's
    // shipped default, so the Today page's safety banner is deterministic.
    database.prepare(`UPDATE "OutreachAutomationSetting" SET "enabled" = 0, "globalPaused" = 1 WHERE "id" = 'global'`).run();
  });
  seed();
}

function startNextServer(baseUrl: string, databasePath: string, logLines: string[]) {
  const port = new URL(baseUrl).port;
  const nextBinary = join(REPOSITORY_ROOT, "node_modules", "next", "dist", "bin", "next");
  const childEnvironment: Record<string, string | undefined> = {};
  for (const key of [
    "APPDATA", "CI", "HOME", "LOCALAPPDATA", "NODE_OPTIONS", "PATH", "Path", "PATHEXT",
    "SystemRoot", "TEMP", "TMP", "TMPDIR", "USERPROFILE", "WINDIR",
  ]) {
    if (process.env[key] !== undefined) childEnvironment[key] = process.env[key];
  }
  Object.assign(childEnvironment, {
    APP_BASE_URL: baseUrl,
    AGENT_SHARED_SECRET: "",
    AUTH_ALLOWED_EMAILS: FIXTURE_EMAIL,
    AUTH_ADMIN_EMAILS: FIXTURE_EMAIL,
    AXIOM_LOCAL_SYNTHETIC_SIGNUP: "1",
    AUTH_PASSWORD_SIGNIN: "true",
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
    data: { name: "Riley Owner Acceptance", email: FIXTURE_EMAIL, password: FIXTURE_PASSWORD },
    headers: { origin: baseUrl },
  });
  const body = await response.text();
  assert.equal(response.ok(), true, `Fixture sign-up failed (${response.status()}): ${body.slice(0, 300)}`);
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

async function axeViolations(page: Page) {
  await page.addScriptTag({ path: AXE_PATH });
  return page.evaluate(async () => {
    type AxeResult = { violations: AxeViolation[] };
    type AxeRuntime = { run: (root: Document, options: unknown) => Promise<AxeResult> };
    const runtime = (globalThis as typeof globalThis & { axe: AxeRuntime }).axe;
    const result = await runtime.run(document, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] },
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
  return width.clientWidth;
}

async function assertNav(page: Page, label: string) {
  // The shadcn Sidebar (desktop, full titles like "Call list") only mounts
  // its menu markup above the mobile breakpoint; the fixed bottom tab bar
  // (nav[aria-label='Primary'], short labels like "Calls") is mobile-only.
  const isMobile = (page.viewportSize()?.width ?? DESKTOP_VIEWPORT.width) < 768;
  if (isMobile) {
    const mobileItems = await page.locator("nav[aria-label='Primary'] a[href]").evaluateAll((elements) =>
      elements.map((element) => element.textContent?.trim() ?? ""));
    assert.deepEqual(mobileItems, ["Today", "Queue", "List", "Walk-ins", "Email", "Ask AI", "Settings"], `${label} mobile tab bar must list the six owner pages.`);
  } else {
    const sidebarItems = await page.locator(".owner-nav-title").evaluateAll((elements) =>
      elements.map((element) => element.textContent?.trim() ?? ""));
    assert.deepEqual(sidebarItems, ["Today", "Call queue", "Call list", "Walk-ins", "Email", "Ask AI", "Settings"], `${label} sidebar navigation must be the six owner pages.`);
  }
}

/** Prepare every owner route over HTTP before the browser reads any script,
 * then load each one and wait for its 'load' event before opening the next —
 * an SSR heading is not proof that async script streaming finished. */
export async function warmOwnerAcceptanceRoutes(page: Page, extraRoutes: string[] = []) {
  for (const route of ["/dashboard", "/prospects", "/call", "/walk-ins", "/email", ...extraRoutes]) {
    const response = await page.context().request.get(route);
    try {
      assert.equal(response.status(), 200, `Owner route preparation failed: ${route}`);
      await response.body();
    } finally {
      await response.dispose();
    }
  }
  await page.goto("/dashboard", { waitUntil: "load" });
  await page.getByRole("heading", { level: 1 }).waitFor();
  await page.goto("/prospects", { waitUntil: "load" });
  await page.getByRole("heading", { level: 1, name: "Call list" }).waitFor();
  for (const route of extraRoutes) await page.goto(route, { waitUntil: "load" });
}

async function runBrowserAcceptance(baseUrl: string, outputDirectory: string) {
  let browser: Browser | null = null;
  let page: Page | null = null;
  let warmupPage: Page | null = null;
  const externalRequests: string[] = [];
  const diagnostics: BrowserDiagnostic[] = [];
  const drainScriptDiagnostics: Array<() => Promise<void>> = [];
  let pagesScanned = 0;
  let stage = "startup";
  try {
    browser = await chromium.launch({ headless: true });
    // Keeps the OPS-012/BUILD-006 streaming regression: this drives an
    // isolated mock server, unrelated to the real app under test.
    await verifyOwnerWarmupStreaming(browser, async (mockPage) => {
      const mockRoutes = ["/leads", "/leads/business:owner-acceptance-roofing", "/leads/evaluation"];
      for (const route of mockRoutes) {
        const response = await mockPage.context().request.get(route);
        try {
          await response.body();
        } finally {
          await response.dispose();
        }
      }
      await mockPage.goto("/leads", { waitUntil: "load" });
      await mockPage.getByRole("heading", { level: 1, name: "Businesses" }).waitFor();
      await mockPage.goto("/leads/business:owner-acceptance-roofing", { waitUntil: "load" });
      await mockPage.getByRole("heading", { level: 1, name: "Tri-City Roofing Fixture" }).waitFor();
      await mockPage.goto("/leads/evaluation", { waitUntil: "load" });
      await mockPage.getByRole("heading", { level: 1, name: "Quality Lab" }).waitFor();
    });

    const anonymous = await browser!.newContext({ baseURL: baseUrl, serviceWorkers: "block" });
    await anonymous.route("**/*", async (route) => {
      const url = route.request().url();
      if (isAllowedOwnerAcceptanceUrl(url, baseUrl)) await route.continue();
      else { externalRequests.push(url); await route.abort("blockedbyclient"); }
    });

    stage = "unauthenticated dashboard redirect";
    const anonymousDashboard = await anonymous.newPage();
    await anonymousDashboard.goto("/dashboard", { waitUntil: "load" });
    await anonymousDashboard.waitForURL("**/sign-in");
    await anonymousDashboard.getByRole("heading", { level: 1, name: "Who's signing in?" }).waitFor();
    await anonymousDashboard.screenshot({ path: join(outputDirectory, "sign-in.png") });
    await anonymousDashboard.close();

    stage = "unauthenticated prospects redirect";
    const anonymousProspects = await anonymous.newPage();
    await anonymousProspects.goto("/prospects", { waitUntil: "load" });
    await anonymousProspects.waitForURL("**/sign-in");
    await anonymousProspects.close();
    await anonymous.close();

    // The owner shell hardcodes `<html class="dark">` (src/app/layout.tsx)
    // while its own `.owner-app-shell` chrome hardcodes a fixed light "paper"
    // ink/background pair (src/app/globals.css) — colorScheme emulation does
    // not change either, so it is left at its default here.
    const context = await browser.newContext({
      baseURL: baseUrl,
      reducedMotion: "reduce",
      serviceWorkers: "block",
      viewport: DESKTOP_VIEWPORT,
    });
    await context.route("**/*", async (route) => {
      const requestUrl = route.request().url();
      if (isAllowedOwnerAcceptanceUrl(requestUrl, baseUrl)) await route.continue();
      else { externalRequests.push(requestUrl); await route.abort("blockedbyclient"); }
    });
    await authenticate(context, baseUrl);

    stage = "owner route warmup";
    warmupPage = await context.newPage();
    attachBrowserDiagnostics(warmupPage, () => stage, diagnostics, baseUrl);
    drainScriptDiagnostics.push(await attachBrowserScriptDiagnostics(context, warmupPage, () => stage, diagnostics, outputDirectory));
    await warmOwnerAcceptanceRoutes(warmupPage, ["/settings"]);
    await warmupPage.close();

    page = await context.newPage();
    attachBrowserDiagnostics(page, () => stage, diagnostics, baseUrl);
    drainScriptDiagnostics.push(await attachBrowserScriptDiagnostics(context, page, () => stage, diagnostics, outputDirectory));

    stage = "desktop today";
    await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { level: 1 }).waitFor();
    await page.getByText("Results so far", { exact: true }).waitFor();
    await page.getByText("Follow-ups due", { exact: true }).waitFor();
    await page.getByText("Start calling", { exact: false }).first().waitFor();
    await assertNav(page, "desktop Today");
    await assertWcag(page, "desktop Today");
    pagesScanned += 1;
    const desktopWidth = await assertResponsive(page, "desktop Today");
    await page.screenshot({ path: join(outputDirectory, "today-desktop.png"), fullPage: true });

    stage = "desktop call list";
    await page.goto("/prospects", { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { level: 1, name: "Call list" }).waitFor();
    const table = page.locator("table");
    await table.waitFor();
    for (const prospect of FIXTURE_PROSPECTS) {
      const expectVisible = prospect.label === "STRONG" || prospect.label === "NO_WEBSITE";
      const count = await table.getByText(prospect.name, { exact: true }).count();
      assert.equal(count, expectVisible ? 1 : 0,
        `"To call" must ${expectVisible ? "show" : "hide"} ${prospect.name} (label ${prospect.label}).`);
    }
    await assertNav(page, "desktop Call list");
    await assertWcag(page, "desktop Call list");
    pagesScanned += 1;
    await assertResponsive(page, "desktop Call list");
    await page.screenshot({ path: join(outputDirectory, "prospects-desktop.png"), fullPage: true });

    stage = "call list city filter";
    await page.getByRole("link", { name: "Kitchener", exact: true }).click();
    await page.waitForURL(/city=KITCHENER/);
    await page.waitForLoadState("networkidle");
    await table.getByText("Sunrise Roofing Co", { exact: true }).waitFor();
    assert.equal(await table.getByText("Waterloo Comfort HVAC", { exact: true }).count(), 0,
      "The Kitchener filter must narrow out Waterloo businesses.");
    await page.goto("/prospects", { waitUntil: "domcontentloaded" });

    stage = "call list search filter";
    await page.getByRole("textbox", { name: "Search" }).fill("Boundary");
    await page.getByRole("textbox", { name: "Search" }).press("Enter");
    await page.waitForURL(/q=Boundary/);
    await page.waitForLoadState("networkidle");
    await table.getByText("Boundary HVAC Services", { exact: true }).waitFor();
    assert.equal(await table.getByText("Sunrise Roofing Co", { exact: true }).count(), 0,
      "The search filter must narrow the list to the matching business.");
    await page.goto("/prospects", { waitUntil: "domcontentloaded" });

    stage = "log a call with a follow-up";
    const sunriseRow = page.locator("tr").filter({ hasText: "Sunrise Roofing Co" }).first();
    await sunriseRow.getByRole("button", { name: "Log" }).click();
    await page.getByRole("button", { name: "Call", exact: true }).click();
    await page.getByRole("button", { name: "Call back later", exact: true }).click();
    const followUpDate = torontoToday(0);
    await page.locator("input[type='date']").fill(followUpDate);
    await page.getByRole("button", { name: "Save" }).click();
    await page.getByText("Saved", { exact: true }).waitFor();

    stage = "call log persists and moves to follow-ups";
    await page.reload({ waitUntil: "domcontentloaded" });
    const reloadedSunriseRow = page.locator("tr").filter({ hasText: "Sunrise Roofing Co" }).first();
    await reloadedSunriseRow.getByText("Call back later", { exact: true }).waitFor();
    await reloadedSunriseRow.getByRole("button", { name: "Log" }).click();
    await page.getByText("No calls or visits yet.", { exact: true }).waitFor({ state: "detached" }).catch(() => undefined);
    assert.equal(await page.getByText(/Call back later/, { exact: false }).count() >= 1, true,
      "The saved activity must appear in the row's history after reload.");
    await page.goto("/prospects?view=followups", { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { level: 1, name: "Call list" }).waitFor();
    await page.locator("table").getByText("Sunrise Roofing Co", { exact: true }).waitFor();

    stage = "retried activity submission does not double-save";
    const retryKey = randomUUID();
    const retryBody = {
      idempotencyKey: retryKey, prospectId: "prospect:boundary-hvac-services",
      channel: "CALL", outcome: "NO_ANSWER", note: "Synthetic retry probe.", followUpAt: null,
    };
    const firstAttempt = await context.request.post("/api/prospects/activity", { data: retryBody, headers: { origin: baseUrl } });
    assert.equal(firstAttempt.status(), 201, "The first activity submission must save.");
    await firstAttempt.dispose();
    const retriedAttempt = await context.request.post("/api/prospects/activity", { data: retryBody, headers: { origin: baseUrl } });
    assert.equal(retriedAttempt.status(), 200, "A retried submission with the same idempotency key must not create a new row.");
    const retriedBody = await retriedAttempt.json() as { status?: string };
    assert.equal(retriedBody.status, "ALREADY_SAVED", "A retried submission must report it was already saved.");
    await retriedAttempt.dispose();
    await page.goto("/prospects", { waitUntil: "domcontentloaded" });
    const boundaryRow = page.locator("tr").filter({ hasText: "Boundary HVAC Services" }).first();
    await boundaryRow.getByRole("button", { name: "Log" }).click();
    const historyEntries = page.locator("li").filter({ hasText: "No answer" });
    assert.equal(await historyEntries.count(), 1, "The retried submission must not double-save the history entry.");

    stage = "do-not-contact removes the row from To call";
    await page.goto("/prospects", { waitUntil: "domcontentloaded" });
    const landscapeRow = page.locator("tr").filter({ hasText: "Cambridge Landscape Pros" }).first();
    await landscapeRow.getByRole("button", { name: "Log" }).click();
    await page.getByRole("button", { name: "Call", exact: true }).click();
    await page.getByRole("button", { name: "Do not contact", exact: true }).click();
    await page.getByRole("button", { name: "Save" }).click();
    await page.getByText("Saved", { exact: true }).waitFor();
    await page.goto("/prospects", { waitUntil: "domcontentloaded" });
    assert.equal(await page.locator("table").getByText("Cambridge Landscape Pros", { exact: true }).count(), 0,
      "A DO_NOT_CONTACT outcome must remove the business from the To call list.");

    stage = "call queue logs with the keyboard and moves on";
    await page.goto("/call", { waitUntil: "load" });
    await page.getByRole("heading", { level: 1, name: "Call queue" }).waitFor();
    const firstBusiness = (await page.getByRole("heading", { level: 2 }).first().textContent())?.trim() ?? "";
    assert(firstBusiness, "The queue must show a business.");
    await assertWcag(page, "desktop Call queue");
    pagesScanned += 1;
    await page.screenshot({ path: join(outputDirectory, "call-queue-active.png"), fullPage: true });
    await page.keyboard.press("1");
    await page.getByRole("button", { name: /No answer/ }).and(page.locator('[aria-pressed="true"]')).waitFor();
    await page.keyboard.press("Control+Enter");
    await page.waitForFunction((name) => {
      const heading = document.querySelector("main h2, section h2");
      return !heading || heading.textContent?.trim() !== name;
    }, firstBusiness, { timeout: 15_000 });
    await page.screenshot({ path: join(outputDirectory, "call-queue-desktop.png"), fullPage: true });

    stage = "walk-ins and email pages";
    await page.goto("/walk-ins", { waitUntil: "load" });
    await page.getByRole("heading", { level: 1, name: "Walk-ins" }).waitFor();
    await assertWcag(page, "desktop Walk-ins");
    pagesScanned += 1;
    await page.goto("/email", { waitUntil: "load" });
    await page.getByRole("heading", { level: 1, name: "Email" }).waitFor();
    await page.getByText("Automatic email is off", { exact: true }).waitFor();
    await assertWcag(page, "desktop Email");
    pagesScanned += 1;
    await page.screenshot({ path: join(outputDirectory, "email-desktop.png"), fullPage: true });

    stage = "ask ai page";
    await page.goto("/ask", { waitUntil: "load" });
    await page.getByRole("heading", { level: 1, name: "Ask AI" }).waitFor();
    await assertWcag(page, "desktop Ask AI");
    pagesScanned += 1;
    await page.screenshot({ path: join(outputDirectory, "ask-desktop.png"), fullPage: true });

    stage = "unsubscribe page is public";
    {
      const anonymous = await browser!.newContext({ baseURL: baseUrl });
      const unsubscribePage = await anonymous.newPage();
      await unsubscribePage.goto("/unsubscribe?done=1", { waitUntil: "load" });
      await unsubscribePage.getByText("You're unsubscribed. We won't email you again.", { exact: true }).waitFor();
      const unknown = await anonymous.request.post("/api/unsubscribe?t=" + "x".repeat(40));
      assert.equal(unknown.status(), 404, "An unknown unsubscribe token must not succeed.");
      await unknown.dispose();
      await anonymous.close();
    }

    stage = "retired routes redirect to prospects";
    for (const route of ["/leads", "/leads/prospect:sunrise-roofing", "/leads/evaluation", "/leads/m2", "/leads/m2/identity",
      "/automation", "/clients", "/clients/prospect:sunrise-roofing", "/vault"]) {
      await page.goto(route, { waitUntil: "load" });
      assert.match(page.url(), /\/prospects(?:\?.*)?$/, `Retired route ${route} must redirect to /prospects.`);
    }

    stage = "mobile viewport";
    await page.setViewportSize(MOBILE_VIEWPORT);
    await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { level: 1 }).waitFor();
    await assertNav(page, "mobile Today");
    await assertWcag(page, "mobile Today");
    pagesScanned += 1;
    const mobileWidth = await assertResponsive(page, "mobile Today");
    await page.screenshot({ path: join(outputDirectory, "today-mobile.png"), fullPage: true });

    await page.goto("/prospects", { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { level: 1, name: "Call list" }).waitFor();
    await assertNav(page, "mobile Call list");
    await assertWcag(page, "mobile Call list");
    pagesScanned += 1;
    await assertResponsive(page, "mobile Call list");
    await page.screenshot({ path: join(outputDirectory, "prospects-mobile.png"), fullPage: true });

    await context.close();
    return { pagesScanned, externalRequests: externalRequests.length, desktopWidth, mobileWidth } satisfies AcceptanceResult;
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
  try {
    await applyMigrations(database);
    seedEngineProspects(database);
    database.close();
    const port = await freeLoopbackPort();
    const baseUrl = `http://127.0.0.1:${port}`;
    // Use the completed build unchanged: development page eviction can rewrite
    // layout.js during longer owner workflows even after initial route warmup.
    server = startNextServer(baseUrl, databasePath, serverLogs);
    await waitForServer(baseUrl, server);
    result = await runBrowserAcceptance(baseUrl, outputDirectory);
    for (const name of ["today-desktop.png", "today-mobile.png", "prospects-desktop.png", "prospects-mobile.png"]) {
      await copyIfExists(join(outputDirectory, name), join(OUTPUT_ROOT, name));
    }
    success = true;
  } catch (error) {
    await writeFile(join(outputDirectory, "next-server.log"), `${serverLogs.join("\n")}\n`, "utf8");
    console.error(`Owner UI acceptance failed. Safe artifacts: ${outputDirectory}`);
    throw error;
  } finally {
    if (database.open) database.close();
    await stopServer(server);
    if (success && process.env.OWNER_UI_KEEP_SCREENSHOTS !== "1") await rm(outputDirectory, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
  }
  assert(result, "Owner UI acceptance completed without a result.");
  console.log("Owner UI acceptance passed.");
  console.log(`Responsive widths: desktop ${result.desktopWidth}px, mobile ${result.mobileWidth}px`);
  console.log(`WCAG pages scanned: ${result.pagesScanned}; external requests: ${result.externalRequests}`);
}

async function copyIfExists(from: string, to: string) {
  try {
    const { copyFile } = await import("node:fs/promises");
    await copyFile(from, to);
  } catch {
    // Screenshot capture is best-effort diagnostic output, not an assertion.
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  run().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
