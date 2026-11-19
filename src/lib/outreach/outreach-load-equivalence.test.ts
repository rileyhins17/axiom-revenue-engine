/**
 * Loading a list saves its rows a hundred at a time and reads the do-not-email list once for the whole list
 * (Nov 13, 2026; it used to be one insert and one read per row). This proves the result is the same, row for
 * row, as the one-at-a-time way, which is kept here as the reference.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import Database from "better-sqlite3";

import { FCC_CAMPAIGN_KEY } from "@/lib/fcc-campaign";
import { addressBlocked, blockedAmong } from "@/lib/outreach/outreach-blocked";
import { IMPORT_CHUNK, holdBlockedSql, importToDb, planImport, type ImportPlan } from "@/lib/outreach/outreach-import";
import { loadList } from "@/lib/outreach/outreach-load";
import { readCampaign } from "@/lib/outreach/outreach-model";
import type { ProspectDb } from "@/lib/revenue-engine/engine-prospects-d1";
import { applyEngineSchema } from "@/lib/revenue-engine/test-support/engine-schema";

const NOW = new Date("2026-11-13T15:30:00Z");
const ADDRESS = "100 Example Street, Kitchener, ON N0N 0N0, Canada";
const WORDS = { steps: [{ subject: "About {city}'s website", body: "Hi {first_name}, we looked at {city}." }, { body: "Just checking, {first_name}." }] };

function database() {
  const raw = new Database(":memory:");
  applyEngineSchema(raw);
  raw.exec(readFileSync(new URL("../../../migrations/0037_kv_store.sql", import.meta.url), "utf8"));
  let reads = 0;
  const db: ProspectDb = {
    prepare(sql) {
      const statement = raw.prepare(sql);
      return { bind: (...values: unknown[]) => ({
        all: async <T,>() => { reads += 1; return { results: statement.all(...values) as T[] }; },
        first: async <T,>() => { reads += 1; return (statement.get(...values) as T | undefined) ?? null; },
        run: async () => { reads += 1; return statement.run(...values); },
      }) };
    },
  };
  raw.prepare(`DELETE FROM "OutreachInbox"`).run();
  raw.prepare(`INSERT INTO "OutreachInbox" ("address","name","passwordSecret","dailyMax") VALUES ('first-inbox@axiom.example','Aidan Example','P1',60)`).run();
  raw.prepare(`UPDATE "OutreachCampaign" SET "wordsJson" = ?, "wordsVersion" = 'w1', "inboxesJson" = '[{"address":"first-inbox@axiom.example","perDay":30}]' WHERE "key" = 'us-cities'`).run(JSON.stringify(WORDS));
  // What is already in the engine before the list arrives: someone already in this campaign, and every way an address
  // can be blocked (the list, a whole domain, a bounce or a no-thanks in a campaign, a bounce or a no in FCC).
  raw.exec(`
    INSERT INTO "OutreachCampaign" ("key","name","state","dailyLimit","wordsJson","wordsVersion") VALUES ('other','Other','paused',10,'{"steps":[]}','w0');
    INSERT INTO "OutreachBatch" ("id","campaignKey","name","loadedBy","loadedAt","status","sendOrder") VALUES ('old','us-cities','old','Riley','2026-11-01T00:00:00Z','approved',1), ('oth','other','oth','Riley','2026-11-01T00:00:00Z','approved',1);
    INSERT INTO "OutreachContact" ("id","campaignKey","batchId","rowNumber","email","fieldsJson","status","createdAt","updatedAt") VALUES
      ('e1','us-cities','old',2,'already@here.example','{}','sent','2026-11-01T00:00:00Z','2026-11-01T00:00:00Z'),
      ('e2','other','oth',2,'bounced-elsewhere@b.example','{}','bounced','2026-11-01T00:00:00Z','2026-11-01T00:00:00Z'),
      ('e3','other','oth',3,'said-no@c.example','{}','suppressed','2026-11-01T00:00:00Z','2026-11-01T00:00:00Z');
    INSERT INTO "OutreachReply" ("id","campaignKey","contactId","inbox","fromAddress","kind","foundAt") VALUES ('r1','other','e3','first-inbox@axiom.example','said-no@c.example','no_thanks','2026-11-02T00:00:00Z');
    INSERT INTO "EngineEmailSuppression" ("email","reason") VALUES ('on-the-list@d.example','BOUNCED'), ('@whole-domain.example','OWNER');
  `);
  raw.prepare(`INSERT INTO "FccCampaignContact" ("id","campaignKey","email","firstName","company","filingsJson","emailKind","sendable","status","stoppedReason","createdAt","updatedAt") VALUES
    ('f1', ?, 'FCC-Bounced@e.example', 'Sam', 'Made-up Telecom', '[]', 'named', 1, 'bounced', 'The email bounced', '2026-11-01T00:00:00Z', '2026-11-02T00:00:00Z'),
    ('f2', ?, 'fcc-no@f.example', 'Lee', 'Made-up Cable', '[]', 'named', 1, 'replied', 'They said no thanks, stop', '2026-11-01T00:00:00Z', '2026-11-02T00:00:00Z'),
    ('f3', ?, 'fcc-fine@g.example', 'Kim', 'Made-up Voice', '[]', 'named', 1, 'replied', 'They wrote back: tell me more', '2026-11-01T00:00:00Z', '2026-11-02T00:00:00Z')`)
    .run(FCC_CAMPAIGN_KEY, FCC_CAMPAIGN_KEY, FCC_CAMPAIGN_KEY);
  return { raw, db, reads: () => reads, reset: () => { reads = 0; } };
}

/** A list with every kind of row, long enough to need three inserts. */
function list() {
  const special = [
    "already@here.example,Pat,Already Here,yes",
    "bounced-elsewhere@b.example,Pat,Bounced Elsewhere,yes",
    "said-no@c.example,Pat,Said No,yes",
    "on-the-list@d.example,Pat,On The List,yes",
    "anyone@whole-domain.example,Pat,Whole Domain,yes",
    "fcc-bounced@e.example,Pat,Fcc Bounced,yes",
    "fcc-no@f.example,Pat,Fcc No,yes",
    "fcc-fine@g.example,Pat,Fcc Fine,yes",
    "not-an-address,Pat,Bad Address,yes",
    "twice@h.example,Pat,Twice One,yes",
    "TWICE@h.example,Pat,Twice Two,yes",
    "unverified@i.example,Pat,Unverified,no",
    "blank-name@j.example,,Blank Name,yes",
    `quotes@k.example,"O'Brien ""Pat""","Ville, d'Été — 東京",yes`,
    `newline@l.example,Pat,"Two\nLines",yes`,
  ];
  const plain = Array.from({ length: 230 }, (_, i) => `clerk${i}@town${i}.example,Pat${i},Town ${i},yes`);
  return ["email,first_name,city,verified", ...plain.slice(0, 120), ...special, ...plain.slice(120)].join("\n");
}

