import type { ProspectActivity, ProspectRow } from "@/lib/revenue-engine/engine-prospects-d1";

const ZONE = "America/Toronto";

export const titleCase = (value: string) => value === "HVAC" ? value : value.charAt(0) + value.slice(1).toLowerCase();
export const torontoToday = (now = new Date()) => now.toLocaleDateString("en-CA", { timeZone: ZONE });
export const shortDay = (iso: string | null) => iso ? new Date(iso).toLocaleDateString("en-CA", { month: "short", day: "numeric", timeZone: ZONE }) : null;

/** UTC instant of local midnight in Toronto, `daysBack` days ago (Monday of this week when `week`). */
export function torontoMidnight(now = new Date(), { week = false }: { week?: boolean } = {}) {
  const local = new Date(now.toLocaleString("en-US", { timeZone: ZONE }));
  const offset = now.getTime() - local.getTime();
  local.setHours(0, 0, 0, 0);
  if (week) local.setDate(local.getDate() - ((local.getDay() + 6) % 7));
  return new Date(local.getTime() + offset).toISOString();
}

export const OUTCOME_TEXT: Record<string, string> = {
  NO_ANSWER: "No answer", VOICEMAIL: "Left voicemail", GATEKEEPER: "Talked to staff", CALL_BACK: "Call back later", INTERESTED: "Interested",
  MEETING_BOOKED: "Meeting booked", NOT_INTERESTED: "Not interested", WON: "Won", WRONG_NUMBER: "Wrong number", DO_NOT_CONTACT: "Do not contact", NOTE: "Note",
};

export const mapsUrl = (row: Pick<ProspectRow, "name" | "placeId" | "address" | "city">) => row.placeId
  ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(row.name)}&query_place_id=${encodeURIComponent(row.placeId)}`
  : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${row.name} ${row.address ?? titleCase(row.city)} Ontario`)}`;

export function historyView(items: ProspectActivity[]) {
  return items.map((item) => ({
    id: item.activityId, when: shortDay(item.createdAt) ?? "", who: item.actor === "AIDAN" ? "Aidan" : "Riley",
    what: `${item.channel === "VISIT" ? "Visit" : item.channel === "CALL" ? "Call" : item.channel === "EMAIL" ? "Email" : "Note"}: ${OUTCOME_TEXT[item.outcome] ?? item.outcome}`,
    note: item.note, followUpAt: item.followUpAt,
  }));
}
