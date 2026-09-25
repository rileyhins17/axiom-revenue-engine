import { z } from "zod";

import { HtmlPageFactsSchema } from "@/lib/revenue-engine/html-page-facts";
import { normalizePublicWebsiteUrl } from "@/lib/revenue-engine/public-website-url";

export const WEBSITE_PAGE_SELECTION_VERSION = "website-page-selection-v1";
export const WEBSITE_PAGE_SELECTION_MAX_CANDIDATES = 100;
export const WEBSITE_PAGE_SELECTION_MAX_SOURCE_AGE_HOURS = 24;
export const WEBSITE_PAGE_SELECTION_MIN_SCORE = 45;

const REQUIRED_SUBPAGE_KINDS = ["SERVICE", "ABOUT", "CONTACT"] as const;
type RequiredSubpageKind = (typeof REQUIRED_SUBPAGE_KINDS)[number];

const WebsitePageSelectionPolicySchema = z.object({
  maxCandidates: z.literal(WEBSITE_PAGE_SELECTION_MAX_CANDIDATES),
  maxSelectedPages: z.literal(4),
  maxSourceAgeHours: z.literal(WEBSITE_PAGE_SELECTION_MAX_SOURCE_AGE_HOURS),
  minimumCandidateScore: z.literal(WEBSITE_PAGE_SELECTION_MIN_SCORE),
  allowQueryUrls: z.literal(false),
  allowCrossAuthorityUrls: z.literal(false),
}).strict();

export function defaultWebsitePageSelectionPolicy() {
  return WebsitePageSelectionPolicySchema.parse({
    maxCandidates: WEBSITE_PAGE_SELECTION_MAX_CANDIDATES,
    maxSelectedPages: 4,
    maxSourceAgeHours: WEBSITE_PAGE_SELECTION_MAX_SOURCE_AGE_HOURS,
    minimumCandidateScore: WEBSITE_PAGE_SELECTION_MIN_SCORE,
    allowQueryUrls: false,
    allowCrossAuthorityUrls: false,
  });
}

function canonicalPublicUrl(value: string) {
  const normalized = normalizePublicWebsiteUrl(value);
  if (normalized !== value) throw new Error("Page-selection URLs must already be canonical public URLs.");
  return normalized;
}

function authority(value: string) {
  return new URL(value).hostname.toLocaleLowerCase("en-CA").replace(/^www\./, "");
}

function pageIdentity(value: string) {
  const url = new URL(value);
  const pathname = url.pathname === "/" ? "/" : url.pathname.replace(/\/+$/, "");
  return `${authority(value)}${pathname}`;
}

const WebsitePageSelectionRequestSchema = z.object({
  selectionVersion: z.literal(WEBSITE_PAGE_SELECTION_VERSION),
  selectionId: z.string().uuid(),
  businessId: z.string().trim().min(1).max(128),
  businessName: z.string().trim().min(1).max(256),
  niche: z.string().trim().min(1).max(128),
  expectedServices: z.array(z.string().trim().min(1).max(100)).min(1).max(20),
  plannedAt: z.string().datetime({ offset: true }),
  mode: z.literal("SHADOW"),
  plannerKind: z.literal("DETERMINISTIC_FIXTURE"),
  maxCostUsd: z.literal(0),
  policy: WebsitePageSelectionPolicySchema,
  homepageFacts: HtmlPageFactsSchema,
}).strict().superRefine((request, context) => {
  if (request.homepageFacts.pageKind !== "HOME") {
    context.addIssue({ code: "custom", message: "Page selection requires homepage HTML facts.", path: ["homepageFacts", "pageKind"] });
  }
  let homeAuthority: string | null = null;
  try {
    homeAuthority = authority(canonicalPublicUrl(request.homepageFacts.url));
  } catch (error) {
    context.addIssue({
      code: "custom",
      message: error instanceof Error ? error.message : "Homepage URL is not a canonical public URL.",
      path: ["homepageFacts", "url"],
    });
  }
  const plannedMs = Date.parse(request.plannedAt);
  const capturedMs = Date.parse(request.homepageFacts.capturedAt);
  if (capturedMs > plannedMs) {
    context.addIssue({ code: "custom", message: "Homepage facts cannot be captured after page selection.", path: ["homepageFacts", "capturedAt"] });
  }
  if (plannedMs - capturedMs > request.policy.maxSourceAgeHours * 60 * 60 * 1_000) {
    context.addIssue({ code: "custom", message: "Homepage link evidence is older than the page-selection freshness window.", path: ["homepageFacts", "capturedAt"] });
  }
  for (const [index, link] of request.homepageFacts.discoveredInternalLinks.entries()) {
    try {
      const url = canonicalPublicUrl(link.url);
      if (homeAuthority && authority(url) !== homeAuthority) {
        context.addIssue({ code: "custom", message: "Discovered page candidates must remain on the homepage authority.", path: ["homepageFacts", "discoveredInternalLinks", index, "url"] });
      }
    } catch (error) {
      context.addIssue({
        code: "custom",
        message: error instanceof Error ? error.message : "Discovered page URL is not canonical and public.",
        path: ["homepageFacts", "discoveredInternalLinks", index, "url"],
      });
    }
  }
});

