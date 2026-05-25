/**
 * Outreach Email Generator
 *
 * Uses DeepSeek to generate personalized outreach email copy based on
 * enrichment data. Cold emails are validated against tone/style rules
 * before HTML is rendered for delivery.
 */

import type { PainSignal, WebsiteAssessment } from "@/lib/axiom-scoring";
import { chatCompletionJson } from "@/lib/deepseek";
import {
  buildHtmlEmail,
  buildPlainTextEmail,
  buildRetryInstructions,
  chooseColdEmailPlan,
  type ColdEmailCtaType,
  type ColdEmailDraft,
  type ColdEmailPlan,
  validateColdEmailDraft,
} from "@/lib/outreach-email-style";
import type { EnrichmentResult } from "@/lib/outreach-enrichment";
import type { LeadRecord } from "@/lib/prisma";

export type GeneratedEmail = {
  subject: string;
  bodyHtml: string;
  bodyPlain: string;
  personalization_reason?: string;
  observed_issue?: string;
  CTA_type?: ColdEmailCtaType | "follow_up";
  confidence_score?: number;
};

export type OutreachSequenceStepType = "INITIAL" | "FOLLOW_UP_1" | "FOLLOW_UP_2" | "FOLLOW_UP_3";

type FollowUpSourceEmail = {
  subject: string;
  bodyPlain: string;
  sentAt: string | Date;
};

type RawGeneratedColdEmail = {
  subject: string;
  body: string;
  personalization_reason: string;
  observed_issue: string;
  CTA_type: ColdEmailCtaType;
  confidence_score: number;
};

function parseJson<T>(value: string | null | undefined): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function firstName(senderName: string) {
  return senderName.trim().split(/\s+/)[0] || senderName.trim() || "Riley";
}

function buildPainSignalContext(lead: LeadRecord) {
  const painSignals = parseJson<PainSignal[]>(lead.painSignals);
  if (!Array.isArray(painSignals) || painSignals.length === 0) {
    return "PAIN SIGNALS: none recorded";
  }

  const lines = painSignals
    .slice(0, 4)
    .map(
      (signal) =>
        `- ${signal.type} (severity ${signal.severity}, ${signal.source}): ${signal.evidence || "No evidence provided"}`,
    );

  return ["PAIN SIGNALS:", ...lines].join("\n");
}

function buildWebsiteAssessmentContext(lead: LeadRecord) {
  const assessment = parseJson<WebsiteAssessment>(lead.axiomWebsiteAssessment);
  if (!assessment) {
    return "WEBSITE ASSESSMENT: none recorded";
  }

  return [
    "WEBSITE ASSESSMENT:",
    `- Overall grade: ${assessment.overallGrade || "unknown"}`,
    `- Speed risk: ${assessment.speedRisk}/10`,
    `- Conversion risk: ${assessment.conversionRisk}/10`,
    `- Trust risk: ${assessment.trustRisk}/10`,
    `- SEO risk: ${assessment.seoRisk}/10`,
    `- Top fixes: ${(assessment.topFixes || []).slice(0, 3).join("; ") || "none recorded"}`,
  ].join("\n");
}

function buildGenerationContext(
  lead: LeadRecord,
  enrichment: EnrichmentResult,
  senderName: string,
  plan: ColdEmailPlan,
): string {
  const lines: string[] = [];

  lines.push(`SENDER: ${senderName} from Axiom Web`);
  lines.push(`SENDER FIRST NAME: ${firstName(senderName)}`);
  lines.push(`BUSINESS: ${lead.businessName}`);
  lines.push(`CITY: ${lead.city}`);
  lines.push(`NICHE: ${lead.niche}`);
  if (lead.category) lines.push(`CATEGORY: ${lead.category}`);
  if (lead.contactName) lines.push(`CONTACT NAME: ${lead.contactName}`);
  if (lead.email) lines.push(`EMAIL: ${lead.email}`);
  if (lead.emailType) lines.push(`EMAIL TYPE: ${lead.emailType}`);
  if (lead.emailConfidence != null) lines.push(`EMAIL CONFIDENCE: ${lead.emailConfidence}`);
  if (lead.callOpener) lines.push(`CALL OPENER CANDIDATE: ${lead.callOpener}`);
  if (lead.followUpQuestion) lines.push(`FOLLOW-UP QUESTION CANDIDATE: ${lead.followUpQuestion}`);
  lines.push(`WEBSITE STATUS: ${lead.websiteStatus || "UNKNOWN"}`);
  if (lead.websiteUrl) lines.push(`WEBSITE URL: ${lead.websiteUrl}`);
  if (lead.websiteGrade) lines.push(`WEBSITE GRADE: ${lead.websiteGrade}`);
  if (lead.rating != null) lines.push(`GOOGLE RATING: ${lead.rating}`);
  if (lead.reviewCount != null) lines.push(`REVIEW COUNT: ${lead.reviewCount}`);
  if (lead.axiomScore != null) lines.push(`AXIOM SCORE: ${lead.axiomScore}`);
  if (lead.axiomTier) lines.push(`AXIOM TIER: ${lead.axiomTier}`);
  if (lead.tacticalNote) lines.push(`TACTICAL NOTE: ${lead.tacticalNote}`);
  lines.push("");
  lines.push(buildWebsiteAssessmentContext(lead));
  lines.push("");
  lines.push(buildPainSignalContext(lead));
  lines.push("");
  lines.push("ENRICHMENT INTELLIGENCE:");
  lines.push(`- Value proposition: ${enrichment.valueProposition}`);
  lines.push(`- Pitch angle: ${enrichment.pitchAngle}`);
  lines.push(`- Key pain point: ${enrichment.keyPainPoint}`);
  lines.push(`- Personalized hook: ${enrichment.personalizedHook}`);
  lines.push(`- Recommended CTA: ${enrichment.recommendedCTA}`);
  lines.push(`- Tone: ${enrichment.emailTone}`);
  lines.push(`- Summary: ${enrichment.enrichmentSummary}`);
  lines.push("");
  lines.push("SELECTED EMAIL STRATEGY:");
  lines.push(`- Strategy: ${plan.strategy}`);
  lines.push(`- CTA type: ${plan.CTA_type}`);
  lines.push(`- Confidence score: ${plan.confidence_score}`);
  lines.push(`- Personalization reason: ${plan.personalization_reason}`);
  lines.push(`- Concrete anchor to reference: ${plan.concreteAnchor}`);
  lines.push(`- Observed issue: ${plan.observed_issue}`);
  lines.push(`- Evidence: ${plan.issueEvidence}`);
  lines.push(`- Preferred observation framing: ${plan.observationHint}`);
  lines.push(`- Preferred soft consequence: ${plan.consequenceHint}`);
  lines.push(`- Preferred CTA: ${plan.ctaHint}`);
  lines.push(`- Use softened language: ${plan.softened ? "yes" : "no"}`);

  return lines.join("\n");
}

