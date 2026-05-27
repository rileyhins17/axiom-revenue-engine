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

function letterCore(token: string): string {
  return token.replace(/[^\p{L}\p{N}]/gu, "").toLowerCase();
}

function restoreCasing(subject: string, original: string, businessName: string): string {
  const resultTokens = subject.split(/\s+/);

  // 1. Restore standalone single-letter uppercase tokens (Q, I, A) from original.
  const origTokens = original.split(/\s+/);
  for (let i = 0; i < Math.min(origTokens.length, resultTokens.length); i++) {
    const origLetters = origTokens[i].replace(/[^A-Za-z]/g, "");
    const resLetters = resultTokens[i].replace(/[^A-Za-z]/g, "");
    if (origLetters.length === 1 && origLetters === origLetters.toUpperCase() && resLetters.length === 1) {
      resultTokens[i] = resultTokens[i].replace(/[a-z]/i, origLetters);
    }
  }

  // 2. Restore business-name casing. Search for the longest contiguous
  //    subsequence of business-name tokens that appears in the subject
  //    (case-insensitive, ignoring punctuation) and overlay the original
  //    casing of each matched token.
  if (businessName) {
    const nameTokens = businessName.trim().split(/\s+/).filter(Boolean);
    const nameLower = nameTokens.map(letterCore);
    const subjectLower = resultTokens.map(letterCore);

    outer:
    for (let runLen = nameTokens.length; runLen >= 1; runLen--) {
      for (let nameStart = 0; nameStart + runLen <= nameTokens.length; nameStart++) {
        const slice = nameLower.slice(nameStart, nameStart + runLen);
        if (slice.some((s) => !s)) continue;
        for (let subjStart = 0; subjStart + runLen <= resultTokens.length; subjStart++) {
          const subSlice = subjectLower.slice(subjStart, subjStart + runLen);
          if (subSlice.every((s, idx) => s === slice[idx])) {
            for (let j = 0; j < runLen; j++) {
              const cur = resultTokens[subjStart + j];
              const trailingMatch = cur.match(/[^\p{L}\p{N}]+$/u);
              const trailing = trailingMatch ? trailingMatch[0] : "";
              resultTokens[subjStart + j] = nameTokens[nameStart + j] + trailing;
            }
            break outer;
          }
        }
      }
    }
  }
  return resultTokens.join(" ");
}

const MAX_SUBJECT_CHARS = 78;

function trimAtWordBoundary(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  // Find the last space at or before maxChars so we don't slice mid-word.
  const candidate = value.slice(0, maxChars);
  const lastSpace = candidate.lastIndexOf(" ");
  return (lastSpace > maxChars * 0.5 ? candidate.slice(0, lastSpace) : candidate).trim();
}

