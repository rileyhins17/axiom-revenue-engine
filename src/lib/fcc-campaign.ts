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
/** The one-off November 6 hot list (fcc_hot_list_nov6.csv). Its own key, so it never mixes with the March pack. */
export const FCC_NOV6_CAMPAIGN_KEY = "fcc-nov6-hot";
/** The last Toronto day the hot-list email can go. Its reply promises a pack within one business day of a November 6 deadline. */
export const FCC_NOV6_LAST_SEND_DAY = "2026-11-05";
export const FCC_DAILY_SEND_CAP = 30;
export const FCC_FOLLOW_UP_DELAY_DAYS = 3;
/** The day-3 follow-up and the day-7 one. Nothing comes after the day-7 email (Aidan, Nov 1: no day-14 email). */
export const FCC_MAX_FOLLOW_UPS = 2;
/** The day-7 follow-up goes this many days after the first email... */
export const FCC_DAY7_AFTER_FIRST_DAYS = 7;
/** ...and at least this many after the day-3 one, which runs late when the inbox is busy (the Nov 6 list went first Nov 2–5). */
export const FCC_DAY7_AFTER_FOLLOW_UP_DAYS = 4;
/**
 * The copy a founder's go must name (FccCampaignSetting.approvedCopy). Aidan's "v2" email (Notion
 * task, Oct 28) replaced the calmer v3 for every first email from Oct 29; v5 (Nov 1) keeps its words
 * and adds the founders' signature with the site link and logo; v6 added the one-off November 6
 * email; v7 adds the day-7 follow-up (Aidan's text, approved Oct 29) and a test of two subjects on
 * new first emails. Contacts keep the v3 list key; which copy a person got is in their first
 * email's Message-ID ("<fcc-v7a-..." or "<fcc-v7b-..." from v7).
 */
export const FCC_COPY_VERSION = "fcc-march1-pack-v7-day7";

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
  filings: Array<{
    company: string; rmdNumber: string; state: string; lastFilingDate: string; filingUrl: string;
    /** November 6 hot list only: the per-contact sentence and the short company name. */
    listingLine?: string; companyShort?: string;
  }>;
  emailKind: FccEmailKind;
  /** Included in the default send list. Generic inboxes are held for review. */
  sendable: boolean;
  holdReason: string | null;
};

const GENERIC_HOLD_REASON = "Generic inbox (support@/noc@/info@ style). Check before sending.";
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
      holdReason: sendable ? null : GENERIC_HOLD_REASON,
    });
  }
  return [...byEmail.values()];
}

const NOV6_REQUIRED_COLUMNS = ["email", "first_name_display", "company_display", "company_short", "rmd_number", "listing_line", "email_type"];

/**
 * The November 6 hot list (fcc_hot_list_nov6.csv): one contact per mailbox, in file order. The
 * per-contact sentence and short name are kept in the first filing's entry in filingsJson, so no
 * migration is needed. A generic inbox is held when either classifyFccEmail or the file's
 * email_type says so.
 */
