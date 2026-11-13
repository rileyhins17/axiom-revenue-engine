"use client";

import { Pause } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";

/**
 * FCC ended on Nov 12, 2026, so the archive has one control and it only stops things: Pause, shown only if FCC
 * sending is ever found switched on. There is no Resume button on the screen.
 */
export function FccPauseButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit() {
    setBusy(true); setError(null);
    try {
      const response = await fetch("/api/fcc/control", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "pause" }) });
      if (!response.ok) throw new Error(((await response.json().catch(() => ({}))) as { error?: string }).error ?? "Could not save.");
      router.refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not save."); } finally { setBusy(false); }
  }
  return <div className="space-y-2">
    <Button type="button" variant="destructive" size="lg" disabled={busy} onClick={() => void submit()} className="w-full sm:w-auto"><Pause aria-hidden="true" />Pause FCC emails</Button>
    {error ? <p role="alert" className="text-sm font-medium" style={{ color: "var(--owner-danger)" }}>{error}</p> : null}
  </div>;
}