function sanitizeSubject(raw: string, businessName: string): string {
  const trimmed = (raw || "")
    .replace(/[!]/g, "")
    .replace(/[—–]/g, "-")
    .replace(/\s+/g, " ")
    .trim();

  const source = trimmed.length > 0 ? trimmed : `quick thought on ${businessName}`;
  // Cap by character length, not word count, so legitimate 8-12 word subjects
  // like "30 reviews at 5 stars and a site that doesn't quite do that justice"
  // (67 chars) don't get sliced mid-sentence. Trim at the nearest preceding
  // word boundary if we have to cut.
  const sized = trimAtWordBoundary(source, MAX_SUBJECT_CHARS);
  const sentence = sized.toLowerCase().startsWith("re:")
    ? `Re: ${toSentenceCase(sized.replace(/^re:\s*/i, ""))}`
    : toSentenceCase(sized);
  return restoreCasing(sentence, sized, businessName);
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
  const subjectWords = countWords(subject);
  if (subjectWords > 8) {
    return {
      valid: false,
      reason: `subject is ${subjectWords} words — must be 3 to 7 words. Use a short header, not a full sentence.`,
    };
  }
  if (subjectWords < 2) {
    return { valid: false, reason: `subject is ${subjectWords} word — must be 3 to 7 words` };
  }

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

  // Hedging language. One soft modifier is forgivable but multiple weaken the
  // pitch into mush. Count total hits and reject when >= 2.
  const hedgePatterns: RegExp[] = [
    /\ba bit\b/i,
    /\ba little\b/i,
    /\bkind of\b/i,
    /\bsort of\b/i,
    /\bsomewhat\b/i,
    /\bperhaps\b/i,
    /\bmight\b/i,
    /\bmay\b/i,
    /\btends to\b/i,
    /\bseems to\b/i,
    /\bfeels like\b/i,
    /\bin some cases\b/i,
    /\bfor some visitors\b/i,
    /\bpossibly\b/i,
    /\bquite\b/i,
  ];
  const hedgeHits = hedgePatterns.filter((re) => re.test(body));
  if (hedgeHits.length >= 2) {
    return {
      valid: false,
      reason: `too much hedging (${hedgeHits.length} soft modifiers: ${hedgeHits.map((r) => r.source).join(", ")}). Drop the qualifiers and state the observation directly.`,
    };
  }

  return { valid: true, reason: "" };
}

// ────────────────────────────────────────────────────────────────────────
// Prompt + context

