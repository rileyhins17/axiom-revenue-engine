"use client";

import { useEffect, useMemo, useState } from "react";
import { Power, RefreshCcw } from "lucide-react";
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
  const buttonLabel = paused ? "Clear stop and allow resumption" : "Engage emergency stop";
  const buttonTone = paused
    ? "border-amber-300 bg-amber-50 text-amber-950 hover:bg-amber-100"
    : "border-rose-300 bg-rose-600 text-white hover:bg-rose-700";
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
    <div className="space-y-3">
      {paused ? (
        <div className="space-y-1 text-sm leading-5 text-[#586d60]">
          <p>Clearing the stop may allow eligible automation to resume on a later run.</p>
          {state.emergencyPauseReason ? <p><span className="font-medium">Stop reason:</span> {state.emergencyPauseReason}</p> : null}
        </div>
      ) : unknown ? (
        <p className="text-sm leading-5 text-[#634c2a]">The stop could not be checked. This action only tries to engage it; do not assume the system is stopped.</p>
      ) : (
        <p className="text-sm leading-5 text-[#586d60]">Engaging the stop requests a halt to autonomous intake, queueing, and sending.</p>
      )}

      <div className="flex flex-col gap-2 sm:flex-row">
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

      {!compact ? (
        <details className="rounded-lg border border-[#e1e5dc] bg-white px-3 py-2">
          <summary className="cursor-pointer text-sm font-medium text-[#40594a]">Stop record and optional note</summary>
          <div className="mt-3 space-y-3">
            {paused ? (
              <dl className="grid gap-1 text-xs leading-5 text-[#566a5d] sm:grid-cols-2">
                <div><dt className="inline font-medium">Paused at: </dt><dd className="inline">{pausedAt}</dd></div>
                <div><dt className="inline font-medium">Set by: </dt><dd className="inline">{state.emergencyPausedBy || "System"}</dd></div>
              </dl>
            ) : null}
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-[#586d60]">Optional note for the record</span>
              <textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Why are you engaging or clearing the stop?"
                className="min-h-[76px] w-full resize-y rounded-xl border border-[#dce5da] bg-white px-3 py-2.5 text-sm text-[#294333] outline-none transition placeholder:text-[#86948a] focus:border-[#176443] focus:ring-2 focus:ring-[#176443]/20"
              />
            </label>
            <p className="text-xs leading-5 text-[#566a5d]">
              {paused
                ? "Clearing the stop only changes this control. It does not verify providers, permissions, or readiness."
                : "Engaging the stop does not delete records. Verify the saved state after the request."}
            </p>
          </div>
        </details>
      ) : null}

      {error ? <div className="rounded-lg border border-rose-200 bg-white px-3 py-2 text-sm text-rose-900" role="alert">{error}</div> : null}
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
