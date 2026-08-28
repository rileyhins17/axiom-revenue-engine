import assert from "node:assert/strict";
import test from "node:test";

import { OwnerLeadReasonSchema } from "@/lib/revenue-engine/lead-quality-evaluation";
import {
  OWNER_LABELING_DRAFT_VERSION,
  OWNER_REASON_OPTIONS,
  buildOwnerLabelSubmission,
  isCompleteOwnerLabelingDecision,
  parseOwnerLabelingDraft,
  projectOwnerLabelingWorkspace,
} from "@/lib/revenue-engine/owner-labeling-workspace";
import {
  OWNER_LABELING_UPLOAD_MAX_BYTES,
  OwnerLabelingUploadError,
  readOwnerLabelingPacketRequest,
  validateOwnerLabelingPacketUpload,
} from "@/lib/revenue-engine/owner-labeling-upload";
import { buildCompleteOwnerLabelingPacketFixture } from "@/lib/revenue-engine/test-support/owner-labeling-fixture";

test("projects one exact fixed cohort into a zero-authority owner workspace", () => {
  const packet = buildCompleteOwnerLabelingPacketFixture();
  const workspace = validateOwnerLabelingPacketUpload(packet);

  assert.equal(workspace.entries.length, 50);
  assert.equal(workspace.summary.loaded, 50);
  assert.equal(workspace.summary.reviewed, 0);
  assert(workspace.entries.some((entry) => entry.businessName === "Tri-City Quality Fixture"));
  assert((workspace.entries[0]?.audit.claims.length ?? 0) >= 3);
  assert(workspace.entries[0]?.audit.claims.some((claim) => claim.severity === "CRITICAL"));
  assert.equal(workspace.authority.databaseMutationAuthorized, false);
  assert.equal(workspace.authority.qualificationAuthorized, false);
  assert.equal(workspace.authority.consentDecisionAuthorized, false);
  assert.equal(workspace.authority.outreachAuthorized, false);
  assert.equal(workspace.authority.sendAuthorized, false);
  assert.equal(workspace.authority.providerOperationsAuthorized, 0);
  assert.equal(workspace.authority.costAuthorizedUsd, 0);
});

test("the owner workspace refuses partial cohorts and digest-tampered packets", () => {
  const packet = buildCompleteOwnerLabelingPacketFixture();
  assert.throws(
    () => projectOwnerLabelingWorkspace({ ...packet, entries: packet.entries.slice(0, 49) }),
    /fixed 50-business/i,
  );
  const tampered = structuredClone(packet);
  tampered.entries[0]!.businessName = "Invented replacement";
  assert.throws(() => validateOwnerLabelingPacketUpload(tampered), (error: unknown) => (
    error instanceof OwnerLabelingUploadError && error.code === "INVALID_PACKET" && error.status === 400
  ));
});

test("builds one exact review-only submission and rejects unfinished or mismatched decisions", () => {
  const packet = buildCompleteOwnerLabelingPacketFixture();
  const leadId = packet.entries[0]!.leadId;
  const submission = buildOwnerLabelSubmission({
    packetId: packet.packetId,
    packetDigest: packet.packetDigest,
    reviewedBy: "RILEY",
    reviewedAt: "2026-08-28T15:00:00.000Z",
    decisions: {
      [leadId]: {
        label: "STRONG",
        reasons: ["GOOD_COMMERCIAL_FIT", "CLEAR_REBUILD_NEED"],
        notes: "  Strong evidence and fit.  ",
      },
    },
  });

  assert.deepEqual(submission.decisions, [{
    leadId,
    label: "STRONG",
    reasons: ["GOOD_COMMERCIAL_FIT", "CLEAR_REBUILD_NEED"],
    notes: "Strong evidence and fit.",
  }]);
  assert.equal(submission.reviewOnly, true);
  assert.equal(submission.databaseMutationAuthorized, false);
  assert.equal(submission.qualificationAuthorized, false);
  assert.equal(submission.outreachAuthorized, false);
  assert.equal(submission.sendAuthorized, false);
  assert.equal(submission.providerOperationsAuthorized, 0);
  assert.equal(submission.costAuthorizedUsd, 0);

  assert.equal(isCompleteOwnerLabelingDecision({ label: "STRONG", reasons: [], notes: "" }), false);
  assert.equal(isCompleteOwnerLabelingDecision({ label: "WRONG", reasons: ["GOOD_COMMERCIAL_FIT"], notes: "" }), false);
  assert.throws(() => buildOwnerLabelSubmission({
    packetId: packet.packetId,
    packetDigest: packet.packetDigest,
    reviewedBy: "RILEY",
    reviewedAt: "2026-08-28T15:00:00.000Z",
    decisions: { [leadId]: { label: "WRONG", reasons: ["GOOD_COMMERCIAL_FIT"], notes: "" } },
  }), /needs one verdict and at least one matching reason/i);
});

