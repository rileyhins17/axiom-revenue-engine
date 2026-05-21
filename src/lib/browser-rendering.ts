import { getCloudflareBindings } from "@/lib/cloudflare";

export interface AutomationLocator {
  click(): Promise<void>;
  count(): Promise<number>;
  evaluateAll<TResult>(pageFunction: (elements: unknown[]) => TResult): Promise<TResult>;
  first(): AutomationLocator;
  getAttribute(name: string): Promise<string | null>;
  locator(selector: string): AutomationLocator;
  nth(index: number): AutomationLocator;
  textContent(): Promise<string | null>;
}

export interface AutomationPage {
  close(): Promise<void>;
  evaluate<TResult, TArg = unknown>(pageFunction: (arg: TArg) => TResult, arg?: TArg): Promise<TResult>;
  goto(url: string, options?: { timeout?: number; waitUntil?: string }): Promise<unknown>;
  locator(selector: string): AutomationLocator;
  url(): string;
  waitForSelector(selector: string, options?: { timeout?: number }): Promise<unknown>;
  waitForTimeout(timeoutMs: number): Promise<void>;
}

export interface AutomationBrowserContext {
  close(): Promise<void>;
  newPage(): Promise<AutomationPage>;
}

export interface AutomationBrowser {
  close(): Promise<void>;
  newContext(options?: { locale?: string }): Promise<AutomationBrowserContext>;
}

type CloudflareBrowserRegistry = Record<string, unknown>;

async function loadCloudflarePlaywright() {
  return import("@cloudflare/playwright");
}

async function loadLocalPlaywright() {
  const runtimeImport = new Function("specifier", "return import(specifier)") as (
    specifier: string,
  ) => Promise<typeof import("playwright")>;

  return runtimeImport("playwright");
}

function getLocalChromiumLaunchOptions() {
  if (process.platform === "win32") {
    return {
      headless: true,
    };
  }

  return {
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
    ],
  };
}

export async function launchAutomationBrowser(): Promise<AutomationBrowser> {
  const bindings = getCloudflareBindings();

  // Use Cloudflare Browser Rendering if available (CF Workers/Pages).
  if (bindings?.BROWSER) {
    try {
      const globalScope = globalThis as typeof globalThis & {
        __cloudflareBrowserBindings?: CloudflareBrowserRegistry;
      };
      globalScope.__cloudflareBrowserBindings ??= {};
      globalScope.__cloudflareBrowserBindings.BROWSER = bindings.BROWSER;

      const { launch } = await loadCloudflarePlaywright();
      return launch(bindings.BROWSER);
    } catch {
      // Cloudflare Playwright is unavailable, so fall back to local Playwright.
    }
  }

  // Local Playwright is used on Windows dev machines and other Node runtimes.
  const { chromium } = await loadLocalPlaywright();
  return chromium.launch(getLocalChromiumLaunchOptions());
}

/**
 * Install request-routing on a Playwright BrowserContext to abort image,
 * font, media, and tracker requests. Cuts Browser Rendering minutes ~50%
 * without affecting text/link extraction quality. Stylesheets stay enabled
 * because some sites hide email links via CSS-driven visibility states.
 */
const BLOCKED_RESOURCE_TYPES = new Set(["image", "media", "font"]);
const BLOCKED_URL_PATTERNS: RegExp[] = [
  /googletagmanager\.com/i,
  /google-analytics\.com/i,
  /googlesyndication\.com/i,
  /doubleclick\.net/i,
  /facebook\.net/i,
  /facebook\.com\/tr/i,
  /hotjar\.com/i,
  /clarity\.ms/i,
  /segment\.io/i,
  /mixpanel\.com/i,
  /sentry\.io/i,
  /cdn\.ampproject\.org/i,
  /bat\.bing\.com/i,
];

export async function applyScrapeResourceBlocking(context: unknown): Promise<void> {
  try {
    const ctx = context as { route?: (pattern: string | RegExp, handler: (route: unknown) => unknown) => Promise<void> };
    if (typeof ctx?.route !== "function") return;
    await ctx.route("**/*", (route: unknown) => {
      const r = route as {
        request: () => { url: () => string; resourceType: () => string };
        abort: () => Promise<void>;
        continue: () => Promise<void>;
      };
      try {
        const req = r.request();
        if (BLOCKED_RESOURCE_TYPES.has(req.resourceType())) {
          return r.abort();
        }
        const url = req.url();
        if (BLOCKED_URL_PATTERNS.some((re) => re.test(url))) {
          return r.abort();
        }
        return r.continue();
      } catch {
        return r.continue().catch(() => undefined);
      }
    });
  } catch (error) {
    console.warn("[browser-rendering] applyScrapeResourceBlocking failed (non-fatal):", error);
  }
}
