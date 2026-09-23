import type { Metadata } from "next";

import { BusinessResearchWorkbench } from "@/components/leads/business-research-workbench";
import { M2ManualWebsiteObservations } from "@/components/leads/m2-manual-website-observations";
import { readLocalM2OwnerConsole } from "@/lib/revenue-engine/m2-local-owner-console";
import { requireAdminSession } from "@/lib/session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Business Review | Axiom Revenue Engine" };

export default async function M2OwnerReviewPage() {
  await requireAdminSession();
  const result = await readLocalM2OwnerConsole();
  return <>
    <BusinessResearchWorkbench result={result} />
    {result.status === "VERIFIED_LOCAL" ? <M2ManualWebsiteObservations /> : null}
  </>;
}
