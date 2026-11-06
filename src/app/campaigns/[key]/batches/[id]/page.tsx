import type { Metadata, Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, BadgeCheck, Lock, Mail, MailCheck, ShieldCheck } from "lucide-react";

import { BatchActions } from "@/components/campaigns/campaign-actions";
import { Badge, Empty, Notice, OwnerPage, PageHeader, Panel, StatCard, type Tone } from "@/components/owner/kit";
import { getCloudflareBindings, getDatabase } from "@/lib/cloudflare";
import { batchReview, type BatchReview } from "@/lib/outreach/outreach-status";
import { readTestResults } from "@/lib/outreach/outreach-tests";
import { ownerForAccount } from "@/lib/owner-login";
import type { ProspectDb } from "@/lib/revenue-engine/engine-prospects-d1";
import { requireSession } from "@/lib/session";
import { withTimeout } from "@/lib/timeout";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Batch | Axiom Revenue Engine" };

const when = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso));

function EmailCard({ label, from, to, subject, text }: { label: string; from: string; to: string; subject: string; text: string }) {
  return <div className="rounded-xl border border-[#e6e1d6] bg-[#fffdf8]">
    <div className="space-y-0.5 border-b border-[#efe9dc] px-4 py-3 text-sm">
      <p className="owner-meta">{label}</p>
      <p><span className="text-[#5c584f]">From:</span> {from}</p>
      <p className="break-all"><span className="text-[#5c584f]">To:</span> {to}</p>
      <p className="font-semibold"><span className="font-normal text-[#5c584f]">Subject:</span> {subject}</p>
    </div>
    <pre className="whitespace-pre-wrap px-4 py-3 font-sans text-sm leading-relaxed text-[#202c26]">{text}</pre>
  </div>;
}

