import assert from "node:assert/strict";
import { test } from "node:test";
import Database from "better-sqlite3";
import { createLocalDatabaseAdapter } from "./local-sqlite";

test("local batches return rows and roll back preceding writes when audit storage fails", async () => {
  const sqlite = new Database(":memory:");
  const other = new Database(":memory:");
  try {
    sqlite.exec("CREATE TABLE item (id TEXT PRIMARY KEY, label TEXT); CREATE TABLE audit (id TEXT PRIMARY KEY); INSERT INTO item VALUES ('mailbox', 'Before'); INSERT INTO audit VALUES ('duplicate');");
    const db = createLocalDatabaseAdapter(sqlite);
    const update = () => db.prepare("UPDATE item SET label=? WHERE id=? RETURNING id,label").bind("After", "mailbox");
    await assert.rejects(db.batch!([update(), db.prepare("INSERT INTO audit VALUES ('duplicate')")]), /UNIQUE/);
    assert.equal((sqlite.prepare("SELECT label FROM item").get() as { label: string }).label, "Before");
    const result = await db.batch!([update(), db.prepare("INSERT INTO audit VALUES ('fresh') RETURNING id")]);
    assert.deepEqual(result.map((entry) => entry.results), [[{ id: "mailbox", label: "After" }], [{ id: "fresh" }]]);
    await assert.rejects(db.batch!([db.prepare("UPDATE item SET label='Bad'"), createLocalDatabaseAdapter(other).prepare("SELECT 1")]), /another database/);
    assert.equal((sqlite.prepare("SELECT label FROM item").get() as { label: string }).label, "After");
  } finally { sqlite.close(); other.close(); }
});
