"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { CircleUserRound, LogOutIcon, Settings, UserIcon } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

import { authClient } from "@/lib/auth-client";
import { AppSidebar } from "@/components/app-sidebar";
import { LayoutBreadcrumb } from "@/components/layout-breadcrumb";
import { SearchTrigger } from "@/components/system/search-trigger";
import { HotkeyProvider } from "@/components/system/hotkey-provider";
import { APP_NAV_ITEMS } from "@/lib/navigation";
import { isPublicPath } from "@/lib/public-paths";
import { cn } from "@/lib/utils";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Avatar } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

type ShellSession = {
  user?: {
    name?: string | null;
    email?: string | null;
    image?: string | null;
    role?: string | null;
  } | null;
} | null;

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [session, setSession] = useState<ShellSession>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    authClient.getSession().then((result) => {
      setSession(result.data);
      setLoading(false);
    });
  }, []);

  if (isPublicPath(pathname)) {
    return <div className="min-h-screen bg-background">{children}</div>;
  }

  // Display name is derived from the live session email (local part,
  // capitalized) — never from the stored User.name. This prevents the
  // header from showing a stale name like "Riley Hinsperger" when a
  // different user is logged in. Initials follow the same source.
  const sessionEmail = session?.user?.email ?? "";
  const localPart = sessionEmail.split("@")[0] ?? "";
  const displayName = localPart
    ? localPart.charAt(0).toUpperCase() + localPart.slice(1).toLowerCase()
    : "";
  const initials = (() => {
    if (!displayName) return sessionEmail?.[0]?.toUpperCase() ?? "?";
    return displayName.slice(0, 2).toUpperCase();
  })();

  return (
    <SidebarProvider
      className="owner-app-shell min-h-svh bg-[#f5f4ef] text-[#202c26]"
      style={{ "--sidebar-width": "15rem" } as CSSProperties}
    >
      <a
        href="#main-content"
        className="owner-skip-link sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-md focus:border focus:px-3 focus:py-2 focus:text-sm focus:font-semibold"
      >
        Skip to main content
      </a>
      <AppSidebar />
      <main id="main-content" tabIndex={-1} className="owner-main flex min-h-screen min-w-0 w-full flex-1 flex-col outline-none">
        <header className="owner-topbar sticky top-0 z-40">
          <div className="flex h-[64px] items-center gap-3 px-4 sm:px-6 lg:px-9">
            <SidebarTrigger aria-label="Toggle navigation" className="owner-icon-button" />
            <div className="min-w-0 flex-1">
              <LayoutBreadcrumb />
            </div>
            <div className="owner-search-trigger"><SearchTrigger /></div>
            <div className="hidden items-center gap-2 lg:flex">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label="Open settings"
                    onClick={() => router.push("/settings")}
                    className="owner-icon-button"
                  >
                    <Settings className="size-4" aria-hidden="true" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Settings</TooltipContent>
              </Tooltip>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label="Open account menu"
                  className="owner-account-trigger"
                >
                  <div className="hidden text-right leading-tight lg:block">
                    <div className="text-xs font-semibold text-[#202c26]">
                      {loading ? "Loading…" : displayName || sessionEmail || "User"}
                    </div>
                    <div className="text-[10.5px] text-[#52645a]">
                      {sessionEmail || "—"}
                    </div>
                  </div>
                  <div className="relative hidden sm:block">
                    <Avatar
                      src={session?.user?.image}
                      fallback={initials}
                      size="lg"
                      className="owner-avatar"
                    />
                    <span className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-[#fff] bg-[#145943]" />
                  </div>
                  <CircleUserRound className="size-5 text-[#526158] sm:hidden" aria-hidden="true" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="owner-account-menu w-56">
                <DropdownMenuLabel className="font-normal">
                  <div className="flex flex-col space-y-1 px-0.5 py-1">
                    <p className="text-sm font-medium text-[#202c26]">
                      {displayName || sessionEmail || "User"}
                    </p>
                    <p className="text-xs text-[#52645a]">
                      {sessionEmail}
                    </p>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => router.push("/settings")}>
                  <UserIcon />
                  Profile & Settings
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  onClick={async () => {
                    await authClient.signOut();
                    router.push("/sign-in");
                  }}
                >
                  <LogOutIcon />
                  Sign Out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        <HotkeyProvider>
          <div data-owner-content className="owner-page-content min-w-0 flex-1 px-4 py-6 pb-28 sm:px-6 sm:py-8 md:px-9 md:py-9">{children}</div>
        </HotkeyProvider>

        <MobileTabBar pathname={pathname} />
      </main>
    </SidebarProvider>
  );
}

function MobileTabBar({ pathname }: { pathname: string | null }) {
  return (
    <nav
      aria-label="Primary"
      className="owner-mobile-nav fixed inset-x-0 bottom-0 z-50 px-2 pb-[calc(env(safe-area-inset-bottom)+0.4rem)] pt-2 md:hidden"
    >
      <div className="grid grid-cols-5 gap-1">
        {APP_NAV_ITEMS.map((item) => {
          const active = pathname === item.url || pathname?.startsWith(`${item.url}/`);
          const Icon = item.icon;

          return (
            <Link
              key={item.url}
              href={item.url}
              prefetch
              aria-current={active ? "page" : undefined}
              aria-label={item.title}
              className={cn(
                "owner-mobile-nav-item flex min-h-12 flex-col items-center justify-center gap-1 rounded-xl px-1 text-[10px] font-medium transition-colors",
                active
                  ? "is-active"
                  : "",
              )}
            >
              <Icon className="size-[17px]" aria-hidden="true" />
              <span className="max-w-full truncate">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
