import type { Metadata } from "next";
import { headers } from "next/headers";

import { SettingsAccount, SettingsConnector } from "./SettingsClient";

import { OwnerPage, PageHeader } from "@/components/owner/kit";
import { engineSetting } from "@/lib/engine-settings";
import { ownerForAccount } from "@/lib/owner-login";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Settings | Axiom Revenue Engine" };

export default async function SettingsPage() {
  const session = await requireSession();

  const userProfile = {
    id: session.user.id,
    name: session.user.name ?? "",
    email: session.user.email ?? "",
    image: (session.user as Record<string, unknown>).image as string | null ?? null,
    role: session.user.role ?? "user",
  };
  // The Claude connector's setup lines use this app's own address: the APP_BASE_URL setting, or the address the page was asked at.
  const asked = await headers();
  const host = asked.get("x-forwarded-host") ?? asked.get("host");
  const baseUrl = (engineSetting("APP_BASE_URL") || (host ? `${asked.get("x-forwarded-proto") ?? "https"}://${host}` : "")).replace(/\/+$/, "");
  const founder = ownerForAccount(session.user.email ?? "")?.name ?? null;

  return (
    <OwnerPage>
      <PageHeader eyebrow="Settings" title="Settings" description="Your account and the phone app. Campaigns are paused and resumed on their own screens." />
      <SettingsAccount userProfile={userProfile} />
      <SettingsConnector founder={founder} baseUrl={baseUrl} />
    </OwnerPage>
  );
}
