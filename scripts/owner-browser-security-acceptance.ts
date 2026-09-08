import assert from "node:assert/strict";
import type { BrowserContext } from "playwright";
import { browserSecurityHeaders } from "../src/lib/browser-security-headers";

export async function verifyOwnerBrowserSecurity(context: BrowserContext, baseUrl: string) {
  assert.equal(new URL(baseUrl).hostname, "127.0.0.1");
  for (const path of ["/sign-in", "/leads", "/offline", "/api/vault/leads", "/sw.js", "/icons/icon-192.png", "/manifest.webmanifest", "/missing-security-fixture.txt"]) {
    const response = await context.request.get(`${baseUrl}${path}`);
    assert.equal(response.status(), path === "/missing-security-fixture.txt" ? 404 : 200, path);
    for (const { key, value } of browserSecurityHeaders) {
      assert.equal(response.headers()[key.toLowerCase()], value, `${path}: ${key}`);
    }
    assert.equal(response.headers()["strict-transport-security"], undefined);
  }
  const denied = await context.request.post(`${baseUrl}/api/vault/bulk`, { data: {} });
  assert.equal(denied.status(), 403);
  assert.equal(denied.headers()["cache-control"], "private, no-store");
  assert.match(denied.headers()["content-type"], /application\/json/);
  for (const { key, value } of browserSecurityHeaders) assert.equal(denied.headers()[key.toLowerCase()], value);
  const page = await context.newPage();
  try {
    await page.goto(`${baseUrl}/leads`);
    // The stricter script policy is observational: normal hydration must work.
    await page.getByRole("heading", { level: 1 }).waitFor();
    const observation = await page.evaluate(() => new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Missing report-only CSP observation")), 5000);
      document.addEventListener("securitypolicyviolation", (event: SecurityPolicyViolationEvent) => {
        if (event.disposition !== "report" || event.effectiveDirective !== "script-src-elem") return;
        clearTimeout(timer);
        // Only directive/disposition, never URLs or script/message contents.
        resolve(`${event.disposition}:${event.effectiveDirective}`);
      });
      const script = document.createElement("script");
      script.textContent = 'document.body.setAttribute("data-csp-observation", "executed")';
      document.body.appendChild(script);
    }));
    assert.equal(observation, "report:script-src-elem");
    assert.equal(await page.locator("body").getAttribute("data-csp-observation"), "executed");
    const blocked = page.waitForEvent("console", { predicate: message =>
      /framing|frame-ancestors|X-Frame-Options/i.test(message.text()) && !/report-only/i.test(message.text()) });
    await page.evaluate(() => {
      const iframe = document.createElement("iframe");
      iframe.id = "blocked-console-frame";
      iframe.src = "/leads";
      document.body.appendChild(iframe);
    });
    await blocked;
    assert.equal(await page.frameLocator("#blocked-console-frame").getByRole("heading", { level: 1 }).count(), 0);
    // Restricting who can frame the console must preserve sandboxed email previews.
    await page.evaluate(() => {
      const iframe = document.createElement("iframe");
      iframe.id = "safe-email-preview";
      iframe.setAttribute("sandbox", "");
      iframe.srcdoc = '<!doctype html><style>p{color:blue}</style><p>Safe synthetic email preview</p>';
      document.body.appendChild(iframe);
    });
    await page.frameLocator("#safe-email-preview").getByText("Safe synthetic email preview").waitFor();
  } finally { await page.close(); }
}
