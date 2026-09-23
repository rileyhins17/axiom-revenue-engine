import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { loadSavedM2OwnerIdentityDecisions, M2OwnerIdentityReview, saveM2OwnerIdentityDecisions } from "./m2-owner-identity-review";
import { emptyM2OwnerIdentityDraft } from "./m2-owner-identity-review-ledger";
import type { M2OwnerIdentityPacketResult } from "@/lib/revenue-engine/m2-owner-identity-packet";

const syntheticPacket: M2OwnerIdentityPacketResult = {
  status: "READY",
  packetSha256: "a".repeat(64),
  selected: Array.from({ length: 10 }, (_, index) => ({
    reviewId: `M2-${String(index + 1).padStart(2, "0")}`,
    name: `Synthetic business ${index + 1}`,
    officialWebsite: `https://business-${index + 1}.example.test/`,
    primarySource: `https://business-${index + 1}.example.test/about`,
    city: "KITCHENER" as const,
    niche: "ROOFING" as const,
    independenceClaim: "The synthetic business describes itself as locally owned.",
    accessBlocked: index === 5 || index === 9,
  })),
  supportedAlternates: [],
};

test("identity review shows source-linked owner decisions without implying contact approval", () => {
  const html = renderToStaticMarkup(createElement(M2OwnerIdentityReview, { result: syntheticPacket, actor: "RILEY" }));
  assert.match(html, /<h1[^>]*>Choose businesses for a closer look<\/h1>/);
  assert.match(html, /Business 1 of 10/);
  assert.match(html, /Review progress/);
  assert.match(html, /Synthetic business 1/);
  assert.match(html, /href="https:\/\/business-1\.example\.test\/about"/);
  assert.match(html, /Ownership information/);
  assert.match(html, /Saving does not approve research, contact, or email/);
  assert.match(html, />Signed in as<\/p>/);
  assert.match(html, /font-semibold[^>]*>Riley<\/p>/);
  assert.match(html, />Keep<\/span>/);
  assert.match(html, />Replace<\/span>/);
  assert.match(html, />Hold<\/span>/);
  assert.match(html, />Reject<\/span>/);
  assert.match(html, /Save owner decisions<\/button>/);
  assert.match(html, /disabled=""[^>]*>.*Save owner decisions/);
  assert.doesNotMatch(html, /Who is reviewing\?|Reviewing owner/);
  assert.doesNotMatch(html, /packet|source plan|M2-01/i);
  assert.doesNotMatch(html, /<main\b/);
  assert.doesNotMatch(html, /Gmail|Send email|Approve outreach/);
});

test("identity review refuses to display unverifiable local research", () => {
  const html = renderToStaticMarkup(createElement(M2OwnerIdentityReview, {
    result: { status: "UNAVAILABLE", reason: "The packet digest changed." },
    actor: null,
  }));
  assert.match(html, /The business list could not be verified/);
  assert.match(html, /Try refreshing, or ask an administrator for help/);
  assert.doesNotMatch(html, /packet|digest/i);
  assert.doesNotMatch(html, /Synthetic business|Download owner decisions/);
});

test("saved owner decisions use the same-origin endpoint and exact owner-bound payload", async () => {
  const saved = {
    status: "SAVED",
    filename: "m2-owner-decisions-test.json",
    reviewedBy: "RILEY",
    reviewedAt: "2026-09-23T14:00:00.000Z",
    researchReviewSha256: "b".repeat(64),
    decisionDigest: "c".repeat(64),
  };
  const getCalls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
  const getResponse = await loadSavedM2OwnerIdentityDecisions(async (input, init) => {
    getCalls.push([input, init]);
    return Response.json({ saved });
  });
  assert.deepEqual(getResponse, saved);
  assert.equal(getCalls[0]?.[0], "/api/leads/m2/identity-decisions");
  assert.deepEqual(getCalls[0]?.[1], { method: "GET", credentials: "same-origin", cache: "no-store" });

  const payload = { packetSha256: "a".repeat(64), reviewedBy: "RILEY" as const, drafts: { "M2-01": { ...emptyM2OwnerIdentityDraft(), action: "HOLD" as const } } };
  const postCalls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
  const postResponse = await saveM2OwnerIdentityDecisions(payload, async (input, init) => {
    postCalls.push([input, init]);
    return Response.json({ saved });
  });
  assert.deepEqual(postResponse, saved);
  assert.equal(postCalls[0]?.[0], "/api/leads/m2/identity-decisions");
  assert.equal(postCalls[0]?.[1]?.method, "POST");
  assert.equal(postCalls[0]?.[1]?.credentials, "same-origin");
  assert.equal(postCalls[0]?.[1]?.headers && new Headers(postCalls[0][1]?.headers).get("content-type"), "application/json");
  assert.deepEqual(JSON.parse(String(postCalls[0]?.[1]?.body)), payload);
});

test("saved owner decision requests surface server errors to the caller", async () => {
  await assert.rejects(
    loadSavedM2OwnerIdentityDecisions(async () => Response.json({ error: "Saved owner decisions could not be verified." }, { status: 503 })),
    /Saved owner decisions could not be verified\./,
  );
  await assert.rejects(
    saveM2OwnerIdentityDecisions({ packetSha256: "a".repeat(64), reviewedBy: "AIDAN", drafts: {} }, async () => Response.json({ error: "The private review could not be saved locally." }, { status: 503 })),
    /The private review could not be saved locally\./,
  );
});
