import assert from "node:assert/strict";
import { join } from "node:path";
import type Database from "better-sqlite3";
import type { BrowserContext } from "playwright";
import { postOwnerSignIn } from "./owner-auth-request";

/** Called only by the disposable full-app owner acceptance harness. Uses its
 * synthetic accounts and loopback server; never an existing operator database. */
export async function verifyOwnerMailSummaries(input: {
  context: BrowserContext; baseUrl: string; database: InstanceType<typeof Database>;
  adminEmail: string; ownerEmail: string; password: string; outputDirectory: string;
}) {
  const {context,baseUrl,database}=input;
  assert.equal(new URL(baseUrl).hostname,"127.0.0.1");
  const identities=[{id:"owner-acceptance-admin",label:"Visible owner history"},{id:"owner-acceptance-user",label:"Hidden other-owner history"}];
  database.prepare(`INSERT INTO Lead (id,businessName,niche,city,lastUpdated)
    VALUES (990001,'Summary fixture HVAC','HVAC','Waterloo',CURRENT_TIMESTAMP)`).run();
  for(const identity of identities) {
    database.prepare(`INSERT INTO OutreachMailbox (id,userId,gmailAddress,updatedAt)
      VALUES (?,?,?,CURRENT_TIMESTAMP)`).run(`summary-${identity.id}`,identity.id,`${identity.id}@example.invalid`);
    database.prepare(`INSERT INTO OutreachSequence (id,leadId,queuedByUserId,assignedMailboxId,status,currentStep,sequenceConfigSnapshot,updatedAt)
      VALUES (?,990001,?,?,'COMPLETED','INITIAL','{}',CURRENT_TIMESTAMP)`)
      .run(`summary-sequence-${identity.id}`,identity.id,`summary-${identity.id}`);
    database.prepare(`INSERT INTO OutreachEmail
      (id,leadId,senderUserId,senderEmail,recipientEmail,subject,bodyHtml,bodyPlain,status,mailboxId,sequenceId)
      VALUES (?,990001,? ,?,'prospect@example.invalid',?,'<img src="https://tracking.invalid/pixel">','Literal saved message','sent',?,?)`)
      .run(`summary-email-${identity.id}`,identity.id,`${identity.id}@example.invalid`,identity.label,`summary-${identity.id}`,`summary-sequence-${identity.id}`);
  }
  const snapshot=()=>JSON.stringify(["OutreachEmail","OutreachSequence","OutreachSequenceStep","OutreachMailbox","OutreachAutomationSetting","GmailConnection"]
    .map(table=>database.prepare(`SELECT * FROM "${table}" ORDER BY id`).all()));
  const before=snapshot();
  const signedIn=await postOwnerSignIn(context.request,baseUrl,{
    data:{email:input.adminEmail,password:input.password},headers:{origin:baseUrl},
  });
  assert.equal(signedIn.status(),200,"Synthetic administrator sign-in");
  const page=await context.newPage();
  const errors:string[]=[],mutations:string[]=[];
  page.on("pageerror",error=>errors.push(error.message));
  page.on("request",request=>{if(request.method()!=="GET")mutations.push(request.method());});
  try {
    for(const viewport of [{width:1440,height:1000},{width:390,height:844}]) {
      await page.setViewportSize(viewport);
      for(const path of ["dashboard","automation"]) {
        await page.goto(`${baseUrl}/${path}`,{waitUntil:"networkidle"});
        if(path==="automation")await page.getByRole("tab",{name:"Sent",exact:true}).click();
        await page.getByText("Visible owner history",{exact:true}).waitFor();
        if(path==="dashboard")assert(!(await page.locator("body").innerText()).includes("Connect Gmail senders"));
        assert.equal(await page.getByText("Hidden other-owner history",{exact:true}).count(),0);
        assert.equal(await page.locator("body").innerText().then(text=>text.includes("owner-acceptance-user@example.invalid")),false);
        await page.screenshot({path:join(input.outputDirectory,`summary-${path}-${viewport.width}.png`),fullPage:true});
        // Exercise the real detail route from the actual summary row.
        await page.getByText("Visible owner history",{exact:true}).click();
        await page.getByRole("dialog").getByText("Literal saved message",{exact:true}).waitFor();
        assert.equal(await page.getByRole("dialog").locator("img,iframe").count(),0);
        await page.keyboard.press("Escape");
      }
    }
    for(const path of ["/api/outreach/automation/overview","/api/outreach/gmail/status"]) {
      const response=await context.request.get(baseUrl+path);
      assert.equal(response.status(),200);assert.equal(response.headers()["cache-control"],"private, no-store");
      assert(!(await response.text()).includes("Hidden other-owner history"));
    }
    assert.deepEqual(errors,[]);assert.deepEqual(mutations,[]);
    assert.equal(snapshot(),before,"Summary and message views must not maintain mailbox/settings/sequence state");
  } finally {await page.close();}
  const member=await postOwnerSignIn(context.request,baseUrl,{data:{email:input.ownerEmail,password:input.password},headers:{origin:baseUrl}});
  assert.equal(member.status(),200);
  assert.equal((await context.request.get(`${baseUrl}/api/outreach/automation/overview`)).status(),403);
  const memberPage=await context.newPage();
  try {
    await memberPage.goto(`${baseUrl}/dashboard`);
    await memberPage.getByRole("heading",{name:"Administrator access required",exact:true}).waitFor();
    assert(!(await memberPage.locator("body").innerText()).includes("Visible owner history"));
  } finally {await memberPage.close();}
}
