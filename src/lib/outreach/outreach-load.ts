/**
 * Loading a list from the Campaigns screen (Riley's brief, Nov 5: "either founder (or their Claude) can load a
 * list and approve it from the engine's screen, without Riley's PC"). The same checks as `scripts/outreach.ts`:
 * the CSV is planned against the campaign's words and rules, every email domain is looked up for a mail
 * server, and the do-not-email list is read. "Check" writes nothing and shows the counts, the held rows and
 * three samples; "Load" saves the batch, waiting for the campaign's approver.
 *
 * New words can come with the list. Saving them changes the campaign's words, which locks every approved
 * batch until its approver approves it again (the approval is for the words as they were).
 */
import { addressBlocked } from "@/lib/outreach/outreach-blocked";
import { parseCsv, type CsvTable } from "@/lib/outreach/outreach-csv";
import { EMAIL_PATTERN, importToDb, planImport } from "@/lib/outreach/outreach-import";
import { SCREEN_DOMAIN_LIMIT, checkMailServers, emailDomain, type MailServerCheck } from "@/lib/outreach/outreach-mail-servers";
import { readCampaign, readInboxes, type Campaign } from "@/lib/outreach/outreach-model";
import { parseStepText, renderEmail, wordsProblems, wordsVersion, type CampaignWords, type Sender } from "@/lib/outreach/outreach-words";
import type { ProspectDb } from "@/lib/revenue-engine/engine-prospects-d1";

/** Bigger lists load from a PC with scripts/outreach.ts. */
export const SCREEN_MAX_ROWS = 300;
export const SCREEN_MAX_CSV_CHARS = 1_000_000;

export type LoadInput = { campaign: string; name: string; csv: string; first?: string; followUp?: string; save: boolean };
export type LoadContext = {
  loadedBy: string; now: Date; newId: () => string; mailingAddress: string | null | undefined;
  checkMail?: (domains: string[]) => Promise<MailServerCheck>;
};
export type LoadSample = { row: number; to: string; from: string; subject: string; text: string; followUp: { subject: string; text: string } | null };
export type LoadResult =
  | { ok: false; error: string }
  | {
    ok: true; saved: boolean; batchId: string | null; rows: number; ready: number; held: number; skipped: number;
    holds: Array<{ row: number; email: string; reason: string }>; samples: LoadSample[]; wordsChanged: boolean; wordsVersion: string; domains: number;
  };

const wordsFrom = (campaign: Campaign, input: LoadInput): { words: CampaignWords } | { error: string } => {
  const first = input.first?.trim() ? input.first : null;
  const follow = input.followUp?.trim() ? input.followUp : null;
  if (!first && !follow) {
    if (!campaign.words.steps.length) return { error: "This campaign has no words yet: paste the first email and the follow-up." };
    return { words: campaign.words };
  }
  if (!first) return { error: "Paste the first email's words too (they start with a line like \"Subject: ...\")." };
  if (!follow && campaign.followUps > 0) return { error: "Paste the follow-up's words too: this campaign sends one." };
  try {
    return { words: { steps: [parseStepText(first, 1), ...(follow ? [parseStepText(follow, 2)] : [])] } };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "The words can't be read." };
  }
};

