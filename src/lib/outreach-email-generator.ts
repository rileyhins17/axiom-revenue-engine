/**
 * Outreach Email Generator — rewrite.
 *
 * Single focused LLM call. Real scrape data only. No template fallback —
 * if generation fails or the lead is non-customer, throw or skip so the
 * scheduler blocks the sequence instead of sending junk.
 *
 * Surface kept stable for callers:
 *   - GeneratedEmail (type)
 *   - OutreachSequenceStepType (type)
 *   - generateEmail(lead, enrichment, senderName)
 *   - generateFollowUpEmail(lead, enrichment, senderName, previousEmail, stepType?)
 *   - generateSequenceStepEmail(lead, enrichment, senderName, stepType, previousEmail?)
 *   - buildInitialEmailForTesting(lead, enrichment, senderName)
 *   - buildFollowUpContextForTesting(lead, enrichment, senderName, previousEmail, stepType?)
 */

import type { PainSignal, WebsiteAssessment } from "@/lib/axiom-scoring";
import { chatCompletionJson } from "@/lib/deepseek";
import {
  BANNED_EMAIL_PHRASES,
  buildHtmlEmail,
  buildPlainTextEmail,
} from "@/lib/outreach-email-style";
import type { EnrichmentResult } from "@/lib/outreach-enrichment";
import type { LeadRecord } from "@/lib/prisma";

// ────────────────────────────────────────────────────────────────────────
// Types

export type OutreachSequenceStepType = "INITIAL" | "FOLLOW_UP_1" | "FOLLOW_UP_2" | "FOLLOW_UP_3";

export type GeneratedEmail = {
  subject: string;
  bodyHtml: string;
  bodyPlain: string;
  personalization_reason?: string;
  observed_issue?: string;
  CTA_type?: string;
  confidence_score?: number;
};

type FollowUpSourceEmail = {
  subject: string;
  bodyPlain: string;
  sentAt: string | Date;
};

type RawLlmEmail = {
  subject: string;
  body: string;
  skip_reason?: string;
};

// ────────────────────────────────────────────────────────────────────────
// Non-customer detection

const NON_CUSTOMER_PATTERNS = [
  /\bauthority\b/i,
  /\bcommission\b/i,
  /\bregulator\b/i,
  /\bministry\b/i,
  /\bdepartment of\b/i,
  /\boffice of\b/i,
  /\bbureau\b/i,
  /\bchamber of commerce\b/i,
  /\bassociation\b/i,
  /\bfederation\b/i,
  /\bfoundation\b/i,
  /\bnonprofit\b/i,
  /\bnon-profit\b/i,
  /\bcharity\b/i,
  /\bcouncil\b/i,
  /\bgovernment\b/i,
  /\bagency\b/i,
  /\bmuseum\b/i,
  /\blibrary\b/i,
  /\bchurch\b/i,
  /\binstitute\b/i,
];

function isNonCustomerLead(lead: LeadRecord): boolean {
  const text = `${lead.businessName || ""} ${lead.niche || ""} ${lead.category || ""}`;
  return NON_CUSTOMER_PATTERNS.some((re) => re.test(text));
}

// ────────────────────────────────────────────────────────────────────────
// Helpers

function firstName(value: string): string {
  return value.trim().split(/\s+/)[0] || value.trim() || "Riley";
}

function recipientFirstName(lead: LeadRecord): string {
  const name = (lead.contactName || "").trim();
  if (!name) return "";
  return name.split(/\s+/)[0] || "";
}

