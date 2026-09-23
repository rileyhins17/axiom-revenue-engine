import { ExternalLink } from "lucide-react";

import type { EngineRunReview } from "@/lib/revenue-engine/engine-run-review";

const title = (value: string) => value === "HVAC" ? value : value.charAt(0) + value.slice(1).toLowerCase();

/** The engine's short list for owners: who, where, and the plain reasons. */
export function EngineProspects({ review }: { review: EngineRunReview }) {
  if (review.status !== "READY") return null;
  const { counts } = review;
  const when = new Intl.DateTimeFormat("en-CA", { dateStyle: "medium", timeZone: "America/Toronto" }).format(new Date(review.finishedAt));
  return <section aria-labelledby="engine-prospects-heading" className="mx-auto w-full max-w-5xl space-y-4 px-4 pt-6">
    <div className="space-y-1">
      <h2 id="engine-prospects-heading" className="text-xl font-semibold">Prospects found by the engine</h2>
      <p className="text-sm text-muted-foreground">
        Checked {counts.discovered ?? 0} local businesses on {when}: {counts.prospects ?? 0} with a website problem worth raising, {counts.fine ?? 0} already fine, {counts.notTargets ?? 0} not real local targets{counts.notChecked ? `, ${counts.notChecked} could not be loaded` : ""}.
      </p>
      <p className="text-xs text-muted-foreground">Found and checked automatically. Nobody has been contacted, and a website problem is not permission to contact anyone.</p>
    </div>
    {review.prospects.length === 0 ? <p className="text-sm">No new prospects this run.</p> : <ul className="space-y-2">
      {review.prospects.map((prospect) => <li key={prospect.key} className="rounded-xl border border-border/70 bg-card p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="font-semibold">{prospect.name}</p>
          <p className="text-xs text-muted-foreground">{title(prospect.city)} · {title(prospect.niche)}</p>
        </div>
        <ul className="mt-2 space-y-1 text-sm">{prospect.reasons.map((reason) => <li key={reason} className="flex gap-2"><span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-rose-500" aria-hidden="true" />{reason}</li>)}</ul>
        <a href={prospect.websiteUrl} target="_blank" rel="noreferrer noopener" className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary underline-offset-4 hover:underline">
          Open their website <ExternalLink className="size-3" aria-hidden="true" />
        </a>
      </li>)}
    </ul>}
  </section>;
}
