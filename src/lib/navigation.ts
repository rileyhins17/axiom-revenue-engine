import {
  ChartNoAxesCombined,
  Crosshair,
  Send,
  Sparkles,
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
    description: "Decisions and next actions",
    url: "/dashboard",
    icon: Sparkles,
    shortcut: "⌘1",
    keywords: ["home", "overview", "status", "dashboard"],
  },
  {
    title: "Leads",
    label: "Leads",
    description: "Ranked businesses and evidence",
    url: "/leads",
    icon: Crosshair,
    shortcut: "⌘2",
    keywords: ["ranked", "businesses", "evidence", "leads"],
  },
  {
    title: "Outreach",
    label: "Outreach",
    description: "Approvals and contact tasks",
    url: "/automation",
    icon: Send,
    shortcut: "⌘3",
    keywords: ["approval", "message", "mailbox", "campaign", "manual task"],
  },
  {
    title: "Revenue",
    label: "Revenue",
    description: "Replies, opportunities, and clients",
    url: "/clients" as Route,
    icon: ChartNoAxesCombined,
    shortcut: "⌘4",
    keywords: ["crm", "deal", "client", "pipeline", "retainer", "reply"],
  },
  {
    title: "System",
    label: "System",
    description: "Safety, coverage, cost, and health",
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
