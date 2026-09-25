import assert from "node:assert/strict";
import test from "node:test";

import {
  emptyM2OwnerIdentityDraft,
  m2OwnerIdentityAlternateKey,
  type M2OwnerIdentityDraftMap,
  type M2OwnerIdentityReadyPacket,
} from "@/components/leads/m2-owner-identity-review-ledger";
import { buildValidatedM2OwnerIdentitySaveCommand } from "./m2-owner-identity-save-command";

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

const reviewedAt = "2026-09-23T14:15:00.000Z";
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

function input(drafts = completeDrafts()) {
  return { packetSha256: packet.packetSha256, reviewedBy: "RILEY", drafts };
}

test("builds a schema-valid save command for the exact synthetic packet and actor", () => {
  const command = buildValidatedM2OwnerIdentitySaveCommand(input(), packet, "RILEY", reviewedAt);
  assert.equal(command.researchReviewSha256, packet.packetSha256);
  assert.equal(command.reviewedBy, "RILEY");
  assert.equal(command.reviewedAt, reviewedAt);
  assert.equal(command.decisions.length, 10);
  assert.equal(command.decisions[5]?.action, "KEEP_AS_BLOCKED");
  assert.equal(command.decisions[9]?.action, "KEEP_AS_BLOCKED");
});

test("rejects stale packet digests and reviewer spoofing", () => {
  assert.throws(() => buildValidatedM2OwnerIdentitySaveCommand(
    { ...input(), packetSha256: "b".repeat(64) }, packet, "RILEY", reviewedAt,
  ), /current research packet digest/i);
  assert.throws(() => buildValidatedM2OwnerIdentitySaveCommand(
    { ...input(), reviewedBy: "AIDAN" }, packet, "RILEY", reviewedAt,
  ), /authenticated reviewer/i);
});

test("requires exactly the ten packet review IDs and rejects extra or missing drafts", () => {
  const missing = completeDrafts();
  delete missing["M2-10"];
  assert.throws(() => buildValidatedM2OwnerIdentitySaveCommand(input(missing), packet, "RILEY", reviewedAt), /exactly M2-01 through M2-10/i);

  const extra = { ...completeDrafts(), "M2-11": emptyM2OwnerIdentityDraft() };
  assert.throws(() => buildValidatedM2OwnerIdentitySaveCommand(input(extra), packet, "RILEY", reviewedAt), /exactly M2-01 through M2-10/i);
});

test("requires strict input and draft shapes with bounded rationale and alternate key", () => {
  assert.throws(() => buildValidatedM2OwnerIdentitySaveCommand(
    { ...input(), extra: true }, packet, "RILEY", reviewedAt,
  ));
  const extraDraft = { ...completeDrafts(), "M2-01": { ...completeDrafts()["M2-01"]!, extra: true } };
  assert.throws(() => buildValidatedM2OwnerIdentitySaveCommand(input(extraDraft), packet, "RILEY", reviewedAt));

  const tooLong = completeDrafts();
  tooLong["M2-01"] = { ...tooLong["M2-01"]!, rationale: "x".repeat(501) };
  assert.throws(() => buildValidatedM2OwnerIdentitySaveCommand(input(tooLong), packet, "RILEY", reviewedAt));
  const oversizedAlternate = completeDrafts();
  oversizedAlternate["M2-01"] = { ...oversizedAlternate["M2-01"]!, alternateKey: "x".repeat(10_001) };
  assert.throws(() => buildValidatedM2OwnerIdentitySaveCommand(input(oversizedAlternate), packet, "RILEY", reviewedAt));

  const invalidCity = completeDrafts();
  invalidCity["M2-01"] = { ...invalidCity["M2-01"]!, city: "TORONTO" as never };
  assert.throws(() => buildValidatedM2OwnerIdentitySaveCommand(input(invalidCity), packet, "RILEY", reviewedAt));
  const invalidNiche = completeDrafts();
  invalidNiche["M2-01"] = { ...invalidNiche["M2-01"]!, niche: "PLUMBING" as never };
  assert.throws(() => buildValidatedM2OwnerIdentitySaveCommand(input(invalidNiche), packet, "RILEY", reviewedAt));
  const invalidAction = completeDrafts();
  invalidAction["M2-01"] = { ...invalidAction["M2-01"]!, action: "APPROVE" as never };
  assert.throws(() => buildValidatedM2OwnerIdentitySaveCommand(input(invalidAction), packet, "RILEY", reviewedAt));
});

test("rejects invalid blocked decisions, unsupported replacements, and missing confirmations", () => {
  const blockedKeep = completeDrafts();
  blockedKeep["M2-06"] = { ...blockedKeep["M2-06"]!, action: "KEEP" };
  assert.throws(() => buildValidatedM2OwnerIdentitySaveCommand(input(blockedKeep), packet, "RILEY", reviewedAt), /Finish the review for M2-06/i);

  const unsupportedReplacement = completeDrafts();
  unsupportedReplacement["M2-01"] = {
    ...unsupportedReplacement["M2-01"]!,
    action: "REPLACE",
    alternateKey: JSON.stringify(["Other synthetic business", "https://other.example.test/", "https://other.example.test/about"]),
    city: "CAMBRIDGE",
    niche: "HVAC",
  };
  assert.throws(() => buildValidatedM2OwnerIdentitySaveCommand(input(unsupportedReplacement), packet, "RILEY", reviewedAt), /Finish the review for M2-01/i);

  const missingConfirmation = completeDrafts();
  missingConfirmation["M2-01"] = { ...missingConfirmation["M2-01"]!, independenceConfirmed: false };
  assert.throws(() => buildValidatedM2OwnerIdentitySaveCommand(input(missingConfirmation), packet, "RILEY", reviewedAt), /Finish the review for M2-01/i);

  const missingReason = completeDrafts();
  missingReason["M2-01"] = { ...missingReason["M2-01"]!, rationale: "short" };
  assert.throws(() => buildValidatedM2OwnerIdentitySaveCommand(input(missingReason), packet, "RILEY", reviewedAt), /Finish the review for M2-01/i);
});

test("binds a replacement to one supported alternate and its chosen market", () => {
  const drafts = completeDrafts();
  drafts["M2-01"] = {
    ...drafts["M2-01"]!,
    action: "REPLACE",
    alternateKey: m2OwnerIdentityAlternateKey(packet.supportedAlternates[0]!),
    city: "CAMBRIDGE",
    niche: "HVAC",
  };
  const command = buildValidatedM2OwnerIdentitySaveCommand(input(drafts), packet, "RILEY", reviewedAt);
  assert.deepEqual(command.decisions[0], {
    reviewId: "M2-01",
    action: "REPLACE",
    rationale: "Synthetic identity and market evidence were reviewed.",
    replacement: {
      name: "Synthetic alternative",
      city: "CAMBRIDGE",
      niche: "HVAC",
      sourceEvidenceUrl: "https://alternate.example.test/about",
      websiteUrl: "https://alternate.example.test/",
      ...confirmations,
      rationale: "Synthetic identity and market evidence were reviewed.",
    },
  });
});
