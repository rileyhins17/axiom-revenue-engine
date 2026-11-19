/**
 * Builds a local copy of the engine's database with made-up data, for looking at the screens and trying the Claude
 * connector on your own computer. It never touches the live database: it only writes the SQLite file you name.
 *
 *   npx tsx scripts/demo-data.ts ./data/demo.db            # "busy": things need a founder
 *   npx tsx scripts/demo-data.ts ./data/demo.db calm        # nothing needs anyone
 *   npx tsx scripts/demo-data.ts ./data/demo.db empty       # a brand-new engine
 *
 * Then: DATABASE_PATH=./data/demo.db npm run dev (docs/runbooks/LOCAL_PREVIEW.md has the other settings).
 *
 * Every place, person and address here is invented (the .example domains can't receive mail). This repository is
 * public: keep it that way. Nothing here sends email; the local app has no inbox passwords.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";

import Database from "better-sqlite3";

import { FCC_CAMPAIGN_KEY, FCC_COPY_VERSION } from "../src/lib/fcc-campaign";
import { OUTREACH_REPLY_STATE } from "../src/lib/outreach/outreach-replies";
import { OUTREACH_AUTO_PAUSE_BY, addBusinessDays } from "../src/lib/outreach/outreach-sender";
import { parseStepText, wordsVersion } from "../src/lib/outreach/outreach-words";

const [path, scenario = "busy"] = process.argv.slice(2);
if (!path || !["busy", "calm", "empty"].includes(scenario)) {
  console.error("usage: npx tsx scripts/demo-data.ts <new-database-file> [busy|calm|empty]");
  process.exit(1);
}
if (existsSync(path)) {
  // Only ever replace a file this script made.
  const old = new Database(path, { readonly: true });
  const mine = old.prepare(`SELECT 1 AS hit FROM sqlite_master WHERE name = 'KvStore'`).get() && old.prepare(`SELECT 1 AS hit FROM "KvStore" WHERE "key" = 'demo.madeUp'`).get();
  old.close();
  if (!mine) { console.error(`${path} exists and is not a demo database. Name a new file.`); process.exit(1); }
  for (const suffix of ["", "-wal", "-shm"]) rmSync(`${path}${suffix}`, { force: true });
}
mkdirSync(dirname(path), { recursive: true });
const db = new Database(path);
db.pragma("journal_mode = WAL");
const migrations = join(__dirname, "..", "migrations");
for (const file of readdirSync(migrations).filter((name) => name.endsWith(".sql")).sort()) db.exec(readFileSync(join(migrations, file), "utf8"));

const now = new Date();
const iso = (date: Date) => date.toISOString();
const dayOf = (date: Date) => date.toLocaleDateString("en-CA", { timeZone: "America/Toronto" });
const today = dayOf(now);
const daysAgo = (days: number, hour = 15) => { const date = new Date(now.getTime() - days * 86_400_000); date.setUTCHours(hour, 7, 0, 0); return date; };
const minutesAgo = (minutes: number) => new Date(now.getTime() - minutes * 60_000);
const kv = (key: string, value: unknown) => db.prepare(`INSERT INTO "KvStore" ("key","value","updatedAt") VALUES (?,?,?) ON CONFLICT("key") DO UPDATE SET "value" = excluded."value"`).run(key, JSON.stringify(value), iso(now));
kv("demo.madeUp", { scenario, at: iso(now) });

// The two sending inboxes, with invented addresses in place of the real ones the migration names.
const AIDAN = "aidan@axiom-demo.example";
const RILEY = "riley@axiom-demo.example";
db.prepare(`DELETE FROM "OutreachInbox"`).run();
const inbox = db.prepare(`INSERT INTO "OutreachInbox" ("address","name","passwordSecret","dailyMax","rampJson","rampFrom","note") VALUES (?,?,?,?,?,?,?)`);
inbox.run(AIDAN, "Aidan Example", "DEMO_PASSWORD_1", 60, "[]", null, "Made-up inbox");
inbox.run(RILEY, "Riley Example", "DEMO_PASSWORD_2", 60, "[15,30]", dayOf(daysAgo(20)), "Made-up inbox, past its ramp");

const FIRST = `Subject: {city}'s website: {error_count} accessibility problems before the April 2027 deadline

Hi {first_name},

We ran a free check of {city}'s website against the accessibility standard cities must meet by April 2027. It found {error_count} problems. The biggest: {worst_problem}.

Would the full report be useful? It's free either way.

{sender_name}
Axiom`;
const FOLLOW = `Hi {first_name}, just checking you saw my note about {city}'s website. Happy to send the full report, no cost.

{sender_first_name}`;
const words = { steps: [parseStepText(FIRST, 1), parseStepText(FOLLOW, 2)] };
const version = wordsVersion(words);
const COLUMNS = ["email", "first_name", "title", "city", "state", "verified", "error_count", "worst_problem"];
const RULES = { holdUnless: { verified: ["yes", "true"] }, noLinksInFirst: true, stopOnAutoReply: true };

const PLACES = ["Port Halden", "Maplewood Springs", "Elm Hollow", "Stonebridge Flats", "Northmere", "Cinder Creek", "Brackenridge", "Fennimore Bay", "Alder Ridge", "Tallow Point",
  "Quillfeather", "Harrow Glen", "Wexley", "Lantern Hill", "Dunmarrow", "Saltwick", "Ferncastle", "Ostrander Falls", "Pellham Cross", "Greywater", "Thistledown", "Marlowe Junction",
  "Coppergate", "Ashby Landing", "Rookwood", "Vesper Lake", "Hollin Fields", "Kestrel Bend", "Marrow Sound", "Yarrowby", "Bramblewick", "Castor Plains", "Drummond Shoal", "Eastmoor",
  "Fallowmere", "Garnet Forks", "Hazelrigg", "Inkwell Harbor", "Juniper Wells", "Kettleby", "Larkspur Mills", "Mossgiel", "Nettlecombe", "Oakhanger", "Pinderfield", "Quarrydown",
  "Redmarsh", "Sorrel Heights", "Tamarack Rise", "Umberleigh", "Varley Green", "Wrenfield", "Yewdale", "Zephyr Cove", "Amberwick", "Birchover", "Clovermead", "Dapplemere", "Everfold", "Foxholt"];
const PEOPLE = ["Dana", "Sam", "Priya", "Marcus", "Elena", "Tobias", "Noor", "Callum", "Ines", "Rafael", "Greta", "Omar", "Lucia", "Henrik", "Maya", "Jonas", "Farah", "Desmond", "Anika", "Wyatt"];
const TITLES = ["City Clerk", "IT Manager", "Communications Director", "ADA Coordinator", "Web Administrator"];
const PROBLEMS = ["images have no text description", "form fields have no labels", "text is too faint to read", "PDF agendas can't be read aloud"];
const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "");

type Status = "ready" | "held" | "sent" | "done" | "replied" | "bounced" | "suppressed" | "failed";
type Row = { id: string; email: string; place: string; campaign: string };
let seq = 0;
let order = 0;
const campaign = db.prepare(`INSERT OR REPLACE INTO "OutreachCampaign" ("key","name","state","stateReason","stateBy","stateAt","priority","startDay","sendDays","windowStart","windowEnd","dailyLimit",
  "inboxesJson","followUps","followUpBusinessDays","wordsJson","wordsVersion","rulesJson","approversJson","note") VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
const batchInsert = db.prepare(`INSERT INTO "OutreachBatch" ("id","campaignKey","name","source","columnsJson","rows","ready","held","loadedBy","loadedAt","status","approvedBy","approvedAt","approvedWords",
  "approvalNote","sendOrder","wordsJson","wordsVersion") VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
const contactInsert = db.prepare(`INSERT INTO "OutreachContact" ("id","campaignKey","batchId","rowNumber","email","fieldsJson","status","holdReason","stoppedReason","stepsSent","senderAddress",
  "firstSentAt","firstSentDay","firstMessageId","firstSubject","lastMessageId","nextDueDay","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
const sendInsert = db.prepare(`INSERT INTO "OutreachSend" ("sendId","campaignKey","contactId","kind","step","email","senderAddress","sendDay","messageId","subject","status","createdAt","finishedAt")
  VALUES (?,?,?,'real',?,?,?,?,?,?,'SENT',?,?)`);
const replyInsert = db.prepare(`INSERT INTO "OutreachReply" ("id","campaignKey","contactId","inbox","fromAddress","receivedAt","quote","kind","foundAt","toldFoundersAt","answeredAt","answeredBy","successAt","successBy")
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
const block = db.prepare(`INSERT OR IGNORE INTO "EngineEmailSuppression" ("email","reason","createdAt") VALUES (?,?,?)`);

function addCampaign(key: string, name: string, options: { state?: "live" | "paused"; reason?: string | null; by?: string | null; at?: Date | null; priority: number; limit: number;
  inboxes: Array<{ address: string; perDay: number }>; approvers?: string[]; success?: string; withWords?: boolean; note?: string }) {
  campaign.run(key, name, options.state ?? "live", options.reason ?? null, options.by ?? null, options.at ? iso(options.at) : null, options.priority, dayOf(daysAgo(14)), "Mon,Tue,Wed,Thu,Fri", 540, 870,
    options.limit, JSON.stringify(options.inboxes), 1, 5, JSON.stringify(options.withWords === false ? { steps: [] } : words), options.withWords === false ? null : version,
    JSON.stringify(options.success ? { ...RULES, successLabel: options.success } : RULES), JSON.stringify(options.approvers ?? ["Aidan"]), options.note ?? null);
}

/** A batch and its rows. `emailed` rows were first emailed `sentDaysAgo` days ago, alternating inboxes unless `from` is given. */
function addBatch(key: string, name: string, options: { approved?: boolean; loadedDaysAgo: number; ready?: number; held?: string[]; emailed?: number; sentDaysAgo?: number; from?: string; followUpOnHold?: number }) {
  const id = `b-demo-${++seq}`;
  const rows: Row[] = [];
  const total = (options.ready ?? 0) + (options.held?.length ?? 0) + (options.emailed ?? 0);
  batchInsert.run(id, key, name, "from the Campaigns screen", JSON.stringify(COLUMNS), total, options.ready ?? 0, options.held?.length ?? 0, "Riley", iso(daysAgo(options.loadedDaysAgo, 21)),
    options.approved ? "approved" : "waiting", options.approved ? "Aidan" : null, options.approved ? iso(daysAgo(options.loadedDaysAgo, 22)) : null, options.approved ? version : null,
    options.approved ? "Approved on the Campaigns screen after reading the samples" : null, ++order, JSON.stringify(words), version);
  const add = (status: Status, extra: { hold?: string | null; sent?: { at: Date; from: string } | null; due?: string | null }) => {
    const index = seq++;
    const place = `${["", "North ", "East ", "South ", "West ", "Upper ", "New "][Math.floor(index / PLACES.length) % 7]}${PLACES[index % PLACES.length]!}`;
    const first = PEOPLE[index % PEOPLE.length]!;
    const email = `${first.toLowerCase()}.${slug(place)}@${slug(place)}.example`;
    const contact = `c-demo-${index}`;
    const fields = { email, first_name: first, title: TITLES[index % TITLES.length]!, city: place, state: ["OR", "WA", "ID", "MT"][index % 4]!, verified: extra.hold?.includes("verified") ? "no" : "yes",
      error_count: String(40 + (index * 7) % 160), worst_problem: PROBLEMS[index % PROBLEMS.length]! };
    const subject = `${place}'s website: ${fields.error_count} accessibility problems before the April 2027 deadline`;
    const messageId = extra.sent ? `<ax-${key}-${contact}-1@axiom-demo.example>` : null;
    contactInsert.run(contact, key, id, rows.length + 1, email, JSON.stringify(fields), status, extra.hold ?? null, null, extra.sent ? 1 : 0, extra.sent?.from ?? null,
      extra.sent ? iso(extra.sent.at) : null, extra.sent ? dayOf(extra.sent.at) : null, messageId, extra.sent ? subject : null, messageId, extra.due ?? null, iso(daysAgo(options.loadedDaysAgo, 21)), iso(extra.sent?.at ?? daysAgo(options.loadedDaysAgo, 21)));
    if (extra.sent) sendInsert.run(`s-demo-${index}`, key, contact, 1, email, extra.sent.from, dayOf(extra.sent.at), messageId, subject, iso(extra.sent.at), iso(extra.sent.at));
    rows.push({ id: contact, email, place, campaign: key });
    return rows.at(-1)!;
  };
  for (let i = 0; i < (options.emailed ?? 0); i += 1) {
    const at = options.sentDaysAgo ? new Date(daysAgo(options.sentDaysAgo, 14).getTime() + i * 130_000) : minutesAgo(Math.max(3, 150 - i * 3));
    const onHold = i < (options.followUpOnHold ?? 0);
    add("sent", { sent: { at, from: options.from ?? (i % 2 ? RILEY : AIDAN) }, due: onHold ? null : addBusinessDays(dayOf(at), 5) });
  }
  for (let i = 0; i < (options.ready ?? 0); i += 1) add("ready", {});
  for (const reason of options.held ?? []) add("held", { hold: reason });
  return { id, rows };
}

