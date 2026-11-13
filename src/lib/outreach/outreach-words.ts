/**
 * A campaign's email words: plain text with {column} blanks filled from each contact's CSV row.
 *
 * - The first email's words start with a "Subject: ..." line. Every later email is a follow-up in the
 *   same thread: its subject is "Re: " and the first email's subject, so it never needs its own.
 * - {sender_name} and {sender_first_name} are the sending inbox's name ("Aidan Magee", "Aidan").
 * - The engine adds the footer itself (mailing address and the "no thanks" line, which US and Canadian
 *   anti-spam law need in every email), so the words leave it out. An inbox whose founder chose the full
 *   signature (Riley, Nov 13) gets it instead: name, title, address, cell, site link and logo, then the
 *   same "no thanks" line. A no-links campaign's first email leaves out the link and the logo.
 * - A blank the words use that is empty in a row holds that row: no email ever goes with a hole in it.
 * - With noLinksInFirst, a first email with a link or a web address anywhere in it is held.
 */
import { normaliseColumn } from "@/lib/outreach/outreach-csv";

export type StepWords = { subject?: string; body: string };
export type CampaignWords = { steps: StepWords[] };
/** A founder's signature details (title, cell), from the signature settings the FCC emails used. */
export type SenderSignature = { title?: string | null; phone?: string | null };
/** With `signature`, the email ends with the founder's full signature instead of the plain footer. */
export type Sender = { name: string; address: string; signature?: SenderSignature | null };
export type RenderedEmail = { subject: string; text: string; html?: string };
export type RenderResult = { ok: true; email: RenderedEmail } | { ok: false; reason: string };

export const SENDER_BLANKS = ["sender_name", "sender_first_name"] as const;
const BLANK = /\{\s*([A-Za-z][A-Za-z0-9 _-]*)\s*\}/g;

/** Words a person types: "Subject: ..." on the first non-empty line (first email only), then the body. */
export function parseStepText(text: string, step: number): StepWords {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  while (lines.length && !lines[0]!.trim()) lines.shift();
  const subjectLine = /^subject\s*:\s*(.*)$/i.exec(lines[0] ?? "");
  if (subjectLine) lines.shift();
  if (step === 1 && !subjectLine?.[1]?.trim()) throw new Error("The first email's words must start with a line like \"Subject: ...\".");
  const body = lines.join("\n").replace(/[ \t]+$/gm, "").replace(/^\n+/, "").replace(/\n+$/, "");
  if (!body.trim()) throw new Error(`Email ${step} has no words.`);
  return step === 1 ? { subject: subjectLine![1]!.trim(), body } : { body };
}

/** The normalised blanks a piece of text uses. */
export function blanksIn(text: string) {
  return [...new Set([...text.matchAll(BLANK)].map((match) => normaliseColumn(match[1]!)))];
}

/** Every blank any email uses (subjects included), without the sender's own. */
export function fieldsUsed(words: CampaignWords) {
  const used = new Set<string>();
  for (const step of words.steps) for (const blank of blanksIn(`${step.subject ?? ""}\n${step.body}`)) used.add(blank);
  for (const blank of SENDER_BLANKS) used.delete(blank);
  return [...used];
}

/** Short fingerprint of the words. An approval is for one fingerprint; changed words need a new one. */
export function wordsVersion(words: CampaignWords) {
  let hash = 2166136261;
  for (const char of JSON.stringify(words.steps.map((step) => [step.subject ?? "", step.body]))) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  return `w${hash.toString(16).padStart(8, "0")}`;
}

/**
 * A link or anything a mail app would turn into one: http(s), www., an email address, or a bare
 * domain like springfield.gov. Returns what it found, or null.
 */
