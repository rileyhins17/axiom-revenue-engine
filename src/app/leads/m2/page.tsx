import type { Metadata } from "next";

import { EngineProspects } from "@/components/leads/engine-prospects";
import { BusinessResearchWorkbench } from "@/components/leads/business-research-workbench";
import { M2ManualWebsiteObservations } from "@/components/leads/m2-manual-website-observations";
import { M2WebsiteNeedReviewSection } from "@/components/leads/m2-website-need-review";
import { readLatestEngineRun } from "@/lib/revenue-engine/engine-run-review";
import { readLocalM2OwnerConsole } from "@/lib/revenue-engine/m2-local-owner-console";
import { readLocalM2WebsiteNeedReview } from "@/lib/revenue-engine/m2-website-need-review";
import { requireAdminSession } from "@/lib/session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Business Review | Axiom Revenue Engine" };

export default async function M2OwnerReviewPage() {
  await requireAdminSession();
  const [result, websiteReview, engineRun] = await Promise.all([readLocalM2OwnerConsole(), readLocalM2WebsiteNeedReview(), readLatestEngineRun()]);
  return <>
    <EngineProspects review={engineRun} />
    <M2WebsiteNeedReviewSection review={websiteReview} />
    <BusinessResearchWorkbench result={result} />
    {result.status === "VERIFIED_LOCAL" ? <M2ManualWebsiteObservations /> : null}
  </>;
}
