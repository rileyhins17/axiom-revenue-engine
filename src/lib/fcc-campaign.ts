/**
 * FCC "March 1 pack" campaign.
 *
 * A separate, fixed-copy campaign for small US voice providers whose FCC
 * Robocall Mitigation Database (RMD) filing shows no 2026 recertification.
 *
 * Deliberately isolated from the website-lead engine:
 * - contacts live in their own table (FccCampaignContact), never in Lead, so the
 *   autonomous website scheduler can never pick them up or send them the
 *   website pitch;
 * - copy is fixed (Aidan's "v2" email, Notion Oct 28; the first 60 used his
 *   "calmer email v3", Notion Oct 25), not AI-generated;
 * - live sending is hard-blocked until a CASL/CAN-SPAM mailing address is
 *   configured AND the campaign is explicitly enabled. Test sends only ever go
 *   to the sender's own mailbox.
 *
 * Contact data is public FCC filing data but is still never committed to this
 * (public) repo: imports read a local CSV path.
 */
import { isGenericRoleEmail } from "@/lib/contact-validation";

export const FCC_CAMPAIGN_KEY = "fcc-march1-pack-v3-calmer";
export const FCC_CAMPAIGN_NAME = "FCC March 1 pack";
export const FCC_DAILY_SEND_CAP = 30;
export const FCC_FOLLOW_UP_DELAY_DAYS = 3;
export const FCC_MAX_FOLLOW_UPS = 1;
/**
 * The copy a founder's go must name (FccCampaignSetting.approvedCopy). Aidan's "v2" email (Notion
 * task, Oct 28) replaced the calmer v3 for every first email from Oct 29. Contacts keep the v3 list
 * key; which copy a person got is in their first email's Message-ID ("<fcc-v4-..." for this one).
 */
export const FCC_COPY_VERSION = "fcc-march1-pack-v4-question";

export type FccFilingRow = {
  business_name: string;
  contact_name: string;
  title: string;
  email: string;
  phone: string;
  state: string;
  rmd_number: string;
  last_filing_date: string;
  recertified_on_page: string;
  filing_url: string;
};

/** named = mailbox of the named person; compliance = a dedicated RMD/FCC/
 *  compliance inbox (good target); generic = support/noc/info style inbox. */
export type FccEmailKind = "named" | "compliance" | "generic" | "unclear";

export type FccCampaignContact = {
  email: string;
  firstName: string;
  contactName: string;
  title: string;
  phone: string;
  /** Company used in the email body. */
  company: string;
  /** Every filing this mailbox handles (one person can own several). */
  filings: Array<{ company: string; rmdNumber: string; state: string; lastFilingDate: string; filingUrl: string }>;
  emailKind: FccEmailKind;
  /** Included in the default send list. Generic inboxes are held for review. */
  sendable: boolean;
  holdReason: string | null;
};

const COMPLIANCE_HINTS = ["rmd", "fcc", "compliance", "regulatory", "stirshaken", "traceback"];
const FCC_GENERIC_LOCALS = new Set([
  "support", "noc", "info", "hi", "hello", "work", "manager", "office", "admin", "voiceops",
  "infrastructure", "contact", "sales", "help", "toll.fraud",
]);

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field);
      field = "";
      if (row.some((cell) => cell.trim() !== "")) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((cell) => cell.trim() !== "")) rows.push(row);
  return rows;
}

export function parseFccFilingCsv(text: string): FccFilingRow[] {
  const [header, ...body] = parseCsv(text.replace(/^﻿/, ""));
  if (!header) return [];
  const keys = header.map((h) => h.trim());
  const required = ["business_name", "contact_name", "email", "rmd_number"];
  for (const key of required) {
    if (!keys.includes(key)) throw new Error(`FCC CSV is missing the "${key}" column`);
  }
  return body.map((cells) => {
    const record: Record<string, string> = {};
    keys.forEach((key, index) => {
      record[key] = (cells[index] ?? "").trim();
    });
    return record as FccFilingRow;
  });
}

