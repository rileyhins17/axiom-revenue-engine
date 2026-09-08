import { getDatabase } from "@/lib/cloudflare";
import { requireAdminApiSession } from "@/lib/session";
import { createLegacyMailHistory, legacyMailHeaders } from "@/lib/revenue-engine/legacy-mail-history";

export const dynamic = "force-dynamic";
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminApiSession(request);
  if ("response" in auth) {
    Object.entries(legacyMailHeaders).forEach(([key,value]) => auth.response.headers.set(key,value));
    return auth.response;
  }
  const json = (data: unknown, status = 200) => Response.json(data,{ status, headers: legacyMailHeaders });
  const { id } = await params;
  if (!id || id.length>256) return json({ error: "Invalid email id" },400);
  try {
    const history = await createLegacyMailHistory(getDatabase())(
      { userId: auth.session.user.id, sessionId: auth.session.session.id }, { emailId: id, bodies: true });
    const email = history?.emails[0];
    if (!email) return json({ error: "Email not found" },404);
    return json({ email, lead: { id: email.leadId, businessName: email.businessName, city: email.city } });
  } catch { return json({ error: "Legacy history is unavailable. No mailbox was contacted." },503); }
}
