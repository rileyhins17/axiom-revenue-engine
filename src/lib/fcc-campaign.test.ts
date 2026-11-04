import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import Database from "better-sqlite3";

import {
  FCC_DAILY_SEND_CAP,
  FCC_LOGO_SIZE,
  FCC_LOGO_URL,
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
  fccFlagOffCopy,
  fccCopySql,
  fccFirstEmailSubject,
  fccSubjectTestCopy,
  parseFccFilingCsv,
  planFccSendSchedule,
  renderFccEmail,
  renderFccEmailDay7,
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
    `Aidan Magee\nAxiom · axiominternational.ca · ${address}\nNot useful? Reply "no thanks" and I won't follow up.`,
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
    `Aidan\nAxiom · axiominternational.ca · ${address}\nNot useful? Reply "no thanks" and I won't follow up.`,
  ].join("\n\n"));

  assert.equal(fccCopyOfMessageId("<fcc-v4-abc-1@mail.example>"), "v4");
  assert.equal(fccCopyOfMessageId("<fcc-abc-1@mail.example>"), "v3");
  assert.equal(fccCopyOfMessageId(null), "v3");
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
  assert.match(first.bodyHtml, /<img src="https:\/\/operations\.getaxiom\.ca\/brand\/axiom-lockup-tile-328\.png" alt="Axiom International" width="164" height="63"/);
  assert.doesNotMatch(first.bodyHtml, /<td style="[^"]*background[^"]*">\s*<a [^>]*><img/,
    "Gmail's dark mode flips CSS colours but not images, so the logo's dark tile belongs in the image file (MAIL-002)");
  assert.match(first.bodyHtml, /font-weight:bold">Riley Hinsperger<\/div>/);
  assert.match(first.bodyHtml, /C: 519-555-0100/);
  assert.match(first.bodyHtml, /Not useful\? Reply &quot;no thanks&quot; and I won&#39;t follow up\.|Not useful\? Reply &quot;no thanks&quot; and I won't follow up\./);

  // The logo file ships with the app's static files, at twice the size the signature shows it.
  const logoFile = path.join(process.cwd(), "public", new URL(FCC_LOGO_URL).pathname);
  const png = readFileSync(logoFile);
  assert.equal(png.subarray(1, 4).toString("latin1"), "PNG", `${logoFile} is a PNG`);
  assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [FCC_LOGO_SIZE.width * 2, FCC_LOGO_SIZE.height * 2]);

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
    "We're not a law firm and this isn't legal advice.",
    fccSignature({ name: "Aidan Magee" }, "257 Example St, Kitchener, ON N2C 0A0, Canada").plain,
  ].join("\n\n"));
  assert.match(email.bodyHtml, /axiominternational\.ca\/fcc-filings/);
  assert.match(renderFccEmailNov6(contact, "257 Example St, Kitchener, ON N2C 0A0, Canada", { name: "Riley Hinsperger" }).bodyPlain, /Riley Hinsperger/);
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

