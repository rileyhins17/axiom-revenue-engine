"use client";

import type { ReactNode } from "react";
import { CheckCircle2, Mail, Settings, XCircle } from "lucide-react";

import { EmergencyControlCard } from "@/components/emergency-control-card";
import { PageHeader } from "@/components/ui/page-header";

type MailboxStatus = {
  email: string;
  connected: boolean;
  status: string | null;
};

type EmergencyState = {
  emergencyPaused: boolean;
  emergencyPausedAt: string | null;
  emergencyPausedBy: string | null;
  emergencyPauseReason: string | null;
};

type UserProfile = {
  id: string;
  name: string;
  email: string;
  image: string | null;
  role: string | null;
};

type RuntimeStatus = {
  currentUserEmail: string;
  globalDailySendCap: number;
};

export function SettingsClient({
  userProfile,
  isAdmin,
  runtimeStatus,
  mailboxes,
  emergencyControl,
}: {
  userProfile: UserProfile;
  isAdmin: boolean;
  runtimeStatus: RuntimeStatus;
  mailboxes: MailboxStatus[];
  emergencyControl: EmergencyState;
}) {
  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <PageHeader
        eyebrow="Workspace controls"
        title="Settings"
        description="Connect sending identities, review operating limits, and control autonomous work."
        icon={Settings}
        status={<span className="v2-pill"><span className="capitalize text-emerald-300">{userProfile.role ?? "user"}</span><span className="font-mono text-zinc-300">{runtimeStatus.currentUserEmail}</span></span>}
        metrics={[
          { label: "Daily send limit", value: runtimeStatus.globalDailySendCap, detail: "workspace total", tone: "info" },
          { label: "Connected inboxes", value: mailboxes.filter((mailbox) => mailbox.connected).length, detail: `of ${mailboxes.length}`, tone: "positive" },
        ]}
      />

      <Panel>
        <SectionTitle
          title="Sender mailboxes"
          detail={`Connect once via Google OAuth. Runtime cap: ${runtimeStatus.globalDailySendCap}/day total.`}
        />
        <div className="space-y-3">
          {mailboxes.map((mailbox) => (
            <MailboxRow key={mailbox.email} mailbox={mailbox} />
          ))}
        </div>
      </Panel>

      {isAdmin ? <EmergencyControlCard initialState={emergencyControl} /> : null}
    </div>
  );
}

function MailboxRow({ mailbox }: { mailbox: MailboxStatus }) {
  const statusLabel = mailbox.connected
    ? `Connected · ${mailbox.status?.toLowerCase() ?? "warming"}`
    : "Not connected";
  return (
    <div
      className="v2-tile flex flex-col gap-4 p-4 transition hover:border-white/[0.12] sm:flex-row sm:items-center sm:justify-between"
      role="group"
      aria-label={`Mailbox ${mailbox.email} — ${statusLabel}`}
    >
      <div className="flex min-w-0 items-center gap-3">
        <div
          className={`flex h-10 w-10 items-center justify-center rounded-lg border ${mailbox.connected ? "border-emerald-400/30 bg-emerald-400/[0.08]" : "border-zinc-700 bg-black/30"}`}
          aria-hidden="true"
        >
          {mailbox.connected ? <CheckCircle2 className="h-4 w-4 text-emerald-300" /> : <XCircle className="h-4 w-4 text-zinc-500" />}
        </div>
        <div className="min-w-0">
          <div className="truncate font-mono text-sm text-white">{mailbox.email}</div>
          <div className="mt-0.5 text-[11px] text-zinc-400">{statusLabel}</div>
        </div>
      </div>
      {mailbox.connected ? (
        <span className="rounded-md border border-emerald-400/25 bg-emerald-400/10 px-2 py-1 text-[10px] font-mono uppercase tracking-widest text-emerald-300">
          Active
        </span>
      ) : (
        <a
          href={`/api/outreach/gmail/connect?email=${encodeURIComponent(mailbox.email)}`}
          aria-label={`Connect ${mailbox.email} via Google OAuth`}
          className="v2-btn-primary v2-focus-ring inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold whitespace-nowrap sm:w-auto cursor-pointer"
        >
          <Mail className="h-4 w-4" aria-hidden="true" />
          Connect Gmail
        </a>
      )}
    </div>
  );
}

function Panel({ children }: { children: ReactNode }) {
  return <div className="v2-card p-4 sm:p-5">{children}</div>;
}

function SectionTitle({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="mb-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-zinc-100">{title}</div>
      <p className="mt-1 text-xs leading-5 text-zinc-500">{detail}</p>
    </div>
  );
}
