"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Reason = "WEBSITE_ALREADY_FINE" | "NOT_LOCAL_OR_CHAIN" | "WRONG_TRADE" | "ALREADY_A_CUSTOMER_OR_CONTACTED" | "OTHER";
const REASONS: { value: Reason; label: string }[] = [
  { value: "WEBSITE_ALREADY_FINE", label: "Website is fine" },
  { value: "NOT_LOCAL_OR_CHAIN", label: "Not local / a chain" },
  { value: "WRONG_TRADE", label: "Wrong trade" },
  { value: "ALREADY_A_CUSTOMER_OR_CONTACTED", label: "Already know them" },
  { value: "OTHER", label: "Other" },
];

/** Two-tap owner decision. Retries reuse the same key, so a lost response cannot double-save. */
export function ProspectDecisionButtons({ websiteUrl }: { websiteUrl: string }) {
  const router = useRouter();
  const [commandId] = useState(() => crypto.randomUUID());
  const [choosingReason, setChoosingReason] = useState(false);
  const [state, setState] = useState<"IDLE" | "SAVING" | "ERROR">("IDLE");
  const [error, setError] = useState<string | null>(null);

  async function send(decision: "WORTH_A_CALL" | "NOT_A_FIT", reason: Reason | null) {
    setState("SAVING");
    setError(null);
    try {
      const response = await fetch("/api/leads/engine-prospects/decisions", {
        method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" },
        body: JSON.stringify({ commandId, websiteUrl, decision, reason }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? "The decision could not be saved.");
      }
      router.refresh();
    } catch (caught) {
      setState("ERROR");
      setError(caught instanceof Error ? caught.message : "The decision could not be saved.");
    }
  }

  const busy = state === "SAVING";
  return <div className="mt-3 space-y-2">
    {choosingReason ? <div className="flex flex-wrap gap-2" role="group" aria-label="Why is it not a fit?">
      {REASONS.map((reason) => <button key={reason.value} type="button" disabled={busy} onClick={() => void send("NOT_A_FIT", reason.value)}
        className="rounded-full border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50">{reason.label}</button>)}
      <button type="button" disabled={busy} onClick={() => setChoosingReason(false)} className="px-2 py-1.5 text-xs text-muted-foreground underline">Back</button>
    </div> : <div className="flex flex-wrap gap-2">
      <button type="button" disabled={busy} onClick={() => void send("WORTH_A_CALL", null)}
        className="rounded-lg bg-emerald-700 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50">Worth a call</button>
      <button type="button" disabled={busy} onClick={() => setChoosingReason(true)}
        className="rounded-lg border border-border px-3 py-2 text-sm font-semibold hover:bg-muted disabled:opacity-50">Not a fit</button>
    </div>}
    {error ? <p role="alert" className="text-xs text-rose-700">{error}</p> : null}
  </div>;
}