export type WebsitePageSelectionRequest = z.infer<typeof WebsitePageSelectionRequestSchema>;

const CandidateScoreSchema = z.object({
  SERVICE: z.number().int().min(0).max(100),
  ABOUT: z.number().int().min(0).max(100),
  CONTACT: z.number().int().min(0).max(100),
}).strict();

const PageCandidateEvaluationSchema = z.object({
  url: z.string().url(),
  label: z.string().max(120),
  kindHint: z.enum(["HOME", "SERVICE", "ABOUT", "CONTACT", "OTHER"]),
  scores: CandidateScoreSchema,
  eligibleKinds: z.array(z.enum(REQUIRED_SUBPAGE_KINDS)).max(REQUIRED_SUBPAGE_KINDS.length),
  selectedAs: z.enum(REQUIRED_SUBPAGE_KINDS).nullable(),
  decision: z.enum(["SELECTED", "SKIPPED"]),
  reasonCodes: z.array(z.string().trim().min(1).max(100)).min(1).max(20),
}).strict();

const SelectedPageSchema = z.object({
  pageKind: z.enum(["HOME", ...REQUIRED_SUBPAGE_KINDS]),
  url: z.string().url(),
  label: z.string().min(1).max(120),
  score: z.number().int().min(0).max(100),
  reasonCodes: z.array(z.string().trim().min(1).max(100)).min(1).max(20),
}).strict();

