import {
  AlertTriangle,
  ArrowLeft,
  ArrowUpRight,
  Building2,
  ClipboardCheck,
  Clock3,
  ExternalLink,
  FileCode2,
  FileSearch,
  Globe2,
  History,
  Laptop,
  Mail,
  MapPin,
  MessageSquareText,
  MonitorSmartphone,
  Phone,
  Search,
  ShieldCheck,
  Smartphone,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";

import { PageHeader } from "@/components/ui/page-header";
import type { OwnerLeadDetailResponse } from "@/lib/revenue-engine/owner-lead-detail-read-model";
import { cn } from "@/lib/utils";

const SCORE_LABELS: Array<{
  key: keyof OwnerLeadDetailResponse["lead"]["qualification"]["scores"];
  label: string;
}> = [
  { key: "businessFit", label: "Business fit" },
  { key: "rebuildNeed", label: "Rebuild need" },
  { key: "reachability", label: "Reachability" },
  { key: "timing", label: "Timing" },
  { key: "evidenceConfidence", label: "Evidence confidence" },
];

const ROUTE_ICONS: Record<OwnerLeadDetailResponse["routes"][number]["channel"], LucideIcon> = {
  EMAIL: Mail,
  PHONE: Phone,
  FORM: MessageSquareText,
  SOCIAL: Globe2,
};

const ARTIFACT_ICONS: Record<OwnerLeadDetailResponse["website"]["artifacts"][number]["kind"], LucideIcon> = {
  DESKTOP: Laptop,
  MOBILE: Smartphone,
  DOM: FileCode2,
};

const HISTORY_ICONS: Record<OwnerLeadDetailResponse["history"]["events"][number]["eventType"], LucideIcon> = {
  SOURCE_CAPTURED: Search,
  WEBSITE_AUDITED: MonitorSmartphone,
  QUALIFICATION_SCORED: Sparkles,
  CONTACT_DISCOVERED: Phone,
  CONTACT_VERIFIED: ShieldCheck,
};

const SEVERITY_COPY = {
  CRITICAL: {
    label: "Critical",
    className: "border-rose-300/20 bg-rose-300/[0.055] text-rose-100",
  },
  IMPORTANT: {
    label: "Important",
    className: "border-amber-300/20 bg-amber-300/[0.05] text-amber-100",
  },
  MINOR: {
    label: "Minor",
    className: "border-sky-300/20 bg-sky-300/[0.045] text-sky-100",
  },
} as const;

const ROUTE_READINESS_COPY = {
  CURRENT_USABLE: { label: "Current", className: "text-emerald-200 border-emerald-300/20 bg-emerald-300/[0.06]" },
  UNVERIFIED: { label: "Not verified", className: "text-amber-100 border-amber-300/20 bg-amber-300/[0.05]" },
  STALE: { label: "Stale", className: "text-amber-100 border-amber-300/20 bg-amber-300/[0.05]" },
  BLOCKED: { label: "Blocked", className: "text-rose-100 border-rose-300/20 bg-rose-300/[0.05]" },
} as const;

function readableCode(value: string) {
  return value
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/(^|\s)\S/g, (character) => character.toUpperCase());
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en-CA", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Toronto",
  }).format(new Date(value));
}

function locationLine(data: OwnerLeadDetailResponse) {
  const parts = [
    data.identity.addressLine,
    readableCode(data.lead.business.location.city),
    data.lead.business.location.region,
    data.identity.postalCode,
  ];
  return parts.filter(Boolean).join(", ");
}

function decisionStateCopy(lead: OwnerLeadDetailResponse["lead"]) {
  if (lead.attention === "READY_FOR_REVIEW" && lead.ownerActionable) {
    return { label: "Qualified for review", description: "Current evidence supports an owner decision." };
  }
  if (lead.attention === "NEEDS_REFRESH") {
    return { label: "Needs refresh", description: "Evidence needs refresh before website qualification can be trusted." };
  }
  if (lead.attention === "BLOCKED") {
    return { label: "Blocked", description: "A policy, suppression, or business-fit block prevents owner review." };
  }
  if (lead.audit.classification === "NO_OPPORTUNITY") {
    return { label: "Needs qualification", description: "No demonstrated website opportunity appears in the current evidence." };
  }
  return { label: "Needs qualification", description: "Qualification criteria remain unmet; review the failed gates before treating this as a sales lead." };
}