function buildFollowUpContext(
  lead: LeadRecord,
  enrichment: EnrichmentResult,
  senderName: string,
  previousEmail: FollowUpSourceEmail,
  stepType: OutreachSequenceStepType = "FOLLOW_UP_1",
): string {
  const lines: string[] = [];
  const plan = chooseColdEmailPlan(lead, enrichment);

  lines.push(`SENDER: ${senderName} from Axiom Web`);
  lines.push(`RECIPIENT BUSINESS: ${lead.businessName}`);
  if (lead.contactName) lines.push(`RECIPIENT CONTACT NAME: ${lead.contactName}`);
  lines.push(`RECIPIENT EMAIL: ${lead.email}`);
  lines.push(`RECIPIENT CITY: ${lead.city}`);
  lines.push(`RECIPIENT NICHE: ${lead.niche}`);
  if (lead.emailType) lines.push(`RECIPIENT EMAIL TYPE: ${lead.emailType}`);
  if (lead.emailConfidence != null) lines.push(`RECIPIENT EMAIL CONFIDENCE: ${lead.emailConfidence}`);
  if (lead.websiteGrade) lines.push(`WEBSITE GRADE: ${lead.websiteGrade}`);
  lines.push(`WEBSITE STATUS: ${lead.websiteStatus || "UNKNOWN"}`);
  if (lead.rating != null) lines.push(`GOOGLE RATING: ${lead.rating}`);
  if (lead.reviewCount != null) lines.push(`REVIEW COUNT: ${lead.reviewCount}`);
  if (lead.axiomScore != null) lines.push(`AXIOM SCORE: ${lead.axiomScore}`);
  if (lead.axiomTier) lines.push(`AXIOM TIER: ${lead.axiomTier}`);
  if (lead.callOpener) lines.push(`CALL OPENER CANDIDATE: ${lead.callOpener}`);
  if (lead.followUpQuestion) lines.push(`FOLLOW-UP QUESTION CANDIDATE: ${lead.followUpQuestion}`);
  if (lead.tacticalNote) lines.push(`TACTICAL NOTE: ${lead.tacticalNote}`);
  lines.push("");
  lines.push(buildWebsiteAssessmentContext(lead));
  lines.push("");
  lines.push(buildPainSignalContext(lead));
  lines.push("");
  lines.push("CURRENT FOLLOW-UP ANGLE:");
  lines.push(`- Concrete anchor to use now: ${plan.concreteAnchor}`);
  lines.push(`- Current observed issue: ${plan.observed_issue}`);
  lines.push(`- Current evidence: ${plan.issueEvidence}`);
  lines.push(`- Preferred observation framing: ${plan.observationHint}`);
  lines.push(`- Preferred CTA: ${plan.ctaHint}`);
  lines.push("");
  lines.push(`PREVIOUS EMAIL SUBJECT: ${previousEmail.subject}`);
  lines.push(`PREVIOUS EMAIL SENT AT: ${new Date(previousEmail.sentAt).toISOString()}`);
  lines.push("PRIOR BODY OMITTED: Use the current lead intelligence above. Do not continue stale or generic points from older sent copy.");
  lines.push(`FOLLOW-UP STEP: ${stepType}`);
  lines.push(``);
  lines.push(`=== ENRICHMENT INTELLIGENCE ===`);
  lines.push(`VALUE PROPOSITION: ${enrichment.valueProposition}`);
  lines.push(`PITCH ANGLE: ${enrichment.pitchAngle}`);
  lines.push(`KEY PAIN POINT: ${enrichment.keyPainPoint}`);
  lines.push(`COMPETITIVE EDGE: ${enrichment.competitiveEdge}`);
  lines.push(`PERSONALIZED HOOK: ${enrichment.personalizedHook}`);
  lines.push(`RECOMMENDED CTA: ${enrichment.recommendedCTA}`);
  lines.push(`EMAIL TONE: ${enrichment.emailTone}`);

  return lines.join("\n");
}

