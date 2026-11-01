import assert from "node:assert/strict";
import { test } from "node:test";

import {
  FCC_DAILY_SEND_CAP,
  FCC_NOV6_CAMPAIGN_KEY,
  buildFccCampaignContacts,
  buildFccNov6Contacts,
  checkFccLiveSendGate,
  checkFccTestRecipient,
  classifyFccEmail,
  companyPossessive,
  companyShortName,
  deriveFirstName,
  fccCopyOfMessageId,
  parseFccFilingCsv,
  planFccSendSchedule,
  renderFccEmail,
  renderFccEmailNov6,
  renderFccEmailV4,
  renderFccEmailV5,
  fccSignature,
} from "@/lib/fcc-campaign";

const HEADER =
  "business_name,contact_name,title,email,phone,state,rmd_number,last_filing_date,recertified_on_page,filing_url";

function csv(rows: string[]) {
  return [HEADER, ...rows].join("\n");
}

test("parses quoted business names and dedupes one mailbox across several filings", () => {
  const rows = parseFccFilingCsv(
    csv([
      '"Example Telephone Co, Inc.-AR",Jane Doe,Director,JDOE@example.net,555,OK,RMD1,2024-10-04,no,https://x/1',
      '"Example Telephone Co, Inc.-OK",Jane Doe,Director,jdoe@example.net,555,OK,RMD2,2024-10-04,no,https://x/2',
      "Other Co,Sam Lee,CEO,sam@other.com,556,TX,RMD3,2025-01-01,no,https://x/3",
    ]),
  );
  assert.equal(rows.length, 3);
  assert.equal(rows[0].business_name, "Example Telephone Co, Inc.-AR");

  const contacts = buildFccCampaignContacts(rows);
  assert.equal(contacts.length, 2);
  assert.equal(contacts[0].email, "jdoe@example.net");
  assert.equal(contacts[0].filings.length, 2);
});

test("skips filers already recertified and invalid emails", () => {
  const contacts = buildFccCampaignContacts(
    parseFccFilingCsv(
      csv([
        "Done Co,Al Roe,CEO,al@done.com,1,TX,RMD1,2026-02-01,yes,u",
        "Bad Co,Bo Roe,CEO,not-an-email,1,TX,RMD2,2024-01-01,no,u",
        "Open Co,Cy Roe,CEO,cy@open.com,1,TX,RMD3,2024-01-01,no,u",
      ]),
    ),
  );
  assert.deepEqual(contacts.map((c) => c.email), ["cy@open.com"]);
});

test("classifies named, compliance and generic inboxes; holds generic ones", () => {
  assert.equal(classifyFccEmail("m.apland@siskiyou.example", "Mark Apland"), "named");
  assert.equal(classifyFccEmail("jdeaver@dobson.example", "Jon Deaver"), "named");
  assert.equal(classifyFccEmail("rmd@pbxi.example", "Corey Hall"), "compliance");
  assert.equal(classifyFccEmail("fcc@traci.example", "Pedro Tomas"), "compliance");
  assert.equal(classifyFccEmail("support@estreet.example", "Nick Voth"), "generic");
  assert.equal(classifyFccEmail("noc@callshaper.example", "Robert Wienholt"), "generic");

  const [held] = buildFccCampaignContacts(
    parseFccFilingCsv(csv(["E Co,Nick Voth,President,support@e.example,1,CO,RMD9,2024-10-24,no,u"])),
  );
  assert.equal(held.sendable, false);
  assert.match(held.holdReason ?? "", /Generic inbox/);
});

test("first name falls back to 'there' for team contacts", () => {
  assert.equal(deriveFirstName("STEVEN LONGHENRY"), "Steven");
  assert.equal(deriveFirstName("Momentum NOC/TOC"), "there");
  assert.equal(deriveFirstName("Support"), "there");
});

test("live sends stay blocked until an address is set and the campaign is enabled", () => {
  assert.equal(checkFccLiveSendGate({ mailingAddress: "", liveSendsEnabled: true }).allowed, false);
  assert.equal(checkFccLiveSendGate({ mailingAddress: "123 Example St, Kitchener ON", liveSendsEnabled: false }).allowed, false);
  assert.equal(checkFccLiveSendGate({ mailingAddress: "123 Example St, Kitchener ON", liveSendsEnabled: true }).allowed, true);
});

test("test sends only go to the sending mailbox", () => {
  assert.equal(checkFccTestRecipient("Me@Axiom.example", "me@axiom.example").allowed, true);
  assert.equal(checkFccTestRecipient("someone@else.example", "me@axiom.example").allowed, false);
});