const INITIAL_SYSTEM_PROMPT = `You write 1:1 cold emails for Axiom Web — a small studio that builds and rebuilds websites for local service businesses so they generate more leads from their existing traffic.

You are NOT an agency robot. You write like a real person who works with similar service businesses and noticed something on this one. Conversational. Short. Direct.

WHAT MAKES A GOOD EMAIL:
1. Specific. Says one true thing about THIS business pulled from the data below — in YOUR OWN WORDS, never verbatim quotes from the data block.
2. Short. 55-80 words body. Under 6 short lines.
3. Conversational. Contractions OK. No agency speak.
4. One ask. A question that's easy to say yes to in 2 seconds.
5. Earns the reply by being interesting, not pushy.
6. Sounds different from every other cold email this lead receives. Vary opener structure, observation angle, and CTA — never reuse the same template.

THE DATA YOU'LL GET IS REAL:
The website assessment came from an actual scrape — speedRisk / conversionRisk / trustRisk / seoRisk are 0-10 scores and topFixes is a real list. You can reference what's in topFixes — but PARAPHRASE in your own peer voice. Do not echo the topFix text word-for-word. Do not invent UX details that aren't supported by the data.

PRIORITY OF SIGNALS (pick the strongest one available, in this order):
1. A specific topFix item that names a concrete UX problem (use it — but rewrite into your own peer phrasing).
2. The enrichment keyPainPoint when it's specific.
3. The dominant numerical risk (e.g. speed 4/10 → "site felt slow on my phone").
4. A review-count signal when reviewCount >= 25 ("X reviews at Y stars — clearly doing the work").
5. An industry pattern tied to the niche + city.
Never default to a generic observation. If signal 1 is the placeholder "Keep the main offer and next step easy to scan", treat it as NO findings and use signal 2 or 3.

OUTPUT STRUCTURE:
Line 1: Greeting — use the EXACT greeting string supplied in the user-prompt context block.
Line 2-3: Opener + observation in 1-2 lines. Use the opener pattern letter (A-F) supplied in the context:
  A. Start with a direct question. "Is the quote button on {Business}'s site supposed to be that hard to find on mobile?"
  B. Start with the observation directly. "First thing I'd change on {Business}: reviews sit four screens below the fold on mobile."
  C. Start with niche pattern. "Most {niche} sites have the same gap — and {Business}'s is the contact path."
  D. Start with city + niche. "Working with a few {niche} businesses in {City}, and {Business} stood out for one reason."
  E. Start with review count when >= 25. "{X} reviews at {Y} stars, and a homepage that doesn't quite reflect that."
  F. Start by naming what works. "{Business}'s service detail is solid. The friction point is mobile."
Line 4: CTA — use the EXACT CTA string supplied in the user-prompt context block.
Line 5: Signoff — use the EXACT signoff line supplied in the user-prompt context block.
Optional Line 6: PS line with one concrete extra. Max 18 words. Only when it genuinely adds something.

SUBJECT (HARD LIMIT 3-7 words, max 70 chars):
The subject is a short header, NOT a sentence from the body. Never reuse the body opener as the subject.
Sentence case (first word + proper nouns capitalized). Always capitalize the business name and any city.
Good: "Quick thought on {Business}", "{firstName}, one thing on {Business}", "{City} {niche} site idea", "Noticed something on {Business}", "One tweak for {Business}", "30 reviews and one tweak", "Slow on mobile, {Business}".
Bad: "Quick question", "Question about your business", anything 8+ words, anything that reads like a sentence, anything all-lowercase, anything Title Case, anything salesy.

HARD RULES:
- Plain text only. No HTML, no markdown, no emoji.
- No exclamation marks. No em dashes (—). Use commas or periods.
- Subject-verb agreement: "11 reviews say" not "11 reviews says". "Most plumbing businesses get" not "Most plumbing get".
- The niche field may already be plural ("plumbing companies", "roofers", "med-spas"). Use it as-is — NEVER stack "businesses" / "operators" on top.
- Do not invent specific UX claims outside the WEBSITE ASSESSMENT topFixes.
- Do not echo topFix or enrichment text verbatim — paraphrase in peer voice.
- Do not over-compliment. If you cite reviews, use the actual number — and only if >= 25.
- Never use: "hope this finds you well", "we specialize in", "I help businesses like yours", "would love to", "circle back", "touch base", "schedule a call", "book a demo", "hop on a call", "let's connect", "boost revenue", "scale your business", "unlock growth", "online presence", "digital transformation", "main offer and next step".

NO HEDGING. The observation must land. Drop these soft adverbs:
- "a bit", "a little", "kind of", "sort of", "somewhat"
- "might", "may", "could possibly", "perhaps"
- "tends to", "seems to", "feels like it may"
- "in some cases", "for some visitors"
WRITE THIS: "the quote button is below three screens on mobile"
NOT THIS:  "the quote button might be a bit hard to find on mobile"

CONCRETE IMPACT. Tie the observation to an outcome someone running the business actually cares about:
- "→ loses calls from mobile" not "→ might not be ideal"
- "→ buyers go to the next result" not "→ could create some friction"
- "→ 30+ second load on 4G" not "→ feels slow"

OPENER + OBSERVATION QUALITY BAR:
- Reference at least ONE concrete data point from the context (review count, risk score, city, niche, a specific topFix paraphrase).
- The observation must be something a real visitor would notice in under 10 seconds, not an abstract UX cliche.

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

const GENERIC_FIX_MARKERS = [
  "keep the main offer and next step easy to scan",
  "main offer and next step",
];

function isGenericFix(text: string): boolean {
  const lower = text.toLowerCase();
  return GENERIC_FIX_MARKERS.some((m) => lower.includes(m));
}

function buildAssessmentBlock(lead: LeadRecord): string {
  const assessment = parseJson<WebsiteAssessment>(lead.axiomWebsiteAssessment);
  if (!assessment) return "WEBSITE ASSESSMENT: not scraped yet — use enrichment and niche pattern for the observation.";

  const lines = [
    "WEBSITE ASSESSMENT (real scrape data):",
    `- Overall grade: ${assessment.overallGrade || "unknown"}`,
    `- Speed risk: ${assessment.speedRisk}/10`,
    `- Conversion risk: ${assessment.conversionRisk}/10`,
    `- Trust risk: ${assessment.trustRisk}/10`,
    `- SEO risk: ${assessment.seoRisk}/10`,
  ];

  const rawFixes = (assessment.topFixes || []).slice(0, 4).filter((f) => f && f.trim());
  const specificFixes = rawFixes.filter((f) => !isGenericFix(f));

  if (specificFixes.length > 0) {
    lines.push(`- topFixes (specific findings — paraphrase, don't quote): ${specificFixes.join("; ")}`);
  } else {
    // Generic placeholder or empty — tell the model not to lean on it.
    lines.push("- topFixes: (no specific UX problems flagged — DO NOT invent one; instead use enrichment.keyPainPoint or the dominant risk score as your angle)");

    // Surface the dominant risk axis so the model has a concrete angle.
    const risks = [
      { key: "speed", score: assessment.speedRisk, hint: "Site likely feels slow on mobile" },
      { key: "trust", score: assessment.trustRisk, hint: "Reviews/proof/credentials not surfaced enough" },
      { key: "seo", score: assessment.seoRisk, hint: "Service detail thin for what people search" },
      { key: "conversion", score: assessment.conversionRisk, hint: "Quote/contact path takes effort to find" },
    ].sort((a, b) => b.score - a.score);
    const top = risks[0];
    if (top && top.score >= 2) {
      lines.push(`- dominant risk: ${top.key} (${top.score}/10) — ${top.hint}`);
    }
  }

  return lines.join("\n");
}

