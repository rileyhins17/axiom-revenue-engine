import {
  ChartNoAxesCombined,
  Building2,
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
    title: "Businesses",
    label: "Businesses",
    description: "Fit, need, and evidence",
    url: "/leads",
    icon: Building2,
    shortcut: "⌘2",
    keywords: ["ranked", "businesses", "evidence", "leads"],
  },
  {
    title: "Outreach",
    label: "Outreach",
    description: "Owner reviewed contact work",
    url: "/automation",
    icon: ClipboardList,
    shortcut: "⌘3",
    keywords: ["approval", "message", "mailbox", "campaign", "manual task"],
  },
  {
    title: "Clients",
    label: "Clients",
    description: "Replies, deals, and follow through",
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
