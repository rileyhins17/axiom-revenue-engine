import assert from "node:assert/strict";
import test from "node:test";

import { evaluateAutomationSafety, type AutomationPhase } from "@/lib/automation-safety";

const enabledEnv = {
  AUTONOMOUS_INTAKE_ENABLED: true,
  AUTONOMOUS_QUEUE_ENABLED: true,
  AUTONOMOUS_SEND_ENABLED: true,
  AUTONOMOUS_MAX_SENDS_PER_DAY: 5,
  AUTONOMOUS_MAX_FOLLOW_UP_SENDS_PER_DAY: 1,
};

const enabledSettings = {
  enabled: true,
  globalPaused: false,
  emergencyPaused: false,
  intakePaused: false,
  followUpsPaused: false,
};

test("every phase fails closed when either policy source is unavailable", () => {
  for (const phase of ["intake", "queue", "send", "follow_up"] satisfies AutomationPhase[]) {
    assert.equal(evaluateAutomationSafety({ env: null, phase, settings: enabledSettings }).allowed, false);
    assert.equal(evaluateAutomationSafety({ env: enabledEnv, phase, settings: null }).allowed, false);
  }
});

test("global and emergency pauses block every phase", () => {
  for (const phase of ["intake", "queue", "send", "follow_up"] satisfies AutomationPhase[]) {
    assert.equal(
      evaluateAutomationSafety({ env: enabledEnv, phase, settings: { ...enabledSettings, globalPaused: true } }).allowed,
      false,
    );
    assert.equal(
      evaluateAutomationSafety({ env: enabledEnv, phase, settings: { ...enabledSettings, emergencyPaused: true } }).allowed,
      false,
    );
  }
});

test("each phase requires its explicit switch, pause, and budget gates", () => {
  assert.equal(evaluateAutomationSafety({ env: enabledEnv, phase: "intake", settings: enabledSettings }).allowed, true);
  assert.equal(evaluateAutomationSafety({ env: enabledEnv, phase: "queue", settings: enabledSettings }).allowed, true);
  assert.equal(evaluateAutomationSafety({ env: enabledEnv, phase: "send", settings: enabledSettings }).allowed, true);
  assert.equal(evaluateAutomationSafety({ env: enabledEnv, phase: "follow_up", settings: enabledSettings }).allowed, true);

  assert.equal(evaluateAutomationSafety({ env: { ...enabledEnv, AUTONOMOUS_QUEUE_ENABLED: false }, phase: "queue", settings: enabledSettings }).allowed, false);
  assert.equal(evaluateAutomationSafety({ env: { ...enabledEnv, AUTONOMOUS_MAX_SENDS_PER_DAY: 0 }, phase: "send", settings: enabledSettings }).allowed, false);
  assert.equal(evaluateAutomationSafety({ env: enabledEnv, phase: "intake", settings: { ...enabledSettings, intakePaused: true } }).allowed, false);
  assert.equal(evaluateAutomationSafety({ env: enabledEnv, phase: "follow_up", settings: { ...enabledSettings, followUpsPaused: true } }).allowed, false);
});
