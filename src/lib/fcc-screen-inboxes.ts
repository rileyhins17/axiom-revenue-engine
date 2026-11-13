import { getCloudflareBindings } from "@/lib/cloudflare";
import type { FccInboxRef } from "@/lib/fcc-campaign-status";

/** The sending inboxes by first name: the first inbox is "", an added one is its address. */
export function sendingInboxes(): FccInboxRef[] {
  const env = getCloudflareBindings() ?? {};
  const text = (key: string) => (typeof env[key] === "string" ? (env[key] as string).trim() : "");
  const first = (name: string, fallback: string) => name.split(/\s+/)[0] || fallback;
  const inboxes: FccInboxRef[] = [{ key: "", name: first(text("FCC_SENDER_NAME"), "Aidan") }];
  if (text("FCC_SENDER2_ADDRESS")) inboxes.push({ key: text("FCC_SENDER2_ADDRESS"), name: first(text("FCC_SENDER2_NAME"), "Riley") });
  return inboxes;
}
