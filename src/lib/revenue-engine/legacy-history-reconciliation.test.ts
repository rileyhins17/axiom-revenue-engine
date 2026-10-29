import assert from "node:assert/strict";
import test from "node:test";
import { buildLegacyHistoryReconciliation, type LegacyHistoryReconciliationInput } from "@/lib/revenue-engine/legacy-history-reconciliation";

const base = (): LegacyHistoryReconciliationInput => ({
  snapshot: { snapshotId: "snapshot-1", asOf: "2026-09-22T12:00:00.000Z" }, complete: true,
  legacyLeads: [{ leadId: "lead-1", domain: "https://WWW.example.ca/", phone: "+1 (519) 555-0100", email: null }],
  businesses: [{ businessId: "biz-1", domain: "example.ca", phone: null }, { businessId: "biz-2", domain: "other.ca", phone: null }],
  locations: [{ locationId: "loc-1", businessId: "biz-1", phone: null }],
  contactPoints: [
    { contactPointId: "contact-1", businessId: "biz-1", channel: "EMAIL", value: "legacy@example.ca" },
    { contactPointId: "contact-phone-1", businessId: "biz-1", channel: "PHONE", value: "5195550100" },
  ],
  events: [], v2BusinessStops: [],
});

test("domain and phone only nominate candidates; no merge is approved", () => {
  const report = buildLegacyHistoryReconciliation(base());
  assert.deepEqual(report.mappings[0]?.candidates, [{ businessId: "biz-1", contactPointIds: ["contact-phone-1"], matchedBy: ["EXACT_DOMAIN", "EXACT_PHONE"] }]);
  assert.equal(report.mappings[0]?.mergeApproved, false);
  assert.ok(report.mappings[0]?.blockers.includes("IDENTITY_REVIEW"));
  assert.ok(report.businessBlockers.find(x => x.businessId === "biz-1")?.blockers.includes("IDENTITY_REVIEW"));
  assert.equal(report.unresolvedHistory, false);
  assert.equal(report.ownerReviewRequired, true);
});

test("conflicting identity evidence nominates both businesses without merging", () => {
  const input = base(); input.contactPoints.push({ contactPointId: "contact-phone-2", businessId: "biz-2", channel: "PHONE", value: "+1 519 555 0100" });
  const report = buildLegacyHistoryReconciliation(input);
  assert.deepEqual(report.mappings[0]?.candidates.map(x => x.businessId), ["biz-1", "biz-2"]);
  assert.equal(report.mappings[0]?.mergeApproved, false);
  assert.ok(report.businessBlockers.every(x => x.blockers.includes("IDENTITY_REVIEW")));
});

test("phone-only v2 contact point nominates and blocks a candidate", () => {
  const input = base(); input.legacyLeads[0]!.domain = null; input.legacyLeads[0]!.email = null;
  input.businesses[0]!.domain = null; input.contactPoints = [{ contactPointId: "phone-only", businessId: "biz-1", channel: "PHONE", value: "1-519-555-0100" }];
  const report = buildLegacyHistoryReconciliation(input);
  assert.deepEqual(report.mappings[0]?.candidates, [{ businessId: "biz-1", contactPointIds: ["phone-only"], matchedBy: ["EXACT_PHONE"] }]);
  assert.ok(report.businessBlockers.find(x => x.businessId === "biz-1")?.blockers.includes("IDENTITY_REVIEW"));
});

test("sent and accepted are contact attempts; bounce is not a reply", () => {
  const input = base(); input.events.push(
    { eventId: "sent", leadId: "lead-1", type: "SEND", status: "SENT", occurredAt: "2026-09-20T12:00:00.000Z", expiresAt: null },
    { eventId: "e1", leadId: "lead-1", type: "SEND", status: "SENT", occurredAt: "2026-09-20T12:00:00.000Z", expiresAt: null },
    { eventId: "e2", leadId: "lead-1", type: "SEQUENCE", status: "BOUNCED", occurredAt: "2026-09-21T12:00:00.000Z", expiresAt: null },
  );
  const item = buildLegacyHistoryReconciliation(input).history[0]!;
  assert.equal(item.status, "BOUNCED"); assert.equal(item.sentEvidence, true); assert.equal(item.bounceEvidence, true); assert.equal(item.replyEvidence, false);
});

