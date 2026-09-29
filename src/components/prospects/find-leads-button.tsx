"use client";

import { Radar } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { celebrate } from "@/components/motion/celebrate";
import { useToast } from "@/components/ui/toast-provider";

/** One click: the server searches Google for a few more businesses to call. */
export function FindLeadsButton({ className = "" }: { className?: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  async function run() {
    setBusy(true);
    try {
      const response = await fetch("/api/leads/discover", { method: "POST", credentials: "same-origin" });
      const body = await response.json().catch(() => ({})) as { added?: number; held?: number; stopReason?: string | null; error?: string };
      if (!response.ok && !body.added) { toast(body.stopReason ?? body.error ?? "Couldn't search right now.", { type: "warning", duration: 5000 }); return; }
      if (body.added) { celebrate(); toast(`${body.added} new business${body.added === 1 ? "" : "es"} to call`, { duration: 4000 }); }
      else toast(body.stopReason ?? "No new businesses this time. The search moves on to other towns next run.", { type: "info", duration: 5000 });
      router.refresh();
    } finally { setBusy(false); }
  }
  return <button type="button" onClick={() => void run()} disabled={busy}
    className={`owner-cta inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-60 ${className}`}>
    <Radar className={`size-4 ${busy ? "animate-spin" : ""}`} aria-hidden="true" />{busy ? "Searching Google…" : "Find new leads now"}
  </button>;
}