/** Checks a list (and any new words) for a campaign, and saves it as a waiting batch when `save` is set. */
export async function loadList(db: ProspectDb, input: LoadInput, context: LoadContext): Promise<LoadResult> {
  const campaign = await readCampaign(db, input.campaign);
  if (!campaign) return { ok: false, error: "That campaign doesn't exist." };
  if (campaign.problem) return { ok: false, error: `The campaign's settings can't be used: ${campaign.problem}.` };
  const name = input.name.replace(/[\r\n]+/g, " ").trim();
  if (!name) return { ok: false, error: "Give the batch a name, like \"Cities batch 2\"." };
  if (input.csv.length > SCREEN_MAX_CSV_CHARS) return { ok: false, error: "That file is too big for the screen. Load it from a PC with scripts/outreach.ts." };

  const chosen = wordsFrom(campaign, input);
  if ("error" in chosen) return { ok: false, error: chosen.error };
  const version = wordsVersion(chosen.words);
  const wordsChanged = version !== campaign.wordsVersion;
  const withWords: Campaign = { ...campaign, words: chosen.words, wordsVersion: version };

  let table: CsvTable;
  try { table = parseCsv(input.csv); } catch (error) { return { ok: false, error: error instanceof Error ? error.message : "The CSV can't be read." }; }
  if (table.rows.length > SCREEN_MAX_ROWS) return { ok: false, error: `The screen loads up to ${SCREEN_MAX_ROWS} rows at a time; this list has ${table.rows.length}. Split it into batches.` };
  const problems = table.columns.length ? wordsProblems(chosen.words, table.columns, campaign.rules) : [];
  if (problems.length) return { ok: false, error: problems.join(" ") };

  const domains = [...new Set(table.rows.map((row) => (row.email ?? "").trim().toLowerCase()).filter((email) => EMAIL_PATTERN.test(email)).map(emailDomain))];
  if (domains.length > SCREEN_DOMAIN_LIMIT) {
    return { ok: false, error: `This list has ${domains.length} different email domains; the screen checks up to ${SCREEN_DOMAIN_LIMIT} at a time. Split it into smaller batches.` };
  }
  const mail = await (context.checkMail ?? ((list: string[]) => checkMailServers(list)))(domains);
  if (mail.unreadable.length) return { ok: false, error: `Couldn't look up the mail servers of ${mail.unreadable.join(", ")}. Nothing was loaded; try again in a minute.` };

  const inboxes = await readInboxes(db);
  const firstInbox = campaign.inboxes[0]?.address ?? "";
  const sender: Sender = { name: inboxes.find((inbox) => inbox.address === firstInbox)?.name ?? "Axiom", address: firstInbox };
  const plan = planImport(withWords, table, {
    batchId: `b-${context.newId()}`, name, source: "Loaded on the Campaigns screen", loadedBy: context.loadedBy, now: context.now, newId: context.newId,
    sender, mailingAddress: context.mailingAddress || "(the mailing address)", noMailServer: mail.noMailServer,
  });
  if (plan.errors.length) return { ok: false, error: plan.errors.join(" ") };

  // The do-not-email list is read now for the counts; loading holds the same rows again on the live data.
  const contacts = await Promise.all(plan.contacts.map(async (contact) => contact.status === "ready" && await addressBlocked(db, contact.email)
    ? { ...contact, status: "held" as const, holdReason: "On the do-not-email list (bounced, said no thanks or asked not to be contacted)" } : contact));
  const ready = contacts.filter((contact) => contact.status === "ready");
  const samples = ready.slice(0, 3).flatMap((contact): LoadSample[] => {
    const one = renderEmail(chosen.words, 1, contact.fields, sender, context.mailingAddress || "(the mailing address)", { noLinksInFirst: campaign.rules.noLinksInFirst });
    if (!one.ok) return [];
    const two = chosen.words.steps.length > 1 && campaign.followUps > 0
      ? renderEmail(chosen.words, 2, contact.fields, sender, context.mailingAddress || "(the mailing address)", { firstSubject: one.email.subject }) : null;
    return [{ row: contact.rowNumber, to: contact.email, from: `${sender.name} <${sender.address}>`, subject: one.email.subject, text: one.email.text, followUp: two?.ok ? two.email : null }];
  });
  const holds = contacts.filter((contact) => contact.status === "held")
    .map((contact) => ({ row: contact.rowNumber, email: (contact.fields.email ?? "").slice(0, 120), reason: contact.holdReason ?? "Held" }));
  const summary = { holds: holds.slice(0, 200), samples, wordsChanged, wordsVersion: version, domains: domains.length };

  if (!input.save) {
    return { ok: true, saved: false, batchId: null, rows: contacts.length, ready: ready.length, held: holds.length, skipped: 0, ...summary };
  }
  if (wordsChanged) {
    await db.prepare(`UPDATE "OutreachCampaign" SET "wordsJson" = ?, "wordsVersion" = ?, "updatedAt" = ? WHERE "key" = ?`)
      .bind(JSON.stringify(chosen.words), version, context.now.toISOString(), campaign.key).run();
  }
  const saved = await importToDb(db, plan);
  return { ok: true, saved: true, batchId: plan.batch.id, rows: saved.rows, ready: saved.ready, held: saved.held, skipped: saved.skipped, ...summary };
}
