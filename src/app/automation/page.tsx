import { AutomationConsole } from "@/components/automation/automation-console";
import { getAutomationOperatorConsole } from "@/lib/automation-operator-view";
import { requireAdminSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function AutomationPage() {
  const session = await requireAdminSession();
  const data = await getAutomationOperatorConsole({ userId: session.user.id, sessionId: session.session.id });

  return <AutomationConsole data={data} />;
}
