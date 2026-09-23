"use client";

import { Mail, Settings, UserRound } from "lucide-react";

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
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <header className="rounded-[28px] bg-[#f6f8f3] p-5 text-[#263a2f] shadow-xl shadow-black/10 sm:p-7 lg:p-8">
        <div className="mx-auto max-w-[1160px]">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#537262]">Axiom · Owner settings</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-[#24382d] sm:text-4xl">Settings and safety</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[#586d60]">Review your account, the planned mail route, and the system stop. This page does not connect a provider or send messages.</p>
        </div>
      </header>

      <div className="grid gap-5 lg:grid-cols-2">
        <section aria-labelledby="account-heading" className="rounded-[24px] bg-white p-5 text-[#263a2f] shadow-sm ring-1 ring-inset ring-[#e4ebe2] sm:p-6">
          <div className="flex items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#edf3eb] text-[#41634d]"><UserRound className="size-5" aria-hidden="true" /></span>
            <div className="min-w-0 flex-1">
              <h2 id="account-heading" className="text-lg font-semibold text-[#294333]">Your account</h2>
              <p className="mt-1 text-sm text-[#566a5d]">Signed in to the owner workspace.</p>
            </div>
          </div>
          <dl className="mt-5 divide-y divide-[#e8eee6] rounded-xl border border-[#e4ebe2] px-4">
            <div className="flex flex-col gap-1 py-3 sm:flex-row sm:justify-between sm:gap-4">
              <dt className="text-xs font-medium text-[#566a5d]">Name</dt>
              <dd className="break-words text-sm font-medium text-[#294333]">{userProfile.name || "Name not set"}</dd>
            </div>
            <div className="flex flex-col gap-1 py-3 sm:flex-row sm:justify-between sm:gap-4">
              <dt className="text-xs font-medium text-[#566a5d]">Email</dt>
              <dd className="break-all text-sm font-medium text-[#294333]">{userProfile.email}</dd>
            </div>
            <div className="flex flex-col gap-1 py-3 sm:flex-row sm:justify-between sm:gap-4">
              <dt className="text-xs font-medium text-[#566a5d]">Access</dt>
              <dd className="text-sm font-medium capitalize text-[#294333]">{userProfile.role ?? "user"}</dd>
            </div>
          </dl>
        </section>

        <section aria-labelledby="mail-route-heading" className="rounded-[24px] bg-[#f6f8f3] p-5 text-[#263a2f] shadow-sm ring-1 ring-inset ring-[#e4ebe2] sm:p-6">
          <div className="flex items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-white text-[#8c6722] ring-1 ring-inset ring-[#e9e2cf]"><Mail className="size-5" aria-hidden="true" /></span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 id="mail-route-heading" className="text-lg font-semibold text-[#294333]">Mail route</h2>
                <span className="rounded-full bg-[#fff4d9] px-3 py-1 text-xs font-semibold text-[#805d17]">Not verified</span>
              </div>
              <p className="mt-1 text-sm leading-6 text-[#566a5d]">No paid inbox is assumed. The selected plan uses Cloudflare forwarding for incoming mail and a separately gated Resend route for outgoing mail and replies.</p>
            </div>
          </div>
          <p className="mt-4 rounded-xl bg-white/80 px-4 py-3 text-sm leading-6 text-[#586d60] ring-1 ring-inset ring-[#e4ebe2]">Forwarding destinations, provider access, sender verification, and reply handling have not been proven. This screen does not offer a Gmail connection or authorize sending.</p>
        </section>
      </div>

      {isAdmin ? (
        <section aria-labelledby="safety-heading" className="rounded-[24px] bg-white p-5 text-[#263a2f] shadow-sm ring-1 ring-inset ring-[#e4ebe2] sm:p-6">
          <div className="mb-4 flex items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#edf3eb] text-[#41634d]"><Settings className="size-5" aria-hidden="true" /></span>
            <div>
              <h2 id="safety-heading" className="text-lg font-semibold text-[#294333]">System stop</h2>
              <p className="mt-1 text-sm leading-6 text-[#566a5d]">Check the stop before making changes. A dashboard warning does not stop the live system.</p>
            </div>
          </div>
          <EmergencyControlCard initialState={emergencyControl} />
        </section>
      ) : (
        <section aria-labelledby="safety-heading" className="rounded-[24px] bg-white p-5 text-[#263a2f] shadow-sm ring-1 ring-inset ring-[#e4ebe2] sm:p-6">
          <h2 id="safety-heading" className="text-lg font-semibold text-[#294333]">System stop</h2>
          <p className="mt-2 text-sm leading-6 text-[#566a5d]">{emergencyControl.status === "UNAVAILABLE" ? "The stop status could not be verified. Ask an administrator before starting external work." : emergencyControl.emergencyPaused ? "The administrator reports that the system stop is engaged." : "The stop was not engaged at the time of the last check. This does not confirm that providers or sending are ready."}</p>
        </section>
      )}
    </div>
  );
}
