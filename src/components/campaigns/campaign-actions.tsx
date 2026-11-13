"use client";

import { CheckCircle2, Mail, Pause, Play, Square } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";

async function post(url: string, body: unknown) {
  const response = await fetch(url, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new Error(data.error ?? "Could not save.");
  return data;
}

function useAction() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const run = async (action: () => Promise<string | null>) => {
    setBusy(true); setError(null); setDone(null);
    try { setDone(await action()); router.refresh(); } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not save."); } finally { setBusy(false); }
  };
  return { busy, error, done, run };
}

/** A campaign's own Pause or Resume. It only ever touches that campaign. */
export function CampaignPauseButton({ campaign, state }: { campaign: string; state: "live" | "paused" }) {
  const { busy, error, run } = useAction();
  const action = state === "live" ? "pause" : "resume";
  return <div className="space-y-2">
    {action === "pause"
      ? <Button type="button" variant="outline" size="lg" disabled={busy} className="w-full" style={{ color: "var(--owner-danger)" }} onClick={() => void run(async () => { await post("/api/campaigns/control", { campaign, action }); return null; })}>
        <Pause aria-hidden="true" />Pause this campaign</Button>
      : <Button type="button" size="lg" disabled={busy} className="w-full" onClick={() => void run(async () => { await post("/api/campaigns/control", { campaign, action }); return null; })}>
        <Play aria-hidden="true" />Resume this campaign</Button>}
    <p className="owner-meta">{action === "pause" ? "Stops this campaign within a minute. Other campaigns keep going." : "Starts again at its next send time. It still only sends approved batches."}</p>
    {error ? <p role="alert" className="text-sm font-medium" style={{ color: "var(--owner-danger)" }}>{error}</p> : null}
  </div>;
}

/**
 * Approve, made hard to press by accident: the button sits in a bar pinned to the bottom of the screen and only
 * opens a sheet that names the batch and how many emails it lets out. The sheet's own Approve is the second,
 * deliberate press, and it ignores presses for the first second, so a double tap can never approve.
 */
export function ApproveDock({ batch, name, emails, campaign, wordsChanged }: { batch: string; name: string; emails: number; campaign: string; wordsChanged: boolean }) {
  const { busy, error, run } = useAction();
  const [open, setOpen] = useState(false);
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => setArmed(true), 1000);
    return () => { clearTimeout(timer); setArmed(false); };
  }, [open]);
  const count = `${emails} ${emails === 1 ? "email" : "emails"}`;
  return <>
    <div className="owner-action-dock">
      <p className="owner-action-dock-note">{wordsChanged ? "The campaign's words changed after this batch was approved. Read the samples again." : "Read the samples above first."} Nothing in this batch sends before you approve.</p>
      <Button type="button" size="lg" data-approve-open onClick={() => setOpen(true)} className="w-full sm:w-auto"><CheckCircle2 aria-hidden="true" />Approve {count}…</Button>
    </div>
    <Sheet open={open} onOpenChange={(next) => { if (!busy) setOpen(next); }}>
      <SheetContent side="bottom" className="owner-confirm-sheet">
        <SheetHeader>
          <SheetTitle>Approve {count} in {name}?</SheetTitle>
          <SheetDescription>
            They go out at {campaign}&rsquo;s next send times, exactly as the samples read, each with its follow-up. You can still pause the campaign or stop this batch afterwards, but an email that has gone can&rsquo;t be taken back.
          </SheetDescription>
        </SheetHeader>
        <div className="grid gap-2 px-4 pb-4">
          <Button type="button" size="lg" disabled={busy || !armed} data-approve-confirm onClick={() => void run(async () => { await post("/api/campaigns/approve", { batch, action: "approve" }); setOpen(false); return "Approved."; })}>
            <CheckCircle2 aria-hidden="true" />{busy ? "Approving…" : `Yes, I read the samples: approve ${count}`}</Button>
          {error ? <p role="alert" className="text-sm font-medium" style={{ color: "var(--owner-danger)" }}>{error}</p> : null}
          <Button type="button" variant="outline" size="lg" disabled={busy} onClick={() => setOpen(false)}>Not yet</Button>
        </div>
      </SheetContent>
    </Sheet>
  </>;
}

/** The quieter things a founder can do with a batch: send test emails to their own inbox, or stop it for good. */
export function BatchActions({ batch, canApprove, approvers, status, wordsCurrent }: {
  batch: string; canApprove: boolean; approvers: string; status: string; wordsCurrent: boolean;
}) {
  const { busy, error, done, run } = useAction();
  const approved = status === "approved" && wordsCurrent;
  return <div className="space-y-3">
    {status === "stopped" ? <p className="text-sm owner-text">This batch was stopped. Nothing more goes to anyone in it.</p>
      : approved ? <p className="flex items-center gap-2 text-sm font-medium owner-ink"><CheckCircle2 className="size-4" aria-hidden="true" />Approved. Its emails go at the campaign&rsquo;s send times.</p>
        : canApprove ? <p className="text-sm owner-text">It waits for you. The Approve button is at the bottom of the screen, after the samples.</p>
          : <p className="text-sm owner-text">It waits for {approvers} to approve it. Nothing in it sends before that.</p>}
    {status !== "stopped" ? <Button type="button" variant="outline" size="lg" disabled={busy} className="w-full"
      onClick={() => void run(async () => { const data = await post("/api/campaigns/test", { batch, count: 3 }) as { to?: string }; return `Queued: 3 samples and their follow-ups go to ${data.to ?? "your inbox"} within 15 minutes.`; })}>
      <Mail aria-hidden="true" />Send me a test</Button> : null}
    {status !== "stopped" ? <p className="owner-meta">A test is 3 of these samples with their follow-ups, sent to your own inbox only, within 15 minutes.</p> : null}
    {status === "waiting" || approved ? <Button type="button" variant="ghost" disabled={busy} className="w-full" style={{ color: "var(--owner-danger)" }}
      onClick={() => { if (window.confirm("Stop this batch for good? Nobody in it who hasn't been emailed yet will be.")) void run(async () => { await post("/api/campaigns/approve", { batch, action: "stop" }); return "Stopped."; }); }}>
      <Square aria-hidden="true" />Stop this batch</Button> : null}
    {done ? <p role="status" className="text-sm owner-text">{done}</p> : null}
    {error ? <p role="alert" className="text-sm font-medium" style={{ color: "var(--owner-danger)" }}>{error}</p> : null}
  </div>;
}
