"use client";

import { AlertTriangle, CheckCircle2, CircleHelp, Mail, ShieldCheck, UserRound } from "lucide-react";

import { EmergencyControlCard } from "@/components/emergency-control-card";

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

export function SettingsClient({
  userProfile,
  isAdmin,
  emergencyControl,
}: {
  userProfile: UserProfile;
  isAdmin: boolean;
  emergencyControl: EmergencyState;
}) {
  const stopVerified = emergencyControl.status === "VERIFIED" && typeof emergencyControl.emergencyPaused === "boolean";

  return (
    <div className="mx-auto flex max-w-[1120px] flex-col gap-5 text-[#24352e]">
      <header className="border-b border-[#dedfd7] pb-5">
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#416b55]">Workspace controls</p>
        <h1 className="mt-2 text-[2rem] font-semibold leading-tight tracking-[-0.04em] text-[#1e3027] sm:text-[2.65rem]">Settings & safety</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-[#53655a]">Check the system stop first, then confirm what still needs to be ready before business email can be used.</p>
      </header>

      <section aria-labelledby="safety-heading" className={`overflow-hidden rounded-2xl border shadow-sm ${stopVerified && emergencyControl.emergencyPaused ? "border-[#e7b7a9] bg-[#fff8f5]" : "border-[#dfe4db] bg-white"}`}>
        <div className="flex items-start gap-3 border-b border-[#e8ebe3] px-5 py-5 sm:px-6">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#eaf1e9] text-[#285d3d]"><ShieldCheck className="size-5" aria-hidden="true" /></span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="safety-heading" className="text-lg font-semibold text-[#1e3027]">Emergency stop</h2>
              <StateBadge state={stopVerified ? (emergencyControl.emergencyPaused ? "Stopped" : "Clear") : "Unknown"} />
            </div>
            <p className="mt-1 text-sm leading-6 text-[#53655a]">
              {stopVerified
                ? emergencyControl.emergencyPaused
                  ? "The saved setting confirms the stop is engaged. Autonomous intake, queueing, and sending are blocked."
                  : "The saved setting confirms the stop is clear. This does not mean email or other providers are ready."
                : "The stop could not be checked. Treat the system as unavailable until an administrator can verify it."}
            </p>
          </div>
        </div>
        <div className="p-4 sm:p-6">
          {isAdmin && stopVerified ? (
            <EmergencyControlCard initialState={{
              emergencyPaused: emergencyControl.emergencyPaused as boolean,
              emergencyPausedAt: emergencyControl.emergencyPausedAt,
              emergencyPausedBy: emergencyControl.emergencyPausedBy,
              emergencyPauseReason: emergencyControl.emergencyPauseReason,
            }} />
          ) : !stopVerified ? (
            <div role="status" className="flex gap-3 rounded-xl border border-[#e8c9a0] bg-[#fff9ef] p-4 text-sm leading-6 text-[#634c2a]">
              <CircleHelp className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
              <p>{isAdmin ? "The stop control is unavailable while its state is unknown. Refresh this page after the settings service recovers." : "Ask an administrator to verify the stop before any external work."}</p>
            </div>
          ) : (
            <p className="rounded-xl border border-[#e1e5dc] bg-[#fafbf8] p-4 text-sm leading-6 text-[#53655a]">
              You can view the saved stop state. Only an administrator can change it.
            </p>
          )}
        </div>
      </section>

      <section aria-labelledby="readiness-heading" className="rounded-2xl border border-[#e0e4db] bg-white p-5 shadow-sm sm:p-6">
        <div className="flex items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-[#fff5dc] text-[#815a14]"><Mail className="size-5" aria-hidden="true" /></span>
          <div>
            <h2 id="readiness-heading" className="text-lg font-semibold text-[#1e3027]">Business email readiness</h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-[#53655a]">Not ready for use. Five checks remain: incoming mail, replies, sender setup, contact eligibility, and approval of each message.</p>
          </div>
        </div>

        <details className="mt-4 rounded-xl border border-[#e5e9e1] bg-[#fafbf8] px-4 py-3">
          <summary className="cursor-pointer text-sm font-semibold text-[#315b40]">See the five checks</summary>
          <ul className="mt-3 space-y-2 pl-5 text-sm leading-5 text-[#53655a]">
            <li className="list-disc">Incoming mail must be shown to reach the right owner.</li>
            <li className="list-disc">A working reply path and reply owner must be confirmed.</li>
            <li className="list-disc">Provider access and sender-domain approval must be confirmed separately from forwarding.</li>
            <li className="list-disc">Each contact must be eligible for the specific message; a verified address alone is not permission.</li>
            <li className="list-disc">An owner must approve the exact message before sending.</li>
          </ul>
          <p className="mt-3 border-t border-[#e5e9e1] pt-3 text-xs leading-5 text-[#596b5f]">These checks are separate. This page does not connect a provider, buy a service, or turn on sending. The planned setup does not require paid Google Workspace mailboxes.</p>
        </details>
      </section>

      <details className="rounded-2xl border border-[#e0e4db] bg-white px-5 py-4 shadow-sm sm:px-6">
        <summary className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-[#53655a]"><UserRound className="size-4" aria-hidden="true" />Account details</summary>
        <dl aria-label="Your account" className="mt-3 divide-y divide-[#e8ebe3] border-t border-[#e8ebe3]">
          <AccountRow label="Name" value={userProfile.name || "Name not set"} />
          <AccountRow label="Email" value={userProfile.email} />
          <AccountRow label="Access" value={userProfile.role ?? "user"} capitalize />
        </dl>
      </details>
    </div>
  );
}

function StateBadge({ state }: { state: "Stopped" | "Clear" | "Unknown" }) {
  const tone = state === "Stopped"
    ? "border-[#e7b7a9] bg-[#fff0eb] text-[#8d3320]"
    : state === "Clear"
      ? "border-[#c7ddc9] bg-[#edf7ed] text-[#2e633c]"
      : "border-[#e8c9a0] bg-[#fff9ef] text-[#79530d]";
  const Icon = state === "Stopped" ? AlertTriangle : state === "Clear" ? CheckCircle2 : CircleHelp;
  return <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${tone}`}><Icon className="size-3.5" aria-hidden="true" />{state}</span>;
}

function AccountRow({ label, value, capitalize = false }: { label: string; value: string; capitalize?: boolean }) {
  return (
    <div className="flex flex-wrap justify-between gap-2 py-3 text-sm">
      <dt className="text-[#65756a]">{label}</dt>
      <dd className={`break-all font-medium text-[#24352e] ${capitalize ? "capitalize" : ""}`}>{value}</dd>
    </div>
  );
}
