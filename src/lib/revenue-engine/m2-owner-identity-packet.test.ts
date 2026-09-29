import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { setCloudflareBindings } from "../cloudflare";
import {
  buildM2OwnerIdentityPacket,
  readLocalM2OwnerIdentityPacket,
} from "./m2-owner-identity-packet";

function syntheticPacket() {
  return {
    schemaVersion: 1,
    protocolVersion: "m2-public-research-v1",
    researchOnly: true,
    ownerIdentityReview: "PENDING",
    selected: Array.from({ length: 10 }, (_, index) => {
      const number = String(index + 1).padStart(2, "0");
      return {
        reviewId: `M2-${number}`,
        name: `Synthetic Business ${number}`,
        officialWebsite: `https://business-${number}.example/`,
        city: (["KITCHENER", "WATERLOO", "CAMBRIDGE"] as const)[index % 3],
        niche: (["ROOFING", "HVAC", "LANDSCAPING"] as const)[index % 3],
        primarySource: `https://business-${number}.example/about/`,
        sources: [`https://business-${number}.example/about/`],
        disposition: "PROPOSED_FOR_OWNER_IDENTITY_REVIEW",
        ownerIdentityReview: "PENDING",
        independence: `Synthetic independence claim ${number}`,
      };
    }),
    unselected: [{
      name: "Synthetic Supported Alternate",
      officialWebsite: "https://alternate.example/",
      disposition: "SUPPORTED_ALTERNATE",
      sourceUrl: "https://alternate.example/about/",
      reason: "Synthetic evidence supports a local independent business.",
    }],
  };
}

function encoded(value: unknown) {
  return new TextEncoder().encode(JSON.stringify(value));
}

test("builds a sanitized ten-business identity packet and supported alternates", () => {
  const bytes = encoded(syntheticPacket());
  const digest = createHash("sha256").update(bytes).digest("hex");
  const result = buildM2OwnerIdentityPacket(bytes, digest);

  assert.equal(result.status, "READY");
  if (result.status !== "READY") return;
  assert.equal(result.packetSha256, digest);
  assert.equal(result.selected.length, 10);
  assert.deepEqual(result.selected[0], {
    reviewId: "M2-01",
    name: "Synthetic Business 01",
    officialWebsite: "https://business-01.example/",
    primarySource: "https://business-01.example/about/",
    city: "KITCHENER",
    niche: "ROOFING",
    independenceClaim: "Synthetic independence claim 01",
    accessBlocked: false,
  });
  assert.deepEqual(result.supportedAlternates, [{
    name: "Synthetic Supported Alternate",
    officialWebsite: "https://alternate.example/",
    sourceUrl: "https://alternate.example/about/",
    reason: "Synthetic evidence supports a local independent business.",
  }]);
  assert.deepEqual(Object.keys(result.selected[0]!).sort(), [
    "accessBlocked", "city", "independenceClaim", "name", "niche", "officialWebsite", "primarySource", "reviewId",
  ]);
});

test("rejects packet bytes that do not match the expected digest", () => {
  const result = buildM2OwnerIdentityPacket(encoded(syntheticPacket()), "0".repeat(64));
  assert.equal(result.status, "UNAVAILABLE");
});

test("rejects a selected business without a supported independence claim", () => {
  const packet = syntheticPacket();
  const [first, ...rest] = packet.selected;
  const missingClaim = { ...first, independence: null } as unknown as (typeof packet.selected)[number];
  packet.selected = [missingClaim, ...rest];
  const bytes = encoded(packet);
  const digest = createHash("sha256").update(bytes).digest("hex");
  const result = buildM2OwnerIdentityPacket(bytes, digest);
  assert.equal(result.status, "UNAVAILABLE");
});

test("rejects non-HTTP source schemes in selected businesses and supported alternates", () => {
  const candidatePacket = syntheticPacket();
  candidatePacket.selected[0]!.officialWebsite = "javascript:alert(1)";
  const candidateBytes = encoded(candidatePacket);
  const candidateDigest = createHash("sha256").update(candidateBytes).digest("hex");
  assert.equal(buildM2OwnerIdentityPacket(candidateBytes, candidateDigest).status, "UNAVAILABLE");

  const alternatePacket = syntheticPacket();
  alternatePacket.unselected[0]!.sourceUrl = "file:///private/source";
  const alternateBytes = encoded(alternatePacket);
  const alternateDigest = createHash("sha256").update(alternateBytes).digest("hex");
  assert.equal(buildM2OwnerIdentityPacket(alternateBytes, alternateDigest).status, "UNAVAILABLE");
});

test("local packet reader refuses Cloudflare contexts", async (t) => {
  t.after(() => {
    setCloudflareBindings(null);
  });

  setCloudflareBindings({});
  assert.deepEqual(await readLocalM2OwnerIdentityPacket(), {
    status: "UNAVAILABLE",
    reason: "Local M2 review is not enabled on this server.",
  });
});
