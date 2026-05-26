import type { PainSignal, WebsiteAssessment } from "@/lib/axiom-scoring";
import { hasValidPipelineEmail } from "@/lib/lead-qualification";
import type { EnrichmentResult } from "@/lib/outreach-enrichment";
import type { LeadRecord } from "@/lib/prisma";

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
  // Tonal / forced-casual phrases. These read like fake-casual cold-email
  // templates regardless of whether we visited the site. Specific site
  // references like "your contact form" or "your homepage" are now ALLOWED
  // because the scraper actually visits the site and produces a real
  // WebsiteAssessment block the model can cite from.
  "while looking at a few sites tonight",
  "while looking at a few sites",
  "looking at a few sites tonight",
  "had a quick look at",
  "spent a minute on",
  "poking around",
  "i was poking around",
];

const GENERIC_FALLBACK_PATTERNS = [
  "digital presence",
  "custom solutions",
  "industry-leading",
  "cutting-edge",
  "streamline your business",
  "grow your brand",
  "take your business to the next level",
  "improve your online presence",
  "stand out online",
];

const SERVICE_BUSINESS_HINTS = [
  "roof",
  "hvac",
  "plumb",
  "electric",
  "landscap",
  "cleaning",
  "spa",
  "salon",
  "contract",
  "concrete",
  "cabinet",
  "kitchen",
  "renovat",
  "remodel",
  "dent",
  "clinic",
  "physio",
  "chiropr",
  "detail",
  "paint",
  "floor",
  "fence",
  "garage",
  "pest",
  "moving",
  "pool",
  "solar",
  "tree service",
];

export type ColdEmailStrategy = "observation_based" | "curiosity_based" | "soft_call";
export type ColdEmailCtaType = "observation_offer" | "permission_offer" | "soft_call";

export type ColdEmailDraft = {
  subject: string;
  body: string;
  personalization_reason: string;
  observed_issue: string;
  CTA_type: ColdEmailCtaType;
  confidence_score: number;
};

export type ColdEmailPlan = {
  strategy: ColdEmailStrategy;
  CTA_type: ColdEmailCtaType;
  confidence_score: number;
  observed_issue: string;
  personalization_reason: string;
  concreteAnchor: string;
  issueEvidence: string;
  observationHint: string;
  consequenceHint: string;
  ctaHint: string;
  softened: boolean;
  validEmail: boolean;
};

export type ColdEmailValidation = {
  valid: boolean;
  score: number;
  wordCount: number;
  errors: string[];
  checks: {
    specificity: number;
    humanTone: number;
    genericAgencyLanguage: number;
    ctaFriction: number;
    length: number;
  };
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function normalizeText(value: string | null | undefined) {
  return (value || "").trim();
}

function normalizeLower(value: string | null | undefined) {
  return normalizeText(value).toLowerCase();
}

// Hosted-site platforms whose domain should never appear in outreach copy.
// If a lead's websiteUrl is on one of these, treat as no-domain so the email
// falls back to using businessName rather than e.g. "sites.google.com".
const PLATFORM_DOMAINS = new Set([
  "sites.google.com",
  "wix.com",
  "squarespace.com",
  "weebly.com",
  "godaddysites.com",
  "shopify.com",
  "facebook.com",
  "m.facebook.com",
  "instagram.com",
  "linkedin.com",
  "yelp.com",
  "yelp.ca",
  "google.com",
  "businesssite.com",
  "site123.com",
  "carrd.co",
  "linktr.ee",
  "tumblr.com",
  "blogspot.com",
  "wordpress.com",
]);

function extractDomain(value: string | null | undefined) {
  const input = normalizeText(value);
  if (!input) return "";
  let host = "";
  try {
    const url = input.startsWith("http://") || input.startsWith("https://") ? new URL(input) : new URL(`https://${input}`);
    host = url.hostname.replace(/^www\./, "");
  } catch {
    host = input.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0] || "";
  }
  if (PLATFORM_DOMAINS.has(host.toLowerCase())) return "";
  return host;
}

function parseJson<T>(value: string | null | undefined): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function getWebsiteAssessment(lead: LeadRecord) {
  return parseJson<WebsiteAssessment>(lead.axiomWebsiteAssessment);
}

function getPainSignals(lead: LeadRecord) {
  return parseJson<PainSignal[]>(lead.painSignals) || [];
}

