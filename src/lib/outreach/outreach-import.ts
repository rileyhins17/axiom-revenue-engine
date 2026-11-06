/**
 * Loading a list into a campaign: one CSV becomes one batch. Every row is kept; a row that can't be
 * sent is held with the reason, and nothing in the batch sends until a named approver approves it.
 *
 * A row is held when: its email address isn't valid; the same address is earlier in the file; a hold
 * rule fails (cities: verified must be yes/true); a blank the words use is empty; an email can't be
 * written from it (for example the first email would carry a link); its domain has no mail server (when
 * the loader checked: outreach-mail-servers.ts); or the address is on the
 * do-not-email list or bounced or said "no thanks" in any campaign (checked again before every send).
 * An address already in the campaign from an earlier batch is skipped, never emailed twice.
 */
import type { Campaign } from "@/lib/outreach/outreach-model";
import { FCC_SAID_NO_SQL } from "@/lib/outreach/outreach-blocked";
import { parseCsv, type CsvTable } from "@/lib/outreach/outreach-csv";
import { emailDomain } from "@/lib/outreach/outreach-mail-servers";
import { fieldsUsed, renderEmail, wordsProblems, wordsVersion, type Sender } from "@/lib/outreach/outreach-words";
import type { ProspectDb } from "@/lib/revenue-engine/engine-prospects-d1";

export const EMAIL_PATTERN = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

export type PlannedContact = { id: string; rowNumber: number; email: string; fields: Record<string, string>; status: "ready" | "held"; holdReason: string | null };
export type ImportPlan = {
  batch: { id: string; campaignKey: string; name: string; source: string | null; columns: string[]; loadedBy: string; loadedAt: string };
  contacts: PlannedContact[];
  /** Problems that stop the whole load (nothing is loaded). */
  errors: string[];
};

const truthy = (value: string, allowed: string[]) => allowed.some((option) => option.trim().toLowerCase() === value.trim().toLowerCase());

/**
 * Checks one CSV against a campaign's words and rules. `sender` and `mailingAddress` let every row be
 * written out exactly as it would go, so a row that can't be is held now rather than at send time.
 */
export function planImport(campaign: Campaign, csv: string | CsvTable, input: {
  batchId: string; name: string; source?: string | null; loadedBy: string; now: Date; newId: () => string; sender: Sender; mailingAddress: string | null | undefined;
  /** Domains with no mail server, from checkMailServers: their rows are held. */
  noMailServer?: Map<string, string>;
}): ImportPlan {
  const errors: string[] = [];
  let table: CsvTable = { columns: [], rows: [] };
  try { table = typeof csv === "string" ? parseCsv(csv) : csv; } catch (error) { errors.push(error instanceof Error ? error.message : "The CSV can't be read."); }
  const oneLine = (text: string) => text.replace(/[\r\n]+/g, " ").trim();
  const batch = { id: input.batchId, campaignKey: campaign.key, name: oneLine(input.name).slice(0, 120), source: input.source ? oneLine(input.source).slice(0, 300) : null,
    columns: table.columns, loadedBy: oneLine(input.loadedBy).slice(0, 120), loadedAt: input.now.toISOString() };
  if (campaign.problem) errors.push(`The campaign's settings can't be used: ${campaign.problem}.`);
  if (!batch.name) errors.push("The batch needs a name.");
  if (!errors.length && !table.columns.includes("email")) errors.push("The list needs an email column.");
  if (!errors.length) errors.push(...wordsProblems(campaign.words, table.columns, campaign.rules));
  if (!errors.length && table.rows.length === 0) errors.push("The list has no rows.");
  if (errors.length) return { batch, contacts: [], errors };

  const used = fieldsUsed(campaign.words);
  const seen = new Map<string, number>();
  const contacts = table.rows.map((fields, index): PlannedContact => {
    const rowNumber = index + 2; // the header is row 1, as a spreadsheet shows it
    const email = (fields.email ?? "").trim().toLowerCase();
    const id = input.newId();
    // A held row that can't keep its own address (invalid, or a repeat in this file) gets one that can never be delivered;
    // the address as written stays in its fields for the screen.
    const hold = (reason: string, address = email): PlannedContact => ({ id, rowNumber, email: address, fields, status: "held", holdReason: reason.slice(0, 300) });
    if (!EMAIL_PATTERN.test(email)) return hold(email ? `"${email.slice(0, 80)}" is not a valid email address` : "No email address", `${id.toLowerCase()}@invalid.invalid`);
    const earlier = seen.get(email);
    if (earlier) return hold(`Same email address as row ${earlier}`, `${id.toLowerCase()}@invalid.invalid`);
    seen.set(email, rowNumber);
    const domain = emailDomain(email);
    const mailProblem = input.noMailServer?.get(domain);
    if (mailProblem) return hold(`${domain} ${mailProblem}, so the email would bounce`);
    for (const [column, allowed] of Object.entries(campaign.rules.holdUnless ?? {})) {
      const value = (fields[column] ?? "").trim();
      if (!truthy(value, allowed)) return hold(value ? `Not ${column} (${column} is "${value.slice(0, 40)}")` : `Not ${column} (blank)`);
    }
    const blank = used.filter((column) => !(fields[column] ?? "").trim());
    if (blank.length) return hold(`Blank ${blank.map((column) => `{${column}}`).join(", ")}`);
    for (let step = 1; step <= Math.min(campaign.words.steps.length, campaign.followUps + 1); step += 1) {
      const result = renderEmail(campaign.words, step, fields, input.sender, input.mailingAddress, { noLinksInFirst: campaign.rules.noLinksInFirst });
      if (!result.ok) return hold(step === 1 ? result.reason : `Follow-up ${step - 1}: ${result.reason}`);
    }
    return { id, rowNumber, email, fields, status: "ready", holdReason: null };
  });
  return { batch, contacts, errors };
}

