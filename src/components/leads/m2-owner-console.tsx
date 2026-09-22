import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  CircleDashed,
  FileSearch,
  LockKeyhole,
  ShieldCheck,
  SquareArrowOutUpRight,
  TriangleAlert,
} from "lucide-react";

import { PageHeader } from "@/components/ui/page-header";
import type { LocalM2OwnerConsoleResult } from "@/lib/revenue-engine/m2-local-owner-console";

const STATUS_COPY = {
  COMPLETE: { label: "Assessment saved", tone: "border-emerald-400/25 bg-emerald-400/10 text-emerald-200", icon: CheckCircle2 },
  RESEARCH_REVIEW: { label: "Research review", tone: "border-violet-400/25 bg-violet-400/10 text-violet-200", icon: FileSearch },
  BLOCKED: { label: "Blocked", tone: "border-rose-400/25 bg-rose-400/10 text-rose-100", icon: LockKeyhole },
  PENDING: { label: "Pending", tone: "border-amber-300/20 bg-amber-300/[0.07] text-amber-100", icon: CircleDashed },
  UNAVAILABLE: { label: "Unavailable", tone: "border-rose-300/20 bg-rose-300/[0.07] text-rose-100", icon: TriangleAlert },
} as const;

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-CA", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Toronto",
  }).format(new Date(value));
}

function shortDigest(value: string) {
  return `${value.slice(0, 12)}…${value.slice(-8)}`;
}

function shortId(value: string) {
  return value.length > 28 ? `${value.slice(0, 16)}…${value.slice(-8)}` : value;
}

function explainReason(reason: string | null) {
  switch (reason) {
    case "ROBOTS_OR_TERMS_BLOCKED":
      return { title: "Site policy stopped this review.", detail: "Robots or terms did not permit the bounded capture; no page was stored." };
    case "RETENTION_BLOCKED":
      return { title: "Retention policy stopped this review.", detail: "The selected retention mode did not allow evidence storage." };
    case "SUBPAGE_CAPTURE_FAILED":
      return { title: "A required page could not be captured.", detail: "The saved result is incomplete and is not shown as an assessment." };
    case "STORE_CONFLICT":
      return { title: "Evidence storage did not complete safely.", detail: "No replacement data was written." };
    case "More website research is required. No assessment was approved.":
      return { title: "More website research is required.", detail: "The saved evidence is research-only; no assessment rows were approved." };
    case "No verifiable saved capture is available. Capture or failure evidence needs review.":
      return { title: "No verifiable saved capture is available.", detail: "The local runner did not publish a fallback result." };
    case "This business has not completed the ordered local assessment workflow.":
      return { title: "The ordered local workflow is still pending.", detail: "No assessment or terminal evidence has been published." };
    default:
      return reason ? { title: reason, detail: "The local runner did not publish an actionable result." } : null;
  }
}

function pageOutcome(page: { statusCode: number; outcome?: string }) {
  return "outcome" in page ? page.outcome : String(page.statusCode);
}

function pageFailure(page: unknown) {
  if (typeof page !== "object" || page === null || !("failureCode" in page)) return null;
  const failureCode = (page as { failureCode?: unknown }).failureCode;
  return typeof failureCode === "string" ? failureCode : null;
}

function retentionLabel(entry: LocalM2OwnerConsoleEntry, pages: Array<{ storageOutcome: string }>) {
  if (entry.detail) return entry.detail.htmlEvidence.retentionDisposition;
  const dispositions = [...new Set(pages.map((page) => page.storageOutcome))];
  return dispositions.length > 0 ? dispositions.join(", ") : "No page retention recorded";
}

function EvidenceCode({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-400">{label}</dt>
      <dd className="mt-1 break-all font-mono text-xs text-zinc-400" title={value}>{shortDigest(value)}</dd>
    </div>
  );
}

