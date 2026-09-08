import { rejectLegacyBrowserWork } from "@/lib/retired-legacy-browser";

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

export async function launchAutomationBrowser(): Promise<AutomationBrowser> {
  return rejectLegacyBrowserWork();
}

export async function applyScrapeResourceBlocking(context: unknown): Promise<void> {
  void context;
  return rejectLegacyBrowserWork();
}