export const WebsitePageSelectionPlanSchema = z.object({
  selectionVersion: z.literal(WEBSITE_PAGE_SELECTION_VERSION),
  selectionId: z.string().uuid(),
  businessId: z.string().trim().min(1).max(128),
  plannedAt: z.string().datetime({ offset: true }),
  sourceCapturedAt: z.string().datetime({ offset: true }),
  mode: z.literal("SHADOW"),
  plannerKind: z.literal("DETERMINISTIC_FIXTURE"),
  status: z.enum(["READY", "PARTIAL"]),
  discoveryComplete: z.boolean(),
  policy: WebsitePageSelectionPolicySchema,
  selectedPages: z.array(SelectedPageSchema).min(1).max(4),
  missingRequiredPageKinds: z.array(z.enum(REQUIRED_SUBPAGE_KINDS)).max(REQUIRED_SUBPAGE_KINDS.length),
  candidateEvaluations: z.array(PageCandidateEvaluationSchema).max(WEBSITE_PAGE_SELECTION_MAX_CANDIDATES),
  warnings: z.array(z.string().trim().min(1).max(120)).max(30),
  budget: z.object({
    maxCostUsd: z.literal(0),
    totalCostUsd: z.literal(0),
    providerOperations: z.literal(0),
    candidatesObserved: z.number().int().nonnegative().max(WEBSITE_PAGE_SELECTION_MAX_CANDIDATES),
    pagesSelected: z.number().int().min(1).max(4),
  }).strict(),
}).strict().superRefine((plan, context) => {
  let homeAuthority: string | null = null;
  try {
    homeAuthority = authority(canonicalPublicUrl(plan.selectedPages.find((page) => page.pageKind === "HOME")?.url || ""));
  } catch (error) {
    context.addIssue({
      code: "custom",
      message: error instanceof Error ? error.message : "Selected homepage is not canonical and public.",
      path: ["selectedPages"],
    });
  }
  const homePages = plan.selectedPages.filter((page) => page.pageKind === "HOME");
  if (homePages.length !== 1) {
    context.addIssue({ code: "custom", message: "Page-selection plan requires exactly one homepage.", path: ["selectedPages"] });
  }
  if (new Set(plan.selectedPages.map((page) => page.pageKind)).size !== plan.selectedPages.length) {
    context.addIssue({ code: "custom", message: "Selected page kinds must be unique.", path: ["selectedPages"] });
  }
  if (new Set(plan.selectedPages.map((page) => pageIdentity(page.url))).size !== plan.selectedPages.length) {
    context.addIssue({ code: "custom", message: "Selected page identities must be unique.", path: ["selectedPages"] });
  }
  if (new Set(plan.candidateEvaluations.map((candidate) => pageIdentity(candidate.url))).size !== plan.candidateEvaluations.length) {
    context.addIssue({ code: "custom", message: "Candidate page identities must be unique.", path: ["candidateEvaluations"] });
  }
  for (const [index, page] of plan.selectedPages.entries()) {
    try {
      const url = canonicalPublicUrl(page.url);
      if (homeAuthority && authority(url) !== homeAuthority) {
        context.addIssue({ code: "custom", message: "Selected pages must remain on the homepage authority.", path: ["selectedPages", index, "url"] });
      }
      if (page.pageKind !== "HOME" && new URL(url).search) {
        context.addIssue({ code: "custom", message: "Selected subpages cannot use query URLs.", path: ["selectedPages", index, "url"] });
      }
    } catch (error) {
      context.addIssue({
        code: "custom",
        message: error instanceof Error ? error.message : "Selected page URL is not canonical and public.",
        path: ["selectedPages", index, "url"],
      });
    }
  }
  for (const [index, evaluation] of plan.candidateEvaluations.entries()) {
    try {
      const url = canonicalPublicUrl(evaluation.url);
      if (homeAuthority && authority(url) !== homeAuthority) {
        context.addIssue({ code: "custom", message: "Candidate pages must remain on the homepage authority.", path: ["candidateEvaluations", index, "url"] });
      }
    } catch (error) {
      context.addIssue({
        code: "custom",
        message: error instanceof Error ? error.message : "Candidate page URL is not canonical and public.",
        path: ["candidateEvaluations", index, "url"],
      });
    }
    if ((evaluation.decision === "SELECTED") !== (evaluation.selectedAs !== null)) {
      context.addIssue({ code: "custom", message: "Candidate decision must match its selected role.", path: ["candidateEvaluations", index, "decision"] });
    }
    if (evaluation.selectedAs && (
      !evaluation.eligibleKinds.includes(evaluation.selectedAs)
      || evaluation.scores[evaluation.selectedAs] < plan.policy.minimumCandidateScore
    )) {
      context.addIssue({ code: "custom", message: "Selected candidate must be eligible and meet its role threshold.", path: ["candidateEvaluations", index, "selectedAs"] });
    }
  }
  const derivedMissing = REQUIRED_SUBPAGE_KINDS.filter((kind) => !plan.selectedPages.some((page) => page.pageKind === kind));
  if (JSON.stringify(derivedMissing) !== JSON.stringify(plan.missingRequiredPageKinds)) {
    context.addIssue({ code: "custom", message: "Missing page kinds must match selected pages.", path: ["missingRequiredPageKinds"] });
  }
  const ready = plan.discoveryComplete && derivedMissing.length === 0;
  if ((plan.status === "READY") !== ready) {
    context.addIssue({ code: "custom", message: "Only complete discovery with every required page can be ready.", path: ["status"] });
  }
  if (plan.budget.candidatesObserved !== plan.candidateEvaluations.length || plan.budget.pagesSelected !== plan.selectedPages.length) {
    context.addIssue({ code: "custom", message: "Selection budget counts must match the plan.", path: ["budget"] });
  }
  for (const page of plan.selectedPages.filter((candidate) => candidate.pageKind !== "HOME")) {
    const evaluation = plan.candidateEvaluations.find((candidate) => candidate.url === page.url);
    if (
      !evaluation
      || evaluation.selectedAs !== page.pageKind
      || evaluation.decision !== "SELECTED"
      || evaluation.scores[page.pageKind] !== page.score
      || JSON.stringify(evaluation.reasonCodes) !== JSON.stringify(page.reasonCodes)
    ) {
      context.addIssue({ code: "custom", message: "Every selected subpage must match its candidate evaluation.", path: ["selectedPages"] });
    }
  }
});

