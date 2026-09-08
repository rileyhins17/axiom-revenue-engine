import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPrivateKwSourceWorkflowProgressReceiptInput,
} from "@/lib/revenue-engine/private-kw-source-workflow-progress";
import {
  createPrivateKwShadowSourceWorkflowFixture,
} from "@/lib/revenue-engine/test-support/private-kw-shadow-source-workflow-fixture";

test("normalizes one exact sealed source/workflow materialization into the first progress input", () => {
  const fixture = createPrivateKwShadowSourceWorkflowFixture();
  const receipt = buildPrivateKwSourceWorkflowProgressReceiptInput({
    manifestValue: fixture.manifest,
    sourceValue: fixture.source,
    materializationValue: fixture.materialization,
    storedRecords: fixture.exactStoredRecords,
    recordedAt: fixture.recordedAt,
  });

  assert.equal(receipt.businessId, fixture.plan.businessId);
  assert.equal(receipt.phase, "SOURCE_WORKFLOW");
  assert.equal(receipt.completedAt, fixture.plan.recordedAt);
  assert.equal(receipt.proof.primaryReceiptId, fixture.plan.materializationId);
  assert.equal(receipt.proof.primaryReceiptDigest, fixture.plan.materializationDigest);
  assert.deepEqual(receipt.proof.supportingReceipts, [{
    receiptId: fixture.plan.workflowReceiptId,
    receiptDigest: fixture.plan.workflowReceiptId.slice("workflow-receipt:".length),
  }]);
  assert.equal(receipt.previousPhaseReceipt, null);
  assert.equal(receipt.authority.progressRecordingOnly, true);
  assert.equal(receipt.authority.phaseExecutionAuthorized, false);
  assert.equal(receipt.authority.databaseMutationAuthorized, false);
  assert.equal(receipt.authority.sendAuthorized, false);
  assert.equal(receipt.authority.providerOperationsAuthorized, 0);
  assert.equal(receipt.authority.costAuthorizedUsd, 0);
});

test("requires the exact complete stored materialization and rejects duplicate or altered rows", () => {
  const fixture = createPrivateKwShadowSourceWorkflowFixture();
  const build = (storedRecords: typeof fixture.exactStoredRecords) => buildPrivateKwSourceWorkflowProgressReceiptInput({
    manifestValue: fixture.manifest,
    sourceValue: fixture.source,
    materializationValue: fixture.materialization,
    storedRecords,
    recordedAt: fixture.recordedAt,
  });

  assert.throws(
    () => build(fixture.exactStoredRecords.slice(1)),
    /exact complete materialization plan/i,
  );
  assert.throws(
    () => build([...fixture.exactStoredRecords, fixture.exactStoredRecords[0]]),
    /exact complete materialization plan/i,
  );
  const receiptIndex = fixture.exactStoredRecords.findIndex((record) => record.entity === "WORKFLOW_RECEIPT");
  const changed = fixture.exactStoredRecords.map((record, index) => index === receiptIndex
    ? { ...record, rows: [{ ...record.rows[0], status: "FAILED" }] }
    : record);
  assert.throws(() => build(changed), /WORKFLOW_RECEIPT.*CONFLICT/i);
  const hiddenCollision = fixture.exactStoredRecords.map((record, index) => index === receiptIndex
    ? { ...record, rows: [...record.rows, { ...record.rows[0] }] }
    : record);
  assert.throws(() => build(hiddenCollision), /WORKFLOW_RECEIPT.*CONFLICT/i);
});

test("rejects a materialization outside the reviewed manifest and invalid chronology", () => {
  const outside = createPrivateKwShadowSourceWorkflowFixture({ materializationRecordIndex: 11 });
  assert.throws(() => buildPrivateKwSourceWorkflowProgressReceiptInput({
    manifestValue: outside.manifest,
    sourceValue: outside.source,
    materializationValue: outside.materialization,
    storedRecords: outside.exactStoredRecords,
    recordedAt: outside.recordedAt,
  }), /one exact manifest business/i);

  const fixture = createPrivateKwShadowSourceWorkflowFixture();
  assert.throws(() => buildPrivateKwSourceWorkflowProgressReceiptInput({
    manifestValue: fixture.manifest,
    sourceValue: fixture.source,
    materializationValue: fixture.materialization,
    storedRecords: fixture.exactStoredRecords,
    recordedAt: new Date(Date.parse(fixture.plan.recordedAt) - 1).toISOString(),
  }), /cannot be recorded before/i);
});
