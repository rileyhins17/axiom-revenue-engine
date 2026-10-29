import type { Metadata } from "next";

import { AskChat } from "@/components/ai/ask-chat";
import { Badge, OwnerPage, PageHeader } from "@/components/owner/kit";
import { aiSpend } from "@/lib/ai/call-brief";
import { getCloudflareBindings, getDatabase } from "@/lib/cloudflare";
import type { ProspectDb } from "@/lib/revenue-engine/engine-prospects-d1";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Ask AI | Axiom Revenue Engine" };

export default async function AskPage() {
  const session = await requireSession();
  const env = (getCloudflareBindings() ?? {}) as Record<string, unknown>;
  const aiReady = typeof env.GEMINI_API_KEY === "string" && env.GEMINI_API_KEY.trim().length > 0;
  const budget = Number(env.AI_MONTHLY_BUDGET_USD ?? 5) || 5;
  const spend = await aiSpend(getDatabase() as unknown as ProspectDb).catch(() => null);
  const firstName = session.user.name?.split(" ")[0] || (session.user.email?.startsWith("aidan") ? "Aidan" : "Riley");
  return <OwnerPage>
    <PageHeader eyebrow="Assistant" title="Ask AI" description="Gemini 3.1 Flash-Lite, answering from your live data."
      actions={<Badge tone="neutral">AI spend this month: US${(spend?.spentUsd ?? 0).toFixed(2)} of ${budget.toFixed(2)}</Badge>} />
    <AskChat aiReady={aiReady} firstName={firstName} />
  </OwnerPage>;
}
