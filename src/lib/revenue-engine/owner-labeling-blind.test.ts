import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { PrivateKwOwnerLabelingPacketSchema } from "@/lib/revenue-engine/private-kw-owner-labeling";
import {
  BlindOwnerLabelingPacketSchema,
  OwnerLabelingAssessmentSidecarSchema,
  rejoinOwnerLabelingPacket,
  splitOwnerLabelingPacket,
} from "@/lib/revenue-engine/owner-labeling-blind";
import { privateKwOwnerLabelingCanonicalJson } from "@/lib/revenue-engine/private-kw-owner-labeling";
import { buildCompleteOwnerLabelingPacketFixture } from "@/lib/revenue-engine/test-support/owner-labeling-fixture";

test("split keeps only factual evidence in the blind artifact and rejoins the exact immutable packet", () => {
  const original = buildCompleteOwnerLabelingPacketFixture();
  const { blindPacket, assessmentSidecar } = splitOwnerLabelingPacket(original);

  assert.equal(blindPacket.entries.length, 50);
  assert.deepEqual(blindPacket.summary, { targetSize: 50, loaded: 50, reviewed: 0 });
  assert.equal(blindPacket.entries[0]?.audit.siteState, original.entries[0]?.audit.siteState);
  assert.equal(blindPacket.entries[0]?.audit.claims[0]?.observation, original.entries[0]?.audit.claims[0]?.observation);
  assert.equal(blindPacket.entries[0]?.audit.claims[0]?.sourceUrl, original.entries[0]?.audit.claims[0]?.sourceUrl);
  assert.equal(blindPacket.entries[0]?.audit.claims[0]?.method, original.entries[0]?.audit.claims[0]?.method);
  assert.equal(blindPacket.entries[0]?.audit.claims[0]?.confidence, original.entries[0]?.audit.claims[0]?.confidence);
  assert.equal("engineAssessment" in (blindPacket.entries[0] ?? {}), false);
  assert.equal("classification" in (blindPacket.entries[0]?.audit ?? {}), false);
  assert.equal("rebuildNeedScore" in (blindPacket.entries[0]?.audit ?? {}), false);
  assert.equal("evidenceConfidence" in (blindPacket.entries[0]?.audit ?? {}), false);
  assert.equal("checks" in (blindPacket.entries[0]?.audit ?? {}), false);
  assert.equal("manualReviewReasons" in (blindPacket.entries[0]?.audit ?? {}), false);
  assert.equal("agreementPercent" in blindPacket.summary, false);
  assert.equal("agreements" in blindPacket.summary, false);
  assert.equal("ready" in blindPacket.summary, false);
  assert.equal("gateReasons" in blindPacket.summary, false);
  assert.doesNotMatch(JSON.stringify(blindPacket), /engineAssessment|businessFit|rebuildNeedScore|evidenceConfidence|agreementPercent|gateReasons|conversionCritical|manualReviewReasons|scoreImpact|classification|severity/i);
  assert.equal(assessmentSidecar.entries.length, 50);
  assert.equal(assessmentSidecar.entries[0]?.engineAssessment.label, original.entries[0]?.engineAssessment.label);
  assert.equal(assessmentSidecar.entries[0]?.auditHints.classification, original.entries[0]?.audit.classification);
  assert.equal(assessmentSidecar.entries[0]?.auditHints.claims[0]?.conversionCritical, original.entries[0]?.audit.claims[0]?.conversionCritical);
  assert.equal(assessmentSidecar.entries[0]?.auditHints.checks[0]?.severity, original.entries[0]?.audit.checks[0]?.severity);
  assert.deepEqual(assessmentSidecar.summary, original.summary);
  assert.deepEqual(rejoinOwnerLabelingPacket(blindPacket, assessmentSidecar), original);
  assert.equal(PrivateKwOwnerLabelingPacketSchema.safeParse(rejoinOwnerLabelingPacket(blindPacket, assessmentSidecar)).success, true);
});

test("blind packet and assessment sidecar schemas reject leaked or unknown first-pass fields", () => {
  const { blindPacket, assessmentSidecar } = splitOwnerLabelingPacket(buildCompleteOwnerLabelingPacketFixture());
  assert.equal(BlindOwnerLabelingPacketSchema.safeParse({
    ...blindPacket,
    entries: blindPacket.entries.map((entry, index) => index === 0
      ? { ...entry, engineAssessment: { label: "STRONG", scores: { businessFit: 1, rebuildNeed: 1, reachability: 1, timing: 1, evidenceConfidence: 1 }, policyVersion: "leak", assessedAt: "2026-08-28T14:00:00.000Z" } }
      : entry),
  }).success, false);
  assert.equal(BlindOwnerLabelingPacketSchema.safeParse({ ...blindPacket, summary: { ...blindPacket.summary, agreementPercent: 100 } }).success, false);
  assert.equal(OwnerLabelingAssessmentSidecarSchema.safeParse(assessmentSidecar).success, true);
});

test("rejoin rejects altered IDs, partial cohorts, and sidecars from another packet", () => {
  const first = splitOwnerLabelingPacket(buildCompleteOwnerLabelingPacketFixture());
  const duplicateSidecar = structuredClone(first.assessmentSidecar);
  duplicateSidecar.entries[49]!.leadId = duplicateSidecar.entries[0]!.leadId;
  assert.throws(() => rejoinOwnerLabelingPacket(first.blindPacket, duplicateSidecar));

  const partialBlind = structuredClone(first.blindPacket);
  partialBlind.entries.pop();
  assert.throws(() => rejoinOwnerLabelingPacket(partialBlind, first.assessmentSidecar));

  const mismatchedId = structuredClone(first.assessmentSidecar);
  mismatchedId.entries[0]!.businessId = "another-business-id";
  assert.throws(() => rejoinOwnerLabelingPacket(first.blindPacket, mismatchedId));

  const mismatchedPacketDigest = structuredClone(first.assessmentSidecar);
  mismatchedPacketDigest.fullPacketDigest = "f".repeat(64);
  assert.throws(() => rejoinOwnerLabelingPacket(first.blindPacket, mismatchedPacketDigest));
});

test("rejoin rejects a modified blind dossier even when the sidecar remains unchanged", () => {
  const split = splitOwnerLabelingPacket(buildCompleteOwnerLabelingPacketFixture());
  const modified = structuredClone(split.blindPacket);
  modified.entries[0]!.audit.claims[0]!.observation = "Changed after split.";
  assert.throws(() => rejoinOwnerLabelingPacket(modified, split.assessmentSidecar));
});

test("rejoin rejects coordinated blind and sidecar digest updates that change displayed evidence", () => {
  const split = splitOwnerLabelingPacket(buildCompleteOwnerLabelingPacketFixture());
  const modifiedBlind = structuredClone(split.blindPacket);
  const modifiedSidecar = structuredClone(split.assessmentSidecar);
  modifiedBlind.entries[0]!.audit.claims[0]!.observation = "Substituted first-pass evidence.";
  const { blindDigest: _blindDigest, ...blindCore } = modifiedBlind;
  void _blindDigest;
  modifiedBlind.blindDigest = createHash("sha256").update(privateKwOwnerLabelingCanonicalJson(blindCore)).digest("hex");
  modifiedSidecar.blindDigest = modifiedBlind.blindDigest;

  assert.throws(() => rejoinOwnerLabelingPacket(modifiedBlind, modifiedSidecar), /exact blind evidence claims/i);
});
