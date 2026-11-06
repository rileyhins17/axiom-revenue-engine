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
 *
 * The mailing address for previews comes from $env:FCC_CAMPAIGN_MAILING_ADDRESS (outreach/fcc-campaign.env).
 */
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

import { campaignFromRow, type Campaign } from "@/lib/outreach/outreach-model";
import { importSql, planImport } from "@/lib/outreach/outreach-import";
import { parseStepText, renderEmail, wordsProblems, wordsVersion, type CampaignWords } from "@/lib/outreach/outreach-words";
import { parseCsv } from "@/lib/outreach/outreach-csv";

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

if (command === "preview") {
  const [first, follow, csv, count = "10"] = args;
  if (!first || !follow || !csv) fail("usage: preview <first.txt> <followup.txt> <list.csv> [count]");
  const words = readWords(first!, follow!);
  const campaign = citiesWith(words);
  const plan = planImport(campaign, readFileSync(csv!, "utf8"), { batchId: "preview", name: "preview", loadedBy: "preview", now: new Date(), newId: randomUUID, sender: AIDAN, mailingAddress: mailing || "(mailing address)" });
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
    sender: AIDAN, mailingAddress: mailing || "(checked again at send time)",
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
  "approvedWords" = (SELECT "wordsVersion" FROM "OutreachCampaign" WHERE "key" = "OutreachBatch"."campaignKey"), "approvalNote" = ${q(evidence!.slice(0, 300))}
  WHERE "id" = ${q(batch!)} AND "status" <> 'stopped'
    AND EXISTS (SELECT 1 FROM "OutreachCampaign" c, json_each(c."approversJson") a WHERE c."key" = "OutreachBatch"."campaignKey" AND a."value" = ${q(founder!)});\n`);
  console.log(`Approval by ${founder} for ${batch} written to ${out}.`);
} else if (command === "settings-sql") {
  const [campaign, out, ...pairs] = args;
  if (!campaign || !out || pairs.length === 0) fail("usage: settings-sql <campaign> <out.sql> key=value ...");
  const allowed = new Set(["state", "dailyLimit", "inboxesJson", "startDay", "endDay", "windowStart", "windowEnd", "sendDays", "followUps", "followUpBusinessDays", "approversJson", "rulesJson", "priority", "name", "note"]);
  const numbers = new Set(["dailyLimit", "windowStart", "windowEnd", "followUps", "followUpBusinessDays", "priority"]);
  const sets = pairs.map((pair) => {
    const at = pair.indexOf("=");
    const key = pair.slice(0, at);
    const value = pair.slice(at + 1);
    if (at < 1 || !allowed.has(key)) fail(`Unknown setting "${key}".`);
    if (key.endsWith("Json")) { try { JSON.parse(value); } catch { fail(`${key} is not valid JSON.`); } }
    if (key === "state" && !["live", "paused"].includes(value)) fail("state is live or paused.");
    return `"${key}" = ${numbers.has(key) ? String(Number(value)) : value === "null" ? "NULL" : q(value)}`;
  });
  const by = sets.some((set) => set.startsWith('"state"')) ? `, "stateBy" = 'Riley''s Claude', "stateAt" = strftime('%Y-%m-%dT%H:%M:%fZ','now'), "stateReason" = NULL` : "";
  writeFileSync(out!, `UPDATE "OutreachCampaign" SET ${sets.join(", ")}${by}, "updatedAt" = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE "key" = ${q(campaign!)};\n`);
  console.log(`Settings for ${campaign} written to ${out}.`);
} else {
  fail("commands: preview, words-sql, import-sql, approve-sql, settings-sql (see the top of scripts/outreach.ts)");
}
