import assert from "node:assert/strict";
import { test } from "node:test";

import {
  FCC_DAILY_SEND_CAP,
  buildFccCampaignContacts,
  checkFccLiveSendGate,
  checkFccTestRecipient,
  classifyFccEmail,
  deriveFirstName,
  parseFccFilingCsv,
  planFccSendSchedule,
  renderFccEmail,
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
