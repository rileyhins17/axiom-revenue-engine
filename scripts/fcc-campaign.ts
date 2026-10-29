/**
 * FCC "March 1 pack" campaign tool.
 *
 *   npx tsx scripts/fcc-campaign.ts prepare   <contacts.csv> <outDir>
 *   npx tsx scripts/fcc-campaign.ts preview   <contacts.csv> <outDir>
 *   npx tsx scripts/fcc-campaign.ts test-send <contacts.csv> --to you@yourmailbox
 *   npx tsx scripts/fcc-campaign.ts import-sql <contacts.csv> <outFile.sql>
 *   npx tsx scripts/fcc-campaign.ts smtp-test <contacts.csv>
 *   npx tsx scripts/fcc-campaign.ts go-sql <founder name>
 *   npx tsx scripts/fcc-campaign.ts pause-sql
 *
 * - prepare: dedupes to one row per mailbox, flags generic inboxes, writes the
 *   import file, a held-for-review file and the 30/day send plan.
 * - preview: writes step 1 + step 2 as .eml files you can open in any mail app.
 * - test-send: sends step 1 and step 2 for the first contact to YOUR mailbox
 *   only (needs GMAIL_ACCESS_TOKEN and GMAIL_SENDER_EMAIL). Refuses any other
 *   recipient.
 * - import-sql: SQL to load contacts into FccCampaignContact (migration 0086).
 *   Run it with wrangler only after review. It never touches the Lead table.
 * - smtp-test: the live sender's SMTP + inbox-check path, sending step 1 and the
 *   threaded step 2 to the sending mailbox only (FCC_SENDER_ADDRESS and
 *   FCC_SMTP_PASSWORD in the terminal's environment). Never emails a contact.
 * - go-sql: the SQL that records a founder's go for the current copy version.
 *   Until it runs, the live sender (src/lib/fcc-campaign-sender.ts, weekdays at
 *   10:00 Toronto) sends nothing. pause-sql locks it again.
 *
 * Contact files are personal contact data. Keep them OUT of this public repo
 * (outreach/ is gitignored).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Duplex } from "node:stream";
import { connect as tlsConnect } from "node:tls";

import {
  FCC_CAMPAIGN_KEY,
  FCC_COPY_VERSION,
  FCC_DAILY_SEND_CAP,
  FCC_FOLLOW_UP_DELAY_DAYS,
  buildFccCampaignContacts,
  checkFccLiveSendGate,
  checkFccTestRecipient,
  parseFccFilingCsv,
  planFccSendSchedule,
  renderFccEmailV4,
  type FccCampaignContact,
} from "../src/lib/fcc-campaign";
import { fccMailboxFromImap } from "../src/lib/fcc-campaign-sender";
import { openImap } from "../src/lib/revenue-engine/imap-client";
import { openSmtp, type SmtpStream } from "../src/lib/revenue-engine/smtp-client";

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
        // The real lock lives in the app database; this tool can't lift it.
        liveSendGate: checkFccLiveSendGate({ mailingAddress, liveSendsEnabled: false }),
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
      const email = renderFccEmailV4(contact, step, mailingAddress);
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
    const email = renderFccEmailV4(contact, step, mailingAddress);
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

async function nodeTls(host: string, port: number): Promise<SmtpStream> {
  const socket = tlsConnect({ host, port, servername: host });
  await new Promise<void>((resolve, reject) => { socket.once("secureConnect", () => resolve()); socket.once("error", reject); });
  const { readable, writable } = Duplex.toWeb(socket) as unknown as Pick<SmtpStream, "readable" | "writable">;
  return { readable, writable, close: async () => { socket.end(); } };
}

/**
 * The live sender's exact path (same SMTP and IMAP code), pointed only at the
 * sending mailbox itself: proves the app password works for sending and for the
 * reply check, and shows how the follow-up threads. Never emails a contact.
 */
