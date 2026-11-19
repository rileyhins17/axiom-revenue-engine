"use client";

import { usePathname } from "next/navigation";

import { getNavItemForPath } from "@/lib/navigation";

export function LayoutBreadcrumb() {
  const route = getNavItemForPath(usePathname());

  if (route) {
    const Icon = route.icon;
    return (
      <div className="owner-breadcrumb flex min-w-0 items-center gap-2.5 text-sm">
        <Icon className="size-4 shrink-0 text-[#8a6420]" aria-hidden="true" />
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="truncate font-semibold tracking-tight">{route.label}</span>
          <span className="hidden truncate text-xs text-[#5c584f] md:inline">{route.description}</span>
        </div>
      </div>
    );
  }

  return <span className="owner-breadcrumb text-sm font-semibold tracking-tight">Axiom</span>;
}
