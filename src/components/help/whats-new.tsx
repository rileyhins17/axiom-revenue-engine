"use client";

import { Sparkles, X } from "lucide-react";
import { useEffect, useState } from "react";

const VERSION = "2026-09-25-queue";
const KEY = `axiom.whatsnew.${VERSION}`;

/** Plain-language "what changed" card for the owners. Dismissed per browser. */
export function WhatsNew() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let seen = false;
    try { seen = window.localStorage.getItem(KEY) === "seen"; } catch { seen = false; }
    if (!seen) queueMicrotask(() => setOpen(true));
  }, []);
  if (!open) return null;
  const close = () => { try { window.localStorage.setItem(KEY, "seen"); } catch { /* private window */ } setOpen(false); };
  return <section aria-labelledby="whats-new-title" className="owner-pop relative rounded-2xl border border-[#e6d6b3] bg-gradient-to-br from-[#fbf3e2] to-white p-5">
    <button type="button" onClick={close} aria-label="Got it, hide this" className="absolute right-3 top-3 rounded-md p-1 text-slate-600 hover:bg-white hover:text-slate-900"><X className="size-4" aria-hidden="true" /></button>
    <h2 id="whats-new-title" className="flex items-center gap-2 font-semibold"><Sparkles className="size-4 text-[#8a6420]" aria-hidden="true" />What&apos;s new</h2>
    <ul className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
      <li><b>&ldquo;To call&rdquo; only shows businesses nobody has called yet.</b> Once you call someone, they leave that list straight away.</li>
      <li><b>No answer or voicemail?</b> They come back by themselves in <b>2 days</b> under &ldquo;Retries due&rdquo;. Callbacks come back on the day you picked.</li>
      <li><b>Talked to them but no clear next step?</b> They wait in <b>&ldquo;Needs a decision&rdquo;</b> so they don&apos;t get called again by accident. Open it and pick what happens next.</li>
      <li><b>Axiom Caller, the engine and Orbit now agree.</b> A call saved in the Caller shows up here automatically. Nothing to copy over.</li>
    </ul>
    <button type="button" onClick={close} className="owner-cta mt-4 rounded-lg px-4 py-2 text-sm font-semibold">Got it</button>
  </section>;
}