async function smtpTest(csvPath: string) {
  const from = process.env.FCC_SENDER_ADDRESS?.trim() || "";
  const password = process.env.FCC_SMTP_PASSWORD?.trim() || "";
  if (!from || !password) throw new Error("Set FCC_SENDER_ADDRESS and FCC_SMTP_PASSWORD (the Gmail app password) for this terminal only.");
  const smtpHost = process.env.FCC_SMTP_HOST?.trim() || "smtp.gmail.com";
  const imapHost = process.env.FCC_IMAP_HOST?.trim() || "imap.gmail.com";
  const fromName = process.env.FCC_SENDER_NAME?.trim() || "Aidan Magee";
  const [contact] = load(csvPath).filter((c) => c.sendable);
  if (!contact) throw new Error("No sendable contact in that file to borrow the wording from.");
  const startedAt = new Date().toISOString();
  const domain = from.split("@")[1];
  const firstId = `<fcc-test-${Date.now()}-1@${domain}>`;
  const transport = await openSmtp(await nodeTls(smtpHost, 465), { host: smtpHost, username: from, password, fromName, fromAddress: from }, () => crypto.randomUUID());
  try {
    for (const step of [1, 2] as const) {
      const email = renderFccEmailV4(contact, step, mailingAddress);
      const thread: Record<string, string> = step === 2 ? { "In-Reply-To": firstId, References: firstId } : {};
      await transport.send({
        to: from, subject: `[TEST to ${contact.email}] ${email.subject}`, text: email.bodyPlain,
        headers: { "Message-ID": step === 1 ? firstId : firstId.replace("-1@", "-2@"), "List-Unsubscribe": `<mailto:${from}?subject=stop>`, ...thread },
      });
      console.log(`Sent test step ${step} to ${from} (yourself)`);
    }
  } finally {
    await transport.close();
  }
  const mailbox = await fccMailboxFromImap(await openImap(await nodeTls(imapHost, 993), { username: from, password }));
  try {
    const found = await mailbox.hasMessagesFrom([from], startedAt);
    console.log(found ? "Inbox check works: it can see today's mail." : "Inbox check logged in but found nothing yet; try again in a minute.");
  } finally {
    await mailbox.close();
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

function goSql(by: string) {
  if (!/^[A-Za-z][A-Za-z .'-]{0,79}$/.test(by)) throw new Error("Give the founder's name, e.g. go-sql Aidan");
  const now = new Date().toISOString();
  console.log(`UPDATE "FccCampaignSetting" SET "enabled" = 1, "approvedCopy" = ${sql(FCC_COPY_VERSION)}, "goBy" = ${sql(by)}, "goAt" = ${sql(now)}, "updatedAt" = ${sql(now)} WHERE "id" = 1;`);
}

function pauseSql() {
  console.log(`UPDATE "FccCampaignSetting" SET "enabled" = 0, "updatedAt" = ${sql(new Date().toISOString())} WHERE "id" = 1;`);
}

const [command, csvPath, arg] = process.argv.slice(2);
const toFlag = process.argv.indexOf("--to");

async function main() {
  if (command === "prepare" && csvPath && arg) prepare(csvPath, arg);
  else if (command === "preview" && csvPath && arg) preview(csvPath, arg);
  else if (command === "test-send" && csvPath && toFlag > 0) await testSend(csvPath, process.argv[toFlag + 1]);
  else if (command === "import-sql" && csvPath && arg) importSql(csvPath, arg);
  else if (command === "smtp-test" && csvPath) await smtpTest(csvPath);
  else if (command === "go-sql" && csvPath) goSql(process.argv.slice(3).join(" "));
  else if (command === "pause-sql") pauseSql();
  else {
    console.error("Usage: see header of scripts/fcc-campaign.ts");
    process.exitCode = 2;
  }
}

main().catch((error: unknown) => {
  console.error((error as Error).message);
  process.exitCode = 1;
});