// Deterministic seed from lead id so picks are stable per lead.
function leadSeed(lead: LeadRecord): number {
  return Number(lead.id || 0) || (lead.businessName?.length || 0);
}

// Deterministic opener rotation. Lead id seed → pattern letter A-F so a given
// lead always gets the same opener pattern, but the pattern varies across the
// queue and emails don't all read identically.
function pickOpenerPattern(lead: LeadRecord): string {
  const patterns = ["A", "B", "C", "D", "E", "F"];
  return patterns[leadSeed(lead) % patterns.length];
}

const CTA_POOL = [
  "Want me to send the 2 or 3 things I'd change?",
  "Open to a 2-minute Loom showing what I mean?",
  "Should I put a short list together?",
  "How are you handling that now?",
  "Want the specifics?",
  "Worth me sending what I'd tweak?",
  "Want me to show you on a quick call?",
];

const SIGNOFF_POOL = ["Best", "Thanks", "Cheers"];

const GREETING_POOL = ["Hey", "Hi", "Hey there", "Hi there"];

function pickCta(lead: LeadRecord): string {
  return CTA_POOL[leadSeed(lead) % CTA_POOL.length];
}

function pickSignoff(lead: LeadRecord): string {
  // Offset seed so signoff differs from opener pattern roll.
  return SIGNOFF_POOL[(leadSeed(lead) + 1) % SIGNOFF_POOL.length];
}

function pickGreeting(lead: LeadRecord): string {
  const recipientFirst = recipientFirstName(lead);
  if (recipientFirst) return `Hey ${recipientFirst}`;
  // Offset seed so greeting flavor varies from opener/signoff.
  return GREETING_POOL[(leadSeed(lead) + 2) % GREETING_POOL.length];
}

