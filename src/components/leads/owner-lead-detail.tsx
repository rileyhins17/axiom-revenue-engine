import {
  AlertTriangle,
  ArrowLeft,
  ArrowUpRight,
  Building2,
  ChevronDown,
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
import type { ReactNode } from "react";

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
    className: "border-[#e8c8c2] bg-[#fff3f1] text-[#8d2929]",
  },
  IMPORTANT: {
    label: "Important",
    className: "border-[#eadfbd] bg-[#fff8e8] text-[#76591f]",
  },
  MINOR: {
    label: "Minor",
    className: "border-[#d6e3e9] bg-[#eef5f8] text-[#426d88]",
  },
} as const;

const ROUTE_READINESS_COPY = {
  CURRENT_USABLE: { label: "Current", className: "text-[#315740] border-[#c8ddc7] bg-[#eff6ed]" },
  UNVERIFIED: { label: "Not verified", className: "text-[#76591f] border-[#eadfbd] bg-[#fff8e8]" },
  STALE: { label: "Stale", className: "text-[#76591f] border-[#eadfbd] bg-[#fff8e8]" },
  BLOCKED: { label: "Blocked", className: "text-[#8d2929] border-[#e8c8c2] bg-[#fff3f1]" },
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
    return { label: "Meets legacy rules", description: "Saved evidence met the old score threshold. Business Review requires a separate owner decision." };
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

function topWebsiteFindings(data: OwnerLeadDetailResponse) {
  const severityOrder = { CRITICAL: 0, IMPORTANT: 1, MINOR: 2 } as const;
  return [...data.website.findings]
    .sort((left, right) => severityOrder[left.severity] - severityOrder[right.severity])
    .slice(0, 3);
}

function strongestSupportedFinding(data: OwnerLeadDetailResponse) {
  const severityOrder = { CRITICAL: 0, IMPORTANT: 1, MINOR: 2 } as const;
  return [...data.website.findings]
    .filter((finding) => finding.claim)
    .sort((left, right) => severityOrder[left.severity] - severityOrder[right.severity])[0] ?? null;
}

function uncertaintySummary(data: OwnerLeadDetailResponse) {
  const openQuestions: string[] = [];
  const unknownChecks = data.website.findings.filter((finding) => finding.outcome === "UNKNOWN").length;
  if (unknownChecks > 0) openQuestions.push(`${unknownChecks} website ${unknownChecks === 1 ? "check is" : "checks are"} still unknown`);
  if (data.website.manualReviewReasons.length > 0) {
    openQuestions.push(...data.website.manualReviewReasons.map(readableCode));
  }
  if (data.lead.qualification.failedGates.length > 0) {
    openQuestions.push(`${data.lead.qualification.failedGates.length} business review ${data.lead.qualification.failedGates.length === 1 ? "check is" : "checks are"} still open`);
  }
  if (data.lead.dataQuality.state !== "CURRENT" || data.lead.dataQuality.issues.length > 0) {
    openQuestions.push(...data.lead.dataQuality.issues.map(readableCode));
  }
  return openQuestions.length > 0
    ? [...new Set(openQuestions)].join(" · ")
    : "No additional gaps are recorded. Findings apply only to the pages and sources captured for this audit.";
}

function OwnerNextStep({ data }: { data: OwnerLeadDetailResponse }) {
  const lead = data.lead;
  const stopped = data.operationalStopState === "STOPPED" || data.operationalStopState === "UNAVAILABLE";
  const recommendedRoute = data.routes.find((route) => route.contactPointId === lead.route.contactPointId);
  const canReviewRoute = !stopped && lead.attention === "READY_FOR_REVIEW" && lead.ownerActionable;
  const action = stopped
    ? data.operationalStopState === "STOPPED" ? "Keep contact stopped" : "Pause contact review"
    : canReviewRoute ? "Review the recommended route manually" : "Continue qualification or refresh research";
  const actionReason = stopped
    ? "The business stop is active or could not be checked. Recorded routes remain evidence only."
    : canReviewRoute ? lead.route.reason : decisionStateCopy(lead).description;
  const findings = topWebsiteFindings(data);
  const strongestFinding = strongestSupportedFinding(data);
  const supportedFindingCount = data.website.findings.filter((finding) => finding.claim).length;
  const uncertainty = uncertaintySummary(data);

  return (
    <section aria-labelledby="owner-next-step" className="overflow-hidden rounded-2xl border border-[#d5e5d2] bg-[#f4f8f2]">
      <div className="grid gap-5 p-4 sm:p-5 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:items-start lg:p-6">
        <div className="space-y-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#176443]">Decision brief · what was found</p>
            <p className="mt-1 text-sm font-semibold text-[#24382d]">{readableCode(data.website.classification)} website · {supportedFindingCount} supported {supportedFindingCount === 1 ? "finding" : "findings"}</p>
            <p className="mt-1 text-xs leading-5 text-[#53675a]">This summarizes captured website evidence; it does not establish overall business quality or permission to contact.</p>
          </div>

          <div className="rounded-xl border border-[#d5e5d2] bg-white p-3">
            <p className="text-[9px] font-semibold uppercase tracking-[0.13em] text-[#566a5d]">Strongest supported evidence</p>
            {strongestFinding?.claim ? (
              <>
                <p className="mt-1 text-xs font-semibold text-[#35493b]">{readableCode(strongestFinding.category)} · {SEVERITY_COPY[strongestFinding.severity].label}</p>
                <p className="mt-1 text-[11px] leading-5 text-[#425b4d]">{strongestFinding.claim.observation}</p>
                <a href={strongestFinding.claim.sourceUrl} target="_blank" rel="noreferrer" className="v2-focus-ring mt-1 inline-flex min-h-8 items-center gap-1 rounded-md text-[10px] font-semibold text-[#176443] hover:text-[#315740]">
                  Inspect source · captured {formatDateTime(strongestFinding.claim.capturedAt)} <ExternalLink className="size-3" aria-hidden="true" />
                </a>
              </>
            ) : <p className="mt-1 text-[11px] leading-5 text-[#76591f]">No supported website claim is available yet. Keep this business in research.</p>}
          </div>

          <div className="rounded-xl border border-[#eadfbd] bg-[#fff8e8] p-3">
            <p className="text-[9px] font-semibold uppercase tracking-[0.13em] text-[#76591f]">What remains uncertain</p>
            <p className="mt-1 text-[11px] leading-5 text-[#76591f]">{uncertainty}</p>
          </div>

          <div className="rounded-xl border border-[#d5e5d2] bg-white p-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.13em] text-[#176443]">Owner next step</p>
            <h2 id="owner-next-step" className="mt-1 text-base font-semibold text-[#1a3124]">{action}</h2>
            <p className="mt-1 text-xs leading-5 text-[#53675a]">{actionReason}</p>
            {canReviewRoute && recommendedRoute ? (
              <div className="mt-3 border-t border-[#e4ebe2] pt-3">
                <p className="text-[9px] font-semibold uppercase tracking-[0.13em] text-[#566a5d]">Suggested route · read-only</p>
                <p className="mt-1 text-sm font-semibold text-[#24382d]">{recommendedRoute.value}</p>
                <p className="mt-1 text-[11px] leading-5 text-[#617367]">{readableCode(recommendedRoute.channel)} · {ROUTE_READINESS_COPY[recommendedRoute.readiness].label}</p>
                <a href={recommendedRoute.sourceUrl} target="_blank" rel="noreferrer" className="v2-focus-ring mt-1 inline-flex min-h-8 items-center gap-1 rounded-md text-[10px] font-semibold text-[#176443] hover:text-[#315740]">
                  Route evidence <ExternalLink className="size-3" aria-hidden="true" />
                </a>
              </div>
            ) : null}
            <p className="mt-3 text-[10px] leading-4 text-[#617367]">This is a review reminder only. The page cannot contact the business or approve outreach.</p>
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-xs font-semibold text-[#35493b]">Top website findings</h3>
            <span className="font-mono text-[10px] text-[#566a5d]">{findings.length} of {data.website.findings.length}</span>
          </div>
          {findings.length > 0 ? (
            <ol className="mt-2 divide-y divide-[#e4ebe2] rounded-xl border border-[#e1e9df] bg-white">
              {findings.map((finding) => (
                <li key={finding.checkId} className="flex items-start justify-between gap-3 p-3">
                  <div>
                    <p className="text-xs font-semibold text-[#35493b]">{readableCode(finding.category)} <span className="font-normal text-[#617367]">· {SEVERITY_COPY[finding.severity].label}</span></p>
                    <p className="mt-1 text-[11px] leading-5 text-[#425b4d]">{finding.claim?.observation ?? "This check is incomplete and has no supported claim. Manual review is required."}</p>
                  </div>
                  {finding.claim ? (
                    <a href={finding.claim.sourceUrl} target="_blank" rel="noreferrer" className="v2-focus-ring inline-flex min-h-8 shrink-0 items-center gap-1 rounded-md px-1 text-[10px] font-semibold text-[#176443] hover:text-[#315740]">
                      Proof <ExternalLink className="size-3" aria-hidden="true" />
                    </a>
                  ) : null}
                </li>
              ))}
            </ol>
          ) : <p className="mt-2 rounded-xl border border-[#e1e9df] bg-white p-3 text-xs text-[#617367]">No website findings are recorded.</p>}
        </div>
      </div>
    </section>
  );
}

export function OwnerLeadDetail({ data, ownerControls, contactControls }: { data: OwnerLeadDetailResponse; ownerControls?: ReactNode; contactControls?: ReactNode }) {
  const lead = data.lead;
  const qualifiedForReview = lead.attention === "READY_FOR_REVIEW" && lead.ownerActionable;
  const decisionState = decisionStateCopy(lead);
  const description = !qualifiedForReview
    ? decisionState.description
    : "Review the strongest supported website evidence, remaining gaps, and recommended owner action below.";

  return (
    <div data-owner-readonly-dossier className="mx-auto flex max-w-[1320px] flex-col gap-4 text-[#263a2f]">
      <Link
        href="/leads"
        className="v2-focus-ring inline-flex min-h-9 w-fit items-center gap-2 rounded-lg px-1 text-xs font-semibold text-[#53675a] hover:text-[#176443]"
      >
        <ArrowLeft className="size-3.5" aria-hidden="true" />
        Back to businesses
      </Link>

      <header className="overflow-hidden rounded-[22px] border border-[#dce6d9] bg-white shadow-sm">
        <div className="flex flex-col gap-5 p-5 sm:p-7 lg:flex-row lg:items-start lg:justify-between lg:p-8">
          <div className="flex min-w-0 gap-4">
            <div className="grid size-11 shrink-0 place-items-center rounded-2xl bg-[#edf4eb] text-[#176443] ring-1 ring-inset ring-[#dce9d9]">
              <Building2 className="size-5" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2.5">
                <p className="text-[10px] font-bold uppercase tracking-[0.17em] text-[#406849]">{readableCode(lead.business.niche)} · {readableCode(lead.business.location.city)}</p>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-[#eadfbd] bg-[#fff8e8] px-2.5 py-1 text-[10px] font-semibold text-[#76591f]">
                  <ShieldCheck className="size-3" aria-hidden="true" /> Previous score · read-only
                </span>
              </div>
              <h1 className="mt-2 text-[28px] font-semibold leading-tight tracking-[-0.04em] text-[#172d20] sm:text-4xl">{lead.business.canonicalName}</h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-[#5d6d62]">{description}</p>
              <p className="mt-2 text-xs font-medium leading-5 text-[#53675a]">This preview does not confirm business fit, contact readiness, or permission to reach out.</p>
            </div>
          </div>
          {lead.business.websiteUrl ? (
            <a href={lead.business.websiteUrl} target="_blank" rel="noreferrer" className="v2-focus-ring inline-flex min-h-11 w-fit shrink-0 items-center justify-center gap-2 rounded-xl border border-[#d8e2d5] bg-[#f8faf6] px-4 text-sm font-semibold text-[#315740] transition hover:border-[#b8cdb7] hover:bg-[#f0f5ee]">
              Current website <ArrowUpRight className="size-4" aria-hidden="true" />
            </a>
          ) : null}
        </div>
      </header>

      <OwnerNextStep data={data} />

      {ownerControls ? <div aria-label="Owner controls" className="grid gap-4 xl:grid-cols-[minmax(300px,0.7fr)_minmax(0,1.3fr)] xl:items-start">{ownerControls}</div> : null}
      {contactControls ? <div aria-label="Email contact stops">{contactControls}</div> : null}
      <ContactReviewSection data={data} />

      <details className="overflow-hidden rounded-2xl border border-[#dce6d9] bg-white shadow-sm">
        <summary className="v2-focus-ring flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-semibold text-[#24382d] marker:hidden sm:px-5">
          <span>Research details</span>
          <span className="flex shrink-0 items-center gap-2 text-xs font-normal text-[#617367]">
            Routes, history, full audit <ChevronDown className="size-4" aria-hidden="true" />
          </span>
        </summary>
        <div className="space-y-4 border-t border-[#e4ebe2] p-4 sm:p-5">

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.55fr)] xl:items-start">
        <section aria-labelledby="why-this-lead" className="rounded-2xl border border-[#e1e9df] bg-white p-4 sm:p-5">
          <div className="flex items-center gap-2">
            <Sparkles className="size-4 text-[#176443]" aria-hidden="true" />
            <h2 id="why-this-lead" className="text-sm font-semibold text-[#1a3124]">{qualifiedForReview ? "Why the old score flagged this business" : "Qualification status"}</h2>
          </div>
          {qualifiedForReview && lead.whyThisLead.length > 0 ? (
            <ol className="mt-4 grid gap-3 md:grid-cols-3 md:items-start">
              {lead.whyThisLead.map((claim, index) => (
                <li key={claim.claimId} className="rounded-xl border border-[#e4ebe2] bg-[#f8faf6] p-4">
                  <span className="font-mono text-[10px] text-[#176443]">0{index + 1}</span>
                  <p className="mt-3 text-sm leading-6 text-[#35493b]">{claim.observation}</p>
                  <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[9px] font-semibold uppercase tracking-[0.14em] text-[#566a5d]">
                      {claim.conversionCritical ? "Conversion critical" : readableCode(claim.category)}
                    </span>
                    <a
                      href={claim.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="v2-focus-ring inline-flex min-h-8 items-center gap-1 rounded-md px-1 text-[10px] font-semibold text-[#176443] hover:text-[#315740]"
                    >
                      Inspect proof <ExternalLink className="size-3" aria-hidden="true" />
                    </a>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p className="mt-4 rounded-xl border border-[#eadfbd] bg-[#fff8e8] p-4 text-sm leading-6 text-[#76591f]">
              {decisionState.description} The supporting evidence remains available below.
            </p>
          )}
        </section>

        <aside aria-labelledby="decision-state" className="rounded-2xl border border-[#e1e9df] bg-white p-4 sm:p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 id="decision-state" className="text-sm font-semibold text-[#1a3124]">Decision state</h2>
            <span className={cn(
              "rounded-full border px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.14em]",
              qualifiedForReview
                ? "border-[#c8ddc7] bg-[#eff6ed] text-[#315740]"
                : lead.attention === "BLOCKED"
                  ? "border-[#e8c8c2] bg-[#fff3f1] text-[#8d2929]"
                  : "border-[#eadfbd] bg-[#fff8e8] text-[#76591f]",
            )}>
              {decisionState.label}
            </span>
          </div>
          <details className="mt-3 rounded-xl border border-[#e4ebe2] bg-[#f8faf6]">
            <summary className="v2-focus-ring flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-3 py-2 text-xs font-semibold text-[#425b4d] marker:hidden">
              <span>Previous score details</span>
              <span className="font-mono text-[11px] font-medium tabular-nums text-[#617367]">{lead.qualification.totalScore}/100</span>
            </summary>
            <dl className="grid grid-cols-2 gap-2 border-t border-[#e4ebe2] p-3">
              {SCORE_LABELS.map(({ key, label }) => (
                <div key={key} className={cn("rounded-lg border border-[#e4ebe2] bg-white p-2.5", key === "evidenceConfidence" && "col-span-2")}>
                  <dt className="text-[9px] font-semibold uppercase tracking-[0.13em] text-[#566a5d]">{label}</dt>
                  <dd className="mt-1 flex items-end justify-between gap-2">
                    <span className="font-mono text-base font-semibold tabular-nums text-[#24382d]">{lead.qualification.scores[key]}</span>
                    <span className="text-[9px] text-[#566a5d]">/100</span>
                  </dd>
                </div>
              ))}
            </dl>
          </details>
          <div className="mt-3 rounded-xl border border-[#e4ebe2] bg-[#f8faf6] p-3">
            <p className="text-[10px] font-semibold text-[#425b4d]">Evidence state</p>
            <p className="mt-1 text-xs leading-5 text-[#617367]">
              {readableCode(lead.dataQuality.state)} · audit {lead.audit.auditVersion}
            </p>
            {lead.dataQuality.issues.length > 0 ? (
              <ul className="mt-2 space-y-1 text-[11px] leading-4 text-[#76591f]">
                {lead.dataQuality.issues.map((issue) => <li key={issue}>• {readableCode(issue)}</li>)}
              </ul>
            ) : null}
            {!qualifiedForReview && lead.qualification.failedGates.length > 0 ? (
              <div className="mt-3 rounded-xl border border-[#eadfbd] bg-[#fff8e8] p-3">
                <p className="text-[10px] font-semibold text-[#76591f]">Qualification gates still open</p>
                <ul className="mt-2 space-y-1 text-[11px] leading-4 text-[#76591f]">
                  {lead.qualification.failedGates.map((gate) => <li key={gate}>• {readableCode(gate)}</li>)}
                </ul>
              </div>
            ) : null}
          </div>
        </aside>
      </div>

      <Reachability data={data} />
      <HistorySection data={data} />

      <details className="overflow-hidden rounded-2xl border border-[#e1e9df] bg-white">
        <summary className="v2-focus-ring flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-semibold text-[#24382d] marker:hidden sm:px-5">
          <span>Full website audit and evidence details</span>
          <span className="flex shrink-0 items-center gap-2">
            <span className="rounded-full border border-[#e1e9df] bg-[#f1f5ef] px-2.5 py-1 text-[10px] font-medium text-[#566a5d]">{data.website.findings.length} findings</span>
            <ChevronDown className="size-4 text-[#617367]" aria-hidden="true" />
          </span>
        </summary>
        <div className="border-t border-[#e4ebe2]">
          <WebsiteEvidence data={data} />
        </div>
      </details>

      <section aria-label="Dossier provenance" className="grid gap-3 rounded-2xl border border-[#e1e9df] bg-white p-4 text-xs text-[#617367] sm:grid-cols-3 sm:p-5">
        <div>
          <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-[#566a5d]">Business location</p>
          <p className="mt-2 inline-flex items-start gap-2 leading-5 text-[#425b4d]"><MapPin className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />{locationLine(data)}</p>
        </div>
        <div>
          <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-[#566a5d]">Discovery source</p>
          <p className="mt-2 text-[#425b4d]">{data.identity.sourceAdapter}</p>
          <a href={lead.business.sourceEvidenceUrl} target="_blank" rel="noreferrer" className="v2-focus-ring mt-1 inline-flex min-h-8 items-center gap-1 rounded-md text-[#176443] hover:text-[#315740]">
            Source evidence <ExternalLink className="size-3" aria-hidden="true" />
          </a>
        </div>
        <div>
          <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-[#566a5d]">Verified view</p>
          <p className="mt-2 text-[#425b4d]">{formatDateTime(data.generatedAt)}</p>
          <p className="mt-1 font-mono text-[9px] text-[#566a5d]">{data.readModelVersion}</p>
        </div>
      </section>
        </div>
      </details>

      <div role="note" className="flex gap-3 rounded-xl border border-[#eadfbd] bg-[#fff8e8] p-4 text-xs leading-5 text-[#76591f]">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-[#76591f]" aria-hidden="true" />
        <p>{ownerControls
          ? "Research details and recorded routes are read-only. The owner controls above can save a local stop or task, but cannot contact this business or approve outreach."
          : "This dossier is read-only. No email, call, form, social message, provider request, or database change can start here."}</p>
      </div>
    </div>
  );
}

function WebsiteEvidence({ data }: { data: OwnerLeadDetailResponse }) {
  const findings = data.website.findings;
  return (
    <section aria-labelledby="website-evidence" className="overflow-hidden rounded-2xl border border-[#e1e9df] bg-white">
      <div className="flex flex-col gap-2 border-b border-[#e4ebe2] p-4 sm:flex-row sm:items-end sm:justify-between sm:p-5">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#176443]">Current audit</p>
          <h2 id="website-evidence" className="mt-1 text-lg font-semibold text-[#1a3124]">Website evidence</h2>
          <p className="mt-1 text-xs leading-5 text-[#617367]">Captured {formatDateTime(data.website.capturedAt)} · refresh after {formatDateTime(data.website.refreshAfter)}</p>
        </div>
        <span className="w-fit rounded-full border border-[#e1e9df] bg-[#f1f5ef] px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.14em] text-[#53675a]">
          {readableCode(data.website.classification)}
        </span>
      </div>

      <div className="grid gap-4 p-4 sm:p-5 lg:grid-cols-[minmax(0,0.72fr)_minmax(0,1.28fr)]">
        <div>
          <h3 className="text-xs font-semibold text-[#35493b]">Capture references</h3>
          <div className="mt-3 grid gap-2 sm:grid-cols-3 lg:grid-cols-1">
            {data.website.artifacts.map((item) => {
              const Icon = ARTIFACT_ICONS[item.kind];
              return (
                <div key={item.kind} className="rounded-xl border border-[#e4ebe2] bg-[#f8faf6] p-3">
                  <div className="flex items-start gap-3">
                    <div className="grid size-8 shrink-0 place-items-center rounded-lg border border-[#e1e9df] bg-[#f1f5ef]">
                      <Icon className="size-3.5 text-[#53675a]" aria-hidden="true" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-[10px] font-semibold text-[#35493b]">{readableCode(item.kind)} capture</p>
                      <p className="mt-1 text-[11px] leading-4 text-[#617367]">
                        {item.availability === "REFERENCE_RECORDED" ? "Artifact reference recorded" : "Not captured"}
                      </p>
                      {item.reference ? <p className="mt-1 truncate font-mono text-[9px] text-[#566a5d]" title={item.reference}>{item.reference}</p> : null}
                    </div>
                  </div>
                  <p className="mt-3 border-t border-[#e8eee6] pt-2 text-[10px] leading-4 text-[#76591f]">
                    Preview unavailable until private evidence storage is enabled.
                  </p>
                </div>
              );
            })}
          </div>
          <p className="mt-3 text-[10px] leading-4 text-[#566a5d]">{data.website.passedCheckCount} deterministic checks passed.</p>
        </div>

        <div>
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-xs font-semibold text-[#35493b]">Findings by severity</h3>
            <span className="font-mono text-[10px] text-[#566a5d]">{findings.length} shown</span>
          </div>
          <div className="mt-3 space-y-4">
            {(["CRITICAL", "IMPORTANT", "MINOR"] as const).map((severity) => {
              const group = findings.filter((finding) => finding.severity === severity);
              const copy = SEVERITY_COPY[severity];
              return (
                <section key={severity} aria-labelledby={`findings-${severity.toLowerCase()}`}>
                  <div className="flex items-center gap-2">
                    <h4 id={`findings-${severity.toLowerCase()}`} className={cn("rounded-md border px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.14em]", copy.className)}>{copy.label}</h4>
                    <span className="font-mono text-[10px] text-[#566a5d]">{group.length}</span>
                  </div>
                  {group.length > 0 ? (
                    <ul className="mt-2 divide-y divide-[#e8eee6] rounded-xl border border-[#e4ebe2] bg-[#f8faf6]">
                      {group.map((finding) => (
                        <li key={finding.checkId} className="p-3">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div>
                              <p className="text-xs font-semibold text-[#35493b]">{readableCode(finding.category)}</p>
                              <p className="mt-1 text-[10px] text-[#566a5d]">{readableCode(finding.outcome)} · score impact {finding.scoreImpact}</p>
                            </div>
                            {finding.claim ? (
                              <a href={finding.claim.sourceUrl} target="_blank" rel="noreferrer" className="v2-focus-ring inline-flex min-h-8 items-center gap-1 rounded-md px-1 text-[10px] font-semibold text-[#176443] hover:text-[#315740]">
                                Proof <ExternalLink className="size-3" aria-hidden="true" />
                              </a>
                            ) : null}
                          </div>
                          <p className={cn("mt-2 text-xs leading-5", finding.claim ? "text-[#425b4d]" : "text-[#76591f]")}>
                            {finding.claim?.observation ?? "This check is incomplete and has no supported claim. Manual review is required."}
                          </p>
                        </li>
                      ))}
                    </ul>
                  ) : <p className="mt-2 text-[11px] text-[#566a5d]">No {copy.label.toLowerCase()} findings in this audit.</p>}
                </section>
              );
            })}
          </div>
          {data.website.evidenceTruncated ? (
            <p role="status" className="mt-4 rounded-lg border border-[#eadfbd] bg-[#fff8e8] p-3 text-[11px] leading-5 text-[#76591f]">
              The audit exceeds the safe dossier display limit. Review the audit receipt before relying on this summary.
            </p>
          ) : null}
          {data.website.manualReviewReasons.length > 0 ? (
            <div className="mt-4 rounded-xl border border-[#eadfbd] bg-[#fff8e8] p-3">
              <p className="text-[10px] font-semibold text-[#76591f]">Manual review needed</p>
              <ul className="mt-2 space-y-1 text-[11px] leading-5 text-[#76591f]">
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
  const operationalStop = data.operationalStopState === "STOPPED" || data.operationalStopState === "UNAVAILABLE";
  return (
    <section aria-labelledby="reachable-routes" className="rounded-2xl border border-[#e1e9df] bg-white p-4 sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#176443]">Reachability</p>
          <h2 id="reachable-routes" className="mt-1 text-lg font-semibold text-[#1a3124]">Every recorded route</h2>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-[#617367]">
            {operationalStop
              ? "Recorded channels remain evidence only. No contact action is available while the business is stopped or its stop status cannot be checked."
              : "The recommended route is explained, but every channel remains read-only. Phone, forms, and social are always manual."}
          </p>
        </div>
        <div className={cn("rounded-xl border p-3 sm:max-w-sm", operationalStop
          ? "border-[#e8c8c2] bg-[#fff3f1]"
          : "border-[#d5e5d2] bg-[#eff6ed]")}>
          <p className={cn("text-[10px] font-semibold", operationalStop ? "text-[#8d2929]" : "text-[#315740]")}>
            {operationalStop ? "Contact status" : "Recommended"}: {data.lead.route.label}
          </p>
          <p className="mt-1 text-[11px] leading-5 text-[#53675a]">{data.lead.route.reason}</p>
        </div>
      </div>

      {data.routes.length > 0 ? (
        <ul className="mt-4 grid gap-3 md:grid-cols-2 md:items-start xl:grid-cols-3">
          {data.routes.map((route) => {
            const Icon = ROUTE_ICONS[route.channel];
            const readiness = ROUTE_READINESS_COPY[route.readiness];
            return (
              <li key={route.contactPointId} className={cn("rounded-xl border bg-[#f8faf6] p-4", route.recommended ? "border-[#c8ddc7]" : "border-[#e4ebe2]")}>
                <div className="flex items-start justify-between gap-3">
                  <div className="grid size-9 place-items-center rounded-xl border border-[#e1e9df] bg-[#f1f5ef]">
                    <Icon className="size-4 text-[#425b4d]" aria-hidden="true" />
                  </div>
                  <div className="flex flex-wrap justify-end gap-1.5">
                    {route.recommended ? <span className="rounded-full border border-[#c8ddc7] bg-[#eff6ed] px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.12em] text-[#315740]">Recommended</span> : null}
                    <span className={cn("rounded-full border px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.12em]", readiness.className)}>{readiness.label}</span>
                  </div>
                </div>
                <p className="mt-4 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#566a5d]">{readableCode(route.channel)}</p>
                <p className="mt-1 break-all text-sm font-semibold text-[#24382d]">{route.value}</p>
                <p className="mt-2 text-[11px] leading-5 text-[#617367]">
                  {[route.personName, route.role, route.label].filter(Boolean).join(" · ") || "Business contact route"}
                </p>
                <div className="mt-3 flex items-center justify-between gap-2 border-t border-[#e8eee6] pt-3">
                  <span className="text-[9px] text-[#566a5d]">Captured {formatDateTime(route.sourceCapturedAt)}</span>
                  <a href={route.sourceUrl} target="_blank" rel="noreferrer" className="v2-focus-ring inline-flex min-h-8 items-center gap-1 rounded-md px-1 text-[10px] font-semibold text-[#176443] hover:text-[#315740]">
                    Evidence <ExternalLink className="size-3" aria-hidden="true" />
                  </a>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="mt-4 rounded-xl border border-[#eadfbd] bg-[#fff8e8] p-4">
          <p className="text-sm font-semibold text-[#76591f]">No usable route is currently recorded</p>
          <p className="mt-1 text-xs leading-5 text-[#76591f]">Keep this business in research. Do not infer an email or contact channel.</p>
        </div>
      )}
      {data.ignoredRouteRows > 0 ? (
        <p role="status" className="mt-3 text-[10px] leading-4 text-[#76591f]">{data.ignoredRouteRows} malformed route {data.ignoredRouteRows === 1 ? "record was" : "records were"} omitted.</p>
      ) : null}
    </section>
  );
}

function ContactReviewSection({ data }: { data: OwnerLeadDetailResponse }) {
  const review = data.contactReview;
  if (review.state === "NOT_RECORDED") {
    return (
      <section aria-labelledby="contact-review" className="rounded-2xl border border-[#eadfbd] bg-[#fff8e8] p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <div className="grid size-9 shrink-0 place-items-center rounded-xl border border-[#eadfbd] bg-[#fff8e8]">
            <ClipboardCheck className="size-4 text-[#76591f]" aria-hidden="true" />
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#76591f]">Owner checkpoint</p>
            <h2 id="contact-review" className="mt-1 text-lg font-semibold text-[#1a3124]">Contact review not recorded</h2>
            <p className="mt-1 max-w-3xl text-xs leading-5 text-[#76591f]">
              These routes can be inspected, but the Revenue Engine cannot claim Riley or Aidan reviewed this exact contact packet. Keep it in research until a signed local review receipt exists.
            </p>
          </div>
        </div>
        <p className="mt-4 rounded-xl border border-[#e4ebe2] bg-[#f8faf6] p-3 text-[11px] leading-5 text-[#617367]">
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
      stale ? "border-[#eadfbd] bg-[#fff8e8]" : "border-[#d5e5d2] bg-[#f4f8f2]",
    )}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <div className={cn(
            "grid size-9 shrink-0 place-items-center rounded-xl border",
            stale ? "border-[#eadfbd] bg-[#fff8e8]" : "border-[#d5e5d2] bg-[#eff6ed]",
          )}>
            <ClipboardCheck className={cn("size-4", stale ? "text-[#76591f]" : "text-[#315740]")} aria-hidden="true" />
          </div>
          <div>
            <p className={cn("text-[10px] font-semibold uppercase tracking-[0.16em]", stale ? "text-[#76591f]" : "text-[#176443]")}>Owner checkpoint</p>
            <h2 id="contact-review" className="mt-1 text-lg font-semibold text-[#1a3124]">Reviewed contact evidence</h2>
            <p className="mt-1 max-w-3xl text-xs leading-5 text-[#617367]">
              {reviewer} reviewed this exact evidence packet on {formatDateTime(review.reviewedAt)} and approved storing its contact records locally.
            </p>
          </div>
        </div>
        <span className={cn(
          "w-fit rounded-full border px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.13em]",
          stale
            ? "border-[#eadfbd] bg-[#fff8e8] text-[#76591f]"
            : "border-[#c8ddc7] bg-[#eff6ed] text-[#315740]",
        )}>
          {stale ? "Older than current assessment" : "Matches current assessment"}
        </span>
      </div>

      {stale ? (
        <p role="status" className="mt-4 rounded-xl border border-[#eadfbd] bg-[#f8faf6] p-3 text-[11px] leading-5 text-[#76591f]">
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
          <div key={label} className="rounded-xl border border-[#e4ebe2] bg-[#f8faf6] p-3">
            <dt className="text-[9px] font-semibold uppercase tracking-[0.13em] text-[#566a5d]">{label}</dt>
            <dd className="mt-2 text-sm font-semibold text-[#35493b]">{value}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(260px,0.6fr)]">
        <div className="rounded-xl border border-[#e4ebe2] bg-[#f8faf6] p-3">
          <p className="text-[9px] font-semibold uppercase tracking-[0.13em] text-[#566a5d]">Why it was approved for local storage</p>
          <p className="mt-2 text-xs leading-5 text-[#425b4d]">{review.rationale}</p>
        </div>
        <div className="rounded-xl border border-[#e4ebe2] bg-[#f8faf6] p-3">
          <p className="text-[9px] font-semibold uppercase tracking-[0.13em] text-[#566a5d]">Route outcome</p>
          <p className="mt-2 text-xs leading-5 text-[#425b4d]">{routeBreakdown}</p>
        </div>
      </div>

      <p className="mt-3 rounded-xl border border-[#e8c8c2] bg-[#fff3f1] p-3 text-[11px] leading-5 text-[#8d2929]">
        Consent is still unassessed. This review authorized local contact storage only—not qualification, outreach, sending, provider use, or spend.
      </p>
    </section>
  );
}

function HistorySection({ data }: { data: OwnerLeadDetailResponse }) {
  return (
    <section aria-labelledby="lead-history" className="rounded-2xl border border-[#e1e9df] bg-white p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <div className="grid size-9 shrink-0 place-items-center rounded-xl border border-[#e1e9df] bg-[#f1f5ef]">
          <History className="size-4 text-[#425b4d]" aria-hidden="true" />
        </div>
        <div>
          <h2 id="lead-history" className="text-lg font-semibold text-[#1a3124]">Evidence and decision history</h2>
          <p className="mt-1 text-xs leading-5 text-[#617367]">Only events present in the v2 shadow model are shown. Missing sales history is labelled instead of guessed.</p>
        </div>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(280px,0.8fr)]">
        <div>
          {data.history.events.length > 0 ? (
            <ol className="space-y-2">
              {data.history.events.map((event) => {
                const Icon = HISTORY_ICONS[event.eventType];
                return (
                  <li key={`${event.eventType}:${event.eventId}`} className="grid grid-cols-[34px_minmax(0,1fr)] gap-3 rounded-xl border border-[#e4ebe2] bg-[#f8faf6] p-3">
                    <div className="grid size-8 place-items-center rounded-lg border border-[#e1e9df] bg-[#f1f5ef]">
                      <Icon className="size-3.5 text-[#53675a]" aria-hidden="true" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-xs font-semibold text-[#35493b]">{event.title}</p>
                        <time dateTime={event.occurredAt} className="font-mono text-[9px] text-[#566a5d]">{formatDateTime(event.occurredAt)}</time>
                      </div>
                      <p className="mt-1 text-[11px] leading-5 text-[#617367]">{event.description}</p>
                      {event.sourceUrl ? (
                        <a href={event.sourceUrl} target="_blank" rel="noreferrer" className="v2-focus-ring mt-1 inline-flex min-h-8 items-center gap-1 rounded-md text-[10px] font-semibold text-[#176443] hover:text-[#315740]">
                          Event evidence <ExternalLink className="size-3" aria-hidden="true" />
                        </a>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ol>
          ) : <p className="rounded-xl border border-[#e4ebe2] bg-[#f8faf6] p-4 text-xs text-[#617367]">No v2 evidence events are recorded yet.</p>}
          {data.history.truncated ? <p role="status" className="mt-3 text-[10px] text-[#76591f]">Only the newest 100 v2 events are shown.</p> : null}
        </div>

        <aside aria-labelledby="history-not-available" className="rounded-xl border border-dashed border-[#d8e2d5] bg-[#fbfcfa] p-4">
          <div className="flex items-center gap-2">
            <Clock3 className="size-4 text-[#617367]" aria-hidden="true" />
            <h3 id="history-not-available" className="text-xs font-semibold text-[#35493b]">Not available yet</h3>
          </div>
          <ul className="mt-3 space-y-3">
            {data.history.unavailable.map((item) => (
              <li key={item.area} className="rounded-lg border border-[#e8eee6] bg-[#f8faf6] p-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.13em] text-[#617367]">{readableCode(item.area)}</p>
                <p className="mt-1 text-[11px] leading-5 text-[#566a5d]">{item.reason}</p>
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
      <section role="alert" className="rounded-[28px] bg-[#f6f8f3] px-5 py-10 text-center text-[#263a2f] shadow-sm sm:px-8">
        <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-amber-100 text-amber-800"><AlertTriangle className="size-6" aria-hidden="true" /></span>
        <p className="mt-5 text-xs font-semibold uppercase tracking-[0.14em] text-[#76591f]">Could not verify</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-[#24382d]">Business details unavailable</h1>
        <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-[#566a5d]">The business, audit, routes, or history could not be read as one consistent dossier. No fallback data is shown. This page did not start outreach; a read failure does not stop live automation.</p>
        <Link href="/leads" className="mt-5 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#176443] px-5 text-sm font-semibold text-white hover:bg-[#125638] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#176443]">
          <ArrowLeft className="size-4" aria-hidden="true" /> Back to Leads
        </Link>
      </section>
    </div>
  );
}

export function OwnerLeadDetailNotFound() {
  return (
    <div className="mx-auto max-w-[900px] rounded-[28px] bg-[#f6f8f3] p-6 text-[#263a2f] shadow-sm sm:p-8">
      <span className="grid size-11 place-items-center rounded-2xl bg-[#edf4eb] text-[#176443]"><FileSearch className="size-5" aria-hidden="true" /></span>
      <h1 className="mt-5 text-2xl font-semibold tracking-tight text-[#24382d]">Business details not found</h1>
      <p className="mt-3 max-w-xl text-sm leading-6 text-[#566a5d]">This identity does not have a current audited dossier. Legacy or incomplete data is not promoted into the owner queue.</p>
      <Link href="/leads" className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-xl border border-[#d8e2d5] bg-white px-4 text-sm font-semibold text-[#315740] hover:bg-[#f0f5ee] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#176443]">
        <ArrowLeft className="size-4" aria-hidden="true" /> Return to businesses
      </Link>
    </div>
  );
}
