import { ExternalLink, Smartphone } from "lucide-react";

import type { M2WebsiteNeedReview, M2WebsiteNeedReviewRow } from "@/lib/revenue-engine/m2-website-need-review";

const needStyle: Record<M2WebsiteNeedReviewRow["need"], { label: string; className: string; dot: string }> = {
  REBUILD: { label: "Worth a rebuild conversation", className: "bg-emerald-50 text-emerald-800 ring-emerald-200", dot: "bg-emerald-500" },
  MINOR_IMPROVEMENT: { label: "Small fixes only", className: "bg-amber-50 text-amber-800 ring-amber-200", dot: "bg-amber-500" },
  NO_OPPORTUNITY: { label: "Website already works", className: "bg-slate-100 text-slate-700 ring-slate-200", dot: "bg-slate-400" },
  INCOMPLETE: { label: "Review incomplete", className: "bg-slate-100 text-slate-700 ring-slate-200", dot: "bg-slate-400" },
  NOT_REVIEWED: { label: "Not reviewed yet", className: "bg-slate-100 text-slate-700 ring-slate-200", dot: "bg-slate-400" },
};

function host(value: string) {
  try { return new URL(value).hostname.replace(/^www\./, ""); } catch { return "Website"; }
}

function Row({ row }: { row: M2WebsiteNeedReviewRow }) {
  const style = needStyle[row.need];
  const open = row.need === "REBUILD";
  return <li className="rounded-xl border border-border/70 bg-card">
    <details open={open} className="group">
      <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 p-4">
        <div className="min-w-0">
          <p className="truncate font-semibold">{row.businessName}</p>
          <p className="text-xs text-muted-foreground">{host(row.websiteUrl)}{row.evidenceConfidence ? ` · ${row.evidenceConfidence.toLowerCase()} confidence` : ""}</p>
        </div>
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ring-inset ${style.className}`}>
          <span className={`size-1.5 rounded-full ${style.dot}`} aria-hidden="true" />{style.label}
        </span>
      </summary>
      {row.rationale ? <div className="space-y-3 border-t border-border/60 p-4 text-sm">
        <p>{row.rationale}</p>
        {row.issues.length > 0 ? <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">What we saw</p>
          <ul className="space-y-1.5">
            {row.issues.map((issue) => <li key={issue.text} className="flex gap-2">
              <span className={`mt-1.5 size-1.5 shrink-0 rounded-full ${issue.severity === "MINOR" ? "bg-slate-400" : "bg-rose-500"}`} aria-hidden="true" />
              <span>{issue.text}{issue.onPhone ? <Smartphone className="ml-1 inline size-3.5 text-muted-foreground" aria-label="seen on a phone" /> : null}</span>
            </li>)}
          </ul>
        </div> : null}
        {row.strengths.length > 0 ? <p className="text-muted-foreground"><span className="font-medium text-foreground">Already good: </span>{row.strengths.join(" ")}</p> : null}
        {row.fitNote ? <p className="text-muted-foreground"><span className="font-medium text-foreground">Business fit: </span>{row.fitNote}</p> : null}
        <a href={row.websiteUrl} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-xs font-medium text-primary underline-offset-4 hover:underline">
          Open their website <ExternalLink className="size-3" aria-hidden="true" />
        </a>
      </div> : null}
    </details>
  </li>;
}

/** Plain owner summary of the delegated website reviews. Display only; it grants no contact authority. */
export function M2WebsiteNeedReviewSection({ review }: { review: M2WebsiteNeedReview }) {
  if (review.status !== "READY") return null;
  const { counts } = review;
  const reviewed = review.rows.length - counts.NOT_REVIEWED;
  return <section aria-labelledby="website-review-heading" className="mx-auto w-full max-w-5xl space-y-4 px-4 py-6">
    <div className="space-y-1">
      <h2 id="website-review-heading" className="text-xl font-semibold">Website reviews</h2>
      <p className="text-sm text-muted-foreground">
        {reviewed} of {review.rows.length} businesses reviewed on desktop and phone. {counts.REBUILD} worth a rebuild conversation, {counts.MINOR_IMPROVEMENT} with small fixes only, {counts.NO_OPPORTUNITY} already have a working website.
      </p>
      <p className="text-xs text-muted-foreground">Reviewed by Claude on Riley&apos;s behalf and not yet confirmed by an owner. A website problem is not permission to contact anyone.</p>
    </div>
    <ul className="space-y-2">{review.rows.map((row) => <Row key={row.reviewId} row={row} />)}</ul>
  </section>;
}
