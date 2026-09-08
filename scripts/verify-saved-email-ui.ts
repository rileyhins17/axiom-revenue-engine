import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync, readdirSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium, type Browser } from "playwright";
import { handleSavedEmailHistory } from "../src/lib/revenue-engine/saved-email-history";
import { savedHistoryFixture } from "./fixtures/saved-history";

let stage = "setup";

/** Real component + real saved-history handler on loopback, synthetic auth and DB.
 * Run AFTER the Next/OpenNext build exits: styles come from its actual CSS output.
 * No new app route, provider, send action, production DB or hosted preview. */
async function main() {
  const root = resolve(".");
  assert.equal(root.replaceAll("\\", "/").toLowerCase(), "c:/users/riley/documents/chatgpt/ape");
  const fixture = savedHistoryFixture();
  let browser: Browser | undefined;
  let mode: "normal" | "unavailable" | "malformed" | "slow" = "normal";
  let releaseSlow = () => {};
  const external: string[] = [], methods: string[] = [], errors: string[] = [];
  const cssPaths = readdirSync(resolve(".next/static"), { recursive: true }).filter((name): name is string => typeof name === "string" && name.endsWith(".css"));
  assert(cssPaths.length, "Build the app before checking the actual component styling");
  const css = cssPaths.map(name => readFileSync(resolve(".next/static", name), "utf8")).join("\n");
  const bundle = await build({ write: false, bundle: true, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' }, stdin: { loader: "tsx", resolveDir: root, contents: `
      import React from "react";
      import { createRoot } from "react-dom/client";
      import { EmailThreadPanel } from "./src/components/clients/email-thread";
      const root = createRoot(document.getElementById("app"));
      window.fixtureClient = (id) => root.render(<EmailThreadPanel leadId={id} leadName={"Synthetic client " + id} leadEmail={null} />);
      window.fixtureClient(1);
    ` } });
  const server = createServer(async (req, res) => {
    try {
      methods.push(req.method ?? "");
      if (req.method !== "GET") { res.writeHead(405).end(); return; }
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (url.pathname === "/") {
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Saved email activity — synthetic local verification</title><link rel="stylesheet" href="/style.css"></head><body style="background:#09090b;color:#e4e4e7;padding:24px"><main style="max-width:1100px;margin:auto"><h1 style="font-size:24px;margin-bottom:20px">Client email activity · local test</h1><div id="app"></div></main><script src="/fixture.js"></script></body></html>');
      } else if (url.pathname === "/fixture.js") {
        res.setHeader("Content-Type", "application/javascript"); res.end(bundle.outputFiles[0].text);
      } else if (url.pathname === "/style.css") {
        res.setHeader("Content-Type", "text/css"); res.end(css);
      } else if (/^\/api\/clients\/[12]\/emails$/.test(url.pathname)) {
        if (mode === "slow" && url.pathname.includes("/1/")) await new Promise<void>(resolveSlow => { releaseSlow = resolveSlow; });
        if (mode === "unavailable") { res.writeHead(503, { "Content-Type": "application/json" }).end('{"error":"synthetic unavailable"}'); return; }
        if (mode === "malformed") { res.writeHead(200, { "Content-Type": "application/json" }).end('{"source":"SAVED_OUTBOUND_ONLY","records":null}'); return; }
        const response = await handleSavedEmailHistory(new Request(url), url.pathname.split("/")[3], fixture.actor, () => fixture.database);
        res.writeHead(response.status, Object.fromEntries(response.headers.entries())); res.end(await response.text());
      } else { res.writeHead(204).end(); }
    } catch { res.writeHead(500).end("Synthetic test server failed"); }
  });
  try {
    for (let n = 1; n <= 7; n++) await fixture.record(n, n === 6 ? "UNKNOWN" : n === 5 ? "REJECTED" : "SENT");
    const changes = fixture.changes(), sends = fixture.sends();
    await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
    const address = server.address(); assert(address && typeof address !== "string");
    const origin = `http://127.0.0.1:${address.port}`;
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ reducedMotion: "reduce" });
    await context.route("**/*", async route => {
      if (new URL(route.request().url()).origin === origin) await route.continue();
      else { external.push(route.request().url()); await route.abort(); }
    });
    const page = await context.newPage();
    page.on("pageerror", error => errors.push(error.message));
    const output = resolve("output/playwright/saved-email-history"); mkdirSync(output, { recursive: true });
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
      stage = `render ${viewport.width}`;
      await page.setViewportSize(viewport);
      await page.goto(origin);
      await page.getByText("Page 1 · 5 saved records", { exact: true }).waitFor();
      assert.equal(await page.getByRole("button", { name: /^Reply$|^Send$|Generate/ }).count(), 0);
      await page.getByText("View exact saved message", { exact: true }).first().focus();
      await page.keyboard.press("Enter");
      await page.getByText('Exact body 7. <img src="https://tracking.invalid/pixel">', { exact: true }).waitFor();
      assert.equal(await page.locator("img, iframe").count(), 0);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      assert.equal(overflow, false, "Mobile page must not overflow horizontally");
      stage = `accessibility ${viewport.width}`;
      await page.addScriptTag({ path: createRequire(import.meta.url).resolve("axe-core/axe.min.js") });
      const violations = await page.evaluate(async () => {
        const axe = (window as unknown as { axe: { run: (options: unknown) => Promise<{ violations: Array<{ id: string; impact: string }> }> } }).axe;
        return (await axe.run({ runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"] } })).violations;
      });
      assert.deepEqual(violations, []);
      await page.screenshot({ path: resolve(output, viewport.width > 1000 ? "desktop.png" : "mobile.png"), fullPage: true });
      stage = `pagination ${viewport.width}`;
      await page.getByRole("button", { name: "Older records", exact: true }).click();
      await page.getByText("Page 2 · 2 saved records", { exact: true }).waitFor();
      assert(await page.getByRole("button", { name: "Older records", exact: true }).isDisabled());
      await page.getByRole("button", { name: "Newer records", exact: true }).click();
      await page.getByText("Page 1 · 5 saved records", { exact: true }).waitFor();
    }
    for (const failure of ["unavailable", "malformed"] as const) {
      stage = failure;
      mode = failure;
      await page.getByRole("button", { name: "Refresh saved records" }).click();
      await page.getByText("Saved records could not be loaded. No mailbox was contacted.", { exact: true }).waitFor();
      assert.equal(await page.getByText("Saved reply 7", { exact: true }).count(), 0);
      mode = "normal";
      await page.getByRole("button", { name: "Try reading again" }).click();
      await page.getByText("Page 1 · 5 saved records", { exact: true }).waitFor();
    }
    mode = "slow";
    stage = "client switching";
    const requested = page.waitForRequest(request => request.url().includes("/api/clients/1/emails"));
    await page.getByRole("button", { name: "Refresh saved records" }).click(); await requested;
    await page.getByText("Loading saved records…", { exact: true }).waitFor();
    await page.evaluate(() => (window as unknown as { fixtureClient: (id: number) => void }).fixtureClient(2));
    await page.getByText("No saved outgoing replies for this client. This does not mean their inbox is empty.", { exact: true }).waitFor();
    mode = "normal"; releaseSlow();
    assert.equal(await page.getByText("Saved reply 7", { exact: true }).count(), 0);
    stage = "side-effect assertions";
    assert.equal(fixture.changes(), changes);
    assert.equal(fixture.sends(), sends);
    assert.deepEqual(external, []); assert.deepEqual(errors, []);
    assert(methods.every(method => method === "GET"));
    console.log("Saved-email browser checks passed: desktop/mobile, keyboard, WCAG AA, pagination, failures, client switching, plain-text safety; zero external requests or new writes/sends.");
    console.log("Screenshots: output/playwright/saved-email-history/desktop.png and mobile.png (synthetic local data).");
  } finally {
    releaseSlow(); await browser?.close();
    server.closeAllConnections(); await new Promise<void>(done => server.close(() => done())); fixture.close();
  }
}

main().catch(() => { console.error(`Saved-email browser verification failed at ${stage}; no private records or credentials logged.`); process.exitCode = 1; });
