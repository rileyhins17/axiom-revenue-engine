"use client";

import { AlertTriangle, CheckCircle2, CircleHelp, Info, Mail, ShieldCheck, UserRound } from "lucide-react";

import { EmergencyControlCard } from "@/components/emergency-control-card";
import { Badge, Notice, Panel } from "@/components/owner/kit";

type EmergencyState = {
  status: "VERIFIED" | "UNAVAILABLE";
  emergencyPaused: boolean | null;
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

export function SettingsAccount({ userProfile }: { userProfile: UserProfile }) {
  return (
    <Panel title="Your account" icon={UserRound}>
      <dl aria-label="Your account" className="divide-y divide-[#efe9dc]">
        <AccountRow label="Name" value={userProfile.name || "Name not set"} />
        <AccountRow label="Email" value={userProfile.email} />
        <AccountRow label="Access" value={userProfile.role ?? "user"} capitalize />
      </dl>
    </Panel>
  );
}

/** The paused website campaign's controls. None of them touch FCC emails. */
export function SettingsOutreach({
  isAdmin,
  emergencyControl,
}: {
  isAdmin: boolean;
  emergencyControl: EmergencyState;
}) {
  const stopVerified = emergencyControl.status === "VERIFIED" && typeof emergencyControl.emergencyPaused === "boolean";
  const stopState = stopVerified ? (emergencyControl.emergencyPaused ? "Stopped" : "Clear") : "Unknown";

  return (
    <>
      <div className="space-y-3 pt-2">
        <p className="owner-eyebrow">Old website outreach</p>
        <Notice tone="info" icon={Info}>
          These two are for the paused website campaign. They don&apos;t affect FCC emails: FCC has its own Pause button on the FCC screen.
        </Notice>
      </div>

      <Panel
        title={<span id="safety-heading">Emergency stop</span>}
        icon={ShieldCheck}
        action={<Badge tone={stopState === "Stopped" ? "danger" : stopState === "Clear" ? "success" : "warning"}
          icon={stopState === "Stopped" ? AlertTriangle : stopState === "Clear" ? CheckCircle2 : CircleHelp}>{stopState}</Badge>}
        description={stopVerified
          ? emergencyControl.emergencyPaused
            ? "The saved setting confirms the stop is engaged. Autonomous intake, queueing, and sending are blocked."
            : "The saved setting confirms the stop is clear. This does not mean email or other providers are ready."
          : "The stop could not be checked. Treat the system as unavailable until an administrator can verify it."}
      >
        {isAdmin && stopVerified ? (
          <EmergencyControlCard initialState={{
            emergencyPaused: emergencyControl.emergencyPaused as boolean,
            emergencyPausedAt: emergencyControl.emergencyPausedAt,
            emergencyPausedBy: emergencyControl.emergencyPausedBy,
            emergencyPauseReason: emergencyControl.emergencyPauseReason,
          }} />
        ) : !stopVerified ? (
          <Notice tone="warning" icon={CircleHelp} role="status">
            {isAdmin ? "The stop control is unavailable while its state is unknown. Refresh this page after the settings service recovers." : "Ask an administrator to verify the stop before any external work."}
          </Notice>
        ) : (
          <p className="owner-empty">You can view the saved stop state. Only an administrator can change it.</p>
        )}
      </Panel>

      <Panel
        title={<span id="readiness-heading">Business email readiness</span>}
        icon={Mail}
        action={<Badge tone="neutral">Not ready</Badge>}
        description="Five checks remain: incoming mail, replies, sender setup, contact eligibility, and approval of each message."
      >
        <details className="rounded-xl border border-[#e6e1d6] bg-[#faf7f0] px-4 py-3">
          <summary className="cursor-pointer text-sm font-semibold text-[#0a0a0a]">See the five checks</summary>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-5 text-[#3b3a36]">
            <li>Incoming mail must be shown to reach the right owner.</li>
            <li>A working reply path and reply owner must be confirmed.</li>
            <li>Provider access and sender-domain approval must be confirmed separately from forwarding.</li>
            <li>Each contact must be eligible for the specific message; a verified address alone is not permission.</li>
            <li>An owner must approve the exact message before sending.</li>
          </ul>
          <p className="owner-meta mt-3 border-t border-[#e6e1d6] pt-3">These checks are separate. This page does not connect a provider, buy a service, or turn on sending. The planned setup does not require paid Google Workspace mailboxes.</p>
        </details>
      </Panel>
    </>
  );
}

function AccountRow({ label, value, capitalize = false }: { label: string; value: string; capitalize?: boolean }) {
  return (
    <div className="flex flex-wrap justify-between gap-2 py-3 text-sm first:pt-0 last:pb-0">
      <dt className="text-[#5c584f]">{label}</dt>
      <dd className={`break-all font-medium text-[#0a0a0a] ${capitalize ? "capitalize" : ""}`}>{value}</dd>
    </div>
  );
}
