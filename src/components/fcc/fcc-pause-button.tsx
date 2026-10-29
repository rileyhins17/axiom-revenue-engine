"use client";

import { Pause, Play } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";

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
      ? <Button type="button" variant="destructive" size="lg" disabled={busy} onClick={() => void submit()} className="w-full"><Pause aria-hidden="true" />Pause FCC emails</Button>
      : <Button type="button" size="lg" disabled={busy} onClick={() => void submit()} className="w-full"><Play aria-hidden="true" />Resume FCC emails</Button>}
    <p className="owner-meta">{action === "pause"
      ? "Stops FCC emails within a minute. Nothing else changes."
      : "Starts again at the next send time. Only FCC emails."}</p>
    {error ? <p role="alert" className="text-sm font-medium text-[#a1231b]">{error}</p> : null}
  </div>;
}
