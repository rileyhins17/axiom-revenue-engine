"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function EmailSwitch({ enabled, templateApproved, ready }: { enabled: boolean; templateApproved: boolean; ready: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function change(next: { enabled: boolean; approveTemplate: boolean }) {
    setBusy(true); setError(null);
    try {
      const response = await fetch("/api/email/settings", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(next) });
      if (!response.ok) throw new Error(((await response.json().catch(() => ({}))) as { error?: string }).error ?? "Could not save.");
      router.refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not save."); } finally { setBusy(false); }
  }
  return <div className="space-y-2">
    {enabled
      ? <button type="button" disabled={busy} onClick={() => void change({ enabled: false, approveTemplate: false })} className="w-full rounded-lg bg-rose-700 px-4 py-2.5 font-semibold text-white hover:bg-rose-800 disabled:opacity-50">Turn automatic email OFF</button>
      : templateApproved
        ? <button type="button" disabled={busy} onClick={() => void change({ enabled: true, approveTemplate: false })} className="w-full rounded-lg bg-emerald-700 px-4 py-2.5 font-semibold text-white hover:bg-emerald-800 disabled:opacity-50">Turn automatic email ON</button>
        : <button type="button" disabled={busy} onClick={() => void change({ enabled: false, approveTemplate: true })} className="w-full rounded-lg bg-slate-900 px-4 py-2.5 font-semibold text-white hover:bg-slate-800 disabled:opacity-50">Approve this email</button>}
    {!ready ? <p className="text-xs text-amber-800">Even when on, nothing sends until the Zoho mailbox is connected.</p> : null}
    {error ? <p role="alert" className="text-sm text-rose-700">{error}</p> : null}
  </div>;
}
