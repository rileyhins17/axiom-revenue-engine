/**
 * FCC "March 1 pack" campaign tool.
 *
 *   npx tsx scripts/fcc-campaign.ts prepare   <contacts.csv> <outDir>
 *   npx tsx scripts/fcc-campaign.ts preview   <contacts.csv> <outDir>
 *   npx tsx scripts/fcc-campaign.ts test-send <contacts.csv> --to you@yourmailbox
 *   npx tsx scripts/fcc-campaign.ts import-sql <contacts.csv> <outFile.sql>
 *
 * - prepare: dedupes to one row per mailbox, flags generic inboxes, writes the
 *   import file, a held-for-review file and the 30/day send plan.
 * - preview: writes step 1 + step 2 as .eml files you can open in any mail app.
 * - test-send: sends step 1 and step 2 for the first contact to YOUR mailbox
 *   only (needs GMAIL_ACCESS_TOKEN and GMAIL_SENDER_EMAIL). Refuses any other
 *   recipient.
 * - import-sql: SQL to load contacts into FccCampaignContact (migration 0053).
 *   Run it with wrangler only after review. It never touches the Lead table.
 *
 * Contact files are personal contact data. Keep them OUT of this public repo
 * (outreach/ is gitignored).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  FCC_CAMPAIGN_KEY,
  FCC_DAILY_SEND_CAP,
  FCC_FOLLOW_UP_DELAY_DAYS,
  buildFccCampaignContacts,
  checkFccLiveSendGate,
  checkFccTestRecipient,
  parseFccFilingCsv,
  planFccSendSchedule,
  renderFccEmail,
  type FccCampaignContact,
} from "../src/lib/fcc-campaign";

const mailingAddress = process.env.FCC_CAMPAIGN_MAILING_ADDRESS || "";

function load(csvPath: string): FccCampaignContact[] {
  return buildFccCampaignContacts(parseFccFilingCsv(readFileSync(csvPath, "utf8")));
}

function csvCell(value: string | number) {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(rows: Array<Record<string, string | number>>) {
  if (rows.length === 0) return "";
  const keys = Object.keys(rows[0]);
  return [keys.join(","), ...rows.map((r) => keys.map((k) => csvCell(r[k] ?? "")).join(","))].join("\n") + "\n";
}

function flat(c: FccCampaignContact) {
  return {
    email: c.email,
    first_name: c.firstName,
    contact_name: c.contactName,
    title: c.title,
    phone: c.phone,
    company: c.company,
    filing_count: c.filings.length,
    rmd_numbers: c.filings.map((f) => f.rmdNumber).join(" "),
    email_kind: c.emailKind,
    hold_reason: c.holdReason ?? "",
  };
}

function prepare(csvPath: string, outDir: string) {
  mkdirSync(outDir, { recursive: true });
  const contacts = load(csvPath);
  const sendable = contacts.filter((c) => c.sendable);
  const held = contacts.filter((c) => !c.sendable);
  const plan = planFccSendSchedule(contacts, nextWeekday(new Date()));

  writeFileSync(join(outDir, "fcc_import_sendable.csv"), toCsv(sendable.map(flat)));
  writeFileSync(join(outDir, "fcc_held_for_review.csv"), toCsv(held.map(flat)));
  writeFileSync(join(outDir, "fcc_send_plan.csv"), toCsv(plan));

  const kinds = contacts.reduce<Record<string, number>>((acc, c) => {
    acc[c.emailKind] = (acc[c.emailKind] ?? 0) + 1;
    return acc;
  }, {});
  const lastDay = plan.at(-1)?.date ?? "n/a";
  console.log(
    JSON.stringify(
      {
        campaign: FCC_CAMPAIGN_KEY,
        mailboxes: contacts.length,
        sendable: sendable.length,
        heldForReview: held.length,
        emailKinds: kinds,
        dailyCap: FCC_DAILY_SEND_CAP,
        followUpAfterDays: FCC_FOLLOW_UP_DELAY_DAYS,
        planFinishesOn: lastDay,
        liveSendGate: checkFccLiveSendGate({ mailingAddress, liveSendsEnabled: process.env.FCC_CAMPAIGN_LIVE === "1" }),
      },
      null,
      2,
    ),
  );
}

function nextWeekday(from: Date) {
  const d = new Date(from);
  d.setUTCDate(d.getUTCDate() + 1);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1);
  return d;
}

function eml(to: string, subject: string, body: string) {
  return [`To: ${to}`, `Subject: ${subject}`, `Content-Type: text/plain; charset="UTF-8"`, "", body, ""].join("\r\n");
}

function preview(csvPath: string, outDir: string) {
  mkdirSync(outDir, { recursive: true });
  const contacts = load(csvPath).filter((c) => c.sendable);
  const samples = [contacts[0], contacts.find((c) => c.filings.length > 1)].filter(Boolean) as FccCampaignContact[];
  for (const [index, contact] of samples.entries()) {
    for (const step of [1, 2] as const) {
      const email = renderFccEmail(contact, step, mailingAddress);
      writeFileSync(join(outDir, `preview_${index + 1}_step${step}.eml`), eml(contact.email, email.subject, email.bodyPlain));
    }
  }
  console.log(`Wrote ${samples.length * 2} previews to ${outDir}`);
}

async function testSend(csvPath: string, to: string) {
  const sender = process.env.GMAIL_SENDER_EMAIL || "";
  const token = process.env.GMAIL_ACCESS_TOKEN || "";
  if (!sender || !token) throw new Error("Set GMAIL_SENDER_EMAIL and GMAIL_ACCESS_TOKEN (your own mailbox).");
  const gate = checkFccTestRecipient(to, sender);
  if (!gate.allowed) throw new Error(gate.reason);

  const [contact] = load(csvPath).filter((c) => c.sendable);
  let threadId: string | undefined;
  for (const step of [1, 2] as const) {
    const email = renderFccEmail(contact, step, mailingAddress);
    const raw = eml(to, `[TEST to ${contact.email}] ${email.subject}`, email.bodyPlain).replace(/^To:/, `From: ${sender}\r\nTo:`);
    const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ raw: Buffer.from(raw).toString("base64url"), ...(threadId ? { threadId } : {}) }),
    });
    if (!response.ok) throw new Error(`Gmail send failed (${response.status}): ${await response.text()}`);
    threadId = ((await response.json()) as { threadId?: string }).threadId;
    console.log(`Sent test step ${step} to ${to}`);
  }
}

function sql(value: string | number | null) {
  if (value === null) return "NULL";
  return typeof value === "number" ? String(value) : `'${value.replace(/'/g, "''")}'`;
}

function importSql(csvPath: string, outFile: string) {
  const contacts = load(csvPath);
  const now = new Date().toISOString();
  const lines = contacts.map(
    (c) =>
      `INSERT OR IGNORE INTO "FccCampaignContact" ("id","campaignKey","email","firstName","contactName","title","phone","company","filingsJson","emailKind","sendable","holdReason","status","createdAt","updatedAt") VALUES (${[
        crypto.randomUUID(),
        FCC_CAMPAIGN_KEY,
        c.email,
        c.firstName,
        c.contactName,
        c.title,
        c.phone,
        c.company,
        JSON.stringify(c.filings),
        c.emailKind,
        c.sendable ? 1 : 0,
        c.holdReason,
        c.sendable ? "ready" : "held",
        now,
        now,
      ]
        .map(sql)
        .join(",")});`,
  );
  writeFileSync(outFile, lines.join("\n") + "\n");
  console.log(`Wrote ${lines.length} inserts to ${outFile}`);
}

const [command, csvPath, arg] = process.argv.slice(2);
const toFlag = process.argv.indexOf("--to");

async function main() {
  if (command === "prepare" && csvPath && arg) prepare(csvPath, arg);
  else if (command === "preview" && csvPath && arg) preview(csvPath, arg);
  else if (command === "test-send" && csvPath && toFlag > 0) await testSend(csvPath, process.argv[toFlag + 1]);
  else if (command === "import-sql" && csvPath && arg) importSql(csvPath, arg);
  else {
    console.error("Usage: see header of scripts/fcc-campaign.ts");
    process.exitCode = 2;
  }
}

main().catch((error: unknown) => {
  console.error((error as Error).message);
  process.exitCode = 1;
});
