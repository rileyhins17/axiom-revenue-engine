import assert from "node:assert/strict";
import type Database from "better-sqlite3";
import type { BrowserContext } from "playwright";
import { postOwnerSignIn } from "./owner-auth-request";

export async function verifyOwnerMailboxSettings(input: {
  context: BrowserContext; baseUrl: string; database: Database.Database;
  ownerEmail: string; adminEmail: string; password: string;
}) {
  const { context, baseUrl, database } = input;
  assert.equal(new URL(baseUrl).hostname, "127.0.0.1");
  const url = `${baseUrl}/api/outreach/automation/mailboxes/mailbox-settings-acceptance`;
  const patch = (data: unknown) => context.request.patch(url, { headers: {origin:baseUrl},data,timeout:10_000 });
  assert.equal((await patch({label:"Denied"})).status(),403);
  const signIn = async (email: string) => {
    await context.clearCookies();
    assert.equal((await postOwnerSignIn(context.request,baseUrl,{
      headers:{origin:baseUrl},data:{email,password:input.password},timeout:10_000,
    })).status(),200);
  };
  await signIn(input.adminEmail);
  const owner = database.prepare('SELECT id FROM User WHERE email=?').get(input.ownerEmail) as {id:string};
  database.prepare(`INSERT INTO OutreachMailbox (id,userId,gmailAddress,label,status,updatedAt)
    VALUES ('mailbox-settings-acceptance',?,'mailbox-settings@example.invalid','Before','PAUSED',CURRENT_TIMESTAMP)`).run(owner.id);
  const row = () => database.prepare("SELECT * FROM OutreachMailbox WHERE id='mailbox-settings-acceptance'").get();
  const original = row();
  try {
    for (const data of [{userId:"other"},{status:"ACTIVE"},{gmailAddress:"other@example.invalid"},
      {lastSentAt:"1970-01-01"},{label:"Allowed",dailyLimit:500},null,[],"{broken"]){
      const response = await patch(data);
      assert.equal(response.status(),400);
      assert.deepEqual(await response.json(),{error:"Invalid mailbox settings"});
      assert.equal(response.headers()["cache-control"],"private, no-store");
      assert.deepEqual(row(),original);
    }
    const normal = await patch({label:"Partner label",timezone:"America/Toronto"});
    assert.equal(normal.status(),200);
    assert.equal((await normal.json()).mailbox.label,"Partner label");
    assert.equal(normal.headers()["cache-control"],"private, no-store");
    const count = () => (database.prepare("SELECT COUNT(*) AS count FROM AuditEvent WHERE targetId='mailbox-settings-acceptance'").get() as {count:number}).count;
    assert.equal(count(),1);
    assert.equal((await patch({label:"Partner label",timezone:"America/Toronto"})).status(),200);
    assert.equal(count(),1);
    const beforeFailure = row();
    database.exec("CREATE TRIGGER mailbox_audit_failure BEFORE INSERT ON AuditEvent WHEN NEW.action='mailbox.settings.updated' BEGIN SELECT RAISE(ABORT,'private synthetic failure'); END;");
    const failed = await patch({label:"Must roll back"});
    assert.equal(failed.status(),503);
    assert.deepEqual(await failed.json(),{error:"Mailbox settings unavailable"});
    assert.deepEqual(row(),beforeFailure);
    assert.equal(count(),1);
  } finally {
    database.exec("DROP TRIGGER IF EXISTS mailbox_audit_failure");
    database.prepare("DELETE FROM OutreachMailbox WHERE id='mailbox-settings-acceptance'").run();
    await signIn(input.ownerEmail);
  }
}
