/**
 * Shared output formatting for outreach email.
 *
 * Message planning and evidence validation live in outreach-email-generator.
 * Keeping this module deliberately small prevents a second, conflicting copy
 * policy from drifting back into the send path.
 */

export const BANNED_EMAIL_PHRASES = [
  "i hope you're well",
  "i hope you are well",
  "stellar reputation",
  "glowing reviews",
  "award-winning brand",
  "award winning brand",
  "high-converting platforms",
  "high converting platforms",
  "we specialize in",
  "modernize your website",
  "improve booking conversions",
  "boost revenue",
  "schedule a quick 10-minute call",
  "schedule a quick 10 minute call",
  "hop on a quick call",
  "modern, high-converting",
  "modern high-converting",
  "transforming sites like yours",
  "align your website with",
  "strong online presence",
  "really strong reputation",
  "very strong reputation",
  "award winning",
  "top-tier",
  "top tier",
  "best-in-class",
  "best in class",
  "first impression",
  "digital transformation",
  "online visibility",
  "optimize your site",
  "take things to the next level",
  "stand out from competitors",
  "winning more leads",
  "drive more leads",
  "unlock growth",
  "broken",
  "still broken",
  "costing you leads",
  "one last time",
  "last note",
  "final chance",
  "limited time",
  "while looking at a few sites tonight",
  "while looking at a few sites",
  "looking at a few sites tonight",
  "had a quick look at",
  "spent a minute on",
  "poking around",
  "i was poking around",
  "main offer and next step could be easier to scan",
  "main offer and next step easy to scan",
  "main offer and next step take too many seconds",
];

function sentenceSplit(value: string) {
  return value
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function ensureReadableLineBreaks(value: string) {
  const clean = value.trim();
  if (!clean) return clean;

  const lines = clean.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  if (lines.length >= 3) return lines.join("\n\n");

  const sentences = sentenceSplit(clean);
  if (sentences.length < 2) return clean;

  const firstLine = sentences[0];
  const middle = sentences.slice(1, -1).join(" ");
  const lastLine = sentences[sentences.length - 1];
  return [firstLine, middle, lastLine].filter(Boolean).join("\n\n");
}

export function buildPlainTextEmail(
  body: string,
  senderFirstName: string,
  signoffWord: string = "Best",
) {
  const escapedSender = senderFirstName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const signaturePattern = new RegExp(
    `(?:\\n\\s*)?(?:best|thanks|thank you|regards|cheers)(?:\\s+regards)?,?\\s*\\n?\\s*${escapedSender}(?:\\s+hinsperger)?(?:\\s+axiom\\s+infrastructure)?\\s*`,
    "gi",
  );
  const inlineSignaturePattern = new RegExp(
    `\\s+${escapedSender}(?:\\s+hinsperger)?\\s+axiom\\s+infrastructure\\s*`,
    "gi",
  );

  let sanitized = body
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/[—–]/g, ",")
    .replace(/\bone last time\b/gi, "again")
    .replace(/\blast note\b/gi, "quick note")
    .replace(/\bstill broken\b/gi, "still hard to use")
    .replace(/\bbroken\b/gi, "hard to use")
    .replace(/\bcosting you leads\b/gi, "making it harder for visitors to reach out")
    .replace(/!/g, ".")
    .replace(/\r/g, "")
    .replace(/[ \t]+([,.?])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .replace(/\n?---\s*\nFrom Axiom Infrastructure\s*\ngetaxiom\.ca\s*$/i, "")
    .replace(/\s*From Axiom Infrastructure\s+getaxiom\.ca\s*$/i, "");

  sanitized = sanitized.replace(signaturePattern, "\n\n");
  sanitized = sanitized.replace(inlineSignaturePattern, " ");
  sanitized = sanitized.trim().replace(/\n{3,}/g, "\n\n");

  let psLine = "";
  const psMatch = sanitized.match(/\n\s*(P\.?S\.?[^\n]*)\s*$/i);
  if (psMatch) {
    psLine = psMatch[1].trim();
    sanitized = sanitized.slice(0, psMatch.index).trim();
  }

  const signoff = `${signoffWord},\n${senderFirstName}`;
  const psSuffix = psLine ? `\n\n${psLine}` : "";
  return `${ensureReadableLineBreaks(sanitized)}\n\n${signoff}${psSuffix}`.trim();
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function buildHtmlEmail(bodyPlain: string) {
  const paragraphs = bodyPlain
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map(
      (paragraph) =>
        `<p style="margin:0 0 14px;font-size:15px;line-height:1.55;font-family:Arial,Helvetica,sans-serif;">${escapeHtml(paragraph).replace(/\n/g, "<br />")}</p>`,
    )
    .join("");

  return [
    "<!DOCTYPE html>",
    "<html>",
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
    '<meta name="color-scheme" content="light dark">',
    '<meta name="supported-color-schemes" content="light dark">',
    "</head>",
    '<body style="margin:0;padding:0;background:transparent;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;">',
    paragraphs,
    "</body>",
    "</html>",
  ].join("");
}
