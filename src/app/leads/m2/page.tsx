import type { Metadata } from "next";

import { M2OwnerConsole } from "@/components/leads/m2-owner-console";
import { readLocalM2OwnerConsole } from "@/lib/revenue-engine/m2-local-owner-console";
import { requireAdminSession } from "@/lib/session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "M2 Local Review | Axiom Revenue Engine" };

export default async function M2OwnerReviewPage() {
  await requireAdminSession();
  const result = await readLocalM2OwnerConsole();
  return <M2OwnerConsole result={result} />;
}