test("renders the calmer v3 copy with a visible placeholder when no address is set", () => {
  const contact = { firstName: "Jane", company: "Example Co", filings: [{}, {}] as never };
  const first = renderFccEmail(contact, 1, null);
  assert.equal(first.subject, "Your 2026 RMD recertification");
  assert.match(first.bodyPlain, /the filings for Example Co and 1 related company don't show a 2026 recertification date/);
  const single = renderFccEmail({ firstName: "Sam", company: "Solo Co", filings: [{}] as never }, 1, null);
  assert.match(single.bodyPlain, /Solo Co's filing doesn't show a 2026 recertification date/);
  assert.match(first.bodyPlain, /If that's wrong, please ignore this\./);
  assert.match(first.bodyPlain, /we never hold your login/);
  assert.match(first.bodyPlain, /Aidan Magee, Axiom · axiominternational\.ca/);
  assert.doesNotMatch(first.bodyPlain, /getaxiom\.ca/);
  assert.match(first.bodyPlain, /\[MAILING ADDRESS GOES HERE\]/);
  assert.match(first.bodyPlain, /Reply "stop"/);
  assert.match(first.bodyPlain, /not a law firm/);
  // v3 drops the lines that read like the urgent "deficiency" cold emails law firms warn filers about.
  assert.doesNotMatch(first.bodyPlain, /fastest way|get current|filing information in order|other carriers have to stop/);

  const follow = renderFccEmail(contact, 2, "123 Example St, Kitchener ON");
  assert.match(follow.subject, /^Re: /);
  assert.match(follow.bodyPlain, /draft it for your officer to check and submit/);
  assert.match(follow.bodyPlain, /123 Example St, Kitchener ON/);
  assert.doesNotMatch(follow.bodyPlain, /MAILING ADDRESS GOES HERE/);
});

test("renders Aidan's v2 email word for word, with the address and opt-out in both emails", () => {
  const address = "123 Example St, Kitchener ON";
  const contact = { firstName: "Jane", company: "Crocker Communications", filings: [{ rmdNumber: "RMD0001234" }] as never };
  const first = renderFccEmailV4(contact, 1, address);
  assert.equal(first.subject, "Question about Crocker Communications' RMD listing");
  assert.equal(first.bodyPlain, [
    "Hi Jane,",
    "I was going through the FCC's Robocall Mitigation Database and noticed Crocker Communications' listing (RMD0001234) doesn't show a 2026 recertification yet. It was due March 1, and you're not alone: about 3,600 providers show the same thing.",
    "Is it already handled? If so, no need to reply.",
    "If not, I can send you a short list of what looks out of date on the listing, free. If you'd like help after that, I prepare the updates and a fresh mitigation plan, and your officer files it from your own login in about 15 minutes. It's a flat $450, and we never hold your login.",
    "Want me to send the list?",
    `Aidan Magee\nAxiom · axiominternational.ca/fcc-filings · ${address}\nNot useful? Reply "no thanks" and I won't follow up.`,
  ].join("\n\n"));
  assert.doesNotMatch(first.bodyPlain, /https?:|www\.|enforcement/i);
  assert.equal(renderFccEmailV4({ ...contact, company: "Talktone, Inc." }, 1, address).subject, "Question about Talktone's RMD listing");
  assert.equal(companyPossessive("Joe's"), "Joe's", "never \"Company's's\"");
  for (const [full, short] of [
    ["Bestline Communications, LP", "Bestline Communications"], ["Minerva Valley Telephone Co., Inc.", "Minerva Valley Telephone"],
    ["Clarity Telecom, LLC DBA Bluepeak Fiber", "Bluepeak Fiber"], ["White Cloud Communications US LLC DBA: Broadlinc", "Broadlinc"],
    ["The Ponderosa Telephone Co.", "Ponderosa Telephone"], ["kaleva telephone company", "Kaleva Telephone Company"],
    ["TelWare Corporation", "TelWare Corporation"], ["StarTechTel.com, Inc.", "StarTechTel.com"], ["Crocker Communications", "Crocker Communications"],
  ]) assert.equal(companyShortName(full), short, full);
  assert.match(renderFccEmailV4(contact, 1, null).bodyPlain, /\[MAILING ADDRESS GOES HERE\]/);

  const follow = renderFccEmailV4(contact, 2, address);
  assert.equal(follow.subject, "Re: Question about Crocker Communications' RMD listing");
  assert.equal(follow.bodyPlain, [
    "Hi Jane,",
    "Bumping this in case it got buried. Crocker Communications' listing (RMD0001234) still shows no 2026 recertification. Want the free list? A one-word reply is fine.",
    `Aidan\nAxiom · axiominternational.ca/fcc-filings · ${address}\nNot useful? Reply "no thanks" and I won't follow up.`,
  ].join("\n\n"));

  assert.equal(fccCopyOfMessageId("<fcc-v4-abc-1@mail.example>"), "v4");
  assert.equal(fccCopyOfMessageId("<fcc-abc-1@mail.example>"), "v3");
  assert.equal(fccCopyOfMessageId(null), "v3");
});

const NOV6_HEADER =
  "rank,email,first_name_display,company_display,company_short,company_possessive,rmd_number,listing_line,cohort,signed,title,email_type,batch,filing_url";

test("renders the November 6 email word for word, as a first email with no follow-up step", () => {
  assert.equal(FCC_NOV6_CAMPAIGN_KEY, "fcc-nov6-hot");
  const listing = "Example Telecom's public listing (RMD0000001) still shows no 2026 recertification, and it looks like the portal may let you file it now.";
  const contact = {
    firstName: "Dana",
    filings: [{ company: "Example Telecom LLC", rmdNumber: "RMD0000001", state: "", lastFilingDate: "2024-04-15", filingUrl: "https://example.test", companyShort: "Example Telecom", listingLine: listing }],
  };
  const email = renderFccEmailNov6(contact, "257 Example St, Kitchener, ON N2C 0A0, Canada");
  assert.equal(email.subject, "Did Example Telecom get the FCC's RMD notice?");
  assert.equal(email.bodyPlain, [
    "Hi Dana,",
    "A quick heads-up in case this got buried. A telecom law firm, The CommLaw Group, reports the FCC is emailing notices to providers that missed the March 1 RMD recertification, giving them another chance. At least one notice sets a November 6 deadline. Dates may differ and they're easy to miss, so it's worth checking spam and whoever is listed as your RMD contact.",
    listing,
    "If you want it off your plate, I can have the updated answers and a fresh mitigation plan ready within one business day. Your officer reviews them and files from your own login. It's a flat $450, half up front, and we never hold your login.",
    "Want me to start? A one-word reply is fine.",
    "Aidan Magee\nAxiom · axiominternational.ca/fcc-filings · 257 Example St, Kitchener, ON N2C 0A0, Canada\nWe're not a law firm and this isn't legal advice. Not useful? Reply \"no thanks\" and I won't follow up.",
  ].join("\n\n"));
  assert.match(renderFccEmailNov6(contact, null).bodyPlain, /\[MAILING ADDRESS GOES HERE\]/);
  assert.throws(() => renderFccEmailNov6({ firstName: "Sam", filings: [{ company: "x", rmdNumber: "", state: "", lastFilingDate: "", filingUrl: "" }] }, null), /missing its listing line/);
});

test("builds the November 6 hot list in file order, holds generic inboxes, and keeps one row per mailbox", () => {
  const contacts = buildFccNov6Contacts([
    NOV6_HEADER,
    '1,dana@dana-tel.example,Dana,Example Telecom LLC,Example Telecom,Example Telecom\'s,RMD0000001,"Example Telecom\'s public listing (RMD0000001) still shows no 2026 recertification.",A_older,2024-04-15,Owner,named,b2,https://x/1',
    '2,support@estreet.example,There,Estreet Co,Estreet,Estreet\',RMD2,"Estreet\'s listing.",A_older,2024-01-01,Support,generic,b4,https://x/2',
    '3,jane@fiber.example,Jane,"Fiber Co, Inc.",Fiber Co,Fiber Co\'s,RMD3,"Fiber Co\'s listing.",B_signed_2026,2026-02-01,CEO,named,b4,https://x/3',
    "4,noc@contrast.example,Robert,Contrast LLC,Contrast,Contrast's,RMD4,Contrast's listing.,A_older,2024-01-01,CEO,named,b4,https://x/4",
    "5,ops.lead@tower.example,Sam,Tower Co,Tower,Tower's,RMD5,Tower's listing.,A_older,2024-01-01,Ops,generic,b4,https://x/5",
    "6,JANE@fiber.example,Jane,Fiber Co dup,Fiber Co,Fiber Co's,RMD6,Dup listing.,A_older,2024-01-01,CEO,named,b4,https://x/6",
  ].join("\n"));

  assert.deepEqual(contacts.map((c) => c.email), ["dana@dana-tel.example", "support@estreet.example", "jane@fiber.example", "noc@contrast.example", "ops.lead@tower.example"]);
  assert.deepEqual(contacts.map((c) => c.sendable), [true, false, true, false, false]);
  assert.equal(contacts[3].emailKind, "generic", "noc@ is generic even though the file says named");
  assert.equal(contacts[4].emailKind, "generic", "the file's email_type holds a row the address alone would not");
  assert.match(contacts[1].holdReason ?? "", /Generic inbox/);
  assert.equal(contacts[0].filings[0].companyShort, "Example Telecom");
  assert.equal(contacts[0].filings[0].listingLine, "Example Telecom's public listing (RMD0000001) still shows no 2026 recertification.");
  assert.equal(contacts[0].firstName, "Dana");
  assert.throws(() => buildFccNov6Contacts(NOV6_HEADER.replace(",listing_line", "") + "\n"), /missing the "listing_line" column/);
  assert.throws(() => buildFccNov6Contacts([NOV6_HEADER, "7,a@b.example,Ann,Co,,Co's,RMD7,,A_older,2024-01-01,CEO,named,b4,u"].join("\n")), /rank 7 is missing/);
});

test("v5 keeps Aidan's words and signs with the founders' signature: plain domain linking to the FCC page, logo, opt-out", () => {
  const address = "257 Kipling Ave, Kitchener, ON N2C 2B9, Canada";
  const contact = { firstName: "Jane", company: "Crocker Communications", filings: [{ rmdNumber: "RMD0001234" }] as never };
  const v4 = renderFccEmailV4(contact, 1, address);
  const first = renderFccEmailV5(contact, 1, address, { name: "Riley Hinsperger", title: "Co-founder", phone: "519-555-0100" });
  assert.equal(first.subject, v4.subject);
  assert.ok(first.bodyPlain.startsWith(v4.bodyPlain.split("\n\nAidan Magee")[0]), "the same words as v4 up to the sign-off");
  assert.ok(first.bodyPlain.endsWith([
    "Want me to send the list?", "",
    "Riley Hinsperger\nCo-founder\n257 Kipling Ave,\nKitchener, ON N2C 2B9, Canada\nC: 519-555-0100\naxiominternational.ca/fcc-filings", "",
    "Not useful? Reply \"no thanks\" and I won't follow up.",
  ].join("\n")));
  assert.match(first.bodyHtml, /<a href="https:\/\/axiominternational\.ca\/fcc-filings\/" style="color:#1a56c4">axiominternational\.ca<\/a>/);
  assert.match(first.bodyHtml, /<img src="https:\/\/axiominternational\.ca\/brand\/axiom-lockup-400\.png" alt="Axiom International"/);
  assert.match(first.bodyHtml, /font-weight:bold">Riley Hinsperger<\/div>/);
  assert.match(first.bodyHtml, /C: 519-555-0100/);
  assert.match(first.bodyHtml, /Not useful\? Reply &quot;no thanks&quot; and I won&#39;t follow up\.|Not useful\? Reply &quot;no thanks&quot; and I won't follow up\./);

  const plainest = fccSignature({ name: "Aidan Magee" }, address);
  assert.equal(plainest.plain.split("\n")[1], "Co-founder", "the title defaults to Co-founder");
  assert.doesNotMatch(plainest.plain, /C: /, "no phone line without a phone");
  assert.match(fccSignature({ name: "A <b>&" }, address).html, /A &lt;b&gt;&amp;/, "names are escaped");

  const follow = renderFccEmailV5(contact, 2, address, { name: "Aidan Magee" });
  assert.equal(follow.subject, "Re: Question about Crocker Communications' RMD listing");
  assert.match(follow.bodyPlain, /^Hi Jane,\n\nBumping this in case it got buried\./);
  assert.match(follow.bodyPlain, /Aidan Magee\nCo-founder\n257 Kipling Ave,/);
  assert.equal(fccCopyOfMessageId("<fcc-v5-abc-1@mail.example>"), "v5");
});

test("schedule never exceeds the daily cap and follow-ups land 3 days later", () => {
  const rows = Array.from({ length: 83 }, (_, i) =>
    `Co ${i},Person Number${i},CEO,person${i}@co${i}.example,1,TX,RMD${i},2024-01-01,no,u`,
  );
  const contacts = buildFccCampaignContacts(parseFccFilingCsv(csv(rows)));
  const plan = planFccSendSchedule(contacts, new Date("2026-10-26T12:00:00Z"));

  const perDay = new Map<string, number>();
  for (const item of plan) perDay.set(item.date, (perDay.get(item.date) ?? 0) + 1);
  for (const count of perDay.values()) assert.ok(count <= FCC_DAILY_SEND_CAP);

  const firstByEmail = new Map(plan.filter((p) => p.step === 1).map((p) => [p.email, p.date]));
  for (const item of plan.filter((p) => p.step === 2)) {
    const gap = (Date.parse(item.date) - Date.parse(firstByEmail.get(item.email)!)) / 86_400_000;
    assert.equal(gap, 3);
  }
  assert.equal(plan.filter((p) => p.step === 1).length, 83);
});