function hasModerateOrStrongServiceFit(lead: LeadRecord) {
  const text = `${lead.niche || ""} ${lead.category || ""}`.toLowerCase();
  return SERVICE_BUSINESS_HINTS.some((keyword) => text.includes(keyword));
}

function hasOwnerOperatorStyleContact(lead: LeadRecord) {
  const emailType = normalizeLower(lead.emailType);
  return emailType === "owner" || emailType === "staff" || Boolean(normalizeText(lead.contactName));
}

function getEmailValidity(lead: LeadRecord) {
  return hasValidPipelineEmail({
    email: lead.email,
    emailConfidence: lead.emailConfidence,
    emailType: lead.emailType,
    emailFlags: lead.emailFlags,
  });
}

function getObservationFromAssessment(lead: LeadRecord, assessment: WebsiteAssessment | null) {
  if (lead.websiteStatus === "MISSING") {
    return {
      observedIssue: "No clear website surfaced for the business.",
      observationHint: "I tried to look through the site and could not find a clear website that explains the business cleanly.",
      consequenceHint: "That can make it harder for someone new to understand the work or know where to reach out.",
      evidence: "No website was found during the scrape.",
      strength: 72,
      softened: true,
    };
  }

  if (!assessment) {
    return null;
  }

  const reviewCount = Number(lead.reviewCount || 0);
  const s = Number(lead.id || 0);

  if (assessment.conversionRisk >= 4) {
    return {
      observedIssue: "The contact or quote path looks more complicated than it needs to be.",
      observationHint: [
        "Most {niche} get more calls when the phone number and quote request are obvious on mobile.",
        "For {niche}, the site has one main job: make it easy for a ready buyer to call or ask for a quote.",
        "The best-performing {niche} sites usually make the next step obvious within a few seconds.",
      ][s % 3],
      consequenceHint: [
        "That is usually where ready-to-book visitors decide whether to call or keep searching.",
        "Small clarity changes there can turn more of the same traffic into calls.",
        "A clearer next step helps the good reputation turn into more quote requests.",
      ][s % 3],
      evidence: `Website assessment flagged conversion risk ${assessment.conversionRisk}/10.`,
      strength: 88,
      softened: assessment.conversionRisk < 6,
    };
  }

  if (assessment.trustRisk >= 4 && reviewCount >= 8) {
    return {
      observedIssue: "The website does not fully surface the trust the business has already built.",
      observationHint: [
        "What I see most often with {niche} businesses doing this much volume: the website undersells how established the operation actually is.",
        "A common pattern in {niche}: a new visitor can't tell from the homepage how much work is behind the business.",
        "The pattern with established {niche} businesses is the website doesn't carry the same weight as the actual operation.",
      ][s % 3],
      consequenceHint: [
        "New visitors comparing options need those signals near the top.",
        "People deciding quickly won't dig for that context.",
        "First-time visitors decide fast, so that context matters.",
      ][s % 3],
      evidence: `Trust risk ${assessment.trustRisk}/10 with ${reviewCount} Google reviews.`,
      strength: 84,
      softened: assessment.trustRisk < 6,
    };
  }

  if (assessment.speedRisk >= 7) {
    return {
      observedIssue: "The site feels slower than it needs to on first load.",
      observationHint: [
        "Mobile load times are the most common silent killer for {niche} sites.",
        "Across {niche} sites I review, slow mobile loads are the most common drop-off cause.",
        "Slow mobile loads are the most common reason {niche} sites lose quote requests early.",
      ][s % 3],
      consequenceHint: [
        "Most mobile visitors won't wait more than two seconds.",
        "Slow loads on mobile push people back to search.",
        "That tends to lose visitors before they even see the content.",
      ][s % 3],
      evidence: `Speed risk ${assessment.speedRisk}/10.`,
      strength: 78,
      softened: assessment.speedRisk < 6,
    };
  }

  if (assessment.seoRisk >= 4) {
    return {
      observedIssue: "Important service information feels harder to scan than it should be.",
      observationHint: [
        "Some of the service information feels thinner or harder to scan than it could be.",
        "Key service details are harder to find than they probably need to be.",
        "The service pages are a bit thin on the details people typically look for.",
      ][s % 3],
      consequenceHint: [
        "People searching for specifics won't find what they need to decide.",
        "Visitors tend to need a bit more context before they reach out.",
        "That can make it harder for people to decide quickly whether to contact you.",
      ][s % 3],
      evidence: `SEO/content risk ${assessment.seoRisk}/10.`,
      strength: 74,
      softened: true,
    };
  }

  return null;
}

