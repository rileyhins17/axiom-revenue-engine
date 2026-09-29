import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import { getCloudflareBindings } from "@/lib/cloudflare";
import { PrivateKwM2ResearchReviewSchema } from "./private-kw-m2-owner-decisions";

const REVIEW_PACKET_PATH = path.join("data", "kw-evaluation", "m2-public-research-2026-09-22-review.json");
const REVIEW_PACKET_SHA256 = "4bf0d8c942ee253dcc4dfe965390f53f351373506e8846f4596cbde0c8a9e70c";
const ACCESS_BLOCKED_BY_REVIEW_ID = new Set(["M2-06", "M2-10"]);
const PublicHttpUrlSchema = z.string().url().refine((value) => {
  const protocol = new URL(value).protocol;
  return protocol === "http:" || protocol === "https:";
});

const SupportedAlternateSchema = z.object({
  name: z.string().trim().min(1).max(256),
  officialWebsite: PublicHttpUrlSchema,
  sourceUrl: PublicHttpUrlSchema,
  reason: z.string().trim().min(1).max(1000),
});

type SelectedIdentity = {
  reviewId: string;
  name: string;
  officialWebsite: string;
  primarySource: string;
  city: "KITCHENER" | "WATERLOO" | "CAMBRIDGE";
  niche: "ROOFING" | "HVAC" | "LANDSCAPING";
  independenceClaim: string;
  accessBlocked: boolean;
};

type SupportedAlternate = z.infer<typeof SupportedAlternateSchema>;

export type M2OwnerIdentityPacketResult =
  | {
      status: "READY";
      packetSha256: string;
      selected: SelectedIdentity[];
      supportedAlternates: SupportedAlternate[];
    }
  | { status: "UNAVAILABLE"; reason: string };

const UNAVAILABLE_REASON = "The reviewed M2 identity packet could not be verified.";
const LOCAL_GUARD_REASON = "Local M2 review is not enabled on this server.";

/** Pure parser used by the fixed-path local reader and deterministic tests. */
export function buildM2OwnerIdentityPacket(
  bytes: Uint8Array,
  expectedSha256: string,
): M2OwnerIdentityPacketResult {
  try {
    const packetSha256 = createHash("sha256").update(bytes).digest("hex");
    if (!/^[a-f0-9]{64}$/.test(expectedSha256) || packetSha256 !== expectedSha256) {
      return { status: "UNAVAILABLE", reason: UNAVAILABLE_REASON };
    }

    const parsed = PrivateKwM2ResearchReviewSchema.parse(JSON.parse(new TextDecoder().decode(bytes)));
    const selected = parsed.selected.map((candidate): SelectedIdentity => {
      if (!PublicHttpUrlSchema.safeParse(candidate.officialWebsite).success
        || !PublicHttpUrlSchema.safeParse(candidate.primarySource).success) {
        throw new Error("Unsupported source URL scheme.");
      }
      const independenceClaim = typeof candidate.independence === "string" ? candidate.independence.trim() : "";
      if (!independenceClaim) throw new Error("Missing independence claim.");
      return {
        reviewId: candidate.reviewId,
        name: candidate.name,
        officialWebsite: candidate.officialWebsite,
        primarySource: candidate.primarySource,
        city: candidate.city,
        niche: candidate.niche,
        independenceClaim,
        accessBlocked: packetSha256 === REVIEW_PACKET_SHA256 && ACCESS_BLOCKED_BY_REVIEW_ID.has(candidate.reviewId),
      };
    });

    const supportedAlternates = parsed.unselected
      .filter((candidate) => typeof candidate === "object" && candidate !== null && "disposition" in candidate
        && candidate.disposition === "SUPPORTED_ALTERNATE")
      .map((candidate) => SupportedAlternateSchema.parse(candidate));

    return { status: "READY", packetSha256, selected, supportedAlternates };
  } catch {
    return { status: "UNAVAILABLE", reason: UNAVAILABLE_REASON };
  }
}

/** Server-only reader for one fixed, ignored packet. The admin page owns authorization. */
export async function readLocalM2OwnerIdentityPacket(): Promise<M2OwnerIdentityPacketResult> {
  if (getCloudflareBindings() !== null) {
    return { status: "UNAVAILABLE", reason: LOCAL_GUARD_REASON };
  }
  try {
    const bytes = await readFile(path.join(process.cwd(), REVIEW_PACKET_PATH));
    return buildM2OwnerIdentityPacket(bytes, REVIEW_PACKET_SHA256);
  } catch {
    return { status: "UNAVAILABLE", reason: UNAVAILABLE_REASON };
  }
}
