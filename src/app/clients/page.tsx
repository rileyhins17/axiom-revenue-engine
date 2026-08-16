import { Users } from "lucide-react";

import { ClientsBoard } from "@/components/ClientsBoard";
import { PageHeader } from "@/components/ui/page-header";
import { getPrisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function ClientsPage() {
  await requireSession();

  const prisma = getPrisma();

  const leads = await prisma.lead.findMany({
    where: {
      isArchived: false,
      OR: [
        { outreachStatus: { in: ["REPLIED", "INTERESTED"] } },
        { dealStage: { not: null } },
      ],
    },
    orderBy: { lastUpdated: "desc" },
  }).catch(() => []);

  const activeDealCount = leads.filter((l) => l.dealStage && l.dealStage !== "LOST").length;
  const mrrTotal = leads
    .filter((l) => l.dealStage === "ACTIVE" || l.dealStage === "RETAINED")
    .reduce((sum, l) => sum + (l.monthlyValue ?? 0), 0);

  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-6">
      <PageHeader
        eyebrow="Relationship pipeline"
        title="Clients"
        description="Turn replies into next actions, move deals forward, and keep recurring revenue visible."
        icon={Users}
        metrics={[
          { label: "Active deals", value: activeDealCount.toLocaleString(), detail: "open opportunities" },
          { label: "Monthly revenue", value: `$${mrrTotal.toLocaleString()}`, detail: "active MRR", tone: "positive" },
        ]}
      />

      <ClientsBoard initialLeads={leads} />
    </div>
  );
}
