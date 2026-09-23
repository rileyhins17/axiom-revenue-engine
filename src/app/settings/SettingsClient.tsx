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
    <div className="mx-auto flex max-w-[1120px] flex-col gap-5 text-[#24352e]">
      <header className="border-b border-[#dedfd7] pb-6">
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#416b55]">Workspace controls</p>
        <h1 className="mt-2 text-[2rem] font-semibold leading-tight tracking-[-0.04em] text-[#1e3027] sm:text-[2.65rem]">Settings & safety</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-[#53655a]">Check the system stop and mail status before changing how the workspace operates.</p>
      </header>

      <section aria-labelledby="safety-heading" className="overflow-hidden rounded-2xl border border-[#dfe4db] bg-white shadow-sm">
        <div className="flex items-start gap-3 border-b border-[#e8ebe3] px-5 py-5 sm:px-6">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#eaf1e9] text-[#285d3d]"><Settings className="size-5" aria-hidden="true" /></span>
          <div>
            <h2 id="safety-heading" className="text-lg font-semibold text-[#1e3027]">System stop</h2>
            <p className="mt-1 text-sm leading-6 text-[#53655a]">The saved stop setting controls autonomous work. A warning on another page does not change it.</p>
          </div>
        </div>
        <div className="p-4 sm:p-6">
          {isAdmin ? (
            <EmergencyControlCard initialState={emergencyControl} />
          ) : (
            <p className="rounded-xl border border-[#e1e5dc] bg-[#fafbf8] p-4 text-sm leading-6 text-[#53655a]">
              {emergencyControl.status === "UNAVAILABLE"
                ? "The stop status could not be verified. Ask an administrator before starting external work."
                : emergencyControl.emergencyPaused
                  ? "The administrator reports that the system stop is engaged."
                  : "The stop was not engaged at the last check. This does not confirm that providers or sending are ready."}
            </p>
          )}
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section aria-labelledby="mail-route-heading" className="rounded-2xl border border-[#e0e4db] bg-white p-5 shadow-sm sm:p-6">
          <div className="flex items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#fff5dc] text-[#815a14]"><Mail className="size-5" aria-hidden="true" /></span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 id="mail-route-heading" className="text-lg font-semibold text-[#1e3027]">Business email</h2>
                <span className="rounded-full border border-[#edd9aa] bg-[#fff7e5] px-2.5 py-1 text-xs font-semibold text-[#79530d]">Not verified</span>
              </div>
              <p className="mt-1 text-sm leading-6 text-[#53655a]">Incoming forwarding and the owner reply path still need a working end-to-end check. Email is not ready to use from this workspace.</p>
            </div>
          </div>
          <details className="mt-5 border-t border-[#e8ebe3] pt-4 text-sm text-[#53655a]">
            <summary className="min-h-8 cursor-pointer font-semibold text-[#225a40] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145943]">How the planned route works</summary>
            <p className="mt-2 leading-6">The zero-paid-mailbox plan uses Cloudflare forwarding to owner inboxes and a separately gated Resend route for outgoing mail and replies. Provider access, sender verification, forwarding destinations, and reply handling have not been proven. This page does not connect a provider or authorize sending.</p>
          </details>
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
            <div className="flex flex-wrap justify-between gap-2 py-3 text-sm">
              <dt className="text-[#65756a]">Name</dt>
              <dd className="font-medium text-[#24352e]">{userProfile.name || "Name not set"}</dd>
            </div>
            <div className="flex flex-wrap justify-between gap-2 py-3 text-sm">
              <dt className="text-[#65756a]">Email</dt>
              <dd className="break-all font-medium text-[#24352e]">{userProfile.email}</dd>
            </div>
            <div className="flex flex-wrap justify-between gap-2 py-3 text-sm">
              <dt className="text-[#65756a]">Access</dt>
              <dd className="font-medium capitalize text-[#24352e]">{userProfile.role ?? "user"}</dd>
            </div>
          </dl>
        </section>
      </div>
    </div>
  );
}
