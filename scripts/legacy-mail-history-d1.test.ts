import assert from "node:assert/strict";
import test from "node:test";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { legacyClientMailFixture } from "./fixtures/legacy-client-mail";
import { createLegacyMailHistory } from "../src/lib/revenue-engine/legacy-mail-history";

test("legacy owner history executes on local D1 with bounded plaintext and no writes or egress", async () => {
  const f=legacyClientMailFixture();
  let external=0;
  const runtime=new Miniflare(convertV4MiniflareOptions({cf:false,workers:[{
    name:"legacy-history-fixture",modules:true,script:"export default { fetch() { return new Response('synthetic'); } }",
    compatibilityDate:"2026-08-01",d1Databases:["DB"],
    outboundService:async()=>{external++;throw new Error("External access forbidden");},
  }]}));
  try{
    const db=await runtime.getD1Database("DB");
    const tables=["User","Session","Lead","GmailConnection","OutreachMailbox","OutreachSequence","OutreachSequenceStep","OutreachEmail"];
    for(const table of tables){
      const row=f.sqlite.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(table) as {sql:string};
      assert(row);await db.prepare(row.sql).run();
    }
    // Only the disposable fixture above is copied, never an existing database.
    for(const table of tables){
      const rows=f.sqlite.prepare(`SELECT * FROM "${table}"`).all() as Record<string,string|number|null>[];
      for(const row of rows){
        const keys=Object.keys(row);
        await db.prepare(`INSERT INTO "${table}" (${keys.map(key=>`"${key}"`).join(",")}) VALUES (${keys.map(()=>"?").join(",")})`)
          .bind(...keys.map(key=>row[key])).run();
      }
    }
    const snapshot=async()=>Promise.all(tables.map(async table=>(await db.prepare(`SELECT * FROM "${table}" ORDER BY id`).all()).results));
    const before=await snapshot();
    const reader=createLegacyMailHistory({prepare(sql){
      assert.match(sql,/^SELECT /,"Application history must issue SELECT statements only");
      return db.prepare(sql);
    }});
    const history=await reader(f.actor,{leadId:1,bodies:true,sequence:true});
    assert(history);assert.equal(history.emails.length,1);assert.equal(history.emails[0].id,"owner-email");
    assert.equal(history.sequence?.id,"owner-sequence");assert.equal(history.sequenceSteps[0].id,"owner-step");
    assert.doesNotMatch(JSON.stringify(history),/bodyHtml|private-provider-error|other-email|private sequence body/);
    assert.deepEqual(await snapshot(),before);
    await db.prepare("UPDATE User SET role='user' WHERE id='owner'").run();
    assert.equal(await createLegacyMailHistory(db)(f.actor,{leadId:1}),null);
    assert.equal(external,0);
  }finally{await runtime.dispose();f.close();}
});
