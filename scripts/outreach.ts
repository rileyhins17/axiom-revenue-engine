/**
 * Campaign tools, run on a founder's PC. Each command writes SQL to run with
 * `wrangler d1 execute axiom-ops-omniscient --remote --config wrangler.production.jsonc --file <out.sql>`;
 * nothing here talks to the live database or sends email itself.
 *
 *   npx tsx scripts/outreach.ts preview <first.txt> <followup.txt> <list.csv> [count]
 *       Prints the first emails exactly as they would go (from Aidan's inbox) and every held row.
 *   npx tsx scripts/outreach.ts words-sql <campaign> <first.txt> <followup.txt> <out.sql>
 *       Sets a campaign's words. Changed words lock every batch until it is approved again.
 *   npx tsx scripts/outreach.ts import-sql <campaign> "<batch name>" <list.csv> <first.txt> <followup.txt> <out.sql> [source]
 *       Loads one CSV as a waiting batch (the words files must be the ones set with words-sql).
 *   npx tsx scripts/outreach.ts approve-sql <batch id> <Riley|Aidan> "<where they said so>" <out.sql>
 *       Records a founder's approval given outside the screen. Only when that founder said so.
 *   npx tsx scripts/outreach.ts settings-sql <campaign> <out.sql> key=value ...
 *       Changes a campaign's settings: state (live|paused), dailyLimit, inboxesJson, startDay, endDay,
 *       windowStart, windowEnd, sendDays, followUps, followUpBusinessDays, approversJson, rulesJson, priority.
 *   npx tsx scripts/outreach.ts new-campaign-sql <key> "<name>" <out.sql> inboxesJson=... dailyLimit=N approversJson=... [key=value ...]
 *       Adds a campaign (a new avenue), paused, with the same settings. Its words and lists then load on the screen.
 *
 * The mailing address for previews comes from $env:FCC_CAMPAIGN_MAILING_ADDRESS (outreach/fcc-campaign.env).
 */
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

import { campaignFromRow, type Campaign } from "@/lib/outreach/outreach-model";
import { EMAIL_PATTERN, importSql, planImport } from "@/lib/outreach/outreach-import";
import { checkMailServers, emailDomain } from "@/lib/outreach/outreach-mail-servers";
import { parseStepText, renderEmail, wordsProblems, wordsVersion, type CampaignWords } from "@/lib/outreach/outreach-words";
import { parseCsv, type CsvTable } from "@/lib/outreach/outreach-csv";

const [command, ...args] = process.argv.slice(2);
const q = (value: string | null) => (value === null ? "NULL" : `'${value.replace(/'/g, "''")}'`);
const fail = (message: string): never => { console.error(message); process.exit(1); };
const readWords = (first: string, follow: string): CampaignWords => ({ steps: [parseStepText(readFileSync(first, "utf8"), 1), parseStepText(readFileSync(follow, "utf8"), 2)] });
const mailing = process.env.FCC_CAMPAIGN_MAILING_ADDRESS ?? "";
const AIDAN = { name: "Aidan Magee", address: "aidanmageebusiness@gmail.com" };

/** The cities campaign as migration 0089 creates it, with these words: enough to check rows offline. */
function citiesWith(words: CampaignWords, key = "us-cities"): Campaign {
  return campaignFromRow({
    key, name: "US cities: accessibility", state: "paused", stateReason: null, stateBy: null, stateAt: null, priority: 10, startDay: "2026-11-09", endDay: null,
    sendDays: "Mon,Tue,Wed,Thu,Fri", windowStart: 540, windowEnd: 870, dailyLimit: 30, inboxesJson: JSON.stringify([{ address: AIDAN.address, perDay: 30 }]),
    followUps: 1, followUpBusinessDays: 5, wordsJson: JSON.stringify(words), wordsVersion: wordsVersion(words),
    rulesJson: JSON.stringify({ holdUnless: { verified: ["yes", "true", "y", "1", "verified"] }, noLinksInFirst: true, stopOnAutoReply: true }), approversJson: '["Aidan"]', note: null,
  });
}

/** key=value settings as [column, SQL value], checked: only known columns, numbers as numbers, JSON that parses. */
function settingPairs(pairs: string[]): Array<[string, string]> {
  const allowed = new Set(["state", "dailyLimit", "inboxesJson", "startDay", "endDay", "windowStart", "windowEnd", "sendDays", "followUps", "followUpBusinessDays", "approversJson", "rulesJson", "priority", "name", "note"]);
  const numbers = new Set(["dailyLimit", "windowStart", "windowEnd", "followUps", "followUpBusinessDays", "priority"]);
  return pairs.map((pair): [string, string] => {
    const at = pair.indexOf("=");
    const key = pair.slice(0, at);
    const value = pair.slice(at + 1);
    if (at < 1 || !allowed.has(key)) fail(`Unknown setting "${key}".`);
    if (key.endsWith("Json")) { try { JSON.parse(value); } catch { fail(`${key} is not valid JSON.`); } }
    if (key === "state" && !["live", "paused"].includes(value)) fail("state is live or paused.");
    if (numbers.has(key) && !Number.isFinite(Number(value))) fail(`${key} must be a number.`);
    return [key, numbers.has(key) ? String(Number(value)) : value === "null" ? "NULL" : q(value)];
  });
}

