import { AutomationConsole } from "@/components/automation/automation-console";
import { getAutomationOperatorConsole } from "@/lib/automation-operator-view";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function AutomationPage() {
  await requireSession();
  const data = await getAutomationOperatorConsole();

  return <AutomationConsole data={data} />;
}
