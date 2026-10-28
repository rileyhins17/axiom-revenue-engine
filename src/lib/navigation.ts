import { Archive, CalendarDays, Send, Settings, Sparkles, type LucideIcon } from "lucide-react";
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
  { title: "Today", label: "Today", description: "FCC first", url: "/dashboard", icon: CalendarDays, shortcut: "⌘1", keywords: ["home", "overview", "today", "dashboard", "results"] },
  { title: "FCC", label: "FCC", description: "FCC emails: status and pause", url: "/fcc" as Route, icon: Send, shortcut: "⌘2", keywords: ["fcc", "email", "campaign", "pause", "resume", "rmd", "robocall"] },
  { title: "Ask AI", label: "Ask AI", description: "Your sales assistant", url: "/ask" as Route, icon: Sparkles, shortcut: "⌘3", keywords: ["ai", "ask", "assistant", "chat", "help", "question"] },
  { title: "Settings", label: "Settings", description: "Stop switch, account", url: "/settings", icon: Settings, shortcut: "⌘4", keywords: ["stop", "safety", "account", "settings"] },
  { title: "Archive: Axiom Web", label: "Archive", description: "Old website campaign, paused", url: "/archive" as Route, icon: Archive, shortcut: "⌘5", keywords: ["archive", "axiom web", "website", "call queue", "call list", "walk-ins", "old"] },
];

/** Screens of the paused Axiom Web website campaign. They still open, from the archive. */
export const ARCHIVED_URLS = ["/call", "/prospects", "/walk-ins", "/email"];

export function getNavItemForPath(pathname: string | null | undefined) {
  if (!pathname) return null;
  const within = (url: string) => pathname === url || pathname.startsWith(`${url}/`);
  return APP_NAV_ITEMS.find((item) => within(item.url))
    ?? (ARCHIVED_URLS.some(within) ? APP_NAV_ITEMS.find((item) => item.url === "/archive") ?? null : null);
}