export function buildFollowUpContextForTesting(
  lead: LeadRecord,
  enrichment: EnrichmentResult,
  senderName: string,
  previousEmail: FollowUpSourceEmail,
  stepType: OutreachSequenceStepType = "FOLLOW_UP_1",
) {
  return buildFollowUpContext(lead, enrichment, senderName, previousEmail, stepType);
}

const COLD_EMAIL_SYSTEM_PROMPT = `You write cold emails for Axiom Web, a small studio that builds and rebuilds websites for local service businesses so they get more quote requests. Your only job is to earn a reply.

These emails go to owners and managers on their phones. They take 2 seconds to judge. You have ONE shot to sound like a real human peer who works with their type of business, NOT an auditor pretending to have inspected their site.

ABSOLUTE TRUTHFULNESS RULES — violating any of these gets the email rejected:
- You have NOT visited their website. You have NOT looked at their page, layout, contact form, navigation, hero section, mobile experience, load speed, fold, hierarchy, or anything else specific to their site.
- NEVER write phrases like: "I was looking at your site", "I noticed on your page", "your contact path", "buried far down the page", "site loads slow", "first load", "above the fold", "your hero", "your navigation". Even softeners like "looks like" or "from a visitor's eye" do NOT make a fabricated site claim acceptable.
- You CAN reference: their business name, their city, their niche, their Google review count if provided, their listed services if provided, their contact name if provided.
- You CAN reference: a pattern you see in their industry generally ("most {niche} sites in {city} lose quote requests when the phone number isn't in the header").
- You CAN reference: the enrichment block's PERSONALIZED HOOK and KEY PAIN POINT verbatim or paraphrased, because those were generated from real signals about this business.

HARD RULES — violating any of these kills the conversion:
1. LENGTH: 55-80 words total (counting body only, not greeting/signoff). Shorter wins on mobile.
2. SUBJECT: 3-6 words, sentence case (capitalize the first word and proper nouns only — not Title Case, not all-lowercase), zero salesy language. Lean toward specific + curious. Strong patterns: "Quick Q on {Business}", "{firstName}, one thought on {Business}", "{City} {niche} site idea", "Noticed something on {Business}", "One tweak for {Business}". Never all-lowercase, never SHOUTY CASE, never: "Exclusive Opportunity", "Unlock Your Potential", "Grow {Business} 10x", and never generic patterns like "Quick site thought" or "Question about the site".
3. GREETING: Always use the recipient's first name when provided ("Hey {firstName},"). Only fall back to "Hey there," if no name is available. The first name itself is the single biggest reply-rate lever.
4. OPENING LINE (after greeting): Concrete anchor referencing niche + city + business name. Examples: "I work with {niche} businesses in {city} and {Business} caught my eye.", "Came across {Business} while looking through {niche} operators in {city}." NEVER claim to have visited the site.
5. ONE OBSERVATION: REQUIRED — anchor on the enrichment's PERSONALIZED HOOK or KEY PAIN POINT (those were generated from real public signals about this business, not fabricated). Paraphrase naturally — do not quote it verbatim if it reads stiff. Frame as a pattern across SIMILAR businesses, NOT a specific finding about their site. If both hook and pain point are weak or generic, fall back to an industry pattern relevant to the niche ("Most {niche} owners I talk to in {city} say their biggest leak is X."). NEVER write "in electrician," or "in drywall," — single-word niches must be followed by "businesses" or "owners" or "operators". Soften with "from what I see most", "a lot of {niche} owners are dealing with", "the common pattern is".
6. ONE CTA: A single low-friction question that's easy to answer YES to in two seconds. Strong patterns:
   - "Want me to send the 2 or 3 things I'd change?"
   - "Want a free 1-page audit?"
   - "Open to me sharing what I'd tweak?"
   - "How many quote requests are you getting from the site each week right now?" (when the niche is service-heavy and an open-ended question lands well)
   Match the recommended CTA from enrichment when it is concrete. NEVER use: "schedule a call", "book a demo", "hop on a call", "let's connect".
7. OPTIONAL PS LINE: You MAY add a single PS line (max 18 words) when it adds something specific. Use it for a low-friction follow-up question or a tiny piece of context (e.g., "PS — happy to send a 2-min Loom instead if that's easier.", "PS — no pitch, just curious if you've already tried fixing this."). Skip PS if it would feel forced.
8. SIGNOFF: "Best,
{First Name}" or "Thanks,
{First Name}" — nothing else. No title, no company name after the signature. The PS line goes BELOW the signoff if used.
9. BANNED PHRASES (never use, even paraphrased): "hope this finds you well", "my name is", "we specialize in", "I help businesses like yours", "would love to", "circle back", "touch base", "unlock growth", "digital transformation", "boost revenue", "online presence", "scale your business", "award-winning", "stellar reputation", "glowing reviews", "high-converting", "best-in-class", "schedule a quick 10-minute call", "hop on a call", "while looking at a few sites tonight", "had a quick look at", "spent a minute on", "your page", "your hero", "your nav", "your contact path".
10. NO exclamation marks. NO em dashes (—). NO bold. NO HTML. Plain text only.
11. NO generic compliments ("you have a great business", "stellar reputation"). If you compliment, anchor it in given data: "X years in {city}", "{N} Google reviews", "you focus on {service}".
12. GOOGLE REVIEWS: Do NOT open with reviews/rating/stars. Only reference reviews if the count is genuinely impressive (>= 25) AND not in the first sentence.
13. CONVERSION INTENT: Tie the value to a tangible business outcome (more quote requests, fewer dropped bookings, faster reply times) — never agency platitudes like "improve your online presence".
14. TONE: Match the enrichment block's emailTone field when it is set ("casual" = chatty + first-name + contractions, "professional" = composed + complete sentences + no contractions, "urgent" = direct + short sentences + no fluff). If unset, default to casual.
15. IF the lead is a NON-CUSTOMER entity (government, regulator, authority, commission, ministry, agency, nonprofit, association, foundation, institute, council, board, chamber of commerce), STOP and return {"subject":"","body":"","skip_reason":"non-customer entity"}. Do not write copy for them.

STRUCTURE that converts (follow this exactly):
  Line 1 — "Hey {first name}," (always use first name when available).
  Line 2 — concrete anchor referencing niche + city + business name. No site claims.
  Line 3 — ONE observation drawn from the enrichment PERSONALIZED HOOK or KEY PAIN POINT, paraphrased into a natural industry-pattern statement.
  Line 4 — the single low-friction question CTA.
  Line 5 — "Best,
{first name of sender}"
  Optional Line 6 — "PS — {one short specific line, max 18 words}." (only when it genuinely adds something)

Return JSON only:
{
  "subject": "3-6 word sentence-case subject (capitalize first word and proper nouns only)",
  "body": "plain-text body, no greetings template, exactly the 4-6 lines described",
  "personalization_reason": "one sentence on why this email will resonate with this specific lead",
  "observed_issue": "the single issue referenced",
  "CTA_type": "observation_offer | permission_offer | soft_call",
  "confidence_score": 0
}`;

