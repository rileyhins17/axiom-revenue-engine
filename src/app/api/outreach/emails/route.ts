import { getDatabase } from "@/lib/cloudflare";
import { requireAdminApiSession } from "@/lib/session";
import { createLegacyMailHistory, legacyMailHeaders } from "@/lib/revenue-engine/legacy-mail-history";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const auth = await requireAdminApiSession(request);
  if ("response" in auth) {
    Object.entries(legacyMailHeaders).forEach(([key,value]) => auth.response.headers.set(key,value));
    return auth.response;
  }
  const json = (data: unknown, status = 200) => Response.json(data,{ status, headers: legacyMailHeaders });
  try {
    const history = await createLegacyMailHistory(getDatabase())(
      { userId: auth.session.user.id, sessionId: auth.session.session.id });
    if (!history) return json({ error: "Legacy history unavailable" },404);
    return json({ emails: history.emails, hasMore: history.hasMore, source: history.source });
  } catch { return json({ error: "Legacy history is unavailable. No mailbox was contacted." },503); }
}
