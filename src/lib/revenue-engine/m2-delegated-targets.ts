import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import type { M2ManualWebsiteObservationTarget } from "./m2-manual-website-observation";
import type { M2OwnerIdentityPacketResult } from "./m2-owner-identity-packet";
import { PrivateKwM2CodexDelegatedOwnerDecisionsSchema } from "./private-kw-m2-owner-decisions";

/** The saved delegated KEEP/REPLACE ledger recorded in the 2026-09-23 identity review. */
export const M2_DELEGATED_DECISIONS_PATH = path.join("data", "kw-evaluation", "m2-codex-delegated-decisions-2026-09-23.json");
export const M2_DELEGATED_DECISIONS_SHA256 = "35b350cb17be634d53585ecb6e438c0e78e6fc05d74c53fb650fe226b6579645";

export function identityDigest(reviewId: string, businessName: string, approvedWebsiteUrl: string) {
  return createHash("sha256").update(JSON.stringify([reviewId, businessName, approvedWebsiteUrl]), "utf8").digest("hex");
}

/**
 * Resolves the ten businesses selected by the pinned delegated ledger. KEEP uses the
 * reviewed packet's identity; REPLACE uses the ledger's supported alternate.
 */
export function buildM2DelegatedTargets(packet: M2OwnerIdentityPacketResult, ledgerBytes: Uint8Array, expectedSha256 = M2_DELEGATED_DECISIONS_SHA256): M2ManualWebsiteObservationTarget[] {
  if (packet.status !== "READY") return [];
  if (createHash("sha256").update(ledgerBytes).digest("hex") !== expectedSha256) {
    throw new Error("The delegated M2 decision ledger does not match its recorded digest.");
  }
  const ledger = PrivateKwM2CodexDelegatedOwnerDecisionsSchema.parse(JSON.parse(new TextDecoder().decode(ledgerBytes)));
  const byId = new Map(ledger.decisions.map((decision) => [decision.reviewId, decision]));
  const targets: M2ManualWebsiteObservationTarget[] = [];
  for (const candidate of packet.selected) {
    const decision = byId.get(candidate.reviewId);
    if (!decision) continue;
    const [businessName, approvedWebsiteUrl] = decision.action === "KEEP"
      ? [candidate.name, candidate.officialWebsite]
      : decision.action === "REPLACE" ? [decision.replacement.name, decision.replacement.websiteUrl] : [null, null];
    if (!businessName || !approvedWebsiteUrl) continue;
    targets.push({ reviewId: candidate.reviewId, businessName, approvedWebsiteUrl, businessIdentityDigest: identityDigest(candidate.reviewId, businessName, approvedWebsiteUrl) });
  }
  return targets;
}

export async function readM2DelegatedTargets(packet: M2OwnerIdentityPacketResult, root = process.cwd()) {
  return buildM2DelegatedTargets(packet, await readFile(path.join(root, M2_DELEGATED_DECISIONS_PATH)));
}