export type WebsitePageSelectionPlan = z.infer<typeof WebsitePageSelectionPlanSchema>;

type Candidate = z.infer<typeof PageCandidateEvaluationSchema> & { identity: string };

const BLOCKED_PAGE_PATTERN = /\b(privacy|terms|cookie|accessibility|sitemap|career|careers|job|jobs|employment|blog|news|article|resource|resources|login|sign in|account|cart|checkout|shop|product|products|faq|financing|rebate|rebates|promotion|promotions)\b/;
const CONTACT_PATTERN = /\b(contact|contact us|get in touch|quote|estimate|request a quote|free quote|request service|service request|consultation|book|schedule)\b/;
const ABOUT_PATTERN = /\b(about|about us|our story|our company|company|team|our team|meet the team|who we are|why us|why choose us|our values|our mission|history)\b/;
const SERVICE_PATTERN = /\b(service|services|what we do|solutions)\b/;
const GENERIC_TERMS = new Set(["and", "the", "for", "with", "service", "services", "contractor", "company", "local"]);

function tokens(value: string) {
  return value
    .toLocaleLowerCase("en-CA")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3 && !GENERIC_TERMS.has(token));
}

function searchableText(url: string, label: string) {
  let decodedPath = new URL(url).pathname;
  try {
    decodedPath = decodeURIComponent(decodedPath);
  } catch {
    // The URL parser already validated the URL. Keep the encoded path for scoring.
  }
  return `${decodedPath.replace(/[-_]+/g, " ")} ${label}`.toLocaleLowerCase("en-CA");
}

function boundedScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function roleScores(
  url: string,
  label: string,
  kindHint: Candidate["kindHint"],
  niche: string,
  expectedServices: string[],
) {
  const text = searchableText(url, label);
  const textTokens = new Set(tokens(text));
  const serviceTokens = new Set(expectedServices.flatMap(tokens));
  const nicheTokens = new Set(tokens(niche));
  const matchedServiceTokens = [...serviceTokens].filter((token) => textTokens.has(token));
  const matchedNicheTokens = [...nicheTokens].filter((token) => textTokens.has(token));
  const matchedServicePhrases = expectedServices.filter((service) => {
    const phrase = tokens(service).join(" ");
    return phrase.length >= 3 && text.replace(/[^a-z0-9]+/g, " ").includes(phrase);
  });
  const pathDepth = new URL(url).pathname.split("/").filter(Boolean).length;
  const shallowBonus = pathDepth <= 2 ? 5 : 0;

  const service = boundedScore(
    (kindHint === "SERVICE" ? 45 : 0)
    + (SERVICE_PATTERN.test(text) ? 25 : 0)
    + Math.min(30, matchedServicePhrases.length * 25)
    + Math.min(35, matchedServiceTokens.length * 14)
    + Math.min(15, matchedNicheTokens.length * 10)
    + shallowBonus
    - (CONTACT_PATTERN.test(text) ? 25 : 0)
    - (ABOUT_PATTERN.test(text) ? 20 : 0),
  );
  const about = boundedScore(
    (kindHint === "ABOUT" ? 50 : 0)
    + (ABOUT_PATTERN.test(text) ? 45 : 0)
    + shallowBonus
    - (CONTACT_PATTERN.test(text) ? 25 : 0)
    - (SERVICE_PATTERN.test(text) ? 15 : 0),
  );
  const contact = boundedScore(
    (kindHint === "CONTACT" ? 50 : 0)
    + (CONTACT_PATTERN.test(text) ? 45 : 0)
    + (/\b(quote|estimate|book|schedule)\b/.test(text) ? 10 : 0)
    + shallowBonus
    - (ABOUT_PATTERN.test(text) ? 20 : 0),
  );
  return {
    scores: { SERVICE: service, ABOUT: about, CONTACT: contact },
    matchedServiceTokens,
    matchedNicheTokens,
  };
}

