import { CalendarDays, PhoneCall, Settings, type LucideIcon } from "lucide-react";
import type { Route } from "next";

export type AppNavItem = {
  title: string;
  label: string;
  description: string;
  url: Route;
  icon: LucideIcon;
  shortcut: string;
  keywords: string[];
};

export const APP_NAV_ITEMS: AppNavItem[] = [
  {
    title: "Today",
    label: "Today",
    description: "Calls, follow-ups and results",
    url: "/dashboard",
    icon: CalendarDays,
    shortcut: "⌘1",
    keywords: ["home", "overview", "today", "dashboard", "results"],
  },
  {
    title: "Call list",
    label: "Calls",
    description: "Businesses to call and visit",
    url: "/prospects" as Route,
    icon: PhoneCall,
    shortcut: "⌘2",
    keywords: ["call", "prospects", "cold call", "visit", "walk-in", "log", "leads"],
  },
  {
    title: "Settings",
    label: "Settings",
    description: "Emergency stop and account",
    url: "/settings",
    icon: Settings,
    shortcut: "⌘3",
    keywords: ["stop", "safety", "account", "settings"],
  },
];

export function getNavItemForPath(pathname: string | null | undefined) {
  if (!pathname) return null;
  return APP_NAV_ITEMS.find((item) => pathname === item.url || pathname.startsWith(`${item.url}/`)) ?? null;
}
