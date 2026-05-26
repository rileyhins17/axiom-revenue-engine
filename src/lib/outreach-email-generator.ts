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
  // Trimmed context. Previous version sent ~30 fields plus strategy hints
  // and observation/consequence/CTA hints — the model got overloaded and
  // started stitching pieces awkwardly. Now we send only the fields the
  // model actually needs to write a good email.
  const lines: string[] = [];

  lines.push(`SENDER FIRST NAME: ${firstName(senderName)}`);
  lines.push(`BUSINESS: ${lead.businessName}`);
  lines.push(`CITY: ${lead.city || "unknown"}`);
  lines.push(`NICHE: ${lead.niche || "service business"}`);
  if (lead.contactName) lines.push(`RECIPIENT FIRST NAME: ${lead.contactName.trim().split(/\s+/)[0]}`);
  if (lead.websiteUrl) lines.push(`WEBSITE: ${lead.websiteUrl}`);
  if (Number(lead.reviewCount || 0) > 0 && Number(lead.reviewCount || 0) <= 1000) {
    lines.push(`GOOGLE REVIEWS: ${lead.reviewCount} at ${lead.rating ?? "?"} stars`);
  }
  lines.push("");
  lines.push(buildWebsiteAssessmentContext(lead));
  lines.push("");
  lines.push("ENRICHMENT (from real public data):");
  lines.push(`- Key pain point: ${enrichment.keyPainPoint}`);
  lines.push(`- Personalized hook: ${enrichment.personalizedHook}`);
  lines.push(`- Recommended CTA: ${enrichment.recommendedCTA}`);
  lines.push(`- Tone: ${enrichment.emailTone}`);
  lines.push("");
  lines.push(`CTA TYPE TO USE: ${plan.CTA_type}`);

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