function titleCase(word: string) {
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

/** First name for the greeting, or "there" when the contact is a team/role. */
export function deriveFirstName(contactName: string): string {
  const cleaned = contactName.replace(/[^A-Za-z\s'.-]/g, " ").trim();
  const first = cleaned.split(/\s+/)[0] || "";
  const roleWords = new Set(["support", "momentum", "noc", "toc", "team", "admin", "office"]);
  if (!first || first.length < 2 || roleWords.has(first.toLowerCase())) return "there";
  return titleCase(first);
}

export function classifyFccEmail(email: string, contactName: string): FccEmailKind {
  const local = (email.split("@")[0] || "").toLowerCase();
  if (COMPLIANCE_HINTS.some((hint) => local.includes(hint))) return "compliance";
  if (FCC_GENERIC_LOCALS.has(local) || isGenericRoleEmail(email)) return "generic";
  const nameTokens = contactName
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((token) => token.length >= 2);
  if (nameTokens.some((token) => local.includes(token))) return "named";
  // Initial + surname style (e.g. m.apland, jdeaver, cjb1).
  if (nameTokens.length >= 2) {
    const [first, ...rest] = nameTokens;
    const last = rest[rest.length - 1];
    if (local.includes(`${first[0]}${last}`) || local.startsWith(first[0]) && local.includes(last.slice(0, 4))) {
      return "named";
    }
  }
  return "unclear";
}

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * Turn raw filing rows into one contact per mailbox.
 * Only rows the FCC page shows as not recertified are kept.
 */
export function buildFccCampaignContacts(rows: FccFilingRow[]): FccCampaignContact[] {
  const byEmail = new Map<string, FccCampaignContact>();
  for (const row of rows) {
    const email = row.email.trim().toLowerCase();
    if (!isValidEmail(email)) continue;
    if (String(row.recertified_on_page || "").toLowerCase() === "yes") continue;
    const filing = {
      company: row.business_name,
      rmdNumber: row.rmd_number,
      state: row.state,
      lastFilingDate: row.last_filing_date,
      filingUrl: row.filing_url,
    };
    const existing = byEmail.get(email);
    if (existing) {
      if (!existing.filings.some((f) => f.rmdNumber === filing.rmdNumber)) existing.filings.push(filing);
      continue;
    }
    const emailKind = classifyFccEmail(email, row.contact_name);
    const sendable = emailKind !== "generic";
    byEmail.set(email, {
      email,
      firstName: deriveFirstName(row.contact_name),
      contactName: row.contact_name,
      title: row.title,
      phone: row.phone,
      company: row.business_name,
      filings: [filing],
      emailKind,
      sendable,
      holdReason: sendable ? null : "Generic inbox (support@/noc@/info@ style). Check before sending.",
    });
  }
  return [...byEmail.values()];
}

export type FccCampaignConfig = {
  /** Postal address printed in every email (CASL / CAN-SPAM). */
  mailingAddress: string | null | undefined;
  /** Explicit go from both founders. Defaults off. */
  liveSendsEnabled: boolean;
};

export type FccSendGate = { allowed: true } | { allowed: false; reason: string };

export function checkFccLiveSendGate(config: FccCampaignConfig): FccSendGate {
  const address = String(config.mailingAddress || "").trim();
  if (address.length < 10) {
    return { allowed: false, reason: "No mailing address set. CASL and CAN-SPAM require one in every cold email." };
  }
  if (!config.liveSendsEnabled) {
    return { allowed: false, reason: "Live sends are off until a founder's go is recorded in FccCampaignSetting (scripts/fcc-campaign.ts go-sql)." };
  }
  return { allowed: true };
}

/** Test sends are always allowed, but only to the sending mailbox itself. */
export function checkFccTestRecipient(to: string, senderEmail: string): FccSendGate {
  if (to.trim().toLowerCase() !== senderEmail.trim().toLowerCase()) {
    return { allowed: false, reason: `Test emails can only go to the sending mailbox (${senderEmail}).` };
  }
  return { allowed: true };
}

export type RenderedFccEmail = { subject: string; bodyPlain: string; bodyHtml: string };

const ADDRESS_PLACEHOLDER = "[MAILING ADDRESS GOES HERE]";

/** "Example Co's filing doesn't" or, for one person on several filings,
 *  "the filings for Example Co and 2 related companies don't". */
function filingSubject(contact: Pick<FccCampaignContact, "company" | "filings">) {
  const others = contact.filings.length - 1;
  if (others <= 0) return `${contact.company}'s filing doesn't`;
  return `the filings for ${contact.company} and ${others} related compan${others === 1 ? "y" : "ies"} don't`;
}

function companyLabel(contact: Pick<FccCampaignContact, "company" | "filings">) {
  const others = contact.filings.length - 1;
  return others > 0 ? `${contact.company} and ${others} related compan${others === 1 ? "y" : "ies"}` : contact.company;
}

function toHtml(plain: string) {
  const escaped = plain.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return escaped
    .split(/\n{2,}/)
    .map((para) => `<p>${para.replace(/\n/g, "<br />")}</p>`)
    .join("\n");
}

/**
 * Aidan's "calmer email v3" (Notion Oct 25, approved on Slack Oct 26). It drops
 * v2's removal warning and "fastest way to get current" after a law firm warned
 * RMD filers about urgent "deficiency" cold emails. The signature names
 * axiominternational.ca, not the web-design site (Aidan, Slack Oct 26). Step 1
 * is the first touch, step 2 the single follow-up 3 days later in the same
 * thread. A missing address renders a visible placeholder so test emails can't
 * pass for send-ready copy.
 */
export function renderFccEmail(
  contact: Pick<FccCampaignContact, "firstName" | "company" | "filings">,
  step: 1 | 2,
  mailingAddress: string | null | undefined,
): RenderedFccEmail {
  const address = String(mailingAddress || "").trim() || ADDRESS_PLACEHOLDER;
  const company = companyLabel(contact);
  if (step === 1) {
    const bodyPlain = [
      `Hi ${contact.firstName},`,
      `I'm Aidan Magee from Axiom. In the FCC Robocall Mitigation Database, ${filingSubject(contact)} show a 2026 recertification date (it was due March 1, 2026). If that's wrong, please ignore this. The FCC says it can refer filers who don't recertify for enforcement, though we haven't seen it remove anyone for this alone.`,
      `If it's still to do, we can draft the answers for your officer to check and submit from your own FCC login, and walk you through the FCC's own steps, including what to do if the Recertify button doesn't show. It's a flat price for the preparation, and we never hold your login.`,
      `A one-line reply is plenty. We're not a law firm and this isn't legal advice.`,
      `Aidan Magee, Axiom · axiominternational.ca\n${address}\nReply "stop" and I won't email you again.`,
    ].join("\n\n");
    return { subject: "Your 2026 RMD recertification", bodyPlain, bodyHtml: toHtml(bodyPlain) };
  }
  const bodyPlain = [
    `Hi ${contact.firstName}, floating this back up. If the 2026 RMD recertification for ${company} is still to do, want us to draft it for your officer to check and submit? A yes or no is fine.`,
    `Aidan\n${address} · Reply "stop" and I won't email you again.`,
  ].join("\n\n");
  return { subject: "Re: Your 2026 RMD recertification", bodyPlain, bodyHtml: toHtml(bodyPlain) };
}

const SMALL_WORDS = new Set(["a", "an", "and", "at", "for", "in", "of", "on", "or", "the", "to"]);

/**
 * The name a person would say: "Talktone" for "Talktone, Inc.", "LFT Fiber" for "... dba LFT Fiber",
 * "Ponderosa Telephone" for "The Ponderosa Telephone Co.". Spelled-out words such as "Company" or
 * "Corporation" stay, because some names need them; an all-lowercase filing name gets capitals.
 */
export function companyShortName(company: string) {
  const full = company.trim();
  let name = full.match(/\b(?:dba|d\/b\/a)\b:?\s*(.+)$/i)?.[1]?.trim() || full;
  name = name.replace(/(?:,?\s+(?:inc|incorporated|llc|l\.l\.c|ltd|lp|l\.p|llp|pllc|corp|co)\.?)+$/i, "").replace(/^the\s+/i, "").trim();
  if (name && name === name.toLowerCase()) {
    name = name.split(" ").map((word, index) => index > 0 && SMALL_WORDS.has(word) ? word : word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
  }
  return name || full;
}

/** "Talktone's", "Crocker Communications'"; a name that already ends in 's stays as it is. */
export function companyPossessive(company: string) {
  const name = company.trim();
  if (/'s$/i.test(name)) return name;
  return /s$/i.test(name) ? `${name}'` : `${name}'s`;
}

/** Which copy a person's first email used, read from its Message-ID. */
export function fccCopyOfMessageId(messageId: string | null | undefined): "v3" | "v4" {
  return messageId?.startsWith("<fcc-v4-") ? "v4" : "v3";
}

/**
 * Aidan's "v2" email (Notion task, Oct 28): a short question that names the listing, states the
 * flat $450 and asks yes or no. Plain text, no links. Step 2 is the day-3 bump in the same thread.
 * Both end with the mailing address and an opt-out line, which US anti-spam law requires in every
 * email; Aidan's day-3 text had neither, and that footer is the only thing added to his words.
 */
export function renderFccEmailV4(
  contact: Pick<FccCampaignContact, "firstName" | "company" | "filings">,
  step: 1 | 2,
  mailingAddress: string | null | undefined,
): RenderedFccEmail {
  const address = String(mailingAddress || "").trim() || ADDRESS_PLACEHOLDER;
  const possessive = companyPossessive(companyShortName(contact.company));
  const rmd = contact.filings.find((filing) => filing?.rmdNumber?.trim())?.rmdNumber.trim();
  const listing = rmd ? `${possessive} listing (${rmd})` : `${possessive} listing`;
  const subject = `Question about ${possessive} RMD listing`;
  const footer = `Axiom · axiominternational.ca · ${address}\nNot useful? Reply "no thanks" and I won't follow up.`;
  if (step === 1) {
    const bodyPlain = [
      `Hi ${contact.firstName},`,
      `I was going through the FCC's Robocall Mitigation Database and noticed ${listing} doesn't show a 2026 recertification yet. It was due March 1, and you're not alone: about 3,600 providers show the same thing.`,
      `Is it already handled? If so, no need to reply.`,
      `If not, I can send you a short list of what looks out of date on the listing, free. If you'd like help after that, I prepare the updates and a fresh mitigation plan, and your officer files it from your own login in about 15 minutes. It's a flat $450, and we never hold your login.`,
      `Want me to send the list?`,
      `Aidan Magee\n${footer}`,
    ].join("\n\n");
    return { subject, bodyPlain, bodyHtml: toHtml(bodyPlain) };
  }
  const bodyPlain = [
    `Hi ${contact.firstName},`,
    `Bumping this in case it got buried. ${listing} still shows no 2026 recertification. Want the free list? A one-word reply is fine.`,
    `Aidan\n${footer}`,
  ].join("\n\n");
  return { subject: `Re: ${subject}`, bodyPlain, bodyHtml: toHtml(bodyPlain) };
}

/**
 * Plan first touches at FCC_DAILY_SEND_CAP per day starting on `startDate`,
 * each with one follow-up FCC_FOLLOW_UP_DELAY_DAYS later. Follow-ups count
 * toward the same daily cap, so first touches are pushed back to make room.
 */
export function planFccSendSchedule(contacts: FccCampaignContact[], startDate: Date) {
  const day = (offset: number) => {
    const d = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), startDate.getUTCDate()));
    d.setUTCDate(d.getUTCDate() + offset);
    return d.toISOString().slice(0, 10);
  };
  const load = new Map<number, number>();
  const used = (offset: number) => load.get(offset) ?? 0;
  const plan: Array<{ email: string; step: 1 | 2; date: string }> = [];
  let offset = 0;
  for (const contact of contacts.filter((c) => c.sendable)) {
    while (used(offset) >= FCC_DAILY_SEND_CAP || used(offset + FCC_FOLLOW_UP_DELAY_DAYS) >= FCC_DAILY_SEND_CAP) {
      offset += 1;
    }
    load.set(offset, used(offset) + 1);
    load.set(offset + FCC_FOLLOW_UP_DELAY_DAYS, used(offset + FCC_FOLLOW_UP_DELAY_DAYS) + 1);
    plan.push({ email: contact.email, step: 1, date: day(offset) });
    plan.push({ email: contact.email, step: 2, date: day(offset + FCC_FOLLOW_UP_DELAY_DAYS) });
  }
  return plan.sort((a, b) => a.date.localeCompare(b.date) || a.step - b.step);
}
