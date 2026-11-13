/** How the screens write times and counts: Toronto time, plain words. */
const toronto = (date: Date, options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", ...options }).format(date);
const torontoDayOf = (date: Date) => date.toLocaleDateString("en-CA", { timeZone: "America/Toronto" });

/** "Fri, Nov 13, 1:01 p.m." */
export function whenText(iso: string | null | undefined) {
  if (!iso) return "time unknown";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : toronto(date, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/** Shorter for lists: "1:01 p.m." today, "Thu 1:01 p.m." this week, "Nov 5" before that. */
export function shortWhen(iso: string | null | undefined, now = new Date()) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  if (torontoDayOf(date) === torontoDayOf(now)) return toronto(date, { hour: "numeric", minute: "2-digit" });
  if (now.getTime() - date.getTime() < 6 * 86_400_000) return toronto(date, { weekday: "short", hour: "numeric", minute: "2-digit" });
  return toronto(date, { month: "short", day: "numeric" });
}

/** "Mon, Nov 16" for a Toronto day ("2026-11-16"). */
export function dayText(day: string | null | undefined) {
  if (!day) return "";
  const date = new Date(`${day}T12:00:00Z`);
  return Number.isNaN(date.getTime()) ? day : new Intl.DateTimeFormat("en-CA", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" }).format(date);
}

export const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/** "1.7" for 2 of 120, as "per 100 emailed". Null when nobody was emailed. */
export function per100(count: number, emailed: number) {
  return emailed > 0 ? (Math.round((count / emailed) * 1000) / 10).toFixed(1) : null;
}
