import { getDatabase } from "@/lib/cloudflare";
import { requireAdminApiSession } from "@/lib/session";
import { handleSavedEmailHistory } from "@/lib/revenue-engine/saved-email-history";

export const dynamic = "force-dynamic";

/** Saved owner activity only. Reading never syncs inboxes or refreshes tokens. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminApiSession(request);
  if ("response" in auth) {
    auth.response.headers.set("Cache-Control", "private, no-store");
    return auth.response;
  }
  return handleSavedEmailHistory(request, (await params).id, {
    userId: auth.session.user.id, sessionId: auth.session.session.id,
  }, getDatabase);
}
