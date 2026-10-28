"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { celebrate } from "@/components/motion/celebrate";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

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
      if (outcome === "INTERESTED" || outcome === "MEETING_BOOKED" || outcome === "WON") celebrate();
      setState("SAVED"); setKey(crypto.randomUUID()); setOutcome(""); setNote(""); setFollowUpAt("");
      router.refresh();
    } catch (caught) {
      setState("IDLE"); setError(caught instanceof Error ? caught.message : "Could not save.");
    }
  }

  return <div className="space-y-3 rounded-xl border border-[#e6e1d6] bg-[#faf7f0] p-4">
    <div className="flex gap-2" role="group" aria-label="Call or visit">
      {(["CALL", "VISIT"] as const).map((value) => <button key={value} type="button" onClick={() => setChannel(value)} aria-pressed={channel === value}
        className="owner-chip">{value === "CALL" ? "Call" : "Visit"}</button>)}
    </div>
    <div className="flex flex-wrap gap-2" role="group" aria-label="What happened">
      {OUTCOMES.map((option) => <button key={option.value} type="button" onClick={() => setOutcome(option.value)} aria-pressed={outcome === option.value}
        className={cn("owner-chip", option.value === "DO_NOT_CONTACT" && outcome === option.value && "!border-[#a1231b] !bg-[#a1231b] !text-white")}>{option.label}</button>)}
    </div>
    <label className="block text-xs font-medium">Notes
      <textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={1000} rows={2}
        placeholder="Who you spoke to, what they said, what to do next" className="mt-1 w-full rounded-xl border border-[#d9d2c3] bg-[#fffdf8] p-2.5 text-sm" />
    </label>
    <label className="block text-xs font-medium">Follow up on (optional)
      <input type="date" value={followUpAt} onChange={(event) => setFollowUpAt(event.target.value)} className="mt-1 block h-10 rounded-xl border border-[#d9d2c3] bg-[#fffdf8] px-3 text-sm" />
    </label>
    <div className="flex items-center gap-3">
      <Button type="button" onClick={() => void save()} disabled={state === "SAVING"}>{state === "SAVING" ? "Saving…" : "Save"}</Button>
      {state === "SAVED" ? <span className="text-xs font-semibold text-[#1f6b45]">Saved</span> : null}
      {error ? <span role="alert" className="text-xs font-medium text-[#a1231b]">{error}</span> : null}
    </div>
  </div>;
}
