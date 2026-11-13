import type { Metadata } from "next";
import { AlertTriangle, CheckCircle2, Search, ShieldBan } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { Empty, Notice, OwnerPage, PageHeader, Panel, StatCard } from "@/components/owner/kit";
import { getDatabase } from "@/lib/cloudflare";
import { whenText } from "@/lib/outreach/outreach-format";
import { checkDoNotEmail, recentBlocks, type DoNotEmailCheck } from "@/lib/outreach/outreach-lookup";
import type { ProspectDb } from "@/lib/revenue-engine/engine-prospects-d1";
import { requireSession } from "@/lib/session";
import { withTimeout } from "@/lib/timeout";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Do-not-email list | Axiom Revenue Engine" };

/** Is an address or a whole domain blocked from every campaign, why, since when, and in which campaign. Read-only. */
export default async function DoNotEmailPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requireSession();
  const query = ((await searchParams).q ?? "").trim().slice(0, 254);
  let check: DoNotEmailCheck | null = null;
  let recent: Awaited<ReturnType<typeof recentBlocks>>;
  try {
    const db = getDatabase() as unknown as ProspectDb;
    [check, recent] = await withTimeout(Promise.all([query ? checkDoNotEmail(db, query) : Promise.resolve(null), recentBlocks(db, 30)]), 12_000, "do-not-email");
  } catch {
    return <OwnerPage>
      <PageHeader eyebrow="More" title="Do-not-email list" />
      <Notice tone="warning" icon={AlertTriangle} title="The list couldn't be loaded." role="status">Refresh in a minute.</Notice>
    </OwnerPage>;
  }
  return <OwnerPage>
    <PageHeader eyebrow="More" title="Do-not-email list"
      description="One list for every campaign. An address goes on it by itself when an email to it bounces or the person says no thanks, and then no campaign emails it again." />

    <Panel title="Check an address or a domain" icon={Search}>
      <form action="/do-not-email" method="get" className="owner-search" role="search">
        <input type="search" name="q" defaultValue={query} placeholder="clerk@example.gov or example.gov" aria-label="An email address or a domain" autoComplete="off" autoCapitalize="none" spellCheck={false} inputMode="email" />
        <button type="submit" className={buttonVariants({ size: "lg" })}><Search aria-hidden="true" /><span className="sr-only sm:not-sr-only">Check</span></button>
      </form>
      {check ? <div className="mt-4 space-y-4">
        {check.kind === "unreadable" ? <Notice tone="warning" icon={AlertTriangle} title="That isn't an address or a domain.">{check.summary}</Notice>
          : check.blocked ? <Notice tone="danger" icon={ShieldBan} title="Blocked" role="status">{check.summary}</Notice>
            : <Notice tone="success" icon={CheckCircle2} title="Not blocked" role="status">{check.summary}</Notice>}
        {check.reasons.length ? <ul className="owner-list">{check.reasons.map((reason, index) => <li key={`${reason.address}-${reason.kind}-${index}`}>
          <p className="text-sm font-semibold break-all owner-ink">{reason.address}</p>
          <p className="text-sm owner-text">{reason.why}{reason.campaign ? `, in ${reason.campaign}` : ""}{reason.at ? `, ${whenText(reason.at)}` : ""}.</p>
          {reason.detail ? <p className="owner-meta mt-1">{reason.detail}</p> : null}
        </li>)}</ul> : null}
        {check.organisation.length ? <Notice tone="info" title="The engine also holds new emails to this organisation.">
          Someone else there already answered: {check.organisation.map((person) => `${person.email} ${person.status} (${person.campaign})`).join("; ")}. A campaign won&rsquo;t email a second person at an organisation after that.
        </Notice> : null}
      </div> : null}
    </Panel>

    <div className="grid grid-cols-3 gap-3 sm:gap-4">
      <StatCard label="On the list" value={recent.total} />
      <StatCard label="Bounced" value={recent.bounced} />
      <StatCard label="No thanks" value={recent.noThanks} />
    </div>

    <Panel title="Latest additions" icon={ShieldBan} count={recent.rows.length}>
      {recent.rows.length ? <ul className="owner-list">{recent.rows.map((row) => <li key={row.address}>
        <p className="text-sm font-semibold break-all owner-ink">{row.address}</p>
        <p className="owner-meta">{row.why}{row.at ? ` · ${whenText(row.at)}` : ""}</p>
      </li>)}</ul> : <Empty>Nobody is on the list yet.</Empty>}
    </Panel>

    <p className="owner-meta">Read-only, and permanent: nothing is ever taken off this list. To block someone by hand, ask Claude.</p>
  </OwnerPage>;
}
