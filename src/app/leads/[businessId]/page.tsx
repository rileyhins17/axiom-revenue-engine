import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { OwnerLeadDetail, OwnerLeadDetailUnavailable } from "@/components/leads/owner-lead-detail";
import { OwnerBusinessStopPanel } from "@/components/leads/owner-business-stop-panel";
import { OwnerContactSuppressionPanel } from "@/components/leads/owner-contact-suppression-panel";
import { OwnerObservedReplyPanel } from "@/components/leads/owner-observed-reply-panel";
import { OwnerTaskPanel } from "@/components/leads/owner-task-panel";
import { getDatabase } from "@/lib/cloudflare";
import {
  readOwnerLeadDetail,
  type OwnerLeadDetailResponse,
} from "@/lib/revenue-engine/owner-lead-detail-read-model";
import { parseOwnerLeadBusinessIdRouteParam } from "@/lib/revenue-engine/owner-lead-identity";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Business details | Axiom Revenue Engine" };

export default async function LeadDetailPage({
  params,
}: {
  params: Promise<{ businessId: string }>;
}) {
  await requireSession();
  const routeParams = await params;
  const identity = parseOwnerLeadBusinessIdRouteParam(routeParams.businessId);
  if (!identity) notFound();

  let detail: OwnerLeadDetailResponse | null;
  try {
    detail = await readOwnerLeadDetail(getDatabase(), identity, new Date().toISOString());
  } catch {
    return <OwnerLeadDetailUnavailable />;
  }
  if (!detail) notFound();
  const contactPoints = detail.routes.map((route) => ({
    contactPointId: route.contactPointId,
    businessId: route.businessId,
    channel: route.channel,
    label: route.label,
    value: route.value,
  }));

  return (
    <OwnerLeadDetail
      data={detail}
      ownerControls={(
        <>
          <OwnerBusinessStopPanel businessId={identity} />
          <div className="grid gap-4">
            <OwnerObservedReplyPanel businessId={identity} stopState={detail.operationalStopState ?? "UNAVAILABLE"} contactPoints={contactPoints} />
            <OwnerTaskPanel businessId={identity} stopState={detail.operationalStopState ?? "UNAVAILABLE"} />
          </div>
        </>
      )}
      contactControls={<OwnerContactSuppressionPanel businessId={identity} contactPoints={contactPoints} />}
    />
  );
}
