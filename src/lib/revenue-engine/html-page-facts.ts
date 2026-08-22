import { SAXParser, type EndTag, type StartTag, type Text } from "parse5-sax-parser";
import { z } from "zod";

import { normalizePublicWebsiteUrl } from "@/lib/revenue-engine/public-website-url";
import {
  WebsiteActionKindSchema,
  WebsitePageKindSchema,
  WebsiteTrustSignalSchema,
} from "@/lib/revenue-engine/website-audit";
import {
  WebsiteCaptureResultSchema,
  type WebsiteCaptureResult,
} from "@/lib/revenue-engine/website-capture";

export const HTML_PAGE_FACTS_VERSION = "html-page-facts-v1";
export const HTML_PAGE_FACTS_MAX_TOKENS = 50_000;
export const HTML_PAGE_FACTS_MAX_TEXT_CHARS = 100_000;
export const HTML_PAGE_FACTS_MAX_JSON_LD_CHARS = 100_000;

const HtmlActionFactSchema = z
  .object({
    kind: WebsiteActionKindSchema,
    label: z.string().min(1).max(120),
    href: z.string().max(2_048).nullable(),
    notExplicitlyHidden: z.boolean(),
    aboveFold: z.literal("UNKNOWN"),
  })
  .strict();

const HtmlFormFactSchema = z
  .object({
    actionUrl: z.string().url().nullable(),
    method: z.enum(["GET", "POST", "OTHER"]),
    notExplicitlyHidden: z.boolean(),
    hasEnabledSubmitControl: z.boolean(),
  })
  .strict();

const DiscoveredPageLinkSchema = z
  .object({
    url: z.string().url(),
    label: z.string().max(120),
    kindHint: WebsitePageKindSchema,
  })
  .strict();

export const HtmlPageFactsSchema = z
  .object({
    extractorVersion: z.literal(HTML_PAGE_FACTS_VERSION),
    captureVersion: z.string().min(1).max(80),
    capturedAt: z.string().datetime({ offset: true }),
    pageKind: WebsitePageKindSchema,
    url: z.string().url(),
    title: z.string().min(1).max(300).nullable(),
    metaDescription: z.string().min(1).max(600).nullable(),
    visibleText: z.string().max(HTML_PAGE_FACTS_MAX_TEXT_CHARS),
    actions: z.array(HtmlActionFactSchema).max(100),
    forms: z.array(HtmlFormFactSchema).max(30),
    trustSignals: z.array(WebsiteTrustSignalSchema).max(50),
    structuredDataTypes: z.array(z.string().min(1).max(120)).max(50),
    discoveredInternalLinks: z.array(DiscoveredPageLinkSchema).max(100),
    complete: z.boolean(),
    warnings: z.array(z.string().min(1).max(120)).max(20),
    policy: z
      .object({
        maxTokens: z.number().int().min(100).max(HTML_PAGE_FACTS_MAX_TOKENS),
        maxTextChars: z.number().int().min(100).max(HTML_PAGE_FACTS_MAX_TEXT_CHARS),
        maxJsonLdChars: z.number().int().min(100).max(HTML_PAGE_FACTS_MAX_JSON_LD_CHARS),
      })
      .strict(),
    tokenCount: z.number().int().nonnegative().max(HTML_PAGE_FACTS_MAX_TOKENS + 1),
  })
  .strict();

export type HtmlPageFacts = z.infer<typeof HtmlPageFactsSchema>;

type ExtractionPolicy = {
  maxTokens?: number;
  maxTextChars?: number;
  maxJsonLdChars?: number;
};

type AttributeMap = Map<string, string>;

type ActionCandidate = {
  tagName: string;
  href: string | null;
  labelParts: string[];
  notExplicitlyHidden: boolean;
};

type FormCandidate = {
  actionUrl: string | null;
  method: "GET" | "POST" | "OTHER";
  notExplicitlyHidden: boolean;
  hasEnabledSubmitControl: boolean;
};

type Frame = {
  tagName: string;
  hidden: boolean;
  action: ActionCandidate | null;
  form: FormCandidate | null;
  headingParts: string[] | null;
  jsonLdParts: string[] | null;
  jsonLdChars: number;
};

const VOID_ELEMENTS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr",
]);
const NON_VISIBLE_ELEMENTS = new Set(["head", "script", "style", "noscript", "template", "svg"]);
const HEADING_ELEMENTS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);

