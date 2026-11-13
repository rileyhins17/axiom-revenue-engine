import type { Metadata } from "next";

import { SettingsAccount } from "./SettingsClient";

import { OwnerPage, PageHeader } from "@/components/owner/kit";
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

  return (
    <OwnerPage>
      <PageHeader eyebrow="Settings" title="Settings" description="Your account and the phone app. Campaigns are paused and resumed on their own screens." />
      <SettingsAccount userProfile={userProfile} />
    </OwnerPage>
  );
}
