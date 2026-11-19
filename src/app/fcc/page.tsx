import type { Metadata, Route } from "next";
import Link from "next/link";
import { AlertTriangle, Archive, BarChart3, MailX, MessageSquareReply } from "lucide-react";

import { FccPauseButton } from "@/components/fcc/fcc-pause-button";
import { buttonVariants } from "@/components/ui/button";
import { Empty, Notice, OwnerPage, PageHeader, Panel, StatCard } from "@/components/owner/kit";
import { getDatabase } from "@/lib/cloudflare";
import { fccScreen, fccStats, type FccRateRow, type FccScreen, type FccStats } from "@/lib/fcc-campaign-status";
import { sendingInboxes } from "@/lib/fcc-screen-inboxes";
import { whenText } from "@/lib/outreach/outreach-format";
import { ownerForAccount } from "@/lib/owner-login";
import type { ProspectDb } from "@/lib/revenue-engine/engine-prospects-d1";
import { requireSession } from "@/lib/session";
import { withTimeout } from "@/lib/timeout";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "FCC archive | Axiom Revenue Engine" };

const pct = (value: number | null) => (value === null ? "None" : `${(value * 100).toFixed(1)}%`);

function RateRows({ rows }: { rows: FccRateRow[] }) {
  return <>{rows.map((row) => <tr key={row.label}>
    <td className="font-semibold">{row.label}</td><td className="text-right owner-num">{row.emailed}</td>
    <td className="text-right owner-num">{row.replies}</td><td className="text-right owner-num">{pct(row.rate)}</td>
    <td className="text-right owner-num">{row.bounced}</td>
  </tr>)}</>;
}

/**
 * The FCC archive. FCC ended on Nov 12, 2026 (both founders): this screen keeps its all-time numbers to read.
 * Its replies are on the Replies screen under "FCC (ended)". Nothing here can start it again.
 */
export default async function FccArchivePage() {
  const session = await requireSession();
  let data: FccScreen;
  let stats: FccStats;
  try {
    const db = getDatabase() as unknown as ProspectDb;
    [data, stats] = await withTimeout(Promise.all([fccScreen(db), fccStats(db, sendingInboxes())]), 12_000, "fcc-numbers");
  } catch {
    return <OwnerPage>
      <PageHeader eyebrow="More" title="FCC archive" />
      <Notice tone="warning" icon={AlertTriangle} title="The FCC numbers couldn't be loaded." role="status">Refresh in a minute. Nothing about the campaigns depends on them.</Notice>
    </OwnerPage>;
  }
  const owner = Boolean(ownerForAccount(session.user.email ?? ""));
  const paused = data.control?.action === "paused" ? data.control : null;
  const versions = stats.byVersion.filter((row) => row.emailed > 0);

  return <OwnerPage>
    <PageHeader eyebrow="More" title="FCC archive" description="The FCC filing emails ran from Oct 26 to Nov 11, 2026. This is their record, kept to read." />

    {data.state === "live"
      ? <Notice tone="danger" icon={AlertTriangle} title="FCC emails are switched on." role="alert" action={owner ? <FccPauseButton /> : undefined}>
        FCC ended on Nov 12, 2026 and should stay paused. Press Pause unless you both decided to restart it.
      </Notice>
      : <Notice tone="info" icon={Archive} title="FCC ended on Nov 12, 2026." role="status">
        Sending is {data.state === "locked" ? "locked" : "paused"} for good{paused ? ` (${paused.by}, ${whenText(paused.at)}${paused.reason ? `: ${paused.reason}` : ""})` : ""}. Its lists and replies stay in the database; nobody on them is emailed again by FCC, and anyone who bounced or said no thanks stays on the do-not-email list for every campaign.
      </Notice>}

    <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
      <StatCard label="Companies emailed" value={stats.emailed} detail={`${data.sentAllTime.first + data.sentAllTime.followUps} emails in all, ${stats.followUpsSent} of them follow-ups`} />
      <StatCard label="Real replies" value={stats.replies.real} detail={`${pct(stats.replyRate)} of companies · ${stats.replies.saidNo} said no · ${stats.replies.automatic} automatic`} />
      <StatCard label="Bounced" value={stats.bounced} detail={`${pct(stats.bounceRate)} of companies`} />
      <StatCard label="Never emailed" value={data.ready + data.held} detail="Left on its lists when it ended" />
    </div>

    <Panel title="Replies" icon={MessageSquareReply} count={data.replies.length} description="Everyone who wrote back to an FCC email, with what they said.">
      <Link href={"/replies?filter=all&campaign=fcc" as Route} className={buttonVariants({ variant: "outline", size: "lg" })}><MessageSquareReply aria-hidden="true" />Read FCC&rsquo;s replies</Link>
    </Panel>

    <Panel title="By email version, all time" icon={BarChart3} flush>
      {versions.length ? <div className="overflow-x-auto"><table className="owner-table min-w-[520px]">
        <thead><tr><th>Email</th><th className="text-right">Emailed</th><th className="text-right">Replies</th><th className="text-right">Rate</th><th className="text-right">Bounced</th></tr></thead>
        <tbody><RateRows rows={versions} /></tbody>
      </table></div> : <div className="px-5 py-6 sm:px-6"><Empty>No FCC email was sent.</Empty></div>}
    </Panel>

    <Panel title="Bounces" icon={MailX} count={data.bounces.length}>
      {data.bounces.length ? <ul className="owner-list">{data.bounces.slice(0, 20).map((person) => <li key={`${person.email}-${person.at}`}>
        <p className="text-sm font-semibold owner-ink">{person.company}</p>
        <p className="owner-meta break-all">{person.email} · {whenText(person.at)}</p>
      </li>)}</ul> : <Empty>Nothing bounced.</Empty>}
    </Panel>
  </OwnerPage>;
}
