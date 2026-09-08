import assert from "node:assert/strict";
import test from "node:test";

import {
  loadPrivateKwContactInvocationDurable,
} from "@/lib/revenue-engine/private-kw-contact-invocation-durable";
import {
  PrivateKwContactReviewProgressProofSchema,
  buildPrivateKwContactReviewProgressProof,
} from "@/lib/revenue-engine/private-kw-contact-review-progress-proof";
import {
  createPrivateKwContactReviewProgressProofFixture,
} from "@/lib/revenue-engine/test-support/private-kw-contact-review-progress-proof-fixture";

test("builds one zero-authority contact-review proof from exact durable rows and assessment progress", async () => {
  const fixture = await createPrivateKwContactReviewProgressProofFixture();
  const proof = buildPrivateKwContactReviewProgressProof({
    manifestValue: fixture.manifest,
    assessmentProgressCheckpointValue: fixture.assessmentCheckpoint,
    currentContactInvocationResultValue: fixture.contactDurableReload,
  });

  assert.equal(proof.proofId, `contact-review-proof:${proof.proofDigest}`);
  assert.equal(proof.previousPhaseReceipt.assessmentReceiptId, fixture.assessment.assessmentId);
  assert.equal(proof.contactInvocation.invocationId, fixture.invocation.invocationId);
  assert.equal(
    proof.contactInvocation.contactMaterializationId,
    fixture.contactPlan.materializationId,
  );
  assert.equal(proof.persistence.executionPath, "DURABLE_RELOAD");
  assert.equal(proof.persistence.freshnessState, "CURRENT");
  assert.equal(proof.persistence.exactAssessmentReloaded, true);
  assert.equal(proof.persistence.exactContactPlanRebuilt, true);
  assert.equal(proof.persistence.immutableWriterGuardsVerified, true);
  assert.equal(proof.persistence.databaseMutationPerformed, false);
  assert.equal(proof.authority.phaseInputCreationAuthorized, false);
  assert.equal(proof.authority.progressReceiptCreationAuthorized, false);
  assert.equal(proof.authority.phaseAdvancementAuthorized, false);
  assert.equal(proof.authority.contactDiscoveryExecutionAuthorized, false);
  assert.equal(proof.authority.contactVerificationExecutionAuthorized, false);
  assert.equal(proof.authority.outreachAuthorized, false);
  assert.equal(proof.authority.sendAuthorized, false);
  assert.equal(proof.authority.providerOperationsAuthorized, 0);
  assert.equal(proof.authority.costAuthorizedUsd, 0);
  assert.equal(Object.isFrozen(fixture.contactDurableReload), true);
});

test("rejects schema-valid invocation JSON, copied durable reloads, and copied checkpoints", async () => {
  const fixture = await createPrivateKwContactReviewProgressProofFixture({
    suffix: "copied-contact-proof",
  });
  assert.throws(() => buildPrivateKwContactReviewProgressProof({
    manifestValue: fixture.manifest,
    assessmentProgressCheckpointValue: fixture.assessmentCheckpoint,
    currentContactInvocationResultValue: fixture.invocation,
  }), /durableVersion|durable reload|exact in-process/i);
  assert.throws(() => buildPrivateKwContactReviewProgressProof({
    manifestValue: fixture.manifest,
    assessmentProgressCheckpointValue: fixture.assessmentCheckpoint,
    currentContactInvocationResultValue: structuredClone(fixture.contactDurableReload),
  }), /exact in-process/i);
  assert.throws(() => buildPrivateKwContactReviewProgressProof({
    manifestValue: fixture.manifest,
    assessmentProgressCheckpointValue: structuredClone(fixture.assessmentCheckpoint),
    currentContactInvocationResultValue: fixture.contactDurableReload,
  }), /exact in-process/i);
});

test("durable reload rejects a missing final receipt and a missing immutable writer guard", async () => {
  const fixture = await createPrivateKwContactReviewProgressProofFixture({
    suffix: "missing-contact-proof",
  });
  const finalRecord = fixture.contactPlan.records.at(-1)!;
  const finalStatementId = `read:durable_contact_plan:${fixture.contactPlan.records.length - 1}:${finalRecord.entity}:${finalRecord.recordId}`;
  await assert.rejects(loadPrivateKwContactInvocationDurable(
    fixture.createContactBoundary(new Map([[finalStatementId, []]])),
    {
      invocationId: fixture.invocation.invocationId,
      invocationDigest: fixture.invocation.invocationDigest,
    },
  ), /exact reload.*MATERIALIZATION_RECEIPT/i);

  const guards = fixture.rowByStatementId.get("read:contact_invocation_writer_guards")!;
  await assert.rejects(loadPrivateKwContactInvocationDurable(
    fixture.createContactBoundary(new Map([[
      "read:contact_invocation_writer_guards",
      guards.slice(1),
    ]])),
    {
      invocationId: fixture.invocation.invocationId,
      invocationDigest: fixture.invocation.invocationDigest,
    },
  ), /every exact immutable and lineage writer guard/i);
});