const FOLLOW_UP_SYSTEM_PROMPT = `You are writing a short plain-text follow-up email on behalf of Axiom Web.

STRICT RULES:
1. Follow-up only. Acknowledge the prior note in one natural phrase.
2. Keep FOLLOW_UP_1 under 65 words and FOLLOW_UP_2/FOLLOW_UP_3 under 55 words.
3. Plain text only. No HTML, markdown, bullets, footer, title, or company name in the body.
4. End with exactly "Best,\\n{sender first name}". Nothing after it.
5. Add one fresh useful angle, but do not repeat the same critique verbatim.
6. Keep the CTA low-friction and easy to answer.
7. Do NOT use placeholders.
8. Do NOT use "broken", "costing you leads", "one last time", "last note", "circle back", or "touch base".
9. No exclamation marks. No em dashes.
10. Prefer a natural reply-style subject in sentence case (capitalize first word and proper nouns only — not Title Case, not all-lowercase). "Re:" is allowed when it fits.

Respond with a JSON object:
{
  "subject": "short sentence-case subject line",
  "bodyPlain": "plain text follow-up"
}`;

function toSentenceCase(value: string) {
  const lower = value.toLowerCase();
  // Capitalize the first alphabetic character only — preserves domain names,
  // hyphenated tokens, and avoids Title Case which reads spammy.
  return lower.replace(/^(\W*)([a-z])/, (_match, lead, first) => `${lead}${first.toUpperCase()}`);
}

function sanitizeSubject(subject: string, businessName: string) {
  const trimmed = subject
    .replace(/[!]/g, "")
    .replace(/[—–]/g, "-")
    .replace(/\s+/g, " ")
    .trim();

  if (trimmed.length > 0) {
    const shortSubject = trimmed.split(/\s+/).filter(Boolean).slice(0, 8).join(" ");
    const normalizedSubject = shortSubject.toLowerCase().startsWith("re:")
      ? `Re: ${toSentenceCase(shortSubject.replace(/^re:\s*/i, ""))}`
      : toSentenceCase(shortSubject);
    return normalizedSubject.slice(0, 78);
  }

  return toSentenceCase(`quick thought on ${businessName}`).slice(0, 78);
}