function parseJson<T>(value: string | null | undefined): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function clampReviewCount(n: number | null | undefined): number {
  const v = Number(n || 0);
  // Counts > 1000 are almost always scrape artifacts.
  return Number.isFinite(v) && v > 0 && v <= 1000 ? v : 0;
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

// ────────────────────────────────────────────────────────────────────────
// Subject sanitization

function toSentenceCase(value: string): string {
  const lower = value.toLowerCase();
  return lower.replace(/^(\W*)([a-z])/, (_m, lead, first) => `${lead}${first.toUpperCase()}`);
}

function restoreCasing(subject: string, original: string, businessName: string): string {
  let result = subject;

  // Restore standalone single-letter uppercase tokens (Q, I, A).
  const origTokens = original.split(/\s+/);
  const resultTokens = result.split(/\s+/);
  for (let i = 0; i < Math.min(origTokens.length, resultTokens.length); i++) {
    const origLetters = origTokens[i].replace(/[^A-Za-z]/g, "");
    const resLetters = resultTokens[i].replace(/[^A-Za-z]/g, "");
    if (origLetters.length === 1 && origLetters === origLetters.toUpperCase() && resLetters.length === 1) {
      resultTokens[i] = resultTokens[i].replace(/[a-z]/i, origLetters);
    }
  }
  result = resultTokens.join(" ");

  // Restore business-name casing.
  if (businessName) {
    const name = businessName.trim();
    if (name) {
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      result = result.replace(new RegExp(`\\b${escaped}\\b`, "i"), name);
    }
  }
  return result;
}

function sanitizeSubject(raw: string, businessName: string): string {
  const trimmed = (raw || "")
    .replace(/[!]/g, "")
    .replace(/[—–]/g, "-")
    .replace(/\s+/g, " ")
    .trim();

  const source = trimmed.length > 0 ? trimmed : `quick thought on ${businessName}`;
  const short = source.split(/\s+/).filter(Boolean).slice(0, 8).join(" ");
  const sentence = short.toLowerCase().startsWith("re:")
    ? `Re: ${toSentenceCase(short.replace(/^re:\s*/i, ""))}`
    : toSentenceCase(short);
  return restoreCasing(sentence, short, businessName).slice(0, 78);
}

// ────────────────────────────────────────────────────────────────────────
// Validation

type ValidationResult = { valid: boolean; reason: string };

function validateEmailDraft(draft: RawLlmEmail, lead: LeadRecord): ValidationResult {
  const subject = (draft.subject || "").trim();
  const body = (draft.body || "").trim();

  if (!subject) return { valid: false, reason: "subject is empty" };
  if (!body) return { valid: false, reason: "body is empty" };
  if (subject.length > 80) return { valid: false, reason: `subject too long (${subject.length} chars)` };

  const wordCount = countWords(body);
  if (wordCount < 35) return { valid: false, reason: `body too short (${wordCount} words)` };
  if (wordCount > 110) return { valid: false, reason: `body too long (${wordCount} words)` };

  // Must reference business name OR city OR niche somewhere.
  const lower = body.toLowerCase();
  const refs = [lead.businessName, lead.city, lead.niche]
    .filter(Boolean)
    .some((v) => lower.includes(String(v).toLowerCase()));
  if (!refs) return { valid: false, reason: "body does not reference business name, city, or niche" };

  // Banned phrases.
  const bannedHit = BANNED_EMAIL_PHRASES.find((phrase) => lower.includes(phrase));
  if (bannedHit) return { valid: false, reason: `banned phrase: "${bannedHit}"` };

  // Forced-casual phrasings.
  const forcedCasual = [
    /while looking at (a |a few )?\S+ sites/i,
    /(clicked|clicking) through \S+\.[a-z]{2,}/i,
    /poking around \S+/i,
    /took a (quick )?look (at|through)/i,
    /spent (a |some )?(minute|seconds?|time) on/i,
    /had a (quick )?look at \S+/i,
  ];
  for (const re of forcedCasual) {
    if (re.test(body)) return { valid: false, reason: `forced-casual phrase: ${re.source}` };
  }

  // No exclamations, em dashes, or HTML.
  if (body.includes("!")) return { valid: false, reason: "contains exclamation mark" };
  if (/[—–]/.test(body)) return { valid: false, reason: "contains em dash" };
  if (/<[a-z][^>]*>/i.test(body)) return { valid: false, reason: "contains HTML tag" };

  return { valid: true, reason: "" };
}

// ────────────────────────────────────────────────────────────────────────
// Prompt + context

const INITIAL_SYSTEM_PROMPT = `You write 1:1 cold emails for Axiom Web — a small studio that builds and rebuilds websites for local service businesses so they generate more leads from their existing traffic.

You are NOT an agency robot. You write like a real person who works with similar service businesses and noticed something on this one. Conversational. Short. Direct.

WHAT MAKES A GOOD EMAIL:
1. Specific. Says one true thing about THIS business pulled from the data below.
2. Short. 55-80 words body. Under 6 short lines.
3. Conversational. Contractions OK. No agency speak.
4. One ask. A question that's easy to say yes to in 2 seconds.
5. Earns the reply by being interesting, not pushy.

THE DATA YOU'LL GET IS REAL:
The website assessment came from an actual scrape — speedRisk / conversionRisk / trustRisk / seoRisk are 0-10 scores and topFixes is a real list. You can reference what's in topFixes plainly. Don't invent UX details that aren't there.

OUTPUT STRUCTURE:
Line 1: Greeting. "Hey {firstName}," if recipient first name known, else "Hey,"
Line 2: One opener that names the business and references one specific real fact (a topFix item, the niche+city, or the review count if it's >= 25).
Line 3: One observation. Pull from topFixes when populated — say it plainly like a peer would ("the contact form takes three taps to find on mobile" or "the homepage takes 6+ seconds to load on a phone"). If topFixes is empty, paraphrase the enrichment keyPainPoint into one peer observation. If neither is solid, use an industry pattern relevant to the niche.
Line 4: One soft-question CTA. Strong patterns: "Want me to send the 2 or 3 things I'd change?", "Open to a quick audit?", "Want a 2-minute Loom showing what I mean?", "How are you handling that now?"
Line 5: "Best,\\n{senderFirstName}"
Optional Line 6: PS line with one concrete extra. Max 18 words. Only when it genuinely adds something.

SUBJECT (3-7 words):
Sentence case (first word + proper nouns capitalized).
Good: "Quick thought on {Business}", "{firstName}, one thing on {Business}", "{City} {niche} site idea", "Noticed something on {Business}", "One tweak for {Business}".
Bad: "Quick question", "Question about your business", anything all-lowercase, anything Title Case, anything salesy.

HARD RULES:
- Plain text only. No HTML, no markdown, no emoji.
- No exclamation marks. No em dashes (—). Use commas or periods.
- Subject-verb agreement: "11 reviews say" not "11 reviews says". "Most plumbing businesses get" not "Most plumbing get".
- The niche field may already be plural ("plumbing companies", "roofers", "med-spas"). Use it as-is — NEVER stack "businesses" / "operators" on top.
- Do not invent specific UX claims outside the WEBSITE ASSESSMENT topFixes.
- Do not over-compliment. If you cite reviews, use the actual number — and only if >= 25.
- Never use: "hope this finds you well", "we specialize in", "I help businesses like yours", "would love to", "circle back", "touch base", "schedule a call", "book a demo", "hop on a call", "let's connect", "boost revenue", "scale your business", "unlock growth", "online presence", "digital transformation".

SKIP CONDITIONS:
If the business looks like a non-customer (government agency, regulator, nonprofit, foundation, association, institute, council, chamber of commerce, museum, library, church), respond with:
{"subject":"","body":"","skip_reason":"non-customer entity"}

OUTPUT JSON ONLY:
{"subject":"...", "body":"...", "skip_reason":""}`;

const FOLLOW_UP_SYSTEM_PROMPT = `You write short follow-up emails for Axiom Web. The recipient was sent a prior cold email and hasn't replied.

RULES:
- 40-60 words body for FOLLOW_UP_1, 30-50 words for FOLLOW_UP_2 / FOLLOW_UP_3.
- Acknowledge the prior note in one short phrase.
- Add ONE new useful angle — do not repeat the same critique.
- Keep the CTA tiny ("happy to send the 3 things if useful", "open to a quick look?").
- Plain text only. No exclamation marks. No em dashes. No HTML.
- End with "Best,\\n{senderFirstName}".
- Subject: short, sentence case. "Re:" prefix is fine when natural.

OUTPUT JSON ONLY:
{"subject":"...", "body":"..."}`;

function buildAssessmentBlock(lead: LeadRecord): string {
  const assessment = parseJson<WebsiteAssessment>(lead.axiomWebsiteAssessment);
  if (!assessment) return "WEBSITE ASSESSMENT: not scraped yet";

  const lines = [
    "WEBSITE ASSESSMENT (real scrape data):",
    `- Overall grade: ${assessment.overallGrade || "unknown"}`,
    `- Speed risk: ${assessment.speedRisk}/10`,
    `- Conversion risk: ${assessment.conversionRisk}/10`,
    `- Trust risk: ${assessment.trustRisk}/10`,
    `- SEO risk: ${assessment.seoRisk}/10`,
  ];

  const fixes = (assessment.topFixes || []).slice(0, 4).filter((f) => f && f.trim());
  if (fixes.length > 0) {
    lines.push(`- topFixes: ${fixes.join("; ")}`);
  } else {
    lines.push("- topFixes: (none identified)");
  }

  return lines.join("\n");
}

function buildPainBlock(lead: LeadRecord): string {
  const painSignals = parseJson<PainSignal[]>(lead.painSignals);
  if (!Array.isArray(painSignals) || painSignals.length === 0) return "";

  const top = painSignals
    .filter((s) => s && s.severity >= 2)
    .slice(0, 3)
    .map((s) => `- ${s.type} (sev ${s.severity}): ${s.evidence || ""}`.trim());

  if (top.length === 0) return "";
  return ["PAIN SIGNALS:", ...top].join("\n");
}

function buildInitialContext(
  lead: LeadRecord,
  enrichment: EnrichmentResult,
  senderName: string,
): string {
  const lines: string[] = [];

  lines.push(`SENDER FIRST NAME: ${firstName(senderName)}`);
  const recipientFirst = recipientFirstName(lead);
  if (recipientFirst) lines.push(`RECIPIENT FIRST NAME: ${recipientFirst}`);
  lines.push(`BUSINESS: ${lead.businessName}`);
  lines.push(`CITY: ${lead.city || "unknown"}`);
  lines.push(`NICHE: ${lead.niche || "service business"}`);
  if (lead.websiteUrl) lines.push(`WEBSITE: ${lead.websiteUrl}`);

  const reviewCount = clampReviewCount(lead.reviewCount);
  if (reviewCount > 0) {
    const rating = Number(lead.rating || 0);
    lines.push(`GOOGLE REVIEWS: ${reviewCount} reviews${rating > 0 ? ` at ${rating} stars` : ""}`);
  }

  lines.push("");
  lines.push(buildAssessmentBlock(lead));

  const painBlock = buildPainBlock(lead);
  if (painBlock) {
    lines.push("");
    lines.push(painBlock);
  }

  lines.push("");
  lines.push("ENRICHMENT (real public-data analysis):");
  lines.push(`- Key pain point: ${enrichment.keyPainPoint}`);
  lines.push(`- Personalized hook: ${enrichment.personalizedHook}`);
  lines.push(`- Suggested CTA flavor: ${enrichment.recommendedCTA}`);
  lines.push(`- Tone: ${enrichment.emailTone}`);

  return lines.join("\n");
}

function buildFollowUpContext(
  lead: LeadRecord,
  enrichment: EnrichmentResult,
  senderName: string,
  previousEmail: FollowUpSourceEmail,
  stepType: OutreachSequenceStepType,
): string {
  const lines: string[] = [];

  lines.push(`SENDER FIRST NAME: ${firstName(senderName)}`);
  const recipientFirst = recipientFirstName(lead);
  if (recipientFirst) lines.push(`RECIPIENT FIRST NAME: ${recipientFirst}`);
  lines.push(`BUSINESS: ${lead.businessName}`);
  lines.push(`CITY: ${lead.city || "unknown"}`);
  lines.push(`NICHE: ${lead.niche || "service business"}`);
  lines.push(`STEP TYPE: ${stepType}`);
  lines.push("");
  lines.push("PRIOR EMAIL SUBJECT:");
  lines.push(previousEmail.subject);
  lines.push("");
  lines.push("PRIOR EMAIL BODY:");
  lines.push(previousEmail.bodyPlain);
  lines.push("");
  lines.push("ENRICHMENT:");
  lines.push(`- Key pain point: ${enrichment.keyPainPoint}`);
  lines.push(`- Personalized hook: ${enrichment.personalizedHook}`);

  return lines.join("\n");
}

// ────────────────────────────────────────────────────────────────────────
// Skip exception

export class EmailSkipError extends Error {
  constructor(public readonly skipReason: string) {
    super(`email skipped: ${skipReason}`);
    this.name = "EmailSkipError";
  }
}

// ────────────────────────────────────────────────────────────────────────
// Core generation

async function callLlm(
  systemPrompt: string,
  userPrompt: string,
  retry: boolean,
): Promise<RawLlmEmail> {
  return chatCompletionJson<RawLlmEmail>({
    systemPrompt,
    userPrompt,
    temperature: retry ? 0.15 : 0.25,
    maxTokens: 900,
  });
}

function finalizeEmail(
  draft: RawLlmEmail,
  senderName: string,
  businessName: string,
): GeneratedEmail {
  const senderFirst = firstName(senderName);
  const subject = sanitizeSubject(draft.subject, businessName);
  const bodyPlain = buildPlainTextEmail((draft.body || "").replace(/\r/g, "").trim(), senderFirst);
  const bodyHtml = buildHtmlEmail(bodyPlain);

  return {
    subject,
    bodyPlain,
    bodyHtml,
    CTA_type: "permission_offer",
    confidence_score: 75,
  };
}

export async function generateEmail(
  lead: LeadRecord,
  enrichment: EnrichmentResult,
  senderName: string,
): Promise<GeneratedEmail> {
  if (isNonCustomerLead(lead)) {
    throw new EmailSkipError("non-customer entity");
  }

  const context = buildInitialContext(lead, enrichment, senderName);
  const userPrompt = `Write one cold email for this lead. Follow the structure and rules above.\n\n${context}`;

  // First attempt.
  const first = await callLlm(INITIAL_SYSTEM_PROMPT, userPrompt, false);
  if (first.skip_reason) throw new EmailSkipError(first.skip_reason);

  const firstCheck = validateEmailDraft(first, lead);
  if (firstCheck.valid) return finalizeEmail(first, senderName, lead.businessName);

  // Retry once with explicit fix instructions.
  const retryPrompt = `${userPrompt}\n\nYour previous attempt was rejected: ${firstCheck.reason}. Generate a corrected version that fixes this issue and stays within all rules above.`;
  const retry = await callLlm(INITIAL_SYSTEM_PROMPT, retryPrompt, true);
  if (retry.skip_reason) throw new EmailSkipError(retry.skip_reason);

  const retryCheck = validateEmailDraft(retry, lead);
  if (retryCheck.valid) return finalizeEmail(retry, senderName, lead.businessName);

  // Both attempts failed — block the sequence rather than send junk.
  throw new Error(`email generation failed validation twice: ${retryCheck.reason}`);
}

export async function generateFollowUpEmail(
  lead: LeadRecord,
  enrichment: EnrichmentResult,
  senderName: string,
  previousEmail: FollowUpSourceEmail,
  stepType: OutreachSequenceStepType = "FOLLOW_UP_1",
): Promise<GeneratedEmail> {
  if (isNonCustomerLead(lead)) {
    throw new EmailSkipError("non-customer entity");
  }

  const context = buildFollowUpContext(lead, enrichment, senderName, previousEmail, stepType);
  const userPrompt = `Write a ${stepType} follow-up for this lead.\n\n${context}`;

  const first = await callLlm(FOLLOW_UP_SYSTEM_PROMPT, userPrompt, false);
  const firstCheck = validateEmailDraft(first, lead);
  if (firstCheck.valid) return finalizeEmail(first, senderName, lead.businessName);

  const retryPrompt = `${userPrompt}\n\nYour previous attempt was rejected: ${firstCheck.reason}. Generate a corrected version.`;
  const retry = await callLlm(FOLLOW_UP_SYSTEM_PROMPT, retryPrompt, true);
  const retryCheck = validateEmailDraft(retry, lead);
  if (retryCheck.valid) return finalizeEmail(retry, senderName, lead.businessName);

  throw new Error(`follow-up generation failed validation twice: ${retryCheck.reason}`);
}

export async function generateSequenceStepEmail(
  lead: LeadRecord,
  enrichment: EnrichmentResult,
  senderName: string,
  stepType: OutreachSequenceStepType,
  previousEmail?: FollowUpSourceEmail,
): Promise<GeneratedEmail> {
  if (stepType === "INITIAL") {
    return generateEmail(lead, enrichment, senderName);
  }
  if (!previousEmail) {
    throw new Error(`previous email context required for ${stepType}`);
  }
  return generateFollowUpEmail(lead, enrichment, senderName, previousEmail, stepType);
}

// ────────────────────────────────────────────────────────────────────────
// Test helpers (used by outreach-email-generator.test.ts)

export function buildInitialEmailForTesting(
  lead: LeadRecord,
  enrichment: EnrichmentResult,
  senderName: string,
): GeneratedEmail {
  // Returns a deterministic placeholder so tests can run without hitting the
  // LLM. Real generation always goes through generateEmail().
  const senderFirst = firstName(senderName);
  const recipientFirst = recipientFirstName(lead);
  const greet = recipientFirst ? `Hey ${recipientFirst},` : "Hey,";
  const body = [
    greet,
    "",
    `Came across ${lead.businessName} while looking at ${lead.niche || "service businesses"} in ${lead.city || "your area"}.`,
    enrichment.keyPainPoint || "Most service sites lose calls when the contact path takes more than two taps on mobile.",
    "Want me to send the 2 or 3 things I'd change?",
  ].join("\n");
  const bodyPlain = buildPlainTextEmail(body, senderFirst);
  return {
    subject: sanitizeSubject(`Quick thought on ${lead.businessName}`, lead.businessName),
    bodyPlain,
    bodyHtml: buildHtmlEmail(bodyPlain),
    CTA_type: "permission_offer",
    confidence_score: 70,
  };
}

export function buildFollowUpContextForTesting(
  lead: LeadRecord,
  enrichment: EnrichmentResult,
  senderName: string,
  previousEmail: FollowUpSourceEmail,
  stepType: OutreachSequenceStepType = "FOLLOW_UP_1",
): string {
  return buildFollowUpContext(lead, enrichment, senderName, previousEmail, stepType);
}
