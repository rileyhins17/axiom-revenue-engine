"use client";

import { useEffect, useState } from "react";
import { CircleUserRound, LogOutIcon, ShieldCheck, Settings, UserIcon } from "lucide-react";
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
    <SidebarProvider>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-md focus:border focus:border-emerald-400/40 focus:bg-[#07111c] focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-emerald-100"
      >
        Skip to main content
      </a>
      <AppSidebar />
      <main id="main-content" className="flex min-h-screen w-full flex-1 flex-col bg-background">
        <header className="v2-header sticky top-0 z-40">
          <div className="flex h-[68px] items-center gap-3 px-4 md:px-7">
            <SidebarTrigger className="v2-focus-ring rounded-md text-zinc-400 transition-colors hover:text-white" />
            <div className="hidden h-6 w-px bg-white/[0.08] md:block" />
            <div className="min-w-0 flex-1">
              <LayoutBreadcrumb />
            </div>
            <SearchTrigger />
            <div className="hidden items-center gap-2 lg:flex">
              <div className="flex h-9 items-center gap-2 rounded-lg border border-white/[0.08] bg-black/20 px-3 text-[11px] font-medium text-zinc-400">
                <ShieldCheck className="size-3.5 text-amber-300" aria-hidden="true" />
                Safety gated
              </div>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label="Open settings"
                    onClick={() => router.push("/settings")}
                    className="v2-focus-ring relative flex size-9 cursor-pointer items-center justify-center rounded-lg border border-white/[0.09] bg-black/20 text-zinc-400 transition-colors hover:border-white/[0.16] hover:bg-white/[0.06] hover:text-white"
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
                  className="v2-focus-ring flex size-9 cursor-pointer items-center justify-center rounded-lg outline-none transition-colors hover:bg-white/[0.05] lg:h-auto lg:w-auto lg:gap-3 lg:px-2 lg:py-1.5"
                >
                  <div className="hidden text-right leading-tight lg:block">
                    <div className="text-xs font-semibold text-white">
                      {loading ? "Loading…" : displayName || sessionEmail || "User"}
                    </div>
                    <div className="font-mono text-[10.5px] text-zinc-500">
                      {sessionEmail || "—"}
                    </div>
                  </div>
                  <div className="relative hidden sm:block">
                    <Avatar
                      src={session?.user?.image}
                      fallback={initials}
                      size="lg"
                    />
                    <span className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-[#06101a] bg-emerald-400" />
                  </div>
                  <CircleUserRound className="size-5 text-zinc-400 sm:hidden" aria-hidden="true" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="font-normal">
                  <div className="flex flex-col space-y-1 px-0.5 py-1">
                    <p className="text-sm font-medium text-white">
                      {displayName || sessionEmail || "User"}
                    </p>
                    <p className="font-mono text-xs text-zinc-500">
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
          <div className="flex-1 px-3 py-4 pb-28 sm:px-5 sm:py-6 md:px-8 md:py-8">{children}</div>
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
      className="fixed inset-x-0 bottom-0 z-50 border-t border-white/[0.08] bg-[#0b0d10]/96 px-2 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] pt-2 backdrop-blur-xl md:hidden"
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
                "v2-focus-ring flex min-h-12 flex-col items-center justify-center gap-1 rounded-lg px-1 text-[10px] font-medium transition-colors",
                active
                  ? "bg-emerald-400/12 text-emerald-200"
                  : "text-zinc-500 hover:bg-white/[0.04] hover:text-zinc-200",
              )}
            >
              <Icon className={cn("size-4", active ? "text-emerald-300" : "text-zinc-500")} aria-hidden="true" />
              <span className="max-w-full truncate">{item.title}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
