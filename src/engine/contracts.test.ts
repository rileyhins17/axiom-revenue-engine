import assert from "node:assert/strict";
import test from "node:test";

import {
  BusinessWorkflowInputSchema,
  REVENUE_BUSINESS_WORKFLOW_INPUT_VERSION,
  createInitialWorkflowReceipt,
  haltWorkflowReceipt,
  type BusinessWorkflowInput,
} from "./contracts";
import { engineHealth, parseLockedEngineEnvironment } from "./safety";

function validInput(): BusinessWorkflowInput {
  return {
    inputVersion: REVENUE_BUSINESS_WORKFLOW_INPUT_VERSION,
    workflowId: "0c9cae94-8ac7-4e80-b3a2-3aa70dc7caad",
    businessId: "business:example-roofing",
    idempotencyKey: "audit:example-roofing:2026-08-22",
    requestedAt: "2026-08-22T12:00:00.000Z",
    mode: "SHADOW",
    policyVersion: "revenue-shadow-v3",
    auditVersion: "website-audit-v1",
    maxCostUsd: 0,
  };
}

test("the inert workflow accepts only shadow input with a zero cost limit", () => {
  assert.equal(BusinessWorkflowInputSchema.safeParse(validInput()).success, true);
  assert.equal(BusinessWorkflowInputSchema.safeParse({ ...validInput(), mode: "LIVE" }).success, false);
  assert.equal(BusinessWorkflowInputSchema.safeParse({ ...validInput(), maxCostUsd: 0.01 }).success, false);
  assert.equal(BusinessWorkflowInputSchema.safeParse({ ...validInput(), unexpected: true }).success, false);
});

test("workflow receipts persist every planned step and halt without spend", () => {
  const initial = createInitialWorkflowReceipt(validInput());
  assert.equal(initial.steps.length, 13);
  assert.deepEqual(initial.cost, { limitUsd: 0, spentUsd: 0 });
  assert.equal(initial.status, "READY");

  const halted = haltWorkflowReceipt(initial, {
    code: "scaffold_locked",
    message: "No execution authority.",
    haltedAt: "2026-08-22T12:00:01.000Z",
  });
  assert.equal(halted.status, "HALTED");
  assert.equal(halted.currentStep, null);
  assert.deepEqual(halted.cost, { limitUsd: 0, spentUsd: 0 });
});

test("engine runtime policy fails closed when configuration is missing or contradictory", () => {
  const locked = {
    ENGINE_ENVIRONMENT: "shadow",
    ENGINE_EXECUTION_ENABLED: "false",
    ENGINE_AUTONOMY_LEVEL: "OFF",
    ENGINE_MAX_JOB_COST_USD: "0",
  };

  assert.doesNotThrow(() => parseLockedEngineEnvironment(locked));
  assert.throws(() => parseLockedEngineEnvironment({ ...locked, ENGINE_EXECUTION_ENABLED: "true" }));
  assert.equal(engineHealth(locked).state, "LOCKED");
  assert.equal(engineHealth({ ...locked, ENGINE_MAX_JOB_COST_USD: "1" }).state, "SAFETY_STOP");
});