/** The loader as it was before Nov 13: one insert per row. */
async function importOneAtATime(db: ProspectDb, plan: ImportPlan) {
  const b = plan.batch;
  await db.prepare(`INSERT OR IGNORE INTO "OutreachBatch" ("id","campaignKey","name","source","columnsJson","rows","ready","held","loadedBy","loadedAt","status","wordsJson","wordsVersion","sendOrder")
    VALUES (?,?,?,?,?,0,0,0,?,?,'waiting',?,?,(SELECT COALESCE(MAX("sendOrder"), 0) + 1 FROM "OutreachBatch" WHERE "campaignKey" = ?))`)
    .bind(b.id, b.campaignKey, b.name, b.source, JSON.stringify(b.columns), b.loadedBy, b.loadedAt, b.wordsJson, b.wordsVersion, b.campaignKey).run();
  for (const c of plan.contacts) {
    await db.prepare(`INSERT OR IGNORE INTO "OutreachContact" ("id","campaignKey","batchId","rowNumber","email","fieldsJson","status","holdReason","createdAt","updatedAt")
      VALUES (?,?,?,?,?,?,?,?,?,?)`).bind(c.id, b.campaignKey, b.id, c.rowNumber, c.email, JSON.stringify(c.fields), c.status, c.holdReason, b.loadedAt, b.loadedAt).run();
  }
  for (const statement of holdBlockedSql(b.id)) await db.prepare(statement.replace(/;\s*$/, "")).bind().run();
}

async function plan(db: ProspectDb) {
  const campaign = (await readCampaign(db, "us-cities"))!;
  let ids = 0;
  const made = planImport(campaign, list(), {
    batchId: "b-new", name: "Mixed list", source: "the Campaigns screen", loadedBy: "Riley", now: NOW, newId: () => `id-${++ids}`,
    sender: { name: "Aidan Example", address: "first-inbox@axiom.example" }, mailingAddress: ADDRESS,
  });
  assert.deepEqual(made.errors, []);
  return made;
}

// updatedAt of a row the load itself held is "now" in SQL, so it is left out of the comparison.
const saved = (raw: Database.Database) => ({
  contacts: raw.prepare(`SELECT "id","campaignKey","batchId","rowNumber","email","fieldsJson","status","holdReason","stoppedReason","stepsSent","senderAddress","nextDueDay","createdAt" FROM "OutreachContact" ORDER BY rowid`).all(),
  batches: raw.prepare(`SELECT * FROM "OutreachBatch" ORDER BY "id"`).all(),
});