function getObservationFromPainSignals(lead: LeadRecord, painSignals: PainSignal[]) {
  const strongest = [...painSignals].sort((a, b) => b.severity - a.severity)[0];
  if (!strongest) {
    return null;
  }

  const softened = strongest.severity < 4;
  const s = Number(lead.id || 0);

  switch (strongest.type) {
    case "CONVERSION":
    case "CONTACT":
      return {
        observedIssue: "The contact path may be creating more friction than it should.",
        observationHint: [
          "Most {niche} get more calls when the phone number and quote request are obvious on mobile.",
          "For {niche}, the site has one main job: make it easy for a ready buyer to call or ask for a quote.",
          "The best-performing {niche} sites usually make the next step obvious within a few seconds.",
        ][s % 3],
        consequenceHint: [
          "That is usually where ready-to-book visitors decide whether to call or keep searching.",
          "Small clarity changes there can turn more of the same traffic into calls.",
          "A clearer next step helps the good reputation turn into more quote requests.",
        ][s % 3],
        evidence: strongest.evidence || "Stored pain signals suggest contact or conversion friction.",
        strength: 82,
        softened,
      };
    case "TRUST":
      return {
        observedIssue: "Trust signals feel buried or not surfaced clearly enough.",
        observationHint: [
          "In {niche}, getting reviews and project work above the fold matters more than copy does.",
          "For {niche} businesses, the homepage carries most of the trust weight and is the most common thing under-leveraged.",
          "Established {niche} businesses often look newer online than they actually are.",
        ][s % 3],
        consequenceHint: [
          "That can slow down new visitors who are trying to decide quickly.",
          "First-time visitors decide fast, so those signals matter near the top.",
          "People comparing a few options won't dig for that context.",
        ][s % 3],
        evidence: strongest.evidence || "Stored pain signals suggest trust friction.",
        strength: 79,
        softened,
      };
    case "SPEED":
      return {
        observedIssue: "Speed on mobile is the quietest dropoff cause for {niche} sites.",
        observationHint: [
          "The site feels like it may be carrying some speed friction.",
          "Mobile load times are the most common silent killer for {niche} sites.",
          "The page is a bit slow coming up, especially on mobile.",
        ][s % 3],
        consequenceHint: [
          "Most mobile visitors won't wait more than two seconds.",
          "Slow loads on mobile push people back to search.",
          "That tends to lose visitors before they even see the content.",
        ][s % 3],
        evidence: strongest.evidence || "Stored pain signals suggest speed risk.",
        strength: 76,
        softened: true,
      };
    case "DESIGN":
      return {
        observedIssue: "The site does not fully reflect the quality of the business.",
        observationHint: [
          "The site does not fully reflect the quality of the business itself.",
          "The site looks a bit dated compared to the work you're doing.",
          "The site doesn't quite match the level of what the business actually does.",
        ][s % 3],
        consequenceHint: [
          "That mismatch can make a new customer hesitate a little longer than they should.",
          "New customers use the site to judge the quality of the work.",
          "People compare options fast, and the site is often the first thing they judge.",
        ][s % 3],
        evidence: strongest.evidence || "Stored pain signals suggest visible quality issues.",
        strength: 77,
        softened: true,
      };
    case "FUNCTIONALITY":
      return {
        observedIssue: "Key parts of the site experience feel less direct than they could be.",
        observationHint: [
          "A few parts of the site flow feel less direct than they could be.",
          "A couple of steps in the site experience feel a bit clunky.",
          "There are a few spots where the site flow breaks down a little.",
        ][s % 3],
        consequenceHint: [
          "That can add friction for people trying to take the next step.",
          "Friction at those points tends to stop people who were close to reaching out.",
          "Most people won't look for a workaround, they'll just leave.",
        ][s % 3],
        evidence: strongest.evidence || "Stored pain signals suggest functionality issues.",
        strength: 78,
        softened: true,
      };
    case "NO_WEBSITE":
      return {
        observedIssue: "No clear website surfaced for the business.",
        observationHint: [
          "I could not find a clear website that really shows the business online.",
          "There's no clear site that explains the business for someone looking you up.",
          "Searching for the business doesn't bring up a clear site to land on.",
        ][s % 3],
        consequenceHint: [
          "That can make it harder for new customers to understand the work or know where to start.",
          "New customers searching for the business don't have a clear place to land.",
          "People who want to reach out have nowhere obvious to go.",
        ][s % 3],
        evidence: strongest.evidence || "Stored pain signals indicate no website.",
        strength: 72,
        softened: true,
      };
    default:
      return null;
  }
}