export default async function BatchPage({ params }: { params: Promise<{ key: string; id: string }> }) {
  const session = await requireSession();
  const { key, id } = await params;
  const env = getCloudflareBindings() ?? {};
  const mailing = typeof env.FCC_CAMPAIGN_MAILING_ADDRESS === "string" ? env.FCC_CAMPAIGN_MAILING_ADDRESS : "";
  let review: BatchReview | null;
  let tests: Awaited<ReturnType<typeof readTestResults>>;
  try {
    const db = getDatabase() as unknown as ProspectDb;
    [review, tests] = await withTimeout(Promise.all([batchReview(db, id, mailing, 10), readTestResults(db)]), 12_000, "batch");
  } catch {
    return <OwnerPage>
      <PageHeader eyebrow="Batch" title="Batch" />
      <Notice tone="warning" icon={AlertTriangle} title="This batch couldn't be loaded." role="status">Refresh in a minute.</Notice>
    </OwnerPage>;
  }
  if (!review || review.campaign.key !== key) notFound();
  const { campaign, batch } = review;
  const owner = ownerForAccount(session.user.email ?? "");
  const canApprove = Boolean(owner && campaign.approvers.includes(owner.name));
  const status: { text: string; tone: Tone } = batch.status === "stopped" ? { text: "Stopped", tone: "neutral" }
    : batch.status === "approved" && batch.wordsCurrent ? { text: "Approved", tone: "success" }
      : batch.status === "approved" ? { text: "Words changed: approve again", tone: "warning" } : { text: "Waiting for approval", tone: "warning" };
  const myTests = [...tests.pending.filter((test) => test.batchId === id).map((test) => ({ ...test, sent: null as number | null, error: null as string | null })),
    ...tests.done.filter((test) => test.batchId === id)];

  return <OwnerPage>
    <PageHeader eyebrow={<Link href={`/campaigns/${campaign.key}` as Route} className="hover:underline">{campaign.name}</Link>} title={batch.name}
      status={<Badge tone={status.tone}>{status.text}</Badge>}
      description={`Loaded ${when(batch.loadedAt)} by ${batch.loadedBy}${batch.source ? ` from ${batch.source}` : ""}.`} />

    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
      <Panel title="Before you approve" icon={ShieldCheck}>
        <ul className="owner-list text-sm text-[#3b3a36]">
          <li>Below are the first {review.samples.length} emails of this batch exactly as they will go out: who they come from, who they go to, the subject and every word, footer included. Each follow-up goes {campaign.followUpBusinessDays} business days later in the same thread, only if they haven&rsquo;t replied.</li>
          <li>Every held row is listed with the reason. Held rows are never sent.</li>
          <li>Approving opens this batch for exactly these words. A batch&rsquo;s words never change: new words come with a new batch.</li>
          {batch.approvedBy && batch.approvedAt ? <li className="flex gap-2"><BadgeCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" />Approved by {batch.approvedBy}, {when(batch.approvedAt)}{batch.approvalNote ? `: ${batch.approvalNote}` : ""}.</li> : null}
        </ul>
      </Panel>
      <Panel title={canApprove ? "Approve" : "Approval"} icon={BadgeCheck}>
        {owner ? <BatchActions batch={batch.id} canApprove={canApprove} approvers={campaign.approvers.join(" or ")} status={batch.status} wordsCurrent={batch.wordsCurrent} />
          : <Empty>Only Riley or Aidan can act on a batch.</Empty>}
        {myTests.length ? <ul className="mt-4 space-y-1 text-sm text-[#5c584f]">{myTests.slice(0, 3).map((test) => <li key={test.id} className="flex gap-2">
          <Mail className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>{test.sent === null ? `Test for ${test.to} is queued (${when(test.at)}).` : test.error ? `Test to ${test.to} failed: ${test.error}.` : `Test sent to ${test.to}, ${when(test.at)}: ${test.sent} emails.`}</span>
        </li>)}</ul> : null}
      </Panel>
    </div>

    <div className="grid grid-cols-3 gap-3 sm:gap-4">
      <StatCard icon={MailCheck} label="Ready" value={batch.ready} detail="Will get emails once approved" />
      <StatCard icon={Lock} label="Held" value={batch.held} detail="Never sent" />
      <StatCard icon={Mail} label="Emailed" value={batch.emailed} detail={`${batch.stopped} stopped`} />
    </div>

    <Panel title="Sample emails, exactly as they will go out" icon={Mail} count={review.samples.length}>
      {review.samples.length ? <ol className="space-y-6">{review.samples.map((sample) => <li key={sample.row} className="space-y-3">
        <p className="text-sm font-semibold">Row {sample.row}</p>
        {sample.problem ? <Notice tone="danger" icon={AlertTriangle} title="This row can't be written as approved.">{sample.problem}</Notice> : null}
        {sample.first ? <EmailCard label="First email" from={sample.from} to={sample.to} subject={sample.first.subject} text={sample.first.text} /> : null}
        {sample.followUp ? <EmailCard label={`Follow-up, ${campaign.followUpBusinessDays} business days later, only if no reply`} from={sample.from} to={sample.to} subject={sample.followUp.subject} text={sample.followUp.text} /> : null}
      </li>)}</ol> : <Empty>No row in this batch can be sent.</Empty>}
    </Panel>

    <Panel title="Held rows" icon={Lock} count={review.held.length} flush description="These are never sent.">
      {review.held.length ? <div className="overflow-x-auto"><table className="owner-table min-w-[520px]">
        <thead><tr><th>Row</th><th>Email</th><th>Why it&rsquo;s held</th></tr></thead>
        <tbody>{review.held.map((row) => <tr key={row.row}><td className="tabular-nums">{row.row}</td><td className="break-all">{row.email}</td><td>{row.reason}</td></tr>)}</tbody>
      </table></div> : <div className="px-5 py-6 sm:px-6"><Empty>Nothing held.</Empty></div>}
    </Panel>
  </OwnerPage>;
}
