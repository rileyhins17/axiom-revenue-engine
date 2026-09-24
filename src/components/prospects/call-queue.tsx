"use client";

import { Check, ChevronRight, Copy, ExternalLink, MapPin, Phone, SkipForward } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

export type QueueBusiness = {
  prospectId: string; name: string; city: string; niche: string; label: "STRONG" | "WEAK" | "NO_WEBSITE";
  reasons: string[]; phone: string; address: string | null; websiteUrl: string | null; mapsUrl: string;
  attempts: number; followUpAt: string | null;
  history: { id: string; when: string; who: string; what: string; note: string }[];
};

const OUTCOMES = [
  { value: "NO_ANSWER", label: "No answer", key: "1", tone: "neutral" },
  { value: "VOICEMAIL", label: "Voicemail", key: "2", tone: "neutral" },
  { value: "GATEKEEPER", label: "Talked to staff", key: "3", tone: "neutral" },
  { value: "CALL_BACK", label: "Call back", key: "4", tone: "warm" },
  { value: "INTERESTED", label: "Interested", key: "5", tone: "good" },
  { value: "MEETING_BOOKED", label: "Meeting booked", key: "6", tone: "good" },
  { value: "WON", label: "Won", key: "7", tone: "good" },
  { value: "NOT_INTERESTED", label: "Not interested", key: "8", tone: "bad" },
  { value: "WRONG_NUMBER", label: "Wrong number", key: "9", tone: "bad" },
  { value: "DO_NOT_CONTACT", label: "Do not contact", key: "0", tone: "stop" },
] as const;
type Outcome = (typeof OUTCOMES)[number]["value"];
const NEEDS_DATE = new Set<Outcome>(["CALL_BACK", "INTERESTED"]);

const title = (value: string) => value === "HVAC" ? value : value.charAt(0) + value.slice(1).toLowerCase();
function inDays(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  if (date.getDay() === 6) date.setDate(date.getDate() + 2);
  if (date.getDay() === 0) date.setDate(date.getDate() + 1);
  return date.toLocaleDateString("en-CA");
}

/** A short, honest opener built only from what the engine observed on the site. */
function opener(business: QueueBusiness, caller: string) {
  const reason = business.reasons[0]?.toLowerCase();
  if (business.label === "NO_WEBSITE") return `Hi, this is ${caller} from Axiom Web here in Kitchener-Waterloo. I noticed ${business.name} doesn't have a website listed on Google, so people searching for ${title(business.niche).toLowerCase()} can't find much about you. Is that something you've thought about?`;
  return `Hi, this is ${caller} from Axiom Web here in Kitchener-Waterloo. I was looking at your website and noticed ${reason ?? "a few things that could be easier on a phone"}. Who looks after the website for you?`;
}

