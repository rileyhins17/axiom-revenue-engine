import { CalendarDays, Footprints, Headset, List, Mail, Settings, Sparkles, type LucideIcon } from "lucide-react";
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
  { title: "Today", label: "Today", description: "Goals, results, follow-ups", url: "/dashboard", icon: CalendarDays, shortcut: "⌘1", keywords: ["home", "overview", "today", "dashboard", "results"] },
  { title: "Call queue", label: "Queue", description: "One business at a time", url: "/call" as Route, icon: Headset, shortcut: "⌘2", keywords: ["call", "dial", "queue", "cold call", "next"] },
  { title: "Call list", label: "List", description: "Search and filter", url: "/prospects" as Route, icon: List, shortcut: "⌘3", keywords: ["prospects", "list", "search", "leads", "log"] },
  { title: "Walk-ins", label: "Walk-ins", description: "Routes by city", url: "/walk-ins" as Route, icon: Footprints, shortcut: "⌘4", keywords: ["visit", "walk-in", "route", "door", "map"] },
  { title: "Email", label: "Email", description: "Automatic first emails", url: "/email" as Route, icon: Mail, shortcut: "⌘5", keywords: ["email", "outreach", "send", "unsubscribe"] },
  { title: "Ask AI", label: "Ask AI", description: "Your sales assistant", url: "/ask" as Route, icon: Sparkles, shortcut: "⌘6", keywords: ["ai", "ask", "assistant", "chat", "help", "question"] },
  { title: "Settings", label: "Settings", description: "Stop switch, account", url: "/settings", icon: Settings, shortcut: "⌘7", keywords: ["stop", "safety", "account", "settings"] },
];

export function getNavItemForPath(pathname: string | null | undefined) {
  if (!pathname) return null;
  return APP_NAV_ITEMS.find((item) => pathname === item.url || pathname.startsWith(`${item.url}/`)) ?? null;
}
