/**
 * Which sending inboxes end their campaign emails with the founder's full signature instead of the plain footer.
 * Riley, Nov 13 2026: "just put it into the engine". Aidan's inbox keeps the plain footer until he chooses; adding
 * his is one line here. Title and cell come from the signature settings the FCC emails used.
 */
import { readFccSignatures } from "@/lib/fcc-campaign-control";
import type { ProspectDb } from "@/lib/revenue-engine/engine-prospects-d1";
import type { Sender } from "@/lib/outreach/outreach-words";

export const SIGNED_INBOXES = new Set(["rileyhinspergerbusiness@gmail.com"]);

/** The senders, with a signature on each signed inbox. A settings read that fails still signs, without title or cell. */
export async function withSignatures(db: ProspectDb, senders: Sender[]): Promise<Sender[]> {
  if (!senders.some((sender) => SIGNED_INBOXES.has(sender.address))) return senders;
  const settings = await readFccSignatures(db).catch(() => ({} as Awaited<ReturnType<typeof readFccSignatures>>));
  return senders.map((sender) => SIGNED_INBOXES.has(sender.address) ? { ...sender, signature: settings[sender.address] ?? {} } : sender);
}
