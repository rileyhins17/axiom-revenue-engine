import { createHash } from "node:crypto";

import { PrivateKwM2OwnerDecisionsSchema } from "./private-kw-m2-owner-decisions";
import type { M2OwnerIdentityPacketResult } from "./m2-owner-identity-packet";
import type { M2ManualWebsiteObservationTarget } from "./m2-manual-website-observation";

/** Only current identity choices that select a business may enter manual website review. */
export function getApprovedM2ManualWebsiteObservationTargets(
  packet: M2OwnerIdentityPacketResult,
  savedDecisions: unknown,
): M2ManualWebsiteObservationTarget[] {
  if (packet.status !== "READY") return [];
  const decisions = PrivateKwM2OwnerDecisionsSchema.safeParse(savedDecisions);
  if (!decisions.success || decisions.data.researchReviewSha256 !== packet.packetSha256) return [];
  const byId = new Map(decisions.data.decisions.map((decision) => [decision.reviewId, decision]));
  const targets: M2ManualWebsiteObservationTarget[] = [];
  for (const candidate of packet.selected) {
    const decision = byId.get(candidate.reviewId);
    if (!decision) continue;
    let businessName: string;
    let approvedWebsiteUrl: string;
    if (decision.action === "KEEP") {
      businessName = candidate.name;
      approvedWebsiteUrl = candidate.officialWebsite;
    } else if (decision.action === "REPLACE") {
      businessName = decision.replacement.name;
      approvedWebsiteUrl = decision.replacement.websiteUrl;
    } else {
      continue;
    }
    const businessIdentityDigest = createHash("sha256")
      .update(JSON.stringify([candidate.reviewId, businessName, approvedWebsiteUrl]), "utf8")
      .digest("hex");
    targets.push({ reviewId: candidate.reviewId, businessName, approvedWebsiteUrl, businessIdentityDigest });
  }
  return targets;
}
