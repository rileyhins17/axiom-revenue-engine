"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";

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
      ? <Button type="button" variant="destructive" size="lg" disabled={busy} onClick={() => void change({ enabled: false, approveTemplate: false })} className="w-full">Turn automatic email off</Button>
      : templateApproved
        ? <Button type="button" size="lg" disabled={busy} onClick={() => void change({ enabled: true, approveTemplate: false })} className="w-full">Turn automatic email on</Button>
        : <Button type="button" size="lg" disabled={busy} onClick={() => void change({ enabled: false, approveTemplate: true })} className="w-full">Approve this email</Button>}
    {!ready ? <p className="text-xs font-medium text-[#7a5208]">Even when on, nothing sends until the Zoho mailbox is connected.</p> : null}
    {error ? <p role="alert" className="text-sm font-medium text-[#a1231b]">{error}</p> : null}
  </div>;
}
