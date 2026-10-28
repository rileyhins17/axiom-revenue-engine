"use client";

import { AlertTriangle, ArrowUp, Bot, Flag, RotateCcw, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Notice } from "@/components/owner/kit";
import { Button } from "@/components/ui/button";

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

  return <div className="owner-panel is-flush flex min-h-[calc(100vh-220px)] flex-col">
    <div className="owner-panel-head">
      <h2 className="owner-panel-title"><Sparkles aria-hidden="true" />Ask anything about your leads, calls or the app</h2>
      {messages.length ? <Button type="button" variant="ghost" size="xs" onClick={() => setMessages([])}><RotateCcw aria-hidden="true" />New chat</Button> : null}
    </div>

    <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5 sm:px-6" aria-live="polite">
      {messages.length === 0 ? <div className="mx-auto max-w-2xl py-6 text-center">
        <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-[#f4ead6]"><Bot className="size-6 text-[#8a6420]" aria-hidden="true" /></div>
        <h2 className="mt-3 text-xl font-semibold">Hi {firstName}, what do you want to know?</h2>
        <p className="mt-1 text-sm text-[#5c584f]">It reads your live call list, notes and results. It can&apos;t send, call or change anything.</p>
        {!aiReady ? <div className="mt-4 text-left"><Notice tone="warning" icon={AlertTriangle}>Ask AI turns on once the Gemini API key is added.</Notice></div> : null}
        <div className="mt-6 grid gap-2 sm:grid-cols-2">{SUGGESTIONS.map((s) => <Button key={s} type="button" variant="outline" disabled={!aiReady} onClick={() => void send(s)}
          className="h-auto justify-start whitespace-normal px-4 py-3 text-left font-medium">{s}</Button>)}</div>
      </div> : null}
      {messages.map((message, index) => <div key={index} className={message.role === "user" ? "flex justify-end" : "flex justify-start"}>
        <div className={`max-w-[80ch] rounded-2xl px-4 py-3 text-sm leading-relaxed ${message.role === "user" ? "bg-[#0a0a0a] text-[#fbf6ea]" : message.error ? "border border-[#efc4bf] bg-[#fcedeb] text-[#a1231b]" : "bg-[#f1ece1] text-[#0a0a0a]"}`}>
          {message.role === "assistant" && !message.error ? <Formatted text={message.text} /> : message.text}
          {message.tools?.length ? <p className="mt-2 text-[11px] text-[#5c584f]">{[...new Set(message.tools)].map((t) => TOOL_TEXT[t] ?? t).join(" · ")}</p> : null}
          {message.tools?.includes("report_problem") ? <p className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-[#7a5818]"><Flag className="size-3" aria-hidden="true" />Sent to the fix queue</p> : null}
        </div>
      </div>)}
      {busy ? <div className="flex justify-start"><div className="rounded-2xl bg-[#f1ece1] px-4 py-3 text-sm text-[#5c584f]">Looking that up…</div></div> : null}
      <div ref={endRef} />
    </div>

    <form className="border-t border-[#e6e1d6] p-3 sm:px-4" onSubmit={(event) => { event.preventDefault(); void send(draft); }}>
      <div className="flex items-end gap-2 rounded-xl border border-[#d9d2c3] bg-[#fffdf8] p-2 focus-within:border-[#b8893b]">
        <textarea ref={inputRef} value={draft} onChange={(event) => setDraft(event.target.value)} rows={1} maxLength={2000} disabled={!aiReady}
          onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(draft); } }}
          placeholder={aiReady ? "Ask about a business, your numbers, or how something works…" : "Add the Gemini API key to start"} aria-label="Message"
          className="max-h-40 min-h-[40px] flex-1 resize-none border-0 bg-transparent px-2 py-2 text-sm outline-none focus:shadow-none" />
        <Button type="submit" size="icon" disabled={busy || !draft.trim() || !aiReady} aria-label="Send"><ArrowUp className="size-5" aria-hidden="true" /></Button>
      </div>
      <p className="mt-1.5 px-1 text-[11px] text-[#5c584f]">Enter to send · Shift+Enter for a new line · Say &ldquo;report a problem&rdquo; to send something to the fix queue</p>
    </form>
  </div>;
}
