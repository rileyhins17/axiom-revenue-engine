"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { CircleUserRound, LogOutIcon, MoreHorizontal, UserIcon } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

import { authClient } from "@/lib/auth-client";
import { CallerActivationProvider } from "@/components/prospects/caller-launch";
import { AppSidebar } from "@/components/app-sidebar";
import { LayoutBreadcrumb } from "@/components/layout-breadcrumb";
import { SearchTrigger } from "@/components/system/search-trigger";
import { HotkeyProvider } from "@/components/system/hotkey-provider";
import { APP_NAV_ITEMS } from "@/lib/navigation";
import { isPublicPath } from "@/lib/public-paths";
import { cn } from "@/lib/utils";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Avatar } from "@/components/ui/avatar";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

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
    <CallerActivationProvider identity={session?.user?.email??null}>
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
          <div className="owner-topbar-inner flex h-[52px] items-center gap-3 px-4 sm:px-6 md:h-[64px] lg:px-9">
            <SidebarTrigger aria-label="Toggle navigation" className="owner-icon-button hidden md:inline-flex" />
            {/* Phones: the brand on the left; each page carries its own large title. */}
            <Link href="/dashboard" aria-label="Axiom Revenue Engine home" className="owner-mobile-brand md:hidden">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/axiomtransparentlogo.png" alt="" width={88} height={18} className="h-[18px] w-auto" />
            </Link>
            <div className="min-w-0 flex-1">
              <div className="hidden md:block"><LayoutBreadcrumb /></div>
            </div>
            <div className="owner-search-trigger"><SearchTrigger /></div>
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

        <MobileTabBar pathname={pathname} email={sessionEmail} onSignOut={async () => { await authClient.signOut(); router.push("/sign-in"); }} />
      </main>
    </SidebarProvider>
    </CallerActivationProvider>
  );
}

const isActive = (pathname: string | null, url: string) => pathname === url || Boolean(pathname?.startsWith(`${url}/`));
/** The four places used all day; everything else lives under More. */
const PRIMARY_URLS = ["/dashboard", "/call", "/prospects", "/walk-ins"];

/**
 * Phone navigation (the home-screen app on iPhone): four thumb-sized tabs and a More sheet,
 * clear of the home indicator.
 */
function MobileTabBar({ pathname, email, onSignOut }: { pathname: string | null; email: string; onSignOut: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const primary = APP_NAV_ITEMS.filter((item) => PRIMARY_URLS.includes(item.url));
  const more = APP_NAV_ITEMS.filter((item) => !PRIMARY_URLS.includes(item.url));
  const moreActive = more.some((item) => isActive(pathname, item.url));

  return (
    <nav aria-label="Primary" className="owner-mobile-nav fixed inset-x-0 bottom-0 z-50 md:hidden">
      <div className="grid grid-cols-5">
        {primary.map((item) => {
          const active = isActive(pathname, item.url);
          const Icon = item.icon;
          return (
            <Link key={item.url} href={item.url} prefetch aria-current={active ? "page" : undefined}
              className={cn("owner-mobile-nav-item", active ? "is-active" : "")}>
              <Icon className="size-[22px]" aria-hidden="true" />
              <span>{item.label}</span>
            </Link>
          );
        })}
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <button type="button" className={cn("owner-mobile-nav-item", moreActive ? "is-active" : "")}>
              <MoreHorizontal className="size-[22px]" aria-hidden="true" />
              <span>More</span>
            </button>
          </SheetTrigger>
          <SheetContent side="bottom" className="owner-more-sheet">
            <SheetHeader>
              <SheetTitle>More</SheetTitle>
              <SheetDescription>{email || "Axiom Revenue Engine"}</SheetDescription>
            </SheetHeader>
            <ul className="grid gap-1 px-3 pb-3">
              {more.map((item) => {
                const Icon = item.icon;
                return (
                  <li key={item.url}>
                    <Link href={item.url} onClick={() => setOpen(false)} aria-current={isActive(pathname, item.url) ? "page" : undefined} className="owner-more-item">
                      <Icon className="size-5" aria-hidden="true" />
                      <span className="min-w-0">
                        <span className="block font-semibold">{item.title}</span>
                        <span className="block text-xs opacity-70">{item.description}</span>
                      </span>
                    </Link>
                  </li>
                );
              })}
              <li>
                <button type="button" onClick={() => { setOpen(false); void onSignOut(); }} className="owner-more-item w-full text-left">
                  <LogOutIcon className="size-5" aria-hidden="true" />
                  <span className="font-semibold">Sign out</span>
                </button>
              </li>
            </ul>
          </SheetContent>
        </Sheet>
      </div>
    </nav>
  );
}
