import type { Metadata } from "next";

import { AskChat } from "@/components/ai/ask-chat";
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
  return <section className="mx-auto w-full max-w-5xl space-y-4 px-4 py-6 sm:px-6">
    <header className="flex flex-wrap items-end justify-between gap-2">
      <div>
        <h1 className="text-2xl font-semibold">Ask AI</h1>
        <p className="text-sm text-slate-600">Gemini 3.1 Flash-Lite, answering from your live data.</p>
      </div>
      <p className="text-xs text-slate-600">AI spend this month: US${(spend?.spentUsd ?? 0).toFixed(2)} of ${budget.toFixed(2)}</p>
    </header>
    <AskChat aiReady={aiReady} firstName={firstName} />
  </section>;
}