test("a list saved a hundred rows at a time is, row for row, what saving it one row at a time gave", async () => {
  const before = database();
  const after = database();
  const [planBefore, planAfter] = [await plan(before.db), await plan(after.db)];
  assert.deepEqual(planAfter, planBefore);
  assert.ok(planAfter.contacts.length > 2 * IMPORT_CHUNK, "long enough for three inserts");

  await importOneAtATime(before.db, planBefore);
  const counts = await importToDb(after.db, planAfter);
  assert.deepEqual(saved(after.raw), saved(before.raw));

  // And the result is what it should be: 245 rows in the file, one address was already in the campaign.
  assert.deepEqual(counts, { rows: 244, ready: 234, held: 10, skipped: 1 });
  const held = Object.fromEntries((after.raw.prepare(`SELECT json_extract("fieldsJson", '$.city') AS city, "holdReason" FROM "OutreachContact" WHERE "batchId" = 'b-new' AND "status" = 'held'`).all() as Array<{ city: string; holdReason: string }>)
    .map((row) => [row.city, row.holdReason.replace(/ \(.*| as row.*|:.*/, "")]));
  assert.deepEqual(Object.keys(held).sort(), ["Bad Address", "Blank Name", "Bounced Elsewhere", "Fcc Bounced", "Fcc No", "On The List", "Said No", "Twice Two", "Unverified", "Whole Domain"]);
  for (const blocked of ["Bounced Elsewhere", "Said No", "On The List", "Whole Domain", "Fcc Bounced", "Fcc No"]) assert.equal(held[blocked], "On the do-not-email list", blocked);
  // Odd characters arrive untouched.
  const odd = after.raw.prepare(`SELECT "fieldsJson" FROM "OutreachContact" WHERE "email" = 'quotes@k.example'`).get() as { fieldsJson: string };
  assert.deepEqual(JSON.parse(odd.fieldsJson), { email: "quotes@k.example", first_name: `O'Brien "Pat"`, city: "Ville, d'Été — 東京", verified: "yes" });
  assert.equal((JSON.parse((after.raw.prepare(`SELECT "fieldsJson" FROM "OutreachContact" WHERE "email" = 'newline@l.example'`).get() as { fieldsJson: string }).fieldsJson) as { city: string }).city, "Two\nLines");
});

test("the do-not-email check for a whole list says exactly what the one-address check says", async () => {
  const { db } = database();
  const addresses = ["already@here.example", "bounced-elsewhere@b.example", "said-no@c.example", "on-the-list@d.example", "anyone@whole-domain.example", "FCC-Bounced@e.example",
    "fcc-no@f.example", "fcc-fine@g.example", "nobody@nowhere.example", "clerk1@town1.example"];
  const together = await blockedAmong(db, addresses);
  for (const address of addresses) assert.equal(together.has(address.toLowerCase()), await addressBlocked(db, address), address);
  assert.deepEqual([...together].sort(), ["anyone@whole-domain.example", "bounced-elsewhere@b.example", "fcc-bounced@e.example", "fcc-no@f.example", "on-the-list@d.example", "said-no@c.example"]);
  assert.deepEqual([...(await blockedAmong(db, []))], []);
});

test("checking and loading a 245-row list from the screen takes a handful of database reads, not two a row", async () => {
  const { raw, db, reads, reset } = database();
  let ids = 0;
  const context = { loadedBy: "Riley", now: NOW, newId: () => `n-${++ids}`, mailingAddress: ADDRESS, checkMail: async () => ({ noMailServer: new Map<string, string>(), unreadable: [] }) };
  // The screen allows 40 different email domains a load, so this list shares a few.
  const csv = ["email,first_name,city,verified", ...Array.from({ length: 245 }, (_, i) => `clerk${i}@town${i % 30}.example,Pat${i},Town ${i},yes`), "on-the-list@d.example,Pat,On The List,yes"].join("\n");
  reset();
  const checked = await loadList(db, { campaign: "us-cities", name: "Big list", csv, save: false }, context);
  assert.ok(checked.ok && !checked.saved && checked.ready === 245 && checked.held === 1, JSON.stringify(checked).slice(0, 200));
  assert.ok(reads() <= 6, `the check made ${reads()} reads`);
  assert.equal((raw.prepare(`SELECT COUNT(*) AS n FROM "OutreachBatch" WHERE "name" = 'Big list'`).get() as { n: number }).n, 0, "a check saves nothing");
  reset();
  const loaded = await loadList(db, { campaign: "us-cities", name: "Big list", csv, save: true }, context);
  assert.ok(loaded.ok && loaded.saved && loaded.rows === 246 && loaded.ready === 245 && loaded.held === 1);
  assert.ok(reads() <= 14, `the load made ${reads()} reads`);
  const batch = raw.prepare(`SELECT "status","approvedBy","ready" FROM "OutreachBatch" WHERE "name" = 'Big list'`).get() as { status: string; approvedBy: string | null; ready: number };
  assert.deepEqual(batch, { status: "waiting", approvedBy: null, ready: 245 }, "it waits for its approver");
});
