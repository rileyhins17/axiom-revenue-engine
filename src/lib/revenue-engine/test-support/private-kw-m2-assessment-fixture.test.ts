import assert from "node:assert/strict";
import test from "node:test";

import { reloadPrivateKwM2WebsiteEvidenceReceipt } from "@/lib/revenue-engine/private-kw-m2-html-evidence-workflow";
import { createPrivateKwM2AssessmentFixture } from "@/lib/revenue-engine/test-support/private-kw-m2-assessment-fixture";

for (const retention of ["RAW_HTML_ALLOWED", "DERIVED_FACTS_ONLY"] as const) {
  test(`Task5 fixture creates a COMPLETE Task4 receipt and independently reloads ${retention}`, async () => {
    const fixture = await createPrivateKwM2AssessmentFixture({ retention });
    assert.equal(fixture.receipt.status, "COMPLETE");
    assert.equal(fixture.receipt.pages.length, 4);
    assert.equal(fixture.receipt.pages.every((page) => page.outcome === "CAPTURED"), true);

    const first = await reloadPrivateKwM2WebsiteEvidenceReceipt({
      request: fixture.request,
      receiptStore: fixture.receiptStore,
      evidenceStore: fixture.evidenceStore,
    }, { clock: fixture.clock });
    const second = await reloadPrivateKwM2WebsiteEvidenceReceipt({
      request: fixture.request,
      receiptStore: fixture.receiptStore,
      evidenceStore: fixture.evidenceStore,
    }, { clock: fixture.clock });
    assert.deepEqual(second, first);
    if (retention === "DERIVED_FACTS_ONLY") {
      assert.equal(fixture.receipt.pages.every((page) => page.storageRefs.factsRef !== null), true);
      assert.equal(fixture.receipt.pages.every((page) => page.storageRefs.receiptRef === null), true);
      assert.equal(fixture.receipt.pages.every((page) => page.storageOutcome === "DERIVED_FACTS_ONLY"), true);
    } else {
      assert.equal(fixture.receipt.pages.every((page) => page.storageRefs.factsRef === null), true);
      assert.equal(fixture.receipt.pages.every((page) => page.storageOutcome === "RAW_HTML_ALLOWED"), true);
    }
  });
}

test("Task5 fixtures derive timestamps from now and share one chain across business indexes", async () => {
  const now = new Date("2030-01-15T12:34:56.789Z");
  const first = await createPrivateKwM2AssessmentFixture({ businessIndex: 0, retention: "DERIVED_FACTS_ONLY", now });
  const second = await createPrivateKwM2AssessmentFixture({ businessIndex: 1, retention: "DERIVED_FACTS_ONLY", now });

  assert.deepEqual(second.chain, first.chain);
  assert.notEqual(second.request.requestId, first.request.requestId);
  assert.notEqual(second.request.businessId, first.request.businessId);
  assert.equal(first.request.requestedAt, now.toISOString());
  assert.equal(first.chain.ownerEnvelope.expiresAt, "2030-01-24T12:34:56.789Z");
  assert.equal(first.receipt.pages.every((page) => page.capturedAt === now.toISOString()), true);
});

for (const [outcome, expectedStatus] of [
  ["PARTIAL", "PARTIAL"],
  ["RESEARCH_REQUIRED", "RESEARCH_REQUIRED"],
  ["ROBOTS_BLOCKED", "FAILED"],
  ["RETENTION_BLOCKED", "FAILED"],
] as const) {
  test(`Task5 fixture executes and reloads sealed ${outcome} outcome`, async () => {
    const fixture = await createPrivateKwM2AssessmentFixture({ outcome });
    assert.equal(fixture.receipt.status, expectedStatus);
    assert.equal(fixture.receipt.stopReason, outcome === "ROBOTS_BLOCKED" ? "ROBOTS_OR_TERMS_BLOCKED" : outcome === "RETENTION_BLOCKED" ? "RETENTION_BLOCKED" : null);
    const reloaded = await reloadPrivateKwM2WebsiteEvidenceReceipt({
      request: fixture.request,
      receiptStore: fixture.receiptStore,
      evidenceStore: fixture.evidenceStore,
    }, { clock: fixture.clock });
    assert.deepEqual(reloaded, fixture.receipt);
    if (outcome === "ROBOTS_BLOCKED" || outcome === "RETENTION_BLOCKED") {
      assert.equal(fixture.receipt.blockedEvidence?.outcome, "BLOCKED");
      assert.equal(fixture.receipt.pages.length, 0);
    }
  });
}

test("Task5 fixture leaves HOMEPAGE_FAILED receipts unsealed", async () => {
  const partial = await createPrivateKwM2AssessmentFixture({ outcome: "PARTIAL" });
  assert.equal(partial.receipt.status, "PARTIAL");
  assert.equal(partial.receiptStore.values.size, 1);

  const homepage = await createPrivateKwM2AssessmentFixture({ outcome: "HOMEPAGE_FAILED" });
  assert.equal(homepage.receipt.status, "FAILED");
  assert.equal(homepage.receipt.stopReason, "HOMEPAGE_CAPTURE_FAILED");
  await assert.rejects(reloadPrivateKwM2WebsiteEvidenceReceipt({ request: homepage.request, receiptStore: homepage.receiptStore, evidenceStore: homepage.evidenceStore }, { clock: homepage.clock }), /RECEIPT_REPLAY_MISSING|REPLAY_MISSING/);
});