const COLD_EMAIL_SYSTEM_PROMPT = `You write short cold emails for Axiom Web, a studio that builds and rebuilds websites for local service businesses. Goal: earn a reply.

DATA YOU HAVE — TREAT AS GROUND TRUTH:
- Our scraper visited their site and produced the WEBSITE ASSESSMENT block (speedRisk, conversionRisk, trustRisk, seoRisk, topFixes). Reference it specifically when it has signal — that's the point of having it. Example: if topFixes says "no visible phone on mobile hero", you can write "the phone isn't easy to find on mobile" because that came from a real scan.
- ENRICHMENT INTELLIGENCE block (keyPainPoint, personalizedHook) is also from real public data about this business.
- BUSINESS / CITY / NICHE / CONTACT NAME / REVIEW COUNT / RATING / WEBSITE URL — all real.

DO NOT INVENT beyond what's in the data. If the assessment is empty or generic, fall back to an industry-pattern observation instead of making up a site detail.

OUTPUT STRUCTURE (6 lines max):
  Line 1: "Hey {firstName}," (or "Hey there," only if no name)
  Line 2: One concrete opener referencing business name + city + niche.
  Line 3: One observation — either a specific finding from the WEBSITE ASSESSMENT topFixes OR a sharp industry pattern. Frame as something a peer who works with similar businesses would notice. Plain language, not jargon.
  Line 4: One low-friction question CTA. Strong patterns:
    - "Want me to send the 2 or 3 things I'd change?"
    - "Want a free 1-page audit?"
    - "Open to me sharing what I'd tweak?"
  Line 5: "Best,\n{senderFirstName}"
  Line 6 (optional): "PS — {one short specific line}" if it adds something concrete.

LENGTH: 55-80 words body. Mobile-readable.

SUBJECT: 3-6 words. Sentence case (first word + proper nouns capitalized). Strong patterns: "Quick Q on {Business}", "{firstName}, one thought on {Business}", "Noticed something on {Business}", "One tweak for {Business}". NEVER all-lowercase, NEVER Title Case, NEVER salesy ("Exclusive Opportunity"), NEVER generic ("Quick site thought", "Question about the site").

GRAMMAR CHECKS (these slip often, double-check):
- Subject-verb agreement: "11 reviews say a lot" (NOT "says"). "Most plumbing businesses get more calls" (NOT "Most plumbing get").
- Niche noun stacking: if the niche field already contains a noun ("plumbing companies", "roofers", "med-spas"), use it AS-IS — never "plumbing companies businesses" or "roofers operators". If niche is bare ("plumbing", "roofing"), add "businesses" / "owners" only when grammar needs it.

HARD BANS:
- "hope this finds you well", "my name is", "we specialize in", "I help businesses like yours", "would love to", "circle back", "touch base", "unlock growth", "digital transformation", "boost revenue", "online presence", "scale your business", "schedule a call", "book a demo", "hop on a call", "let's connect".
- No exclamation marks. No em dashes. No HTML, bold, or markdown. Plain text only.
- NEVER quote exact review counts above 1000 (those are scrape artifacts).

NON-CUSTOMER LEADS: if the business is a government agency, regulator, nonprofit, association, foundation, institute, council, chamber of commerce, or similar non-customer entity, return {"subject":"","body":"","skip_reason":"non-customer entity"}.

TONE: Match emailTone field — "casual" (chatty, contractions), "professional" (composed, no contractions), "urgent" (direct, short). Default casual.

Return JSON only:
{
  "subject": "string",
  "body": "string",
  "personalization_reason": "string",
  "observed_issue": "string",
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

// Restore the original casing of the business name + any other proper nouns
// the LLM/template wrote, after toSentenceCase has lowercased everything.
// Matches case-insensitively so "raptor roofing" gets fixed back to
// "Raptor Roofing" when businessName = "Raptor Roofing".
function preserveProperNouns(subject: string, businessName: string) {
  if (!businessName) return subject;
  const name = businessName.trim();
  if (!name) return subject;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`\\b${escaped}\\b`, "i");
  return subject.replace(pattern, name);
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
    const withProperNouns = preserveProperNouns(normalizedSubject, businessName);
    return withProperNouns.slice(0, 78);
  }

  return preserveProperNouns(toSentenceCase(`quick thought on ${businessName}`), businessName).slice(0, 78);
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
    "Write one cold email using the data below. Follow the system rules.",
    "",
    context,
    "",
    "Reminders for THIS lead:",
    "- If WEBSITE ASSESSMENT topFixes has a specific item, reference it plainly (it came from a real scan).",
    "- If topFixes is empty or generic, use the ENRICHMENT key pain point or fall back to an industry pattern.",
    "- Re-read the GRAMMAR CHECKS before returning JSON.",
    retryInstructions ? `\n${retryInstructions}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return chatCompletionJson<RawGeneratedColdEmail>({
    systemPrompt: COLD_EMAIL_SYSTEM_PROMPT,
    userPrompt,
    // Lower temperature: less creative wandering = fewer subject-verb
    // agreement slips and fewer phrase invention attempts that violate
    // the truthfulness rules.
    temperature: retryInstructions ? 0.18 : 0.25,
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
  // Review counts above 1000 are almost always scraping artifacts (phone
  // number fragments, postal codes, etc.). Cap the displayed count and skip
  // the review-flavored line if the number isn't credible for a local
  // service business.
  const rawReviewCount = Number(lead.reviewCount || 0);
  const reviewCount = Number.isFinite(rawReviewCount) && rawReviewCount > 0 && rawReviewCount <= 1000
    ? rawReviewCount
    : 0;
  const rating = Number(lead.rating || 0);
  const nicheLower = niche.toLowerCase();
  // Single-word niches need a noun ("electrician" -> "electrician operation"
  // reads wrong; "electrical operation" reads worse). Treat the niche as a
  // noun phrase by appending " business" when it's a single word, which
  // resolves "For electrician," / "solid electrician operation" awkwardness.
  const nicheNoun = /\s/.test(nicheLower) ? nicheLower : `${nicheLower} business`;
  let positiveLine = "";
  if (reviewCount >= 10 && rating >= 4.0) {
    positiveLine = [
      `${reviewCount} reviews at ${rating} stars says a lot about the work.`,
      `Clearly doing strong work with ${reviewCount} reviews.`,
      `Building a reputation like that takes real work.`,
    ][openerSeed % 3];
  } else if (niche && niche.length > 2) {
    positiveLine = [
      `Looks like you've built a solid ${nicheNoun} operation.`,
      `The ${nicheLower} focus comes through clearly.`,
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