export function buildFccNov6Contacts(csvText: string): FccCampaignContact[] {
  const [header, ...body] = parseCsv(csvText.replace(/^﻿/, ""));
  if (!header) return [];
  const keys = header.map((h) => h.trim());
  for (const key of NOV6_REQUIRED_COLUMNS) {
    if (!keys.includes(key)) throw new Error(`Nov 6 CSV is missing the "${key}" column`);
  }
  const seen = new Set<string>();
  const contacts: FccCampaignContact[] = [];
  body.forEach((cells, index) => {
    const record: Record<string, string> = {};
    keys.forEach((key, i) => {
      record[key] = (cells[i] ?? "").trim();
    });
    const rank = record.rank || String(index + 1);
    const email = record.email.toLowerCase();
    if (!isValidEmail(email)) throw new Error(`Nov 6 CSV rank ${rank} has no valid email`);
    if (!record.first_name_display || !record.company_short || !record.listing_line) {
      throw new Error(`Nov 6 CSV rank ${rank} is missing first_name_display, company_short or listing_line`);
    }
    if (seen.has(email)) return;
    seen.add(email);
    const kind = classifyFccEmail(email, record.first_name_display);
    const emailKind: FccEmailKind = kind === "generic" || record.email_type === "generic" ? "generic" : kind;
    const sendable = emailKind !== "generic";
    contacts.push({
      email,
      firstName: record.first_name_display,
      contactName: record.first_name_display,
      title: record.title,
      phone: "",
      company: record.company_display,
      filings: [{
        company: record.company_display,
        rmdNumber: record.rmd_number,
        state: "",
        lastFilingDate: record.signed,
        filingUrl: record.filing_url,
        listingLine: record.listing_line,
        companyShort: record.company_short,
      }],
      emailKind,
      sendable,
      holdReason: sendable ? null : GENERIC_HOLD_REASON,
    });
  });
  return contacts;
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
/** First name for a short sign-off ("Aidan" from "Aidan Magee"). */
const firstNameOf = (name: string) => name.trim().split(/\s+/)[0] || name.trim();

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

/**
 * The one-off November 6 email (NOV-6-EMAIL.md, Aidan's wording, word for word), signed with the founders'
 * signature. It is a first email only: no follow-up is scheduled. `listing_line` and `company_short`
 * come from the contact's first filing.
 */
export function renderFccEmailNov6(
  contact: Pick<FccCampaignContact, "firstName" | "filings">,
  mailingAddress: string | null | undefined,
  signer: FccSigner = { name: "Aidan Magee" },
): RenderedFccEmail {
  const filing = contact.filings[0];
  const listingLine = filing?.listingLine?.trim();
  const companyShort = filing?.companyShort?.trim();
  if (!listingLine || !companyShort) throw new Error("Nov 6 contact is missing its listing line or short company name");
  const paragraphs = [
    `Hi ${contact.firstName},`,
    `A quick heads-up in case this got buried. A telecom law firm, The CommLaw Group, reports the FCC is emailing notices to providers that missed the March 1 RMD recertification, giving them another chance. At least one notice sets a November 6 deadline. Dates may differ and they're easy to miss, so it's worth checking spam and whoever is listed as your RMD contact.`,
    listingLine,
    `If you want it off your plate, I can have the updated answers and a fresh mitigation plan ready within one business day. Your officer reviews them and files from your own login. It's a flat $450, half up front, and we never hold your login.`,
    `Want me to start? A one-word reply is fine.`,
    `We're not a law firm and this isn't legal advice.`,
  ];
  const signature = fccSignature(signer, mailingAddress);
  const body = paragraphs.map((text) => `<p style="margin:0 0 14px">${escapeHtml(text)}</p>`).join("\n");
  return {
    subject: `Did ${companyShort} get the FCC's RMD notice?`,
    bodyPlain: [...paragraphs, signature.plain].join("\n\n"),
    bodyHtml: `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#1f1f1f">\n${body}\n${signature.html}\n</div>`,
  };
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

/**
 * Each copy's mark in its Message-ID ("<fcc-v5-<contact>-1@..."); a first email without one is the calmer v3.
 * v7a and v7b are the subject test: the same email as v5, under the question subject (v7a) or
 * "<company>'s FCC listing" (v7b). nov6 is the one-off November 6 email.
 */
const COPY_MARKS = ["v4", "v5", "v7a", "v7b", "nov6"] as const;
export type FccCopy = "v3" | (typeof COPY_MARKS)[number];

/** Which copy a person's first email used, read from its Message-ID. */
export function fccCopyOfMessageId(messageId: string | null | undefined): FccCopy {
  return COPY_MARKS.find((mark) => messageId?.startsWith(`<fcc-${mark}-`)) ?? "v3";
}

/** fccCopyOfMessageId in SQL, over a column holding a first email's Message-ID. */
export function fccCopySql(column: string) {
  return `CASE ${COPY_MARKS.map((mark) => `WHEN ${column} LIKE '<fcc-${mark}-%' THEN '${mark}'`).join(" ")} ELSE 'v3' END`;
}

/**
 * The subject test on new first emails, from both inboxes: half keep the question subject (v7a),
 * half get "<company>'s FCC listing" (v7b). Fixed by contact id, so a person keeps their subject
 * however many times they are looked at, and their follow-ups reply under it.
 */
export function fccSubjectTestCopy(contactId: string): "v7a" | "v7b" {
  let hash = 2166136261;
  for (const char of contactId) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  // Murmur3's finisher spreads every character over every bit before one bit picks the subject.
  hash = Math.imul(hash ^ (hash >>> 16), 0x85ebca6b);
  hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35);
  return ((hash ^ (hash >>> 16)) & 1) === 0 ? "v7a" : "v7b";
}

/** "Talktone's listing (RMD0001234)", or without the number when the filing has none. */
function listingName(contact: Pick<FccCampaignContact, "company" | "filings">) {
  const possessive = companyPossessive(companyShortName(contact.company));
  const rmd = contact.filings.find((filing) => filing?.rmdNumber?.trim())?.rmdNumber.trim();
  return rmd ? `${possessive} listing (${rmd})` : `${possessive} listing`;
}

/** The subject of a person's first email, which every follow-up answers with "Re: ". */
export function fccFirstEmailSubject(contact: Pick<FccCampaignContact, "company">, copy: FccCopy) {
  const possessive = companyPossessive(companyShortName(contact.company));
  if (copy === "v3") return "Your 2026 RMD recertification";
  if (copy === "nov6") throw new Error("The November 6 email has no follow-up");
  return copy === "v7b" ? `${possessive} FCC listing` : `Question about ${possessive} RMD listing`;
}

/** The words of Aidan's "v2" question email (both steps), without any sign-off. */
function questionEmail(contact: Pick<FccCampaignContact, "firstName" | "company" | "filings">, step: 1 | 2, copy: FccCopy = "v5") {
  const listing = listingName(contact);
  const subject = fccFirstEmailSubject(contact, copy);
  if (step === 1) {
    return { subject, paragraphs: [
      `Hi ${contact.firstName},`,
      `I was going through the FCC's Robocall Mitigation Database and noticed ${listing} doesn't show a 2026 recertification yet. It was due March 1, and you're not alone: about 3,600 providers show the same thing.`,
      `Is it already handled? If so, no need to reply.`,
      `If not, I can send you a short list of what looks out of date on the listing, free. If you'd like help after that, I prepare the updates and a fresh mitigation plan, and your officer files it from your own login in about 15 minutes. It's a flat $450, and we never hold your login.`,
      `Want me to send the list?`,
    ] };
  }
  return { subject: `Re: ${subject}`, paragraphs: [
    `Hi ${contact.firstName},`,
    `Bumping this in case it got buried. ${listing} still shows no 2026 recertification. Want the free list? A one-word reply is fine.`,
  ] };
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
  signer = "Aidan Magee",
): RenderedFccEmail {
  const address = String(mailingAddress || "").trim() || ADDRESS_PLACEHOLDER;
  const footer = `Axiom · axiominternational.ca · ${address}\nNot useful? Reply "no thanks" and I won't follow up.`;
  const { subject, paragraphs } = questionEmail(contact, step);
  const bodyPlain = [...paragraphs, `${step === 1 ? signer : firstNameOf(signer)}\n${footer}`].join("\n\n");
  return { subject, bodyPlain, bodyHtml: toHtml(bodyPlain) };
}

/** Who signs an email. Title and phone come from the founders' signature settings; both are optional. */
export type FccSigner = { name: string; title?: string | null; phone?: string | null };
/** The signature's link shows the plain domain and opens the FCC filings page (Riley, Nov 1). */
export const FCC_SITE_LABEL = "axiominternational.ca";
export const FCC_SITE_URL = "https://axiominternational.ca/fcc-filings/";
export const FCC_LOGO_URL = "https://axiominternational.ca/brand/axiom-lockup-400.png";
const FCC_OPT_OUT = `Not useful? Reply "no thanks" and I won't follow up.`;

const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** "257 Kipling Ave, Kitchener, ON N2C 2B9, Canada" becomes "257 Kipling Ave," over "Kitchener, ON N2C 2B9, Canada". */
function addressLines(address: string) {
  const comma = address.indexOf(",");
  return comma < 0 ? [address] : [address.slice(0, comma + 1), address.slice(comma + 1).trim()];
}

/**
 * The founders' signature (Riley, Nov 1, after his manager's): name, title, mailing address, cell,
 * the site link and the logo, then the opt-out line US law requires. Gmail shows the HTML; the
 * plain-text copy is for mail apps that can't, so its link spells out the page.
 */
export function fccSignature(signer: FccSigner, mailingAddress: string | null | undefined) {
  const address = String(mailingAddress || "").trim() || ADDRESS_PLACEHOLDER;
  const title = signer.title?.trim() || "Co-founder";
  const phone = signer.phone?.trim();
  const plain = [signer.name, title, ...addressLines(address), ...(phone ? [`C: ${phone}`] : []), FCC_SITE_URL.replace(/^https:\/\/|\/$/g, "")].join("\n")
    + `\n\n${FCC_OPT_OUT}`;
  const line = (text: string, style = "") => `<div${style ? ` style="${style}"` : ""}>${escapeHtml(text)}</div>`;
  const html = [
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:18px;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.45;color:#1f1f1f"><tr><td>`,
    line(signer.name, "font-size:15px;font-weight:bold"),
    line(title, "font-weight:bold;margin-bottom:2px"),
    ...addressLines(address).map((text) => line(text)),
    `<div style="height:8px;line-height:8px">&nbsp;</div>`,
    ...(phone ? [line(`C: ${phone}`)] : []),
    `<div><a href="${FCC_SITE_URL}" style="color:#1a56c4">${FCC_SITE_LABEL}</a></div>`,
    // The site's logo is white (made for its dark pages), so it sits on a dark tile to show on white email.
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:10px"><tr><td style="background:#101318;padding:9px 12px;border-radius:4px">`
      + `<a href="${FCC_SITE_URL}"><img src="${FCC_LOGO_URL}" alt="Axiom International" width="140" height="45" style="display:block;border:0;width:140px;height:45px"></a>`
      + `</td></tr></table>`,
    `</td></tr></table>`,
    `<p style="margin:14px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#777777">${escapeHtml(FCC_OPT_OUT)}</p>`,
  ].join("\n");
  return { plain, html };
}

/**
 * Aidan's question email with the founders' new signature (v5, Nov 1). Same words as v4; the
 * HTML copy adds the signature's link and logo. Follow-ups to v4 first emails use it too.
 * `copy` only picks the subject: v7b, half of the subject test, names the listing instead.
 */
export function renderFccEmailV5(
  contact: Pick<FccCampaignContact, "firstName" | "company" | "filings">,
  step: 1 | 2,
  mailingAddress: string | null | undefined,
  signer: FccSigner = { name: "Aidan Magee" },
  copy: Exclude<FccCopy, "v3" | "nov6"> = "v5",
): RenderedFccEmail {
  const { subject, paragraphs } = questionEmail(contact, step, copy);
  const signature = fccSignature(signer, mailingAddress);
  const body = paragraphs.map((text) => `<p style="margin:0 0 14px">${escapeHtml(text)}</p>`).join("\n");
  return {
    subject,
    bodyPlain: [...paragraphs, signature.plain].join("\n\n"),
    bodyHtml: `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#1f1f1f">\n${body}\n${signature.html}\n</div>`,
  };
}

/**
 * The day-7 follow-up, the third and last email (Aidan's text, approved Oct 29, word for word; on
 * Nov 1 he kept "I'll close this out after this one" and chose no day-14 email). It answers the
 * first email in its thread, whichever copy that was, with the first email's merge fields. The
 * signer is the founder whose inbox sent the first email; the address is the campaign's mailing
 * address (FCC_CAMPAIGN_MAILING_ADDRESS), never written into code.
 */
export function renderFccEmailDay7(
  contact: Pick<FccCampaignContact, "firstName" | "company" | "filings">,
  copy: FccCopy,
  mailingAddress: string | null | undefined,
  signerName = "Aidan Magee",
): RenderedFccEmail {
  const address = String(mailingAddress || "").trim() || ADDRESS_PLACEHOLDER;
  const paragraphs = [
    `Hi ${contact.firstName},`,
    `I'll close this out after this one. For context on why I reached out: in September the FCC removed 14 providers from the Robocall Mitigation Database because their listings were missing required information, and other carriers had two business days to stop taking their calls. Fixing a listing is usually quick once the information is ready, and that's the part I help with.`,
    `${listingName(contact)} still shows no 2026 recertification. If you'd like the free list of what looks out of date, just reply and I'll send it the same day.`,
  ];
  const footer = [signerName.trim() || "Aidan Magee", `Axiom · axiominternational.ca · ${address}`, `Not useful? Reply "no thanks" and I won't contact you again.`];
  const html = [...paragraphs.map((text) => `<p style="margin:0 0 14px">${escapeHtml(text)}</p>`), `<p style="margin:0 0 14px">${footer.map(escapeHtml).join("<br>\n")}</p>`];
  return {
    subject: `Re: ${fccFirstEmailSubject(contact, copy)}`,
    bodyPlain: [...paragraphs, footer.join("\n")].join("\n\n"),
    bodyHtml: `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#1f1f1f">\n${html.join("\n")}\n</div>`,
  };
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