test("bounce-only evidence is explicit and blocks the candidate and business", () => {
  const input = base(); input.events.push({ eventId: "bounce-only", leadId: "lead-1", type: "SEND", status: "BOUNCED", occurredAt: "2026-09-21T12:00:00.000Z", expiresAt: null });
  const report = buildLegacyHistoryReconciliation(input);
  assert.equal(report.history[0]?.status, "BOUNCED");
  assert.equal(report.history[0]?.bounceEvidence, true);
  assert.equal(report.history[0]?.replyEvidence, false);
  assert.ok(report.mappings[0]?.blockers.includes("BOUNCE_HISTORY"));
  assert.ok(report.businessBlockers.find(x => x.businessId === "biz-1")?.blockers.includes("BOUNCE_HISTORY"));
});

test("funnel bounce blocks as bounce history without claiming a reply", () => {
  const input = base(); input.events.push({ eventId: "funnel-bounce", leadId: "lead-1", type: "FUNNEL", status: "BOUNCED", occurredAt: "2026-09-21T12:00:00.000Z", expiresAt: null });
  const report = buildLegacyHistoryReconciliation(input);
  assert.equal(report.history[0]?.status, "BOUNCED"); assert.equal(report.history[0]?.replyEvidence, false);
  assert.ok(report.mappings[0]?.blockers.includes("BOUNCE_HISTORY"));
  assert.ok(report.businessBlockers.find(x => x.businessId === "biz-1")?.blockers.includes("BOUNCE_HISTORY"));
});

test("unsubscribe and complaint are suppressive Funnel history, not human replies", () => {
  for (const status of ["UNSUBSCRIBED", "COMPLAINT"] as const) {
    const input = base(); input.events.push({ eventId: `funnel-${status.toLowerCase()}`, leadId: "lead-1", type: "FUNNEL", status, occurredAt: "2026-09-21T12:00:00.000Z", expiresAt: null });
    const report = buildLegacyHistoryReconciliation(input);
    assert.equal(report.history[0]?.status, "SUPPRESSIVE"); assert.equal(report.history[0]?.suppressionActive, true); assert.equal(report.history[0]?.replyEvidence, false);
    assert.ok(report.mappings[0]?.blockers.includes("SUPPRESSIVE_HISTORY"));
    assert.ok(report.businessBlockers.find(x => x.businessId === "biz-1")?.blockers.includes("SUPPRESSIVE_HISTORY"));
  }
});

test("delivered legacy mail is contacted evidence without implying a human reply", () => {
  const input = base(); input.events.push({ eventId: "delivered", leadId: "lead-1", type: "SEND", status: "DELIVERED", occurredAt: "2026-09-21T12:00:00.000Z", expiresAt: null });
  const item = buildLegacyHistoryReconciliation(input).history[0]!;
  assert.equal(item.status, "CONTACTED"); assert.equal(item.sentEvidence, true); assert.equal(item.replyEvidence, false);
});

test("lead-only reported state is review evidence, not confirmed contact or reply", () => {
  const input = base(); input.events.push(
    { eventId: "legacy-contact-state", leadId: "lead-1", type: "LEAD_STATE", status: "REPORTED_CONTACTED", occurredAt: "2026-09-20T12:00:00.000Z", expiresAt: null },
    { eventId: "legacy-reply-state", leadId: "lead-1", type: "LEAD_STATE", status: "REPORTED_REPLIED", occurredAt: "2026-09-21T12:00:00.000Z", expiresAt: null },
    { eventId: "legacy-bounce-state", leadId: "lead-1", type: "LEAD_STATE", status: "REPORTED_BOUNCED", occurredAt: "2026-09-21T12:01:00.000Z", expiresAt: null },
  );
  const item = buildLegacyHistoryReconciliation(input).history[0]!;
  assert.equal(item.status, "UNRESOLVED"); assert.equal(item.unresolved, true);
  assert.equal(item.reportedContacted, true); assert.equal(item.reportedReplied, true); assert.equal(item.reportedBounced, true);
  assert.equal(item.sentEvidence, false); assert.equal(item.replyEvidence, false); assert.equal(item.bounceEvidence, false);
});

test("sequence reply and funnel outreach sent are retained as reply and contact history", () => {
  const input = base(); input.events.push(
    { eventId: "sequence-reply", leadId: "lead-1", type: "SEQUENCE", status: "REPLIED", occurredAt: "2026-09-21T12:00:00.000Z", expiresAt: null },
    { eventId: "funnel-sent", leadId: "lead-1", type: "FUNNEL", status: "OUTREACH_SENT", occurredAt: "2026-09-21T12:01:00.000Z", expiresAt: null },
  );
  const item = buildLegacyHistoryReconciliation(input).history[0]!;
  assert.equal(item.replyEvidence, true); assert.equal(item.sentEvidence, true);
});

