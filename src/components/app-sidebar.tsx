"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

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
    <Sidebar className="owner-sidebar owner-app-shell">
      <SidebarHeader className="owner-sidebar-brand">
        <Link href="/dashboard" aria-label="Axiom Web home" className="owner-brand">
          <span className="owner-brand-mark" aria-hidden="true">A</span>
          <span className="min-w-0">
            <span className="owner-brand-name">Axiom</span>
            <span className="owner-brand-caption">Web workspace</span>
          </span>
        </Link>
      </SidebarHeader>

      <SidebarContent className="owner-sidebar-content">
        <SidebarGroup>
          <div className="owner-sidebar-section-label">Workspace</div>
          <SidebarGroupContent>
            <SidebarMenu className="gap-1.5">
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
                        title={`${item.title} — ${item.description}`}
                        className={cn("owner-nav-item group", isActive && "is-active")}
                      >
                        <Icon className="size-[17px] shrink-0" aria-hidden="true" />
                        <span className="min-w-0 flex-1">
                          <span className="owner-nav-title">{item.title}</span>
                          <span className="owner-nav-description">{item.description}</span>
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

      <SidebarFooter className="owner-sidebar-footer">
        <span className="owner-sidebar-footer-dot" aria-hidden="true" />
        <span>Axiom Web</span>
        <span className="ml-auto">Kitchener–Waterloo</span>
      </SidebarFooter>
    </Sidebar>
  );
}
