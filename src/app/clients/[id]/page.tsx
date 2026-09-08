import { notFound } from "next/navigation";
import { ClientProfile } from "@/components/ClientProfile";
import { getDatabase } from "@/lib/cloudflare";
import { getPrisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/session";
import { createLegacyMailHistory, parseLegacyLeadId } from "@/lib/revenue-engine/legacy-mail-history";

export const dynamic = "force-dynamic";

export default async function ClientProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdminSession();
  const leadId = parseLegacyLeadId((await params).id);
  if (!leadId) notFound();
  const prisma = getPrisma();
  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead || lead.isArchived) notFound();
  const activities = await prisma.crmActivity.findMany({ where: { leadId }, orderBy: { createdAt: "desc" }, take: 100 });
  // Read last: current admission must still hold after the other asynchronous work.
  const history = await createLegacyMailHistory(getDatabase())(
    { userId: session.user.id, sessionId: session.session.id }, { leadId, bodies: true, sequence: true });
  if (!history) notFound();
  return <ClientProfile lead={lead} initialActivities={activities} outreachEmails={history.emails}
    legacyMailHasMore={history.hasMore} sequence={history.sequence} sequenceSteps={history.sequenceSteps} />;
}
