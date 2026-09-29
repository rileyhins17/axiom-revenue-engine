import { z } from "zod";

import {
  buildM2OwnerIdentityDecisionLedger,
  type M2OwnerIdentityDraft,
  type M2OwnerIdentityDraftMap,
  type M2OwnerIdentityReadyPacket,
  type M2OwnerReviewer,
} from "@/components/leads/m2-owner-identity-review-ledger";
import {
  PrivateKwM2OwnerDecisionsSchema,
  type PrivateKwM2OwnerDecisions,
} from "./private-kw-m2-owner-decisions";

const DraftSchema = z.object({
  action: z.enum(["KEEP", "KEEP_AS_BLOCKED", "REPLACE", "HOLD", "REJECT"]).nullable(),
  rationale: z.string().max(500),
  identityConfirmed: z.boolean(),
  marketAndNicheConfirmed: z.boolean(),
  independenceConfirmed: z.boolean(),
  alternateKey: z.string().max(10_000),
  city: z.enum(["KITCHENER", "WATERLOO", "CAMBRIDGE", ""]).or(z.literal("")),
  niche: z.enum(["ROOFING", "HVAC", "LANDSCAPING", ""]).or(z.literal("")),
}).strict();

const SaveCommandInputSchema = z.object({
  packetSha256: z.string().regex(/^[a-f0-9]{64}$/),
  reviewedBy: z.enum(["RILEY", "AIDAN"]),
  drafts: z.record(z.string(), DraftSchema),
}).strict();

const REVIEW_IDS = Array.from({ length: 10 }, (_, index) => `M2-${String(index + 1).padStart(2, "0")}`);

/** Validates a browser save payload against the current packet and authenticated reviewer. */
export function buildValidatedM2OwnerIdentitySaveCommand(
  input: unknown,
  packet: M2OwnerIdentityReadyPacket,
  actor: M2OwnerReviewer,
  reviewedAt: string,
): PrivateKwM2OwnerDecisions {
  const parsed = SaveCommandInputSchema.parse(input);
  if (parsed.packetSha256 !== packet.packetSha256) {
    throw new Error("Owner identity save does not match the current research packet digest.");
  }
  if (parsed.reviewedBy !== actor) {
    throw new Error("Owner identity save reviewer does not match the authenticated reviewer.");
  }

  const actualIds = Object.keys(parsed.drafts).sort();
  if (actualIds.length !== REVIEW_IDS.length || REVIEW_IDS.some((id, index) => actualIds[index] !== id)) {
    throw new Error("Owner identity save must include exactly M2-01 through M2-10 once.");
  }

  const ledger = buildM2OwnerIdentityDecisionLedger({
    packet,
    reviewedBy: actor,
    reviewedAt,
    drafts: parsed.drafts as M2OwnerIdentityDraftMap,
  });
  return PrivateKwM2OwnerDecisionsSchema.parse(ledger);
}

export type { M2OwnerIdentityDraft };
