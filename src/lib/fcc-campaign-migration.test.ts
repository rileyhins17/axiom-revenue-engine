import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import Database from "better-sqlite3";

import { applyEngineSchema } from "@/lib/revenue-engine/test-support/engine-schema";

const MIGRATION = readFileSync(new URL("../../migrations/0088_fcc_day7_follow_up.sql", import.meta.url), "utf8");

/** A database at 0087 (live before this release), foreign keys on as on D1. */
function at0087() {
  const raw = new Database(":memory:");
  raw.pragma("foreign_keys = ON");
  applyEngineSchema(raw, "0087_fcc_second_sender.sql");
  return raw;
}

/** Contacts and every kind of send row live has: sent, failed then retried, claimed, from both inboxes, with a rowid gap. */
function seeded() {
  const raw = at0087();
  const contact = raw.prepare(`INSERT INTO "FccCampaignContact" ("id","campaignKey","email","firstName","company","filingsJson","emailKind","sendable","status","createdAt","updatedAt")
    VALUES (?,'fcc-march1-pack-v3-calmer',?,'Jane','Co','[]','named',1,?,'2026-10-26T00:00:00Z','2026-10-26T00:00:00Z')`);
  contact.run("c1", "c1@one.example", "step2_sent");
  contact.run("c2", "c2@two.example", "step1_sent");
  contact.run("c3", "c3@three.example", "ready");
  const send = raw.prepare(`INSERT INTO "FccCampaignSend" (rowid,"sendId","contactId","step","email","sendDay","messageId","status","detail","createdAt","finishedAt","senderAddress")
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
  send.run(1, "s1", "c1", 1, "c1@one.example", "2026-10-28", "<fcc-c1-1@gmail.com>", "SENT", null, "2026-10-28T14:00:00.000Z", "2026-10-28T14:00:02.000Z", null);
  send.run(2, "s2", "c2", 1, "c2@two.example", "2026-10-29", "<fcc-v4-c2-1@gmail.com>", "FAILED", "SMTP 421 try again later", "2026-10-29T14:00:00.000Z", "2026-10-29T14:00:01.000Z", null);
  send.run(5, "s3", "c2", 1, "c2@two.example", "2026-10-30", "<fcc-v4-c2-1@gmail.com>", "SENT", null, "2026-10-30T14:00:00.000Z", "2026-10-30T14:00:01.000Z", null);
  send.run(6, "s4", "c1", 2, "c1@one.example", "2026-11-02", "<fcc-c1-2@gmail.com>", "SENT", null, "2026-11-02T15:00:00.000Z", "2026-11-02T15:00:01.000Z", null);
  send.run(9, "s5", "c3", 1, "c3@three.example", "2026-11-02", "<fcc-v5-c3-1@gmail.com>", "CLAIMED", null, "2026-11-02T15:03:00.000Z", null, "riley@mail.example");
  return raw;
}

const rows = (raw: Database.Database) => raw.prepare(`SELECT rowid AS __rowid, * FROM "FccCampaignSend" ORDER BY rowid`).all();
const schema = (raw: Database.Database) => raw.prepare(`SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name`).all() as Array<{ type: string; name: string; sql: string | null }>;
const columns = (raw: Database.Database) => raw.pragma(`table_info("FccCampaignSend")`);
const migrate = (raw: Database.Database) => {
  raw.exec("BEGIN");
  raw.exec(MIGRATION);
  raw.exec("COMMIT");
};

test("0088 keeps every FCC send exactly, rowids included, and changes only the step check", () => {
  const raw = seeded();
  const before = { rows: rows(raw), schema: schema(raw), columns: columns(raw), keys: raw.pragma(`foreign_key_list("FccCampaignSend")`) };
  migrate(raw);
  assert.deepEqual(rows(raw), before.rows);
  assert.deepEqual(columns(raw), before.columns, "same columns, order, types, defaults and key");
  assert.deepEqual(raw.pragma(`foreign_key_list("FccCampaignSend")`), before.keys, "still tied to its contact, ON DELETE RESTRICT");
  const after = new Map(schema(raw).map((object) => [`${object.type}:${object.name}`, object.sql]));
  for (const object of before.schema) {
    const key = `${object.type}:${object.name}`;
    assert.ok(after.has(key), `${key} is missing`);
    if (key !== "table:FccCampaignSend") assert.equal(after.get(key), object.sql, `${key} definition changed`);
  }
  assert.equal(after.size, before.schema.length, "nothing added, nothing left behind");
  assert.match(after.get("table:FccCampaignSend")!, /CHECK \("step" IN \(1, 2, 3\)\)/);
  assert.match(before.schema.find((object) => object.name === "FccCampaignSend" && object.type === "table")!.sql!, /CHECK \("step" IN \(1, 2\)\)/);
  assert.deepEqual(raw.pragma("foreign_key_check"), []);
  assert.equal((raw.pragma("integrity_check") as Array<{ integrity_check: string }>)[0]!.integrity_check, "ok");
});

test("after 0088 a day-7 send is accepted and every old rule still holds", () => {
  const raw = seeded();
  migrate(raw);
  const insert = raw.prepare(`INSERT INTO "FccCampaignSend" ("sendId","contactId","step","email","sendDay","messageId","status") VALUES (?,?,?,?,?,?,?)`);
  insert.run("d7", "c1", 3, "c1@one.example", "2026-11-09", "<fcc-c1-3@gmail.com>", "CLAIMED");
  raw.prepare(`UPDATE "FccCampaignSend" SET "status" = 'SENT', "finishedAt" = '2026-11-09T15:00:01Z' WHERE "sendId" = 'd7'`).run();
  assert.throws(() => insert.run("d7-again", "c1", 3, "c1@one.example", "2026-11-10", "<fcc-c1-3@gmail.com>", "CLAIMED"), /UNIQUE/, "one live day-7 email per contact");
  insert.run("d7-failed", "c2", 3, "c2@two.example", "2026-11-10", "<fcc-v4-c2-3@gmail.com>", "FAILED");
  assert.throws(() => insert.run("step4", "c1", 4, "c1@one.example", "2026-11-16", "<fcc-c1-4@gmail.com>", "CLAIMED"), /CHECK constraint failed/, "no fourth email");
  assert.throws(() => insert.run("orphan", "nobody", 3, "x@x.example", "2026-11-09", "<x>", "CLAIMED"), /FOREIGN KEY/);
  assert.throws(() => raw.prepare(`DELETE FROM "FccCampaignSend" WHERE "sendId" = 'd7'`).run(), /FCC_CAMPAIGN_SEND_NO_DELETE/);
  assert.throws(() => raw.prepare(`UPDATE "FccCampaignSend" SET "status" = 'CLAIMED' WHERE "sendId" = 'd7'`).run(), /FCC_CAMPAIGN_SEND_FORWARD_ONLY/);
  assert.throws(() => raw.prepare(`UPDATE "FccCampaignSend" SET "step" = 2 WHERE "sendId" = 's5'`).run(), /FCC_CAMPAIGN_SEND_FORWARD_ONLY/);
  assert.throws(() => raw.prepare(`DELETE FROM "FccCampaignContact" WHERE "id" = 'c1'`).run(), /FOREIGN KEY/, "a contact with sends still can't be deleted");
  assert.equal((raw.prepare(`SELECT COUNT(*) AS n FROM "FccCampaignSend" WHERE "sendDay" = '2026-11-02' AND "senderAddress" = 'riley@mail.example'`).get() as { n: number }).n, 1);
});

test("0088 also works on an empty send table, as on a fresh database", () => {
  const raw = at0087();
  migrate(raw);
  assert.equal((raw.prepare(`SELECT COUNT(*) AS n FROM "FccCampaignSend"`).get() as { n: number }).n, 0);
  assert.equal(schema(raw).filter((object) => object.name.startsWith("_m0088_")).length, 0);
});