function StatusPill({ status }: { status: keyof typeof STATUS_COPY }) {
  const copy = STATUS_COPY[status];
  const Icon = copy.icon;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-xs font-semibold ${copy.tone}`}>
      <Icon className="size-3" aria-hidden="true" />
      {copy.label}
    </span>
  );
}

export function M2OwnerConsole({ result }: { result: LocalM2OwnerConsoleResult }) {
  if (result.status === "UNAVAILABLE") return <UnavailableState reason={result.reason} />;

  const complete = result.entries.filter((entry) => entry.status === "COMPLETE").length;
  const research = result.entries.filter((entry) => entry.status === "RESEARCH_REVIEW").length;
  const blocked = result.entries.filter((entry) => entry.status === "BLOCKED").length;

  return (
    <div className="mx-auto flex max-w-[1500px] flex-col gap-5">
      <PageHeader
        eyebrow="M2 evidence review"
        title="Local research console"
        description="A read-only view of the latest locally verified M2 run. This is saved local review data, not live production activation."
        icon={ShieldCheck}
        status={<span className="inline-flex items-center gap-1.5 rounded-full border border-sky-300/20 bg-sky-300/[0.07] px-2 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-sky-100">Verified local</span>}
        metrics={[
          { label: "Manifest", value: result.manifestSize, detail: `${result.selectedCount} selected`, tone: "info" },
          { label: "Assessments saved", value: complete, detail: "durable local rows", tone: "positive" },
          { label: "Research / blocked", value: `${research} / ${blocked}`, detail: "no outreach authority", tone: "warning" },
        ]}
      />

      <section className="rounded-2xl border border-sky-300/15 bg-sky-300/[0.035] px-4 py-4 text-xs leading-5 text-sky-100/80 sm:px-5" aria-label="Local verification notice">
        <div className="flex gap-3">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-sky-300" aria-hidden="true" />
          <p>Verified at <time dateTime={result.verifiedAt}>{formatDate(result.verifiedAt)}</time>. The runner verified durable local evidence and replay boundaries for this manifest. No provider, contact, qualification, outreach, send, deployment, or spend authority is present.</p>
        </div>
        <p className="mt-2 break-all font-mono text-xs text-sky-100/80" title={result.manifestId}>Manifest: {shortId(result.manifestId)}</p>
      </section>

      <section className="overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0e1014]" aria-labelledby="m2-review-queue">
        <div className="border-b border-white/[0.07] px-4 py-4 sm:px-5">
          <h2 id="m2-review-queue" className="text-sm font-semibold text-zinc-100">Business review queue</h2>
          <p className="mt-1 text-xs leading-5 text-zinc-400">Every entry is tied to the verified local run. Unknown classification and zero scores are deliberate HTML-only limits.</p>
        </div>
        <ol className="divide-y divide-white/[0.07]" aria-label="M2 businesses">
          {result.entries.map((entry) => <M2Entry key={entry.businessId} entry={entry} />)}
        </ol>
      </section>
    </div>
  );
}

type LocalM2OwnerConsoleEntry = Extract<LocalM2OwnerConsoleResult, { status: "VERIFIED_LOCAL" }>["entries"][number];

function nextReview(entry: LocalM2OwnerConsoleEntry) {
  if (entry.status === "COMPLETE") return "Review the captured pages and unresolved visual/mobile evidence before judging website fit.";
  if (entry.status === "RESEARCH_REVIEW") return "Review the missing or failed pages and decide whether a new bounded capture is warranted.";
  if (entry.status === "BLOCKED") return entry.reason === "RETENTION_BLOCKED"
    ? "Resolve the permitted evidence retention mode before requesting another capture."
    : "Review the recorded site policy before proposing further research.";
  if (entry.status === "PENDING") return "Finish earlier entries in order, then review this business's pending assessment.";
  return "Check the saved capture and its failure evidence before retrying review.";
}

function M2Entry({ entry }: { entry: LocalM2OwnerConsoleEntry }) {
  const status = STATUS_COPY[entry.status];
  const Icon = status.icon;
  const detail = entry.detail;
  const research = entry.research;
  const pages = detail?.htmlEvidence.pages ?? research?.pages ?? [];
  const pagesWithRetention = pages as Array<{ storageOutcome: string }>;
  const sourceUrl = detail?.htmlEvidence.sourceUrl ?? research?.sourceIdentity.approvedWebsiteUrl ?? entry.sourceUrl;
  const reason = explainReason(entry.reason);

  return (
    <li className="px-4 py-5 sm:px-5 sm:py-6">
      <article aria-labelledby={`m2-${entry.businessId}`}>
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 id={`m2-${entry.businessId}`} className="text-lg font-semibold tracking-[-0.025em] text-white">{entry.businessName}</h3>
              <StatusPill status={entry.status} />
            </div>
            <p className="mt-1 break-all font-mono text-xs text-zinc-400" title={entry.businessId}>{shortId(entry.businessId)}</p>
          </div>
          {sourceUrl ? <a href={sourceUrl} target="_blank" rel="noreferrer" className="v2-focus-ring inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-white/[0.1] px-3 text-xs font-semibold text-zinc-300 hover:border-white/[0.2] hover:text-white">Source <SquareArrowOutUpRight className="size-3.5" aria-hidden="true" /></a> : null}
        </header>

        <p className="mt-3 text-sm leading-6 text-zinc-300"><strong className="font-semibold text-zinc-100">Next step:</strong> {nextReview(entry)}</p>

        {reason ? <div className="mt-4 rounded-xl border border-amber-300/15 bg-amber-300/[0.04] px-3 py-2.5 text-xs leading-5 text-amber-100/90"><AlertTriangle className="mr-2 inline size-3.5 text-amber-300" aria-hidden="true" /><strong className="font-semibold">{reason.title}</strong><span className="ml-1">{reason.detail}</span></div> : null}

        {detail || research ? (
          <div className="mt-5 grid gap-3 lg:grid-cols-[minmax(0,1.2fr)_minmax(260px,0.8fr)]">
            <div className="rounded-xl border border-white/[0.07] bg-white/[0.018] p-4">
              <div className="flex items-center gap-2"><Icon className="size-4 text-emerald-300" aria-hidden="true" /><p className="text-xs font-semibold text-zinc-200">HTML-only evidence</p></div>
              <p className="mt-2 text-xs leading-5 text-zinc-400">Classification remains <strong className="font-semibold text-zinc-200">UNKNOWN</strong>; qualification scores remain zero and no contact route is recorded.</p>
              <ul className="mt-4 grid gap-2 sm:grid-cols-2" aria-label={`${entry.businessName} captured pages`}>
                {pages.map((page) => <li key={`${page.pageKind}-${page.requestedUrl}`} className="rounded-lg border border-white/[0.06] bg-black/20 px-3 py-2.5"><div className="flex items-center justify-between gap-2"><span className="text-xs font-semibold uppercase tracking-[0.12em] text-zinc-300">{page.pageKind}</span><span className="text-xs text-zinc-400">{pageOutcome(page)}</span></div><p className="mt-1 truncate text-xs text-zinc-400" title={page.finalUrl ?? page.requestedUrl}>{page.finalUrl ?? page.requestedUrl}</p>{pageFailure(page) ? <p className="mt-1 text-xs text-amber-200">{pageFailure(page)}</p> : null}{page.capturedAt ? <time className="mt-1 block text-xs text-zinc-400" dateTime={page.capturedAt}>{formatDate(page.capturedAt)}</time> : null}</li>)}
              </ul>
            </div>
            <div className="rounded-xl border border-white/[0.07] bg-black/20 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-400">Evidence identity</p>
              <dl className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
                {detail ? <><EvidenceCode label="Operation" value={detail.htmlEvidence.operationDigest} /><EvidenceCode label="Lineage" value={detail.htmlEvidence.lineageDigest} /><EvidenceCode label="Assessment" value={detail.htmlEvidence.assessmentDigest} /></> : null}
                {research ? <><EvidenceCode label="Operation" value={research.operation.operationDigest} /><EvidenceCode label="Report" value={research.reportDigest} /><EvidenceCode label="Context" value={research.contextDigest} /></> : null}
              </dl>
              <details className="mt-4 rounded-lg border border-white/[0.06] px-3 py-2"><summary className="flex cursor-pointer list-none items-center justify-between text-xs font-semibold text-zinc-300"><span>Limitations and retention</span><ChevronDown className="size-3.5" aria-hidden="true" /></summary><div className="mt-3 space-y-2 text-xs leading-5 text-zinc-400"><p>Retention: {retentionLabel(entry, pagesWithRetention)}.</p><ul className="list-disc space-y-1 pl-4">{(detail?.htmlEvidence.unknownLimitations ?? research?.auditLimitations ?? []).map((limitation) => <li key={limitation}>{limitation}</li>)}</ul></div></details>
            </div>
          </div>
        ) : <p className="mt-4 text-xs text-zinc-400">No durable evidence detail is available for this state.</p>}
      </article>
    </li>
  );
}

function UnavailableState({ reason }: { reason: string }) {
  return <div className="mx-auto max-w-[1100px] space-y-5"><PageHeader eyebrow="M2 evidence review" title="Local research console" description="The local M2 evidence could not be safely verified, so no business data is shown." icon={AlertTriangle} status={<StatusPill status="UNAVAILABLE" />} /><section role="alert" className="rounded-2xl border border-rose-300/15 bg-[#0e1014] px-5 py-10 text-center"><AlertTriangle className="mx-auto size-7 text-rose-300" aria-hidden="true" /><h2 className="mt-4 text-lg font-semibold text-white">Review unavailable</h2><p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-zinc-400">{reason}</p><p className="mt-5 text-xs text-zinc-400">No fallback upload, fixture, or unverified runtime data is displayed.</p></section></div>;
}
