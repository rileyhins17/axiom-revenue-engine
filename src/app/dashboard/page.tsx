import type { Metadata, Route } from "next";
import Link from "next/link";
import { AlertTriangle, Archive, ArrowRight, CalendarClock, MailX, Reply, Send } from "lucide-react";

import { CountUp } from "@/components/motion/count-up";
import { getDatabase } from "@/lib/cloudflare";
import { fccScreen, type FccScreen } from "@/lib/fcc-campaign-status";
import type { ProspectDb } from "@/lib/revenue-engine/engine-prospects-d1";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Today | Axiom Revenue Engine" };

const STATE_TEXT: Record<FccScreen["state"], string> = { live: "Live", paused: "Paused", locked: "Locked" };

/** Today shows the FCC campaign first. The old website campaign lives behind the archive link. */
export default async function TodayPage() {
  const session = await requireSession();
  const now = new Date();
  const firstName = session.user.name?.split(" ")[0] || (session.user.email?.startsWith("aidan") ? "Aidan" : "Riley");
  const hour = Number(new Intl.DateTimeFormat("en-CA", { hour: "numeric", hourCycle: "h23", timeZone: "America/Toronto" }).format(now));
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const date = new Intl.DateTimeFormat("en-CA", { weekday: "long", month: "long", day: "numeric", timeZone: "America/Toronto" }).format(now);

  let fcc: FccScreen | null;
  try {
    fcc = await fccScreen(getDatabase() as unknown as ProspectDb, now);
  } catch {
    fcc = null;
  }

  return <section className="owner-stagger mx-auto w-full max-w-7xl space-y-6 px-4 py-6 sm:px-6">
    <header>
      <p className="text-sm text-slate-600">{date}</p>
      <h1>{greeting}, {firstName}.</h1>
    </header>

    {fcc ? <div className="grid gap-4 lg:grid-cols-3">
      <Link href={"/fcc" as Route} className="group min-w-0 rounded-2xl owner-cta p-6 shadow-sm lg:col-span-2">
        <p className="flex items-center gap-2 text-sm font-medium text-[#e9dfc8]"><Send className="size-4" aria-hidden="true" />FCC emails · {STATE_TEXT[fcc.state]}</p>
        <p className="font-display owner-gold-text mt-2 text-6xl tabular-nums"><CountUp value={fcc.sentToday.first + fcc.sentToday.followUps} /></p>
        <p className="text-[#e9dfc8]">sent today, of up to {fcc.batchSize * 2}. <b>{fcc.ready}</b> ready to send.</p>
        <p className="mt-3 flex items-start gap-2 text-[#e9dfc8]"><CalendarClock className="mt-0.5 size-4 shrink-0" aria-hidden="true" />{fcc.nextSend}</p>
        <p className="mt-5 inline-flex items-center gap-1.5 rounded-lg bg-[#f7e9c8] px-4 py-2 font-semibold text-[#0a0a0a] shadow-[0_8px_24px_-8px_rgba(227,192,122,0.6)] transition group-hover:bg-[#fbf1da]">Open FCC <ArrowRight className="size-4 transition group-hover:translate-x-0.5" aria-hidden="true" /></p>
      </Link>
      <div className="grid gap-4">
        <Link href={"/fcc" as Route} className="owner-card-lift min-w-0 rounded-2xl border border-slate-200 bg-white p-5">
          <p className="flex items-center gap-2 text-sm font-medium text-slate-600"><Reply className="size-4" aria-hidden="true" />Replies</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{fcc.replies.length}</p>
          <p className="text-sm text-slate-600">{fcc.followUpsDue ? `${fcc.followUpsDue} follow-up${fcc.followUpsDue === 1 ? "" : "s"} due` : "Aidan's Gmail shows them first"}</p>
        </Link>
        <Link href={"/fcc" as Route} className="owner-card-lift min-w-0 rounded-2xl border border-slate-200 bg-white p-5">
          <p className="flex items-center gap-2 text-sm font-medium text-slate-600"><MailX className="size-4" aria-hidden="true" />Bounces</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{fcc.bounces.length}</p>
          <p className="text-sm text-slate-600">{fcc.bouncesToday} today · 3 in a day pauses everything</p>
        </Link>
      </div>
    </div> : <div className="rounded-2xl border border-slate-200 bg-white p-5 text-sm">The FCC numbers couldn&apos;t be loaded. Refresh in a minute.</div>}

    {fcc?.state === "paused" && fcc.control?.action === "paused" ? <Link href={"/fcc" as Route} className="owner-attention flex items-start gap-3 rounded-2xl border border-[#e6d6b3] bg-[#fbf3e2] px-5 py-4 text-sm">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <span><b>FCC emails are paused.</b> {fcc.control.reason} Open FCC to resume.</span>
    </Link> : null}

    <Link href={"/archive" as Route} className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-5 py-4 text-sm hover:bg-slate-50">
      <span className="flex items-start gap-2"><Archive className="mt-0.5 size-4 shrink-0" aria-hidden="true" /><span><b>Archive: Axiom Web</b> · the old website campaign (call queue, walk-ins, website email). Paused, nothing deleted.</span></span>
      <ArrowRight className="size-4 shrink-0" aria-hidden="true" />
    </Link>
  </section>;
}
