"use client";

import { Pause, Play } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

/** The one control on the FCC screen. It only ever touches FCC emails. */
export function FccPauseButton({ state }: { state: "live" | "paused" }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const action = state === "live" ? "pause" : "resume";
  async function submit() {
    setBusy(true); setError(null);
    try {
      const response = await fetch("/api/fcc/control", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) });
      if (!response.ok) throw new Error(((await response.json().catch(() => ({}))) as { error?: string }).error ?? "Could not save.");
      router.refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not save."); } finally { setBusy(false); }
  }
  return <div className="space-y-2">
    {action === "pause"
      ? <button type="button" disabled={busy} onClick={() => void submit()} className="flex w-full items-center justify-center gap-2 rounded-xl bg-rose-700 px-5 py-4 text-lg font-semibold text-white hover:bg-rose-800 disabled:opacity-50"><Pause className="size-5" aria-hidden="true" />Pause FCC emails</button>
      : <button type="button" disabled={busy} onClick={() => void submit()} className="owner-cta flex w-full items-center justify-center gap-2 rounded-xl px-5 py-4 text-lg font-semibold disabled:opacity-50"><Play className="size-5" aria-hidden="true" />Resume FCC emails</button>}
    <p className="text-xs text-slate-600">{action === "pause"
      ? "Stops FCC emails within a minute. Nothing else changes."
      : "Starts again at the next send time. Only FCC emails."}</p>
    {error ? <p role="alert" className="text-sm text-rose-700">{error}</p> : null}
  </div>;
}