const sqlText = (value: string | null) => (value === null ? "NULL" : `'${value.replace(/'/g, "''")}'`);

/** SQL that holds every waiting row of `batchId` whose address may not be emailed by any campaign. Runs on the live data. */
export function holdBlockedSql(batchId: string) {
  const id = sqlText(batchId);
  return [
    `UPDATE "OutreachContact" SET "status" = 'held', "holdReason" = 'On the do-not-email list (bounced, said no thanks or asked not to be contacted)', "updatedAt" = strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE "batchId" = ${id} AND "status" = 'ready' AND (
        EXISTS (SELECT 1 FROM "EngineEmailSuppression" s WHERE s."email" = "OutreachContact"."email" OR s."email" = '@' || substr("OutreachContact"."email", instr("OutreachContact"."email", '@') + 1))
        OR EXISTS (SELECT 1 FROM "FccCampaignContact" f WHERE lower(f."email") = "OutreachContact"."email" AND (f."status" = 'bounced' OR ${FCC_SAID_NO_SQL}))
        OR EXISTS (SELECT 1 FROM "OutreachContact" o WHERE o."email" = "OutreachContact"."email" AND o."id" <> "OutreachContact"."id" AND o."status" = 'bounced')
        OR EXISTS (SELECT 1 FROM "OutreachReply" r JOIN "OutreachContact" o ON o."id" = r."contactId" WHERE o."email" = "OutreachContact"."email" AND r."kind" = 'no_thanks'));`,
    `UPDATE "OutreachBatch" SET "rows" = (SELECT COUNT(*) FROM "OutreachContact" WHERE "batchId" = ${id}),
      "ready" = (SELECT COUNT(*) FROM "OutreachContact" WHERE "batchId" = ${id} AND "status" = 'ready'),
      "held" = (SELECT COUNT(*) FROM "OutreachContact" WHERE "batchId" = ${id} AND "status" = 'held') WHERE "id" = ${id};`,
  ];
}

/**
 * The SQL that loads a plan (to run with `wrangler d1 execute --file`). Re-running it changes nothing:
 * the batch and every contact are INSERT OR IGNORE, and an address already in the campaign is skipped.
 */
export function importSql(plan: ImportPlan) {
  if (plan.errors.length) throw new Error(plan.errors.join(" "));
  const b = plan.batch;
  const at = sqlText(b.loadedAt);
  const lines = [
    `INSERT OR IGNORE INTO "OutreachBatch" ("id","campaignKey","name","source","columnsJson","rows","ready","held","loadedBy","loadedAt","status","sendOrder")
      VALUES (${sqlText(b.id)}, ${sqlText(b.campaignKey)}, ${sqlText(b.name)}, ${sqlText(b.source)}, ${sqlText(JSON.stringify(b.columns))}, 0, 0, 0, ${sqlText(b.loadedBy)}, ${at}, 'waiting',
        (SELECT COALESCE(MAX("sendOrder"), 0) + 1 FROM "OutreachBatch" WHERE "campaignKey" = ${sqlText(b.campaignKey)}));`,
    ...plan.contacts.map((c) => `INSERT OR IGNORE INTO "OutreachContact" ("id","campaignKey","batchId","rowNumber","email","fieldsJson","status","holdReason","createdAt","updatedAt")
      VALUES (${sqlText(c.id)}, ${sqlText(b.campaignKey)}, ${sqlText(b.id)}, ${c.rowNumber}, ${sqlText(c.email)}, ${sqlText(JSON.stringify(c.fields))}, '${c.status}', ${sqlText(c.holdReason)}, ${at}, ${at});`),
    ...holdBlockedSql(b.id),
  ];
  return `${lines.join("\n")}\n`;
}

/**
 * Loads a plan straight into the database (the engine screen's upload). Returns the batch's counts and how
 * many rows were skipped because their address is already in the campaign.
 */
export async function importToDb(db: ProspectDb, plan: ImportPlan) {
  if (plan.errors.length) throw new Error(plan.errors.join(" "));
  const b = plan.batch;
  await db.prepare(`INSERT OR IGNORE INTO "OutreachBatch" ("id","campaignKey","name","source","columnsJson","rows","ready","held","loadedBy","loadedAt","status","sendOrder")
    VALUES (?,?,?,?,?,0,0,0,?,?,'waiting',(SELECT COALESCE(MAX("sendOrder"), 0) + 1 FROM "OutreachBatch" WHERE "campaignKey" = ?))`)
    .bind(b.id, b.campaignKey, b.name, b.source, JSON.stringify(b.columns), b.loadedBy, b.loadedAt, b.campaignKey).run();
  for (const c of plan.contacts) {
    await db.prepare(`INSERT OR IGNORE INTO "OutreachContact" ("id","campaignKey","batchId","rowNumber","email","fieldsJson","status","holdReason","createdAt","updatedAt")
      VALUES (?,?,?,?,?,?,?,?,?,?)`).bind(c.id, b.campaignKey, b.id, c.rowNumber, c.email, JSON.stringify(c.fields), c.status, c.holdReason, b.loadedAt, b.loadedAt).run();
  }
  for (const statement of holdBlockedSql(b.id)) await db.prepare(statement.replace(/;\s*$/, "")).bind().run();
  const counts = await db.prepare(`SELECT "rows","ready","held" FROM "OutreachBatch" WHERE "id" = ?`).bind(b.id).first<{ rows: number; ready: number; held: number }>();
  return { rows: counts?.rows ?? 0, ready: counts?.ready ?? 0, held: counts?.held ?? 0, skipped: plan.contacts.length - (counts?.rows ?? 0) };
}

export { wordsVersion };