function stripHtmlTags(value: string) {
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/div>/gi, "\n\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeColdEmailDraft(
  draft: RawGeneratedColdEmail,
  plan: ColdEmailPlan,
  businessName: string,
): ColdEmailDraft {
  return {
    subject: sanitizeSubject(draft.subject || "", businessName),
    body: (draft.body || "").replace(/\r/g, "").trim(),
    personalization_reason: (draft.personalization_reason || plan.personalization_reason).trim(),
    observed_issue: (draft.observed_issue || plan.observed_issue).trim(),
    CTA_type: plan.CTA_type,
    confidence_score: Math.max(0, Math.min(100, Math.round(Number(draft.confidence_score || plan.confidence_score)))),
  };
}

async function generateColdEmailAttempt(
  context: string,
  plan: ColdEmailPlan,
  retryInstructions?: string,
): Promise<RawGeneratedColdEmail> {
  const userPrompt = [
    "Generate one cold email using the selected strategy and context below.",
    "The email must feel human, specific, low-friction, and reply-worthy.",
    "Ground every line in the PAIN SIGNALS, WEBSITE ASSESSMENT, and ENRICHMENT INTELLIGENCE below — reference a real signal that someone could only know by looking at this specific business. Do not generalize, do not paraphrase into vague advice, and do not echo the strategy or rules back at the reader.",
    "",
    context,
    "",
    "Additional rules:",
    `- Keep CTA type as ${plan.CTA_type}.`,
    `- Strategy is ${plan.strategy}.`,
    `- Use this concrete anchor somewhere naturally: ${plan.concreteAnchor}.`,
    `- Observed issue to anchor around: ${plan.observed_issue}.`,
    `- If evidence is limited, stay curiosity-based and ask permission to send ideas.`,
    "- Do not over-compliment the business.",
    "- Every sentence must be a complete thought ending in a period or question mark. Never trail off after a verb like \"noticed\" or \"saw\".",
    "- The opening observation must reference at least one concrete detail from the PAIN SIGNALS or WEBSITE ASSESSMENT (a specific page, contact path, missing element, review pattern, or domain), not a generic statement.",
    "- Do not write the email as if you are following a template — vary phrasing, do not start with \"I had a quick look\" or \"I looked through\" if those exact phrases appear in the personalized hook.",
    retryInstructions ? `\n${retryInstructions}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return chatCompletionJson<RawGeneratedColdEmail>({
    systemPrompt: COLD_EMAIL_SYSTEM_PROMPT,
    userPrompt,
    temperature: retryInstructions ? 0.28 : 0.4,
    maxTokens: 1100,
  });
}

function finalizeColdEmail(
  draft: ColdEmailDraft,
  senderName: string,
): GeneratedEmail {
  const bodyPlain = buildPlainTextEmail(draft.body, firstName(senderName));
  const bodyHtml = buildHtmlEmail(bodyPlain);

  return {
    subject: draft.subject,
    bodyPlain,
    bodyHtml,
    personalization_reason: draft.personalization_reason,
    observed_issue: draft.observed_issue,
    CTA_type: draft.CTA_type,
    confidence_score: draft.confidence_score,
  };
}

function finalizeGeneratedEmail(
  draft: GeneratedEmail,
  senderName: string,
  businessName: string,
): GeneratedEmail {
  const bodySource = draft.bodyPlain || stripHtmlTags(draft.bodyHtml || "");
  const bodyPlain = buildPlainTextEmail(bodySource, firstName(senderName));

  return {
    subject: sanitizeSubject(draft.subject || "", businessName),
    bodyPlain,
    bodyHtml: buildHtmlEmail(bodyPlain),
    personalization_reason: (draft.personalization_reason || "").trim(),
    observed_issue: (draft.observed_issue || "").trim(),
    CTA_type: draft.CTA_type || "follow_up",
    confidence_score: Math.max(0, Math.min(100, Math.round(Number(draft.confidence_score || 0)))),
  };
}

function stableHashFromLeadId(value: string | number | null | undefined) {
  const source = String(value ?? "");
  let hash = 0;
  for (let i = 0; i < source.length; i++) {
    hash = (hash * 31 + source.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function rotateFallbackSubject(lead: LeadRecord): string {
  const businessName = lead.businessName;
  const city = lead.city?.trim() || "";
  const niche = lead.niche?.trim() || "";
  const recipientFirst = lead.contactName?.trim().split(/\s+/)[0] || "";
  // Skewed toward specific + curious subjects. Removed generic patterns
  // ("Quick site thought", "Question about the site", "Small site note") that
  // tested as bland and indistinguishable from spam.
  const pool: string[] = [
    recipientFirst ? `${recipientFirst}, one thought on ${businessName}` : `One thought on ${businessName}`,
    `Noticed something on ${businessName}`,
    `One tweak for ${businessName}`,
    city && niche ? `${city} ${niche} idea` : "",
    `Idea for ${businessName}`,
    `${businessName} — one thing`,
    `Two minutes for ${businessName}?`,
    recipientFirst ? `${recipientFirst}, quick question` : "",
    niche ? `${niche} site question` : "",
  ].filter(Boolean);
  if (pool.length === 0) return `One thought on ${businessName}`;
  const index = stableHashFromLeadId(lead.id) % pool.length;
  return pool[index];
}

function cleanEmailLine(value: string, fallback: string, maxLength = 180) {
  const cleaned = (value || fallback)
    .replace(/[!]/g, ".")
    .replace(/[—–]/g, ",")
    .replace(/\s+/g, " ")
    .trim();
  return (cleaned || fallback).slice(0, maxLength).trim();
}

function extractLeadDomain(lead: LeadRecord): string {
  const raw = lead.websiteUrl || "";
  return raw.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0] || "";
}

function servicePhraseForCopy(value: string | null | undefined) {
  const niche = (value || "").trim().toLowerCase();
  if (!niche) return "local service companies";
  if (niche.includes("electric")) return "electricians";
  if (niche.includes("plumb")) return "plumbing companies";
  if (niche.includes("roof")) return "roofing companies";
  if (niche.includes("tree")) return "tree service companies";
  if (niche.includes("mason")) return "masonry contractors";
  if (niche.includes("drywall")) return "drywall contractors";
  if (niche.includes("fenc")) return "fencing contractors";
  if (niche.includes("pressure")) return "pressure washing companies";
  if (niche.includes("junk")) return "junk removal companies";
  if (niche.includes("snow")) return "snow removal companies";
  if (/\b(companies|contractors|services|shops|clinics|firms)\b/.test(niche)) return niche;
  return `${niche} companies`;
}

function buildPlanBasedInitialEmail(
  lead: LeadRecord,
  plan: ColdEmailPlan,
  senderName: string,
): GeneratedEmail {
  const senderFirst = firstName(senderName);
  const recipientFirst = lead.contactName?.trim().split(/\s+/)[0] || null;
  const greeting = recipientFirst ? `Hey ${recipientFirst},` : "Hi,";

  const domain = extractLeadDomain(lead);
  const city = lead.city?.trim() || "";
  const niche = lead.niche?.trim() || "";
  
  const niceNiche = servicePhraseForCopy(niche);
  const nicheCity = niceNiche && city
    ? `${niceNiche} in ${city}`
    : niceNiche || (city ? `local businesses in ${city}` : "");

  // --- Opening line: prove you looked at their specific business ---
  const openerSeed = stableHashFromLeadId(lead.id);
  let openingLine: string;
  if (lead.websiteStatus === "MISSING") {
    openingLine = nicheCity
      ? [
          `I was searching for ${nicheCity} and couldn't find a clear website for ${lead.businessName}.`,
          `Looked up ${nicheCity} options and ${lead.businessName} didn't have a clear site to land on.`,
          `Searching for ${nicheCity} didn't turn up a proper website for ${lead.businessName}.`,
          `Tried to look up ${lead.businessName} online after seeing the Google listing for ${nicheCity}.`,
          `Found ${lead.businessName} in some ${nicheCity} results but no website came up.`,
          `Your Google listing for ${nicheCity} looks solid, but I couldn't find a website behind it.`,
        ][openerSeed % 6]
      : `I came across ${lead.businessName} and couldn't find a proper website for the business.`;
  } else if (plan.strategy === "observation_based") {
    if (nicheCity && domain) {
      openingLine = [
        `I work with ${nicheCity} and ${lead.businessName} came up while I was scanning the area.`,
        `Came across ${lead.businessName} while looking through ${nicheCity}.`,
        `Saw ${lead.businessName} in some ${nicheCity} listings and wanted to reach out.`,
        `Was scanning ${nicheCity} businesses and ${lead.businessName} stood out.`,
        `Noticed ${lead.businessName} while researching ${nicheCity} operators.`,
        `${lead.businessName} popped up in some ${nicheCity} results.`,
        `Was going through ${nicheCity} businesses and your name came up.`,
        `Spotted ${lead.businessName} on the ${nicheCity} list.`,
      ][openerSeed % 8];
    } else if (domain) {
      openingLine = [
        `${lead.businessName} caught my eye while I was scanning ${niche || "the category"} in the area.`,
        `Wanted to reach out about ${lead.businessName} directly.`,
        `Noticed ${lead.businessName} while researching ${niche || "operators"} nearby.`,
        `Saw ${lead.businessName} on a list of ${niche || "businesses"} worth looking at.`,
        `${lead.businessName} came up while I was going through the area.`,
        `Came across ${lead.businessName} and wanted to share a quick thought.`,
      ][openerSeed % 6];
    } else {
      openingLine = [
        `I came across ${lead.businessName} in ${city || "your area"} and had one quick thought.`,
        `Found ${lead.businessName} while looking at businesses in ${city || "your area"}.`,
        `Was browsing ${city || "local"} businesses and noticed ${lead.businessName}.`,
      ][openerSeed % 3];
    }
  } else {
    if (domain && nicheCity) {
      openingLine = [
        `I came across ${lead.businessName} while looking at ${nicheCity}.`,
        `Ran into ${lead.businessName} while researching ${nicheCity} operators.`,
        `Saw ${lead.businessName} on a ${nicheCity} list and wanted to reach out.`,
        `Found ${lead.businessName} in some ${nicheCity} results.`,
        `Your business came up while I was scanning ${nicheCity}.`,
        `Was researching ${nicheCity} and ${lead.businessName} stood out.`,
        `Came across ${lead.businessName} on the ${nicheCity} side.`,
      ][openerSeed % 7];
    } else if (domain) {
      openingLine = [
        `Came across ${lead.businessName} while researching ${niche || 'local businesses'} in ${city || 'the area'}.`,
        `Wanted to reach out about ${lead.businessName} directly.`,
        `Noticed ${lead.businessName} while researching ${niche || "operators"} nearby.`,
        `Saw ${lead.businessName} on a list of ${niche || "businesses"} worth looking at.`,
        `${lead.businessName} came up while I was going through the area.`,
        `Came across ${lead.businessName} and wanted to share a quick thought.`,
      ][openerSeed % 6];
    } else {
      openingLine = [
        `I came across ${lead.businessName} in ${city || "your area"} and had one quick thought.`,
        `Found ${lead.businessName} while looking at businesses in ${city || "your area"}.`,
      ][openerSeed % 2];
    }
  }

  // --- Observation: the specific issue for this lead ---
  const observationLine = cleanEmailLine(
    plan.observationHint,
    lead.websiteStatus === "MISSING"
      ? "That can make it harder for a new customer to know where to reach out."
      : "The site may be making it harder than it needs to for someone to take the next step.",
  );

  // --- Consequence: why it matters (short, only when it adds something) ---
  const rawConsequence = (plan.consequenceHint || "").trim();
  const consequenceLine = rawConsequence.length > 10 && rawConsequence !== observationLine
    ? cleanEmailLine(rawConsequence, "")
    : "";

  // --- CTA: low-friction question, rotated across leads ---
  // Question-form CTAs convert better than statements because they're
  // answerable in two seconds and feel like a real conversation, not a pitch.
  const ctaLine =
    plan.CTA_type === "soft_call"
      ? [
          "Open to a quick 5-minute look?",
          "Want me to walk you through it on a quick call?",
          "Worth a 5-minute look together?",
        ][openerSeed % 3]
      : [
          "Want me to send the 2 or 3 things I'd change?",
          "Want a free 1-page audit?",
          "Open to me sharing what I'd tweak?",
          "Want the specific ideas in your inbox?",
          "Should I send a short list of what I'd fix?",
          "Want me to send a 2-min Loom showing the fix?",
          "Worth me sending the 3 things that stood out?",
        ][openerSeed % 7];

  // --- Positive line: one specific, earned compliment ---
  const reviewCount = Number(lead.reviewCount || 0);
  const rating = Number(lead.rating || 0);
  let positiveLine = "";
  if (reviewCount >= 10 && rating >= 4.0) {
    positiveLine = [
      `${reviewCount} reviews at ${rating} stars says a lot about the work.`,
      `Clearly doing strong work with ${reviewCount} reviews.`,
      `Building a reputation like that takes real work.`,
    ][openerSeed % 3];
  } else if (niche && niche.length > 2) {
    positiveLine = [
      `Looks like you've built a solid ${niche.toLowerCase()} operation.`,
      `The ${niche.toLowerCase()} focus comes through clearly.`,
    ][openerSeed % 2];
  }

  const bodyParts = [greeting, "", openingLine];
  if (positiveLine) bodyParts.push(positiveLine);
  bodyParts.push(observationLine);
  if (consequenceLine) bodyParts.push(consequenceLine);
  bodyParts.push(ctaLine);

  const bodyPlain = buildPlainTextEmail(bodyParts.join("\n"), senderFirst);

  return {
    subject: sanitizeSubject(rotateFallbackSubject(lead), lead.businessName),
    bodyPlain,
    bodyHtml: buildHtmlEmail(bodyPlain),
    personalization_reason: plan.personalization_reason,
    observed_issue: plan.observed_issue,
    CTA_type: plan.CTA_type,
    confidence_score: Math.max(62, plan.confidence_score),
  };
}

