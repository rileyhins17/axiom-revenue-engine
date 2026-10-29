import assert from "node:assert/strict";
import test from "node:test";

import type { M2WebsiteNeedAssessment } from "./m2-website-need-assessment";
import { parseM3Selection, ruleLabel, summarizeM3Evaluation, type M3Case } from "./m3-website-need-evaluation";

function item(index: number, need: M2WebsiteNeedAssessment["websiteNeed"], reviewerLabel: M3Case["reviewerLabel"]): M3Case {
  const cities = ["KITCHENER", "WATERLOO", "CAMBRIDGE"] as const;
  const niches = ["ROOFING", "HVAC", "LANDSCAPING"] as const;
  return { reviewId: `M3-${String(index + 1).padStart(2, "0")}`, businessName: `Synthetic ${index}`, city: cities[index % 3]!, niche: niches[Math.floor(index / 3) % 3]!, assessment: { websiteNeed: need } as M2WebsiteNeedAssessment, reviewerLabel };
}

test("the rule label sees only website need", () => {
  assert.equal(ruleLabel("REBUILD"), "STRONG");
  assert.equal(ruleLabel("MINOR_IMPROVEMENT"), "WEAK");
  assert.equal(ruleLabel("NO_OPPORTUNITY"), "WEAK");
});

test("summary reports balance, agreement, class metrics and disagreements honestly", () => {
  const cases = Array.from({ length: 50 }, (_, index) => item(index, index < 4 ? "REBUILD" : "NO_OPPORTUNITY", index < 6 ? "STRONG" : index < 8 ? "WRONG" : "WEAK"));
  const summary = summarizeM3Evaluation(cases);
  assert.equal(summary.complete, true);
  assert.equal(summary.balanced, true);
  assert.deepEqual(summary.ruleAgreement, { agreements: 46, total: 50, percent: 92 });
  const strong = summary.classes.find((entry) => entry.label === "STRONG")!;
  assert.equal(strong.recall, 4 / 6);
  assert.equal(strong.precision, 1);
  assert.equal(summary.classes.find((entry) => entry.label === "WRONG")!.precision, null);
  assert.equal(summary.disagreements.length, 4);
  assert.equal(summary.ownerAgreement, "NOT_MEASURED");
});

test("an unbalanced or incomplete set is reported as such", () => {
  const summary = summarizeM3Evaluation(Array.from({ length: 12 }, (_, index) => ({ ...item(index, "REBUILD", "STRONG"), city: "KITCHENER" as const })));
  assert.equal(summary.complete, false);
  assert.equal(summary.balanced, false);
});

test("the selection must match its pinned digest", () => {
  assert.throws(() => parseM3Selection(new TextEncoder().encode("{}")), /recorded digest/);
});
