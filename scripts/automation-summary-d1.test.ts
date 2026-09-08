import assert from "node:assert/strict";
import test from "node:test";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { legacyClientMailFixture } from "./fixtures/legacy-client-mail";
import { getAutomationOperatorConsole } from "../src/lib/automation-operator-view";
import { listAutomationOverview } from "../src/lib/outreach-automation";
import { setCloudflareBindings, type D1DatabaseLike } from "../src/lib/cloudflare";

test("both owner summary readers execute on local D1 without writes, schema repair or foreign mail", async () => {
  const f=legacyClientMailFixture();
  let external=0;
  const runtime=new Miniflare(convertV4MiniflareOptions({cf:false,workers:[{
    name:"summary-fixture",modules:true,script:"export default { fetch() { return new Response('synthetic'); } }",
    compatibilityDate:"2026-08-01",d1Databases:["DB"],
    outboundService:async()=>{external++;throw new Error("External access forbidden");},
  }]}));
  try {
    f.sqlite.exec(`UPDATE OutreachEmail SET sequenceId='owner-sequence' WHERE id='owner-email';
      UPDATE OutreachEmail SET sequenceId='other-sequence' WHERE id='other-email'`);
    const db=await runtime.getD1Database("DB");
    const tables=["User","Session","Lead","GmailConnection","OutreachMailbox","OutreachSequence","OutreachSequenceStep",
      "OutreachEmail","OutreachAutomationSetting","OutreachSuppression","OutreachRun"];
    for(const table of tables) {
      const row=f.sqlite.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(table) as {sql:string};
      assert(row); await db.prepare(row.sql).run();
    }
    for(const table of tables) for(const row of f.sqlite.prepare(`SELECT * FROM "${table}"`).all() as Record<string,string|number|null>[]) {
      const keys=Object.keys(row);
      await db.prepare(`INSERT INTO "${table}" (${keys.map(key=>`"${key}"`).join(",")}) VALUES (${keys.map(()=>"?").join(",")})`)
        .bind(...keys.map(key=>row[key])).run();
    }
    const snapshot=async()=>Promise.all(tables.map(async table=>(await db.prepare(`SELECT * FROM "${table}" ORDER BY id`).all()).results));
    const before=await snapshot();
    const readOnly: D1DatabaseLike={prepare(sql) {
      assert.match(sql,/^\s*(SELECT\b|PRAGMA table_info\()/,"Summary SQL must be read-only");
      return db.prepare(sql);
    }};
    setCloudflareBindings({...f.policy,DB:readOnly});
    const consoleData=await getAutomationOperatorConsole(f.actor,new Date(),readOnly);
    const overview=await listAutomationOverview(f.actor);
    assert.equal(overview.mailboxes[0].sentToday,1);
    for(const result of [consoleData,overview]) {
      assert(result.recentSent.some(email=>email.id==="owner-email"));
      assert(!JSON.stringify(result).includes("other legacy subject"));
      assert(!JSON.stringify(result).includes("bodyHtml"));
    }
    assert.deepEqual(await snapshot(),before);
    await db.prepare("UPDATE User SET role='user' WHERE id='owner'").run();
    await assert.rejects(listAutomationOverview(f.actor),/OWNER_SUMMARY_UNAVAILABLE/);
    assert.equal(external,0);
  } finally { await runtime.dispose();f.close(); }
});
