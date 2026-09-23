import assert from "node:assert/strict";
import test from "node:test";

import {
  buildM2OwnerIdentityDecisionLedger,
  emptyM2OwnerIdentityDraft,
  isM2OwnerIdentityDecisionComplete,
  m2OwnerIdentityAlternateKey,
  type M2OwnerIdentityDraftMap,
  type M2OwnerIdentityReadyPacket,
} from "./m2-owner-identity-review-ledger";

const packet: M2OwnerIdentityReadyPacket = {
  status: "READY",
  packetSha256: "a".repeat(64),
  selected: Array.from({ length: 10 }, (_, index) => ({
    reviewId: `M2-${String(index + 1).padStart(2, "0")}`,
    name: `Synthetic business ${index + 1}`,
    officialWebsite: `https://business-${index + 1}.example.test/`,
    primarySource: `https://business-${index + 1}.example.test/about`,
    city: "KITCHENER",
    niche: "ROOFING",
    independenceClaim: "Synthetic independent local business.",
    accessBlocked: index === 5 || index === 9,
  })),
  supportedAlternates: [{
    name: "Synthetic alternative",
    officialWebsite: "https://alternate.example.test/",
    sourceUrl: "https://alternate.example.test/about",
    reason: "Synthetic replacement evidence.",
  }],
};

const confirmations = {
  identityConfirmed: true,
  marketAndNicheConfirmed: true,
  independenceConfirmed: true,
};

function completeDrafts(): M2OwnerIdentityDraftMap {
  return Object.fromEntries(packet.selected.map((candidate) => [candidate.reviewId, {
    ...emptyM2OwnerIdentityDraft(),
    action: candidate.accessBlocked ? "KEEP_AS_BLOCKED" : "KEEP",
    rationale: "Synthetic identity and market evidence were reviewed.",
    ...confirmations,
  }])) as M2OwnerIdentityDraftMap;
}

test("access-blocked identities require KEEP_AS_BLOCKED and normal identities cannot use it", () => {
  const blocked = packet.selected[5]!;
  const normal = packet.selected[0]!;
  const draft = { ...emptyM2OwnerIdentityDraft(), action: "KEEP" as const, rationale: "Reviewed identity evidence.", ...confirmations };
  assert.equal(isM2OwnerIdentityDecisionComplete(blocked, draft, packet.supportedAlternates), false);
  assert.equal(isM2OwnerIdentityDecisionComplete(normal, { ...draft, action: "KEEP_AS_BLOCKED" }, packet.supportedAlternates), false);
  assert.equal(isM2OwnerIdentityDecisionComplete(blocked, { ...draft, action: "KEEP_AS_BLOCKED" }, packet.supportedAlternates), true);
});

test("replacement requires an exact supported alternate, city, niche, confirmations and reason", () => {
  const candidate = packet.selected[0]!;
  const incomplete = {
    ...emptyM2OwnerIdentityDraft(),
    action: "REPLACE" as const,
    rationale: "The proposed business is outside scope.",
    alternateKey: JSON.stringify(["An unsupported business", "https://unsupported.example.test/", "https://unsupported.example.test/about"]),
    city: "CAMBRIDGE" as const,
    niche: "HVAC" as const,
    ...confirmations,
  };
  assert.equal(isM2OwnerIdentityDecisionComplete(candidate, incomplete, packet.supportedAlternates), false);
  const complete = { ...incomplete, alternateKey: m2OwnerIdentityAlternateKey(packet.supportedAlternates[0]!) };
  assert.equal(isM2OwnerIdentityDecisionComplete(candidate, complete, packet.supportedAlternates), true);
});

test("replacement choice binds the exact website and source when names are duplicated", () => {
  const exactPacket: M2OwnerIdentityReadyPacket = {
    ...packet,
    supportedAlternates: [
      packet.supportedAlternates[0]!,
      { ...packet.supportedAlternates[0]!, officialWebsite: "https://alternate-copy.example.test/", sourceUrl: "https://alternate-copy.example.test/about" },
    ],
  };
  const drafts = completeDrafts();
  drafts["M2-01"] = {
    ...drafts["M2-01"]!,
    action: "REPLACE",
    rationale: "Use the second supported identity with its own source.",
    alternateKey: m2OwnerIdentityAlternateKey(exactPacket.supportedAlternates[1]!),
    city: "CAMBRIDGE",
    niche: "HVAC",
  };
  const ledger = buildM2OwnerIdentityDecisionLedger({
    packet: exactPacket,
    reviewedBy: "RILEY",
    reviewedAt: "2026-09-23T13:14:15.000Z",
    drafts,
  });
  const decision = ledger.decisions[0] as { replacement: { websiteUrl: string; sourceEvidenceUrl: string } };
  assert.equal(decision.replacement.websiteUrl, "https://alternate-copy.example.test/");
  assert.equal(decision.replacement.sourceEvidenceUrl, "https://alternate-copy.example.test/about");
});

