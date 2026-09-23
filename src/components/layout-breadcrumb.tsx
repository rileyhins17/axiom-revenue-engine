"use client";

import { Building2, MessageSquareText, User } from "lucide-react";
import { usePathname } from "next/navigation";

import { getNavItemForPath } from "@/lib/navigation";

export function LayoutBreadcrumb() {
  const pathname = usePathname();
  const route = getNavItemForPath(pathname);

  if (pathname === "/leads/m2") {
    return (
      <div className="owner-breadcrumb flex min-w-0 items-center gap-3 text-sm">
        <div className="owner-breadcrumb-icon grid size-8 shrink-0 place-items-center rounded-lg">
          <Building2 className="size-3.5" aria-hidden="true" />
        </div>
        <span className="truncate font-semibold tracking-tight">Business review</span>
      </div>
    );
  }

  if (pathname?.match(/^\/lead\/\d+/)) {
    return (
      <div className="owner-breadcrumb flex items-center gap-2.5 text-sm">
        <div className="owner-breadcrumb-icon grid size-8 place-items-center rounded-lg">
          <MessageSquareText className="size-3.5" />
        </div>
        <span className="font-semibold tracking-tight">Business record</span>
        <span className="text-[#9aa49e]">›</span>
        <span className="flex items-center gap-1.5 text-[#68766e]">
          <User className="size-3.5" />
          Record
        </span>
      </div>
    );
  }

  if (route) {
    const Icon = route.icon;
    return (
      <div className="owner-breadcrumb flex min-w-0 items-center gap-3 text-sm">
        <div className="owner-breadcrumb-icon grid size-8 shrink-0 place-items-center rounded-lg">
          <Icon className="size-3.5" />
        </div>
        <div className="flex min-w-0 items-baseline gap-2.5">
          <span className="truncate font-semibold tracking-tight">{route.label}</span>
          <span className="hidden truncate text-[11px] text-[#52645a] md:inline">{route.description}</span>
        </div>
      </div>
    );
  }

  return <span className="owner-breadcrumb text-sm font-semibold tracking-tight">Axiom Web</span>;
}