export function OwnerLeadDetail({ data }: { data: OwnerLeadDetailResponse }) {
  const lead = data.lead;
  const qualifiedForReview = lead.attention === "READY_FOR_REVIEW" && lead.ownerActionable;
  const decisionState = decisionStateCopy(lead);
  const description = !qualifiedForReview
    ? decisionState.description
    : lead.whyThisLead[0]?.observation
    ?? "The dossier keeps business fit, website need, reachability, timing, and evidence confidence separate so the next decision stays explainable.";

  return (
    <div data-owner-readonly-dossier className="mx-auto flex max-w-[1500px] flex-col gap-5">
      <Link
        href="/leads"
        className="v2-focus-ring inline-flex min-h-9 w-fit items-center gap-2 rounded-lg px-1 text-xs font-semibold text-zinc-400 hover:text-white"
      >
        <ArrowLeft className="size-3.5" aria-hidden="true" />
        Back to ranked leads
      </Link>

      <PageHeader
        eyebrow={`${readableCode(lead.business.niche)} · ${readableCode(lead.business.location.city)}`}
        title={lead.business.canonicalName}
        description={description}
        icon={Building2}
        status={
          <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-300/20 bg-amber-300/[0.07] px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-amber-100">
            <ShieldCheck className="size-3" aria-hidden="true" />
            Evidence read-only
          </span>
        }
        actions={lead.business.websiteUrl ? (
          <a
            href={lead.business.websiteUrl}
            target="_blank"
            rel="noreferrer"
            className="v2-focus-ring inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-white/[0.1] bg-white/[0.035] px-3 text-xs font-semibold text-zinc-200 hover:border-white/[0.17] hover:bg-white/[0.06] hover:text-white"
          >
            Current website <ArrowUpRight className="size-3.5" aria-hidden="true" />
          </a>
        ) : null}
        metrics={[
          { label: "Priority", value: lead.qualification.totalScore, detail: "/100", tone: qualifiedForReview ? "positive" : "default" },
          { label: "Rebuild need", value: lead.qualification.scores.rebuildNeed, detail: "/100" },
          { label: "Evidence", value: lead.qualification.scores.evidenceConfidence, detail: "/100" },
          { label: "Best route", value: readableCode(lead.route.channel), detail: lead.route.readiness === "MANUAL_ACTION" ? "manual" : "review" },
        ]}
      />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.55fr)]">
        <section aria-labelledby="why-this-lead" className="rounded-2xl border border-white/[0.08] bg-[#0e1014] p-4 sm:p-5">
          <div className="flex items-center gap-2">
            <Sparkles className="size-4 text-emerald-300" aria-hidden="true" />
            <h2 id="why-this-lead" className="text-sm font-semibold text-white">{qualifiedForReview ? "Why this is a strong lead" : "Qualification status"}</h2>
          </div>
          {qualifiedForReview && lead.whyThisLead.length > 0 ? (
            <ol className="mt-4 grid gap-3 md:grid-cols-3">
              {lead.whyThisLead.map((claim, index) => (
                <li key={claim.claimId} className="rounded-xl border border-white/[0.07] bg-black/20 p-4">
                  <span className="font-mono text-[10px] text-emerald-300">0{index + 1}</span>
                  <p className="mt-3 text-sm leading-6 text-zinc-200">{claim.observation}</p>
                  <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[9px] font-semibold uppercase tracking-[0.14em] text-zinc-600">
                      {claim.conversionCritical ? "Conversion critical" : readableCode(claim.category)}
                    </span>
                    <a
                      href={claim.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="v2-focus-ring inline-flex min-h-8 items-center gap-1 rounded-md px-1 text-[10px] font-semibold text-emerald-300 hover:text-emerald-200"
                    >
                      Inspect proof <ExternalLink className="size-3" aria-hidden="true" />
                    </a>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p className="mt-4 rounded-xl border border-amber-300/15 bg-amber-300/[0.04] p-4 text-sm leading-6 text-amber-100/80">
              {decisionState.description} The supporting evidence remains available below.
            </p>
          )}
        </section>

        <aside aria-labelledby="decision-state" className="rounded-2xl border border-white/[0.08] bg-[#0e1014] p-4 sm:p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 id="decision-state" className="text-sm font-semibold text-white">Decision state</h2>
            <span className={cn(
              "rounded-full border px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.14em]",
              qualifiedForReview
                ? "border-emerald-300/20 bg-emerald-300/[0.06] text-emerald-200"
                : lead.attention === "BLOCKED"
                  ? "border-rose-300/20 bg-rose-300/[0.06] text-rose-100"
                  : "border-amber-300/20 bg-amber-300/[0.06] text-amber-100",
            )}>
              {decisionState.label}
            </span>
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-2">
            {SCORE_LABELS.map(({ key, label }) => (
              <div key={key} className={cn("rounded-xl border border-white/[0.07] bg-black/20 p-3", key === "evidenceConfidence" && "col-span-2")}>
                <dt className="text-[9px] font-semibold uppercase tracking-[0.13em] text-zinc-600">{label}</dt>
                <dd className="mt-2 flex items-end justify-between gap-2">
                  <span className="font-mono text-lg font-semibold tabular-nums text-zinc-100">{lead.qualification.scores[key]}</span>
                  <span className="text-[9px] text-zinc-700">/100</span>
                </dd>
              </div>
            ))}
          </dl>
          <div className="mt-4 rounded-xl border border-white/[0.07] bg-white/[0.018] p-3">
            <p className="text-[10px] font-semibold text-zinc-300">Evidence state</p>
            <p className="mt-1 text-xs leading-5 text-zinc-500">
              {readableCode(lead.dataQuality.state)} · audit {lead.audit.auditVersion}
            </p>
            {lead.dataQuality.issues.length > 0 ? (
              <ul className="mt-2 space-y-1 text-[11px] leading-4 text-amber-100/75">
                {lead.dataQuality.issues.map((issue) => <li key={issue}>• {readableCode(issue)}</li>)}
              </ul>
            ) : null}
            {!qualifiedForReview && lead.qualification.failedGates.length > 0 ? (
              <div className="mt-3 rounded-xl border border-amber-300/15 bg-amber-300/[0.04] p-3">
                <p className="text-[10px] font-semibold text-amber-100">Qualification gates still open</p>
                <ul className="mt-2 space-y-1 text-[11px] leading-4 text-amber-100/70">
                  {lead.qualification.failedGates.map((gate) => <li key={gate}>• {readableCode(gate)}</li>)}
                </ul>
              </div>
            ) : null}
          </div>
        </aside>
      </div>

      <WebsiteEvidence data={data} />
      <Reachability data={data} />
      <ContactReviewSection data={data} />
      <HistorySection data={data} />

      <section aria-label="Dossier provenance" className="grid gap-3 rounded-2xl border border-white/[0.08] bg-[#0e1014] p-4 text-xs text-zinc-500 sm:grid-cols-3 sm:p-5">
        <div>
          <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-zinc-600">Business location</p>
          <p className="mt-2 inline-flex items-start gap-2 leading-5 text-zinc-300"><MapPin className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />{locationLine(data)}</p>
        </div>
        <div>
          <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-zinc-600">Discovery source</p>
          <p className="mt-2 text-zinc-300">{data.identity.sourceAdapter}</p>
          <a href={lead.business.sourceEvidenceUrl} target="_blank" rel="noreferrer" className="v2-focus-ring mt-1 inline-flex min-h-8 items-center gap-1 rounded-md text-emerald-300 hover:text-emerald-200">
            Source evidence <ExternalLink className="size-3" aria-hidden="true" />
          </a>
        </div>
        <div>
          <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-zinc-600">Verified view</p>
          <p className="mt-2 text-zinc-300">{formatDateTime(data.generatedAt)}</p>
          <p className="mt-1 font-mono text-[9px] text-zinc-700">{data.readModelVersion}</p>
        </div>
      </section>

      <div role="note" className="flex gap-3 rounded-xl border border-amber-300/15 bg-amber-300/[0.04] p-4 text-xs leading-5 text-amber-100/80">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-amber-300" aria-hidden="true" />
        <p>This dossier is read-only. No email, call, form, social message, provider request, or database change can start here.</p>
      </div>
    </div>
  );
}

function WebsiteEvidence({ data }: { data: OwnerLeadDetailResponse }) {
  const findings = data.website.findings;
  return (
    <section aria-labelledby="website-evidence" className="overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0e1014]">
      <div className="flex flex-col gap-2 border-b border-white/[0.07] p-4 sm:flex-row sm:items-end sm:justify-between sm:p-5">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-emerald-300">Current audit</p>
          <h2 id="website-evidence" className="mt-1 text-lg font-semibold text-white">Website evidence</h2>
          <p className="mt-1 text-xs leading-5 text-zinc-500">Captured {formatDateTime(data.website.capturedAt)} · refresh after {formatDateTime(data.website.refreshAfter)}</p>
        </div>
        <span className="w-fit rounded-full border border-white/[0.08] bg-white/[0.03] px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.14em] text-zinc-400">
          {readableCode(data.website.classification)}
        </span>
      </div>

      <div className="grid gap-4 p-4 sm:p-5 lg:grid-cols-[minmax(0,0.72fr)_minmax(0,1.28fr)]">
        <div>
          <h3 className="text-xs font-semibold text-zinc-200">Capture references</h3>
          <div className="mt-3 grid gap-2 sm:grid-cols-3 lg:grid-cols-1">
            {data.website.artifacts.map((item) => {
              const Icon = ARTIFACT_ICONS[item.kind];
              return (
                <div key={item.kind} className="rounded-xl border border-white/[0.07] bg-black/20 p-3">
                  <div className="flex items-start gap-3">
                    <div className="grid size-8 shrink-0 place-items-center rounded-lg border border-white/[0.08] bg-white/[0.03]">
                      <Icon className="size-3.5 text-zinc-400" aria-hidden="true" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-[10px] font-semibold text-zinc-200">{readableCode(item.kind)} capture</p>
                      <p className="mt-1 text-[11px] leading-4 text-zinc-500">
                        {item.availability === "REFERENCE_RECORDED" ? "Artifact reference recorded" : "Not captured"}
                      </p>
                      {item.reference ? <p className="mt-1 truncate font-mono text-[9px] text-zinc-700" title={item.reference}>{item.reference}</p> : null}
                    </div>
                  </div>
                  <p className="mt-3 border-t border-white/[0.06] pt-2 text-[10px] leading-4 text-amber-100/60">
                    Preview unavailable until private evidence storage is enabled.
                  </p>
                </div>
              );
            })}
          </div>
          <p className="mt-3 text-[10px] leading-4 text-zinc-600">{data.website.passedCheckCount} deterministic checks passed.</p>
        </div>

        <div>
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-xs font-semibold text-zinc-200">Findings by severity</h3>
            <span className="font-mono text-[10px] text-zinc-600">{findings.length} shown</span>
          </div>
          <div className="mt-3 space-y-4">
            {(["CRITICAL", "IMPORTANT", "MINOR"] as const).map((severity) => {
              const group = findings.filter((finding) => finding.severity === severity);
              const copy = SEVERITY_COPY[severity];
              return (
                <section key={severity} aria-labelledby={`findings-${severity.toLowerCase()}`}>
                  <div className="flex items-center gap-2">
                    <h4 id={`findings-${severity.toLowerCase()}`} className={cn("rounded-md border px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.14em]", copy.className)}>{copy.label}</h4>
                    <span className="font-mono text-[10px] text-zinc-600">{group.length}</span>
                  </div>
                  {group.length > 0 ? (
                    <ul className="mt-2 divide-y divide-white/[0.06] rounded-xl border border-white/[0.07] bg-black/20">
                      {group.map((finding) => (
                        <li key={finding.checkId} className="p-3">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div>
                              <p className="text-xs font-semibold text-zinc-200">{readableCode(finding.category)}</p>
                              <p className="mt-1 text-[10px] text-zinc-600">{readableCode(finding.outcome)} · score impact {finding.scoreImpact}</p>
                            </div>
                            {finding.claim ? (
                              <a href={finding.claim.sourceUrl} target="_blank" rel="noreferrer" className="v2-focus-ring inline-flex min-h-8 items-center gap-1 rounded-md px-1 text-[10px] font-semibold text-emerald-300 hover:text-emerald-200">
                                Proof <ExternalLink className="size-3" aria-hidden="true" />
                              </a>
                            ) : null}
                          </div>
                          <p className={cn("mt-2 text-xs leading-5", finding.claim ? "text-zinc-300" : "text-amber-100/70")}>
                            {finding.claim?.observation ?? "This check is incomplete and has no supported claim. Manual review is required."}
                          </p>
                        </li>
                      ))}
                    </ul>
                  ) : <p className="mt-2 text-[11px] text-zinc-600">No {copy.label.toLowerCase()} findings in this audit.</p>}
                </section>
              );
            })}
          </div>
          {data.website.evidenceTruncated ? (
            <p role="status" className="mt-4 rounded-lg border border-amber-300/15 bg-amber-300/[0.04] p-3 text-[11px] leading-5 text-amber-100/75">
              The audit exceeds the safe dossier display limit. Review the audit receipt before relying on this summary.
            </p>
          ) : null}
          {data.website.manualReviewReasons.length > 0 ? (
            <div className="mt-4 rounded-xl border border-amber-300/15 bg-amber-300/[0.04] p-3">
              <p className="text-[10px] font-semibold text-amber-100">Manual review needed</p>
              <ul className="mt-2 space-y-1 text-[11px] leading-5 text-amber-100/70">
                {data.website.manualReviewReasons.map((reason) => <li key={reason}>• {readableCode(reason)}</li>)}
              </ul>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function Reachability({ data }: { data: OwnerLeadDetailResponse }) {
  return (
    <section aria-labelledby="reachable-routes" className="rounded-2xl border border-white/[0.08] bg-[#0e1014] p-4 sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-emerald-300">Reachability</p>
          <h2 id="reachable-routes" className="mt-1 text-lg font-semibold text-white">Every recorded route</h2>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-zinc-500">The recommended route is explained, but every channel remains read-only. Phone, forms, and social are always manual.</p>
        </div>
        <div className="rounded-xl border border-emerald-300/15 bg-emerald-300/[0.045] p-3 sm:max-w-sm">
          <p className="text-[10px] font-semibold text-emerald-200">Recommended: {data.lead.route.label}</p>
          <p className="mt-1 text-[11px] leading-5 text-zinc-400">{data.lead.route.reason}</p>
        </div>
      </div>

      {data.routes.length > 0 ? (
        <ul className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {data.routes.map((route) => {
            const Icon = ROUTE_ICONS[route.channel];
            const readiness = ROUTE_READINESS_COPY[route.readiness];
            return (
              <li key={route.contactPointId} className={cn("rounded-xl border bg-black/20 p-4", route.recommended ? "border-emerald-300/20" : "border-white/[0.07]")}>
                <div className="flex items-start justify-between gap-3">
                  <div className="grid size-9 place-items-center rounded-xl border border-white/[0.08] bg-white/[0.03]">
                    <Icon className="size-4 text-zinc-300" aria-hidden="true" />
                  </div>
                  <div className="flex flex-wrap justify-end gap-1.5">
                    {route.recommended ? <span className="rounded-full border border-emerald-300/20 bg-emerald-300/[0.06] px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.12em] text-emerald-200">Recommended</span> : null}
                    <span className={cn("rounded-full border px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.12em]", readiness.className)}>{readiness.label}</span>
                  </div>
                </div>
                <p className="mt-4 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-600">{readableCode(route.channel)}</p>
                <p className="mt-1 break-all text-sm font-semibold text-zinc-100">{route.value}</p>
                <p className="mt-2 text-[11px] leading-5 text-zinc-500">
                  {[route.personName, route.role, route.label].filter(Boolean).join(" · ") || "Business contact route"}
                </p>
                <div className="mt-3 flex items-center justify-between gap-2 border-t border-white/[0.06] pt-3">
                  <span className="text-[9px] text-zinc-600">Captured {formatDateTime(route.sourceCapturedAt)}</span>
                  <a href={route.sourceUrl} target="_blank" rel="noreferrer" className="v2-focus-ring inline-flex min-h-8 items-center gap-1 rounded-md px-1 text-[10px] font-semibold text-emerald-300 hover:text-emerald-200">
                    Evidence <ExternalLink className="size-3" aria-hidden="true" />
                  </a>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="mt-4 rounded-xl border border-amber-300/15 bg-amber-300/[0.04] p-4">
          <p className="text-sm font-semibold text-amber-100">No usable route is currently recorded</p>
          <p className="mt-1 text-xs leading-5 text-amber-100/70">Keep this business in research. Do not infer an email or contact channel.</p>
        </div>
      )}
      {data.ignoredRouteRows > 0 ? (
        <p role="status" className="mt-3 text-[10px] leading-4 text-amber-100/65">{data.ignoredRouteRows} malformed route {data.ignoredRouteRows === 1 ? "record was" : "records were"} omitted.</p>
      ) : null}
    </section>
  );
}

function ContactReviewSection({ data }: { data: OwnerLeadDetailResponse }) {
  const review = data.contactReview;
  if (review.state === "NOT_RECORDED") {
    return (
      <section aria-labelledby="contact-review" className="rounded-2xl border border-amber-300/15 bg-amber-300/[0.035] p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <div className="grid size-9 shrink-0 place-items-center rounded-xl border border-amber-300/15 bg-amber-300/[0.05]">
            <ClipboardCheck className="size-4 text-amber-200" aria-hidden="true" />
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-amber-200">Owner checkpoint</p>
            <h2 id="contact-review" className="mt-1 text-lg font-semibold text-white">Contact review not recorded</h2>
            <p className="mt-1 max-w-3xl text-xs leading-5 text-amber-100/70">
              These routes can be inspected, but the Revenue Engine cannot claim Riley or Aidan reviewed this exact contact packet. Keep it in research until a signed local review receipt exists.
            </p>
          </div>
        </div>
        <p className="mt-4 rounded-xl border border-white/[0.07] bg-black/20 p-3 text-[11px] leading-5 text-zinc-500">
          Consent is unassessed. This screen cannot approve qualification, outreach, or sending.
        </p>
      </section>
    );
  }

  const stale = review.state === "STALE_ASSESSMENT";
  const reviewer = readableCode(review.reviewedBy);
  const routeBreakdown = [
    `${review.summary.emailReviewRoutes} email review`,
    `${review.summary.manualRoutes} manual`,
    `${review.summary.researchRoutes} research`,
  ].join(" · ");
  return (
    <section aria-labelledby="contact-review" className={cn(
      "rounded-2xl border p-4 sm:p-5",
      stale ? "border-amber-300/18 bg-amber-300/[0.035]" : "border-emerald-300/15 bg-emerald-300/[0.025]",
    )}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <div className={cn(
            "grid size-9 shrink-0 place-items-center rounded-xl border",
            stale ? "border-amber-300/15 bg-amber-300/[0.05]" : "border-emerald-300/15 bg-emerald-300/[0.05]",
          )}>
            <ClipboardCheck className={cn("size-4", stale ? "text-amber-200" : "text-emerald-200")} aria-hidden="true" />
          </div>
          <div>
            <p className={cn("text-[10px] font-semibold uppercase tracking-[0.16em]", stale ? "text-amber-200" : "text-emerald-300")}>Owner checkpoint</p>
            <h2 id="contact-review" className="mt-1 text-lg font-semibold text-white">Reviewed contact evidence</h2>
            <p className="mt-1 max-w-3xl text-xs leading-5 text-zinc-500">
              {reviewer} reviewed this exact evidence packet on {formatDateTime(review.reviewedAt)} and approved storing its contact records locally.
            </p>
          </div>
        </div>
        <span className={cn(
          "w-fit rounded-full border px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.13em]",
          stale
            ? "border-amber-300/20 bg-amber-300/[0.06] text-amber-100"
            : "border-emerald-300/20 bg-emerald-300/[0.06] text-emerald-200",
        )}>
          {stale ? "Older than current assessment" : "Matches current assessment"}
        </span>
      </div>

      {stale ? (
        <p role="status" className="mt-4 rounded-xl border border-amber-300/15 bg-black/20 p-3 text-[11px] leading-5 text-amber-100/75">
          The website audit or lead score changed after this review. The stored review remains traceable, but it does not approve the current assessment.
        </p>
      ) : null}

      <dl className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
        {[
          ["Candidates reviewed", review.summary.candidates],
          ["Verification checks", review.summary.verificationResults],
          ["Usable routes", review.summary.usableRoutes],
          ["Assessment", readableCode(review.assessment.classification)],
        ].map(([label, value]) => (
          <div key={label} className="rounded-xl border border-white/[0.07] bg-black/20 p-3">
            <dt className="text-[9px] font-semibold uppercase tracking-[0.13em] text-zinc-600">{label}</dt>
            <dd className="mt-2 text-sm font-semibold text-zinc-200">{value}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(260px,0.6fr)]">
        <div className="rounded-xl border border-white/[0.07] bg-black/20 p-3">
          <p className="text-[9px] font-semibold uppercase tracking-[0.13em] text-zinc-600">Why it was approved for local storage</p>
          <p className="mt-2 text-xs leading-5 text-zinc-300">{review.rationale}</p>
        </div>
        <div className="rounded-xl border border-white/[0.07] bg-black/20 p-3">
          <p className="text-[9px] font-semibold uppercase tracking-[0.13em] text-zinc-600">Route outcome</p>
          <p className="mt-2 text-xs leading-5 text-zinc-300">{routeBreakdown}</p>
        </div>
      </div>

      <p className="mt-3 rounded-xl border border-rose-300/15 bg-rose-300/[0.035] p-3 text-[11px] leading-5 text-rose-100/75">
        Consent is still unassessed. This review authorized local contact storage only—not qualification, outreach, sending, provider use, or spend.
      </p>
    </section>
  );
}

function HistorySection({ data }: { data: OwnerLeadDetailResponse }) {
  return (
    <section aria-labelledby="lead-history" className="rounded-2xl border border-white/[0.08] bg-[#0e1014] p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <div className="grid size-9 shrink-0 place-items-center rounded-xl border border-white/[0.08] bg-white/[0.03]">
          <History className="size-4 text-zinc-300" aria-hidden="true" />
        </div>
        <div>
          <h2 id="lead-history" className="text-lg font-semibold text-white">Evidence and decision history</h2>
          <p className="mt-1 text-xs leading-5 text-zinc-500">Only events present in the v2 shadow model are shown. Missing sales history is labelled instead of guessed.</p>
        </div>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(280px,0.8fr)]">
        <div>
          {data.history.events.length > 0 ? (
            <ol className="space-y-2">
              {data.history.events.map((event) => {
                const Icon = HISTORY_ICONS[event.eventType];
                return (
                  <li key={`${event.eventType}:${event.eventId}`} className="grid grid-cols-[34px_minmax(0,1fr)] gap-3 rounded-xl border border-white/[0.07] bg-black/20 p-3">
                    <div className="grid size-8 place-items-center rounded-lg border border-white/[0.08] bg-white/[0.03]">
                      <Icon className="size-3.5 text-zinc-400" aria-hidden="true" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-xs font-semibold text-zinc-200">{event.title}</p>
                        <time dateTime={event.occurredAt} className="font-mono text-[9px] text-zinc-600">{formatDateTime(event.occurredAt)}</time>
                      </div>
                      <p className="mt-1 text-[11px] leading-5 text-zinc-500">{event.description}</p>
                      {event.sourceUrl ? (
                        <a href={event.sourceUrl} target="_blank" rel="noreferrer" className="v2-focus-ring mt-1 inline-flex min-h-8 items-center gap-1 rounded-md text-[10px] font-semibold text-emerald-300 hover:text-emerald-200">
                          Event evidence <ExternalLink className="size-3" aria-hidden="true" />
                        </a>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ol>
          ) : <p className="rounded-xl border border-white/[0.07] bg-black/20 p-4 text-xs text-zinc-500">No v2 evidence events are recorded yet.</p>}
          {data.history.truncated ? <p role="status" className="mt-3 text-[10px] text-amber-100/65">Only the newest 100 v2 events are shown.</p> : null}
        </div>

        <aside aria-labelledby="history-not-available" className="rounded-xl border border-dashed border-white/[0.1] bg-white/[0.015] p-4">
          <div className="flex items-center gap-2">
            <Clock3 className="size-4 text-zinc-500" aria-hidden="true" />
            <h3 id="history-not-available" className="text-xs font-semibold text-zinc-200">Not available yet</h3>
          </div>
          <ul className="mt-3 space-y-3">
            {data.history.unavailable.map((item) => (
              <li key={item.area} className="rounded-lg border border-white/[0.06] bg-black/20 p-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.13em] text-zinc-500">{readableCode(item.area)}</p>
                <p className="mt-1 text-[11px] leading-5 text-zinc-600">{item.reason}</p>
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </section>
  );
}

export function OwnerLeadDetailUnavailable() {
  return (
    <div className="mx-auto max-w-[1100px] space-y-5">
      <Link href="/leads" className="v2-focus-ring inline-flex min-h-9 items-center gap-2 rounded-lg px-1 text-xs font-semibold text-zinc-400 hover:text-white">
        <ArrowLeft className="size-3.5" aria-hidden="true" /> Back to ranked leads
      </Link>
      <PageHeader
        eyebrow="Evidence-first pipeline"
        title="Lead dossier unavailable"
        description="The current business, audit, routes, or history could not be verified as one consistent dossier. No fallback data is shown."
        icon={AlertTriangle}
        status={<span className="rounded-full border border-rose-300/20 bg-rose-300/[0.07] px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-rose-100">Safety stopped</span>}
      />
      <section role="alert" className="rounded-2xl border border-rose-300/15 bg-[#0e1014] px-5 py-10 text-center">
        <AlertTriangle className="mx-auto size-7 text-rose-300" aria-hidden="true" />
        <h2 className="mt-4 text-lg font-semibold text-white">The engine refused to assemble an uncertain dossier</h2>
        <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-zinc-400">Check System for data drift or an unavailable database. This page remains read-only and no outreach was started.</p>
      </section>
    </div>
  );
}

export function OwnerLeadDetailNotFound() {
  return (
    <div className="mx-auto max-w-[900px] space-y-5">
      <PageHeader
        eyebrow="Evidence-first pipeline"
        title="Lead dossier not found"
        description="This identity does not have a current KW v2 audit and shadow qualification. Legacy or incomplete data is not promoted into the owner queue."
        icon={FileSearch}
      />
      <Link href="/leads" className="v2-focus-ring inline-flex min-h-10 items-center gap-2 rounded-lg border border-white/[0.1] bg-white/[0.035] px-4 text-xs font-semibold text-zinc-200 hover:bg-white/[0.06] hover:text-white">
        <ArrowLeft className="size-3.5" aria-hidden="true" /> Return to ranked leads
      </Link>
    </div>
  );
}
