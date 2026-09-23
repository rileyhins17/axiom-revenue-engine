import type { Metadata } from "next";

import { AutomationConsole } from "@/components/automation/automation-console";
import { getAutomationOperatorConsole } from "@/lib/automation-operator-view";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Follow-through | Axiom Revenue Engine" };

export default async function AutomationPage() {
  const session = await requireSession();
  const data = await getAutomationOperatorConsole().catch(() => null);

  const isAdmin = session.user.role === "admin";
  return <AutomationConsole data={data} canOpenBusinessReview={isAdmin} canControlEmergencyStop={isAdmin} />;
}