function buildFallbackFollowUpEmail(
  lead: LeadRecord,
  enrichment: EnrichmentResult,
  senderName: string,
  stepType: OutreachSequenceStepType,
): GeneratedEmail {
  const senderFirst = firstName(senderName);
  const recipientFirst = lead.contactName?.trim().split(/\s+/)[0] || null;
  const domain = extractLeadDomain(lead);

  // Use plan so the observation is pain-signal-specific, not generic
  const plan = chooseColdEmailPlan(lead, enrichment);

  // Opening line references the specific domain so the follow-up feels anchored
  const intro =
    stepType === "FOLLOW_UP_3"
      ? "One last thought before I leave this one alone."
      : stepType === "FOLLOW_UP_2"
        ? `Wanted to add one more thought on ${domain || lead.businessName}.`
        : `Just wanted to follow up on my note about ${domain || lead.businessName}.`;

  // Keep the observation short and specific
  const observationLine = cleanEmailLine(
    plan.observationHint,
    enrichment.keyPainPoint || "The site may still be leaving some easy contact opportunities on the table.",
  );

  const ctaLine =
    stepType === "FOLLOW_UP_3"
      ? "Happy to send the specific things I'd fix if that's useful."
      : plan.CTA_type === "soft_call"
        ? "Open to a quick look if it helps."
        : "Worth me sending over what I'd change?";

  const greeting = recipientFirst ? `Hi ${recipientFirst},` : "Hi,";
  const bodyPlain = buildPlainTextEmail(
    [greeting, "", intro, observationLine, ctaLine].join("\n"),
    senderFirst,
  );

  const followUp1Pool = [
    "One site thought",
    "Following up",
    "One more thought",
    `Thought on ${domain || lead.businessName}`,
    "Quick follow-up",
  ];
  const followUp2Pool = [
    "Quick site thought",
    "One more idea",
    `Still thinking about ${domain || lead.businessName}`,
    "Circling back on this",
  ];
  const followUp3Pool = [
    "Last site thought",
    "Final thought on this",
    "One last idea",
  ];
  const seed = stableHashFromLeadId(lead.id);
  const subjectMap: Record<OutreachSequenceStepType, string> = {
    INITIAL: rotateFallbackSubject(lead),
    FOLLOW_UP_1: followUp1Pool[seed % followUp1Pool.length],
    FOLLOW_UP_2: followUp2Pool[seed % followUp2Pool.length],
    FOLLOW_UP_3: followUp3Pool[seed % followUp3Pool.length],
  };

  return {
    subject: sanitizeSubject(subjectMap[stepType] || "One site thought", lead.businessName),
    bodyPlain,
    bodyHtml: buildHtmlEmail(bodyPlain),
    personalization_reason: plan.personalization_reason,
    observed_issue: plan.observed_issue,
    CTA_type: plan.CTA_type,
    confidence_score: 45,
  };
}

