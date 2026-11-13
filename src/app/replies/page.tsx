import type { Metadata } from "next";
import { AlertTriangle, Archive, MessageSquareReply } from "lucide-react";

import { Badge, Chips, Empty, Facts, Notice, OwnerPage, PageHeader, Panel, type Tone } from "@/components/owner/kit";
import { ReplyActions } from "@/components/replies/reply-actions";
import { getDatabase } from "@/lib/cloudflare";
import { shortWhen, whenText } from "@/lib/outreach/outreach-format";
import { FCC_FILTER, REPLY_FILTERS, listReplies, type ReplyFilter, type ReplyList, type ReplyRow } from "@/lib/outreach/outreach-reply-list";
import { ownerForAccount } from "@/lib/owner-login";
import type { ProspectDb } from "@/lib/revenue-engine/engine-prospects-d1";
import { requireSession } from "@/lib/session";
import { withTimeout } from "@/lib/timeout";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Replies | Axiom Revenue Engine" };

const FILTER_TEXT: Record<ReplyFilter, string> = { "to-answer": "To answer", answered: "Answered", "no-thanks": "No thanks", automatic: "Automatic", all: "All" };
const FILTER_ORDER: ReplyFilter[] = ["to-answer", "answered", "no-thanks", "automatic", "all"];
const EMPTY: Record<ReplyFilter, string> = {
  "to-answer": "Nobody is waiting for an answer.",
  answered: "No reply has been marked answered yet.",
  "no-thanks": "Nobody has said no thanks.",
  automatic: "No automatic replies.",
  all: "No replies yet. The inboxes are read every hour from 7 a.m. to 9 p.m.",
};
const KIND: Record<ReplyRow["kind"], { text: string; tone: Tone }> = {
  reply: { text: "Wrote back", tone: "gold" }, no_thanks: { text: "No thanks", tone: "neutral" }, automatic: { text: "Automatic", tone: "neutral" },
};

const href = (filter: ReplyFilter, campaign: string | null) => {
  const params = new URLSearchParams();
  if (filter !== "to-answer") params.set("filter", filter);
  if (campaign) params.set("campaign", campaign);
  const query = params.toString();
  return query ? `/replies?${query}` : "/replies";
};

/** Every reply the engine recorded, newest first: who wrote, what they said, and which inbox to answer from. */
export default async function RepliesPage({ searchParams }: { searchParams: Promise<{ filter?: string; campaign?: string }> }) {
  const session = await requireSession();
  const params = await searchParams;
  const filter = REPLY_FILTERS.includes(params.filter as ReplyFilter) ? params.filter as ReplyFilter : "to-answer";
  const campaign = params.campaign?.trim().slice(0, 40) || null;
  const founder = Boolean(ownerForAccount(session.user.email ?? ""));
  const now = new Date();

  let list: ReplyList;
  try {
    list = await withTimeout(listReplies(getDatabase() as unknown as ProspectDb, { filter, campaign, limit: 100 }), 12_000, "replies");
  } catch {
    return <OwnerPage>
      <PageHeader eyebrow="Replies" title="Replies" />
      <Notice tone="warning" icon={AlertTriangle} title="The replies couldn't be loaded." role="status">Refresh in a minute.</Notice>
    </OwnerPage>;
  }
  const fcc = campaign === FCC_FILTER;
  const campaigns = list.campaigns.filter((row) => row.replies > 0 || row.key === campaign);

  return <OwnerPage>
    <PageHeader eyebrow="Replies" title="Replies"
      description="Everyone who wrote back to any campaign, newest first. Answer from the inbox that sent them the email, so the thread holds; then mark it answered here." />

    <div className="space-y-2.5">
      {fcc ? null : <Chips label="Kind of reply" items={FILTER_ORDER.map((name) => ({ href: href(name, campaign), text: FILTER_TEXT[name], count: list.counts[name], active: name === filter }))} />}
      {campaigns.length > 1 || list.fccReplies > 0 || campaign ? <Chips label="Campaign" items={[
        { href: href(filter, null), text: "Every campaign", active: !campaign },
        ...campaigns.map((row) => ({ href: href(filter, row.key), text: row.name, count: row.replies, active: campaign === row.key })),
        ...(list.fccReplies > 0 || fcc ? [{ href: href("all", FCC_FILTER), text: "FCC (ended)", count: list.fccReplies, active: fcc }] : []),
      ]} /> : null}
    </div>

    {fcc ? <Notice tone="info" icon={Archive} title="FCC ended on Nov 12, 2026.">Its replies are kept here to read. They can&rsquo;t be marked, and nothing more is sent to anyone on that list.</Notice> : null}

    <Panel title={fcc ? "FCC replies" : FILTER_TEXT[filter]} icon={MessageSquareReply} count={list.rows.length} flush>
      {list.rows.length ? <div>
        {list.rows.map((reply) => <details key={reply.id} className="owner-reply">
          <summary>
            <span className="owner-reply-head">
              <span className="owner-reply-who">{reply.organisation}{reply.person ? <span className="font-normal owner-text"> · {reply.person}</span> : null}</span>
              <span className="owner-reply-when">{shortWhen(reply.at, now)}</span>
            </span>
            <span className="owner-meta flex flex-wrap items-center gap-x-2 gap-y-1">
              <Badge tone={reply.answeredAt ? "success" : KIND[reply.kind].tone}>{reply.answeredAt ? `Answered${reply.answeredBy ? ` by ${reply.answeredBy}` : ""}` : KIND[reply.kind].text}</Badge>
              {reply.success ? <Badge tone="gold">{reply.successLabel}</Badge> : null}
              <span>{reply.campaign}</span>
            </span>
            {reply.kind === "reply" && reply.answerFromName && !reply.answeredAt ? <span className="owner-meta">Answer from <b className="owner-ink">{reply.answerFromName}&rsquo;s inbox</b></span> : null}
            <span className="owner-reply-preview">{reply.text ?? "Open it in Gmail to read what they wrote."}</span>
          </summary>
          <div className="owner-reply-body">
            <p className="owner-reply-text">{reply.text ?? "The reply check stored no text for this one. Open it in Gmail to read it."}</p>
            <Facts items={[
              { label: "From", value: reply.from },
              ...(reply.from !== reply.email ? [{ label: "We emailed", value: reply.email }] : []),
              { label: "When", value: whenText(reply.at) },
              ...(reply.answerFrom ? [{ label: "Answer from", value: `${reply.answerFromName}'s inbox (${reply.answerFrom})` }] : []),
              ...(reply.landedIn && reply.landedIn !== reply.answerFrom ? [{ label: "It came to", value: reply.landedIn }] : []),
              ...(reply.answeredAt ? [{ label: "Marked answered", value: `${reply.answeredBy ?? "A founder"}, ${whenText(reply.answeredAt)}` }] : []),
            ]} />
            {founder ? <ReplyActions id={reply.id} kind={reply.kind} answered={Boolean(reply.answeredAt)} success={reply.success} successLabel={reply.successLabel || "the success number"}
              gmailUrl={reply.gmailUrl} canMark={reply.canMark} /> : null}
          </div>
        </details>)}
      </div> : <div className="px-5 py-6 sm:px-6"><Empty>{fcc ? "FCC has no replies of this kind." : EMPTY[filter]}</Empty></div>}
    </Panel>

    <p className="owner-meta">The engine only reads the inboxes. Marking a reply here changes nothing in Gmail and sends nothing. What is shown is the first part of each message; the whole thread is in Gmail.</p>
  </OwnerPage>;
}
