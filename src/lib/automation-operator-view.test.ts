import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildOperatorStatus,
  getCanonicalWaitingCount,
  humanizeOperatorBlocker,
} from "@/lib/automation-operator-view";

const now = new Date("2026-05-22T12:00:00.000Z");

test("operator status explains running state and next send in plain language", () => {
  const status = buildOperatorStatus({
    now,
    enabled: true,
    globalPaused: false,
    emergencyPaused: false,
    sentToday: 2,
    nextSendAt: new Date("2026-05-22T12:23:00.000Z"),
  });

  assert.equal(status.label, "Engine running");
  assert.equal(status.tone, "running");
  assert.equal(status.sentence, "Engine running. 2 sent today. Next send in 23 minutes.");
});

test("operator status prioritizes emergency stop over normal running copy", () => {
  const status = buildOperatorStatus({
    now,
    enabled: true,
    globalPaused: false,
    emergencyPaused: true,
    sentToday: 4,
    nextSendAt: new Date("2026-05-22T12:23:00.000Z"),
  });

  assert.equal(status.label, "Emergency stop on");
  assert.equal(status.tone, "stopped");
  assert.equal(status.sentence, "Emergency stop is on. No emails will send until it is cleared.");
});

test("canonical waiting count uses one user-facing pending-send number", () => {
  assert.equal(
    getCanonicalWaitingCount({
      scheduledInitialSteps: 71,
      queuedSequences: 297,
      scheduledRawSteps: 1581,
    }),
    71,
  );
});

test("operator blocker copy hides raw scheduler codes unless action is needed", () => {
  assert.deepEqual(humanizeOperatorBlocker("mailbox_cooldown"), {
    label: "Inbox cooling down",
    detail: "No action needed. Sending resumes automatically.",
    actionNeeded: false,
  });
  assert.deepEqual(humanizeOperatorBlocker("mailbox_disconnected"), {
    label: "Inbox needs reconnecting",
    detail: "Reconnect Gmail before this sequence can send.",
    actionNeeded: true,
  });
  assert.deepEqual(humanizeOperatorBlocker("generation_failed_retryable"), {
    label: "Retry queued",
    detail: "No action needed yet. Diagnostics will flag it if it stays stuck.",
    actionNeeded: false,
  });
});
