"use client";

import { useEffect, useMemo, useState } from "react";
import { Power, RefreshCcw, ShieldAlert } from "lucide-react";
import { useRouter } from "next/navigation";

type EmergencyState = {
  emergencyPaused: boolean | null;
  emergencyPausedAt: string | null;
  emergencyPausedBy: string | null;
  emergencyPauseReason: string | null;
};

type Props = {
  compact?: boolean;
  initialState: EmergencyState;
};

export function EmergencyControlCard({ compact = false, initialState }: Props) {
  const router = useRouter();
  const [state, setState] = useState<EmergencyState>(initialState);
  const [note, setNote] = useState(initialState.emergencyPauseReason || "");
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  useEffect(() => {
    setState(initialState);
  }, [initialState]);

  const pausedAt = useMemo(() => formatDate(state.emergencyPausedAt), [state.emergencyPausedAt]);
  const paused = state.emergencyPaused === true;
  const unknown = state.emergencyPaused === null;
  const nextPaused = !paused;
  const title = unknown ? "Stop status could not be verified" : paused ? "Emergency stop is engaged" : "Emergency stop is not engaged";
  const description = unknown
    ? "The stop setting could not be read. Use the one-way action below to try to engage it; do not assume the system is stopped."
    : paused
      ? "The saved setting says the stop is on. Clearing it may allow eligible automation to resume on a later run."
      : "The saved setting says the stop is off. Engaging it requests a halt to autonomous intake, queueing, and sending. This does not verify provider status.";
  const buttonLabel = paused ? "Clear stop and allow resumption" : "Engage emergency stop";
  const buttonTone = paused
    ? "border-amber-300 bg-amber-50 text-amber-950 hover:bg-amber-100"
    : "border-rose-300 bg-rose-600 text-white hover:bg-rose-700";
  const shellTone = unknown
    ? "border-amber-200 bg-amber-50"
    : paused
      ? "border-rose-200 bg-rose-50"
      : "border-[#e4ebe2] bg-[#f6f8f3]";

  async function submitToggle() {
    setError(null);
    const confirmed = window.confirm(
      paused
        ? "Clear the emergency stop? Eligible automation may resume on a later run. Continue only if you intend to allow that."
        : unknown
          ? "Try to engage the emergency stop? The setting could not be verified, and this request may fail if the system cannot save the stop. It will not resume automation."
          : "Engage the emergency stop and request a halt to autonomous intake, queueing, and sending?",
    );
    if (!confirmed) {
      return;
    }

    setIsPending(true);
    try {
      const response = await fetch("/api/outreach/automation/emergency", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paused: nextPaused,
          note: note.trim() || undefined,
        }),
      });

      const payload = (await response.json()) as EmergencyState & { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Failed to update emergency stop");
      }
      if (typeof payload.emergencyPaused !== "boolean") {
        throw new Error("The system did not confirm the stop setting. Refresh and verify its state.");
      }

      setState({
        emergencyPaused: Boolean(payload.emergencyPaused),
        emergencyPausedAt: payload.emergencyPausedAt || null,
        emergencyPausedBy: payload.emergencyPausedBy || null,
        emergencyPauseReason: payload.emergencyPauseReason || null,
      });
      setNote(payload.emergencyPauseReason || "");
      router.refresh();
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Failed to update emergency stop");
    } finally {
      setIsPending(false);
    }
  }

  return (
    <div className={`overflow-hidden rounded-2xl border ${shellTone}`}>
      <div className={compact ? "p-4" : "p-5"}>
        <div className={`flex ${compact ? "flex-col gap-3 sm:flex-row sm:items-center sm:justify-between" : "flex-col gap-4 lg:flex-row lg:items-start lg:justify-between"}`}>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${unknown ? "bg-amber-100 text-amber-950" : paused ? "bg-rose-100 text-rose-900" : "bg-white text-[#536b5b] ring-1 ring-inset ring-[#dce5da]"}`}>
                <ShieldAlert className="size-3.5" aria-hidden="true" />
                {unknown ? "Could not verify" : paused ? "Stop is on" : "Stop is off"}
              </span>
            </div>
            <h3 className="mt-3 text-base font-semibold text-[#294333]">{title}</h3>
            <p className="mt-1 text-sm leading-6 text-[#586d60]">{description}</p>
            {paused ? (
              <div className="mt-3 space-y-1 text-xs text-[#566a5d]">
                <div>Paused at {pausedAt}</div>
                <div>{state.emergencyPausedBy || "Set by system"}</div>
                {state.emergencyPauseReason ? <div>Reason: {state.emergencyPauseReason}</div> : null}
              </div>
            ) : null}
          </div>

          <div className={compact ? "flex items-center gap-2" : "flex flex-col gap-2 sm:flex-row sm:items-center"}>
            <button
              type="button"
              onClick={submitToggle}
              disabled={isPending}
              className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border px-4 py-2 text-sm font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#176443] disabled:cursor-not-allowed disabled:opacity-60 ${buttonTone}`}
            >
              <Power className="size-4" aria-hidden="true" />
              {buttonLabel}
            </button>
            <button
              type="button"
              onClick={() => router.refresh()}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-[#dce5da] bg-white px-4 py-2 text-sm font-semibold text-[#40594a] transition hover:bg-[#f6f8f3] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#176443]"
            >
              <RefreshCcw className="size-4" aria-hidden="true" />
              Check again
            </button>
          </div>
        </div>

        {!compact ? (
          <div className="mt-4 space-y-3">
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-[#586d60]">Optional note for the record</span>
              <textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Why are you engaging or clearing the stop?"
                className="min-h-[76px] w-full resize-y rounded-xl border border-[#dce5da] bg-white px-3 py-2.5 text-sm text-[#294333] outline-none transition placeholder:text-[#86948a] focus:border-[#176443] focus:ring-2 focus:ring-[#176443]/20"
              />
            </label>
            <div className="text-xs leading-5 text-[#566a5d]">
              {paused
                ? "Clearing the stop only changes this control. It does not verify providers, permissions, or readiness."
                : "Engaging the stop does not delete records. It requests that autonomous work stop; verify the saved state after the request."}
            </div>
          </div>
        ) : null}

        {error ? <div className="mt-3 rounded-lg border border-rose-200 bg-white px-3 py-2 text-sm text-rose-900" role="alert">{error}</div> : null}
      </div>
    </div>
  );
}

function formatDate(value: string | null) {
  if (!value) {
    return "—";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-CA", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}