export function CallQueue({ business, remaining, caller, skipped }: { business: QueueBusiness; remaining: number; caller: string; skipped: string[] }) {
  const router = useRouter();
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [note, setNote] = useState("");
  const [followUpAt, setFollowUpAt] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const noteRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setKey(crypto.randomUUID()); setOutcome(null); setNote(""); setFollowUpAt(""); setError(null); setSaving(false);
  }, [business.prospectId]);

  const skip = useCallback(() => {
    const next = [...skipped, business.prospectId].slice(-100);
    router.push(`/call?skip=${encodeURIComponent(next.join(","))}`);
  }, [business.prospectId, router, skipped]);

  const save = useCallback(async () => {
    if (!outcome) { setError("Pick what happened (keys 1–0)."); return; }
    setSaving(true); setError(null);
    try {
      const response = await fetch("/api/prospects/activity", {
        method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" },
        body: JSON.stringify({ idempotencyKey: key, prospectId: business.prospectId, channel: "CALL", outcome, note, followUpAt: followUpAt || null }),
      });
      if (!response.ok) throw new Error(((await response.json().catch(() => ({}))) as { error?: string }).error ?? "Could not save.");
      router.refresh();
    } catch (caught) {
      setSaving(false); setError(caught instanceof Error ? caught.message : "Could not save.");
    }
  }, [business.prospectId, followUpAt, key, note, outcome, router]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const typing = event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLInputElement;
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void save(); return; }
      if (typing || event.ctrlKey || event.metaKey || event.altKey) return;
      const match = OUTCOMES.find((option) => option.key === event.key);
      if (match) { setOutcome(match.value); if (NEEDS_DATE.has(match.value) && !followUpAt) setFollowUpAt(inDays(match.value === "CALL_BACK" ? 2 : 3)); return; }
      if (event.key.toLowerCase() === "s") skip();
      if (event.key.toLowerCase() === "n") { event.preventDefault(); noteRef.current?.focus(); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [followUpAt, save, skip]);

  const dial = business.phone.replace(/[^\d+]/g, "");
  return <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_420px]">
    <section className="min-w-0 space-y-4">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm text-slate-600">{title(business.city)} · {title(business.niche)}{business.attempts ? ` · tried ${business.attempts}×` : " · never contacted"}</p>
            <h2 className="mt-1 text-3xl font-semibold tracking-tight">{business.name}</h2>
            <span className={`mt-2 inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${business.label === "NO_WEBSITE" ? "bg-amber-50 text-amber-900 ring-amber-200" : "bg-rose-50 text-rose-800 ring-rose-200"}`}>
              {business.label === "NO_WEBSITE" ? "No website" : "Weak website"}
            </span>
            {business.followUpAt ? <span className="ml-2 inline-block rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-900">Follow-up due {business.followUpAt}</span> : null}
          </div>
          <p className="text-sm text-slate-600">{remaining} left in queue</p>
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <a href={`tel:${dial}`} className="inline-flex items-center gap-3 rounded-xl bg-emerald-700 px-6 py-4 text-2xl font-semibold tabular-nums text-white shadow-sm hover:bg-emerald-800">
            <Phone className="size-6" aria-hidden="true" />{business.phone}
          </a>
          <button type="button" onClick={() => { void navigator.clipboard?.writeText(business.phone); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium hover:bg-slate-50">
            {copied ? <Check className="size-4" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}{copied ? "Copied" : "Copy number"}
          </button>
          <a href={business.mapsUrl} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium hover:bg-slate-50"><MapPin className="size-4" aria-hidden="true" />Google Maps</a>
          {business.websiteUrl ? <a href={business.websiteUrl} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium hover:bg-slate-50"><ExternalLink className="size-4" aria-hidden="true" />Their website</a> : null}
        </div>
        {business.address ? <p className="mt-3 text-sm text-slate-600">{business.address}</p> : null}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-600">What the engine found</h3>
          <ul className="mt-3 space-y-2 text-sm">{business.reasons.length ? business.reasons.slice(0, 5).map((reason) => <li key={reason} className="flex gap-2"><ChevronRight className="mt-0.5 size-4 shrink-0 text-rose-700" aria-hidden="true" />{reason}</li>) : <li className="text-slate-600">No details recorded.</li>}</ul>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-600">Opening line</h3>
          <p className="mt-3 text-sm leading-relaxed">{opener(business, caller)}</p>
          <p className="mt-3 text-xs text-slate-600">Goal: book a 15-minute look at a free mock-up. Don&apos;t promise results.</p>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-600">History</h3>
        {business.history.length ? <ul className="mt-3 space-y-2 text-sm">{business.history.map((item) => <li key={item.id}>
          <span className="font-medium">{item.when} · {item.who} · {item.what}</span>{item.note ? <span className="text-slate-600"> — {item.note}</span> : null}
        </li>)}</ul> : <p className="mt-3 text-sm text-slate-600">First time anyone&apos;s calling them.</p>}
      </div>
    </section>

    <aside className="h-fit space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:sticky lg:top-20">
      <h3 className="font-semibold">What happened?</h3>
      <div className="grid grid-cols-2 gap-2" role="group" aria-label="Call outcome">
        {OUTCOMES.map((option) => {
          const active = outcome === option.value;
          const tone = active ? (option.tone === "stop" || option.tone === "bad" ? "bg-rose-700 text-white border-rose-700" : option.tone === "good" ? "bg-emerald-700 text-white border-emerald-700" : "bg-slate-900 text-white border-slate-900") : "border-slate-300 hover:bg-slate-50";
          return <button key={option.value} type="button" aria-pressed={active}
            onClick={() => { setOutcome(option.value); if (NEEDS_DATE.has(option.value) && !followUpAt) setFollowUpAt(inDays(option.value === "CALL_BACK" ? 2 : 3)); }}
            className={`flex items-center justify-between rounded-lg border px-3 py-2 text-left text-sm font-medium ${tone}`}>
            {option.label}<kbd className={`rounded px-1.5 text-[11px] ${active ? "bg-white/20" : "bg-slate-100 text-slate-600"}`}>{option.key}</kbd>
          </button>;
        })}
      </div>
      <label className="block text-sm font-medium">Notes <span className="font-normal text-slate-600">(N)</span>
        <textarea ref={noteRef} value={note} onChange={(event) => setNote(event.target.value)} maxLength={1000} rows={3}
          placeholder="Who you spoke to, what they said, what's next" className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 text-sm" />
      </label>
      <div>
        <p className="text-sm font-medium">Follow up</p>
        <div className="mt-1 flex flex-wrap gap-2">
          {[["Tomorrow", 1], ["In 3 days", 3], ["Next week", 7], ["In 2 weeks", 14]].map(([label, days]) => {
            const value = inDays(days as number);
            return <button key={label} type="button" onClick={() => setFollowUpAt(value)} aria-pressed={followUpAt === value}
              className={`rounded-full px-3 py-1 text-xs font-medium ${followUpAt === value ? "bg-amber-600 text-white" : "border border-slate-300 hover:bg-slate-50"}`}>{label}</button>;
          })}
          <input type="date" aria-label="Follow-up date" value={followUpAt} onChange={(event) => setFollowUpAt(event.target.value)} className="rounded-md border border-slate-300 px-2 py-1 text-xs" />
          {followUpAt ? <button type="button" onClick={() => setFollowUpAt("")} className="text-xs text-slate-600 underline">clear</button> : null}
        </div>
      </div>
      {error ? <p role="alert" className="text-sm text-rose-700">{error}</p> : null}
      <div className="flex gap-2">
        <button type="button" onClick={() => void save()} disabled={saving}
          className="flex-1 rounded-lg bg-emerald-700 px-4 py-3 font-semibold text-white hover:bg-emerald-800 disabled:opacity-50">{saving ? "Saving…" : "Save & next"}</button>
        <button type="button" onClick={skip} className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-3 text-sm font-medium hover:bg-slate-50"><SkipForward className="size-4" aria-hidden="true" />Skip</button>
      </div>
      <p className="text-xs text-slate-600">Keys: 1–0 outcome · N notes · Ctrl+Enter save · S skip</p>
    </aside>
  </div>;
}
