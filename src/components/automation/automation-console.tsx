"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Mail, RefreshCw, ShieldAlert, ShieldCheck } from "lucide-react";

import type { AutomationOperatorConsoleData } from "@/lib/automation-operator-view";

type Props = {
  data: AutomationOperatorConsoleData | null;
  canControlEmergencyStop: boolean;
};

export function AutomationConsole({ data, canControlEmergencyStop }: Props) {
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
    <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-6 text-[#172c25]">
      <header className="flex flex-col gap-4 border-b border-[#dfe7df] pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#426e58]">Axiom Web · Owner workspace</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-[-0.035em] text-[#172c25] sm:text-4xl">Follow-through</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[#52665a]">
            Track client follow-ups and check operational readiness.
          </p>
        </div>
        <button
          type="button"
          onClick={refresh}
          disabled={refreshing}
          className="inline-flex min-h-10 items-center justify-center gap-2 self-start rounded-lg border border-[#d7e1d8] bg-white px-4 text-sm font-semibold text-[#315b43] transition hover:bg-[#f1f5ef] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#197255] disabled:cursor-not-allowed disabled:opacity-60 sm:self-auto"
        >
          <RefreshCw className={`size-4 ${refreshing ? "animate-spin" : ""}`} aria-hidden="true" />
          Refresh status
        </button>
      </header>

      {data === null ? (
        <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-[#fff9ed] px-4 py-3 text-sm text-[#634f2e]" role="alert" aria-live="polite">
          <ShieldAlert className="mt-0.5 size-5 shrink-0 text-amber-700" aria-hidden="true" />
          <div>
            <h2 className="font-semibold">System status could not be checked</h2>
            <p className="mt-1 leading-6">
              This does not turn on the stop. Check the status below before any external work.
            </p>
          </div>
        </div>
      ) : null}

      <section aria-label="Follow-through actions" className="grid gap-4 lg:grid-cols-2">
        <section aria-labelledby="follow-through-stop" className="rounded-[22px] border border-[#dfe7df] bg-white p-5 sm:p-6">
          <div className="flex items-start gap-3">
            <span className={`grid size-10 shrink-0 place-items-center rounded-xl ${emergencyPaused ? "bg-[#f4ece6] text-[#805a3b]" : "bg-[#edf4ee] text-[#286047]"}`}>
              {emergencyPaused ? <ShieldAlert className="size-5" aria-hidden="true" /> : <ShieldCheck className="size-5" aria-hidden="true" />}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#566a5b]">System status</p>
              <h2 id="follow-through-stop" className="mt-1 text-lg font-semibold tracking-tight text-[#20372b]">Automation stop</h2>
              <p className={`mt-2 text-sm leading-5 ${emergencyPaused === null ? "text-amber-800" : "text-[#52665a]"}`}>
                {emergencyPaused === null
                  ? "Stop status could not be checked."
                  : emergencyPaused
                    ? "On. New automated intake, queueing, and sending are reported stopped."
                    : "Off at the last successful check."}
              </p>
              {data === null ? <p className="mt-2 text-xs leading-5 text-[#566a5b]">A failed status check does not stop activity. An admin owner can request the stop below.</p> : null}
              {stopError ? <p className="mt-2 text-sm text-rose-800" role="alert">{stopError}</p> : null}
              {!canControlEmergencyStop ? (
                <p className="mt-3 text-sm leading-6 text-[#566a5b]">Only an admin owner can turn on or verify the stop before external work.</p>
              ) : emergencyPaused ? (
                <Link href="/settings" className="mt-3 inline-flex min-h-10 items-center gap-2 text-sm font-semibold text-[#12573f] hover:text-[#0f4834] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#197255]">
                  Review stop settings <ArrowRight className="size-4" aria-hidden="true" />
                </Link>
              ) : (
                <button
                  type="button"
                  onClick={() => void stopExternalWork()}
                  disabled={stopPending}
                  className="mt-3 inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-[#d7e1d8] bg-[#f7f8f5] px-4 text-sm font-semibold text-[#315b43] transition hover:bg-[#edf3ed] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#197255] disabled:cursor-wait disabled:opacity-60"
                >
                  <ShieldAlert className="size-4" aria-hidden="true" />
                  {stopPending ? "Turning on stop…" : "Stop new automated work"}
                </button>
              )}
            </div>
          </div>
        </section>

        <section aria-labelledby="follow-through-clients" className="flex flex-col justify-between gap-4 rounded-[22px] border border-[#dfe7df] bg-white p-5 sm:flex-row sm:items-center sm:p-6">
          <div className="max-w-xl">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#566a5b]">Client work</p>
            <h2 id="follow-through-clients" className="mt-1 text-lg font-semibold tracking-tight text-[#20372b]">Client follow-ups</h2>
            <p className="mt-1 text-sm leading-6 text-[#52665a]">Calls, forms, replies, and agreed next steps stay with an owner. Record the next step on the client board.</p>
          </div>
          <Link href="/clients" className="inline-flex min-h-10 shrink-0 items-center gap-2 text-sm font-semibold text-[#12573f] hover:text-[#0f4834] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#197255]">
            Open client follow-ups <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        </section>

        <section aria-labelledby="follow-through-email" className="rounded-[22px] border border-[#e8e1cf] bg-[#fffaf0] p-5 sm:p-6">
          <div className="flex items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#f6efd9] text-[#7b6230]">
              <Mail className="size-5" aria-hidden="true" />
            </span>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#79663c]">Not ready to use</p>
              <h2 id="follow-through-email" className="mt-1 text-lg font-semibold tracking-tight text-[#3c372a]">Email is not ready</h2>
              <p className="mt-2 text-sm leading-6 text-[#675f4b]">The owner inbox and reply path are not verified, so email is unavailable.</p>
            </div>
          </div>
          <details className="group mt-4 rounded-xl border border-[#e8e1cf] bg-white/75 px-4 py-3 text-sm text-[#5e5948]">
            <summary className="cursor-pointer font-semibold text-[#5a523d] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#197255]">What still needs checking?</summary>
            <p className="mt-3 leading-6">Active forwarding, a verified sender, and a successful owner reply path have not been confirmed. Email stays unavailable until those checks and the required safety reviews are complete.</p>
            <p className="mt-2 text-xs leading-5 text-[#6f6855]">This page cannot send email.</p>
          </details>
        </section>
      </section>

      <p className="text-xs leading-5 text-[#566a5b]">Status last checked: {data ? formatCheckedAt(data.generatedAt) : "Unavailable"}</p>

      <details className="group overflow-hidden rounded-xl border border-[#dfe7df] bg-white">
        <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-semibold text-[#385344] hover:bg-[#f6f8f4] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#197255] sm:px-5">
          <span>Older system records</span>
          <span className="text-right text-xs font-normal text-[#566a5b]">For owner review only</span>
        </summary>
        <div className="border-t border-[#e6ebe4] px-4 py-4 sm:px-5">
          <p className="text-sm leading-6 text-[#58695f]">
            Earlier email and inbox records do not establish current inbox access, sender verification, permission to contact, or a working reply route. This page does not expose sending, intake, queue, inbox-reactivation, or enable controls.
          </p>
          {data === null ? (
            <p className="mt-3 text-sm font-medium text-amber-800">Older records could not be loaded; no counts are shown.</p>
          ) : (
            <p className="mt-3 text-sm text-[#566a5b]">Last checked {formatCheckedAt(data.generatedAt)} · these records do not confirm current email readiness.</p>
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
