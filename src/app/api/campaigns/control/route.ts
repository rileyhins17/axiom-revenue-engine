import { z } from "zod";

import { founderRequest, json } from "@/lib/outreach/outreach-api";
import { pauseCampaign, resumeCampaign } from "@/lib/outreach/outreach-control";

export const dynamic = "force-dynamic";
const Command = z.object({ campaign: z.string().min(2).max(40), action: z.enum(["pause", "resume"]) }).strict();

/** Riley or Aidan pauses or resumes one campaign. Touches only that campaign's switch. */
export async function POST(request: Request) {
  const input = await founderRequest(request, Command, "pause or resume a campaign");
  if ("response" in input) return input.response;
  const { owner, body, db } = input;
  try {
    if (body.action === "pause") {
      await pauseCampaign(db, body.campaign, "Paused from the Campaigns screen", owner.name);
      return json({ state: "paused" });
    }
    const result = await resumeCampaign(db, body.campaign, owner.name);
    if (result.result === "MISSING") return json({ error: "There's no such campaign." }, 404);
    if (result.result === "NOT_READY") return json({ error: `It can't start yet: ${result.why}.` }, 409);
    return json({ state: "live" });
  } catch {
    return json({ error: "Could not save. Try again." }, 503);
  }
}
