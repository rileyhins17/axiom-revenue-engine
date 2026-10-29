import type { Metadata, Route } from "next";
import Link from "next/link";

import { AlertTriangle } from "lucide-react";

import { Notice, OwnerPage, PageHeader } from "@/components/owner/kit";
import { CallQueue } from "@/components/prospects/call-queue";
import { buttonVariants } from "@/components/ui/button";
import { FindLeadsButton } from "@/components/prospects/find-leads-button";
import { cachedBrief } from "@/lib/ai/call-brief";
import { getCloudflareBindings, getDatabase } from "@/lib/cloudflare";
import { historyView, mapsUrl, torontoMidnight, torontoToday } from "@/lib/prospect-format";
import { listActivityFor, nextInQueue, prospectActivityStats, type ProspectDb } from "@/lib/revenue-engine/engine-prospects-d1";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Call queue | Axiom Revenue Engine" };

export default async function CallQueuePage({ searchParams }: { searchParams: Promise<{ skip?: string }> }) {
  const session = await requireSession();
  const { skip } = await searchParams;
  const skipped = (skip ?? "").split(",").map((id) => id.trim()).filter(Boolean).slice(-100);
  const db = getDatabase() as unknown as ProspectDb;
  const caller = session.user.email?.startsWith("aidan") ? "Aidan" : "Riley";
  const DAILY_DIAL_GOAL = 40;
  let queue: Awaited<ReturnType<typeof nextInQueue>>;
  let callsToday = 0;
  try {
    const [next, stats] = await Promise.all([
      nextInQueue(db, torontoToday(), torontoMidnight(), skipped),
      prospectActivityStats(db, torontoMidnight()).catch(() => null),
    ]);
    queue = next;
    callsToday = stats?.byActor[caller.toUpperCase()]?.calls ?? 0;
  } catch {
    return <OwnerPage><PageHeader eyebrow="Archive: Axiom Web" title="Call queue" /><Notice tone="warning" icon={AlertTriangle} title="The queue couldn't be loaded." role="status">Refresh in a minute.</Notice></OwnerPage>;
  }
  const row = queue.row;
  const env = (getCloudflareBindings() ?? {}) as Record<string, unknown>;
  const aiReady = typeof env.GEMINI_API_KEY === "string" && env.GEMINI_API_KEY.trim().length > 0;
  const history = row ? historyView((await listActivityFor(db, [row.prospectId])).get(row.prospectId) ?? []) : [];
  const brief = row ? await cachedBrief(db, { prospectId: row.prospectId, name: row.name, city: row.city, niche: row.niche, label: row.label, websiteUrl: row.websiteUrl, reasons: row.reasons, history }, caller).catch(() => null) : null;
  return <OwnerPage>
    <PageHeader eyebrow="Archive: Axiom Web" title="Call queue"
      description="One business at a time. Log what happened and the next one loads. Anyone called today is held until tomorrow."
      actions={<>
        {skipped.length ? <Link href={"/call" as Route} className={buttonVariants({ variant: "link", size: "sm" })}>Bring back {skipped.length} skipped</Link> : null}
        <p className="owner-goal-chip" aria-label={`${callsToday} of ${DAILY_DIAL_GOAL} calls today`}>
          <span className="font-semibold tabular-nums">{callsToday}</span><span className="opacity-70">/ {DAILY_DIAL_GOAL} today</span>
          <span className="owner-goal-track" aria-hidden="true"><span style={{ width: `${Math.min(100, Math.round((callsToday / DAILY_DIAL_GOAL) * 100))}%` }} /></span>
        </p>
      </>} />
    {row && row.phone ? <CallQueue caller={caller} remaining={queue.remaining} skipped={skipped} aiReady={aiReady} brief={brief} business={{
      prospectId: row.prospectId, name: row.name, city: row.city, niche: row.niche, label: row.label, reasons: row.reasons,
      phone: row.phone, address: row.address, websiteUrl: row.websiteUrl, mapsUrl: mapsUrl(row), attempts: row.attempts, followUpAt: row.followUpAt,
      altPhone: row.altPhone ?? null, googleRatingCount: row.googleRatingCount ?? null, googleRating: row.googleRating ?? null,
      history,
    }} /> : <div className="owner-panel py-10 text-center">
      <div className="owner-float mx-auto mb-3 flex size-14 items-center justify-center rounded-2xl bg-[#0a0a0a] text-2xl shadow-[0_14px_30px_-12px_rgba(184,137,59,0.6)]" aria-hidden="true">🎉</div>
      <p className="font-display text-2xl">All caught up</p>
      <p className="mx-auto mt-2 max-w-md text-sm text-[#5c584f]">Everyone with a phone number has been called today or is waiting on a follow-up date. Try walk-ins, or check back tomorrow.</p>
      <div className="mt-5 flex justify-center"><FindLeadsButton /></div>
      <div className="mt-3 flex justify-center gap-2">
        <Link href={"/walk-ins" as Route} className={buttonVariants({ variant: "outline", size: "sm" })}>Walk-ins</Link>
        <Link href={"/prospects" as Route} className={buttonVariants({ variant: "outline", size: "sm" })}>Full call list</Link>
      </div>
    </div>}
  </OwnerPage>;
}