const stop = (row: Row, status: Status, reason: string, at: Date) => db.prepare(`UPDATE "OutreachContact" SET "status" = ?, "stoppedReason" = ?, "nextDueDay" = NULL, "updatedAt" = ? WHERE "id" = ?`)
  .run(status, reason, iso(at), row.id);
function reply(row: Row, kind: "reply" | "automatic" | "no_thanks", text: string, landedIn: string, at: Date, marks: { answeredBy?: string; success?: boolean; from?: string } = {}) {
  replyInsert.run(`${landedIn}:[Gmail]/All Mail:${9000 + seq++}:${row.id}`, row.campaign, row.id, landedIn, marks.from ?? row.email, iso(at), text, kind, iso(at), iso(at),
    marks.answeredBy ? iso(new Date(at.getTime() + 3_600_000)) : null, marks.answeredBy ?? null, marks.success ? iso(new Date(at.getTime() + 3_700_000)) : null, marks.success ? marks.answeredBy ?? "Riley" : null);
  if (kind === "no_thanks") { stop(row, "suppressed", `They said no thanks: "${text}"`, at); block.run(row.email, "UNSUBSCRIBED", iso(at)); }
  else stop(row, "replied", `They ${kind === "automatic" ? "sent an automatic reply" : "wrote back"}, so no more emails: "${text.slice(0, 160)}"`, at);
}
const bounce = (row: Row, at: Date) => { stop(row, "bounced", "The email bounced", at); block.run(row.email, "BOUNCED", iso(at)); };