function candidateEvaluation(
  link: WebsitePageSelectionRequest["homepageFacts"]["discoveredInternalLinks"][number],
  request: WebsitePageSelectionRequest,
  homeIdentity: string,
): Candidate {
  const url = link.url;
  const parsed = new URL(url);
  const identity = pageIdentity(url);
  const text = searchableText(url, link.label);
  const reasons = new Set<string>();
  if (identity === homeIdentity) reasons.add("homepage_duplicate");
  if (parsed.search) reasons.add("query_url_excluded");
  if (BLOCKED_PAGE_PATTERN.test(text)) reasons.add("low_value_or_policy_page");
  if (/\.(?:pdf|docx?|xlsx?|zip|jpe?g|png|webp)$/i.test(parsed.pathname)) reasons.add("non_html_file");
  const score = roleScores(url, link.label, link.kindHint, request.niche, request.expectedServices);
  const blocked = reasons.size > 0;
  const eligibleKinds = blocked
    ? []
    : REQUIRED_SUBPAGE_KINDS.filter((kind) => score.scores[kind] >= request.policy.minimumCandidateScore);
  if (eligibleKinds.length === 0 && !blocked) reasons.add("below_selection_threshold");
  if (score.matchedServiceTokens.length > 0) reasons.add("matches_expected_service");
  if (score.matchedNicheTokens.length > 0) reasons.add("matches_niche");
  if (link.kindHint !== "OTHER" && link.kindHint !== "HOME") reasons.add(`html_hint_${link.kindHint.toLocaleLowerCase("en-CA")}`);
  return {
    identity,
    url,
    label: link.label,
    kindHint: link.kindHint,
    scores: score.scores,
    eligibleKinds,
    selectedAs: null,
    decision: "SKIPPED",
    reasonCodes: [...reasons].sort((left, right) => left.localeCompare(right, "en-CA")),
  };
}

function compareCandidateFor(kind: RequiredSubpageKind, left: Candidate, right: Candidate) {
  return right.scores[kind] - left.scores[kind]
    || left.url.localeCompare(right.url, "en-CA")
    || left.label.localeCompare(right.label, "en-CA");
}

function choosePages(candidates: Candidate[]) {
  const choices = Object.fromEntries(REQUIRED_SUBPAGE_KINDS.map((kind) => [
    kind,
    candidates.filter((candidate) => candidate.eligibleKinds.includes(kind)).sort((left, right) => compareCandidateFor(kind, left, right)).slice(0, 10),
  ])) as Record<RequiredSubpageKind, Candidate[]>;
  type SelectionChoice = { selected: Partial<Record<RequiredSubpageKind, Candidate>>; count: number; score: number; key: string };
  let best: SelectionChoice | null = null;
  const visit = (index: number, selected: Partial<Record<RequiredSubpageKind, Candidate>>, used: Set<string>) => {
    if (index === REQUIRED_SUBPAGE_KINDS.length) {
      const entries = REQUIRED_SUBPAGE_KINDS.flatMap((kind) => selected[kind] ? [[kind, selected[kind]!] as const] : []);
      const candidate = {
        selected: { ...selected },
        count: entries.length,
        score: entries.reduce((sum, [kind, item]) => sum + item.scores[kind], 0),
        key: entries.map(([kind, item]) => `${kind}:${item.url}`).join("|"),
      };
      if (!best || candidate.count > best.count || candidate.count === best.count && (
        candidate.score > best.score || candidate.score === best.score && candidate.key.localeCompare(best.key, "en-CA") < 0
      )) best = candidate;
      return;
    }
    const kind = REQUIRED_SUBPAGE_KINDS[index];
    visit(index + 1, selected, used);
    for (const candidate of choices[kind]) {
      if (used.has(candidate.identity)) continue;
      visit(
        index + 1,
        { ...selected, [kind]: candidate },
        new Set([...used, candidate.identity]),
      );
    }
  };
  visit(0, {}, new Set());
  const resolvedBest = best as SelectionChoice | null;
  return resolvedBest ? resolvedBest.selected : {};
}

