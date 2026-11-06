import { z } from "zod";

import { founderRequest, json } from "@/lib/outreach/outreach-api";
import { approveBatch, stopBatch } from "@/lib/outreach/outreach-control";

export const dynamic = "force-dynamic";
const Command = z.object({ batch: z.string().min(1).max(80), action: z.enum(["approve", "stop"]), note: z.string().max(300).optional() }).strict();

/** A campaign's named approver opens a batch for sending, or a founder stops one for good. */
export async function POST(request: Request) {
  const input = await founderRequest(request, Command, "approve a batch");
  if ("response" in input) return input.response;
  const { owner, body, db } = input;
  try {
    if (body.action === "stop") {
      await stopBatch(db, body.batch, owner.name);
      return json({ status: "stopped" });
    }
    const result = await approveBatch(db, body.batch, owner.name, body.note ?? `Approved on the Campaigns screen after reading the samples`);
    if (!result.ok) return json({ error: result.why }, 409);
    return json({ status: "approved", by: owner.name });
  } catch {
    return json({ error: "Could not save. Try again." }, 503);
  }
}