function extractionPolicy(value: ExtractionPolicy) {
  return z
    .object({
      maxTokens: z.number().int().min(100).max(HTML_PAGE_FACTS_MAX_TOKENS).default(HTML_PAGE_FACTS_MAX_TOKENS),
      maxTextChars: z.number().int().min(100).max(HTML_PAGE_FACTS_MAX_TEXT_CHARS).default(HTML_PAGE_FACTS_MAX_TEXT_CHARS),
      maxJsonLdChars: z.number().int().min(100).max(HTML_PAGE_FACTS_MAX_JSON_LD_CHARS).default(HTML_PAGE_FACTS_MAX_JSON_LD_CHARS),
    })
    .strict()
    .parse(value);
}

function attributesOf(token: StartTag): AttributeMap {
  return new Map(token.attrs.map((attribute) => [attribute.name.toLocaleLowerCase("en-CA"), attribute.value]));
}

function normalizeText(value: string, maxLength: number) {
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function isExplicitlyHidden(attributes: AttributeMap) {
  if (attributes.has("hidden")) return true;
  if (attributes.get("aria-hidden")?.toLocaleLowerCase("en-CA") === "true") return true;
  const style = attributes.get("style")?.toLocaleLowerCase("en-CA") || "";
  return /(?:^|;)\s*display\s*:\s*none\b/.test(style)
    || /(?:^|;)\s*visibility\s*:\s*hidden\b/.test(style);
}

function normalizedActionHref(value: string | undefined, baseUrl: string) {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^(?:tel|mailto):/i.test(trimmed)) return trimmed.slice(0, 2_048);
  try {
    return normalizePublicWebsiteUrl(new URL(trimmed, baseUrl).toString());
  } catch {
    return null;
  }
}

function publicUrl(value: string | undefined, baseUrl: string) {
  if (!value) return null;
  try {
    return normalizePublicWebsiteUrl(new URL(value.trim(), baseUrl).toString());
  } catch {
    return null;
  }
}

function classifyAction(label: string, href: string | null) {
  const text = `${label} ${href || ""}`.toLocaleLowerCase("en-CA");
  if (href?.toLocaleLowerCase("en-CA").startsWith("tel:") || /\b(call|phone)\b/.test(text)) return "PHONE" as const;
  if (/\b(quote|estimate|pricing)\b/.test(text)) return "QUOTE" as const;
  if (/\b(book|schedule|appointment)\b/.test(text)) return "BOOK" as const;
  if (/\b(contact|get in touch|email|message)\b/.test(text)) return "CONTACT" as const;
  return null;
}

function linkKind(url: string, label: string) {
  const text = `${new URL(url).pathname} ${label}`.toLocaleLowerCase("en-CA");
  if (/\b(contact|quote|estimate|get-in-touch)\b/.test(text)) return "CONTACT" as const;
  if (/\b(about|team|company)\b/.test(text)) return "ABOUT" as const;
  if (/\b(service|services|roof|roofing|hvac|heating|cooling|landscap|lawn)\b/.test(text)) return "SERVICE" as const;
  return "OTHER" as const;
}

function addTrustSignals(value: string, signals: Set<z.infer<typeof WebsiteTrustSignalSchema>>) {
  const normalized = value.toLocaleLowerCase("en-CA").replace(/[^a-z0-9]+/g, " ");
  if (/\btestimonial(s)?\b/.test(normalized)) signals.add("TESTIMONIAL");
  if (/\b(review(s)?|rating(s)?)\b/.test(normalized)) signals.add("REVIEW");
  if (/\b(project(s)?|portfolio|gallery)\b/.test(normalized)) signals.add("PROJECT_GALLERY");
  if (/\b(our team|meet the team|team members?)\b/.test(normalized)) signals.add("TEAM");
  if (/\b(credential(s)?|licensed|certified|certification|accredited)\b/.test(normalized)) signals.add("CREDENTIAL");
  if (/\b(warranty|guarantee(d)?)\b/.test(normalized)) signals.add("WARRANTY");
  if (/\b(our process|how it works)\b/.test(normalized)) signals.add("PROCESS");
  if (/\bcase stud(y|ies)\b/.test(normalized)) signals.add("CASE_STUDY");
}

