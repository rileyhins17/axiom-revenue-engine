"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { BrandMark } from "@/components/brand-mark";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { APP_NAV_ITEMS } from "@/lib/navigation";
import { cn } from "@/lib/utils";

export function AppSidebar() {
  const pathname = usePathname();

  return (
    <Sidebar className="v2-sidebar">
      <SidebarHeader className="border-b border-white/[0.08] px-4 py-5">
        <Link href="/dashboard" className="flex items-center justify-between gap-3">
          <BrandMark
            className="h-8 w-[130px] justify-start border-0 bg-transparent p-0"
            imageClassName="h-7"
            priority
            showBorder={false}
          />
          <span className="rounded-md border border-white/[0.08] bg-white/[0.035] px-2 py-1 font-mono text-[9px] uppercase tracking-[0.16em] text-zinc-500">Revenue</span>
        </Link>
      </SidebarHeader>

      <SidebarContent className="px-3 py-4">
        <SidebarGroup>
          <div className="mb-2.5 flex items-center justify-between px-3">
            <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-zinc-600">
              Revenue Engine
            </span>
            <span className="text-[10px] font-mono text-zinc-600">⌘K</span>
          </div>
          <SidebarGroupContent>
            <SidebarMenu className="gap-1">
              {APP_NAV_ITEMS.map((item) => {
                const isActive = pathname === item.url || pathname?.startsWith(`${item.url}/`);
                const Icon = item.icon;

                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild isActive={isActive}>
                      <Link
                        href={item.url}
                        prefetch
                        data-active={isActive ? "true" : "false"}
                        aria-current={isActive ? "page" : undefined}
                        title={`${item.title} — ${item.description} (${item.shortcut})`}
                        className={cn(
                          "v2-nav-item v2-focus-ring group flex min-h-14 items-center gap-3 px-3 py-2.5 text-sm",
                          isActive ? "text-emerald-100" : "text-zinc-400 hover:text-white",
                        )}
                      >
                        <Icon
                          className={cn(
                            "size-4 shrink-0 transition-colors",
                            isActive ? "text-emerald-300" : "text-zinc-500 group-hover:text-zinc-200",
                          )}
                          aria-hidden="true"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">{item.title}</span>
                          <span className="mt-0.5 block truncate text-[10.5px] font-normal text-zinc-600 group-hover:text-zinc-500">{item.description}</span>
                        </span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t border-white/[0.08] p-3">
        <Link
          href="/settings"
          className="v2-focus-ring flex min-h-11 items-center rounded-xl px-3 text-sm font-medium text-zinc-400 transition-colors hover:bg-white/[0.05] hover:text-white"
        >
          Review safety and status
        </Link>
      </SidebarFooter>
    </Sidebar>
  );
}
