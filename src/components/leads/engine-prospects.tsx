import { ExternalLink } from "lucide-react";

import type { EngineProspect, EngineRunReview } from "@/lib/revenue-engine/engine-run-review";

import { ProspectDecisionButtons } from "./prospect-decision-buttons";

const title = (value: string) => value === "HVAC" ? value : value.charAt(0) + value.slice(1).toLowerCase();
const REASON_TEXT: Record<string, string> = {
  WEBSITE_ALREADY_FINE: "website is fine", NOT_LOCAL_OR_CHAIN: "not local or a chain", WRONG_TRADE: "wrong trade",
  ALREADY_A_CUSTOMER_OR_CONTACTED: "already known", OTHER: "other",
};

function Prospect({ prospect }: { prospect: EngineProspect }) {
  return <li className="rounded-xl border border-border/70 bg-card p-4">
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <p className="font-semibold">{prospect.name}</p>
      <p className="text-xs text-muted-foreground">{title(prospect.city)} · {title(prospect.niche)}</p>
    </div>
    <ul className="mt-2 space-y-1 text-sm">{prospect.reasons.map((reason) => <li key={reason} className="flex gap-2"><span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-rose-500" aria-hidden="true" />{reason}</li>)}</ul>
    <a href={prospect.websiteUrl} target="_blank" rel="noreferrer noopener" className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary underline-offset-4 hover:underline">
      Open their website <ExternalLink className="size-3" aria-hidden="true" />
    </a>
    {prospect.decision?.decision === "WORTH_A_CALL" && prospect.callNotes.length ? <details className="mt-2 rounded-lg bg-muted/40 p-3 text-sm">
      <summary className="cursor-pointer font-medium">What to mention on the call (draft)</summary>
      <ul className="mt-2 list-disc space-y-1 pl-5">{prospect.callNotes.map((note) => <li key={note}>{note}</li>)}</ul>
      <p className="mt-2 text-xs text-muted-foreground">Only say what you can see on their site yourself. No promises about results or pricing until the offer is approved.</p>
    </details> : null}
    {prospect.decision
      ? <p className="mt-2 text-xs font-medium">{prospect.decision.decidedBy === "RILEY" ? "Riley" : "Aidan"}: {prospect.decision.decision === "WORTH_A_CALL" ? "worth a call" : `not a fit (${REASON_TEXT[prospect.decision.reason ?? "OTHER"]})`}</p>
      : <ProspectDecisionButtons websiteUrl={prospect.websiteUrl} />}
  </li>;
}

/** The engine's short list for owners: who, where, the plain reasons, and one decision each. */
export function EngineProspects({ review }: { review: EngineRunReview }) {
  if (review.status !== "READY") return null;
  const { counts } = review;
  const when = new Intl.DateTimeFormat("en-CA", { dateStyle: "medium", timeZone: "America/Toronto" }).format(new Date(review.finishedAt));
  const open = review.prospects.filter((prospect) => !prospect.decision);
  const decided = review.prospects.filter((prospect) => prospect.decision);
  return <section aria-labelledby="engine-prospects-heading" className="mx-auto w-full max-w-5xl space-y-4 px-4 pt-6">
    <div className="space-y-1">
      <h2 id="engine-prospects-heading" className="text-xl font-semibold">Prospects found by the engine</h2>
      <p className="text-sm text-muted-foreground">
        Checked {counts.discovered ?? 0} local businesses on {when}: {counts.prospects ?? 0} with a website problem worth raising, {counts.fine ?? 0} already fine, {counts.notTargets ?? 0} not real local targets{counts.notChecked ? `, ${counts.notChecked} could not be loaded` : ""}.
      </p>
      <p className="text-xs text-muted-foreground">Found and checked automatically. Nobody has been contacted, and a website problem is not permission to contact anyone.</p>
    </div>
    {open.length === 0
      ? <p className="text-sm">{review.prospects.length ? "Every prospect from this run has a decision." : "No new prospects this run."}</p>
      : <ul className="space-y-2">{open.map((prospect) => <Prospect key={prospect.key} prospect={prospect} />)}</ul>}
    {decided.length ? <details className="rounded-xl border border-border/70 bg-card p-4">
      <summary className="cursor-pointer text-sm font-medium">Decided ({decided.length})</summary>
      <ul className="mt-3 space-y-2">{decided.map((prospect) => <Prospect key={prospect.key} prospect={prospect} />)}</ul>
    </details> : null}
  </section>;
}