test("browser drafts resume only for the exact packet and known leads", () => {
  const packet = buildCompleteOwnerLabelingPacketFixture();
  const leadId = packet.entries[0]!.leadId;
  const draft = {
    draftVersion: OWNER_LABELING_DRAFT_VERSION,
    packetDigest: packet.packetDigest,
    reviewedBy: "RILEY",
    decisions: { [leadId]: { label: "WEAK", reasons: ["NO_REALISTIC_ROUTE"], notes: "Needs a better route." } },
  };
  assert.deepEqual(parseOwnerLabelingDraft(draft, packet.packetDigest, new Set([leadId])), draft);
  assert.equal(parseOwnerLabelingDraft(draft, "f".repeat(64), new Set([leadId])), null);
  assert.equal(parseOwnerLabelingDraft(draft, packet.packetDigest, new Set(["different-lead"])), null);
  assert.equal(parseOwnerLabelingDraft({
    ...draft,
    decisions: { [leadId]: { label: "WRONG", reasons: ["GOOD_COMMERCIAL_FIT"], notes: "" } },
  }, packet.packetDigest, new Set([leadId])), null);
});

test("workspace reason choices remain complete and label-specific", () => {
  const configured = new Set(Object.values(OWNER_REASON_OPTIONS).flat().map((option) => option.value));
  assert.deepEqual([...configured].sort(), [...OwnerLeadReasonSchema.options].sort());
  assert.equal(OWNER_REASON_OPTIONS.STRONG.some((option) => option.value === "CHAIN_OR_FRANCHISE"), false);
  assert.equal(OWNER_REASON_OPTIONS.WRONG.some((option) => option.value === "CLEAR_REBUILD_NEED"), false);
});

test("packet request parsing is bounded, JSON-only, and produces no side effects", async () => {
  const packet = buildCompleteOwnerLabelingPacketFixture();
  const valid = new Request("https://revenue.getaxiom.ca/api/v1/leads/evaluation/validate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(packet),
  });
  const value = await readOwnerLabelingPacketRequest(valid);
  assert.equal(validateOwnerLabelingPacketUpload(value).packetId, packet.packetId);

  await assert.rejects(
    readOwnerLabelingPacketRequest(new Request("https://revenue.getaxiom.ca/api/v1/leads/evaluation/validate", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: "{}",
    })),
    (error: unknown) => error instanceof OwnerLabelingUploadError && error.status === 415,
  );
  await assert.rejects(
    readOwnerLabelingPacketRequest(new Request("https://revenue.getaxiom.ca/api/v1/leads/evaluation/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": String(OWNER_LABELING_UPLOAD_MAX_BYTES + 1) },
      body: "{}",
    })),
    (error: unknown) => error instanceof OwnerLabelingUploadError && error.status === 413,
  );
  await assert.rejects(
    readOwnerLabelingPacketRequest(new Request("https://revenue.getaxiom.ca/api/v1/leads/evaluation/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not-json",
    })),
    (error: unknown) => error instanceof OwnerLabelingUploadError && error.code === "INVALID_PACKET",
  );
});
