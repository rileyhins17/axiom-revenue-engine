import { Archive, CalendarDays, Inbox, Layers, MessageSquareReply, Settings, ShieldBan, type LucideIcon } from "lucide-react";
import type { Route } from "next";

export type AppNavItem = {
  title: string;
  label: string;
  description: string;
  url: Route;
  icon: LucideIcon;
};

/**
 * The places a founder opens every day: what needs them, who wrote back, and the campaigns.
 * They are the phone's tabs (with More as the fourth) and the top of the desktop sidebar.
 */
export const APP_NAV_ITEMS: AppNavItem[] = [
  { title: "Today", label: "Today", description: "What needs you", url: "/dashboard", icon: CalendarDays },
  { title: "Replies", label: "Replies", description: "Who wrote back", url: "/replies" as Route, icon: MessageSquareReply },
  { title: "Campaigns", label: "Campaigns", description: "Lists, batches and numbers", url: "/campaigns" as Route, icon: Layers },
];

/** Everything else: under More on a phone, listed under "More" in the desktop sidebar. */
export const MORE_NAV_ITEMS: AppNavItem[] = [
  { title: "Inboxes", label: "Inboxes", description: "Sending today, per inbox", url: "/inboxes" as Route, icon: Inbox },
  { title: "Do-not-email list", label: "Do-not-email list", description: "Who is blocked, and why", url: "/do-not-email" as Route, icon: ShieldBan },
  { title: "FCC archive", label: "FCC archive", description: "Ended Nov 12, 2026", url: "/fcc" as Route, icon: Archive },
  { title: "Settings", label: "Settings", description: "Your account", url: "/settings", icon: Settings },
];

export const ALL_NAV_ITEMS: AppNavItem[] = [...APP_NAV_ITEMS, ...MORE_NAV_ITEMS];

export function getNavItemForPath(pathname: string | null | undefined) {
  if (!pathname) return null;
  return ALL_NAV_ITEMS.find((item) => pathname === item.url || pathname.startsWith(`${item.url}/`)) ?? null;
}
