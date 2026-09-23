import type { Metadata } from "next";

import { OwnerLeadList, OwnerLeadsUnavailable } from "@/components/leads/owner-lead-list";
import { getDatabase } from "@/lib/cloudflare";
import {
  readOwnerLeadList,
  type OwnerLeadListResponse,
} from "@/lib/revenue-engine/owner-lead-read-model";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Businesses | Axiom Revenue Engine" };

export default async function LeadsPage() {
  const session = await requireSession();

  let leads: OwnerLeadListResponse;
  try {
    leads = await readOwnerLeadList(getDatabase(), new Date().toISOString(), 50);
  } catch {
    return <OwnerLeadsUnavailable />;
  }

  return <OwnerLeadList data={leads} canReviewBusinessResearch={session.user.role === "admin"} />;
}