test("extractor-mapped Funnel SENT alone blocks as contact without implying reply", () => {
  const input = base(); input.events.push({ eventId: "funnel-outreach-sent", leadId: "lead-1", type: "FUNNEL", status: "SENT", occurredAt: "2026-09-21T12:00:00.000Z", expiresAt: null });
  const report = buildLegacyHistoryReconciliation(input);
  assert.equal(report.history[0]?.status, "CONTACTED"); assert.equal(report.history[0]?.sentEvidence, true); assert.equal(report.history[0]?.replyEvidence, false);
  assert.ok(report.mappings[0]?.blockers.includes("CONTACTED_HISTORY"));
  assert.ok(report.businessBlockers.find(x => x.businessId === "biz-1")?.blockers.includes("CONTACTED_HISTORY"));
});

test("reply and active suppression history block every plausible candidate", () => {
  const input = base(); input.events.push(
    { eventId: "sent-before-reply", leadId: "lead-1", type: "SEND", status: "SENT", occurredAt: "2026-09-20T12:00:00.000Z", expiresAt: null },
    { eventId: "reply", leadId: "lead-1", type: "FUNNEL", status: "REPLIED", occurredAt: "2026-09-21T12:00:00.000Z", expiresAt: null },
    { eventId: "stop", leadId: "lead-1", type: "SUPPRESSION", status: "ACTIVE", occurredAt: "2026-09-21T12:00:00.000Z", expiresAt: null },
  );
  const mapping = buildLegacyHistoryReconciliation(input).mappings[0]!;
  assert.deepEqual(mapping.blockers, ["CONTACTED_HISTORY", "IDENTITY_REVIEW", "REPLY_HISTORY", "SUPPRESSIVE_HISTORY"]);
});

test("suppression remains the primary history status while uncertain contact is retained", () => {
  const input = base(); input.events.push(
    { eventId: "unsubscribe", leadId: "lead-1", type: "SUPPRESSION", status: "ACTIVE", occurredAt: "2026-09-21T12:00:00.000Z", expiresAt: null },
    { eventId: "unknown-contact", leadId: "lead-1", type: "FUNNEL", status: "UNKNOWN_OUTCOME", occurredAt: "2026-09-21T12:01:00.000Z", expiresAt: null },
  );
  const item = buildLegacyHistoryReconciliation(input).history[0]!;
  assert.equal(item.status, "SUPPRESSIVE"); assert.equal(item.unresolved, true); assert.equal(item.suppressionActive, true);
});

test("expired suppression remains visible at pinned asOf and blocks pending review", () => {
  const input = base(); input.events.push({ eventId: "old-stop", leadId: "lead-1", type: "SUPPRESSION", status: "ACTIVE", occurredAt: "2025-01-01T00:00:00.000Z", expiresAt: "2026-09-22T11:00:00.000Z" });
  const report = buildLegacyHistoryReconciliation(input);
  assert.equal(report.history[0]?.suppressionExpired, true); assert.equal(report.history[0]?.suppressionActive, false);
  assert.ok(report.mappings[0]?.blockers.includes("SUPPRESSION_REVIEW"));
  assert.equal(report.suppressions[0]?.status, "EXPIRED");
});

test("email-only suppression matches exact v2 contact IDs without leaking addresses", () => {
  const input = base(); input.legacyLeads = [];
  input.contactPoints.push({ contactPointId: "unrelated-contact", businessId: "biz-1", channel: "EMAIL", value: "other@example.ca" });
  input.events.push({ eventId: "email-stop", leadId: null, type: "SUPPRESSION", status: "ACTIVE", occurredAt: "2026-09-21T12:00:00.000Z", expiresAt: null, email: " LEGACY@EXAMPLE.CA " });
  const report = buildLegacyHistoryReconciliation(input);
  assert.equal(report.unresolvedHistory, true);
  assert.deepEqual(report.suppressions[0]?.contactMatches, [{ businessId: "biz-1", contactPointId: "contact-1" }]);
  assert.deepEqual(report.suppressions[0]?.contactMatches.map(x => Object.keys(x)), [["businessId", "contactPointId"]]);
  assert.match(report.suppressions[0]?.eventRef ?? "", /^event:sha256:[a-f0-9]{64}$/);
  assert.equal(report.suppressions[0]?.occurredAt, "2026-09-21T12:00:00.000Z");
  assert.equal(report.suppressions[0]?.eventRef.includes("email-stop"), false);
  assert.equal(JSON.stringify(report).includes("legacy@example.ca"), false);
  const mappedInput = base(); mappedInput.legacyLeads[0]!.email = "legacy@example.ca"; mappedInput.legacyLeads[0]!.phone = null; mappedInput.legacyLeads[0]!.domain = null;
  mappedInput.contactPoints.push({ contactPointId: "unrelated-contact", businessId: "biz-1", channel: "EMAIL", value: "other@example.ca" });
  mappedInput.events.push({ eventId: "unrelated-stop", leadId: null, type: "SUPPRESSION", status: "ACTIVE", occurredAt: "2026-09-21T12:00:00.000Z", expiresAt: null, email: "other@example.ca" });
  assert.deepEqual(buildLegacyHistoryReconciliation(mappedInput).mappings[0]?.candidates[0]?.contactPointIds, ["contact-1"]);
  assert.ok(report.businessBlockers.find(x => x.businessId === "biz-1")?.blockers.includes("SUPPRESSIVE_HISTORY"));
});

