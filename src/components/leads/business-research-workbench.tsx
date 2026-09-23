"use client";

import { useMemo, useRef, useState, type RefObject } from "react";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ExternalLink,
  FileText,
  LockKeyhole,
  Search,
  ShieldCheck,
} from "lucide-react";

import type { LocalM2OwnerConsoleResult } from "@/lib/revenue-engine/m2-local-owner-console";
import type { PrivateKwHtmlStructure } from "@/lib/revenue-engine/private-kw-html-structure";

type Verified = Extract<LocalM2OwnerConsoleResult, { status: "VERIFIED_LOCAL" }>;
type Entry = Verified["entries"][number];
type EntryStatus = Entry["status"];
type ReviewFilter = "ALL" | "COMPLETE" | "RESEARCH_REVIEW" | "BLOCKED";

const statusStyle: Record<EntryStatus, { label: string; className: string; dot: string }> = {
  COMPLETE: { label: "Website captured", className: "bg-emerald-50 text-emerald-800 ring-emerald-200", dot: "bg-emerald-500" },
  RESEARCH_REVIEW: { label: "More research needed", className: "bg-amber-50 text-amber-800 ring-amber-200", dot: "bg-amber-500" },
  BLOCKED: { label: "Review stopped", className: "bg-rose-50 text-rose-800 ring-rose-200", dot: "bg-rose-500" },
  PENDING: { label: "Not started", className: "bg-slate-100 text-slate-700 ring-slate-200", dot: "bg-slate-400" },
  UNAVAILABLE: { label: "Evidence unavailable", className: "bg-slate-100 text-slate-700 ring-slate-200", dot: "bg-slate-400" },
};

const filterOptions: Array<{ id: ReviewFilter; label: string }> = [
  { id: "ALL", label: "All" },
  { id: "COMPLETE", label: "Captured" },
  { id: "RESEARCH_REVIEW", label: "Needs research" },
  { id: "BLOCKED", label: "Stopped" },
];

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-CA", {
    dateStyle: "medium", timeStyle: "short", timeZone: "America/Toronto",
  }).format(new Date(value));
}

function websiteHost(value: string) {
  try { return new URL(value).hostname.replace(/^www\./, ""); }
  catch { return "Website"; }
}

function pageName(kind: string) {
  return ({ HOME: "Home", SERVICE: "Services", ABOUT: "About", CONTACT: "Contact" } as Record<string, string>)[kind] ?? "Page";
}

function stopExplanation(reason: string | null) {
  if (reason === "ROBOTS_OR_TERMS_BLOCKED") return "Site rules stopped this check. Review access before trying again.";
  if (reason === "RETENTION_BLOCKED") return "The permitted way to keep evidence needs review before another check.";
  if (reason === "SUBPAGE_CAPTURE_FAILED") return "A page did not load, so this website review is incomplete.";
  if (reason === "STORE_CONFLICT") return "The saved research could not be verified. Check the local record before retrying.";
  return "This check stopped before a usable website review was saved.";
}

function nextStep(entry: Entry) {
  if (entry.status === "COMPLETE") return "Open the website and decide whether its design, mobile experience, and customer journey deserve a closer look.";
  if (entry.status === "RESEARCH_REVIEW") return "Review the missing or failed pages before deciding whether to check this website again.";
  if (entry.status === "BLOCKED") return stopExplanation(entry.reason);
  if (entry.status === "PENDING") return "Finish the earlier businesses in this review before starting this one.";
  return "Check the saved research before making a decision about this business.";
}

