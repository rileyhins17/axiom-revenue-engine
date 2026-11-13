import type { Metadata, Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, BadgeCheck, Lock, Mail, ShieldCheck } from "lucide-react";

import { ApproveDock, BatchActions } from "@/components/campaigns/campaign-actions";
import { Badge, Empty, Notice, OwnerPage, PageHeader, Panel, StatCard, type Tone } from "@/components/owner/kit";
import { getDatabase } from "@/lib/cloudflare";
import { engineSetting } from "@/lib/engine-settings";
import { plural, whenText } from "@/lib/outreach/outreach-format";
import { batchReview, type BatchReview } from "@/lib/outreach/outreach-status";
import { readTestResults } from "@/lib/outreach/outreach-tests";
import { ownerForAccount } from "@/lib/owner-login";
import type { ProspectDb } from "@/lib/revenue-engine/engine-prospects-d1";
import { requireSession } from "@/lib/session";
import { withTimeout } from "@/lib/timeout";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Batch | Axiom Revenue Engine" };

function EmailCard({ label, from, to, subject, text }: { label: string; from: string; to: string; subject: string; text: string }) {
  return <div className="owner-email">
    <div className="owner-email-head">
      <p className="owner-meta">{label}</p>
      <p className="[overflow-wrap:anywhere]"><span>From:</span> {from}</p>
      <p className="[overflow-wrap:anywhere]"><span>To:</span> {to}</p>
      <p><span>Subject:</span> <b>{subject}</b></p>
    </div>
    <pre className="owner-email-body">{text}</pre>
  </div>;
}

/** One batch as its approver reads it: 10 emails exactly as they will go out, every held row with its reason, then Approve. */
export default async function BatchPage({ params }: { params: Promise<{ key: string; id: string }> }) {
  const session = await requireSession();
  const { key, id } = await params;
  let review: BatchReview | null;
  let tests: Awaited<ReturnType<typeof readTestResults>>;
  try {
    const db = getDatabase() as unknown as ProspectDb;
    [review, tests] = await withTimeout(Promise.all([batchReview(db, id, engineSetting("FCC_CAMPAIGN_MAILING_ADDRESS"), 10), readTestResults(db)]), 12_000, "batch");
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
  const approved = batch.status === "approved" && batch.wordsCurrent;
  const wordsChanged = batch.status === "approved" && !batch.wordsCurrent;
  const approvers = campaign.approvers.join(" or ") || "its approver";
  const status: { text: string; tone: Tone } = batch.status === "stopped" ? { text: "Stopped", tone: "neutral" }
    : approved ? { text: "Approved", tone: "success" }
      : wordsChanged ? { text: "Words changed: approve again", tone: "warning" } : { text: `Waits for ${approvers}`, tone: "warning" };
  const showDock = canApprove && batch.status !== "stopped" && !approved && batch.ready > 0;
  const myTests = [...tests.pending.filter((test) => test.batchId === id).map((test) => ({ ...test, sent: null as number | null, error: null as string | null })),
    ...tests.done.filter((test) => test.batchId === id)];

  return <OwnerPage className={showDock ? "owner-has-dock" : undefined}>
    <PageHeader eyebrow={<Link href={`/campaigns/${campaign.key}` as Route} className="hover:underline">{campaign.name}</Link>} title={batch.name}
      status={<Badge tone={status.tone}>{status.text}</Badge>}
      description={`Loaded ${whenText(batch.loadedAt)} by ${batch.loadedBy}${batch.source ? ` ${batch.source}` : ""}.`} />

    <div className="grid grid-cols-3 gap-3 sm:gap-4">
      <StatCard label={approved ? "Still to go" : "Ready"} value={batch.ready} detail={approved ? "Go at the send times" : "Go once approved"} />
      <StatCard label="Held" value={batch.held} detail="Never sent" />
      <StatCard label="Emailed" value={batch.emailed} detail={`${batch.stopped} stopped`} />
    </div>

    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
      <Panel title={approved ? "What was approved" : "Before you approve"} icon={ShieldCheck}>
        <ul className="owner-list text-sm owner-text">
          <li>Below are the first {review.samples.length} emails of this batch exactly as they {approved ? "go" : "will go"} out: who they come from, who they go to, the subject and every word, footer included.</li>
          {campaign.followUps ? <li>Each follow-up goes {campaign.followUpBusinessDays} business days later in the same thread, only if they haven&rsquo;t replied.</li> : null}
          <li>Every held row is listed with its reason at the bottom. Held rows are never sent.</li>
          <li>Approving opens this batch for exactly these words. A batch&rsquo;s words never change: new words come with a new batch.</li>
          {batch.approvedBy && batch.approvedAt ? <li className="flex gap-2"><BadgeCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" />Approved by {batch.approvedBy}, {whenText(batch.approvedAt)}{batch.approvalNote ? `: ${batch.approvalNote}` : ""}.</li> : null}
        </ul>
      </Panel>
      <Panel title="This batch" icon={BadgeCheck}>
        {owner ? <BatchActions batch={batch.id} canApprove={canApprove} approvers={approvers} status={batch.status} wordsCurrent={batch.wordsCurrent} />
          : <Empty>Only Riley or Aidan can act on a batch.</Empty>}
        {myTests.length ? <ul className="mt-4 space-y-1 text-sm" style={{ color: "var(--owner-muted)" }}>{myTests.slice(0, 3).map((test) => <li key={test.id} className="flex gap-2">
          <Mail className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>{test.sent === null ? `A test for your own inbox is queued (${whenText(test.at)}).` : test.error ? `A test failed: ${test.error}.` : `Test sent, ${whenText(test.at)}: ${plural(test.sent, "email")}.`}</span>
        </li>)}</ul> : null}
      </Panel>
    </div>

    <Panel title="Sample emails, exactly as they go out" icon={Mail} count={review.samples.length}>
      {review.samples.length ? <ol className="space-y-7">{review.samples.map((sample, index) => <li key={sample.row} className="space-y-3">
        <p className="owner-section-label">Sample {index + 1} of {review!.samples.length} · row {sample.row}</p>
        {sample.problem ? <Notice tone="danger" icon={AlertTriangle} title="This row can't be written as approved.">{sample.problem}</Notice> : null}
        {sample.first ? <EmailCard label="First email" from={sample.from} to={sample.to} subject={sample.first.subject} text={sample.first.text} /> : null}
        {sample.followUp ? <EmailCard label={`Follow-up, ${campaign.followUpBusinessDays} business days later, only if no reply`} from={sample.from} to={sample.to} subject={sample.followUp.subject} text={sample.followUp.text} /> : null}
      </li>)}</ol> : <Empty>No row in this batch can be sent.</Empty>}
    </Panel>

    <Panel title="Held rows" icon={Lock} count={review.held.length} description="These are never sent.">
      {review.held.length ? <ul className="owner-list">{review.held.map((row) => <li key={row.row}>
        <p className="text-sm font-semibold break-all owner-ink">Row {row.row}{row.email ? ` · ${row.email}` : ""}</p>
        <p className="text-sm owner-text">{row.reason}</p>
      </li>)}</ul> : <Empty>Nothing held.</Empty>}
    </Panel>

    {showDock ? <ApproveDock batch={batch.id} name={batch.name} emails={batch.ready} campaign={campaign.name} wordsChanged={wordsChanged} /> : null}
  </OwnerPage>;
}
