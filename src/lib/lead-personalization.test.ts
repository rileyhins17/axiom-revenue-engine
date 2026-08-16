import { strict as assert } from "node:assert";
import test from "node:test";

import { generatePersonalization } from "./lead-personalization";

const baseInput: Parameters<typeof generatePersonalization>[0] = {
  businessName: "North Shore Plumbing",
  niche: "Plumbing",
  city: "Vancouver",
  websiteStatus: "ACTIVE",
  painSignals: [],
  assessment: null,
  contactName: null,
};

test("missing website personalization states only the observed listing fact", () => {
  const result = generatePersonalization({
    ...baseInput,
    websiteStatus: "MISSING",
  });

  assert.equal(result.evidenceLevel, "strong");
  assert.match(result.callOpener, /couldn't find a website linked/i);
  assert(!/competitor|lost? leads?|more calls?|two weeks?|guarantee/i.test(`${result.callOpener} ${result.followUpQuestion}`));
});

test("specific pain signals produce observation-led copy without promises", () => {
  const result = generatePersonalization({
    ...baseInput,
    painSignals: [
      {
        type: "CONVERSION",
        severity: 7,
        evidence: "No quote form was found on the homepage.",
        source: "site_scan",
      },
    ],
    assessment: {
      speedRisk: 2,
      conversionRisk: 7,
      trustRisk: 2,
      seoRisk: 2,
      overallGrade: "C",
      topFixes: ["Make the quote path easier to find"],
    },
  });

  assert.equal(result.evidenceLevel, "strong");
  assert.match(result.callOpener, /website scan/i);
  assert.match(result.callOpener, /quote path/i);
  assert(!/more calls?|within the first month|competitor|will increase|guarantee/i.test(`${result.callOpener} ${result.followUpQuestion}`));
});

test("no reliable issue produces an explicit low-confidence fallback", () => {
  const result = generatePersonalization(baseInput);

  assert.equal(result.evidenceLevel, "none");
  assert.match(result.callOpener, /didn't surface a specific issue reliable enough/i);
  assert(!/quick wins?|more calls?|increase booked|competitor/i.test(`${result.callOpener} ${result.followUpQuestion}`));
});
