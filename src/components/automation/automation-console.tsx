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
    <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-5">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-white/[0.08] pb-5">
        <div className="min-w-0">
          <p className="v2-eyebrow">Axiom owner workspace</p>
          <h1 className="page-header-title mt-1">Outreach</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">
            Research and owner-reviewed manual work. This page does not send email, and no email provider or reply route is cleared for use.
          </p>
        </div>
        <button
          type="button"
          onClick={refresh}
          disabled={refreshing}
          className="v2-btn-ghost v2-focus-ring inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
        >
          <RefreshCw className={`size-4 ${refreshing ? "animate-spin" : ""}`} aria-hidden="true" />
          Refresh status
        </button>
      </header>

      {data === null ? (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-300/25 bg-amber-300/[0.08] p-4 sm:p-5" role="alert" aria-live="polite">
          <ShieldAlert className="mt-0.5 size-5 shrink-0 text-amber-300" aria-hidden="true" />
          <div>
            <h2 className="text-sm font-semibold text-amber-100">Some status could not be verified</h2>
            <p className="mt-1 text-sm leading-6 text-amber-100/75">
              The legacy system status did not load. This notice does not pause the live system. Check the emergency stop before any external work.
            </p>
          </div>
        </div>
      ) : null}

      <section aria-label="Outreach owner guidance" className="rounded-[28px] bg-[#f6f8f3] p-4 text-[#263a2f] shadow-xl shadow-black/10 sm:p-6 lg:p-8">
        <div className="mx-auto max-w-[1040px]">
          <div className="flex flex-col gap-5 border-b border-[#dfe7dd] pb-6 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <span className="inline-flex items-center gap-2 rounded-full bg-[#e8f2e9] px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-[#315b43]">
                <Check className="size-3.5" aria-hidden="true" />
                Manual-first
              </span>
              <h2 className="mt-4 max-w-3xl text-2xl font-semibold tracking-tight text-[#24382d] sm:text-3xl">
                Start with the business, not the inbox.
              </h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-[#586d60]">
                Review what is known, decide whether an opportunity is real, and choose a human next step. A public contact detail alone is not approval to reach out.
              </p>
            </div>
            <div className="rounded-2xl bg-white px-4 py-3 ring-1 ring-inset ring-[#dfe7dd] sm:min-w-56">
              <p className="text-xs font-semibold uppercase tracking-[0.1em] text-[#53675a]">Current work</p>
              <p className="mt-1 text-sm font-semibold text-[#294333]">Research and manual review</p>
            </div>
          </div>

          <div className="mt-5 grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
            <section aria-labelledby="outreach-next-step" className="rounded-2xl bg-[#e5f1e7] p-5 ring-1 ring-inset ring-[#d3e6d7] sm:p-6">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#537262]">Your next step</p>
              <h3 id="outreach-next-step" className="mt-2 text-xl font-semibold text-[#263a2f]">Review the business evidence</h3>
              <p className="mt-2 max-w-xl text-sm leading-6 text-[#4e6958]">
                The proposed ten are evaluation candidates, not an approved calling list. Check the current status and decide which business deserves more research.
              </p>
              {canOpenBusinessReview ? (
                <Link href="/leads/m2" className="mt-5 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#176443] px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#125638] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#176443]">
                  Open Business Review <ArrowRight className="size-4" aria-hidden="true" />
                </Link>
              ) : (
                <p className="mt-5 rounded-xl bg-white px-4 py-3 text-sm font-medium text-[#53675a]">An admin owner needs to open Business Review.</p>
              )}
            </section>

            <section aria-labelledby="outreach-mail-status" className="rounded-2xl bg-white p-5 ring-1 ring-inset ring-[#e4ebe2] sm:p-6">
              <div className="flex items-start gap-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-amber-50 text-amber-800">
                  <Mail className="size-5" aria-hidden="true" />
                </span>
                <div>
                  <h3 id="outreach-mail-status" className="text-base font-semibold text-[#263a2f]">Mail route not verified</h3>
                  <p className="mt-2 text-sm leading-6 text-[#5b7063]">
                    No paid inbox is assumed. Forwarding to owner inboxes and a working reply path have not been proven.
                  </p>
                </div>
              </div>
              <details className="group mt-4 rounded-xl bg-[#f6f8f5] px-4 py-3 text-sm text-[#4e6958]">
                <summary className="cursor-pointer font-semibold text-[#315b43] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#176443]">
                  What still needs checking?
                </summary>
                <p className="mt-3 leading-6">
                  Active Cloudflare forwarding destinations are unverified. A Resend account, verified sender, and owner-reply round trip are also unverified. Email remains unavailable for this workflow until the required owner and safety checks are completed.
                </p>
              </details>
            </section>

            <section aria-labelledby="outreach-manual-work" className="rounded-2xl bg-white p-5 ring-1 ring-inset ring-[#e4ebe2] sm:p-6">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#53675a]">Human-owned follow-through</p>
              <h3 id="outreach-manual-work" className="mt-2 text-base font-semibold text-[#263a2f]">Calls, forms, replies, and follow-ups stay with an owner.</h3>
              <p className="mt-2 text-sm leading-6 text-[#5b7063]">
                Review the business and its evidence first. If a real conversation or client action needs attention, open the client board and assign the next step there.
              </p>
              <Link href="/clients" className="mt-4 inline-flex min-h-10 items-center gap-2 text-sm font-semibold text-[#176443] hover:text-[#104c32] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#176443]">
                Open client follow-ups <ArrowRight className="size-4" aria-hidden="true" />
              </Link>
            </section>

            <section aria-labelledby="outreach-stop" className="rounded-2xl bg-white p-5 ring-1 ring-inset ring-[#e4ebe2] sm:p-6">
              <div className="flex items-start gap-3">
                <span className={`grid size-10 shrink-0 place-items-center rounded-xl ${emergencyPaused ? "bg-rose-50 text-rose-800" : "bg-[#f6f8f5] text-[#53645b]"}`}>
                  {emergencyPaused ? <ShieldAlert className="size-5" aria-hidden="true" /> : <ShieldCheck className="size-5" aria-hidden="true" />}
                </span>
                <div className="min-w-0 flex-1">
                  <h3 id="outreach-stop" className="text-base font-semibold text-[#263a2f]">Emergency stop</h3>
                  <p className={`mt-2 text-sm font-semibold ${emergencyPaused === null ? "text-amber-800" : emergencyPaused ? "text-rose-800" : "text-[#315b43]"}`}>
                    {emergencyPaused === null ? "Could not verify the current stop status" : emergencyPaused ? "On · new automated work is reported stopped" : "Not active at the last successful status check"}
                  </p>
                  {data === null ? <p className="mt-1 text-xs leading-5 text-[#566a5d]">A status failure does not pause the live system. Use Stop everything to request the existing emergency stop.</p> : null}
                  {stopError ? <p className="mt-2 text-sm text-rose-800" role="alert">{stopError}</p> : null}
                  {!canControlEmergencyStop ? (
                    <p className="mt-3 text-sm leading-6 text-[#566a5d]">Only an admin owner can change the emergency stop. Ask an admin to verify or engage it before external work.</p>
                  ) : emergencyPaused ? (
                    <Link href="/settings" className="mt-3 inline-flex min-h-10 items-center gap-2 text-sm font-semibold text-[#176443] hover:text-[#104c32] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#176443]">
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
          </div>

          <p className="mt-5 text-xs leading-5 text-[#566a5d]">Status last checked: {data ? formatCheckedAt(data.generatedAt) : "Unavailable"}. This owner page does not authorize contact or change provider settings.</p>
        </div>
      </section>

      <details className="group overflow-hidden rounded-2xl border border-white/[0.09] bg-white/[0.025]">
        <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 text-sm font-semibold text-zinc-300 hover:bg-white/[0.035] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400">
          <span>Legacy email system details</span>
          <span className="text-right text-xs font-normal text-zinc-500">Quarantined · not proof of provider readiness</span>
        </summary>
        <div className="border-t border-white/[0.08] px-5 py-4">
          <p className="text-sm leading-6 text-zinc-300">
            Earlier email and inbox records may be useful for historical reconciliation. They do not establish current inbox access, sender verification, permission to contact, or a working reply route. Sending, intake, queue, inbox-reactivation, and enable controls are intentionally not exposed in this Outreach view.
          </p>
          {data === null ? (
            <p className="mt-3 text-sm font-medium text-amber-200">Legacy records could not be loaded; no counts are shown.</p>
          ) : (
            <p className="mt-3 text-sm text-zinc-400">Legacy status snapshot loaded at {formatCheckedAt(data.generatedAt)}. No queue, inbox, or historical-message counts are presented as current readiness.</p>
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
