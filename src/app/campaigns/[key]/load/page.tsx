import type { Metadata, Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, FileUp } from "lucide-react";

import { LoadListForm } from "@/components/campaigns/load-list-form";
import { Empty, Notice, OwnerPage, PageHeader, Panel } from "@/components/owner/kit";
import { getDatabase } from "@/lib/cloudflare";
import { SCREEN_MAX_ROWS } from "@/lib/outreach/outreach-load";
import { SCREEN_DOMAIN_LIMIT } from "@/lib/outreach/outreach-mail-servers";
import { readCampaign, type Campaign } from "@/lib/outreach/outreach-model";
import { ownerForAccount } from "@/lib/owner-login";
import type { ProspectDb } from "@/lib/revenue-engine/engine-prospects-d1";
import { requireSession } from "@/lib/session";
import { withTimeout } from "@/lib/timeout";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Load a list | Axiom Revenue Engine" };

/** Either founder loads a list (and, if needed, new words) for a campaign. It waits for the campaign's approver. */
export default async function LoadListPage({ params }: { params: Promise<{ key: string }> }) {
  const session = await requireSession();
  const { key } = await params;
  let campaign: Campaign | null;
  try {
    campaign = await withTimeout(readCampaign(getDatabase() as unknown as ProspectDb, key), 12_000, "campaign");
  } catch {
    return <OwnerPage>
      <PageHeader eyebrow="Campaign" title="Load a list" />
      <Notice tone="warning" icon={AlertTriangle} title="This campaign couldn't be loaded." role="status">Refresh in a minute.</Notice>
    </OwnerPage>;
  }
  if (!campaign) notFound();
  const owner = ownerForAccount(session.user.email ?? "");
  const [first, second] = campaign.words.steps;
  const approvers = campaign.approvers.join(" or ") || "its approver";

  return <OwnerPage>
    <PageHeader eyebrow={<Link href={`/campaigns/${campaign.key}` as Route} className="hover:underline">{campaign.name}</Link>} title="Load a list"
      description={`Check a list against this campaign's words and rules, then load it as a batch. Nothing in it sends until ${approvers} reads its samples and approves it.`} />
    {owner
      ? <Panel title="The list and its words" icon={FileUp}
        description={`Up to ${SCREEN_MAX_ROWS} rows and ${SCREEN_DOMAIN_LIMIT} different email domains at a time. Every row that can't go is held with the reason: a bad or repeated address, a blank the words use, a rule it fails, a domain with no mail server, or someone on the do-not-email list.`}>
        <LoadListForm campaign={campaign.key} first={first ? `Subject: ${first.subject}\n\n${first.body}` : ""} followUp={second?.body ?? ""}
          approvers={approvers} hasFollowUp={campaign.followUps > 0} />
      </Panel>
      : <Panel><Empty>Only Riley or Aidan can load lists.</Empty></Panel>}
  </OwnerPage>;
}
