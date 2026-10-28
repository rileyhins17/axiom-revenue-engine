import { CallerLinks } from '@/components/settings/caller-links';
import {CallerConversions} from '@/components/settings/caller-conversions';
import { SettingsAccount, SettingsOutreach } from "./SettingsClient";

import { CallerConnect } from "@/components/settings/caller-connect";
import { OwnerPage, PageHeader } from "@/components/owner/kit";

import { getPrisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const session = await requireSession();

  // This owner page must remain read-only. Do not call helpers that create
  // default settings or activate/synchronize legacy Gmail mailbox rows here.
  const emergencySetting = await Promise.resolve()
    .then(() => getPrisma().outreachAutomationSetting.findUnique({ where: { id: "global" } }))
    .catch(() => null);

  const userProfile = {
    id: session.user.id,
    name: session.user.name ?? "",
    email: session.user.email ?? "",
    image: (session.user as Record<string, unknown>).image as string | null ?? null,
    role: session.user.role ?? "user",
  };

  const emergencyControl = emergencySetting
    ? {
        status: "VERIFIED" as const,
        emergencyPaused: emergencySetting.emergencyPaused,
        emergencyPausedAt: emergencySetting.emergencyPausedAt?.toISOString() ?? null,
        emergencyPausedBy: emergencySetting.emergencyPausedBy,
        emergencyPauseReason: emergencySetting.emergencyPauseReason,
      }
    : {
        status: "UNAVAILABLE" as const,
        emergencyPaused: null,
        emergencyPausedAt: null,
        emergencyPausedBy: null,
        emergencyPauseReason: null,
      };

  return (
    <OwnerPage>
      <PageHeader eyebrow="Settings" title="Settings" description="Your account, the Axiom Caller extension, and the old website outreach controls." />
      <SettingsAccount userProfile={userProfile} />
      <CallerConnect />
      <CallerLinks />
      <CallerConversions />
      <SettingsOutreach isAdmin={session.user.role === "admin"} emergencyControl={emergencyControl} />
    </OwnerPage>
  );
}
