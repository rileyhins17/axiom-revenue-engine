import type { Metadata, Route } from "next";
import Link from "next/link";
import { AlertTriangle, Archive, ArrowRight, CalendarClock, MailX, Reply, Send } from "lucide-react";

import { CountUp } from "@/components/motion/count-up";
import { Notice, OwnerPage, PageHeader, StatCard } from "@/components/owner/kit";
import { buttonVariants } from "@/components/ui/button";
import { getDatabase } from "@/lib/cloudflare";
import { fccScreen, type FccScreen } from "@/lib/fcc-campaign-status";
import type { ProspectDb } from "@/lib/revenue-engine/engine-prospects-d1";
import { requireSession } from "@/lib/session";
import { cn } from "@/lib/utils";

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

  return <OwnerPage>
    <PageHeader eyebrow={date} title={`${greeting}, ${firstName}.`} />

    {fcc?.state === "paused" && fcc.control?.action === "paused"
      ? <Notice tone="warning" icon={AlertTriangle} title="FCC emails are paused." role="status"
        action={<Link href={"/fcc" as Route} className={buttonVariants({ variant: "outline", size: "sm" })}>Open FCC to resume</Link>}>
        {fcc.control.reason}
      </Notice>
      : null}

    {fcc ? <div className="grid gap-4 lg:grid-cols-3">
      <Link href={"/fcc" as Route} className="owner-feature lg:col-span-2">
        <p className="owner-feature-label"><Send aria-hidden="true" />FCC emails · {STATE_TEXT[fcc.state]}</p>
        <p className="owner-feature-value owner-gold-text"><CountUp value={fcc.sentToday.first + fcc.sentToday.followUps} /></p>
        <p className="owner-feature-text">sent today, of up to {fcc.batchSize * 2}. <b>{fcc.ready}</b> ready to send.</p>
        <p className="owner-feature-text flex items-start gap-2"><CalendarClock className="mt-1 size-4 shrink-0 text-[#e3c07a]" aria-hidden="true" />{fcc.nextSend}</p>
        <span className={cn(buttonVariants({ variant: "gold" }), "mt-6 self-start")}>Open FCC <ArrowRight aria-hidden="true" /></span>
      </Link>
      <div className="grid gap-4">
        <StatCard href={"/fcc" as Route} icon={Reply} label="Replies" value={fcc.replies.length}
          detail={fcc.followUpsDue ? `${fcc.followUpsDue} follow-up${fcc.followUpsDue === 1 ? "" : "s"} due` : "Aidan's Gmail shows them first"} />
        <StatCard href={"/fcc" as Route} icon={MailX} label="Bounced today" value={fcc.bouncesToday}
          detail={`${fcc.bounces.length} in total · 3 in a day pauses sending`} />
      </div>
    </div> : <Notice tone="warning" icon={AlertTriangle} title="The FCC numbers couldn't be loaded." role="status">Refresh in a minute.</Notice>}

    <Link href={"/archive" as Route} className="owner-panel flex items-center justify-between gap-4 py-4 sm:py-5">
      <span className="flex min-w-0 items-start gap-3">
        <Archive className="mt-0.5 size-4 shrink-0 text-[#8a6420]" aria-hidden="true" />
        <span className="min-w-0">
          <span className="block text-[15px] font-semibold">Archive: Axiom Web</span>
          <span className="owner-meta block">The old website campaign: call queue, walk-ins and website email. Paused, nothing deleted.</span>
        </span>
      </span>
      <ArrowRight className="size-4 shrink-0 text-[#5c584f]" aria-hidden="true" />
    </Link>
  </OwnerPage>;
}
