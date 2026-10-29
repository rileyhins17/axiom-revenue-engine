import { z } from "zod";

import { HtmlPageFactsSchema, type HtmlPageFacts } from "@/lib/revenue-engine/html-page-facts";
import {
  WebsiteActionKindSchema,
  WebsiteTrustSignalSchema,
} from "@/lib/revenue-engine/website-audit";

export const PRIVATE_KW_HTML_STRUCTURE_VERSION = "kw-html-structure-v1";

const HTML_FACTS_ACTION_CAP = 100;
const HTML_FACTS_FORM_CAP = 30;
const HTML_FACTS_TRUST_SIGNAL_CAP = 50;
const HTML_FACTS_INTERNAL_LINK_CAP = 100;

const InternalLinkKindSchema = z.enum(["HOME", "SERVICE", "ABOUT", "CONTACT", "OTHER"]);

export const PrivateKwHtmlStructureSchema = z
  .object({
    version: z.literal(PRIVATE_KW_HTML_STRUCTURE_VERSION),
    hasTitle: z.boolean(),
    hasMetaDescription: z.boolean(),
    actionKinds: z.array(WebsiteActionKindSchema).max(HTML_FACTS_ACTION_CAP),
    formCount: z.number().int().min(0).max(HTML_FACTS_FORM_CAP),
    formsWithEnabledSubmitCount: z.number().int().min(0).max(HTML_FACTS_FORM_CAP),
    trustSignals: z.array(WebsiteTrustSignalSchema).max(HTML_FACTS_TRUST_SIGNAL_CAP),
    internalLinkKindCounts: z
      .object({
        HOME: z.number().int().min(0).max(HTML_FACTS_INTERNAL_LINK_CAP),
        SERVICE: z.number().int().min(0).max(HTML_FACTS_INTERNAL_LINK_CAP),
        ABOUT: z.number().int().min(0).max(HTML_FACTS_INTERNAL_LINK_CAP),
        CONTACT: z.number().int().min(0).max(HTML_FACTS_INTERNAL_LINK_CAP),
        OTHER: z.number().int().min(0).max(HTML_FACTS_INTERNAL_LINK_CAP),
      })
      .strict(),
  })
  .strict()
  .superRefine((structure, context) => {
    if (structure.formsWithEnabledSubmitCount > structure.formCount) {
      context.addIssue({
        code: "custom",
        message: "Enabled submit forms cannot exceed the total form count.",
        path: ["formsWithEnabledSubmitCount"],
      });
    }
    if (new Set(structure.actionKinds).size !== structure.actionKinds.length) {
      context.addIssue({ code: "custom", message: "Action kinds must be unique.", path: ["actionKinds"] });
    }
    if (new Set(structure.trustSignals).size !== structure.trustSignals.length) {
      context.addIssue({ code: "custom", message: "Trust signals must be unique.", path: ["trustSignals"] });
    }
    if (!isSorted(structure.actionKinds) || !isSorted(structure.trustSignals)) {
      context.addIssue({ code: "custom", message: "Kind arrays must be sorted.", path: ["actionKinds"] });
    }
    if (Object.values(structure.internalLinkKindCounts).reduce((total, count) => total + count, 0) > HTML_FACTS_INTERNAL_LINK_CAP) {
      context.addIssue({
        code: "custom",
        message: "Internal link kind counts cannot exceed the extractor link cap.",
        path: ["internalLinkKindCounts"],
      });
    }
  });

export type PrivateKwHtmlStructure = z.infer<typeof PrivateKwHtmlStructureSchema>;

function isSorted(values: string[]): boolean {
  return values.every((value, index) => index === 0 || values[index - 1] <= value);
}

/** Projects extractor facts into a deliberately text-free structural summary. */
export function projectPrivateKwHtmlStructure(factsValue: HtmlPageFacts): PrivateKwHtmlStructure {
  const facts = HtmlPageFactsSchema.parse(factsValue);
  const internalLinkKindCounts: PrivateKwHtmlStructure["internalLinkKindCounts"] = {
    HOME: 0,
    SERVICE: 0,
    ABOUT: 0,
    CONTACT: 0,
    OTHER: 0,
  };

  for (const link of facts.discoveredInternalLinks) {
    const kind = InternalLinkKindSchema.parse(link.kindHint);
    internalLinkKindCounts[kind] += 1;
  }

  return PrivateKwHtmlStructureSchema.parse({
    version: PRIVATE_KW_HTML_STRUCTURE_VERSION,
    hasTitle: facts.title !== null,
    hasMetaDescription: facts.metaDescription !== null,
    actionKinds: [...new Set(facts.actions.map((action) => action.kind))].sort(),
    formCount: facts.forms.length,
    formsWithEnabledSubmitCount: facts.forms.filter((form) => form.hasEnabledSubmitControl).length,
    trustSignals: [...new Set(facts.trustSignals)].sort(),
    internalLinkKindCounts,
  });
}