/**
 * Generate a personalized email for a single lead.
 */
export async function generateEmail(
  lead: LeadRecord,
  enrichment: EnrichmentResult,
  senderName: string,
): Promise<GeneratedEmail> {
  // Compute plan outside the try block so it is available in the catch fallback.
  const plan = chooseColdEmailPlan(lead, enrichment);

  try {
    const context = buildGenerationContext(lead, enrichment, senderName, plan);

    const firstDraft = normalizeColdEmailDraft(
      await generateColdEmailAttempt(context, plan),
      plan,
      lead.businessName,
    );
    const firstValidation = validateColdEmailDraft(firstDraft, lead, plan);
    if (firstValidation.valid) {
      return finalizeColdEmail(firstDraft, senderName);
    }

    const retryDraft = normalizeColdEmailDraft(
      await generateColdEmailAttempt(context, plan, buildRetryInstructions(firstValidation, plan)),
      plan,
      lead.businessName,
    );
    const retryValidation = validateColdEmailDraft(retryDraft, lead, plan);
    const finalDraft =
      retryValidation.valid || retryValidation.score >= firstValidation.score
        ? retryDraft
        : firstDraft;
    const finalValidation = retryValidation.valid || retryValidation.score >= firstValidation.score
      ? retryValidation
      : firstValidation;
    if (!finalValidation.valid) {
      return buildPlanBasedInitialEmail(lead, plan, senderName);
    }
    return finalizeColdEmail(finalDraft, senderName);
  } catch (error) {
    // DeepSeek unavailable or API key not configured — fall back to the
    // plan-based template which uses niche/city/domain for a specific opener
    // and the per-lead observationHint/consequenceHint from pain signals.
    console.warn(`[outreach-email-generator] LLM generation failed for lead ${lead.id}, using plan-based fallback:`, error);
    return buildPlanBasedInitialEmail(lead, plan, senderName);
  }
}

