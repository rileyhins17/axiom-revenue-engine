import { strict as assert } from "node:assert";
import test from "node:test";

import { buildFallbackEnrichment } from "./outreach-enrichment";
import type { LeadRecord } from "./prisma";

function lead(overrides: Partial<LeadRecord>): LeadRecord {
  return {
    businessName: "North Shore Plumbing",
    websiteStatus: "ACTIVE",
    websiteUrl: "https://northshore.example",
    ...overrides,
  } as LeadRecord;
}

test("fallback enrichment does not fabricate a site issue or competitor outcome", () => {
  const result = buildFallbackEnrichment(lead({}));
  const combined = Object.values(result).flat().join(" ");

  assert.match(result.keyPainPoint, /no reliable website-specific issue/i);
  assert.match(result.competitiveEdge, /no competitor comparison is supported/i);
  assert(!/nearby competitors|leaving.*on the table|quick look|more calls|lost? leads?/i.test(combined));
});

test("missing-site fallback uses the stored absence as its only outreach fact", () => {
  const result = buildFallbackEnrichment(lead({ websiteStatus: "MISSING", websiteUrl: null }));

  assert.match(result.keyPainPoint, /no website is linked/i);
  assert.match(result.personalizedHook, /could not find a website linked/i);
  assert.match(result.enrichmentSummary, /only fallback fact eligible/i);
});
