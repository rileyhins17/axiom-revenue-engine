"use client";

import { Sparkles, X } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";

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
  return <section aria-labelledby="whats-new-title" className="owner-panel owner-pop relative border-[#e6d6b3] bg-gradient-to-br from-[#fbf6ea] to-[#fffdf8]">
    <Button type="button" variant="ghost" size="icon-sm" onClick={close} aria-label="Got it, hide this" className="absolute right-3 top-3"><X aria-hidden="true" /></Button>
    <h2 id="whats-new-title" className="owner-panel-title"><Sparkles aria-hidden="true" />What&apos;s new</h2>
    <ul className="mt-3 grid gap-3 text-sm leading-6 text-[#3b3a36] sm:grid-cols-2">
      <li><b>&ldquo;To call&rdquo; only shows businesses nobody has called yet.</b> Once you call someone, they leave that list straight away.</li>
      <li><b>No answer or voicemail?</b> They come back by themselves in <b>2 days</b> under &ldquo;Retries due&rdquo;. Callbacks come back on the day you picked.</li>
      <li><b>Talked to them but no clear next step?</b> They wait in <b>&ldquo;Needs a decision&rdquo;</b> so they don&apos;t get called again by accident. Open it and pick what happens next.</li>
      <li><b>Axiom Caller, the engine and Orbit now agree.</b> A call saved in the Caller shows up here automatically. Nothing to copy over.</li>
    </ul>
    <Button type="button" variant="outline" size="sm" onClick={close} className="mt-4">Got it</Button>
  </section>;
}
