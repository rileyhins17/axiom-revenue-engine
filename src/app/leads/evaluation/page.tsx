import type { Metadata } from "next";

import { OwnerLeadEvaluationWorkspace } from "@/components/leads/owner-lead-evaluation-workspace";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Quality Lab | Axiom Revenue Engine" };

export default async function LeadEvaluationPage() {
  await requireSession();
  return <OwnerLeadEvaluationWorkspace />;
}
