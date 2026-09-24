"use client";

import { ArrowUp, Bot, Flag, RotateCcw, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";

type Message = { role: "user" | "assistant"; text: string; tools?: string[]; error?: boolean };

const SUGGESTIONS = [
  "Who should Aidan call first today?",
  "How did we do this week?",
  "Which follow-ups are overdue?",
  "Plan a walk-in route in Waterloo",
  "What happened with our last 5 calls?",
  "How does the call queue decide who's next?",
];
const TOOL_TEXT: Record<string, string> = {
  get_overview: "checked the numbers", search_businesses: "searched the call list", get_business: "opened a business",
  recent_activity: "read recent calls", report_problem: "filed a fix request", list_fix_requests: "checked fix requests",
};

/** Light formatting only: paragraphs, bullets and **bold**. No HTML from the model is rendered. */
function Formatted({ text }: { text: string }) {
  return <div className="space-y-2">{text.split(/\n{2,}/).map((block, i) => {
    const lines = block.split("\n");
    const bold = (line: string) => line.split(/(\*\*[^*]+\*\*)/g).map((part, j) => part.startsWith("**") && part.endsWith("**") ? <strong key={j}>{part.slice(2, -2)}</strong> : <span key={j}>{part}</span>);
    return lines.every((line) => /^\s*([-*•]|\d+\.)\s/.test(line))
      ? <ul key={i} className="list-disc space-y-1 pl-5">{lines.map((line, j) => <li key={j}>{bold(line.replace(/^\s*([-*•]|\d+\.)\s/, ""))}</li>)}</ul>
      : <p key={i}>{lines.map((line, j) => <span key={j}>{bold(line)}{j < lines.length - 1 ? <br /> : null}</span>)}</p>;
  })}</div>;
}

export function AskChat({ aiReady, firstName }: { aiReady: boolean; firstName: string }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [messages, busy]);

  async function send(text: string) {
    const question = text.trim();
    if (!question || busy) return;
    const next: Message[] = [...messages, { role: "user", text: question }];
    setMessages(next); setDraft(""); setBusy(true);
    try {
      const response = await fetch("/api/ai/chat", {
        method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: next.filter((m) => !m.error).slice(-12).map(({ role, text: t }) => ({ role, text: t.slice(0, 2000) })), page: "/ask" }),
      });
      const body = await response.json().catch(() => ({})) as { text?: string; toolsUsed?: string[]; error?: string };
      setMessages([...next, response.ok && body.text ? { role: "assistant", text: body.text, tools: body.toolsUsed } : { role: "assistant", text: body.error ?? "Something went wrong.", error: true }]);
    } catch {
      setMessages([...next, { role: "assistant", text: "Could not reach the server.", error: true }]);
    } finally { setBusy(false); inputRef.current?.focus(); }
  }

  return <div className="flex min-h-[calc(100vh-180px)] flex-col rounded-2xl border border-slate-200 bg-white">
    <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
      <p className="flex items-center gap-2 text-sm font-semibold"><Sparkles className="size-4 text-violet-700" aria-hidden="true" />Ask anything about your leads, calls or the app</p>
      {messages.length ? <button type="button" onClick={() => setMessages([])} className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-slate-900"><RotateCcw className="size-3.5" aria-hidden="true" />New chat</button> : null}
    </div>

    <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5" aria-live="polite">
      {messages.length === 0 ? <div className="mx-auto max-w-2xl py-8 text-center">
        <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-violet-100"><Bot className="size-6 text-violet-700" aria-hidden="true" /></div>
        <h2 className="mt-3 text-xl font-semibold">Hi {firstName}, what do you want to know?</h2>
        <p className="mt-1 text-sm text-slate-600">It reads your live call list, notes and results. It can&apos;t send, call or change anything.</p>
        {!aiReady ? <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">Ask AI turns on once the Gemini API key is added.</p> : null}
        <div className="mt-6 grid gap-2 sm:grid-cols-2">{SUGGESTIONS.map((s) => <button key={s} type="button" disabled={!aiReady} onClick={() => void send(s)}
          className="rounded-xl border border-slate-200 px-4 py-3 text-left text-sm hover:border-violet-300 hover:bg-violet-50 disabled:opacity-50">{s}</button>)}</div>
      </div> : null}
      {messages.map((message, index) => <div key={index} className={message.role === "user" ? "flex justify-end" : "flex justify-start"}>
        <div className={`max-w-[80ch] rounded-2xl px-4 py-3 text-sm leading-relaxed ${message.role === "user" ? "bg-slate-900 text-white" : message.error ? "bg-rose-50 text-rose-800" : "bg-slate-100 text-slate-900"}`}>
          {message.role === "assistant" && !message.error ? <Formatted text={message.text} /> : message.text}
          {message.tools?.length ? <p className="mt-2 text-[11px] text-slate-600">{[...new Set(message.tools)].map((t) => TOOL_TEXT[t] ?? t).join(" · ")}</p> : null}
          {message.tools?.includes("report_problem") ? <p className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-violet-800"><Flag className="size-3" aria-hidden="true" />Sent to the fix queue</p> : null}
        </div>
      </div>)}
      {busy ? <div className="flex justify-start"><div className="rounded-2xl bg-slate-100 px-4 py-3 text-sm text-slate-600">Looking that up…</div></div> : null}
      <div ref={endRef} />
    </div>

    <form className="border-t border-slate-200 p-3" onSubmit={(event) => { event.preventDefault(); void send(draft); }}>
      <div className="flex items-end gap-2 rounded-xl border border-slate-300 bg-white p-2 focus-within:border-violet-500">
        <textarea ref={inputRef} value={draft} onChange={(event) => setDraft(event.target.value)} rows={1} maxLength={2000} disabled={!aiReady}
          onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(draft); } }}
          placeholder={aiReady ? "Ask about a business, your numbers, or how something works…" : "Add the Gemini API key to start"} aria-label="Message"
          className="max-h-40 min-h-[40px] flex-1 resize-none border-0 bg-transparent px-2 py-2 text-sm outline-none" />
        <button type="submit" disabled={busy || !draft.trim() || !aiReady} aria-label="Send" className="flex size-10 items-center justify-center rounded-lg bg-violet-700 text-white hover:bg-violet-800 disabled:opacity-40"><ArrowUp className="size-5" aria-hidden="true" /></button>
      </div>
      <p className="mt-1.5 px-1 text-[11px] text-slate-600">Enter to send · Shift+Enter for a new line · Say &ldquo;report a problem&rdquo; to send something to the fix queue</p>
    </form>
  </div>;
}
