"use client";

import { CheckCircle2, Mail, Pause, Play, Square } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";

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
      ? <Button type="button" variant="destructive" size="lg" disabled={busy} className="w-full" onClick={() => void run(async () => { await post("/api/campaigns/control", { campaign, action }); return null; })}>
        <Pause aria-hidden="true" />Pause this campaign</Button>
      : <Button type="button" size="lg" disabled={busy} className="w-full" onClick={() => void run(async () => { await post("/api/campaigns/control", { campaign, action }); return null; })}>
        <Play aria-hidden="true" />Resume this campaign</Button>}
    <p className="owner-meta">{action === "pause" ? "Stops this campaign within a minute. FCC and other campaigns keep going." : "Starts again at its next send time. It still only sends approved batches."}</p>
    {error ? <p role="alert" className="text-sm font-medium text-[#a1231b]">{error}</p> : null}
  </div>;
}

/** Approve (named approvers only), stop for good, and send test emails to your own inbox. */
export function BatchActions({ batch, canApprove, approvers, status, wordsCurrent }: {
  batch: string; canApprove: boolean; approvers: string; status: string; wordsCurrent: boolean;
}) {
  const { busy, error, done, run } = useAction();
  const approved = status === "approved" && wordsCurrent;
  return <div className="space-y-3">
    {status === "stopped" ? <p className="text-sm">This batch was stopped. Nothing more goes to anyone in it.</p>
      : approved ? <p className="flex items-center gap-2 text-sm font-medium"><CheckCircle2 className="size-4" aria-hidden="true" />Approved. Its emails go at the campaign&rsquo;s send times.</p>
        : canApprove ? <Button type="button" size="lg" disabled={busy} className="w-full" onClick={() => void run(async () => { await post("/api/campaigns/approve", { batch, action: "approve" }); return "Approved."; })}>
          <CheckCircle2 aria-hidden="true" />I read the samples: approve this batch</Button>
          : <p className="text-sm">Waiting for {approvers} to approve it. Nothing in it sends before that.</p>}
    {status !== "stopped" ? <Button type="button" variant="outline" disabled={busy} className="w-full"
      onClick={() => void run(async () => { const data = await post("/api/campaigns/test", { batch, count: 3 }) as { to?: string }; return `Queued: 3 samples and their follow-ups go to ${data.to ?? "your inbox"} within 15 minutes.`; })}>
      <Mail aria-hidden="true" />Send me a test (3 samples, to my own inbox)</Button> : null}
    {status === "waiting" || approved ? <Button type="button" variant="ghost" disabled={busy} className="w-full text-[#a1231b]"
      onClick={() => { if (window.confirm("Stop this batch for good? Nobody in it who hasn't been emailed yet will be.")) void run(async () => { await post("/api/campaigns/approve", { batch, action: "stop" }); return "Stopped."; }); }}>
      <Square aria-hidden="true" />Stop this batch</Button> : null}
    {done ? <p role="status" className="text-sm">{done}</p> : null}
    {error ? <p role="alert" className="text-sm font-medium text-[#a1231b]">{error}</p> : null}
  </div>;
}