/** Every list's domains are looked up before it is planned: no mail server holds the row; a failed lookup stops here. */
async function mailServersFor(table: CsvTable) {
  const domains = table.rows.map((row) => (row.email ?? "").trim().toLowerCase()).filter((email) => EMAIL_PATTERN.test(email)).map(emailDomain);
  const check = await checkMailServers(domains);
  if (check.unreadable.length) fail(`Couldn't look up the mail servers of ${check.unreadable.join(", ")}. Nothing written; try again.`);
  console.log(`Mail servers: ${new Set(domains).size} domains checked, ${check.noMailServer.size} without one.`);
  return check.noMailServer;
}

async function run() {
if (command === "preview") {
  const [first, follow, csv, count = "10"] = args;
  if (!first || !follow || !csv) fail("usage: preview <first.txt> <followup.txt> <list.csv> [count]");
  const words = readWords(first!, follow!);
  const campaign = citiesWith(words);
  const table = parseCsv(readFileSync(csv!, "utf8"));
  const plan = planImport(campaign, table, { batchId: "preview", name: "preview", loadedBy: "preview", now: new Date(), newId: randomUUID, sender: AIDAN,
    mailingAddress: mailing || "(mailing address)", noMailServer: await mailServersFor(table) });
  if (plan.errors.length) fail(`Can't load: ${plan.errors.join(" ")}`);
  const ready = plan.contacts.filter((contact) => contact.status === "ready");
  console.log(`${plan.contacts.length} rows: ${ready.length} ready, ${plan.contacts.length - ready.length} held. Words ${wordsVersion(words)}.\n`);
  for (const contact of ready.slice(0, Number(count))) {
    const one = renderEmail(words, 1, contact.fields, AIDAN, mailing || "(mailing address)", { noLinksInFirst: true });
    const two = one.ok ? renderEmail(words, 2, contact.fields, AIDAN, mailing || "(mailing address)", { firstSubject: one.email.subject }) : null;
    console.log(`--- Row ${contact.rowNumber} · To: ${contact.email} · From: ${AIDAN.name} <${AIDAN.address}>`);
    if (one.ok) console.log(`Subject: ${one.email.subject}\n\n${one.email.text}\n`);
    if (two?.ok) console.log(`(Follow-up, 5 business days later if no reply) Subject: ${two.email.subject}\n\n${two.email.text}\n`);
  }
  for (const contact of plan.contacts.filter((row) => row.status === "held")) console.log(`HELD row ${contact.rowNumber} (${contact.fields.email ?? ""}): ${contact.holdReason}`);
} else if (command === "words-sql") {
  const [campaign, first, follow, out] = args;
  if (!campaign || !first || !follow || !out) fail("usage: words-sql <campaign> <first.txt> <followup.txt> <out.sql>");
  const words = readWords(first!, follow!);
  const problems = wordsProblems(words, ["email", "first_name", "title", "city", "state", "population", "website", "contact_page", "verified", "error_count", "worst_problem", "pdf_date", "pdf_url", "scan_date"], { noLinksInFirst: true });
  if (problems.length) console.warn(`Check these against the list's columns:\n- ${problems.join("\n- ")}`);
  writeFileSync(out!, `UPDATE "OutreachCampaign" SET "wordsJson" = ${q(JSON.stringify(words))}, "wordsVersion" = ${q(wordsVersion(words))}, "updatedAt" = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE "key" = ${q(campaign!)};\n`);
  console.log(`Words ${wordsVersion(words)} for ${campaign} written to ${out}.`);
} else if (command === "import-sql") {
  const [campaign, name, csv, first, follow, out, source] = args;
  if (!campaign || !name || !csv || !first || !follow || !out) fail("usage: import-sql <campaign> \"<batch name>\" <list.csv> <first.txt> <followup.txt> <out.sql> [source]");
  const words = readWords(first!, follow!);
  const table = parseCsv(readFileSync(csv!, "utf8"));
  const plan = planImport(citiesWith(words, campaign!), table, {
    batchId: `b-${randomUUID()}`, name: name!, source: source ?? csv!.split(/[\\/]/).pop() ?? null, loadedBy: "Riley's Claude", now: new Date(), newId: randomUUID,
    sender: AIDAN, mailingAddress: mailing || "(checked again at send time)", noMailServer: await mailServersFor(table),
  });
  if (plan.errors.length) fail(`Can't load: ${plan.errors.join(" ")}`);
  writeFileSync(out!, importSql(plan));
  const held = plan.contacts.filter((contact) => contact.status === "held");
  console.log(`Batch ${plan.batch.id} "${plan.batch.name}": ${plan.contacts.length} rows, ${plan.contacts.length - held.length} ready, ${held.length} held (the live list may hold more: do-not-email, bounces).`);
  const reasons = new Map<string, number>();
  for (const contact of held) { const key = contact.holdReason!.replace(/"[^"]*"/g, '"…"'); reasons.set(key, (reasons.get(key) ?? 0) + 1); }
  for (const [reason, total] of reasons) console.log(`  ${total} × ${reason}`);
  console.log(`SQL written to ${out}. It waits for approval: nothing sends until ${citiesWith(words).approvers.join(" or ")} approves it.`);
} else if (command === "approve-sql") {
  const [batch, founder, evidence, out] = args;
  if (!batch || !founder || !["Riley", "Aidan"].includes(founder) || !evidence || !out) fail("usage: approve-sql <batch id> <Riley|Aidan> \"<where they said so>\" <out.sql>");
  writeFileSync(out!, `UPDATE "OutreachBatch" SET "status" = 'approved', "approvedBy" = ${q(founder!)}, "approvedAt" = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
  "approvedWords" = COALESCE("wordsVersion", (SELECT "wordsVersion" FROM "OutreachCampaign" WHERE "key" = "OutreachBatch"."campaignKey")), "approvalNote" = ${q(evidence!.slice(0, 300))}
  WHERE "id" = ${q(batch!)} AND "status" <> 'stopped'
    AND EXISTS (SELECT 1 FROM "OutreachCampaign" c, json_each(c."approversJson") a WHERE c."key" = "OutreachBatch"."campaignKey" AND a."value" = ${q(founder!)});\n`);
  console.log(`Approval by ${founder} for ${batch} written to ${out}.`);
} else if (command === "settings-sql") {
  const [campaign, out, ...pairs] = args;
  if (!campaign || !out || pairs.length === 0) fail("usage: settings-sql <campaign> <out.sql> key=value ...");
  const sets = settingPairs(pairs).map(([column, value]) => `"${column}" = ${value}`);
  const by = sets.some((set) => set.startsWith('"state"')) ? `, "stateBy" = 'Riley''s Claude', "stateAt" = strftime('%Y-%m-%dT%H:%M:%fZ','now'), "stateReason" = NULL` : "";
  writeFileSync(out!, `UPDATE "OutreachCampaign" SET ${sets.join(", ")}${by}, "updatedAt" = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE "key" = ${q(campaign!)};\n`);
  console.log(`Settings for ${campaign} written to ${out}.`);
} else if (command === "new-campaign-sql") {
  // A new avenue is a row, never code: it starts paused, sends nothing until it has words, an approved batch and
  // a founder's Resume, and needs its inboxes, daily limit and approvers named up front.
  const [key, name, out, ...pairs] = args;
  if (!key || !name || !out) fail("usage: new-campaign-sql <key> \"<name>\" <out.sql> inboxesJson=... dailyLimit=N approversJson=... [key=value ...]");
  if (!/^[a-z0-9-]{2,40}$/.test(key!)) fail("The key is 2 to 40 lowercase letters, digits or dashes, like agencies.");
  if (name!.length > 80) fail("The name is at most 80 characters.");
  const settings = settingPairs(pairs).filter(([column]) => column !== "state" && column !== "name");
  for (const needed of ["inboxesJson", "dailyLimit", "approversJson"]) if (!settings.some(([column]) => column === needed)) fail(`Name ${needed} for a new campaign.`);
  const columns = ["key", "name", "state", "stateReason", "stateBy", "stateAt", ...settings.map(([column]) => column)];
  const values = [q(key!), q(name!), "'paused'", q("New campaign: waiting for its words and an approved batch"), q("Riley's Claude"), "strftime('%Y-%m-%dT%H:%M:%fZ','now')", ...settings.map(([, value]) => value)];
  writeFileSync(out!, `INSERT INTO "OutreachCampaign" (${columns.map((column) => `"${column}"`).join(",")}) VALUES (${values.join(", ")});\n`);
  console.log(`New campaign ${key} (paused) written to ${out}. Next: load its words and first list on the Campaigns screen.`);
} else {
  fail("commands: preview, words-sql, import-sql, approve-sql, settings-sql, new-campaign-sql (see the top of scripts/outreach.ts)");
}
}

run().catch((error: unknown) => fail(error instanceof Error ? error.message : String(error)));