function StatusBadge({ status }: { status: EntryStatus }) {
  const style = statusStyle[status];
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ring-inset ${style.className}`}>
    <span className={`size-1.5 rounded-full ${style.dot}`} aria-hidden="true" />{style.label}
  </span>;
}

function MarkerDetails({ structure }: { structure: PrivateKwHtmlStructure }) {
  const actions = structure.actionKinds.map((kind) => kind.toLocaleLowerCase("en-CA")).join(", ") || "none detected";
  const trust = structure.trustSignals.map((kind) => kind.toLocaleLowerCase("en-CA").replaceAll("_", " ")).join(", ") || "none detected";
  const links = Object.entries(structure.internalLinkKindCounts)
    .filter(([, count]) => count > 0)
    .map(([kind, count]) => `${count} ${kind.toLocaleLowerCase("en-CA")}`).join(" · ") || "none detected";
  const clues = [
    structure.hasTitle ? "Page title" : null,
    structure.actionKinds.length > 0 ? "Contact options" : null,
    structure.formCount > 0 ? "Form" : null,
    structure.trustSignals.length > 0 ? "Trust clues" : null,
  ].filter(Boolean).slice(0, 3).join(" · ") || "No common clues found";
  return <details className="group mt-3 rounded-xl bg-[#f5f8f5] text-xs leading-5 text-[#53645b]">
    <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between gap-2 px-3.5 py-2 font-medium text-[#284c3b] focus-visible:rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#196b50]">
      <span>Page clues: {clues}</span><ChevronDown className="size-3.5 shrink-0 transition-transform group-open:rotate-180" aria-hidden="true" />
    </summary>
    <div className="border-t border-[#e6ede5] px-3.5 pb-3 pt-2">
      <p className="mb-1">These are clues in the page code. How they look or work for visitors was not checked.</p>
      <p>Page title: {structure.hasTitle ? "found" : "not found"} · Search description: {structure.hasMetaDescription ? "found" : "not found"}</p>
      <p>Contact options mentioned: {actions}</p>
      <p>Forms found: {structure.formCount} · Forms with a submit button: {structure.formsWithEnabledSubmitCount}</p>
      <p>Trust clues mentioned: {trust}</p>
      <p>Links to other pages: {links}</p>
    </div>
  </details>;
}

function EvidenceRecord({ entry, verifiedAt }: { entry: Entry; verifiedAt: string }) {
  const detail = entry.detail;
  const research = entry.research;
  const evidence = detail?.htmlEvidence;
  const retention = evidence?.retentionDisposition ?? research?.pages.find((page) => page.storageOutcome === "DERIVED_FACTS_ONLY" || page.storageOutcome === "RAW_HTML_ALLOWED")?.storageOutcome;
  const limitations = evidence?.unknownLimitations ?? research?.auditLimitations ?? [];
  return <details className="group mt-6 rounded-2xl border border-[#e1e8e1] bg-white">
    <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-semibold text-[#294439] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#196b50]">
      <span className="inline-flex items-center gap-2"><ShieldCheck className="size-4" aria-hidden="true" />Evidence record</span>
      <ChevronDown className="size-4 transition-transform group-open:rotate-180" aria-hidden="true" />
    </summary>
    <div className="space-y-3 border-t border-[#edf0eb] px-4 py-4 text-xs leading-5 text-[#63726a]">
      <p><strong className="text-[#283e33]">Checked locally:</strong> {formatDate(verifiedAt)}</p>
      {retention ? <p><strong className="text-[#283e33]">Evidence kept:</strong> {retention === "DERIVED_FACTS_ONLY" ? "Small summary only; page HTML was not saved" : "Page HTML under a separate retention review"}</p> : null}
      <p><strong className="text-[#283e33]">Original source:</strong> <a href={entry.sourceUrl} target="_blank" rel="noopener noreferrer" className="break-all text-[#145c46] underline underline-offset-2">{entry.sourceUrl}</a></p>
      {limitations.length > 0 ? <p><strong className="text-[#283e33]">Known limits:</strong> visual design, mobile usability, website fit, and contact readiness have not been established.</p> : null}
      <details className="rounded-xl bg-[#f7f9f6] p-3">
        <summary className="cursor-pointer font-medium text-[#425b4d]">Technical identifiers</summary>
        <div className="mt-2 space-y-1 break-all font-mono text-[11px] text-[#6b7a70]">
          {evidence ? <><p>Operation: {evidence.operationDigest}</p><p>Assessment: {evidence.assessmentDigest}</p><p>Manifest: {evidence.manifestDigest}</p></> : null}
          {research ? <><p>Operation: {research.operation.operationDigest}</p><p>Report: {research.reportDigest}</p></> : null}
          {!evidence && !research ? <p>No completed evidence record is available.</p> : null}
        </div>
      </details>
    </div>
  </details>;
}

function BusinessDetail({ entry, verifiedAt, onBack, headingRef }: {
  entry: Entry; verifiedAt: string; onBack: () => void; headingRef: RefObject<HTMLHeadingElement | null>;
}) {
  const detail = entry.detail;
  const research = entry.research;
  const pages = detail?.htmlEvidence.pages ?? research?.pages ?? [];
  const capturedPages = pages.filter((page) => !("outcome" in page) || page.outcome === "CAPTURED").length;
  const websiteUrl = detail?.htmlEvidence.approvedWebsiteUrl ?? research?.sourceIdentity.approvedWebsiteUrl ?? null;
  const status = statusStyle[entry.status];
  return <section className="min-w-0 rounded-2xl border border-[#e2e8e1] bg-white shadow-[0_10px_28px_-26px_rgba(27,62,44,0.45)]" aria-label={`${entry.businessName} website review`}>
    <div className="border-b border-[#edf0eb] px-4 py-4 sm:px-6 sm:py-5">
      <button type="button" onClick={onBack} className="mb-4 inline-flex min-h-10 items-center gap-2 text-sm font-semibold text-[#145c46] focus-visible:rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145c46] md:hidden"><ArrowLeft className="size-4" aria-hidden="true" />Back to businesses</button>
      <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.13em] text-[#53645b]">Selected business</p>
          <h2 ref={headingRef} tabIndex={-1} className="mt-1 break-words text-2xl font-semibold tracking-[-0.035em] text-[#182c22] outline-none sm:text-[30px]">{entry.businessName}</h2>
          <p className="mt-1.5 break-all text-sm text-[#6b7970]">{websiteUrl ? websiteHost(websiteUrl) : "Website source not yet reviewed"}</p>
        </div>
        <StatusBadge status={entry.status} />
      </div>
      {websiteUrl ? <a href={websiteUrl} target="_blank" rel="noopener noreferrer" className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-lg bg-[#145c46] px-4 text-sm font-semibold text-white transition hover:bg-[#0e4936] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145c46]"><ExternalLink className="size-4" aria-hidden="true" />Open business website</a> : null}
    </div>

    <div className="space-y-5 px-4 py-4 sm:px-6 sm:py-5">
      <section className="rounded-xl border border-[#dce9dd] bg-[#f6faf6] p-4 sm:p-5" aria-labelledby="research-next-step">
        <p className="text-xs font-bold uppercase tracking-[0.12em] text-[#2e6b4f]">Next step</p>
        <h3 id="research-next-step" className="mt-1 text-base font-semibold text-[#233a2b]">{entry.status === "COMPLETE" ? "Review the live website" : status.label}</h3>
        <p className="mt-1.5 max-w-2xl text-sm leading-6 text-[#52645b]">{nextStep(entry)}</p>
      </section>

      {entry.status === "BLOCKED" ? <div className="mt-5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900"><LockKeyhole className="mr-2 inline size-4 align-[-2px]" aria-hidden="true" />No further website capture was approved for this stopped check.</div> : null}
      {entry.status === "RESEARCH_REVIEW" ? <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">This research is incomplete. It is not a website-fit assessment.</div> : null}

      <section aria-labelledby="research-checks-heading">
        <div className="flex items-center gap-2">
          <h3 id="research-checks-heading" className="text-sm font-semibold text-[#243a2b]">What has been checked</h3>
          <span className="text-xs text-[#718076]">Saved website research only</span>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
          <div className="rounded-xl border border-[#e5e9e3] bg-white p-3"><p className="text-xs font-medium text-[#53645b]">Website pages</p><p className="mt-1 text-sm font-semibold text-[#273b2e]">{capturedPages} captured{pages.length > capturedPages ? ` · ${pages.length - capturedPages} incomplete` : ""}</p></div>
          <div className="rounded-xl border border-[#e5e9e3] bg-white p-3"><p className="text-xs font-medium text-[#53645b]">Website fit</p><p className="mt-1 text-sm font-semibold text-[#273b2e]">Not assessed</p></div>
          <div className="rounded-xl border border-[#e5e9e3] bg-white p-3"><p className="text-xs font-medium text-[#53645b]">Mobile experience</p><p className="mt-1 text-sm font-semibold text-[#273b2e]">Not checked</p></div>
          <div className="rounded-xl border border-[#e5e9e3] bg-white p-3"><p className="text-xs font-medium text-[#53645b]">Contact readiness</p><p className="mt-1 text-sm font-semibold text-[#273b2e]">Not reviewed</p></div>
        </div>
        <details className="group mt-3 rounded-xl border border-[#e1e8e1] bg-white">
          <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-semibold text-[#294439] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#196b50]">
            <span>Pages checked and source links</span>
            <span className="flex shrink-0 items-center gap-2 text-xs font-medium text-[#687a6d]">{capturedPages} of {pages.length}<ChevronDown className="size-4 transition-transform group-open:rotate-180" aria-hidden="true" /></span>
          </summary>
          <div className="border-t border-[#edf0eb] p-3 sm:p-4">
            {pages.length > 0 ? <ul className="space-y-2" aria-label={`${entry.businessName} pages checked`}>
          {pages.map((page) => {
            const captured = !("outcome" in page) || page.outcome === "CAPTURED";
            const url = page.finalUrl ?? page.requestedUrl;
            return <li key={`${page.pageKind}-${page.requestedUrl}`} className="rounded-xl border border-[#e5ebe4] bg-[#fcfdfb] px-3 py-3 sm:px-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="flex min-w-0 items-center gap-3"><span className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${captured ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}><FileText className="size-4" aria-hidden="true" /></span><div className="min-w-0"><p className="text-sm font-semibold text-[#263b2c]">{pageName(page.pageKind)}</p><a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-9 max-w-full items-center break-all text-xs text-[#145c46] underline underline-offset-2 hover:text-[#0e4936]" title={url}>{websiteHost(url)} <ExternalLink className="ml-1 size-3 shrink-0" aria-hidden="true" /></a></div></div>
                <span className={`text-xs font-semibold ${captured ? "text-emerald-700" : "text-amber-700"}`}>{captured ? "Captured" : "Incomplete"}</span>
              </div>
              {page.structure ? <MarkerDetails structure={page.structure} /> : null}
            </li>;
            })}
          </ul> : <div className="rounded-xl border border-dashed border-[#dce4da] bg-[#fafbf8] px-4 py-7 text-center text-sm text-[#657669]">No verified page details are available yet.</div>}
            <p className="mt-3 text-xs leading-5 text-[#53645b]">A captured page confirms a response and, where shown, markup markers. It does not prove that the website works well for visitors.</p>
          </div>
        </details>
      </section>

      <p className="flex items-start gap-2 rounded-xl border border-[#e6e9e4] bg-[#f8faf7] px-3.5 py-3 text-xs leading-5 text-[#657669]"><LockKeyhole className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />No outreach is authorized from this review. No message or call can be sent here.</p>
      <EvidenceRecord entry={entry} verifiedAt={verifiedAt} />
      <p className="mt-3 text-right text-[11px] text-[#53645b]">{status.label} · private local review</p>
    </div>
  </section>;
}

export function BusinessResearchWorkbench({ result }: { result: LocalM2OwnerConsoleResult }) {
  if (result.status === "UNAVAILABLE") return <div className="mx-auto max-w-[1100px] px-4 py-5 text-[#1a3124] sm:px-6 sm:py-7"><p className="text-xs font-bold uppercase tracking-[0.15em] text-[#406849]">Axiom · Business research</p><h1 className="mt-2 text-3xl font-semibold tracking-tight">Business review</h1><div role="alert" className="mt-5 rounded-2xl border border-[#e5e9e3] bg-white p-5 sm:p-6"><h2 className="text-lg font-semibold">Saved research could not be verified</h2><p className="mt-2 text-sm text-[#5d6d62]">{result.reason}</p><p className="mt-2 text-sm text-[#5d6d62]">Ask the operator to check the local review setup before making a business decision.</p></div></div>;
  return <VerifiedWorkbench result={result} />;
}

function VerifiedWorkbench({ result }: { result: Verified }) {
  const [selectedId, setSelectedId] = useState(result.entries[0]?.businessId ?? "");
  const [filter, setFilter] = useState<ReviewFilter>("ALL");
  const [query, setQuery] = useState("");
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const listScroll = useRef(0);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const entries = useMemo(() => result.entries.filter((entry) =>
    (filter === "ALL" || entry.status === filter)
      && (query.trim() === "" || `${entry.businessName} ${entry.sourceUrl}`.toLocaleLowerCase("en-CA").includes(query.trim().toLocaleLowerCase("en-CA"))),
  ), [result.entries, filter, query]);
  const selected = entries.find((entry) => entry.businessId === selectedId) ?? entries[0] ?? null;
  const countFor = (value: ReviewFilter) => value === "ALL" ? result.entries.length : result.entries.filter((entry) => entry.status === value).length;
  const open = (entry: Entry) => {
    listScroll.current = window.scrollY;
    setSelectedId(entry.businessId);
    setMobileDetailOpen(true);
    window.scrollTo({ top: 0, behavior: "instant" });
    requestAnimationFrame(() => headingRef.current?.focus());
  };
  const back = () => {
    setMobileDetailOpen(false);
    requestAnimationFrame(() => window.scrollTo({ top: listScroll.current, behavior: "instant" }));
  };
  return <div className="mx-auto min-h-[calc(100svh-6rem)] max-w-[1580px] px-4 pb-[calc(9rem+env(safe-area-inset-bottom))] pt-4 text-[#1a3124] sm:px-6 sm:pt-6 md:pb-8 xl:px-8">
    <header className={`${mobileDetailOpen ? "sr-only md:not-sr-only" : ""} px-1 sm:px-0`}>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-medium text-[#64736a]"><span className="uppercase tracking-[0.12em]">Axiom · Private workspace</span><span className="inline-flex items-center gap-1.5"><Check className="size-3.5" aria-hidden="true" />Checked {formatDate(result.verifiedAt)}</span></div>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="text-[30px] font-semibold leading-tight tracking-[-0.04em] text-[#14291d] sm:text-[36px]">Business review</h1><p className="mt-1.5 max-w-2xl text-sm leading-5 text-[#607267]">Review the saved website research. Website fit is not decided here, and this page cannot contact anyone.</p></div>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6" aria-label="Business review status summary">
        {[
          { label: "Businesses", value: result.entries.length },
          { label: "Website captured", value: result.entries.filter((entry) => entry.status === "COMPLETE").length },
          { label: "Needs research", value: result.entries.filter((entry) => entry.status === "RESEARCH_REVIEW").length },
          { label: "Stopped", value: result.entries.filter((entry) => entry.status === "BLOCKED").length },
          { label: "Not started", value: result.entries.filter((entry) => entry.status === "PENDING").length },
          { label: "Unavailable", value: result.entries.filter((entry) => entry.status === "UNAVAILABLE").length },
        ].filter((item) => item.value > 0).map((item) => <div key={item.label} className="rounded-xl border border-[#e1e8e1] bg-white px-3 py-2.5"><dt className="text-[11px] leading-4 text-[#64736a]">{item.label}</dt><dd className="mt-0.5 text-lg font-semibold tabular-nums text-[#1e392a]">{item.value}</dd></div>)}
      </dl>
    </header>

    <div className={`${mobileDetailOpen ? "mt-0 md:mt-5" : "mt-4 md:mt-5"} grid items-start gap-3 md:grid-cols-[minmax(270px,0.36fr)_minmax(0,0.64fr)] xl:gap-4`}>
      <section className={`${mobileDetailOpen ? "hidden md:block" : "block"} overflow-hidden rounded-2xl border border-[#e2e8e1] bg-white`} aria-label="Business queue">
        <div className="border-b border-[#edf0eb] p-3.5 sm:p-4"><div className="flex items-baseline justify-between gap-2"><h2 className="text-base font-semibold tracking-tight text-[#243a2b]">Businesses</h2><span className="text-xs font-semibold text-[#53645b]">{result.entries.length} saved</span></div><label className="relative mt-2.5 block"><Search className="pointer-events-none absolute left-3 top-3 size-4 text-[#53645b]" aria-hidden="true" /><span className="sr-only">Find a business</span><input type="search" value={query} onChange={(event) => { setQuery(event.target.value); setMobileDetailOpen(false); }} placeholder="Find a business" className="h-11 w-full rounded-lg border border-[#e2e9df] bg-white pl-9 pr-3 text-sm text-[#243c2d] placeholder:text-[#53645b] focus:border-[#4d9970] focus:outline-none focus:ring-2 focus:ring-[#a7d5b8]" /></label><div role="group" className="mt-3 grid grid-cols-2 gap-1.5 sm:flex sm:flex-wrap" aria-label="Filter businesses">{filterOptions.map((option) => <button key={option.id} type="button" aria-pressed={filter === option.id} onClick={() => { setFilter(option.id); setMobileDetailOpen(false); }} className={`flex min-h-10 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#196b50] sm:justify-start sm:px-2.5 ${filter === option.id ? "bg-[#174e37] text-white" : "bg-[#f7f9f6] text-[#66786b] hover:bg-[#f1f5ef]"}`}>{option.label} <span className={filter === option.id ? "text-white/70" : "text-[#53645b]"}>{countFor(option.id)}</span></button>)}</div></div>
        <ol className="grid max-h-[68rem] grid-cols-1 gap-px overflow-y-auto bg-[#eef2ec]" aria-label="Businesses to review">
          {entries.map((entry) => { const active = selected?.businessId === entry.businessId; return <li key={entry.businessId} className="min-w-0 bg-white"><button type="button" aria-pressed={active} aria-label={`Open ${entry.businessName} review`} onClick={() => open(entry)} className={`flex min-h-[72px] w-full min-w-0 flex-col items-start justify-center px-3 py-2.5 text-left transition focus-visible:relative focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#196b50] sm:min-h-[72px] sm:px-4 ${active ? "bg-[#f3f6f2] md:shadow-[inset_3px_0_0_#1d7953]" : "hover:bg-[#fafbf9]"}`}><span className="block max-w-full truncate text-sm font-semibold text-[#23392b]">{entry.businessName}</span><span className="mt-0.5 block max-w-full truncate text-xs text-[#53645b]">{websiteHost(entry.detail?.htmlEvidence.approvedWebsiteUrl ?? entry.research?.sourceIdentity.approvedWebsiteUrl ?? entry.sourceUrl)}</span><span className={`mt-1 inline-flex items-center gap-1.5 text-[11px] font-semibold ${entry.status === "COMPLETE" ? "text-emerald-700" : entry.status === "BLOCKED" ? "text-rose-700" : entry.status === "RESEARCH_REVIEW" ? "text-amber-700" : "text-[#66776c]"}`}><span className={`size-1.5 rounded-full ${statusStyle[entry.status].dot}`} aria-hidden="true" />{statusStyle[entry.status].label}</span></button></li>; })}
        </ol>
        {entries.length === 0 ? <p className="px-5 py-10 text-center text-sm text-[#53645b]">No businesses match that search or filter.</p> : null}
      </section>
      <div className={`${mobileDetailOpen ? "block" : "hidden md:block"} min-w-0`}>{selected ? <BusinessDetail entry={selected} verifiedAt={result.verifiedAt} onBack={back} headingRef={headingRef} /> : <div className="rounded-2xl border border-[#e2e8e1] bg-white p-8 text-center text-sm text-[#53645b]">Select a business to review its saved website research.</div>}</div>
    </div>
  </div>;
}
