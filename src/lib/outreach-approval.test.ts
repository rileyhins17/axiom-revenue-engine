import assert from "node:assert/strict";
import { test } from "node:test";

import { buildOutreachContentDigest, evaluateOutreachApproval, type OutreachApprovalContent } from "./outreach-approval";

const content: OutreachApprovalContent = {
  bodyHtml: "<p>Specific evidence</p>",
  bodyPlain: "Specific evidence",
  campaignKey: "kw-roofing-v1",
  leadId: 42,
  messagePolicyVersion: "evidence-first-v1",
  recipientEmail: "Owner@Example.ca",
  sequenceId: "sequence-1",
  sequenceStepId: "step-1",
  subject: "Example Roofing website",
  variantKey: "a",
};

test("approval digest is stable across email casing and line endings", async () => {
  const first = await buildOutreachContentDigest(content);
  const second = await buildOutreachContentDigest({
    ...content,
    bodyPlain: "Specific evidence\r\n",
    recipientEmail: "owner@example.ca",
  });
  assert.equal(first, second);
});

test("approval is valid only for the exact approved content", async () => {
  const digest = await buildOutreachContentDigest(content);
  const approved = {
    contentDigest: digest,
    decision: "APPROVED",
    decidedAt: "2026-08-16T12:00:00.000Z",
    expiresAt: "2026-08-18T12:00:00.000Z",
    revokedAt: null,
  };

  assert.deepEqual(evaluateOutreachApproval(approved, digest, new Date("2026-08-17T12:00:00.000Z")), {
    allowed: true,
    reason: "approved",
  });
  assert.equal(evaluateOutreachApproval(approved, "changed", new Date("2026-08-17T12:00:00.000Z")).reason, "approval_content_changed");
  assert.equal(evaluateOutreachApproval(approved, digest, new Date("2026-08-19T12:00:00.000Z")).reason, "approval_expired");
  assert.equal(evaluateOutreachApproval(null, digest).reason, "approval_missing");
});
