import { strict as assert } from "node:assert";
import test from "node:test";

import {
  buildFollowUpContextForTesting,
  buildInitialEmailForTesting,
  buildMessageEvidenceForTesting,
  buildMessageExperimentForTesting,
  CAMPAIGN_KEY,
  hasReliableOutreachEvidenceForTesting,
  MESSAGE_POLICY_VERSION,
  validateEvidenceBoundCopy,
} from "./outreach-email-generator";
import type { EnrichmentResult } from "./outreach-enrichment";
import type { LeadRecord } from "./prisma";

function makeLead(): LeadRecord {
  const now = new Date("2026-01-01T12:00:00.000Z");
  return {
    id: 101,
    businessName: "Village Dallas",
    niche: "Masonry",
    city: "Nashville",
    category: "Masonry",
    address: null,
    phone: null,
    email: "owner@villagedallas.ca",
    socialLink: null,
    websiteUrl: "https://villagedallas.ca",
    websiteDomain: "villagedallas.ca",
    rating: 4.9,
    reviewCount: 37,
    websiteStatus: "ACTIVE",
    contactName: null,
    tacticalNote: "Lead with the missing service-area proof and unclear quote path.",
    leadScore: null,
    websiteGrade: "C",
    axiomScore: 72,
    axiomTier: "B",
    scoreBreakdown: null,
    painSignals: JSON.stringify([
      {
        type: "conversion",
        severity: 7,
        source: "website",
        evidence: "The contact path is buried below project photos.",
      },
    ]),
    callOpener: null,
    followUpQuestion: null,
    axiomWebsiteAssessment: JSON.stringify({
      overallGrade: "C",
      speedRisk: 3,
      conversionRisk: 7,
      trustRisk: 4,
      seoRisk: 5,
      topFixes: ["Move quote CTA above the fold", "Add service-area proof"],
    }),
    dedupeKey: null,
    dedupeMatchedBy: null,
    emailType: "owner",
    emailConfidence: 0.95,
    emailFlags: null,
    phoneConfidence: null,
    phoneFlags: null,
    disqualifiers: null,
    disqualifyReason: null,
    outreachStatus: "OUTREACHED",
    outreachChannel: "EMAIL",
    firstContactedAt: now,
    lastContactedAt: now,
    nextFollowUpDue: null,
    outreachNotes: null,
    enrichedAt: now,
    enrichmentData: "{}",
    source: "test",
    isArchived: false,
    createdAt: now,
    lastUpdated: now,
    dealStage: null,
    engagementType: null,
    monthlyValue: null,
    proposalValue: null,
    proposalStatus: null,
    packageRecommendation: null,
    projectStartDate: null,
    launchTargetDate: null,
    projectOwner: null,
    renewalDate: null,
    projectNotes: null,
    nextAction: null,
    nextActionDueAt: null,
    lastReplyAt: null,
    dealHealth: null,
    dealLostReason: null,
    proposalSentAt: null,
    signedAt: null,
    clientPriority: null,
  };
}

const enrichment: EnrichmentResult = {
  valueProposition: "Turn more site visits into quote requests.",
  pitchAngle: "Small conversion cleanup tied to the current masonry site.",
  keyPainPoint: "the quote path is hard to find from the homepage",
  competitiveEdge: "clearer local proof and fewer clicks to contact",
  personalizedHook: "The site shows project work, but the path to ask for a quote is easy to miss.",
  recommendedCTA: "Ask whether sending two specific fixes would be useful.",
  emailTone: "casual",
  anticipatedObjections: ["Already has a site", "Too busy to review a redesign"],
  enrichmentSummary: "Current site needs a clearer quote path and local proof.",
};

test("follow-up context surfaces enrichment + prior email so the model can build on real signal", () => {
  const context = buildFollowUpContextForTesting(
    makeLead(),
    enrichment,
    "Riley Hinsperger",
    {
      subject: "Old generic subject",
      bodyPlain: "Your 5-star reviews are a strong asset and should be higher on the homepage.",
      sentAt: "2026-01-01T12:00:00.000Z",
    },
    "FOLLOW_UP_1",
  );

  assert(context.includes("STEP TYPE: FOLLOW_UP_1"));
  assert(context.includes("PRIOR EMAIL SUBJECT"));
  assert(context.includes("PRIOR EMAIL BODY"));
  assert(context.includes(enrichment.keyPainPoint));
  assert(context.includes(enrichment.personalizedHook));
});

test("initial test-helper email is grounded, plain text, and signs off as the sender", () => {
  const lead = {
    ...makeLead(),
    id: 3935,
    businessName: "Vancouver Green Electric Ltd",
    niche: "electrician",
    city: "Vancouver",
    category: "Electrician",
    contactName: null,
    reviewCount: 996558,
    rating: 5,
    websiteUrl: "https://vge.limited",
    websiteDomain: "vge.limited",
    painSignals: JSON.stringify([
      {
        type: "CONTACT",
        severity: 7,
        source: "website",
        evidence: "Quote request path could be clearer for mobile visitors.",
      },
    ]),
    axiomWebsiteAssessment: JSON.stringify({
      overallGrade: "C",
      speedRisk: 3,
      conversionRisk: 7,
      trustRisk: 4,
      seoRisk: 3,
      topFixes: ["Make the quote request easier to find", "Clarify service areas"],
    }),
  } satisfies LeadRecord;

  const email = buildInitialEmailForTesting(lead, enrichment, "Aidan Magee");
  const combined = `${email.subject}\n${email.bodyPlain}`;

  // Subject must keep business-name casing intact even when the helper
  // truncates to fit 8 tokens.
  assert.match(email.subject, /Vancouver Green Electric/);
  assert(email.bodyPlain.includes("Vancouver Green Electric Ltd"));
  // Suspicious review counts must be hidden.
  assert(!combined.includes("996558"));
  // Plain text only, ends with the sender first name signoff.
  assert(!combined.includes("!"));
  assert(!/[—–]/.test(combined));
  assert(!/<[a-z][^>]*>/i.test(combined));
  assert.match(email.bodyPlain, /Best,\nAidan$/);
});

