"use client";

import { ChevronRight, ExternalLink, MapPin, SkipForward, Star } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { celebrate } from "@/components/motion/celebrate";
import { useToast } from "@/components/ui/toast-provider";
import { displayPhone, telHref, titleCase } from "@/lib/prospect-format";

import { AiBrief } from "./ai-brief";
import { CallerLaunch, useCallerHandoff } from "./caller-launch";

export type QueueBusiness = {
  prospectId: string; name: string; city: string; niche: string; label: "STRONG" | "WEAK" | "NO_WEBSITE";
  reasons: string[]; phone: string; address: string | null; websiteUrl: string | null; mapsUrl: string;
  attempts: number; followUpAt: string | null;
  /** Google's number when the business's own website lists a different one (the main number). */
  altPhone?: string | null;
  googleRatingCount?: number | null; googleRating?: number | null;
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
const FOLLOW_UPS = [["Tomorrow", 1], ["In 3 days", 3], ["Next week", 7], ["In 2 weeks", 14]] as const;

function inDays(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  if (date.getDay() === 6) date.setDate(date.getDate() + 2);
  if (date.getDay() === 0) date.setDate(date.getDate() + 1);
  return date.toLocaleDateString("en-CA");
}

/** A short, honest opener built only from what the engine observed on the site. */
function opener(business: QueueBusiness, caller: string) {
  return `Hi, this is ${caller} from Axiom Web here in Kitchener-Waterloo. Who looks after the website for ${business.name}?`;
}

/** Google's reviews say how established a business is; none at all often means an old listing. */
function Reviews({ count, stars }: { count: number | null | undefined; stars: number | null | undefined }) {
  if (count === null || count === undefined) return null;
  if (count === 0) return <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700" title="No Google reviews: the listing may be old, so the number may not work.">No Google reviews</span>;
  return <span className="inline-flex items-center gap-1 rounded-full bg-[#f4ead6] px-2.5 py-0.5 text-xs font-semibold text-[#6b4d16]">
    <Star className="size-3 fill-current" aria-hidden="true" />{stars ?? "–"} · {count} review{count === 1 ? "" : "s"}
  </span>;
}

export type QueueBrief = { opener: string; talkingPoints: string[]; objections: { objection: string; reply: string }[]; nextStep: string };

export function CallQueue({ business, remaining, caller, skipped, aiReady, brief }: { business: QueueBusiness; remaining: number; caller: string; skipped: string[]; aiReady: boolean; brief: QueueBrief | null }) {
  const callerSelected = useCallerHandoff(business.prospectId);
  const router = useRouter();
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [note, setNote] = useState("");
  const [followUpAt, setFollowUpAt] = useState("");
  const [saving, setSaving] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const { toast } = useToast();
  const [error, setError] = useState<string | null>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setKey(crypto.randomUUID()); setOutcome(null); setNote(""); setFollowUpAt(""); setError(null); setSaving(false); setLeaving(false);
  }, [business.prospectId]);

  const pick = useCallback((value: Outcome) => {
    setOutcome(value); setError(null);
    if (NEEDS_DATE.has(value)) setFollowUpAt((current) => current || inDays(value === "CALL_BACK" ? 2 : 3));
  }, []);

  const skip = useCallback(() => {
    const next = [...skipped, business.prospectId].slice(-100);
    router.push(`/call?skip=${encodeURIComponent(next.join(","))}`);
  }, [business.prospectId, router, skipped]);

  const save = useCallback(async () => {
    if (callerSelected || saving) return;
    if (!outcome) { setError("Pick what happened first."); return; }
    setSaving(true); setError(null);
    try {
      const response = await fetch("/api/prospects/activity", {
        method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" },
        body: JSON.stringify({ idempotencyKey: key, prospectId: business.prospectId, channel: "CALL", outcome, note, followUpAt: followUpAt || null }),
      });
      if (!response.ok) throw new Error(((await response.json().catch(() => ({}))) as { error?: string }).error ?? "Could not save.");
      if (outcome === "INTERESTED" || outcome === "MEETING_BOOKED" || outcome === "WON") celebrate();
      toast(`Saved · ${business.name}`, { duration: 2200 });
      // Let the finished card slide away before the next business arrives.
      setLeaving(true);
      window.setTimeout(() => router.refresh(), 200);
    } catch (caught) {
      setSaving(false); setError(caught instanceof Error ? caught.message : "Could not save.");
    }
  }, [business.name, business.prospectId, followUpAt, key, note, outcome, router, callerSelected, saving, toast]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (callerSelected) return;
      const typing = event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLInputElement;
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void save(); return; }
      if (typing || event.ctrlKey || event.metaKey || event.altKey) return;
      const match = OUTCOMES.find((option) => option.key === event.key);
      if (match) { pick(match.value); return; }
      if (event.key.toLowerCase() === "s") skip();
      if (event.key.toLowerCase() === "n") { event.preventDefault(); noteRef.current?.focus(); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pick, save, skip, callerSelected]);

  const website = business.label === "NO_WEBSITE" ? "No website" : business.label === "STRONG" ? "Weak website" : "Website works";

  return <div className="owner-queue grid gap-4 lg:grid-cols-[minmax(0,1fr)_400px] lg:gap-5">
    {/* 1. Who, and the Call button. */}
    <section key={business.prospectId} className={`${leaving ? "owner-slide-out" : "owner-slide-in"} min-w-0 lg:col-start-1 lg:row-start-1`} aria-label="Business to call">
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <p className="min-w-0 truncate text-sm text-slate-600">{titleCase(business.city)} · {titleCase(business.niche)}</p>
          <p className="shrink-0 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium tabular-nums text-slate-700">{remaining} left</p>
        </div>
        <h2 className="font-display mt-1 text-[1.75rem] leading-tight tracking-tight sm:text-3xl">{business.name}</h2>
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${business.label === "NO_WEBSITE" ? "bg-amber-50 text-amber-900 ring-amber-200" : "bg-rose-50 text-rose-800 ring-rose-200"}`}>{website}</span>
          {business.followUpAt ? <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-900">Follow-up due {business.followUpAt}</span> : null}
          <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700">{business.attempts ? `Tried ${business.attempts}×` : "Never called"}</span>
          <Reviews count={business.googleRatingCount} stars={business.googleRating} />
        </div>

        <CallerLaunch prospectId={business.prospectId} phone={business.phone} label={`Call ${displayPhone(business.phone)}`}
          className="owner-cta owner-call-button mt-5 w-full justify-center px-6 py-4 text-lg sm:w-auto sm:text-xl" />
        {business.altPhone ? <p className="mt-2.5 text-sm text-slate-700">
          No luck? <a href={telHref(business.altPhone)} className="font-semibold tabular-nums text-[#7a5818] underline underline-offset-2">Try {displayPhone(business.altPhone)}</a>
          <span className="text-slate-600"> (Google&apos;s number; their website lists the one above)</span>
        </p> : null}

        <div className="mt-4 flex flex-wrap gap-2">
          <a href={business.mapsUrl} target="_blank" rel="noreferrer noopener" className="owner-soft-button"><MapPin className="size-4" aria-hidden="true" />Map</a>
          {business.websiteUrl ? <a href={business.websiteUrl} target="_blank" rel="noreferrer noopener" className="owner-soft-button"><ExternalLink className="size-4" aria-hidden="true" />Their website</a> : null}
        </div>
        {business.address ? <p className="mt-2.5 text-xs text-slate-600">{business.address}</p> : null}
      </div>
    </section>

    {/* 2. What happened: beside the business on a computer, straight after the Call button on a phone. */}
    {callerSelected
      ? <aside className="h-fit rounded-2xl border border-slate-200 bg-white p-5 lg:col-start-2 lg:row-span-2 lg:row-start-1" role="status">This record is open in Caller. Review and save the result there.</aside>
      : <aside className="owner-decision h-fit space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:sticky lg:top-20 lg:col-start-2 lg:row-span-2 lg:row-start-1" aria-label="Log the call">
        <h3 className="font-semibold">What happened?</h3>
        <div className="grid grid-cols-2 gap-2" role="group" aria-label="Call outcome">
          {OUTCOMES.map((option) => {
            const active = outcome === option.value;
            const tone = active ? (option.tone === "stop" || option.tone === "bad" ? "border-rose-700 bg-rose-700 text-white" : option.tone === "good" ? "owner-cta border-emerald-700" : "border-slate-900 bg-[#0a0a0a] text-[#fbf6ea]") : "border-slate-300 bg-white hover:bg-slate-50";
            return <button key={option.value} type="button" aria-pressed={active} onClick={() => pick(option.value)}
              className={`owner-press owner-outcome flex min-h-12 items-center justify-between rounded-xl border px-3 py-2 text-left text-sm font-medium ${tone}`}>
              {option.label}<kbd className={`owner-kbd rounded px-1.5 text-[11px] ${active ? "bg-white/20" : "bg-slate-100 text-slate-600"}`}>{option.key}</kbd>
            </button>;
          })}
        </div>

        <div>
          <p className="text-sm font-medium">Follow up {outcome && NEEDS_DATE.has(outcome) ? null : <span className="font-normal text-slate-600">(optional)</span>}</p>
          <div className="mt-1.5 flex flex-wrap gap-2">
            {FOLLOW_UPS.map(([label, days]) => {
              const value = inDays(days);
              return <button key={label} type="button" onClick={() => setFollowUpAt(value)} aria-pressed={followUpAt === value}
                className={`min-h-9 rounded-full px-3 py-1 text-xs font-medium ${followUpAt === value ? "bg-amber-600 text-white" : "border border-slate-300 bg-white hover:bg-slate-50"}`}>{label}</button>;
            })}
            <input type="date" aria-label="Follow-up date" value={followUpAt} onChange={(event) => setFollowUpAt(event.target.value)} className="min-h-9 rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs" />
            {followUpAt ? <button type="button" onClick={() => setFollowUpAt("")} className="min-h-9 px-1 text-xs text-slate-600 underline">clear</button> : null}
          </div>
        </div>

        <label className="block text-sm font-medium">Notes <span className="owner-kbd font-normal text-slate-600">(N)</span>
          <textarea ref={noteRef} value={note} onChange={(event) => setNote(event.target.value)} maxLength={1000} rows={2}
            placeholder="Who you spoke to, what they said, what's next" className="mt-1 w-full rounded-xl border border-slate-300 bg-white p-2.5 text-sm" />
        </label>
        {error ? <p role="alert" className="text-sm text-rose-700">{error}</p> : null}

        {/* On a phone this bar stays pinned above the tab bar, so saving is always one tap away. */}
        <div className="owner-action-bar flex gap-2">
          <button type="button" onClick={skip} className="inline-flex min-h-12 items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-4 text-sm font-medium hover:bg-slate-50"><SkipForward className="size-4" aria-hidden="true" />Skip</button>
          <button type="button" onClick={() => void save()} disabled={saving}
            className="owner-cta min-h-12 flex-1 rounded-xl px-4 font-semibold disabled:opacity-50">{saving ? "Saving…" : outcome ? "Save & next" : "Pick what happened"}</button>
        </div>
        <p className="owner-kbd text-xs text-slate-600">Keys: 1–0 outcome · N notes · Ctrl+Enter save · S skip</p>
      </aside>}

    {/* 3. What to say. */}
    <section className="min-w-0 space-y-4 lg:col-start-1 lg:row-start-2" aria-label="What to say">
      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-600">Why they need you</h3>
        <ul className="mt-3 space-y-2 text-sm">{business.reasons.length ? business.reasons.slice(0, 5).map((reason) => <li key={reason} className="flex gap-2"><ChevronRight className="mt-0.5 size-4 shrink-0 text-rose-700" aria-hidden="true" />{reason}</li>) : <li className="text-slate-600">No details recorded.</li>}</ul>
      </div>
      <AiBrief prospectId={business.prospectId} initial={brief} aiReady={aiReady} />
      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-600">Quick opener</h3>
        <p className="mt-3 text-sm leading-relaxed">{opener(business, caller)}</p>
        <p className="mt-3 text-xs text-slate-600">Goal: book a 15-minute look at a free mock-up. Don&apos;t promise results.</p>
      </div>
      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-600">History</h3>
        {business.history.length ? <ul className="mt-3 space-y-2 text-sm">{business.history.map((item) => <li key={item.id}>
          <span className="font-medium">{item.when} · {item.who} · {item.what}</span>{item.note ? <span className="text-slate-600"> — {item.note}</span> : null}
        </li>)}</ul> : <p className="mt-3 text-sm text-slate-600">First time anyone&apos;s calling them.</p>}
      </div>
    </section>
  </div>;
}
