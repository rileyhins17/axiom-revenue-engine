import {
  AlertTriangle,
  ArrowUpRight,
  Ban,
  Building2,
  CheckCircle2,
  ExternalLink,
  FileSearch,
  Globe2,
  Mail,
  MapPin,
  MessageSquareText,
  Phone,
  RefreshCcw,
  Search,
  ShieldCheck,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";

import { PageHeader } from "@/components/ui/page-header";
import type { OwnerLeadProjection } from "@/lib/revenue-engine/owner-lead-projection";
import type { OwnerLeadListResponse } from "@/lib/revenue-engine/owner-lead-read-model";
import { cn } from "@/lib/utils";

const ATTENTION_COPY: Record<
  OwnerLeadProjection["attention"],
  { label: string; explanation: string; className: string; icon: LucideIcon }
> = {
  READY_FOR_REVIEW: {
    label: "Ready to review",
    explanation: "Current evidence supports an owner decision.",
    className: "border-emerald-400/25 bg-emerald-400/10 text-emerald-200",
    icon: CheckCircle2,
  },
  REVIEW: {
    label: "Review",
    explanation: "Worth a closer owner review before any outreach.",
    className: "border-sky-400/25 bg-sky-400/10 text-sky-200",
    icon: FileSearch,
  },
  RESEARCH: {
    label: "Research needed",
    explanation: "Promising signals exist, but the engine needs more proof.",
    className: "border-violet-400/25 bg-violet-400/10 text-violet-200",
    icon: Search,
  },
  NEEDS_REFRESH: {
    label: "Needs refresh",
    explanation: "Some evidence is stale or incomplete, so this lead cannot be trusted yet.",
    className: "border-amber-400/25 bg-amber-400/10 text-amber-100",
    icon: RefreshCcw,
  },
  BLOCKED: {
    label: "Blocked",
    explanation: "A safety, suppression, or business-fit rule prevents action.",
    className: "border-rose-400/25 bg-rose-400/10 text-rose-100",
    icon: Ban,
  },
};

const CLASSIFICATION_LABELS: Record<OwnerLeadProjection["audit"]["classification"], string> = {
  REBUILD: "Rebuild opportunity",
  NO_SITE_NEW_BUILD: "New website opportunity",
  MINOR_IMPROVEMENT: "Minor improvements",
  NO_OPPORTUNITY: "No current website opportunity",
};

const ROUTE_ICONS: Record<OwnerLeadProjection["route"]["channel"], LucideIcon> = {
  EMAIL: Mail,
  PHONE: Phone,
  FORM: MessageSquareText,
  SOCIAL: Globe2,
  RESEARCH: Search,
};

const SCORE_LABELS: Array<{
  key: keyof OwnerLeadProjection["qualification"]["scores"];
  label: string;
  shortLabel: string;
}> = [
  { key: "businessFit", label: "Business fit", shortLabel: "Fit" },
  { key: "rebuildNeed", label: "Rebuild need", shortLabel: "Need" },
  { key: "reachability", label: "Reachability", shortLabel: "Reach" },
  { key: "timing", label: "Timing", shortLabel: "Timing" },
  { key: "evidenceConfidence", label: "Evidence confidence", shortLabel: "Proof" },
];

function readableCode(value: string) {
  return value
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/(^|\s)\S/g, (character) => character.toUpperCase());
}

function formattedGeneratedAt(value: string) {
  return new Intl.DateTimeFormat("en-CA", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Toronto",
  }).format(new Date(value));
}

