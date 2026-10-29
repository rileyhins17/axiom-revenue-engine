import assert from "node:assert/strict";
import test from "node:test";

import { buildOwnerFirstPassExport, validateOwnerFirstPassForReveal } from "@/lib/revenue-engine/owner-labeling-first-pass";
import { buildCompleteOwnerLabelingPacketFixture } from "@/lib/revenue-engine/test-support/owner-labeling-fixture";

const DIGEST = "a".repeat(64);

test("first-pass export covers every unreviewed dossier before assessment reveal", () => {
  const packet = buildCompleteOwnerLabelingPacketFixture();
  const entries = packet.entries.map(({ leadId, ownerReview }) => ({ leadId, ownerReview }));
  const decisions = Object.fromEntries(entries.map(({ leadId }) => [leadId, {
    label: "WEAK" as const,
    reasons: ["WEBSITE_ALREADY_STRONG" as const],
    notes: "The source observations do not justify a rebuild.",
  }]));
  const exported = buildOwnerFirstPassExport({
    packetId: packet.packetId,
    packetDigest: packet.packetDigest,
    blindDigest: DIGEST,
    reviewedBy: "RILEY",
    reviewedAt: "2026-09-23T15:00:00.000Z",
    entries,
    decisions,
  });

  assert.equal(exported.decisions.length, 50);
  assert.equal(exported.decisions[0]?.leadId, [...Object.keys(decisions)].sort((a, b) => a.localeCompare(b, "en-CA"))[0]);
  assert.equal(exported.databaseMutationAuthorized, false);
  assert.equal(exported.outreachAuthorized, false);
  assert.equal(exported.sendAuthorized, false);
  assert.doesNotThrow(() => validateOwnerFirstPassForReveal(exported, {
    packetId: packet.packetId,
    packetDigest: packet.packetDigest,
    blindDigest: DIGEST,
    entries,
  }));
});

test("first-pass gate rejects missing, extra, duplicate, mismatched, or incomplete decisions", () => {
  const packet = buildCompleteOwnerLabelingPacketFixture();
  const entries = packet.entries.map(({ leadId, ownerReview }) => ({ leadId, ownerReview }));
  const decisions = Object.fromEntries(entries.map(({ leadId }) => [leadId, {
    label: "STRONG" as const,
    reasons: ["GOOD_COMMERCIAL_FIT" as const],
    notes: "",
  }]));
  const base = {
    packetId: packet.packetId,
    packetDigest: packet.packetDigest,
    blindDigest: DIGEST,
    reviewedBy: "AIDAN" as const,
    reviewedAt: "2026-09-23T15:00:00.000Z",
    entries,
    decisions,
  };
  const complete = buildOwnerFirstPassExport(base);
  const missing = { ...decisions };
  delete missing[entries[0]!.leadId];
  assert.throws(() => buildOwnerFirstPassExport({ ...base, decisions: missing }), /every unreviewed/i);
  assert.throws(() => buildOwnerFirstPassExport({ ...base, decisions: { ...decisions, unknown: decisions[entries[0]!.leadId] } }), /unknown/i);
  assert.throws(() => buildOwnerFirstPassExport({ ...base, decisions: { ...decisions, [entries[0]!.leadId]: { label: "STRONG", reasons: [], notes: "" } } }), /complete/i);
  assert.throws(() => validateOwnerFirstPassForReveal({ ...complete, packetDigest: "b".repeat(64) }, base), /match/i);
  assert.throws(() => validateOwnerFirstPassForReveal({ ...complete, decisions: complete.decisions.slice(1) }, base), /every unreviewed/i);
  assert.throws(() => validateOwnerFirstPassForReveal({ ...complete, decisions: [complete.decisions[0]!, ...complete.decisions] }, base), /duplicate|once/i);
});