function getObservationCandidate(lead: LeadRecord) {
  const assessment = getWebsiteAssessment(lead);
  const painSignals = getPainSignals(lead);
  return getObservationFromAssessment(lead, assessment) || getObservationFromPainSignals(lead, painSignals);
}

function buildPersonalizationReason(lead: LeadRecord, observation: ReturnType<typeof getObservationCandidate>) {
  const parts = [`Email is personalized to ${lead.businessName} in ${lead.city}`];

  if (observation?.evidence) {
    parts.push(`and an observed issue: ${observation.evidence}`);
  } else if (lead.websiteStatus === "MISSING") {
    parts.push("and no usable website surfaced during the scrape");
  } else if (lead.niche) {
    parts.push(`using the ${lead.niche} context and available site signals`);
  } else {
    parts.push("using the available site and lead context without forcing a hard claim");
  }

  return parts.join(" ");
}

/**
 * The "concrete anchor" is the specific detail the LLM must weave into the
 * opening line so the email feels researched and not templated. It used to
 * hard-code "X Google reviews" whenever a review count existed, which made
 * EVERY email open with the same review mention. Now we pick deterministically
 * (based on lead id) from a pool of anchors — domain, niche, city, category,
 * website grade, contact name — so hooks rotate naturally and review counts
 * are just one option among many, never a guaranteed mention.
 */
// Normalize a niche field that may be plural ("plumbing companies", "Roofers",
// "Med-Spas") into a bare singular form so prompt templates that need to add
// a noun ("businesses", "owners") don't end up stacking ("plumbing companies
// businesses"). Returns the original if no plural form is detected.
function normalizeNicheForPrompt(rawNiche: string): { bare: string; alreadyHasNoun: boolean } {
  const trimmed = rawNiche.trim().toLowerCase();
  if (!trimmed) return { bare: "service", alreadyHasNoun: false };
  // Strip common plural-noun suffixes that mean "companies in the niche".
  const stripSuffixes = [" companies", " operators", " services", " shops", " contractors", " businesses", " providers"];
  for (const suffix of stripSuffixes) {
    if (trimmed.endsWith(suffix)) {
      return { bare: trimmed.slice(0, -suffix.length).trim(), alreadyHasNoun: true };
    }
  }
  // Single-token plurals like "roofers" → "roofing", "plumbers" → "plumbing",
  // "electricians" → "electrical". Heuristic: if it ends with -ers/-ans/-s,
  // treat it as already noun-equivalent and don't append "businesses" later.
  if (/(ers|ans|ists)$/.test(trimmed)) return { bare: trimmed, alreadyHasNoun: true };
  // Hyphenated "Med-Spas" or "med-spas".
  if (trimmed.includes("-")) return { bare: trimmed, alreadyHasNoun: true };
  return { bare: trimmed, alreadyHasNoun: false };
}

function buildConcreteAnchor(lead: LeadRecord) {
  const city = lead.city?.trim() || "";
  const rawNiche = lead.niche?.trim() || "";
  const { bare: niche } = normalizeNicheForPrompt(rawNiche);
  const category = lead.category?.trim() || "";
  const name = lead.businessName?.trim() || "their site";

  // All candidates are industry-pattern phrasings only — NEVER reference
  // having clicked through, poked at, or visited the recipient's site.
  // The system prompt bans those phrases explicitly, so feeding them as
  // anchor candidates produced contradictory guidance and the LLM stitched
  // awkward grammar trying to avoid the banned wording.
  const candidates: string[] = [];
  if (niche && city) candidates.push(`while looking through ${niche} businesses in ${city}`);
  if (niche && city) candidates.push(`while scanning ${niche} operators around ${city}`);
  if (category && city) candidates.push(`while researching ${category} around ${city}`);
  if (niche) candidates.push(`while researching ${niche} businesses online`);
  if (city) candidates.push(`while looking at local businesses in ${city}`);
  candidates.push(`while researching ${name}`);

  const seed = Number(lead.id || 0) || name.length + city.length;
  return candidates[seed % candidates.length];
}

