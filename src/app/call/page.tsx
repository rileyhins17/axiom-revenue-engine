import type { Metadata, Route } from "next";
import Link from "next/link";

import { CallQueue } from "@/components/prospects/call-queue";
import { cachedBrief } from "@/lib/ai/call-brief";
import { getCloudflareBindings, getDatabase } from "@/lib/cloudflare";
import { historyView, mapsUrl, torontoMidnight, torontoToday } from "@/lib/prospect-format";
import { listActivityFor, nextInQueue, type ProspectDb } from "@/lib/revenue-engine/engine-prospects-d1";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Call queue | Axiom Revenue Engine" };

export default async function CallQueuePage({ searchParams }: { searchParams: Promise<{ skip?: string }> }) {
  const session = await requireSession();
  const { skip } = await searchParams;
  const skipped = (skip ?? "").split(",").map((id) => id.trim()).filter(Boolean).slice(-100);
  const db = getDatabase() as unknown as ProspectDb;
  const caller = session.user.email?.startsWith("aidan") ? "Aidan" : "Riley";
  let queue: Awaited<ReturnType<typeof nextInQueue>>;
  try {
    queue = await nextInQueue(db, torontoToday(), torontoMidnight(), skipped);
  } catch {
    return <section className="mx-auto max-w-6xl px-6 py-8"><h1 className="text-2xl font-semibold">Call queue</h1><p className="mt-2 text-sm">The queue could not be loaded. Refresh in a minute.</p></section>;
  }
  const row = queue.row;
  const env = (getCloudflareBindings() ?? {}) as Record<string, unknown>;
  const aiReady = typeof env.GEMINI_API_KEY === "string" && env.GEMINI_API_KEY.trim().length > 0;
  const history = row ? historyView((await listActivityFor(db, [row.prospectId])).get(row.prospectId) ?? []) : [];
  const brief = row ? await cachedBrief(db, { prospectId: row.prospectId, name: row.name, city: row.city, niche: row.niche, label: row.label, websiteUrl: row.websiteUrl, reasons: row.reasons, history }, caller).catch(() => null) : null;
  return <section className="mx-auto w-full max-w-7xl space-y-5 px-4 py-6 sm:px-6">
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold">Call queue</h1>
        <p className="text-sm text-slate-600">One business at a time. Log what happened and the next one loads. Anyone called today is held until tomorrow.</p>
      </div>
      {skipped.length ? <Link href={"/call" as Route} className="text-sm font-medium text-emerald-800 hover:underline">Bring back {skipped.length} skipped</Link> : null}
    </header>
    {row && row.phone ? <CallQueue caller={caller} remaining={queue.remaining} skipped={skipped} aiReady={aiReady} brief={brief} business={{
      prospectId: row.prospectId, name: row.name, city: row.city, niche: row.niche, label: row.label, reasons: row.reasons,
      phone: row.phone, address: row.address, websiteUrl: row.websiteUrl, mapsUrl: mapsUrl(row), attempts: row.attempts, followUpAt: row.followUpAt,
      history,
    }} /> : <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center">
      <p className="text-lg font-semibold">Queue is empty for today </p>
      <p className="mt-2 text-sm text-slate-600">Everyone with a phone number has been called today or is waiting on a follow-up date. Try walk-ins, or check back tomorrow.</p>
      <div className="mt-4 flex justify-center gap-3 text-sm font-medium">
        <Link href={"/walk-ins" as Route} className="rounded-lg border border-slate-300 px-3 py-2 hover:bg-slate-50">Walk-ins</Link>
        <Link href={"/prospects" as Route} className="rounded-lg border border-slate-300 px-3 py-2 hover:bg-slate-50">Full call list</Link>
      </div>
    </div>}
  </section>;
}
