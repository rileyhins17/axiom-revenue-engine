import { z } from "zod";

import { founderRequest, json } from "@/lib/outreach/outreach-api";
import { requestTestSend } from "@/lib/outreach/outreach-tests";

export const dynamic = "force-dynamic";
const Command = z.object({ batch: z.string().min(1).max(80), count: z.number().int().min(1).max(3).default(3) }).strict();

/** Queues test emails from a batch to the signed-in founder's own inbox. They go within 15 minutes. */
export async function POST(request: Request) {
  const input = await founderRequest(request, Command, "send test emails");
  if ("response" in input) return input.response;
  const { owner, body, db } = input;
  try {
    await requestTestSend(db, { id: crypto.randomUUID(), batchId: body.batch, to: owner.inbox, by: owner.name, count: body.count });
    return json({ queued: true, to: owner.inbox });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Could not queue the test." }, 409);
  }
}