function collectStructuredDataTypes(
  value: unknown,
  output: Set<string>,
  budget: { nodes: number },
) {
  if (budget.nodes <= 0 || output.size >= 50) return;
  budget.nodes -= 1;
  if (Array.isArray(value)) {
    for (const item of value) collectStructuredDataTypes(item, output, budget);
    return;
  }
  if (!value || typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  const type = record["@type"];
  if (typeof type === "string") output.add(normalizeText(type, 120));
  if (Array.isArray(type)) {
    for (const item of type) {
      if (typeof item === "string" && output.size < 50) output.add(normalizeText(item, 120));
    }
  }
  for (const child of Object.values(record)) collectStructuredDataTypes(child, output, budget);
}

function pageFactsCapture(value: WebsiteCaptureResult) {
  const capture = WebsiteCaptureResultSchema.parse(value);
  if (capture.outcome !== "CAPTURED") throw new Error("HTML facts require a completed website capture.");
  return capture;
}

export async function extractHtmlPageFacts(
  captureValue: WebsiteCaptureResult,
  pageKind: z.infer<typeof WebsitePageKindSchema>,
  policyOverrides: ExtractionPolicy = {},
): Promise<HtmlPageFacts> {
  const capture = pageFactsCapture(captureValue);
  const finalUrl = capture.finalUrl;
  if (!finalUrl) throw new Error("A completed website capture requires a final URL.");
  const kind = WebsitePageKindSchema.parse(pageKind);
  const policy = extractionPolicy(policyOverrides);
  const parser = new SAXParser();
  const stack: Frame[] = [];
  const visibleTextParts: string[] = [];
  const actions: z.infer<typeof HtmlActionFactSchema>[] = [];
  const forms: z.infer<typeof HtmlFormFactSchema>[] = [];
  const trustSignals = new Set<z.infer<typeof WebsiteTrustSignalSchema>>();
  const structuredDataTypes = new Set<string>();
  const links = new Map<string, z.infer<typeof DiscoveredPageLinkSchema>>();
  const warnings = new Set<string>();
  let title = "";
  let metaDescription: string | null = null;
  let visibleTextChars = 0;
  let tokenCount = 0;
  let truncated = false;

  const countToken = () => {
    tokenCount += 1;
    if (tokenCount > policy.maxTokens && !truncated) {
      truncated = true;
      warnings.add("token_limit_reached");
      parser.stop();
    }
    return !truncated;
  };

  const finalizeAction = (candidate: ActionCandidate) => {
    const label = normalizeText(candidate.labelParts.join(" "), 120);
    if (candidate.href) {
      const link = links.get(candidate.href);
      if (link && label) links.set(candidate.href, { ...link, label, kindHint: linkKind(candidate.href, label) });
    }
    if (actions.length >= 100) return;
    const actionKind = classifyAction(label, candidate.href);
    if (!actionKind || (!label && !candidate.href)) return;
    actions.push({
      kind: actionKind,
      label: label || actionKind.toLocaleLowerCase("en-CA"),
      href: candidate.href,
      notExplicitlyHidden: candidate.notExplicitlyHidden,
      aboveFold: "UNKNOWN",
    });
  };

  const finalizeFrame = (frame: Frame) => {
    if (frame.action) finalizeAction(frame.action);
    if (frame.form && forms.length < 30) forms.push(frame.form);
    if (frame.headingParts) addTrustSignals(frame.headingParts.join(" "), trustSignals);
    if (frame.jsonLdParts) {
      if (frame.jsonLdChars >= policy.maxJsonLdChars) warnings.add("json_ld_limit_reached");
      try {
        const parsed = JSON.parse(frame.jsonLdParts.join("")) as unknown;
        collectStructuredDataTypes(parsed, structuredDataTypes, { nodes: 500 });
      } catch {
        warnings.add("invalid_json_ld");
      }
    }
  };

  parser.on("startTag", (token: StartTag) => {
    if (!countToken()) return;
    const tagName = token.tagName.toLocaleLowerCase("en-CA");
    const attributes = attributesOf(token);
    const parentHidden = stack.at(-1)?.hidden || false;
    const hidden = parentHidden || NON_VISIBLE_ELEMENTS.has(tagName) || isExplicitlyHidden(attributes);
    const labelSeed = attributes.get("aria-label") || attributes.get("title") || attributes.get("value") || "";
    const href = normalizedActionHref(attributes.get("href"), finalUrl);
    const isActionElement = tagName === "a" || tagName === "button"
      || (tagName === "input" && ["button", "submit"].includes((attributes.get("type") || "").toLocaleLowerCase("en-CA")));
    const action: ActionCandidate | null = isActionElement
      ? { tagName, href, labelParts: labelSeed ? [labelSeed] : [], notExplicitlyHidden: !hidden }
      : null;

    if (tagName === "meta" && attributes.get("name")?.toLocaleLowerCase("en-CA") === "description") {
      const content = normalizeText(attributes.get("content") || "", 600);
      if (content && !metaDescription) metaDescription = content;
    }

    if (tagName === "a") {
      const absolute = publicUrl(attributes.get("href"), finalUrl);
      if (absolute && new URL(absolute).hostname === new URL(finalUrl).hostname && !links.has(absolute) && links.size < 100) {
        links.set(absolute, { url: absolute, label: normalizeText(labelSeed, 120), kindHint: linkKind(absolute, labelSeed) });
      }
    }

    const activeForm = [...stack].reverse().find((frame) => frame.form)?.form;
    if (
      activeForm &&
      !hidden &&
      !attributes.has("disabled") &&
      ((tagName === "button" && (attributes.get("type") || "submit").toLocaleLowerCase("en-CA") === "submit")
        || (tagName === "input" && ["submit", "image"].includes((attributes.get("type") || "").toLocaleLowerCase("en-CA"))))
    ) {
      activeForm.hasEnabledSubmitControl = true;
    }

    const form: FormCandidate | null = tagName === "form"
      ? {
          actionUrl: publicUrl(attributes.get("action") || finalUrl, finalUrl),
          method: attributes.get("method")?.toLocaleUpperCase("en-CA") === "POST"
            ? "POST"
            : !attributes.get("method") || attributes.get("method")?.toLocaleUpperCase("en-CA") === "GET"
              ? "GET"
              : "OTHER",
          notExplicitlyHidden: !hidden,
          hasEnabledSubmitControl: false,
        }
      : null;

    if (["section", "article", "aside", "blockquote"].includes(tagName)) {
      addTrustSignals(`${attributes.get("id") || ""} ${attributes.get("class") || ""}`, trustSignals);
    }
    if (tagName === "blockquote") trustSignals.add("TESTIMONIAL");

    const isJsonLd = tagName === "script"
      && attributes.get("type")?.split(";", 1)[0]?.trim().toLocaleLowerCase("en-CA") === "application/ld+json";
    const frame: Frame = {
      tagName,
      hidden,
      action,
      form,
      headingParts: HEADING_ELEMENTS.has(tagName) ? [] : null,
      jsonLdParts: isJsonLd ? [] : null,
      jsonLdChars: 0,
    };

    if (VOID_ELEMENTS.has(tagName) || token.selfClosing) finalizeFrame(frame);
    else stack.push(frame);
  });

  parser.on("text", (token: Text) => {
    if (!countToken()) return;
    const current = stack.at(-1);
    const normalized = normalizeText(token.text, policy.maxTextChars);
    if (!normalized) return;

    const titleFrame = [...stack].reverse().find((frame) => frame.tagName === "title");
    if (titleFrame && title.length < 300) title = normalizeText(`${title} ${normalized}`, 300);
    const actionFrame = [...stack].reverse().find((frame) => frame.action)?.action;
    if (actionFrame && actionFrame.labelParts.join(" ").length < 240) actionFrame.labelParts.push(normalized);
    const headingFrame = [...stack].reverse().find((frame) => frame.headingParts)?.headingParts;
    if (headingFrame && headingFrame.join(" ").length < 500) headingFrame.push(normalized);
    const jsonLdFrame = [...stack].reverse().find((frame) => frame.jsonLdParts !== null);
    if (jsonLdFrame?.jsonLdParts && jsonLdFrame.jsonLdChars < policy.maxJsonLdChars) {
      const remaining = policy.maxJsonLdChars - jsonLdFrame.jsonLdChars;
      jsonLdFrame.jsonLdParts.push(token.text.slice(0, remaining));
      jsonLdFrame.jsonLdChars += Math.min(token.text.length, remaining);
    }

    if (!current?.hidden && visibleTextChars < policy.maxTextChars) {
      const remaining = policy.maxTextChars - visibleTextChars;
      visibleTextParts.push(normalized.slice(0, remaining));
      visibleTextChars += Math.min(normalized.length + 1, remaining);
      if (visibleTextChars >= policy.maxTextChars) warnings.add("visible_text_limit_reached");
    }
  });

  parser.on("endTag", (token: EndTag) => {
    if (!countToken()) return;
    const tagName = token.tagName.toLocaleLowerCase("en-CA");
    const index = stack.findLastIndex((frame) => frame.tagName === tagName);
    if (index < 0) return;
    const removed = stack.splice(index);
    for (const frame of removed.reverse()) finalizeFrame(frame);
  });

  await new Promise<void>((resolve, reject) => {
    parser.once("finish", resolve);
    parser.once("error", reject);
    parser.end(capture.html);
  });
  for (const frame of stack.splice(0).reverse()) finalizeFrame(frame);

  const visibleText = normalizeText(visibleTextParts.join(" "), policy.maxTextChars);
  return HtmlPageFactsSchema.parse({
    extractorVersion: HTML_PAGE_FACTS_VERSION,
    captureVersion: capture.captureVersion,
    capturedAt: capture.capturedAt,
    pageKind: kind,
    url: finalUrl,
    title: title || null,
    metaDescription,
    visibleText,
    actions,
    forms,
    trustSignals: [...trustSignals].sort(),
    structuredDataTypes: [...structuredDataTypes].filter(Boolean).sort(),
    discoveredInternalLinks: [...links.values()],
    complete: !truncated,
    warnings: [...warnings],
    policy,
    tokenCount,
  });
}
