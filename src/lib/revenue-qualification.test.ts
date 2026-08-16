import assert from "node:assert/strict";
import test from "node:test";

import { buildRevenueQualification } from "@/lib/revenue-qualification";

const strongBreakdown = {
  businessValue: 22,
  localFit: 11,
  painOpportunity: 30,
  reachability: 15,
};

test("strong account without email keeps its value and routes to phone", () => {
  const result = buildRevenueQualification({
    emailReady: false,
    hardDisqualified: false,
    hasContactForm: true,
    hasSocialMessaging: false,
    legacyScore: 78,
    phone: "+1 (416) 555-0182",
    phoneConfidence: 0.9,
    reasonCodes: ["weak_website"],
    scoreBreakdown: strongBreakdown,
    websiteLabel: "Weak Website",
    websiteStatus: "ACTIVE",
  });

  assert.equal(result.recommendedChannel, "PHONE");
  assert.equal(result.band, "PRIORITY");
  assert.equal(result.autonomousEmailEligible, false);
  assert(result.totalScore >= 70);
});

test("email readiness controls channel, not the underlying business score", () => {
  const email = buildRevenueQualification({
    emailReady: true,
    hardDisqualified: false,
    hasContactForm: false,
    hasSocialMessaging: false,
    legacyScore: 78,
    scoreBreakdown: strongBreakdown,
  });
  const research = buildRevenueQualification({
    emailReady: false,
    hardDisqualified: false,
    hasContactForm: false,
    hasSocialMessaging: false,
    legacyScore: 78,
    scoreBreakdown: strongBreakdown,
  });

  assert.equal(email.totalScore, research.totalScore);
  assert.equal(email.recommendedChannel, "EMAIL");
  assert.equal(email.autonomousEmailEligible, true);
  assert.equal(research.recommendedChannel, "RESEARCH");
  assert.equal(research.band, "REVIEW");
});

test("hard gates remain separate from score", () => {
  const result = buildRevenueQualification({
    emailReady: true,
    hardDisqualified: true,
    hasContactForm: true,
    hasSocialMessaging: true,
    legacyScore: 90,
    scoreBreakdown: strongBreakdown,
  });

  assert.equal(result.hardGateStatus, "DISQUALIFIED");
  assert.equal(result.band, "RESEARCH");
  assert.equal(result.autonomousEmailEligible, false);
});
