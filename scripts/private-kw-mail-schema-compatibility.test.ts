import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import Database from "better-sqlite3";
import { applyCanonicalPrivateKwMigrations, assertCanonicalPrivateKwRevenueSchema } from "./private-kw-database";
import { legacyClientMailFixture } from "./fixtures/legacy-client-mail";

test("exact provider-neutral mailbox extension can coexist with canonical lead data",()=>{
  const f=legacyClientMailFixture();
  try{assert.doesNotThrow(()=>assertCanonicalPrivateKwRevenueSchema(f.sqlite));}finally{f.close();}
});
test("canonical lead schema still rejects partial, altered or unrelated Revenue extensions",()=>{
  for(const change of [
    'ALTER TABLE RevenueMailboxIdentity ADD COLUMN unexpected TEXT',
    'DROP TABLE RevenueMailReplyTarget',
    'CREATE TABLE RevenueUnapproved (id TEXT)',
    'CREATE TRIGGER RevenueMailboxIdentity_extra AFTER INSERT ON RevenueMailboxIdentity BEGIN SELECT 1; END',
  ]){
    const db=new Database(":memory:");
    try{
      applyCanonicalPrivateKwMigrations(db);
      assert.doesNotThrow(()=>assertCanonicalPrivateKwRevenueSchema(db));
      db.exec(readFileSync("migrations/0075_provider_neutral_reply_identity.sql","utf8"));
      assert.doesNotThrow(()=>assertCanonicalPrivateKwRevenueSchema(db));
      db.exec(change);
      assert.throws(()=>assertCanonicalPrivateKwRevenueSchema(db),/differs from canonical migrations/);
    }finally{db.close();}
  }
});