function buildConfidenceScore(lead: LeadRecord, observationStrength: number, validEmail: boolean) {
  let score = 40;
  score += clamp(observationStrength - 60, 0, 30);

  if (hasModerateOrStrongServiceFit(lead)) score += 10;
  if (hasOwnerOperatorStyleContact(lead)) score += 8;
  if (Number(lead.reviewCount || 0) >= 10) score += 6;
  if (typeof lead.axiomScore === "number") score += clamp(Math.round((lead.axiomScore - 35) / 3), 0, 10);
  if (validEmail) score += 6;

  return clamp(score, 35, 95);
}


function substituteNiche(text: string, lead: LeadRecord): string {
  const niche = String(lead.niche || "service").trim() || "service";
  return text.replace(/\{niche\}/g, niche);
}

export function chooseColdEmailPlan(lead: LeadRecord, _enrichment: EnrichmentResult): ColdEmailPlan {
  void _enrichment;

  const validEmail = getEmailValidity(lead);
  const observation = getObservationCandidate(lead);
  const observationStrength = observation?.strength || 0;
  const confidenceScore = buildConfidenceScore(lead, observationStrength, validEmail);
  const canUseSoftCall = Boolean(
    observation &&
    confidenceScore >= 88 &&
    hasOwnerOperatorStyleContact(lead) &&
    validEmail &&
    normalizeLower(lead.emailType) === "owner" &&
    observationStrength >= 88,
  );

  const strategy: ColdEmailStrategy = canUseSoftCall
    ? "soft_call"
    : observation
      ? "observation_based"
      : "curiosity_based";

  const CTA_type: ColdEmailCtaType =
    strategy === "soft_call"
      ? "soft_call"
      : strategy === "observation_based"
        ? "observation_offer"
        : "permission_offer";

  const observedIssue = observation?.observedIssue || "No strong observation was reliable enough to force into the email.";
  const personalizationReason = buildPersonalizationReason(lead, observation);
  const concreteAnchor = buildConcreteAnchor(lead);

  const seed = Number(lead.id || 0);
  const observationCtaPool = [
    "Would it be helpful if I sent over 2 or 3 ideas?",
    "Want me to send what I'd tweak?",
    "Should I send the specifics?",
    "Interested in hearing what I'd change?",
  ];
  const permissionCtaPool = [
    "Happy to send a few quick observations if useful.",
    "Would it help if I shared a couple of thoughts?",
    "Open to me sending what stood out?",
    "Want me to put a quick list together?",
  ];
  const softCallCtaPool = [
    "If helpful, I'd be happy to walk you through it briefly.",
    "Want me to walk you through it?",
    "Open to a quick walkthrough?",
  ];
  let ctaHint: string;
  if (CTA_type === "permission_offer") {
    ctaHint = permissionCtaPool[seed % permissionCtaPool.length];
  } else if (CTA_type === "soft_call") {
    ctaHint = softCallCtaPool[seed % softCallCtaPool.length];
  } else {
    ctaHint = observationCtaPool[seed % observationCtaPool.length];
  }

  const curiosityObservation =
    lead.websiteStatus === "MISSING"
      ? `I was looking at ${lead.businessName} and had one quick thought after not finding a clear site for it.`
      : `I was looking through ${extractDomain(lead.websiteUrl) || lead.businessName}'s site and had one quick thought.`;

  return {
    strategy,
    CTA_type,
    confidence_score: confidenceScore,
    observed_issue: observedIssue,
    personalization_reason: personalizationReason,
    concreteAnchor,
    issueEvidence: observation?.evidence || "Evidence is limited, so the email should stay curiosity-based and permission-oriented.",
    observationHint: substituteNiche(observation?.observationHint || curiosityObservation, lead),
    consequenceHint:
      observation?.consequenceHint ||
      "If the website is not doing enough of the trust and clarity work up front, that can create avoidable hesitation.",
    ctaHint,
    softened: observation?.softened ?? true,
    validEmail,
  };
}

