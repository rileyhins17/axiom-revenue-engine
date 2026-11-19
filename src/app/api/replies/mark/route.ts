import { z } from "zod";

import { writeAuditEvent } from "@/lib/audit";
import { founderRequest, json } from "@/lib/outreach/outreach-api";
import { markReply } from "@/lib/outreach/outreach-reply-list";
import { withTimeout } from "@/lib/timeout";

export const dynamic = "force-dynamic";
const Command = z.object({ id: z.string().min(1).max(400), answered: z.boolean().optional(), success: z.boolean().optional() }).strict();

/**
 * Riley or Aidan marks a reply answered, or as one that counts toward its campaign's success number.
 * It changes only those marks on the reply: no email, no follow-up and nobody's mail is touched.
 */
export async function POST(request: Request) {
  const input = await founderRequest(request, Command, "mark a reply");
  if ("response" in input) return input.response;
  const { owner, body, db } = input;
  try {
    const result = await withTimeout(markReply(db, body.id, { answered: body.answered, success: body.success }, owner.name), 10_000, "reply-mark");
    if (!result.ok) return json({ error: result.why }, 409);
    await writeAuditEvent({ action: "reply.mark", targetType: "OutreachReply", targetId: body.id.slice(0, 200), metadata: { by: owner.name, answered: body.answered ?? null, success: body.success ?? null } });
    return json({ reply: result.reply });
  } catch {
    return json({ error: "Could not save. Try again." }, 503);
  }
}