test("subject casing is restored when LLM truncates a multi-word business name", () => {
  const lead = {
    ...makeLead(),
    businessName: "Raise the Roof Roofing & Repair Ltd.",
  } satisfies LeadRecord;

  const email = buildInitialEmailForTesting(lead, enrichment, "Aidan");
  // sanitizeSubject runs internally — assert the casing of the full name
  // segment that appears in the subject is preserved, not lowercased.
  // The subject helper composes "Quick thought on Raise the Roof Roofing & Repair Ltd.";
  // after the 8-word slice it becomes "Quick thought on Raise the Roof Roofing".
  assert.match(email.subject, /Raise the Roof/);
  assert(!/raise the roof(?!\w)/.test(email.subject));
});

test("subject casing tolerates unicode characters in the business name", () => {
  const lead = {
    ...makeLead(),
    businessName: "Plomberie Longpré",
  } satisfies LeadRecord;

  const email = buildInitialEmailForTesting(lead, enrichment, "Aidan");
  assert.match(email.subject, /Plomberie Longpré/);
});

test("single-token business names get caps restored when the LLM lowercases them", () => {
  const lead = {
    ...makeLead(),
    businessName: "Plumberoos Inc",
  } satisfies LeadRecord;

  const email = buildInitialEmailForTesting(lead, enrichment, "Aidan");
  assert.match(email.subject, /Plumberoos/);
  assert(!/plumberoos(?!\w)/.test(email.subject));
});

test("business names with ampersand restore every word's casing", () => {
  const lead = {
    ...makeLead(),
    businessName: "Drain & Inspection Services",
  } satisfies LeadRecord;

  const email = buildInitialEmailForTesting(lead, enrichment, "Aidan");
  assert.match(email.subject, /Drain & Inspection/);
  assert(!/inspection(?!\w)/.test(email.subject.replace(/Inspection/g, "")));
});

test("evidence policy rejects unsupported revenue, visitor, competitor, and timeline claims", () => {
  const rejected = [
    "This is costing you same-day calls.",
    "Visitors go to the next result.",
    "We will increase booked jobs.",
    "Most of your competitors already have this.",
    "We can fix it within two weeks.",
  ];

  for (const copy of rejected) {
    assert.equal(validateEvidenceBoundCopy(copy).valid, false, copy);
  }

  assert.equal(
    validateEvidenceBoundCopy("The contact option is hard to find, which can add friction for a visitor on a phone.").valid,
    true,
  );
});

test("message evidence and experiment assignment are deterministic and auditable", () => {
  const lead = makeLead();
  const firstAssignment = buildMessageExperimentForTesting(lead);
  const repeatedAssignment = buildMessageExperimentForTesting(lead);
  const evidence = buildMessageEvidenceForTesting(lead, enrichment);
  const email = buildInitialEmailForTesting(lead, enrichment, "Aidan");

  assert.deepEqual(firstAssignment, repeatedAssignment);
  assert.equal(firstAssignment.campaignKey, CAMPAIGN_KEY);
  assert.equal(firstAssignment.policyVersion, MESSAGE_POLICY_VERSION);
  assert.match(firstAssignment.variantKey, /^initial__opener_[a-f]__cta_/);
  assert(evidence.items.some((item) => item.source === "website_assessment" && item.field === "top_fix_1"));
  assert.equal(email.messagePolicyVersion, MESSAGE_POLICY_VERSION);
  assert.equal(email.campaignKey, CAMPAIGN_KEY);
  assert.equal(email.variantKey, firstAssignment.variantKey);
  assert.equal(email.validationStatus, "PASSED");
  assert.doesNotThrow(() => JSON.parse(email.evidenceJson));
});

test("generic enrichment alone is not enough to authorize outreach copy", () => {
  const weakLead = {
    ...makeLead(),
    painSignals: null,
    axiomWebsiteAssessment: JSON.stringify({
      overallGrade: "B",
      speedRisk: 2,
      conversionRisk: 2,
      trustRisk: 2,
      seoRisk: 2,
      topFixes: ["Keep the main offer and next step easy to scan"],
    }),
  } satisfies LeadRecord;
  const missingWebsiteLead = {
    ...weakLead,
    websiteStatus: "MISSING",
    websiteUrl: null,
  } satisfies LeadRecord;

  assert.equal(hasReliableOutreachEvidenceForTesting(buildMessageEvidenceForTesting(weakLead, enrichment)), false);
  assert.equal(hasReliableOutreachEvidenceForTesting(buildMessageEvidenceForTesting(missingWebsiteLead, enrichment)), true);
});