export function OwnerLeadList({ data }: { data: OwnerLeadListResponse }) {
  const omittedCount = data.summary.rejectedBusinesses + data.summary.ignoredContactRows;

  return (
    <div className="mx-auto flex max-w-[1500px] flex-col gap-5">
      <PageHeader
        eyebrow="Evidence-first pipeline"
        title="Leads"
        description="The best businesses to review, why they matter, and the safest reachable route. Every score stays separate so you can correct the engine."
        icon={Sparkles}
        status={
          <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-300/20 bg-amber-300/[0.07] px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-amber-100">
            <ShieldCheck className="size-3" aria-hidden="true" />
            Read-only shadow view
          </span>
        }
        metrics={[
          {
            label: "Ready to review",
            value: data.summary.readyForReview,
            detail: "owner decisions",
            tone: "positive",
          },
          {
            label: "Needs refresh",
            value: data.summary.needsRefresh,
            detail: "do not act yet",
            tone: "warning",
          },
          {
            label: "Blocked",
            value: data.summary.blocked,
            detail: "safety held",
            tone: data.summary.blocked > 0 ? "warning" : "default",
          },
        ]}
      />

      <section
        aria-labelledby="lead-review-queue"
        className="overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0e1014]"
      >
        <div className="flex flex-col gap-3 border-b border-white/[0.07] px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <div>
            <h2 id="lead-review-queue" className="text-sm font-semibold text-zinc-100">
              Ranked review queue
            </h2>
            <p className="mt-1 text-xs leading-5 text-zinc-500">
              Ranked from current audit evidence. No email, call, form, or social action can start here.
            </p>
          </div>
          <p className="shrink-0 font-mono text-[10px] text-zinc-600">
            Verified view · {formattedGeneratedAt(data.generatedAt)}
          </p>
        </div>

        {omittedCount > 0 ? (
          <div role="status" className="flex gap-3 border-b border-amber-300/15 bg-amber-300/[0.045] px-4 py-3 text-xs text-amber-100/90 sm:px-5">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-300" aria-hidden="true" />
            <p>
              {omittedCount} current {omittedCount === 1 ? "record was" : "records were"} left out because the evidence or contact data could not be safely verified. Check System before relying on them.
            </p>
          </div>
        ) : null}

        {data.leads.length === 0 ? <OwnerLeadEmptyState /> : (
          <ol className="divide-y divide-white/[0.07]" aria-label="Ranked leads">
            {data.leads.map((lead, index) => (
              <OwnerLeadCard key={lead.projectionKey} lead={lead} rank={index + 1} />
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

function OwnerLeadCard({ lead, rank }: { lead: OwnerLeadProjection; rank: number }) {
  const attention = ATTENTION_COPY[lead.attention];
  const AttentionIcon = attention.icon;
  const RouteIcon = ROUTE_ICONS[lead.route.channel];
  const manualRoute = lead.route.readiness === "MANUAL_ACTION";

  return (
    <li className="group px-4 py-5 transition-colors hover:bg-white/[0.018] sm:px-5 sm:py-6">
      <article aria-labelledby={`lead-${lead.business.businessId}`}>
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(280px,0.75fr)]">
          <div className="min-w-0 space-y-5">
            <header className="flex items-start gap-3">
              <div className="grid size-9 shrink-0 place-items-center rounded-xl border border-white/[0.09] bg-white/[0.035] font-mono text-xs font-semibold text-zinc-400" aria-label={`Rank ${rank}`}>
                {String(rank).padStart(2, "0")}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 id={`lead-${lead.business.businessId}`} className="text-lg font-semibold tracking-[-0.025em] text-white">
                    {lead.business.canonicalName}
                  </h3>
                  <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[10px] font-semibold", attention.className)}>
                    <AttentionIcon className="size-3" aria-hidden="true" />
                    {attention.label}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500">
                  <span className="inline-flex items-center gap-1.5">
                    <Building2 className="size-3.5" aria-hidden="true" />
                    {readableCode(lead.business.niche)}
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <MapPin className="size-3.5" aria-hidden="true" />
                    {readableCode(lead.business.location.city)}, {lead.business.location.region}
                  </span>
                  <span>{CLASSIFICATION_LABELS[lead.audit.classification]}</span>
                </div>
              </div>
              <div className="shrink-0 text-right">
                <div className="font-mono text-2xl font-semibold tabular-nums text-emerald-300">
                  {lead.qualification.totalScore}
                </div>
                <div className="text-[9px] font-semibold uppercase tracking-[0.16em] text-zinc-600">Priority</div>
              </div>
            </header>

            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-5" aria-label={`${lead.business.canonicalName} quality scores`}>
              {SCORE_LABELS.map((score) => {
                const value = lead.qualification.scores[score.key];
                return (
                  <div key={score.key} className="rounded-xl border border-white/[0.07] bg-black/20 px-3 py-2.5">
                    <dt className="truncate text-[9px] font-semibold uppercase tracking-[0.14em] text-zinc-600" title={score.label}>
                      <span className="sm:hidden">{score.shortLabel}</span>
                      <span className="hidden sm:inline">{score.label}</span>
                    </dt>
                    <dd className="mt-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-sm font-semibold tabular-nums text-zinc-100">{value}</span>
                        <span className="text-[9px] text-zinc-700">/100</span>
                      </div>
                      <div
                        className="mt-2 h-1 overflow-hidden rounded-full bg-white/[0.06]"
                        role="progressbar"
                        aria-label={score.label}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={value}
                      >
                        <span className="block h-full rounded-full bg-emerald-400/75" style={{ width: `${value}%` }} />
                      </div>
                    </dd>
                  </div>
                );
              })}
            </dl>

            <section aria-labelledby={`why-${lead.business.businessId}`}>
              <div className="mb-2.5 flex items-center gap-2">
                <Sparkles className="size-3.5 text-emerald-300" aria-hidden="true" />
                <h4 id={`why-${lead.business.businessId}`} className="text-xs font-semibold text-zinc-200">Why this lead</h4>
              </div>
              {lead.whyThisLead.length > 0 ? (
                <ul className="grid gap-2 md:grid-cols-3">
                  {lead.whyThisLead.map((claim) => (
                    <li key={claim.claimId} className="rounded-xl border border-white/[0.07] bg-white/[0.018] p-3">
                      <p className="text-xs leading-5 text-zinc-300">{claim.observation}</p>
                      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                        <span className="text-[9px] font-semibold uppercase tracking-[0.13em] text-zinc-600">
                          {claim.conversionCritical ? "Conversion critical" : readableCode(claim.category)}
                        </span>
                        <a
                          href={claim.sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="v2-focus-ring inline-flex min-h-8 items-center gap-1 rounded-md px-1 text-[10px] font-semibold text-emerald-300 hover:text-emerald-200"
                          aria-label={`Open evidence for ${claim.observation}`}
                        >
                          Evidence <ExternalLink className="size-3" aria-hidden="true" />
                        </a>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="rounded-xl border border-amber-300/15 bg-amber-300/[0.04] p-3 text-xs leading-5 text-amber-100/80">
                  No supported observations are current enough to show. Research or refresh this business before making a decision.
                </p>
              )}
            </section>
          </div>

          <aside className="flex flex-col rounded-2xl border border-white/[0.08] bg-[#0a0c10] p-4" aria-label={`${lead.business.canonicalName} recommended next route`}>
            <div className="flex items-start justify-between gap-3">
              <div className="grid size-9 place-items-center rounded-xl border border-emerald-400/20 bg-emerald-400/[0.07]">
                <RouteIcon className="size-4 text-emerald-300" aria-hidden="true" />
              </div>
              <span className="rounded-full border border-white/[0.08] bg-white/[0.03] px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.14em] text-zinc-400">
                {manualRoute ? "Manual only" : lead.route.readiness === "OWNER_REVIEW" ? "Owner review" : "Research"}
              </span>
            </div>
            <p className="mt-4 text-[10px] font-semibold uppercase tracking-[0.17em] text-zinc-600">Best reachable route</p>
            <p className="mt-1.5 text-base font-semibold text-white">{lead.route.label}</p>
            <p className="mt-2 text-xs leading-5 text-zinc-400">{lead.route.reason}</p>

            <div className="mt-4 rounded-xl border border-white/[0.07] bg-white/[0.018] p-3">
              <p className="text-[10px] font-semibold text-zinc-300">What happens next</p>
              <p className="mt-1 text-xs leading-5 text-zinc-500">{attention.explanation}</p>
            </div>

            {lead.dataQuality.issues.length > 0 ? (
              <div className="mt-3 rounded-xl border border-amber-300/15 bg-amber-300/[0.04] p-3">
                <p className="text-[10px] font-semibold text-amber-100">Evidence cautions</p>
                <ul className="mt-1.5 space-y-1 text-[11px] leading-4 text-amber-100/70">
                  {lead.dataQuality.issues.slice(0, 3).map((issue) => <li key={issue}>• {readableCode(issue)}</li>)}
                </ul>
              </div>
            ) : null}

            <div className="mt-auto pt-4">
              {lead.business.websiteUrl ? (
                <a
                  href={lead.business.websiteUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="v2-focus-ring inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-lg border border-white/[0.1] bg-white/[0.035] px-3 text-xs font-semibold text-zinc-200 hover:border-white/[0.17] hover:bg-white/[0.06] hover:text-white"
                >
                  Open current website <ArrowUpRight className="size-3.5" aria-hidden="true" />
                </a>
              ) : (
                <div className="flex min-h-10 items-center justify-center rounded-lg border border-dashed border-white/[0.09] px-3 text-center text-xs text-zinc-600">
                  No current website URL
                </div>
              )}
              <p className="mt-2 text-center text-[9.5px] leading-4 text-zinc-700">Read-only · no outreach permission</p>
            </div>
          </aside>
        </div>
      </article>
    </li>
  );
}

function OwnerLeadEmptyState() {
  return (
    <div className="grid min-h-[360px] place-items-center px-5 py-12 text-center">
      <div className="max-w-lg">
        <div className="mx-auto grid size-12 place-items-center rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.07]">
          <FileSearch className="size-5 text-emerald-300" aria-hidden="true" />
        </div>
        <h3 className="mt-5 text-lg font-semibold tracking-tight text-white">No current audited leads yet</h3>
        <p className="mt-2 text-sm leading-6 text-zinc-400">
          The new evidence model has not produced a business with a current website audit and qualification snapshot. Legacy records are intentionally not treated as qualified.
        </p>
        <div className="mt-5 inline-flex items-center gap-2 rounded-full border border-amber-300/15 bg-amber-300/[0.05] px-3 py-1.5 text-[10px] font-semibold text-amber-100/80">
          <ShieldCheck className="size-3.5" aria-hidden="true" />
          No outreach was started
        </div>
      </div>
    </div>
  );
}

export function OwnerLeadsUnavailable() {
  return (
    <div className="mx-auto max-w-[1500px] space-y-5">
      <PageHeader
        eyebrow="Evidence-first pipeline"
        title="Leads"
        description="The current lead view could not be safely verified. No unverified fallback data is shown."
        icon={AlertTriangle}
        status={
          <span className="inline-flex items-center gap-1.5 rounded-full border border-rose-300/20 bg-rose-300/[0.07] px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-rose-100">
            Safety stopped
          </span>
        }
      />
      <section role="alert" className="rounded-2xl border border-rose-300/15 bg-[#0e1014] px-5 py-10 text-center">
        <AlertTriangle className="mx-auto size-7 text-rose-300" aria-hidden="true" />
        <h2 className="mt-4 text-lg font-semibold text-white">The lead queue is temporarily unavailable</h2>
        <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-zinc-400">
          The engine refused to guess when its current evidence could not be read. This page remains read-only and no outreach was started.
        </p>
        <Link
          href="/settings"
          className="v2-focus-ring mt-5 inline-flex min-h-10 items-center justify-center rounded-lg border border-white/[0.1] bg-white/[0.035] px-4 text-xs font-semibold text-zinc-200 hover:bg-white/[0.06] hover:text-white"
        >
          Check System status
        </Link>
      </section>
    </div>
  );
}