function countWords(text: string) {
  return text
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function includesAny(text: string, values: string[]) {
  const haystack = text.toLowerCase();
  return values.some((value) => haystack.includes(value.toLowerCase()));
}

export function validateColdEmailDraft(draft: ColdEmailDraft, lead: LeadRecord, plan: ColdEmailPlan): ColdEmailValidation {
  const wordCount = countWords(draft.body);
  const combined = `${draft.subject}\n${draft.body}\n${draft.personalization_reason}\n${draft.observed_issue}`;
  const combinedLower = combined.toLowerCase();
  const errors: string[] = [];

  const lengthScore = wordCount >= 50 && wordCount <= 95 ? 100 : wordCount < 50 ? 45 : 35;
  if (lengthScore < 100) {
    errors.push(`Email length must stay between 50 and 95 words. Current count: ${wordCount}.`);
  }

  const bannedHits = BANNED_EMAIL_PHRASES.filter((phrase) => combinedLower.includes(phrase));
  // Forced-casual tonal regex. The scraper DOES visit the site so references
  // to specific page elements (homepage, contact form, hero, nav) are allowed
  // as long as they aren't paired with the template-y casual phrasings below.
  const fabricationRegex = [
    /while looking at (a |a few )?\S+ sites/i,
    /(clicked|clicking) through \S+\.[a-z]{2,}/i,
    /poking around \S+/i,
    /took a (quick )?look (at|through)/i,
    /spent (a |some )?(minute|seconds?|time) on/i,
    /had a (quick )?look at \S+/i,
  ];
  const regexHits: string[] = [];
  for (const re of fabricationRegex) {
    if (re.test(combined)) {
      regexHits.push(re.source);
    }
  }
  if (bannedHits.length > 0 || regexHits.length > 0) {
    errors.push(`Banned phrases detected: ${[...bannedHits, ...regexHits].join(", ")}.`);
  }

  if (/[—–]/.test(combined)) {
    errors.push("Em dashes are not allowed.");
  }
  if (combined.includes("!")) {
    errors.push("Exclamation marks are not allowed.");
  }

  const genericHits = GENERIC_FALLBACK_PATTERNS.filter((phrase) => combinedLower.includes(phrase));
  const genericAgencyLanguageScore = genericHits.length === 0 ? 100 : Math.max(20, 100 - genericHits.length * 35);
  if (genericHits.length > 0) {
    errors.push(`Generic agency language detected: ${genericHits.join(", ")}.`);
  }

  const businessMentioned = combinedLower.includes(lead.businessName.toLowerCase());
  const concreteAnchorHits = [
    lead.city,
    String(Number(lead.reviewCount || 0)),
    extractDomain(lead.websiteUrl),
    lead.niche,
    lead.category || "",
  ]
    .map((value) => normalizeLower(value))
    .filter(Boolean);
  const specificityKeywords = [
    "mobile",
    "contact",
    "quote",
    "booking",
    "book",
    "trust",
    "reviews",
    "speed",
    "scan",
    "service page",
    "website",
    "homepage",
    "first-time visitor",
  ];
  const hasConcreteAnchor = concreteAnchorHits.some((value) => combinedLower.includes(value));
  const specificityScore = businessMentioned && hasConcreteAnchor && includesAny(combinedLower, specificityKeywords)
    ? 100
    : businessMentioned && (hasConcreteAnchor || normalizeLower(draft.observed_issue) !== normalizeLower("No strong observation was reliable enough to force into the email."))
      ? 72
      : 30;
  if (specificityScore < 70) {
    errors.push("Draft is not specific enough to the business or observed issue.");
  }

  const humanTonePenaltyPatterns = [
    "best regards",
    "dear ",
    "award-winning",
    "increase conversions",
    "optimize your site",
    "digital transformation",
    "quietly cost",
    "does its job",
    "built a really strong reputation",
    "the business itself",
    "up front",
  ];
  const humanToneHits = humanTonePenaltyPatterns.filter((phrase) => combinedLower.includes(phrase));
  const humanToneScore = humanToneHits.length === 0 ? 100 : Math.max(25, 100 - humanToneHits.length * 30);
  if (humanToneHits.length > 0) {
    errors.push(`Tone still sounds too polished or templated: ${humanToneHits.join(", ")}.`);
  }

  const callPatterns = [
    "schedule a call",
    "book a call",
    "jump on a call",
    "10-minute call",
    "15-minute call",
    "zoom call",
    "quick call",
  ];
  const lowFrictionPatterns = [
    "send over",
    "send a few",
    "send a couple",
    "happy to send",
    "would it be helpful",
    "if useful",
    "want me to send",
    "interested in",
    "should i send",
    "put together",
    "what stood out",
    "what i'd change",
    "what i'd tweak",
    "quick list",
    "couple of thoughts",
  ];
  const callHit = includesAny(combinedLower, callPatterns);
  let ctaFrictionScore = 100;
  if (plan.CTA_type !== "soft_call" && callHit) {
    ctaFrictionScore = 20;
    errors.push("CTA is too high-friction for the selected strategy.");
  } else if (plan.CTA_type === "soft_call" && !callHit && !combinedLower.includes("walk you through")) {
    ctaFrictionScore = 55;
    errors.push("Soft call strategy was selected, but the CTA does not reflect it clearly.");
  } else if (plan.CTA_type !== "soft_call" && !includesAny(combinedLower, lowFrictionPatterns)) {
    ctaFrictionScore = 45;
    errors.push("Default CTA should stay low-friction and offer to send ideas or observations.");
  }

  if (draft.CTA_type !== plan.CTA_type) {
    errors.push(`CTA type should be ${plan.CTA_type}, received ${draft.CTA_type}.`);
  }

  if (draft.confidence_score < 0 || draft.confidence_score > 100) {
    errors.push("confidence_score must stay between 0 and 100.");
  }

  const score = Math.round(
    (specificityScore + humanToneScore + genericAgencyLanguageScore + ctaFrictionScore + lengthScore) / 5,
  );

  return {
    valid: errors.length === 0,
    score,
    wordCount,
    errors,
    checks: {
      specificity: specificityScore,
      humanTone: humanToneScore,
      genericAgencyLanguage: genericAgencyLanguageScore,
      ctaFriction: ctaFrictionScore,
      length: lengthScore,
    },
  };
}

export function buildRetryInstructions(validation: ColdEmailValidation, plan: ColdEmailPlan) {
  return [
    "The first draft did not pass validation. Rewrite it once and fix every issue below.",
    ...validation.errors.map((error) => `- ${error}`),
    `- Keep the CTA type as ${plan.CTA_type}.`,
    `- Keep the email between 50 and 95 words.`,
    "- Use plain English and make it sound like a real person who actually looked at the business.",
  ].join("\n");
}

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
  if (lines.length >= 3) {
    return lines.join("\n\n");
  }

  const sentences = sentenceSplit(clean);
  if (sentences.length < 2) {
    return clean;
  }

  const firstLine = sentences[0];
  const middle = sentences.slice(1, -1).join(" ");
  const lastLine = sentences[sentences.length - 1];
  return [firstLine, middle, lastLine].filter(Boolean).join("\n\n");
}

