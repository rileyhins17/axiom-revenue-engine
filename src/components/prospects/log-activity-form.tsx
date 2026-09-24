"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const OUTCOMES = [
  { value: "NO_ANSWER", label: "No answer" },
  { value: "VOICEMAIL", label: "Left voicemail" },
  { value: "GATEKEEPER", label: "Talked to staff" },
  { value: "CALL_BACK", label: "Call back later" },
  { value: "INTERESTED", label: "Interested" },
  { value: "MEETING_BOOKED", label: "Meeting booked" },
  { value: "NOT_INTERESTED", label: "Not interested" },
  { value: "WON", label: "Won" },
  { value: "WRONG_NUMBER", label: "Wrong number" },
  { value: "DO_NOT_CONTACT", label: "Do not contact" },
] as const;

/** Log a call or visit in a few taps. Retries reuse one key, so nothing double-saves. */
export function LogActivityForm({ prospectId, defaultChannel = "CALL" }: { prospectId: string; defaultChannel?: "CALL" | "VISIT" }) {
  const router = useRouter();
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [channel, setChannel] = useState<"CALL" | "VISIT">(defaultChannel);
  const [outcome, setOutcome] = useState<string>("");
  const [note, setNote] = useState("");
  const [followUpAt, setFollowUpAt] = useState("");
  const [state, setState] = useState<"IDLE" | "SAVING" | "SAVED">("IDLE");
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!outcome) { setError("Pick what happened."); return; }
    setState("SAVING"); setError(null);
    try {
      const response = await fetch("/api/prospects/activity", {
        method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" },
        body: JSON.stringify({ idempotencyKey: key, prospectId, channel, outcome, note, followUpAt: followUpAt || null }),
      });
      if (!response.ok) throw new Error(((await response.json().catch(() => ({}))) as { error?: string }).error ?? "Could not save.");
      setState("SAVED"); setKey(crypto.randomUUID()); setOutcome(""); setNote(""); setFollowUpAt("");
      router.refresh();
    } catch (caught) {
      setState("IDLE"); setError(caught instanceof Error ? caught.message : "Could not save.");
    }
  }

  return <div className="mt-3 space-y-3 rounded-lg border border-slate-200 p-3">
    <div className="flex gap-2" role="group" aria-label="Call or visit">
      {(["CALL", "VISIT"] as const).map((value) => <button key={value} type="button" onClick={() => setChannel(value)} aria-pressed={channel === value}
        className={`rounded-md px-3 py-1.5 text-sm font-medium ${channel === value ? "bg-slate-900 text-white" : "border border-slate-300"}`}>{value === "CALL" ? "Call" : "Visit"}</button>)}
    </div>
    <div className="flex flex-wrap gap-2" role="group" aria-label="What happened">
      {OUTCOMES.map((option) => <button key={option.value} type="button" onClick={() => setOutcome(option.value)} aria-pressed={outcome === option.value}
        className={`rounded-full px-3 py-1.5 text-xs font-medium ${outcome === option.value ? (option.value === "DO_NOT_CONTACT" ? "bg-rose-700 text-white" : "bg-emerald-700 text-white") : "border border-slate-300"}`}>{option.label}</button>)}
    </div>
    <label className="block text-xs font-medium">Notes
      <textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={1000} rows={2}
        placeholder="Who you spoke to, what they said, what to do next" className="mt-1 w-full rounded-md border border-slate-300 bg-white p-2 text-sm" />
    </label>
    <label className="block text-xs font-medium">Follow up on (optional)
      <input type="date" value={followUpAt} onChange={(event) => setFollowUpAt(event.target.value)} className="mt-1 block rounded-md border border-slate-300 bg-white p-2 text-sm" />
    </label>
    <div className="flex items-center gap-3">
      <button type="button" onClick={() => void save()} disabled={state === "SAVING"}
        className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{state === "SAVING" ? "Saving…" : "Save"}</button>
      {state === "SAVED" ? <span className="text-xs text-emerald-700">Saved</span> : null}
      {error ? <span role="alert" className="text-xs text-rose-700">{error}</span> : null}
    </div>
  </div>;
}
