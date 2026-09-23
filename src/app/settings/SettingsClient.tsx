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
    <main className="mx-auto flex max-w-[1120px] flex-col gap-5 text-[#24352e]">
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
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#fff5dc] text-[#815a14]"><Mail className="size-5" aria-hidden="true" /></span>
          <div>
            <h2 id="readiness-heading" className="text-lg font-semibold text-[#1e3027]">Business email readiness</h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-[#53655a]">Email is not ready for use from this workspace. These checks are separate; completing one does not complete the others.</p>
          </div>
        </div>

        <ol className="mt-5 divide-y divide-[#e8ebe3] border-t border-[#e8ebe3]">
          <ReadinessStep number="1" title="Incoming mail reaches the right owner" state="Not verified" detail="The forwarding destination and actual delivery have not been proven here." />
          <ReadinessStep number="2" title="A reply can be sent from the business address" state="Not verified" detail="A working reply path and who owns replies still need an end-to-end check." />
          <ReadinessStep number="3" title="The sender identity and domain are approved" state="Not verified" detail="Provider access and sender-domain verification are separate from inbox forwarding." />
          <ReadinessStep number="4" title="Each contact is eligible for the specific message" state="Required per contact" detail="Address verification alone does not establish permission to contact someone." />
          <ReadinessStep number="5" title="The exact message has owner approval" state="Required before sending" detail="No account connection or readiness check on this page authorizes a send." />
        </ol>
        <p className="mt-4 rounded-xl bg-[#f6f8f3] px-4 py-3 text-xs leading-5 text-[#596b5f]">The planned setup avoids paid mailbox seats. This page does not connect a provider, buy a service, or turn on sending.</p>
      </section>

      <section aria-labelledby="account-heading" className="rounded-2xl border border-[#e0e4db] bg-white p-5 shadow-sm sm:p-6">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#eaf1e9] text-[#285d3d]"><UserRound className="size-5" aria-hidden="true" /></span>
          <div>
            <h2 id="account-heading" className="text-lg font-semibold text-[#1e3027]">Your account</h2>
            <p className="mt-1 text-sm text-[#53655a]">Signed in to the owner workspace.</p>
          </div>
        </div>
        <dl className="mt-5 divide-y divide-[#e8ebe3] border-t border-[#e8ebe3]">
          <AccountRow label="Name" value={userProfile.name || "Name not set"} />
          <AccountRow label="Email" value={userProfile.email} />
          <AccountRow label="Access" value={userProfile.role ?? "user"} capitalize />
        </dl>
      </section>
    </main>
  );
}

function ReadinessStep({ number, title, state, detail }: { number: string; title: string; state: string; detail: string }) {
  return (
    <li className="flex gap-3 py-4 sm:gap-4">
      <span className="grid size-8 shrink-0 place-items-center rounded-full border border-[#dce3d9] bg-[#fafbf8] text-sm font-semibold text-[#416b55]">{number}</span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <h3 className="text-sm font-semibold text-[#24352e]">{title}</h3>
          <span className="text-xs font-semibold text-[#79530d]">{state}</span>
        </div>
        <p className="mt-1 text-sm leading-5 text-[#65756a]">{detail}</p>
      </div>
    </li>
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