export function buildPlainTextEmail(body: string, senderFirstName: string) {
  const escapedSender = senderFirstName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Match signature anywhere (mid-body or at end). Previously only matched at
  // string end ($), so when the model emitted "Best,\nAidan\nPS - ..." the
  // existing signoff slipped past, and the code appended another "Best,
  // Aidan" at the very end producing a duplicate signoff.
  const signaturePattern = new RegExp(
    `(?:\\n\\s*)?(?:best|thanks|thank you|regards),?\\s*\\n?\\s*${escapedSender}(?:\\s+hinsperger)?(?:\\s+axiom\\s+infrastructure)?\\s*`,
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
    .replace(/[â€”â€“]/g, ",")
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

  // Strip ALL occurrences of the signoff, even mid-body (so a PS line after
  // a model-emitted "Best,\nName" doesn't strand the signoff in the middle).
  sanitized = sanitized.replace(signaturePattern, "\n\n");
  sanitized = sanitized.replace(inlineSignaturePattern, " ");
  sanitized = sanitized.trim().replace(/\n{3,}/g, "\n\n");

  // Extract PS line if present so it can be placed AFTER the signoff.
  let psLine = "";
  const psMatch = sanitized.match(/\n\s*(P\.?S\.?[^\n]*)\s*$/i);
  if (psMatch) {
    psLine = psMatch[1].trim();
    sanitized = sanitized.slice(0, psMatch.index).trim();
  }

  const signoff = `Best,\n${senderFirstName}`;
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
    `<!DOCTYPE html>`,
    `<html>`,
    `<head>`,
    `<meta charset="utf-8">`,
    `<meta name="viewport" content="width=device-width, initial-scale=1.0">`,
    `<meta name="color-scheme" content="light dark">`,
    `<meta name="supported-color-schemes" content="light dark">`,
    `</head>`,
    `<body style="margin:0;padding:0;background:transparent;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;">`,
    paragraphs,
    `</body>`,
    `</html>`,
  ].join("");
}
