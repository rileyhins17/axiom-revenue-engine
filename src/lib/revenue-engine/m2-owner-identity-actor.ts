import type { M2OwnerReviewer } from "@/components/leads/m2-owner-identity-review-ledger";

/** Only the two named owners may attest to an M2 identity review. */
export function getM2OwnerIdentityActor(email: string | null | undefined): M2OwnerReviewer | null {
  const normalized = email?.trim().toLowerCase();
  if (normalized === "riley@getaxiom.ca") return "RILEY";
  if (normalized === "aidan@getaxiom.ca") return "AIDAN";
  return null;
}