export async function generateFollowUpEmail(
  lead: LeadRecord,
  enrichment: EnrichmentResult,
  senderName: string,
  previousEmail: FollowUpSourceEmail,
  stepType: OutreachSequenceStepType = "FOLLOW_UP_1",
): Promise<GeneratedEmail> {
  try {
    const context = buildFollowUpContext(lead, enrichment, senderName, previousEmail, stepType);

    const draft = await chatCompletionJson<GeneratedEmail>({
      systemPrompt: FOLLOW_UP_SYSTEM_PROMPT,
      userPrompt: `Generate a personalized follow-up email using this context:\n\n${context}`,
      temperature: 0.35,
      maxTokens: 900,
    });
    return finalizeGeneratedEmail(draft, senderName, lead.businessName);
  } catch (error) {
    console.warn(`[outreach-email-generator] Falling back to follow-up template for ${lead.id}:`, error);
    return buildFallbackFollowUpEmail(lead, enrichment, senderName, stepType);
  }
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
    throw new Error(`Previous email context is required for ${stepType}`);
  }

  return generateFollowUpEmail(lead, enrichment, senderName, previousEmail, stepType);
}

export function buildInitialEmailForTesting(
  lead: LeadRecord,
  enrichment: EnrichmentResult,
  senderName: string,
): GeneratedEmail {
  const plan = chooseColdEmailPlan(lead, enrichment);
  return buildPlanBasedInitialEmail(lead, plan, senderName);
}
