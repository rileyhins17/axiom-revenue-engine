import { z } from "zod";

import { getCloudflareBindings } from "@/lib/cloudflare";
import { founderRequest, json } from "@/lib/outreach/outreach-api";
import { SCREEN_MAX_CSV_CHARS, loadList } from "@/lib/outreach/outreach-load";

export const dynamic = "force-dynamic";
const Command = z.object({
  campaign: z.string().min(1).max(80),
  name: z.string().min(1).max(120),
  csv: z.string().min(1).max(SCREEN_MAX_CSV_CHARS),
  first: z.string().max(8000).optional(),
  followUp: z.string().max(8000).optional(),
  save: z.boolean(),
}).strict();

/** Checks a list for a campaign ("save": false writes nothing) or loads it as a batch waiting for approval. */
export async function POST(request: Request) {
  const input = await founderRequest(request, Command, "load a list");
  if ("response" in input) return input.response;
  const { owner, body, db } = input;
  const env = getCloudflareBindings() ?? {};
  const mailing = typeof env.FCC_CAMPAIGN_MAILING_ADDRESS === "string" ? env.FCC_CAMPAIGN_MAILING_ADDRESS : null;
  try {
    const result = await loadList(db, body, { loadedBy: owner.name, now: new Date(), newId: () => crypto.randomUUID(), mailingAddress: mailing });
    return result.ok ? json(result) : json({ error: result.error }, 422);
  } catch {
    return json({ error: "Could not check or load the list. Nothing was saved; try again." }, 503);
  }
}
