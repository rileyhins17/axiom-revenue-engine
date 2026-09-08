import { getDatabase } from "@/lib/cloudflare";
import { getPrisma } from "@/lib/prisma";
import { requireAdminApiSession } from "@/lib/session";
import { createLegacyMailHistory, legacyMailHeaders, parseLegacyLeadId } from "@/lib/revenue-engine/legacy-mail-history";

export const dynamic = "force-dynamic";
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminApiSession(request);
  if ("response" in auth) {
    Object.entries(legacyMailHeaders).forEach(([key,value]) => auth.response.headers.set(key,value));
    return auth.response;
  }
  const json = (data: unknown, status = 200) => Response.json(data, { status, headers: legacyMailHeaders });
  const leadId = parseLegacyLeadId((await params).id);
  if (!leadId) return json({ error: "Invalid client id" },400);
  try {
    const prisma = getPrisma();
    const lead = await prisma.lead.findUnique({ where: { id: leadId } });
    if (!lead || lead.isArchived) return json({ error: "Client not found" },404);
    const activities = await prisma.crmActivity.findMany({ where: { leadId }, orderBy: { createdAt: "desc" }, take: 100 });
    const history = await createLegacyMailHistory(getDatabase())(
      { userId: auth.session.user.id, sessionId: auth.session.session.id }, { leadId });
    if (!history) return json({ error: "Client history unavailable" },404);
    return json({ lead, activities, outreachEmails: history.emails, legacyMailHasMore: history.hasMore });
  } catch { return json({ error: "Client history is unavailable. Try reading it again later." },503); }
}
