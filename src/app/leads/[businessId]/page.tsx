import { notFound } from "next/navigation";

import { OwnerLeadDetail, OwnerLeadDetailUnavailable } from "@/components/leads/owner-lead-detail";
import { getDatabase } from "@/lib/cloudflare";
import {
  OwnerLeadBusinessIdSchema,
  readOwnerLeadDetail,
  type OwnerLeadDetailResponse,
} from "@/lib/revenue-engine/owner-lead-detail-read-model";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function LeadDetailPage({
  params,
}: {
  params: Promise<{ businessId: string }>;
}) {
  await requireSession();
  const routeParams = await params;
  const identity = OwnerLeadBusinessIdSchema.safeParse(routeParams.businessId);
  if (!identity.success) notFound();

  let detail: OwnerLeadDetailResponse | null;
  try {
    detail = await readOwnerLeadDetail(getDatabase(), identity.data, new Date().toISOString());
  } catch {
    return <OwnerLeadDetailUnavailable />;
  }
  if (!detail) notFound();

  return <OwnerLeadDetail data={detail} />;
}
