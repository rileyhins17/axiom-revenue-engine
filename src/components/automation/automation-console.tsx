"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Check, Mail, RefreshCw, ShieldAlert, ShieldCheck } from "lucide-react";

import type { AutomationOperatorConsoleData } from "@/lib/automation-operator-view";

type Props = {
  data: AutomationOperatorConsoleData | null;
  canOpenBusinessReview: boolean;
  canControlEmergencyStop: boolean;
};

export function AutomationConsole({ data, canOpenBusinessReview, canControlEmergencyStop }: Props) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const [stopState, setStopState] = useState<boolean | null>(data?.settings.emergencyPaused ?? null);
  const [stopPending, setStopPending] = useState(false);
  const [stopError, setStopError] = useState<string | null>(null);

  useEffect(() => {
    setStopState(data?.settings.emergencyPaused ?? null);
  }, [data?.generatedAt, data?.settings.emergencyPaused]);

  const emergencyPaused = stopState ?? data?.settings.emergencyPaused ?? null;

  function refresh() {
    startRefresh(() => router.refresh());
  }

  async function stopExternalWork() {
    if (!window.confirm("Turn on the emergency stop for new intake, queueing, and email sending?")) return;

    setStopPending(true);
    setStopError(null);
    try {
      const response = await fetch("/api/outreach/automation/emergency", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paused: true }),
      });
      const payload = (await response.json().catch(() => ({}))) as { emergencyPaused?: boolean; error?: string };
      if (!response.ok || payload.emergencyPaused !== true) {
        throw new Error(payload.error || "The emergency stop could not be confirmed.");
      }
      setStopState(true);
      router.refresh();
    } catch (error) {
      setStopError(error instanceof Error ? error.message : "The emergency stop could not be confirmed.");
    } finally {
      setStopPending(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-4 text-[#20352a]">
      <header className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-[#e3e9e2] bg-white px-5 py-4 shadow-sm sm:px-6">
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#145943]">Axiom Web · Owner follow-through</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-[#172b21]">Outreach</h1>
          <p className="mt-1.5 max-w-2xl text-sm leading-6 text-[#58695f]">
            Keep business review and human follow-through moving. Email sending and replies are not available from this page.
          </p>
        </div>
        <button
          type="button"
          onClick={refresh}
          disabled={refreshing}
          className="v2-focus-ring inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-[#d9e2d9] bg-white px-4 text-sm font-semibold text-[#315b43] hover:bg-[#f8faf7] disabled:cursor-not-allowed disabled:opacity-60"
        >
          <RefreshCw className={`size-4 ${refreshing ? "animate-spin" : ""}`} aria-hidden="true" />
          Refresh status
        </button>
      </header>

      {data === null ? (
        <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-[#674c1f]" role="alert" aria-live="polite">
          <ShieldAlert className="mt-0.5 size-5 shrink-0 text-amber-700" aria-hidden="true" />
          <div>
            <h2 className="text-sm font-semibold">Some status could not be verified</h2>
            <p className="mt-1 text-sm leading-6 text-[#725c34]">
              The legacy system status did not load. This notice does not pause the live system. Check the emergency stop before any external work.
            </p>
          </div>
        </div>
      ) : null}

      <section aria-label="Outreach owner guidance" className="grid gap-4 lg:grid-cols-[1.05fr_0.95fr]">
        <section aria-labelledby="outreach-next-step" className="rounded-2xl border border-[#dce7dc] bg-white p-5 shadow-sm sm:p-6">
          <div className="flex items-center gap-2 text-xs font-semibold text-[#145943]"><Check className="size-4" aria-hidden="true" />Your next step</div>
          <h2 id="outreach-next-step" className="mt-3 text-xl font-semibold tracking-tight text-[#20352a]">Review the business evidence</h2>
          <p className="mt-2 max-w-xl text-sm leading-6 text-[#58695f]">
            The proposed ten are evaluation candidates, not an approved calling list. Decide which business deserves more research before planning contact.
          </p>
          {canOpenBusinessReview ? (
            <Link href="/leads/m2" className="mt-4 inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-[#145943] px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#104a37] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145943]">
              Open Business Review <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
          ) : (
            <p className="mt-4 rounded-lg border border-[#e3e9e2] bg-[#f8faf7] px-4 py-3 text-sm font-medium text-[#53675a]">An admin owner needs to open Business Review.</p>
          )}
          <p className="mt-3 text-xs text-[#52645a]">A public contact detail alone is not approval to reach out.</p>
        </section>

        <section aria-labelledby="outreach-mail-status" className="rounded-2xl border border-[#e3e9e2] bg-white p-5 shadow-sm sm:p-6">
          <div className="flex items-start gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-amber-50 text-amber-800"><Mail className="size-5" aria-hidden="true" /></span>
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-amber-800">Unavailable</p>
              <h3 id="outreach-mail-status" className="mt-0.5 text-base font-semibold text-[#263a2f]">Email route not verified</h3>
              <p className="mt-1 text-sm leading-6 text-[#5b7063]">Owner forwarding and a working reply path have not been proven. No paid inbox is assumed.</p>
            </div>
          </div>
          <details className="group mt-3 rounded-lg border border-[#e8eee7] bg-[#fafbf9] px-4 py-3 text-sm text-[#4e6958]">
            <summary className="cursor-pointer font-semibold text-[#315b43] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#176443]">What is still unverified?</summary>
            <p className="mt-3 leading-6">Active Cloudflare forwarding destinations are unverified. A Resend account, verified sender, and owner-reply round trip are also unverified. Email remains unavailable for this workflow until the required owner and safety checks are completed.</p>
          </details>
        </section>

        <section aria-labelledby="outreach-manual-work" className="rounded-2xl border border-[#e3e9e2] bg-white p-5 shadow-sm sm:p-6">
          <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#53675a]">Human-owned work</p>
          <h3 id="outreach-manual-work" className="mt-2 text-base font-semibold text-[#263a2f]">Calls, forms, replies, and follow-ups stay with an owner.</h3>
          <p className="mt-2 text-sm leading-6 text-[#5b7063]">For an existing client action or real conversation, use the client board to record the next step.</p>
          <Link href="/clients" className="mt-3 inline-flex min-h-10 items-center gap-2 text-sm font-semibold text-[#145943] hover:text-[#104a37] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145943]">
            Open client follow-ups <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        </section>

        <section aria-labelledby="outreach-stop" className="rounded-2xl border border-[#e3e9e2] bg-white p-5 shadow-sm sm:p-6">
          <div className="flex items-start gap-3">
            <span className={`grid size-9 shrink-0 place-items-center rounded-lg ${emergencyPaused ? "bg-rose-50 text-rose-800" : "bg-[#f6f8f5] text-[#53645b]"}`}>
              {emergencyPaused ? <ShieldAlert className="size-5" aria-hidden="true" /> : <ShieldCheck className="size-5" aria-hidden="true" />}
            </span>
            <div className="min-w-0 flex-1">
              <h3 id="outreach-stop" className="text-base font-semibold text-[#263a2f]">Emergency stop</h3>
              <p className={`mt-2 text-sm font-semibold ${emergencyPaused === null ? "text-amber-800" : emergencyPaused ? "text-rose-800" : "text-[#315b43]"}`}>
                {emergencyPaused === null ? "Could not verify the current stop status" : emergencyPaused ? "On · new automated work is reported stopped" : "Off at the last successful status check"}
              </p>
              {data === null ? <p className="mt-1 text-xs leading-5 text-[#566a5d]">A status failure does not pause the live system. Use Stop everything to request the existing emergency stop.</p> : null}
              {stopError ? <p className="mt-2 text-sm text-rose-800" role="alert">{stopError}</p> : null}
              {!canControlEmergencyStop ? (
                <p className="mt-3 text-sm leading-6 text-[#566a5d]">Only an admin owner can change the emergency stop. Ask an admin to verify or engage it before external work.</p>
              ) : emergencyPaused ? (
                <Link href="/settings" className="mt-3 inline-flex min-h-10 items-center gap-2 text-sm font-semibold text-[#145943] hover:text-[#104a37] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145943]">
                  Review stop settings <ArrowRight className="size-4" aria-hidden="true" />
                </Link>
              ) : (
                <button type="button" onClick={() => void stopExternalWork()} disabled={stopPending} className="mt-3 inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-4 text-sm font-semibold text-rose-900 transition hover:bg-rose-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-700 disabled:cursor-wait disabled:opacity-60">
                  <ShieldAlert className="size-4" aria-hidden="true" />
                  {stopPending ? "Turning on stop…" : "Stop everything"}
                </button>
              )}
            </div>
          </div>
        </section>
      </section>

      <p className="text-xs leading-5 text-[#52645a]">Status last checked: {data ? formatCheckedAt(data.generatedAt) : "Unavailable"}. This page does not authorize contact or change provider settings.</p>

      <details className="group overflow-hidden rounded-xl border border-[#e3e9e2] bg-white">
        <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-semibold text-[#385344] hover:bg-[#f8faf7] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145943] sm:px-5">
          <span>Legacy email system details</span>
          <span className="text-right text-xs font-normal text-[#52645a]">Historical only · not provider readiness</span>
        </summary>
        <div className="border-t border-[#e8eee7] px-4 py-4 sm:px-5">
          <p className="text-sm leading-6 text-[#58695f]">
            Earlier email and inbox records may be useful for historical reconciliation. They do not establish current inbox access, sender verification, permission to contact, or a working reply route. Sending, intake, queue, inbox-reactivation, and enable controls are intentionally not exposed in this Outreach view.
          </p>
          {data === null ? (
            <p className="mt-3 text-sm font-medium text-amber-800">Legacy records could not be loaded; no counts are shown.</p>
          ) : (
            <p className="mt-3 text-sm text-[#52645a]">Legacy status snapshot loaded at {formatCheckedAt(data.generatedAt)}. No queue, inbox, or historical-message counts are presented as current readiness.</p>
          )}
        </div>
      </details>
    </div>
  );
}

function formatCheckedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unavailable";
  return new Intl.DateTimeFormat("en-CA", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Toronto",
  }).format(date);
}
