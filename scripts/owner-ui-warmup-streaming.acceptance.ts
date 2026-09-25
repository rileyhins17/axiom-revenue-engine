import assert from "node:assert/strict";
import { createServer, type ServerResponse } from "node:http";

import type { Browser, BrowserContext, Page } from "playwright";

const WARM_ROUTES = [
  { path: "/leads", heading: "Businesses", script: "/warmup-script/leads.js" },
  {
    path: "/leads/business:owner-acceptance-roofing",
    heading: "Tri-City Roofing Fixture",
    script: "/warmup-script/business.js",
  },
  { path: "/leads/evaluation", heading: "Quality Lab", script: "/warmup-script/evaluation.js" },
] as const;

type ScriptState = {
  route: typeof WARM_ROUTES[number];
  finished: boolean;
  response: ServerResponse;
};

function pageMarkup(route: typeof WARM_ROUTES[number]): string {
  return `<!doctype html><html><body><h1>${route.heading}</h1><script async src="${route.script}"></script></body></html>`;
}

function finishScript(state: ScriptState, timers: Set<ReturnType<typeof setTimeout>>, timer: ReturnType<typeof setTimeout>): void {
  if (state.finished || state.response.destroyed) return;
  const qualityLabReady = state.route.path === "/leads/evaluation"
    ? "document.documentElement.dataset.qualityLabReady = 'true';"
    : "";
  state.response.write(`];window.__warmupComplete = true;${qualityLabReady}`);
  state.response.end();
  timers.delete(timer);
}

/**
 * Reproduces a browser moving between SSR pages while each page still has an
 * async streamed script. The callback deliberately records early transitions
 * and reports them after the server is closed so an HTTP callback cannot throw.
 */
export async function verifyOwnerWarmupStreaming(
  browser: Browser,
  warmRoutes: (page: Page) => Promise<void>,
): Promise<void> {
  const routeByPath = new Map<string, typeof WARM_ROUTES[number]>(WARM_ROUTES.map((route) => [route.path, route]));
  const routeByScript = new Map<string, typeof WARM_ROUTES[number]>(WARM_ROUTES.map((route) => [route.script, route]));
  const completed = new Set<string>();
  const documentRequests: string[] = [];
  const earlyTransitions: string[] = [];
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let activeScript: ScriptState | null = null;
  let firstScriptDocumentCount: number | null = null;

  const server = createServer((request, response) => {
    const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    const route = routeByPath.get(pathname);
    if (route) {
      if (activeScript && !activeScript.finished) earlyTransitions.push(`${activeScript.route.path} -> ${pathname}`);
      documentRequests.push(pathname);
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(pageMarkup(route));
      return;
    }

    const scriptRoute = routeByScript.get(pathname);
    if (!scriptRoute) {
      response.writeHead(404);
      response.end();
      return;
    }

    const state: ScriptState = { route: scriptRoute, finished: false, response };
    firstScriptDocumentCount ??= documentRequests.length;
    activeScript = state;
    response.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
    response.write("window.__warmup = [");
    const timer = setTimeout(() => finishScript(state, timers, timer), 200);
    timers.add(timer);
    response.once("finish", () => {
      state.finished = true;
      completed.add(state.route.path);
    });
    response.once("close", () => {
      if (!state.finished) clearTimeout(timer);
    });
  });

  const address = await new Promise<{ port: number }>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const value = server.address();
      if (!value || typeof value === "string") return reject(new Error("Warmup server did not expose an address."));
      resolve({ port: value.port });
    });
  });

  let context: BrowserContext | null = null;
  try {
    context = await browser.newContext({ baseURL: `http://127.0.0.1:${address.port}` });
    const page = await context.newPage();
    await warmRoutes(page);
  } finally {
    try {
      if (context) await context.close();
    } finally {
      for (const timer of timers) clearTimeout(timer);
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }

  assert.equal(firstScriptDocumentCount, 4, "All three SSR routes must finish HTTP preparation before a browser requests the first script.");
  const expectedPaths = WARM_ROUTES.map((route) => route.path);
  assert.deepEqual(documentRequests, [...expectedPaths, ...expectedPaths], "Warmup must prepare the SSR routes, then visit them in the browser.");
  assert.deepEqual(earlyTransitions, [], `Warmup navigated before the prior async script finished: ${earlyTransitions.join(", ")}`);
  assert.deepEqual([...completed].sort(), WARM_ROUTES.map((route) => route.path).sort(), "Not every warmup script completed.");
}
