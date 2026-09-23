import assert from "node:assert/strict";
import test from "node:test";

import { splitOwnerLabelingPacket } from "@/lib/revenue-engine/owner-labeling-blind";
import { projectBlindOwnerLabelingWorkspace } from "@/lib/revenue-engine/owner-labeling-blind-workspace";
import { OwnerLabelingUploadError, validateOwnerLabelingBlindUpload } from "@/lib/revenue-engine/owner-labeling-upload";
import { buildCompleteOwnerLabelingPacketFixture } from "@/lib/revenue-engine/test-support/owner-labeling-fixture";

function allKeys(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(allKeys);
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, nested]) => [key, ...allKeys(nested)]);
  }
  return [];
}

test("blind workspace exposes exact evidence cohort without engine judgments or score-derived hints", () => {
  const original = buildCompleteOwnerLabelingPacketFixture();
  const { blindPacket } = splitOwnerLabelingPacket(original);
  const workspace = projectBlindOwnerLabelingWorkspace(blindPacket);
  assert.equal(validateOwnerLabelingBlindUpload(blindPacket).packetId, original.packetId);
  assert.throws(() => validateOwnerLabelingBlindUpload(original), (error: unknown) => (
    error instanceof OwnerLabelingUploadError && error.code === "INVALID_PACKET" && error.status === 400
  ), "The first-pass endpoint must reject a full score-bearing checkpoint.");

  assert.equal(workspace.entries.length, 50);
  assert.equal(workspace.packetId, original.packetId);
  assert.equal(workspace.packetDigest, original.packetDigest);
  assert.equal(workspace.summary.loaded, 50);
  assert.equal(workspace.summary.reviewed, 0);
  assert(workspace.entries[0]?.audit.claims[0]?.sourceUrl);
  assert.equal(workspace.authority.sendAuthorized, false);
  assert.equal(workspace.authority.costAuthorizedUsd, 0);
  const forbidden = new Set([
    "engineAssessment", "scores", "label", "agreementPercent", "agreements", "ready", "gateReasons",
    "classification", "severity", "conversionCritical", "rebuildNeedScore", "manualReviewReasons",
  ]);
  const keys = allKeys(workspace);
  assert.equal(keys.some((key) => forbidden.has(key) && key !== "label"), false);
  assert.equal(keys.includes("label"), true, "Previously saved owner reviews may retain their labels.");
});