test("renders Aidan's day-7 follow-up word for word, with the first email's merge fields and the sending inbox's founder", () => {
  const address = "257 Example St, Kitchener, ON N2C 0A0, Canada";
  const contact = { firstName: "Jane", company: "Crocker Communications, LLC", filings: [{ rmdNumber: "RMD0001234" }] as never };
  const email = renderFccEmailDay7(contact, "v7a", address, "Riley Hinsperger");
  assert.equal(email.subject, "Re: Question about Crocker Communications' RMD listing");
  assert.equal(email.bodyPlain, [
    "Hi Jane,",
    "I'll close this out after this one. For context on why I reached out: in September the FCC removed 14 providers from the Robocall Mitigation Database because their listings were missing required information, and other carriers had two business days to stop taking their calls. Fixing a listing is usually quick once the information is ready, and that's the part I help with.",
    "Crocker Communications' listing (RMD0001234) still shows no 2026 recertification. If you'd like the free list of what looks out of date, just reply and I'll send it the same day.",
    `Riley Hinsperger\nAxiom · axiominternational.ca · ${address}\nNot useful? Reply "no thanks" and I won't contact you again.`,
  ].join("\n\n"));
  assert.match(email.bodyHtml, /<p style="margin:0 0 14px">I'll close this out after this one\./);
  assert.match(email.bodyHtml, /Riley Hinsperger<br>\nAxiom · axiominternational\.ca · 257 Example St, Kitchener, ON N2C 0A0, Canada<br>\nNot useful\? Reply &quot;no thanks&quot; and I won't contact you again\./);
  assert.doesNotMatch(email.bodyPlain, /https?:|www\./, "no links in the text");

  // The subject answers whichever first email the person got.
  assert.equal(renderFccEmailDay7(contact, "v5", address).subject, "Re: Question about Crocker Communications' RMD listing");
  assert.equal(renderFccEmailDay7(contact, "v4", address).subject, "Re: Question about Crocker Communications' RMD listing");
  assert.equal(renderFccEmailDay7(contact, "v7b", address).subject, "Re: Crocker Communications' FCC listing");
  assert.equal(renderFccEmailDay7(contact, "v3", address).subject, "Re: Your 2026 RMD recertification");
  assert.match(renderFccEmailDay7(contact, "v3", address).bodyPlain, /\n\nAidan Magee\nAxiom · /, "Aidan signs when no one else is named");
  assert.throws(() => renderFccEmailDay7(contact, "nov6", address), /no follow-up/);

  // A filing with no RMD number drops the brackets; a missing address shows the placeholder.
  const noRmd = renderFccEmailDay7({ firstName: "there", company: "Talktone, Inc.", filings: [{}] as never }, "v7a", null);
  assert.match(noRmd.bodyPlain, /^Hi there,\n\n/);
  assert.match(noRmd.bodyPlain, /\n\nTalktone's listing still shows no 2026 recertification\./);
  assert.match(noRmd.bodyPlain, /\[MAILING ADDRESS GOES HERE\]/);
});

test("the subject test: half of new first emails keep the question subject, half name the FCC listing, fixed by contact id", () => {
  const address = "257 Example St, Kitchener, ON N2C 0A0, Canada";
  const contact = { firstName: "Jane", company: "Talktone, Inc.", filings: [{ rmdNumber: "RMD0009999" }] as never };
  const question = renderFccEmailV5(contact, 1, address, { name: "Aidan Magee" }, "v7a");
  const listing = renderFccEmailV5(contact, 1, address, { name: "Aidan Magee" }, "v7b");
  assert.equal(question.subject, "Question about Talktone's RMD listing", "today's subject");
  assert.equal(listing.subject, "Talktone's FCC listing", "the same short name the body uses");
  assert.equal(listing.bodyPlain, question.bodyPlain, "only the subject differs");
  assert.equal(listing.bodyHtml, question.bodyHtml);
  assert.equal(renderFccEmailV5(contact, 2, address, { name: "Aidan Magee" }, "v7b").subject, "Re: Talktone's FCC listing");
  assert.equal(fccFirstEmailSubject({ company: "Crocker Communications" }, "v7b"), "Crocker Communications' FCC listing");

  const uuids = Array.from({ length: 2000 }, () => crypto.randomUUID());
  const b = uuids.filter((id) => fccSubjectTestCopy(id) === "v7b").length;
  assert.ok(b > 900 && b < 1100, `${b} of 2000 got the listing subject`);
  const short = Array.from({ length: 200 }, (_, i) => `c${i}`).filter((id) => fccSubjectTestCopy(id) === "v7b").length;
  assert.ok(short > 80 && short < 120, `${short} of 200 short ids got the listing subject`);
  for (const id of uuids.slice(0, 50)) assert.equal(fccSubjectTestCopy(id), fccSubjectTestCopy(id), "the same contact always gets the same subject");
});

test("the flag-off email: says the portal may be closed, states no price, and keeps the subject test", () => {
  const address = "257 Example St, Kitchener, ON N2C 0A0, Canada";
  const contact = { firstName: "Jane", company: "Talktone, Inc.", filings: [{ rmdNumber: "RMD0009999" }] as never };
  const question = renderFccEmailV5(contact, 1, address, { name: "Riley Hinsperger" }, "v8a");
  const listing = renderFccEmailV5(contact, 1, address, { name: "Riley Hinsperger" }, "v8b");
  assert.equal(question.subject, "Question about Talktone's RMD listing");
  assert.equal(listing.subject, "Talktone's FCC listing");
  assert.equal(listing.bodyPlain, question.bodyPlain, "only the subject differs");
  assert.match(question.bodyPlain, /^Hi Jane,\n\nI was going through the FCC's Robocall Mitigation Database and noticed Talktone's listing \(RMD0009999\) doesn't show a 2026 recertification\. It was due March 1/);
  assert.match(question.bodyPlain, /It looks like the portal may not be open for your listing right now/);
  assert.match(question.bodyPlain, /The CommLaw Group, reports the FCC has started emailing second-chance notices to some providers/);
  assert.match(question.bodyPlain, /free, so it's ready if the portal opens, or for March 1, 2027\./);
  assert.match(question.bodyPlain, /We're not a law firm and this isn't legal advice\./);
  assert.match(question.bodyPlain, /Riley Hinsperger\nCo-founder/, "signed by the sending founder");
  assert.match(question.bodyPlain, /Reply "no thanks" and I won't follow up\./);
  assert.match(question.bodyPlain, /257 Example St,/, "the mailing address US law requires");
  for (const email of [question.bodyPlain, question.bodyHtml]) {
    assert.doesNotMatch(email, /15 minutes|\$450|own login/, "nothing they can't do today, and no price while we can't take money");
  }
  assert.match(renderFccEmailV5(contact, 1, address, { name: "Aidan Magee" }, "v7a").bodyPlain, /in about 15 minutes/, "the regular email is unchanged");

  const followUp = renderFccEmailV5(contact, 2, address, { name: "Riley Hinsperger" }, "v8b");
  assert.equal(followUp.subject, "Re: Talktone's FCC listing", "the day-3 follow-up answers under the first email's subject");
  assert.doesNotMatch(followUp.bodyPlain, /15 minutes|\$450/);
  assert.equal(renderFccEmailDay7(contact, "v8a", address).subject, "Re: Question about Talktone's RMD listing");

  const ids = Array.from({ length: 200 }, (_, i) => `c${i}`);
  for (const id of ids) assert.equal(fccFlagOffCopy(id), fccSubjectTestCopy(id) === "v7a" ? "v8a" : "v8b", "a contact's subject doesn't change with the words");
});

test("every copy is read back from its Message-ID, the November 6 email included, and the SQL agrees", () => {
  const ids: Array<[string | null, string]> = [
    ["<fcc-3f2a9c1e-0b7d-4e2a-9c51-1a2b3c4d5e6f-1@gmail.com>", "v3"], ["<fcc-v4-abc-1@gmail.com>", "v4"], ["<fcc-v5-abc-1@gmail.com>", "v5"],
    ["<fcc-v7a-abc-1@gmail.com>", "v7a"], ["<fcc-v7b-abc-1@gmail.com>", "v7b"], ["<fcc-v8a-abc-1@gmail.com>", "v8a"], ["<fcc-v8b-abc-1@gmail.com>", "v8b"], ["<fcc-nov6-abc-1@gmail.com>", "nov6"], [null, "v3"],
  ];
  const sqlite = new Database(":memory:");
  for (const [id, copy] of ids) {
    assert.equal(fccCopyOfMessageId(id), copy, String(id));
    assert.deepEqual(sqlite.prepare(`SELECT ${fccCopySql('"m"')} AS copy FROM (SELECT ? AS "m")`).get(id), { copy }, `SQL: ${id}`);
  }
});
