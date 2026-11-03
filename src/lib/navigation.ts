import { CalendarDays, Send, Settings, type LucideIcon } from "lucide-react";
import type { Route } from "next";

export type AppNavItem = {
  title: string;
  label: string;
  description: string;
  url: Route;
  icon: LucideIcon;
};

export const APP_NAV_ITEMS: AppNavItem[] = [
  { title: "Today", label: "Today", description: "Overview", url: "/dashboard", icon: CalendarDays },
  { title: "FCC", label: "FCC", description: "Emails, replies and pause", url: "/fcc" as Route, icon: Send },
  { title: "Settings", label: "Settings", description: "Your account", url: "/settings", icon: Settings },
];

export function getNavItemForPath(pathname: string | null | undefined) {
  if (!pathname) return null;
  return APP_NAV_ITEMS.find((item) => pathname === item.url || pathname.startsWith(`${item.url}/`)) ?? null;
}
