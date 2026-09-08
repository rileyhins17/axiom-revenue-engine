import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { setCloudflareBindings, type D1DatabaseLike } from "../src/lib/cloudflare";
import { handleSavedEmailHistory, type SavedEmailHistoryPage } from "../src/lib/revenue-engine/saved-email-history";
import { savedHistoryFixture } from "./fixtures/saved-history";

const source = ts.transpileModule(readFileSync("src/app/api/clients/[id]/emails/route.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
function route(database: () => D1DatabaseLike, denied = 0, owner = "owner", session = "owner-session") {
  const exports: { GET?: (request: Request, context: unknown) => Promise<Response> } = {};
  runInNewContext(source, { exports, Response, require(name: string) {
    if (name === "@/lib/session") return { requireAdminApiSession: async () => denied
      ? { response: new Response(null, { status: denied }) }
      : { session: { user: { id: owner }, session: { id: session } } } };
    if (name === "@/lib/cloudflare") return { getDatabase: database };
    if (name === "@/lib/revenue-engine/saved-email-history") return { handleSavedEmailHistory };
    assert.fail("Forbidden history authority/import: " + name); // Gmail, credentials and Prisma fail here.
  } }, { timeout: 1000 });
  return (leadId = "1", query = "") => exports.GET!(new Request("https://example.invalid/api/clients/" + leadId + "/emails" + query), {
    params: Promise.resolve({ id: leadId }),
  });
}

test("opening actual client email history never refreshes credentials or fetches a provider", async () => {
  const f = savedHistoryFixture();
  try {
    await f.record(1);
    const changes = f.changes();
    const sends = f.sends();
    const response = await route(() => f.database)();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    const page = await response.json() as SavedEmailHistoryPage;
    assert.equal(page.source, "SAVED_OUTBOUND_ONLY");
    assert.equal(page.records.length, 1);
    assert.equal(page.records[0].state, "SENT");
    assert.equal(page.records[0].bodyPlain, 'Exact body 1. <img src="https://tracking.invalid/pixel">');
    assert.equal(JSON.stringify(page).includes("bodyHtml"), false);
    assert.equal(JSON.stringify(page).includes("attemptToken"), false);
    assert.equal(f.changes(), changes);
    assert.equal(f.sends(), sends);
  } finally { f.close(); }
});

test("actual route denies authentication and malformed paths/cursors before opening storage", async () => {
  const noDatabase = () => { assert.fail("Denied input must not open storage"); };
  for (const status of [401, 403, 503]) {
    const response = await route(noDatabase, status)();
    assert.equal(response.status, status);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
  }
  for (const lead of ["0", "-1", "01", "1e0", "1.5", "1\n", "9007199254740992"]) {
    assert.equal((await route(noDatabase)(lead)).status, 400);
  }
  for (const query of ["?ownerId=other", "?cursor=", "?cursor=1.bad", "?cursor=1." + "a".repeat(64) + "&cursor=1." + "b".repeat(64),
    "?cursor=9007199254740992." + "a".repeat(64), "?cursor=1." + "a".repeat(64) + "%0A"]) {
    assert.equal((await route(noDatabase)("1", query)).status, 400);
  }
});

test("saved activity is isolated by current owner, session and client, including empty pages", async () => {
  const f = savedHistoryFixture();
  try {
    await f.record(1);
    await f.record(2, "SENT", "other");
    await f.record(3, "SENT", "owner", 2);
    const read = async (owner: string, session: string, lead: string) =>
      (await route(() => f.database, 0, owner, session)(lead)).json() as Promise<SavedEmailHistoryPage>;
    assert.deepEqual((await read("owner", "owner-session", "1")).records.map(x => x.subject), ["Saved reply 1"]);
    assert.deepEqual((await read("other", "other-session", "1")).records.map(x => x.subject), ["Saved reply 2"]);
    assert.deepEqual((await read("owner", "owner-session", "2")).records.map(x => x.subject), ["Saved reply 3"]);
    assert.equal((await route(() => f.database, 0, "owner", "other-session")()).status, 404);
    assert.equal((await route(() => f.database)("999")).status, 404);
    assert.equal((await read("other", "other-session", "2")).records.length, 0);
    f.sqlite.exec('UPDATE "User" SET banned=1 WHERE id=\'other\'');
    assert.equal((await route(() => f.database, 0, "other", "other-session")("2")).status, 404);
  } finally { f.close(); }
});

test("bounded cursor pages have no overlap and remain scoped when outcomes or new records change", async () => {
  const f = savedHistoryFixture();
  try {
    for (let n = 1; n <= 7; n++) await f.record(n, n === 2 ? "UNKNOWN" : n === 3 ? "REJECTED" : "SENT");
    const invoke = route(() => f.database);
    const first = await (await invoke()).json() as SavedEmailHistoryPage;
    assert.equal(first.records.length, 5);
    assert(first.nextCursor);
    const ids = first.records.map(x => x.intentId);
    const before = f.changes();
    const second = await (await invoke("1", "?cursor=" + first.nextCursor)).json() as SavedEmailHistoryPage;
    assert.equal(second.records.length, 2);
    assert.equal(second.nextCursor, null);
    assert.equal(new Set([...ids, ...second.records.map(x => x.intentId)]).size, 7);
    assert.equal(f.changes(), before);
    await f.record(8);
    const repeated = await (await invoke("1", "?cursor=" + first.nextCursor)).json() as SavedEmailHistoryPage;
    assert.deepEqual(repeated, second);
    const foreignPage = await (await route(() => f.database, 0, "other", "other-session")("1", "?cursor=" + first.nextCursor)).json() as SavedEmailHistoryPage;
    assert.equal(foreignPage.records.length, 0);
  } finally { f.close(); }
});

test("retirement, revocation, archive and sending pauses preserve recorded state without side effects", async () => {
  const f = savedHistoryFixture();
  try {
    await f.record(1); await f.record(2, "UNKNOWN"); await f.record(3, "REJECTED");
    f.sqlite.exec(`UPDATE "RevenueMailboxIdentity" SET retiredAt=unixepoch();
      UPDATE "OutboundEnvelopeApproval" SET revokedAt=unixepoch();
      UPDATE "Lead" SET isArchived=1;
      UPDATE "RuntimeBudgetMonth" SET paused=1;`);
    const changes = f.changes();
    const page = await (await route(() => f.database)()).json() as SavedEmailHistoryPage;
    assert.deepEqual(page.records.map(x => x.state).sort(), ["REJECTED", "SENT", "UNKNOWN"]);
    assert.equal(f.changes(), changes);
    assert.equal(f.sends(), 3);
  } finally { f.close(); }
});

test("session or policy revocation during a page read cannot expose partial results", async () => {
  for (const empty of [false, true]) {
    const f = savedHistoryFixture();
    try {
      if (!empty) await f.record(1);
      let reads = 0;
      f.hooks.afterRead = () => {
        if (++reads === (empty ? 2 : 3)) {
          f.hooks.afterRead = undefined;
          f.sqlite.exec('UPDATE "Session" SET expiresAt=datetime(\'now\',\'-1 hour\')');
        }
      };
      const response = await route(() => f.database)();
      assert.equal(response.status, 503);
      assert.equal(JSON.stringify(await response.json()).includes("Exact body"), false);
    } finally { f.close(); }
  }
  const f = savedHistoryFixture();
  try {
    await f.record(1);
    f.hooks.afterRead = sql => {
      if (sql.includes('AS "rowJson"')) { f.hooks.afterRead = undefined; setCloudflareBindings({}); }
    };
    assert.equal((await route(() => f.database)()).status, 503);
  } finally { f.close(); }
});

test("missing schema and invalid stored history return bounded unavailable, not false empty history", async () => {
  const f = savedHistoryFixture();
  try {
    const throwing = () => { throw new Error("private database detail"); };
    const response = await route(throwing)();
    assert.equal(response.status, 503);
    assert.equal(JSON.stringify(await response.json()).includes("private database"), false);
    const badResults: D1DatabaseLike = { prepare: sql => {
      const prepared = f.database.prepare(sql);
      if (sql.includes('SELECT i."id", i."createdAt"')) return { ...prepared, bind: () => ({ ...prepared,
        all: async () => ({}),
      }) };
      return prepared;
    } };
    assert.equal((await route(() => badResults)()).status, 503);
  } finally { f.close(); }
});