test("ledger export is strict, binds the packet bytes and omits sourcePlanDigest", () => {
  const drafts = completeDrafts();
  drafts["M2-01"] = {
    ...drafts["M2-01"]!,
    action: "REPLACE",
    rationale: "The original candidate does not fit the reviewed market.",
    alternateKey: m2OwnerIdentityAlternateKey(packet.supportedAlternates[0]!),
    city: "CAMBRIDGE",
    niche: "HVAC",
  };
  const ledger = buildM2OwnerIdentityDecisionLedger({
    packet,
    reviewedBy: "AIDAN",
    reviewedAt: "2026-09-23T13:14:15.000Z",
    drafts,
  });
  assert.deepEqual(Object.keys(ledger), ["decisionVersion", "researchReviewSha256", "reviewedBy", "reviewedAt", "decisions"]);
  assert.equal(ledger.decisionVersion, "kw-m2-owner-decisions-v1");
  assert.equal(ledger.researchReviewSha256, packet.packetSha256);
  assert.equal("sourcePlanDigest" in ledger, false);
  assert.equal(ledger.decisions.length, 10);
  assert.deepEqual(ledger.decisions[0], {
    reviewId: "M2-01",
    action: "REPLACE",
    rationale: "The original candidate does not fit the reviewed market.",
    replacement: {
      name: "Synthetic alternative",
      city: "CAMBRIDGE",
      niche: "HVAC",
      sourceEvidenceUrl: "https://alternate.example.test/about",
      websiteUrl: "https://alternate.example.test/",
      ...confirmations,
      rationale: "The original candidate does not fit the reviewed market.",
    },
  });
  assert.equal((ledger.decisions[5] as { action?: string }).action, "KEEP_AS_BLOCKED");
  assert.equal((ledger.decisions[9] as { action?: string }).action, "KEEP_AS_BLOCKED");
  assert.throws(() => buildM2OwnerIdentityDecisionLedger({ packet, reviewedBy: null, reviewedAt: "2026-09-23T13:14:15.000Z", drafts }), /Choose Riley or Aidan/);
  assert.throws(() => buildM2OwnerIdentityDecisionLedger({ packet, reviewedBy: "RILEY", reviewedAt: "yesterday", drafts }), /ISO timestamp/);
});

test("incomplete rows and KEEP on a blocked identity cannot be exported", () => {
  const drafts = completeDrafts();
  const incomplete = { ...drafts, "M2-01": { ...drafts["M2-01"]!, rationale: "too short" } };
  assert.throws(() => buildM2OwnerIdentityDecisionLedger({ packet, reviewedBy: "RILEY", reviewedAt: "2026-09-23T13:14:15.000Z", drafts: incomplete }), /Finish the review for M2-01/);

  const incorrectlyKept = { ...drafts, "M2-06": { ...drafts["M2-06"]!, action: "KEEP" as const } };
  assert.throws(() => buildM2OwnerIdentityDecisionLedger({ packet, reviewedBy: "RILEY", reviewedAt: "2026-09-23T13:14:15.000Z", drafts: incorrectlyKept }), /Finish the review for M2-06/);
});

test("an unsupported replacement cannot be exported", () => {
  const drafts = completeDrafts();
  drafts["M2-01"] = {
    ...drafts["M2-01"]!,
    action: "REPLACE",
    rationale: "The proposed business does not belong in this review.",
    alternateKey: JSON.stringify(["Unsupported synthetic business", "https://unsupported.example.test/", "https://unsupported.example.test/about"]),
    city: "CAMBRIDGE",
    niche: "HVAC",
  };
  assert.throws(() => buildM2OwnerIdentityDecisionLedger({ packet, reviewedBy: "AIDAN", reviewedAt: "2026-09-23T13:14:15.000Z", drafts }), /Finish the review for M2-01/);
});

test("review rationale longer than the strict schema limit is incomplete", () => {
  const candidate = packet.selected[0]!;
  const draft = { ...emptyM2OwnerIdentityDraft(), action: "HOLD" as const, rationale: "x".repeat(501) };
  assert.equal(isM2OwnerIdentityDecisionComplete(candidate, draft, packet.supportedAlternates), false);
});
