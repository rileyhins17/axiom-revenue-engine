"use client";

import { MessageCircleQuestion, RefreshCw, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";

type Brief = { opener: string; talkingPoints: string[]; objections: { objection: string; reply: string }[]; nextStep: string };
type State = { status: "idle" | "loading" } | { status: "ready"; brief: Brief } | { status: "error"; message: string; setup: boolean };

/** AI call brief. Loads automatically only when the result is already cached; otherwise one click. */
export function AiBrief({ prospectId, initial, aiReady }: { prospectId: string; initial: Brief | null; aiReady: boolean }) {
  const [state, setState] = useState<State>(initial ? { status: "ready", brief: initial } : { status: "idle" });
  useEffect(() => { setState(initial ? { status: "ready", brief: initial } : { status: "idle" }); }, [prospectId, initial]);

  async function load() {
    setState({ status: "loading" });
    try {
      const response = await fetch("/api/ai/brief", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ prospectId }) });
      const body = await response.json().catch(() => ({})) as { brief?: Brief; error?: string; code?: string };
      if (!response.ok || !body.brief) { setState({ status: "error", message: body.error ?? "Could not make a brief.", setup: body.code === "NOT_CONFIGURED" }); return; }
      setState({ status: "ready", brief: body.brief });
    } catch { setState({ status: "error", message: "Could not reach the server.", setup: false }); }
  }

  return <div className="rounded-2xl border border-[#e6d6b3] bg-gradient-to-b from-[#fbf3e2] to-white p-5">
    <div className="flex items-center justify-between gap-2">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-[#5c4210]"><Sparkles className="size-4" aria-hidden="true" />AI call brief</h3>
      {state.status === "ready" ? <button type="button" onClick={() => void load()} className="inline-flex items-center gap-1 text-xs font-medium text-[#7a5818] hover:underline"><RefreshCw className="size-3" aria-hidden="true" />Refresh</button> : null}
    </div>
    {state.status === "idle" ? <div className="mt-3">
      <p className="text-sm text-slate-700">A tailored opener, talking points and answers to likely pushback, built only from what the engine found and your past notes.</p>
      <button type="button" onClick={() => void load()} disabled={!aiReady} className="mt-3 rounded-lg owner-cta px-3 py-2 text-sm font-semibold text-white  disabled:cursor-not-allowed disabled:opacity-50">Write my brief</button>
      {!aiReady ? <p className="mt-2 text-xs text-slate-600">Turns on once the Gemini API key is added.</p> : null}
    </div> : null}
    {state.status === "loading" ? <div className="mt-3 space-y-2" aria-live="polite">
      <p className="text-sm text-slate-700">Writing your brief…</p>
      <div className="h-3 w-3/4 animate-pulse rounded bg-[#f4ead6]" /><div className="h-3 w-2/3 animate-pulse rounded bg-[#f4ead6]" /><div className="h-3 w-1/2 animate-pulse rounded bg-[#f4ead6]" />
    </div> : null}
    {state.status === "error" ? <div className="mt-3"><p role="alert" className="text-sm text-rose-700">{state.message}</p>
      {!state.setup ? <button type="button" onClick={() => void load()} className="mt-2 text-sm font-medium text-[#7a5818] hover:underline">Try again</button> : null}</div> : null}
    {state.status === "ready" ? <div className="mt-3 space-y-4 text-sm">
      <div><p className="text-xs font-semibold uppercase tracking-wide text-[#5c4210]">Say this</p><p className="mt-1 rounded-lg bg-white p-3 leading-relaxed ring-1 ring-[#efe2c6]">{state.brief.opener}</p></div>
      <div><p className="text-xs font-semibold uppercase tracking-wide text-[#5c4210]">Points to make</p>
        <ul className="mt-1 list-disc space-y-1 pl-5">{state.brief.talkingPoints.map((point) => <li key={point}>{point}</li>)}</ul></div>
      <div><p className="text-xs font-semibold uppercase tracking-wide text-[#5c4210]">If they say…</p>
        <ul className="mt-1 space-y-2">{state.brief.objections.map((item) => <li key={item.objection} className="rounded-lg bg-white p-2.5 ring-1 ring-[#efe2c6]">
          <p className="flex items-start gap-1.5 font-medium"><MessageCircleQuestion className="mt-0.5 size-4 shrink-0 text-[#8a6420]" aria-hidden="true" />&ldquo;{item.objection}&rdquo;</p>
          <p className="mt-1 text-slate-700">{item.reply}</p></li>)}</ul></div>
      <p><span className="font-semibold">Aim for: </span>{state.brief.nextStep}</p>
      <p className="text-[11px] text-slate-600">AI draft. Check it sounds like you before saying it.</p>
    </div> : null}
  </div>;
}
