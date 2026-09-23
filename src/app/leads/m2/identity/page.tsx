import type { Metadata } from "next";

import { M2OwnerIdentityReview } from "@/components/leads/m2-owner-identity-review";
import { getM2OwnerIdentityActor } from "@/lib/revenue-engine/m2-owner-identity-actor";
import { readLocalM2OwnerIdentityPacket } from "@/lib/revenue-engine/m2-owner-identity-packet";
import { requireAdminSession } from "@/lib/session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Review Businesses | Axiom Revenue Engine" };

export default async function M2OwnerIdentityPage() {
  const session = await requireAdminSession();
  const packet = await readLocalM2OwnerIdentityPacket();
  const actor = getM2OwnerIdentityActor(session.user.email);
  return <M2OwnerIdentityReview result={packet} actor={actor} />;
}