export function planWebsitePages(value: unknown): WebsitePageSelectionPlan {
  const request = WebsitePageSelectionRequestSchema.parse(value);
  const homeUrl = request.homepageFacts.url;
  const homeIdentity = pageIdentity(homeUrl);
  const evaluationsByIdentity = new Map<string, Candidate>();
  const duplicateWarnings = new Set<string>();
  const rawEvaluations = request.homepageFacts.discoveredInternalLinks
    .map((link) => candidateEvaluation(link, request, homeIdentity))
    .sort((left, right) => left.identity.localeCompare(right.identity, "en-CA") || left.url.localeCompare(right.url, "en-CA"));
  for (const evaluation of rawEvaluations) {
    const existing = evaluationsByIdentity.get(evaluation.identity);
    if (!existing) {
      evaluationsByIdentity.set(evaluation.identity, evaluation);
      continue;
    }
    duplicateWarnings.add(`duplicate_page_identity:${evaluation.identity.slice(0, 90)}`);
    const preferred = [existing, evaluation].sort((left, right) => {
      if (right.eligibleKinds.length !== left.eligibleKinds.length) return right.eligibleKinds.length - left.eligibleKinds.length;
      const leftMax = Math.max(...Object.values(left.scores));
      const rightMax = Math.max(...Object.values(right.scores));
      return rightMax - leftMax || Number(new URL(right.url).protocol === "https:") - Number(new URL(left.url).protocol === "https:")
        || left.url.localeCompare(right.url, "en-CA");
    })[0];
    evaluationsByIdentity.set(evaluation.identity, preferred);
  }
  const candidates = [...evaluationsByIdentity.values()].sort((left, right) => left.url.localeCompare(right.url, "en-CA"));
  const selected = choosePages(candidates);
  const selectedByUrl = new Map<string, RequiredSubpageKind>();
  for (const kind of REQUIRED_SUBPAGE_KINDS) {
    const candidate = selected[kind];
    if (candidate) selectedByUrl.set(candidate.url, kind);
  }
  const candidateEvaluations = candidates.map((candidate) => {
    const { identity: _identity, ...publicCandidate } = candidate;
    void _identity;
    const selectedAs = selectedByUrl.get(candidate.url) || null;
    const reasonCodes = new Set(candidate.reasonCodes);
    if (selectedAs) reasonCodes.add(`selected_as_${selectedAs.toLocaleLowerCase("en-CA")}`);
    else if (candidate.eligibleKinds.length > 0) reasonCodes.add("eligible_but_lower_ranked");
    return PageCandidateEvaluationSchema.parse({
      ...publicCandidate,
      selectedAs,
      decision: selectedAs ? "SELECTED" : "SKIPPED",
      reasonCodes: [...reasonCodes].sort((left, right) => left.localeCompare(right, "en-CA")),
    });
  });
  const selectedPages = [
    SelectedPageSchema.parse({
      pageKind: "HOME",
      url: homeUrl,
      label: "Homepage",
      score: 100,
      reasonCodes: ["captured_homepage_source"],
    }),
    ...REQUIRED_SUBPAGE_KINDS.flatMap((kind) => {
      const candidate = selected[kind];
      return candidate ? [SelectedPageSchema.parse({
        pageKind: kind,
        url: candidate.url,
        label: candidate.label || new URL(candidate.url).pathname,
        score: candidate.scores[kind],
        reasonCodes: candidateEvaluations.find((evaluation) => evaluation.url === candidate.url)?.reasonCodes || [`selected_as_${kind.toLocaleLowerCase("en-CA")}`],
      })] : [];
    }),
  ];
  const missingRequiredPageKinds = REQUIRED_SUBPAGE_KINDS.filter((kind) => !selected[kind]);
  const warnings = new Set<string>(duplicateWarnings);
  if (!request.homepageFacts.complete) warnings.add("homepage_link_discovery_incomplete");
  for (const kind of missingRequiredPageKinds) warnings.add(`missing_page_candidate:${kind}`);
  const discoveryComplete = request.homepageFacts.complete;
  return WebsitePageSelectionPlanSchema.parse({
    selectionVersion: request.selectionVersion,
    selectionId: request.selectionId,
    businessId: request.businessId,
    plannedAt: request.plannedAt,
    sourceCapturedAt: request.homepageFacts.capturedAt,
    mode: request.mode,
    plannerKind: request.plannerKind,
    status: discoveryComplete && missingRequiredPageKinds.length === 0 ? "READY" : "PARTIAL",
    discoveryComplete,
    policy: request.policy,
    selectedPages,
    missingRequiredPageKinds,
    candidateEvaluations,
    warnings: [...warnings].sort((left, right) => left.localeCompare(right, "en-CA")),
    budget: {
      maxCostUsd: 0,
      totalCostUsd: 0,
      providerOperations: 0,
      candidatesObserved: candidateEvaluations.length,
      pagesSelected: selectedPages.length,
    },
  });
}
