import type { ProspectActivity, ProspectRow } from "@/lib/revenue-engine/engine-prospects-d1";

const ZONE = "America/Toronto";

export const titleCase = (value: string) => value === "HVAC" ? value : value.toLowerCase().split("_").map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
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
export function prospectOutcomeText(outcome: string | null, callerOutcome?: string | null): string | null {
  if (callerOutcome) { const text = callerOutcome.replaceAll('_', ' '); return text.charAt(0).toUpperCase() + text.slice(1); }
  return outcome ? OUTCOME_TEXT[outcome] ?? outcome : null;
}

export const mapsUrl = (row: Pick<ProspectRow, "name" | "placeId" | "address" | "city">) => row.placeId
  ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(row.name)}&query_place_id=${encodeURIComponent(row.placeId)}`
  : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${row.name} ${row.address ?? titleCase(row.city)} Ontario`)}`;

export function historyView(items: ProspectActivity[]) {
  return items.map((item) => ({
    id: item.activityId, when: shortDay(item.createdAt) ?? "", who: item.actor === "AIDAN" ? "Aidan" : "Riley",
    what: `${item.channel === "VISIT" ? "Visit" : item.channel === "CALL" ? "Call" : item.channel === "EMAIL" ? "Email" : "Note"}: ${prospectOutcomeText(item.outcome, item.callerOutcome)}`,
    note: item.note, followUpAt: item.followUpAt,
  }));
}

/** The ten digits of a North American number, or null (extensions and other formats return null). */
export function phoneDigits(phone: string | null | undefined): string | null {
  const digits = (phone ?? "").replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  return digits.length === 10 ? digits : null;
}

/** North American numbers as (519) 555-0155, whatever format they were stored in. */
export function displayPhone(phone: string | null | undefined) {
  if (!phone) return "";
  const digits = phoneDigits(phone);
  return digits ? `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}` : phone.trim();
}

/** A tap-to-dial link for any phone (tel:+15195550155 for North American numbers). */
export function telHref(phone: string): string {
  const digits = phoneDigits(phone);
  return digits ? `tel:+1${digits}` : `tel:${phone.replace(/[^\d+]/g, "")}`;
}

/** Toll-free numbers usually reach a call centre or a lead-generation service, not the owner. */
export function isTollFree(phone: string | null | undefined): boolean {
  const digits = phoneDigits(phone);
  return Boolean(digits && ["800", "833", "844", "855", "866", "877", "888"].includes(digits.slice(0, 3)));
}

/** Whether two stored numbers are the same line, whatever their formatting. */
export function samePhone(left: string | null | undefined, right: string | null | undefined): boolean {
  const a = phoneDigits(left), b = phoneDigits(right);
  return a !== null && a === b;
}
