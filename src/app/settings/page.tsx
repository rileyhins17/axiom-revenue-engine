import { SettingsClient } from "./SettingsClient";

import { getDatabase } from "@/lib/cloudflare";
import { getServerEnv } from "@/lib/env";
import { getAutomationSettings, syncMailboxesForGmailConnections } from "@/lib/outreach-automation";
import { getPrisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { isSendableMailbox } from "@/lib/ui/data-accuracy";

export const dynamic = "force-dynamic";

async function listConnectedMailboxes(): Promise<Array<{ gmailAddress: string; status: string | null; gmailConnectionId: string | null }>> {
  const result = await getDatabase()
    .prepare(
      `SELECT LOWER("gmailAddress") AS gmailAddress, "status", "gmailConnectionId"
       FROM "OutreachMailbox"
       ORDER BY "updatedAt" DESC`,
    )
    .all<{ gmailAddress: string; status: string | null; gmailConnectionId: string | null }>();
  return result.results ?? [];
}

export default async function SettingsPage() {
  const session = await requireSession();
  const env = getServerEnv();
  const prisma = getPrisma();
  const automationSettings = await getAutomationSettings(prisma).catch(() => ({
    emergencyPaused: false,
    emergencyPausedAt: null,
    emergencyPausedBy: null,
    emergencyPauseReason: null,
  }));

  const [connections, syncedMailboxes, directMailboxes] = await Promise.all([
    prisma.gmailConnection
      .findMany({ select: { gmailAddress: true } })
      .catch(() => [] as Array<{ gmailAddress: string }>),
    syncMailboxesForGmailConnections().catch(
      () => [] as Array<{ gmailAddress: string; status: string }>,
    ),
    listConnectedMailboxes().catch(() => [] as Array<{ gmailAddress: string; status: string | null; gmailConnectionId: string | null }>),
  ]);

  const connectedAddresses = new Set(
    connections.map((connection) => connection.gmailAddress.toLowerCase()),
  );

  const expected = ["aidan@getaxiom.ca", "riley@getaxiom.ca"] as const;
  const mailboxes = expected.map((email) => {
    const synced = syncedMailboxes.find((m) => m.gmailAddress.toLowerCase() === email);
    const direct = directMailboxes.find((m) => (m.gmailAddress || "").toLowerCase() === email);
    const found = synced ?? direct;
    return {
      email,
      connected: connectedAddresses.has(email) || Boolean(found && isSendableMailbox(found)),
      status: found?.status ?? null,
    };
  });

  const isAdmin = session.user.role === "admin";

  const userProfile = {
    id: session.user.id,
    name: session.user.name ?? "",
    email: session.user.email ?? "",
    image: (session.user as Record<string, unknown>).image as string | null ?? null,
    role: session.user.role ?? "user",
  };

  return (
    <SettingsClient
      userProfile={userProfile}
      isAdmin={isAdmin}
      runtimeStatus={{
        currentUserEmail: session.user.email,
        globalDailySendCap: env.AUTONOMOUS_MAX_SENDS_PER_DAY,
      }}
      mailboxes={mailboxes}
      emergencyControl={{
        emergencyPaused: automationSettings.emergencyPaused,
        emergencyPausedAt: automationSettings.emergencyPausedAt ? automationSettings.emergencyPausedAt.toISOString() : null,
        emergencyPausedBy: automationSettings.emergencyPausedBy,
        emergencyPauseReason: automationSettings.emergencyPauseReason,
      }}
    />
  );
}
