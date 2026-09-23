import type { Metadata } from "next";

import { M2OwnerIdentityReview } from "@/components/leads/m2-owner-identity-review";
import { readLocalM2OwnerIdentityPacket } from "@/lib/revenue-engine/m2-owner-identity-packet";
import { requireAdminSession } from "@/lib/session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Choose Evaluation Businesses | Axiom Revenue Engine" };

export default async function M2OwnerIdentityPage() {
  await requireAdminSession();
  const packet = await readLocalM2OwnerIdentityPacket();
  return <M2OwnerIdentityReview result={packet} />;
}