test("standalone domain suppression and v2 stops have business-level blockers without legacy leads", () => {
  const input = base(); input.legacyLeads = [];
  input.events.push({ eventId: "domain-stop", leadId: null, type: "SUPPRESSION", status: "ACTIVE", occurredAt: "2026-09-21T12:00:00.000Z", expiresAt: null, domain: "www.example.ca" });
  input.v2BusinessStops.push({ businessId: "biz-2", kind: "REPLY", status: "ACTIVE", expiresAt: null });
  const report = buildLegacyHistoryReconciliation(input);
  assert.ok(report.businessBlockers.find(x => x.businessId === "biz-1")?.blockers.includes("SUPPRESSIVE_HISTORY"));
  assert.ok(report.businessBlockers.find(x => x.businessId === "biz-2")?.blockers.includes("REPLY_HISTORY"));
  assert.equal(report.ownerReviewRequired, true);
});

test("suppression without an exact email match remains globally unresolved", () => {
  const input = base(); input.legacyLeads = [];
  input.events.push({ eventId: "unknown-stop", leadId: null, type: "SUPPRESSION", status: "ACTIVE", occurredAt: "2026-09-21T12:00:00.000Z", expiresAt: null, email: "unknown@example.ca" });
  const report = buildLegacyHistoryReconciliation(input);
  assert.equal(report.unresolvedHistory, true);
  assert.deepEqual(report.unresolvedReasons, ["SUPPRESSION_WITHOUT_MATCHABLE_IDENTITY"]);
  assert.equal(JSON.stringify(report).includes("unknown@example.ca"), false);
});

test("v2 stop blocks exact candidate even if the row is marked expired", () => {
  const input = base(); input.v2BusinessStops.push({ businessId: "biz-1", kind: "CONTACTED", status: "EXPIRED", expiresAt: "2026-01-01T00:00:00.000Z" });
  assert.ok(buildLegacyHistoryReconciliation(input).mappings[0]?.blockers.includes("CONTACTED_HISTORY"));
});

test("missing leads and partial input fail closed", () => {
  const input = base(); input.events.push({ eventId: "orphan", leadId: "missing", type: "SEND", status: "SENT", occurredAt: "2026-09-21T12:00:00.000Z", expiresAt: null });
  assert.equal(buildLegacyHistoryReconciliation(input).unresolvedHistory, true);
  assert.throws(() => buildLegacyHistoryReconciliation({ ...base(), complete: false } as never), /Incomplete/);
  const future = base(); future.events.push({ eventId: "future", leadId: "lead-1", type: "SEND", status: "SENT", occurredAt: "2026-09-23T00:00:00.000Z", expiresAt: null });
  assert.throws(() => buildLegacyHistoryReconciliation(future), /Future-dated/);
});

test("output is deterministic and contains no projected contact values", () => {
  const input = base(); input.legacyLeads[0]!.email = "legacy@example.ca"; input.events.push({ eventId: "send", leadId: "lead-1", type: "SEND", status: "ACCEPTED", occurredAt: "2026-09-21T12:00:00.000Z", expiresAt: null });
  const first = buildLegacyHistoryReconciliation(input); const second = buildLegacyHistoryReconciliation(input);
  assert.deepEqual(first, second);
  const serialized = JSON.stringify(first);
  assert.equal(serialized.includes("legacy@example.ca"), false);
  assert.equal(serialized.includes("5195550100"), false);
  assert.equal(first.history[0]?.events[0]?.eventRef.includes("send"), false);
  assert.equal(first.history[0]?.events[0]?.occurredAt, "2026-09-21T12:00:00.000Z");
});
