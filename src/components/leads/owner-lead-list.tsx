import {
  AlertTriangle,
  ArrowUpRight,
  Ban,
  Building2,
  CheckCircle2,
  ChevronDown,
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
import type { Route } from "next";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { ownerLeadDetailPath } from "@/lib/revenue-engine/owner-lead-identity";
import type { OwnerLeadProjection } from "@/lib/revenue-engine/owner-lead-projection";
import type { OwnerLeadListResponse } from "@/lib/revenue-engine/owner-lead-read-model";
import { cn } from "@/lib/utils";

const ATTENTION_COPY: Record<
  OwnerLeadProjection["attention"],
  { label: string; explanation: string; className: string; icon: LucideIcon }
> = {
  READY_FOR_REVIEW: {
    label: "Ready for owner review",
    explanation: "Current evidence passed the review checks. An owner still needs to decide what to do.",
    className: "border-emerald-400/25 bg-emerald-400/10 text-emerald-200",
    icon: CheckCircle2,
  },
  REVIEW: {
    label: "Needs a closer look",
    explanation: "Some review checks are still open. Look at what is missing before deciding whether to continue.",
    className: "border-amber-400/25 bg-amber-400/10 text-amber-100",
    icon: FileSearch,
  },
  RESEARCH: {
    label: "More research needed",
    explanation: "There is not enough current information for an owner decision yet.",
    className: "border-violet-400/25 bg-violet-400/10 text-violet-200",
    icon: Search,
  },
  NEEDS_REFRESH: {
    label: "Needs refresh",
    explanation: "Some information is old or incomplete and should be checked again.",
    className: "border-amber-400/25 bg-amber-400/10 text-amber-100",
    icon: RefreshCcw,
  },
  BLOCKED: {
    label: "Blocked",
    explanation: "A policy or business-fit check is blocking further action.",
    className: "border-rose-400/25 bg-rose-400/10 text-rose-100",
    icon: Ban,
  },
  };

const ATTENTION_LIGHT_CLASS: Record<OwnerLeadProjection["attention"], string> = {
  READY_FOR_REVIEW: "border-[#cce2d0] bg-[#eaf4ec] text-[#245a36]",
  REVIEW: "border-[#f2dca8] bg-[#fff4de] text-[#77520f]",
  RESEARCH: "border-[#e0d5fa] bg-[#f2edff] text-[#65449a]",
  NEEDS_REFRESH: "border-[#f2dca8] bg-[#fff4de] text-[#77520f]",
  BLOCKED: "border-[#efcccc] bg-[#fff0f0] text-[#8a3434]",
};

const CLASSIFICATION_LABELS: Record<OwnerLeadProjection["audit"]["classification"], string> = {
  REBUILD: "Rebuild opportunity",
  NO_SITE_NEW_BUILD: "New website opportunity",
  MINOR_IMPROVEMENT: "Minor improvements",
  NO_OPPORTUNITY: "No current website opportunity",
};

const OWNERSHIP_LABELS: Record<OwnerLeadProjection["business"]["independenceStatus"], string> = {
  UNKNOWN: "Ownership not verified",
  INDEPENDENT: "Independent operator",
  CHAIN: "Chain",
  FRANCHISE: "Franchise",
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

function qualificationStatusMessage(lead: OwnerLeadProjection) {
  if (lead.attention === "NEEDS_REFRESH") return "Evidence needs refresh before website qualification can be trusted.";
  if (lead.attention === "BLOCKED") return "A policy, suppression, or business-fit block prevents owner review.";
  if (lead.audit.classification === "NO_OPPORTUNITY") return "No demonstrated website opportunity appears in the current evidence.";
  if (lead.attention === "REVIEW") return "Qualification criteria remain unmet; review the failed gates before treating this as a sales lead.";
  return "Website qualification is incomplete. Research or refresh this business before making a decision.";
}

export function OwnerLeadList({ data, canReviewBusinessResearch = false }: {
  data: OwnerLeadListResponse;
  canReviewBusinessResearch?: boolean;
}) {
  const rejectedBusinesses = data.summary.rejectedBusinesses;
  const ignoredContactRows = data.summary.ignoredContactRows;
  const needsQualificationCount = data.leads.filter((lead) => lead.attention === "REVIEW" || lead.attention === "RESEARCH").length;
  const groups = [
    { title: "Ready for a decision", description: "Evidence is ready for an owner to check.", leads: data.leads.filter((lead) => lead.attention === "READY_FOR_REVIEW") },
    { title: "Needs another look", description: "Check what is missing before taking the next step.", leads: data.leads.filter((lead) => lead.attention === "REVIEW" || lead.attention === "RESEARCH" || lead.attention === "NEEDS_REFRESH") },
    { title: "Stopped", description: "These businesses have a block that needs attention.", leads: data.leads.filter((lead) => lead.attention === "BLOCKED") },
  ].filter((group) => group.leads.length > 0);

  return (
    <div className="mx-auto flex max-w-[1280px] flex-col gap-7 text-[#20352a]">
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-[#d9e2d9] pb-5">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#476351]">Research workspace</p>
          <h1 className="mt-2 text-4xl font-semibold tracking-[-0.05em] text-[#172b21]">Businesses</h1>
          <p className="mt-2 max-w-xl text-sm leading-6 text-[#58695f]">Start with the proposed names, then review the businesses with saved website findings.</p>
        </div>
        <span className="rounded-full border border-[#d9e5da] bg-white px-3 py-1.5 text-xs font-semibold text-[#425b49]">Private owner workspace</span>
      </header>

      <section aria-labelledby="proposed-businesses-heading" className="relative overflow-hidden rounded-[28px] bg-[#14392e] p-6 text-white shadow-[0_18px_40px_-28px_rgba(15,48,35,0.75)] sm:p-8">
        <div className="pointer-events-none absolute -right-16 -top-24 size-72 rounded-full border-[48px] border-white/[0.045]" aria-hidden="true" />
        <div className="relative grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(180px,0.32fr)] md:items-end">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#a7dfc1]">First step · proposed businesses</p>
            <h2 id="proposed-businesses-heading" className="mt-2 max-w-lg text-2xl font-semibold tracking-[-0.035em] sm:text-[29px]">Confirm who belongs on the list</h2>
            <p className="mt-2 max-w-xl text-sm leading-6 text-[#d5e5da]">Check the company and location for each proposed name. Saving these choices starts no contact.</p>
            {canReviewBusinessResearch ? (
              <Button asChild size="lg" className="mt-5 w-full justify-between rounded-xl bg-white px-5 font-semibold text-[#14392e] hover:bg-[#e9f4e9] sm:w-auto sm:min-w-64">
                <Link href={"/leads/m2/identity" as Route} prefetch={false}>Review 10 proposed businesses <ArrowUpRight aria-hidden="true" /></Link>
              </Button>
            ) : <p role="note" className="mt-4 text-sm text-[#d5e5da]"><strong className="font-semibold text-white">Business research is owner-managed.</strong> An owner with administrator access can review these names.</p>}
          </div>
          <div className="flex items-baseline gap-3 border-t border-white/20 pt-4 md:block md:border-l md:border-t-0 md:pl-6 md:pt-0">
            <p className="text-4xl font-semibold tracking-[-0.06em] tabular-nums">10</p>
            <p className="text-xs font-medium leading-5 text-[#c4dacb]">proposed names to confirm<br className="hidden md:block" /> before deeper research</p>
          </div>
        </div>
      </section>

      <section aria-labelledby="business-records-heading">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="business-records-heading" className="text-2xl font-semibold tracking-[-0.035em] text-[#172b21]">Assessed businesses</h2>
            <p className="mt-1 text-sm text-[#52645a]">Saved website findings, grouped by what needs attention.</p>
          </div>
          <p className="rounded-full border border-[#dce5da] bg-white px-3 py-1 text-xs font-semibold text-[#52645a]">{data.leads.length} {data.leads.length === 1 ? "assessed business" : "assessed businesses"}</p>
        </div>
        {data.leads.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[#cfded0] bg-white px-6 py-10 text-center">
            <p className="font-semibold text-[#20352a]">No assessments saved yet</p>
            <p className="mt-1 text-sm text-[#52645a]">When website research is verified, businesses will appear here.</p>
          </div>
        ) : groups.map((group) => (
          <div key={group.title} className="mb-4 overflow-hidden rounded-[20px] border border-[#dce5dc] bg-white shadow-[0_8px_24px_-22px_rgba(25,63,42,0.5)]">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#e8eee8] px-5 py-3.5 sm:px-6">
              <div><h3 className="text-sm font-semibold text-[#213a2b]">{group.title}</h3><p className="mt-0.5 text-xs text-[#657467]">{group.description}</p></div>
              <span className="grid size-7 place-items-center rounded-full bg-[#edf3ec] text-xs font-semibold text-[#355544]">{group.leads.length}</span>
            </div>
            <ol className="divide-y divide-[#e8eee8]" aria-label={group.title}>
              {group.leads.map((lead) => (
                <li key={lead.projectionKey}>
                  <article className="group/record grid gap-4 px-5 py-5 transition-colors hover:bg-[#fafcf9] sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-6">
                    <div className="flex min-w-0 items-start gap-3.5">
                      <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-[#edf4ed] text-[#276449]"><Building2 className="size-5" aria-hidden="true" /></div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2"><h4 className="text-base font-semibold tracking-[-0.02em] text-[#1b3024]">{lead.business.canonicalName}</h4><span className={cn("rounded-full border px-2.5 py-0.5 text-[11px] font-semibold", ATTENTION_LIGHT_CLASS[lead.attention])}>{ATTENTION_COPY[lead.attention].label}</span></div>
                        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[#647267]"><span className="inline-flex items-center gap-1"><MapPin className="size-3.5" aria-hidden="true" />{readableCode(lead.business.location.city)}, {lead.business.location.region}</span><span aria-hidden="true">·</span><span>{readableCode(lead.business.niche)}</span><span aria-hidden="true">·</span><span>{OWNERSHIP_LABELS[lead.business.independenceStatus]}</span></p>
                        <p className="mt-2 text-sm text-[#354d3d]"><span className="font-semibold">Website finding:</span> {CLASSIFICATION_LABELS[lead.audit.classification]}</p>
                        <p className="mt-1 text-xs leading-5 text-[#647267]">{ATTENTION_COPY[lead.attention].explanation}</p>
                      </div>
                    </div>
                    <Link href={ownerLeadDetailPath(lead.business.businessId) as Route} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[#cdded0] bg-[#f5faf4] px-4 text-sm font-semibold text-[#16543f] transition-colors hover:border-[#7fad90] hover:bg-[#e8f3e8] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145943] sm:justify-self-end">Review evidence <ArrowUpRight className="size-4" aria-hidden="true" /></Link>
                  </article>
                </li>
              ))}
            </ol>
          </div>
        ))}
      </section>

      <details className="group overflow-hidden rounded-2xl border border-[#dfe8e1] bg-white">
        <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-4 py-4 text-sm font-semibold text-[#315443] hover:bg-[#f7faf7] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#176443] sm:px-5">
          <span className="min-w-0">How business records are assessed</span>
          <span className="flex shrink-0 items-center gap-2 text-xs font-normal text-[#596d5f]">
            <span className="hidden sm:inline">Optional details for operators</span>
            <ChevronDown className="size-4 transition-transform group-open:rotate-180" aria-hidden="true" />
          </span>
        </summary>
        <div className="border-t border-white/[0.07] bg-[#0e1014]">
          <header className="border-b border-white/[0.07] px-4 py-5 sm:px-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500">Legacy score details</p>
                <h2 className="mt-1 text-lg font-semibold text-zinc-100">Ranked business evidence</h2>
                <p className="mt-1 max-w-2xl text-xs leading-5 text-zinc-400">
                  Read-only shadow view. These rankings do not include the separate Business Review decision and never grant permission to contact a business.
                </p>
              </div>
              <Button asChild variant="outline" size="sm" className="shrink-0">
                <Link href="/leads/evaluation">Open Quality Lab <ArrowUpRight aria-hidden="true" /></Link>
              </Button>
            </div>
            <dl className="mt-5 grid grid-cols-2 gap-2 md:grid-cols-4" aria-label="Legacy score preview counts">
              <div className="rounded-xl border border-white/[0.07] bg-black/20 p-3">
                <dt className="text-[10px] font-semibold text-zinc-400">Meets preview rules</dt>
                <dd className="mt-1 font-mono text-lg font-semibold tabular-nums text-emerald-300">{data.summary.readyForReview}</dd>
                <dd className="text-[10px] text-zinc-500">Not contact approval</dd>
              </div>
              <div className="rounded-xl border border-white/[0.07] bg-black/20 p-3">
                <dt className="text-[10px] font-semibold text-zinc-400">Preview checks open</dt>
                <dd className="mt-1 font-mono text-lg font-semibold tabular-nums text-amber-300">{needsQualificationCount}</dd>
                <dd className="text-[10px] text-zinc-500">Not a sales qualification</dd>
              </div>
              <div className="rounded-xl border border-white/[0.07] bg-black/20 p-3">
                <dt className="text-[10px] font-semibold text-zinc-400">Needs refresh</dt>
                <dd className="mt-1 font-mono text-lg font-semibold tabular-nums text-amber-300">{data.summary.needsRefresh}</dd>
                <dd className="text-[10px] text-zinc-500">Evidence may be stale</dd>
              </div>
              <div className="rounded-xl border border-white/[0.07] bg-black/20 p-3">
                <dt className="text-[10px] font-semibold text-zinc-400">Blocked</dt>
                <dd className="mt-1 font-mono text-lg font-semibold tabular-nums text-rose-300">{data.summary.blocked}</dd>
                <dd className="text-[10px] text-zinc-500">Policy or fit check</dd>
              </div>
            </dl>
          </header>

          <section
            aria-labelledby="lead-review-queue"
            className="overflow-hidden border-t border-white/[0.08]"
          >
            <div className="flex flex-col gap-3 border-b border-white/[0.07] px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
              <div>
                <h2 id="lead-review-queue" className="text-sm font-semibold text-zinc-100">
                  Ranked review queue · legacy
                </h2>
                <p className="mt-1 text-xs leading-5 text-zinc-500">
                  Ranked from current audit evidence. No email, call, form, or social action can start here.
                </p>
              </div>
              <p className="shrink-0 font-mono text-[10px] text-zinc-600">
                Verified view · {formattedGeneratedAt(data.generatedAt)}
              </p>
            </div>

            {rejectedBusinesses > 0 || ignoredContactRows > 0 ? (
              <div role="status" className="flex gap-3 border-b border-amber-300/15 bg-amber-300/[0.045] px-4 py-3 text-xs text-amber-100/90 sm:px-5">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-300" aria-hidden="true" />
                <div className="space-y-1">
                  {rejectedBusinesses > 0 ? <p>{rejectedBusinesses} {rejectedBusinesses === 1 ? "business was left out because its evidence could not be safely verified." : "businesses were left out because their evidence could not be safely verified."}</p> : null}
                  {ignoredContactRows > 0 ? <p>{ignoredContactRows} {ignoredContactRows === 1 ? "contact detail was ignored because it could not be safely verified." : "contact details were ignored because they could not be safely verified."}</p> : null}
                  <p>Check safety and status before relying on this preview.</p>
                </div>
              </div>
            ) : null}

            {data.leads.length === 0 ? <OwnerLeadEmptyState /> : (
              <ol className="divide-y divide-white/[0.07]" aria-label="Legacy scored businesses">
                {data.leads.map((lead, index) => (
                  <OwnerLeadCard key={lead.projectionKey} lead={lead} rank={index + 1} />
                ))}
              </ol>
            )}
          </section>
        </div>
      </details>
    </div>
  );
}

function OwnerLeadCard({ lead, rank }: { lead: OwnerLeadProjection; rank: number }) {
  const attention = ATTENTION_COPY[lead.attention];
  const AttentionIcon = attention.icon;
  const RouteIcon = ROUTE_ICONS[lead.route.channel];
  const manualRoute = lead.route.readiness === "MANUAL_ACTION";
  const detailHref = ownerLeadDetailPath(lead.business.businessId) as Route;

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
                <div className={cn("font-mono text-2xl font-semibold tabular-nums", lead.ownerActionable ? "text-emerald-300" : "text-zinc-100")}>
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
                <h4 id={`why-${lead.business.businessId}`} className="text-xs font-semibold text-zinc-200">{lead.ownerActionable ? "Why this lead" : "Qualification status"}</h4>
              </div>
              {lead.ownerActionable && lead.whyThisLead.length > 0 ? (
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
                  {qualificationStatusMessage(lead)}
                </p>
              )}
              {!lead.ownerActionable && lead.qualification.failedGates.length > 0 ? (
                <div className="mt-3 rounded-xl border border-amber-300/15 bg-amber-300/[0.04] p-3">
                  <p className="text-[10px] font-semibold text-amber-100">Qualification gates still open</p>
                  <ul className="mt-1.5 space-y-1 text-[11px] leading-4 text-amber-100/70">
                    {lead.qualification.failedGates.map((gate) => <li key={gate}>• {readableCode(gate)}</li>)}
                  </ul>
                </div>
              ) : null}
            </section>
          </div>

          <aside className="flex flex-col rounded-2xl border border-white/[0.08] bg-[#0a0c10] p-4" aria-label={`${lead.business.canonicalName} recommended next route`}>
            <div className="flex items-start justify-between gap-3">
              <div className="grid size-9 place-items-center rounded-xl border border-emerald-400/20 bg-emerald-400/[0.07]">
                <RouteIcon className="size-4 text-emerald-300" aria-hidden="true" />
              </div>
              <span className="rounded-full border border-white/[0.08] bg-white/[0.03] px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.14em] text-zinc-400">
                {manualRoute ? "Manual only" : lead.route.readiness === "OWNER_REVIEW" ? "Owner review" : "Needs qualification"}
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
              <Link
                href={detailHref}
                className="v2-focus-ring mb-2 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-lg border border-emerald-300/25 bg-emerald-300/[0.07] px-3 text-xs font-semibold text-emerald-200 hover:border-emerald-300/35 hover:bg-emerald-300/[0.1] hover:text-emerald-100"
              >
                Open evidence dossier <ArrowUpRight className="size-3.5" aria-hidden="true" />
              </Link>
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
        <h3 className="mt-5 text-lg font-semibold tracking-tight text-white">No businesses to review yet</h3>
        <p className="mt-2 text-sm leading-6 text-zinc-400">
          A business will appear here after current website research has been completed and checked.
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
      <section role="alert" className="rounded-[28px] bg-white px-5 py-10 text-center text-[#263a2f] shadow-sm sm:px-8">
        <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-amber-100 text-amber-800"><AlertTriangle className="size-6" aria-hidden="true" /></span>
        <p className="mt-5 text-xs font-semibold uppercase tracking-[0.14em] text-[#806224]">Could not verify</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-[#24382d]">Businesses</h1>
        <h2 className="mt-3 text-lg font-semibold text-[#294333]">Business research is temporarily unavailable</h2>
        <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-[#566a5d]">
          The latest records could not be read, so no scores or business counts are shown. This page did not start outreach; the read failure does not stop live automation.
        </p>
        <Link href="/settings" className="mt-5 inline-flex min-h-11 items-center justify-center rounded-xl bg-[#176443] px-5 text-sm font-semibold text-white hover:bg-[#125638] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#176443]">
          Check system status
        </Link>
      </section>
    </div>
  );
}
