import {
  ChartNoAxesCombined,
  Building2,
  PhoneCall,
  ClipboardList,
  CalendarDays,
  Settings,
  type LucideIcon,
} from "lucide-react";
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
    description: "Your next steps",
    url: "/dashboard",
    icon: CalendarDays,
    shortcut: "⌘1",
    keywords: ["home", "overview", "status", "dashboard"],
  },
  {
    title: "Call list",
    label: "Calls",
    description: "Prospects to call and visit",
    url: "/prospects" as Route,
    icon: PhoneCall,
    shortcut: "⌘6",
    keywords: ["call", "prospects", "cold call", "visit", "walk-in", "log"],
  },
  {
    title: "Businesses",
    label: "Businesses",
    description: "Fit, need, and evidence",
    url: "/leads",
    icon: Building2,
    shortcut: "⌘2",
    keywords: ["ranked", "businesses", "evidence", "leads"],
  },
  {
    title: "Follow-through",
    label: "Actions",
    description: "Calls, replies, and next steps",
    url: "/automation",
    icon: ClipboardList,
    shortcut: "⌘3",
    keywords: ["approval", "message", "mailbox", "campaign", "manual task"],
  },
  {
    title: "Clients",
    label: "Clients",
    description: "Clients and open deals",
    url: "/clients" as Route,
    icon: ChartNoAxesCombined,
    shortcut: "⌘4",
    keywords: ["crm", "deal", "client", "pipeline", "retainer", "reply"],
  },
  {
    title: "Settings",
    label: "Settings",
    description: "Safety and account status",
    url: "/settings",
    icon: Settings,
    shortcut: "⌘5",
    keywords: ["runtime", "gmail", "config", "coverage", "cost", "deployment"],
  },
];

export function getNavItemForPath(pathname: string | null | undefined) {
  if (!pathname) return null;
  return APP_NAV_ITEMS.find((item) => pathname === item.url || pathname.startsWith(`${item.url}/`)) ?? null;
}