// Niche-specific industry intuition. The model otherwise writes every email
// like every niche is the same generic "service business". Surfacing one
// honest pattern per niche gives the model real-world texture to lean on
// when no specific topFix is available.
const NICHE_INDUSTRY_HOOKS: Array<{ match: RegExp; hook: string }> = [
  { match: /roof/i, hook: "Roofing buyers usually search after a storm or visible damage — urgency is high and trust signals matter more than copy." },
  { match: /plumb/i, hook: "Plumbing leads are mostly urgent — emergency repairs and water damage. People grab the first number that's easy to find." },
  { match: /hvac|heating|cooling|furnace|air conditioning/i, hook: "HVAC buying cycles spike in summer heatwaves and winter cold snaps. Same-day availability messaging beats most copy." },
  { match: /electric/i, hook: "Electrical buyers want licensed/insured visible up front. Code compliance and same-day availability are the real differentiators." },
  { match: /tree/i, hook: "Tree service buyers care about insurance and safety claims more than price. Storm-damage urgency drives a lot of clicks." },
  { match: /landscap|lawn|garden/i, hook: "Landscaping buyers shop seasonal — gallery photos and clear before/after work matter more than service copy." },
  { match: /clean/i, hook: "Cleaning service buyers compare on trust and reliability. Recurring booking is the biggest revenue lever." },
  { match: /paint/i, hook: "Painting buyers shop on portfolio first. Quote turnaround speed is the second decision point." },
  { match: /concrete|mason/i, hook: "Concrete/masonry buyers want to see real project photos from their city. Portfolio depth converts." },
  { match: /pest/i, hook: "Pest control buyers are urgent and trust-sensitive. Speed-to-quote and credentials win." },
  { match: /pool/i, hook: "Pool buyers shop seasonal and high-ticket. Long sales cycle, photo-heavy decision." },
  { match: /spa|salon/i, hook: "Spa/salon buyers book on visual aesthetic and reviews. Booking-button placement on mobile is everything." },
  { match: /renovat|remodel|kitchen|bathroom/i, hook: "Renovation buyers shop slowly and high-stakes. Project galleries and budget-range transparency matter." },
];

function getNicheHook(lead: LeadRecord): string {
  const niche = `${lead.niche || ""} ${lead.category || ""}`.toLowerCase();
  for (const { match, hook } of NICHE_INDUSTRY_HOOKS) {
    if (match.test(niche)) return hook;
  }
  return "";
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

  const nicheHook = getNicheHook(lead);
  if (nicheHook) {
    lines.push("");
    lines.push(`NICHE INTUITION (use as background, do not quote): ${nicheHook}`);
  }

  lines.push("");
  lines.push("WRITE THIS EMAIL WITH:");
  lines.push(`- Greeting: "${pickGreeting(lead)},"`);
  lines.push(`- Opener pattern: ${pickOpenerPattern(lead)} (see system prompt patterns A-F). Use exactly this pattern.`);
  lines.push(`- CTA: "${pickCta(lead)}"`);
  lines.push(`- Signoff line: "${pickSignoff(lead)},\\n${firstName(senderName)}"`);
  lines.push("Use these exact strings for greeting, CTA, and signoff. Do not substitute.");

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
  signoffWord: string = "Best",
): GeneratedEmail {
  const senderFirst = firstName(senderName);
  const subject = sanitizeSubject(draft.subject, businessName);
  const bodyPlain = buildPlainTextEmail((draft.body || "").replace(/\r/g, "").trim(), senderFirst, signoffWord);
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
  if (firstCheck.valid) return finalizeEmail(first, senderName, lead.businessName, pickSignoff(lead));

  // Retry once with explicit fix instructions.
  const retryPrompt = `${userPrompt}\n\nYour previous attempt was rejected: ${firstCheck.reason}. Generate a corrected version that fixes this issue and stays within all rules above.`;
  const retry = await callLlm(INITIAL_SYSTEM_PROMPT, retryPrompt, true);
  if (retry.skip_reason) throw new EmailSkipError(retry.skip_reason);

  const retryCheck = validateEmailDraft(retry, lead);
  if (retryCheck.valid) return finalizeEmail(retry, senderName, lead.businessName, pickSignoff(lead));

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
  if (firstCheck.valid) return finalizeEmail(first, senderName, lead.businessName, pickSignoff(lead));

  const retryPrompt = `${userPrompt}\n\nYour previous attempt was rejected: ${firstCheck.reason}. Generate a corrected version.`;
  const retry = await callLlm(FOLLOW_UP_SYSTEM_PROMPT, retryPrompt, true);
  const retryCheck = validateEmailDraft(retry, lead);
  if (retryCheck.valid) return finalizeEmail(retry, senderName, lead.businessName, pickSignoff(lead));

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