// ---- campaigns ----
addCampaign("us-cities", "US cities: accessibility", { priority: 10, limit: 60, inboxes: [{ address: AIDAN, perDay: 30 }, { address: RILEY, perDay: 30 }], success: "Price requests",
  note: "The free accessibility report offer, to cities and counties." });
addCampaign("school-districts", "School districts: accessibility", { priority: 20, limit: 20, inboxes: [{ address: RILEY, perDay: 20 }] });
addCampaign("agencies", "Agencies: overflow web work", { state: "paused", reason: "New campaign: waiting for its words and an approved batch", by: "Riley's Claude", at: daysAgo(2), priority: 30, limit: 20,
  inboxes: [{ address: AIDAN, perDay: 10 }, { address: RILEY, perDay: 10 }], approvers: ["Riley", "Aidan"], withWords: false });

if (scenario !== "empty") {
  // Last week's batch: emailed, some answered, follow-ups coming, two on hold.
  const a1 = addBatch("us-cities", "cities-A1", { approved: true, loadedDaysAgo: 6, emailed: 30, sentDaysAgo: 4, followUpOnHold: 2 });
  const calm = scenario === "calm";
  reply(a1.rows[5]!, "reply", "Yes please, send the full report. Who would do the fixes, and roughly what would it cost?", RILEY, daysAgo(0, 16), calm ? { answeredBy: "Riley", success: true } : {});
  reply(a1.rows[8]!, "reply", "Thanks for this. Our website is run by the Communications Office, not my desk. Please write to them; I've copied their director.", AIDAN, daysAgo(1, 19),
    calm ? { answeredBy: "Aidan" } : { from: `comms@${slug(a1.rows[8]!.place)}.example` });
  reply(a1.rows[11]!, "reply", "Could you send pricing for fixing the forms and the PDF agendas? We have budget set aside for the April deadline.", RILEY, daysAgo(2, 18), { answeredBy: "Riley", success: true });
  reply(a1.rows[14]!, "no_thanks", "Not interested, thanks. Please take us off your list.", AIDAN, daysAgo(3, 17));
  reply(a1.rows[17]!, "automatic", "I am out of the office until Monday and will answer when I'm back.", AIDAN, daysAgo(3, 20));
  reply(a1.rows[20]!, "automatic", "Thank you for contacting the City Clerk's office. We answer within three business days.", RILEY, daysAgo(3, 21));
  // A reply the sender's own inbox check found before a follow-up: the contact says replied, no message was recorded.
  stop(a1.rows[23]!, "replied", "They wrote back, so no more emails", daysAgo(2, 16));
  if (calm) db.prepare(`UPDATE "OutreachContact" SET "status" = 'sent', "stoppedReason" = NULL, "nextDueDay" = ? WHERE "id" = ?`).run(addBusinessDays(today, 2), a1.rows[23]!.id);
  bounce(a1.rows[26]!, daysAgo(4, 15));
  bounce(a1.rows[28]!, daysAgo(4, 15));

  // Today's batch: 28 out so far, 12 still to go.
  const b1 = addBatch("us-cities", "cities-B1", { approved: true, loadedDaysAgo: 3, emailed: 28, ready: 12 });
  const d1 = addBatch("school-districts", "districts-D1", { approved: true, loadedDaysAgo: 2, emailed: 10, ready: 15, from: RILEY });
  if (!calm) {
    // Three bounces from Riley's inbox today, across two campaigns: the inbox rests for the day and nobody is paused.
    bounce(b1.rows[1]!, minutesAgo(95));
    bounce(b1.rows[3]!, minutesAgo(80));
    bounce(d1.rows[2]!, minutesAgo(40));
    // Three batches wait for Aidan's Approve.
    addBatch("us-cities", "cities-IT1 A", { loadedDaysAgo: 1, ready: 24, held: ["verified is \"no\": the list says this address wasn't checked", "porthalden.example has no mail server, so the email would bounce"] });
    addBatch("us-cities", "cities-IT1 B", { loadedDaysAgo: 1, ready: 17 });
    addBatch("school-districts", "districts-D2", { loadedDaysAgo: 0, ready: 58 });
    // A campaign that paused itself yesterday.
    addCampaign("county-it", "Counties: IT and web contacts", { state: "paused", reason: "3 of its emails bounced today", by: OUTREACH_AUTO_PAUSE_BY, at: daysAgo(1, 15), priority: 15, limit: 10,
      inboxes: [{ address: AIDAN, perDay: 10 }] });
    const c1 = addBatch("county-it", "counties-IT3", { approved: true, loadedDaysAgo: 2, emailed: 9, sentDaysAgo: 1, ready: 29, from: AIDAN });
    for (const index of [0, 4, 7]) bounce(c1.rows[index]!, daysAgo(1, 15));
  } else {
    addBatch("school-districts", "districts-D2", { approved: true, loadedDaysAgo: 0, ready: 58 });
  }

  kv(OUTREACH_REPLY_STATE, { inboxes: { [AIDAN]: iso(minutesAgo(25)), [RILEY]: iso(minutesAgo(25)) }, at: iso(minutesAgo(25)), unread: [] });
  for (const key of ["us-cities", "school-districts"]) kv(`outreach.lastRun:${key}`, { note: "Sent 1 first email.", at: iso(minutesAgo(12)) });

  // FCC, ended: its history stays to read.
  const fccContact = db.prepare(`INSERT INTO "FccCampaignContact" ("id","campaignKey","email","firstName","company","filingsJson","emailKind","sendable","status","step1SentAt","stoppedReason","createdAt","updatedAt")
    VALUES (?,?,?,?,?,'[]','named',1,?,?,?,?,?)`);
  const fccSend = db.prepare(`INSERT INTO "FccCampaignSend" ("sendId","contactId","step","email","sendDay","messageId","status","createdAt","finishedAt","senderAddress") VALUES (?,?,1,?,?,?,'SENT',?,?,NULL)`);
  for (let i = 0; i < 40; i += 1) {
    const company = `${PLACES[(i + 20) % PLACES.length]} Telecom`;
    const email = `${PEOPLE[i % PEOPLE.length]!.toLowerCase()}@${slug(company)}.example`;
    const at = daysAgo(16 + (i % 6), 15);
    const status = i === 3 || i === 9 ? "replied" : i === 5 ? "bounced" : "step1_sent";
    const note = i === 3 ? "They wrote back: \"We already filed this ourselves in October.\"" : i === 9 ? "They sent an automatic reply, so no more emails" : i === 5 ? "The email bounced" : null;
    fccContact.run(`f-demo-${i}`, FCC_CAMPAIGN_KEY, email, PEOPLE[i % PEOPLE.length], company, status, iso(at), note, iso(daysAgo(30)), iso(new Date(at.getTime() + 86_400_000)));
    fccSend.run(`fs-demo-${i}`, `f-demo-${i}`, email, dayOf(at), `<fcc-demo-${i}@axiom-demo.example>`, iso(at), iso(at));
  }
}
db.prepare(`UPDATE "FccCampaignSetting" SET "enabled" = 0, "approvedCopy" = ?, "goBy" = 'Aidan', "goAt" = ? WHERE "id" = 1`).run(FCC_COPY_VERSION, iso(daysAgo(20)));
kv("fcc.control", { action: "paused", reason: "FCC ended: paused for good", by: "Aidan", at: iso(daysAgo(2, 21)) });

const count = (table: string) => (db.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get() as { n: number }).n;
console.log(`${path}: "${scenario}" demo data for ${today}. ${count("OutreachCampaign")} campaigns, ${count("OutreachBatch")} batches, ${count("OutreachContact")} people, ${count("OutreachReply")} replies. All made up.`);
db.close();
