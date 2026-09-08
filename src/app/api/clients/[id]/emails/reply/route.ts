import { requireAdminApiSession } from "@/lib/session";
import { handleApprovedManualReply } from "@/lib/revenue-engine/manual-reply";
import { getManualReplyRuntime } from "@/lib/revenue-engine/manual-reply-runtime";

/** Submit an existing exact approved reply by stable intent ID. No request field
 * selects sender, recipient, content, provider, approval, cost or policy. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireAdminApiSession(request);
  if ("response" in authResult) return authResult.response;

  return handleApprovedManualReply(request, (await params).id, {
    userId: authResult.session.user.id,
    sessionId: authResult.session.session.id,
  }, getManualReplyRuntime());
}
