"use client";

import { MessageSquareText, User } from "lucide-react";
import { usePathname } from "next/navigation";

import { getNavItemForPath } from "@/lib/navigation";

export function LayoutBreadcrumb() {
  const pathname = usePathname();
  const route = getNavItemForPath(pathname);

  if (pathname?.match(/^\/lead\/\d+/)) {
    return (
      <div className="flex items-center gap-2.5 text-sm">
        <div className="grid size-8 place-items-center rounded-lg border border-white/[0.09] bg-white/[0.035]">
          <MessageSquareText className="size-3.5 text-emerald-300" />
        </div>
        <span className="font-semibold tracking-tight text-white">Lead dossier</span>
        <span className="text-zinc-700">›</span>
        <span className="flex items-center gap-1.5 text-zinc-400">
          <User className="size-3.5" />
          Record
        </span>
      </div>
    );
  }

  if (route) {
    const Icon = route.icon;
    return (
      <div className="flex min-w-0 items-center gap-3 text-sm">
        <div className="grid size-8 shrink-0 place-items-center rounded-lg border border-white/[0.09] bg-white/[0.035]">
          <Icon className="size-3.5 text-zinc-300" />
        </div>
        <div className="flex min-w-0 items-baseline gap-2.5">
          <span className="truncate font-semibold tracking-tight text-white">{route.label}</span>
          <span className="hidden truncate text-[11px] text-zinc-600 md:inline">/ {route.description}</span>
        </div>
      </div>
    );
  }

  return <span className="text-sm font-semibold tracking-tight text-white">Axiom Revenue Engine</span>;
}
