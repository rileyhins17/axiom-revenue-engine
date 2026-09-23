import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { M2OwnerIdentityReview } from "./m2-owner-identity-review";
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
  const html = renderToStaticMarkup(createElement(M2OwnerIdentityReview, { result: syntheticPacket }));
  assert.match(html, /<h1[^>]*>Choose businesses to research<\/h1>/);
  assert.match(html, /Synthetic business 1/);
  assert.match(html, /href="https:\/\/business-1\.example\.test\/about"/);
  assert.match(html, /stated by the business and has not been confirmed against a registry/);
  assert.match(html, /does not qualify, contact, or approve outreach/);
  assert.match(html, /Download owner decisions<\/button>/);
  assert.match(html, /disabled=""[^>]*>.*Download owner decisions/);
  assert.doesNotMatch(html, /<main\b/);
  assert.doesNotMatch(html, /Gmail|Send email|Approve outreach/);
});

test("identity review refuses to display unverifiable local research", () => {
  const html = renderToStaticMarkup(createElement(M2OwnerIdentityReview, {
    result: { status: "UNAVAILABLE", reason: "The packet digest changed." },
  }));
  assert.match(html, /This review packet is unavailable/);
  assert.match(html, /The packet digest changed/);
  assert.doesNotMatch(html, /Synthetic business|Download owner decisions/);
});
