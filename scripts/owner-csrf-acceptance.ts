import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type Database from "better-sqlite3";
import type { BrowserContext } from "playwright";

export async function verifyOwnerCsrf(input: {
  context: BrowserContext; baseUrl: string; database: Database.Database;
}) {
  const { context, baseUrl, database } = input;
  assert.equal(new URL(baseUrl).hostname, "127.0.0.1");
  const row = database.prepare('INSERT INTO "Lead" (businessName,niche,city,isArchived) VALUES (?,?,?,0)')
    .run("CSRF disposable fixture", "Synthetic", "Synthetic");
  const id = Number(row.lastInsertRowid);
  const body = { action: "archive", ids: [id] };
  const archived = () => (database.prepare('SELECT isArchived FROM "Lead" WHERE id = ?').get(id) as { isArchived: number }).isArchived;
  const page = await context.newPage();
  const attackerServer = createServer((_request, response) => {
    response.setHeader("Content-Type", "text/html");
    response.end("<!doctype html><title>Local adversarial fixture</title>");
  });
  try {
    // A normal authenticated action is preserved, not disabled to pass security.
    assert.equal((await context.request.post(`${baseUrl}/api/vault/bulk`, {
      headers: { origin: baseUrl }, data: body,
    })).status(), 200);
    assert.equal(archived(), 1);
    database.prepare('UPDATE "Lead" SET isArchived = 0 WHERE id = ?').run(id);

    const deniedHeaders: Record<string, string>[] = [{}, { origin: "null" }, { origin: "https://foreign.example.invalid" },
      { origin: baseUrl, "sec-fetch-site": "same-site" }];
    for (const headers of deniedHeaders) {
      const response = await context.request.post(`${baseUrl}/api/vault/bulk`, { headers, data: body });
      assert.equal(response.status(), 403);
      assert.equal(response.headers()["cache-control"], "private, no-store");
      assert.equal(archived(), 0);
    }

    // Synthetic same-site attacker uses another loopback port, never a remote
    // domain or prospect. A real response preserves browser network semantics.
    await new Promise<void>((resolve, reject) => {
      attackerServer.once("error", reject);
      attackerServer.listen(0, "127.0.0.1", resolve);
    });
    const attacker = `http://127.0.0.1:${(attackerServer.address() as AddressInfo).port}`;
    assert.notEqual(attacker, baseUrl);
    await page.route(`${attacker}/**`, route => route.continue());
    await page.goto(`${attacker}/fixture`);
    const [response] = await Promise.all([
      page.waitForResponse(response => response.url() === `${baseUrl}/api/vault/bulk`),
      page.evaluate(async ({ baseUrl, body }) => {
      await fetch(`${baseUrl}/api/vault/bulk`, { method: "POST", mode: "no-cors", credentials: "include",
        headers: { "Content-Type": "text/plain" }, body: JSON.stringify(body) });
      }, { baseUrl, body }),
    ]);
    assert.equal(response.status(), 403, "A same-site foreign page must not archive leads with the owner's cookie.");
    // Intercepted Playwright request metadata can omit browser-added network
    // headers. Prove the actual POST, response and stored outcome instead.
    assert.equal(response.request().method(), "POST");
    assert.equal(response.request().postData(), JSON.stringify(body));
    assert.equal(archived(), 0);
  } finally {
    await page.close();
    attackerServer.closeAllConnections();
    if (attackerServer.listening) await new Promise<void>(resolve => attackerServer.close(() => resolve()));
    database.prepare('DELETE FROM "Lead" WHERE id = ?').run(id);
  }
}