test("durable reload rejects contact row drift and receipt ambiguity", async () => {
  const fixture = await createPrivateKwContactReviewProgressProofFixture({
    suffix: "contact-row-drift",
  });
  const contactRecordIndex = fixture.contactPlan.records.findIndex(
    (record) => record.entity === "CONTACT_POINT",
  );
  assert.notEqual(contactRecordIndex, -1);
  const contactRecord = fixture.contactPlan.records[contactRecordIndex]!;
  const contactStatementId = `read:durable_contact_plan:${contactRecordIndex}:${contactRecord.entity}:${contactRecord.recordId}`;
  await assert.rejects(loadPrivateKwContactInvocationDurable(
    fixture.createContactBoundary(new Map([[
      contactStatementId,
      [{ ...contactRecord.expected, status: "INVALID" }],
    ]])),
    {
      invocationId: fixture.invocation.invocationId,
      invocationDigest: fixture.invocation.invocationDigest,
    },
  ), /exact reload.*CONTACT_POINT/i);

  const invocationRows = fixture.rowByStatementId.get(
    "read:durable_contact_invocation_receipt",
  )!;
  await assert.rejects(loadPrivateKwContactInvocationDurable(
    fixture.createContactBoundary(new Map([[
      "read:durable_contact_invocation_receipt",
      [invocationRows[0]!, invocationRows[0]!],
    ]])),
    {
      invocationId: fixture.invocation.invocationId,
      invocationDigest: fixture.invocation.invocationDigest,
    },
  ), /missing or ambiguous/i);
});

test("stale verification history remains durable but cannot produce current progress proof", async () => {
  const fixture = await createPrivateKwContactReviewProgressProofFixture({
    suffix: "stale-contact-proof",
    contactDatabaseNowOffsetMs: 30 * 24 * 60 * 60_000,
  });
  assert.equal(fixture.contactDurableReload.freshnessState, "STALE");
  assert.throws(() => buildPrivateKwContactReviewProgressProof({
    manifestValue: fixture.manifest,
    assessmentProgressCheckpointValue: fixture.assessmentCheckpoint,
    currentContactInvocationResultValue: fixture.contactDurableReload,
  }), /not current/i);
});

test("durable reload rejects a final database clock that precedes its assessment reload", async () => {
  const fixture = await createPrivateKwContactReviewProgressProofFixture({
    suffix: "contact-clock-regression",
  });
  const regressedDatabaseNow = new Date(
    Date.parse(fixture.contactDurableReload.assessment.databaseNow) - 1_000,
  ).toISOString();

  await assert.rejects(loadPrivateKwContactInvocationDurable(
    fixture.createContactBoundary(new Map([[
      "read:contact_invocation_database_time",
      [{ databaseNow: regressedDatabaseNow }],
    ]])),
    {
      invocationId: fixture.invocation.invocationId,
      invocationDigest: fixture.invocation.invocationDigest,
    },
  ), /cannot precede the assessment reload clock/i);
});

test("rejects cross-manifest lineage and any proof redigest attempt", async () => {
  const fixture = await createPrivateKwContactReviewProgressProofFixture({
    suffix: "contact-proof-a",
  });
  const other = await createPrivateKwContactReviewProgressProofFixture({
    suffix: "contact-proof-b",
  });
  assert.throws(() => buildPrivateKwContactReviewProgressProof({
    manifestValue: other.manifest,
    assessmentProgressCheckpointValue: fixture.assessmentCheckpoint,
    currentContactInvocationResultValue: fixture.contactDurableReload,
  }), /exact manifest-bound assessment checkpoint/i);

  const proof = buildPrivateKwContactReviewProgressProof({
    manifestValue: fixture.manifest,
    assessmentProgressCheckpointValue: fixture.assessmentCheckpoint,
    currentContactInvocationResultValue: fixture.contactDurableReload,
  });
  assert.throws(() => PrivateKwContactReviewProgressProofSchema.parse({
    ...proof,
    preparedAt: new Date(Date.parse(proof.preparedAt) + 1_000).toISOString(),
  }), /identity must bind/i);
});