export function findLink(text: string): string | null {
  const patterns = [
    /\bhttps?:\/\/\S+/i,
    /\bwww\.[a-z0-9-]+/i,
    /[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+/i,
    /\b[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.(?:com|org|net|gov|us|edu|io|co|ca|info|biz|me|app|dev|ly|site|online|city|town|county|mil|int|tv|ai|uk)\b/i,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match) return match[0];
  }
  return null;
}

/** Problems with the words themselves (not with any one row). Empty when they can be used. */
export function wordsProblems(words: CampaignWords, columns: string[], options: { noLinksInFirst?: boolean } = {}) {
  const problems: string[] = [];
  const [first] = words.steps;
  if (!first) return ["There are no email words yet."];
  if (!first.subject?.trim()) problems.push("The first email has no subject.");
  const known = new Set([...columns, ...SENDER_BLANKS]);
  for (const blank of fieldsUsed(words)) if (!known.has(blank)) problems.push(`The words use {${blank}}, but the list has no ${blank} column.`);
  if (options.noLinksInFirst) {
    const link = findLink(`${first.subject ?? ""}\n${first.body}`.replace(BLANK, " "));
    if (link) problems.push(`The first email must have no links or web addresses, and its words contain "${link}".`);
  }
  return problems;
}

/** The engine's footer under every campaign email. Plain text, no link. */
export function campaignFooter(mailingAddress: string) {
  return `Axiom · ${mailingAddress.trim()}\nNot useful? Reply "no thanks" and we won't email you again.`;
}

const SITE_LABEL = "getaxiom.ca";
const SITE_URL = "https://getaxiom.ca/";
/** The logo tile the FCC signature used: its dark tile is in the image, so Gmail's dark mode shows it (MAIL-002). */
export const SIGNATURE_LOGO_URL = "https://operations.getaxiom.ca/brand/axiom-lockup-tile-328.png";
const LOGO = { width: 164, height: 63 } as const;
const OPT_OUT = `Not useful? Reply "no thanks" and we won't email you again.`;
const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** "1 Main St, Kitchener, ON" becomes "1 Main St," over "Kitchener, ON". */
function addressLines(address: string) {
  const comma = address.indexOf(",");
  return comma < 0 ? [address] : [address.slice(0, comma + 1), address.slice(comma + 1).trim()];
}

/** True when the words' last paragraph already has the sender's name on a line, so the signature doesn't repeat it. */
function signsOffWithName(body: string, name: string) {
  const lastBlock = body.trim().split(/\n{2,}/).at(-1) ?? "";
  return lastBlock.split("\n").some((line) => line.trim().toLowerCase() === name.trim().toLowerCase());
}

/**
 * The founder's signature under a campaign email (the one Riley made for FCC, Nov 1): name, title, mailing
 * address, cell, the site link and the logo, then the "no thanks" line. `link` false leaves out the link and
 * the logo (a no-links campaign's first email). The plain copy is for mail apps that can't show HTML.
 */
export function campaignSignature(sender: Sender, mailingAddress: string, options: { link: boolean; name: boolean }) {
  const title = sender.signature?.title?.trim() || "Co-founder";
  const phone = sender.signature?.phone?.trim();
  const address = addressLines(mailingAddress.trim());
  const lines = [...(options.name ? [sender.name.trim()] : []), title, ...address, ...(phone ? [`C: ${phone}`] : []), ...(options.link ? [SITE_LABEL] : [])];
  const plain = `${lines.join("\n")}\n\n${OPT_OUT}`;
  const line = (text: string, style = "") => `<div${style ? ` style="${style}"` : ""}>${escapeHtml(text)}</div>`;
  const html = [
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:${options.name ? 18 : 4}px;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.45;color:#1f1f1f"><tr><td>`,
    ...(options.name ? [line(sender.name.trim(), "font-size:15px;font-weight:bold")] : []),
    line(title, "font-weight:bold;margin-bottom:2px"),
    ...address.map((text) => line(text)),
    ...(phone || options.link ? [`<div style="height:8px;line-height:8px">&nbsp;</div>`] : []),
    ...(phone ? [line(`C: ${phone}`)] : []),
    ...(options.link ? [
      `<div><a href="${SITE_URL}" style="color:#1a56c4">${SITE_LABEL}</a></div>`,
      `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:10px"><tr><td>`
        + `<a href="${SITE_URL}"><img src="${SIGNATURE_LOGO_URL}" alt="Axiom" width="${LOGO.width}" height="${LOGO.height}" style="display:block;border:0;width:${LOGO.width}px;height:${LOGO.height}px"></a>`
        + `</td></tr></table>`,
    ] : []),
    `</td></tr></table>`,
    `<p style="margin:14px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#777777">${escapeHtml(OPT_OUT)}</p>`,
  ].join("\n");
  return { plain, html };
}

function bodyHtml(body: string) {
  return body.split(/\n{2,}/).map((para) => `<p style="margin:0 0 14px">${escapeHtml(para).replace(/\n/g, "<br>")}</p>`).join("\n");
}

function fill(text: string, fields: Record<string, string>, sender: Sender, missing: Set<string>) {
  const values: Record<string, string> = { ...fields, sender_name: sender.name.trim(), sender_first_name: sender.name.trim().split(/\s+/)[0] ?? "" };
  return text.replace(BLANK, (_whole, name: string) => {
    const key = normaliseColumn(name);
    const value = (values[key] ?? "").trim();
    if (!value) missing.add(key);
    return value;
  });
}

/**
 * Email `step` (1-based) for one row, exactly as it will be sent. `firstSubject` is the subject the
 * row's first email went with (follow-ups answer under it); when absent it is rendered from step 1.
 */
export function renderEmail(words: CampaignWords, step: number, fields: Record<string, string>, sender: Sender,
  mailingAddress: string | null | undefined, options: { noLinksInFirst?: boolean; firstSubject?: string | null } = {}): RenderResult {
  const address = (mailingAddress ?? "").trim();
  if (address.length < 10) return { ok: false, reason: "No mailing address is set, and every email must carry one" };
  const words1 = words.steps[0];
  const wordsN = words.steps[step - 1];
  if (!words1?.subject || !wordsN) return { ok: false, reason: `There are no words for email ${step}` };
  const missing = new Set<string>();
  const firstSubject = options.firstSubject?.trim() || fill(words1.subject, fields, sender, missing).replace(/\s+/g, " ").trim();
  const subject = step === 1 ? firstSubject : `Re: ${firstSubject.replace(/^re:\s*/i, "")}`;
  const body = fill(wordsN.body, fields, sender, missing);
  if (missing.size) return { ok: false, reason: `Blank ${[...missing].map((name) => `{${name}}`).join(", ")} in this row` };
  const clean = body.replace(/\n{3,}/g, "\n\n").replace(/[ \t]+$/gm, "").trim();
  const signature = sender.signature
    ? campaignSignature(sender, address, { link: !(step === 1 && options.noLinksInFirst), name: !signsOffWithName(clean, sender.name) })
    : null;
  const text = `${clean}\n\n${signature ? signature.plain : campaignFooter(address)}`;
  const html = signature
    ? `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#1f1f1f">\n${bodyHtml(clean)}\n${signature.html}\n</div>`
    : undefined;
  if (/[{}]/.test(subject) || /\{[^}]*\}/.test(body)) return { ok: false, reason: "A blank in the words could not be filled" };
  if (step === 1 && options.noLinksInFirst) {
    const link = findLink(`${subject}\n${body}`);
    if (link) return { ok: false, reason: `The first email would contain a link or web address ("${link}")` };
  }
  return { ok: true, email: html ? { subject, text, html } : { subject, text } };
}
