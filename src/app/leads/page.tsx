import { OwnerLeadList, OwnerLeadsUnavailable } from "@/components/leads/owner-lead-list";
import { getDatabase } from "@/lib/cloudflare";
import {
  readOwnerLeadList,
  type OwnerLeadListResponse,
} from "@/lib/revenue-engine/owner-lead-read-model";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function LeadsPage() {
  await requireSession();

  let leads: OwnerLeadListResponse;
  try {
    leads = await readOwnerLeadList(getDatabase(), new Date().toISOString(), 50);
  } catch {
    return <OwnerLeadsUnavailable />;
  }

  return <OwnerLeadList data={leads} />;
}
