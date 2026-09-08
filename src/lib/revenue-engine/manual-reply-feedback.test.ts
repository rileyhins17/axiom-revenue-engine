import assert from "node:assert/strict";
import test from "node:test";
import { manualReplyFeedback } from "./manual-reply-feedback";

const intentId = "a".repeat(64);
test("only an explicit accepted-and-recorded reply clears the composer", () => {
  assert.equal(manualReplyFeedback(200, { success: true, state: "SENT", intentId }).sent, true);
  for (const body of [null, {}, [], { success: true }, { success: true, state: "SENT" },
    { success: false, state: "SENT", intentId }, { success: true, state: "SENT", intentId: "invalid" }]) {
    assert.equal(manualReplyFeedback(200, body).sent, false);
    assert.equal(manualReplyFeedback(200, body).preventResend, true);
  }
});
test("uncertain or pending-history receipts retain the draft and block a second copy", () => {
  for (const [status, state, success] of [[202, "DELIVERY_UNCERTAIN", false],
    [503, "STATUS_UNAVAILABLE", false], [200, "SENT_HISTORY_PENDING", true], [409, "REJECTED", false]] as const) {
    const feedback = manualReplyFeedback(status, { success, state, intentId });
    assert.equal(feedback.sent, false);
    assert.equal(feedback.preventResend, true);
    assert(feedback.message.length > 0);
  }
  assert.match(manualReplyFeedback(200, { success: true, state: "SENT_HISTORY_PENDING", intentId }).message, /history still needs repair/);
});
test("ordinary denial keeps the draft without exposing server error details", () => {
  for (const status of [400, 401, 403, 409]) {
    const feedback = manualReplyFeedback(status, { success: false, error: "Private provider failure" });
    assert.equal(feedback.sent, false);
    assert.equal(feedback.preventResend, false);
    assert.doesNotMatch(feedback.message, /Private provider/);
  }
  assert.equal(manualReplyFeedback(503, { success: false, code: "MAIL_RUNTIME_UNAVAILABLE" }).preventResend, false);
  for (const status of [500, 502, 503, 504]) {
    assert.equal(manualReplyFeedback(status, { error: "Unknown upstream failure" }).preventResend, true);
  }
});
