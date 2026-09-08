"use client";

import {
  ArrowLeft,
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  FileCheck2,
  FileUp,
  LockKeyhole,
  RotateCcw,
  Scale,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { Textarea } from "@/components/ui/textarea";
import {
  OWNER_LABELING_DRAFT_VERSION,
  OWNER_LABEL_OPTIONS,
  OWNER_REASON_OPTIONS,
  OwnerLabelingWorkspaceResponseSchema,
  buildOwnerLabelSubmission,
  isCompleteOwnerLabelingDecision,
  parseOwnerLabelingDraft,
  type OwnerLabelingDraftDecision,
  type OwnerLabelingWorkspaceResponse,
  type OwnerWorkspaceLabel,
  type OwnerWorkspaceReason,
} from "@/lib/revenue-engine/owner-labeling-workspace";
import { cn } from "@/lib/utils";

const MAX_PACKET_BYTES = 10_000_000;
const EMPTY_DECISION: OwnerLabelingDraftDecision = { label: null, reasons: [], notes: "" };

type DecisionMap = Record<string, OwnerLabelingDraftDecision>;

const SCORE_LABELS: Array<{
  key: keyof OwnerLabelingWorkspaceResponse["entries"][number]["engineAssessment"]["scores"];
  label: string;
}> = [
  { key: "businessFit", label: "Business fit" },
  { key: "rebuildNeed", label: "Rebuild need" },
  { key: "reachability", label: "Reachability" },
  { key: "timing", label: "Timing" },
  { key: "evidenceConfidence", label: "Evidence confidence" },
];

const LABEL_TONES: Record<OwnerWorkspaceLabel, string> = {
  STRONG: "border-emerald-300/30 bg-emerald-300/[0.08] text-emerald-100",
  WEAK: "border-amber-300/30 bg-amber-300/[0.08] text-amber-100",
  WRONG: "border-rose-300/30 bg-rose-300/[0.08] text-rose-100",
};

function readable(value: string) {
  return value.toLowerCase().replaceAll("_", " ").replace(/(^|\s)\S/g, (character) => character.toUpperCase());
}

function decisionStarted(decision: OwnerLabelingDraftDecision | undefined) {
  return Boolean(decision?.label || decision?.reasons.length || decision?.notes.trim());
}

function storageKey(packetDigest: string) {
  return `axiom-owner-labels:${packetDigest}`;
}

export function OwnerLeadEvaluationWorkspace() {
  const [clientReady, setClientReady] = React.useState(false);
  const [workspace, setWorkspace] = React.useState<OwnerLabelingWorkspaceResponse | null>(null);
  const [decisions, setDecisions] = React.useState<DecisionMap>({});
  const [reviewedBy, setReviewedBy] = React.useState<"RILEY" | "AIDAN">("RILEY");
  const [selectedLeadId, setSelectedLeadId] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [message, setMessage] = React.useState<{ tone: "error" | "success"; text: string } | null>(null);
  const fileInput = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    setClientReady(true);
  }, []);

  React.useEffect(() => {
    if (!workspace) return;
    try {
      localStorage.setItem(storageKey(workspace.packetDigest), JSON.stringify({
        draftVersion: OWNER_LABELING_DRAFT_VERSION,
        packetDigest: workspace.packetDigest,
        reviewedBy,
        decisions,
      }));
    } catch {
      // The export remains available even when browser storage is blocked.
    }
  }, [decisions, reviewedBy, workspace]);

  const unreviewed = workspace?.entries.filter((entry) => entry.ownerReview.label === "UNREVIEWED") ?? [];
  const completedDrafts = unreviewed.filter((entry) => isCompleteOwnerLabelingDecision(decisions[entry.leadId]));
  const incompleteDrafts = unreviewed.filter((entry) => {
    const decision = decisions[entry.leadId];
    return decisionStarted(decision) && !isCompleteOwnerLabelingDecision(decision);
  });
  const currentEntry = workspace?.entries.find((entry) => entry.leadId === selectedLeadId)
    ?? unreviewed[0]
    ?? workspace?.entries[0]
    ?? null;
  const currentDecision = currentEntry ? decisions[currentEntry.leadId] ?? EMPTY_DECISION : EMPTY_DECISION;
  const currentIndex = workspace && currentEntry ? workspace.entries.findIndex((entry) => entry.leadId === currentEntry.leadId) : -1;

  const updateCurrent = React.useCallback((next: OwnerLabelingDraftDecision) => {
    if (!currentEntry || currentEntry.ownerReview.label !== "UNREVIEWED") return;
    setDecisions((current) => ({ ...current, [currentEntry.leadId]: next }));
    setMessage(null);
  }, [currentEntry]);

  const chooseLabel = (label: OwnerWorkspaceLabel) => {
    updateCurrent({ label, reasons: [], notes: currentDecision.notes });
  };

  const toggleReason = (reason: OwnerWorkspaceReason) => {
    if (!currentDecision.label) return;
    const reasons = currentDecision.reasons.includes(reason)
      ? currentDecision.reasons.filter((candidate) => candidate !== reason)
      : [...currentDecision.reasons, reason].slice(0, 5);
    updateCurrent({ ...currentDecision, reasons });
  };

  const loadPacket = async (file: File) => {
    setMessage(null);
    if (!file.name.toLowerCase().endsWith(".json")) {
      setMessage({ tone: "error", text: "Choose the JSON checkpoint prepared by the Revenue Engine." });
      return;
    }
    if (file.size > MAX_PACKET_BYTES) {
      setMessage({ tone: "error", text: "That checkpoint is larger than the safe 10 MB review limit." });
      return;
    }
    setLoading(true);
    try {
      const parsed = JSON.parse(await file.text()) as unknown;
      const response = await fetch("/api/v1/leads/evaluation/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed),
      });
      const responseBody = await response.json() as unknown;
      if (!response.ok) {
        const error = responseBody && typeof responseBody === "object" && "error" in responseBody
          ? String(responseBody.error)
          : "The checkpoint could not be verified.";
        throw new Error(error);
      }
      const verified = OwnerLabelingWorkspaceResponseSchema.parse(responseBody);
      const leadIds = new Set(verified.entries.map((entry) => entry.leadId));
      let saved = null;
      try {
        const stored = localStorage.getItem(storageKey(verified.packetDigest));
        saved = stored ? parseOwnerLabelingDraft(JSON.parse(stored) as unknown, verified.packetDigest, leadIds) : null;
      } catch {
        saved = null;
      }
      setWorkspace(verified);
      setDecisions(saved?.decisions ?? {});
      setReviewedBy(saved?.reviewedBy ?? "RILEY");
      setSelectedLeadId(verified.entries.find((entry) => entry.ownerReview.label === "UNREVIEWED")?.leadId ?? verified.entries[0]?.leadId ?? null);
      setMessage({
        tone: "success",
        text: saved ? "Verified the exact checkpoint and restored this browser's draft." : "Verified the exact 50-business checkpoint. No outreach was enabled.",
      });
    } catch (error) {
      setWorkspace(null);
      setDecisions({});
      setSelectedLeadId(null);
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "The checkpoint could not be verified." });
    } finally {
      setLoading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const downloadSubmission = () => {
    if (!workspace) return;
    if (incompleteDrafts.length > 0) {
      setMessage({ tone: "error", text: `Finish the label and reason for ${incompleteDrafts.length} started review${incompleteDrafts.length === 1 ? "" : "s"} before exporting.` });
      return;
    }
    try {
      const submission = buildOwnerLabelSubmission({
        packetId: workspace.packetId,
        packetDigest: workspace.packetDigest,
        reviewedBy,
        reviewedAt: new Date().toISOString(),
        decisions,
      });
      const blob = new Blob([`${JSON.stringify(submission, null, 2)}\n`], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `owner-reviews-${workspace.packetDigest.slice(0, 12)}.json`;
      link.click();
      URL.revokeObjectURL(url);
      setMessage({ tone: "success", text: `Downloaded ${submission.decisions.length} completed review${submission.decisions.length === 1 ? "" : "s"}. Codex will record them into the next immutable checkpoint.` });
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "The review checkpoint could not be exported." });
    }
  };

  const move = (offset: -1 | 1) => {
    if (!workspace || currentIndex < 0) return;
    const next = Math.min(workspace.entries.length - 1, Math.max(0, currentIndex + offset));
    setSelectedLeadId(workspace.entries[next]!.leadId);
  };

  const resetPacket = () => {
    setWorkspace(null);
    setDecisions({});
    setSelectedLeadId(null);
    setMessage(null);
  };

  const totalReviewed = (workspace?.summary.reviewed ?? 0) + completedDrafts.length;
  const focusReviewSection = (event: React.MouseEvent<HTMLAnchorElement>, id: string) => {
    const section = document.getElementById(id);
    if (!section) return;
    event.preventDefault();
    section.focus({ preventScroll: true });
    section.scrollIntoView({ block: "start", behavior: "instant" });
  };

  return (
    <div
      className="owner-review-page mx-auto flex max-w-[1500px] flex-col gap-5"
      data-quality-lab-ready={clientReady ? "true" : "false"}
    >
      <PageHeader
        eyebrow="Lead quality calibration"
        title="Quality Lab"
        description="Teach the engine what Axiom considers a genuinely worthwhile business. Review the evidence, choose one plain-language verdict, and export an immutable checkpoint."
        icon={Scale}
        status={
          <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-300/20 bg-amber-300/[0.07] px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-amber-100">
            <ShieldCheck className="size-3" aria-hidden="true" />
            Review only · no outreach
          </span>
        }
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href="/leads"><ArrowLeft aria-hidden="true" />Back to Leads</Link>
          </Button>
        }
        metrics={workspace ? [
          { label: "Reviewed", value: `${totalReviewed}/50`, detail: "saved + draft", tone: "positive" },
          { label: "This export", value: completedDrafts.length, detail: "complete decisions", tone: "info" },
          { label: "Agreement", value: `${workspace.summary.agreementPercent}%`, detail: "recorded baseline", tone: "default" },
        ] : [
          { label: "Required set", value: "50", detail: "fixed businesses", tone: "info" },
          { label: "Current file", value: "None", detail: "load checkpoint", tone: "warning" },
          { label: "Outreach", value: "Off", detail: "always on this screen", tone: "positive" },
        ]}
      />

      <input
        ref={fileInput}
        type="file"
        accept="application/json,.json"
        disabled={!clientReady || loading}
        className="sr-only"
        aria-label="Choose owner-review checkpoint"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          if (file) void loadPacket(file);
        }}
      />

      {message ? (
        <p
          role={message.tone === "error" ? "alert" : "status"}
          className={cn(
            "rounded-xl border px-4 py-3 text-sm",
            message.tone === "error"
              ? "border-rose-300/20 bg-rose-300/[0.06] text-rose-100"
              : "border-emerald-300/20 bg-emerald-300/[0.06] text-emerald-100",
          )}
        >
          {message.text}
        </p>
      ) : null}

      {!workspace ? (
        <section className="grid min-h-[430px] place-items-center rounded-2xl border border-white/[0.08] bg-[#0e1014] px-5 py-12 text-center" aria-labelledby="quality-lab-start">
          <div className="max-w-xl">
            <div className="mx-auto grid size-14 place-items-center rounded-2xl border border-emerald-300/20 bg-emerald-300/[0.07]">
              <FileCheck2 className="size-6 text-emerald-300" aria-hidden="true" />
            </div>
            <h2 id="quality-lab-start" className="mt-5 text-xl font-semibold tracking-tight text-white">Load the exact 50-business review checkpoint</h2>
            <p className="mt-2 text-sm leading-6 text-zinc-400">
              Codex prepares this private file after every business has current website evidence and an exact assessment. The app verifies the complete file before showing a single decision.
            </p>
            <Button className="mt-6 min-h-11" disabled={!clientReady || loading} onClick={() => fileInput.current?.click()}>
              <FileUp aria-hidden="true" />{!clientReady ? "Starting Quality Lab…" : loading ? "Verifying checkpoint…" : "Choose checkpoint file"}
            </Button>
            <p className="mt-4 text-[11px] leading-5 text-zinc-600">
              Nothing is uploaded to a provider or written to the database. This screen cannot qualify, contact, or send to anyone.
            </p>
          </div>
        </section>
      ) : currentEntry ? (
        <div className="grid min-h-[640px] gap-4 xl:grid-cols-[310px_minmax(0,1fr)]">
          <aside className="self-start overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0e1014]" aria-label="Evaluation businesses">
            <details>
              <summary className="v2-focus-ring cursor-pointer rounded-xl p-4 text-sm font-semibold text-zinc-200">
                Browse 50 businesses · {totalReviewed} reviewed
              </summary>
            <div className="border-b border-white/[0.07] p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-white">Review queue</h2>
                  <p className="mt-1 text-xs text-zinc-500">Drafts save in this browser.</p>
                </div>
                <Button variant="ghost" size="icon-sm" onClick={resetPacket} aria-label="Close this checkpoint" title="Close checkpoint">
                  <RotateCcw aria-hidden="true" />
                </Button>
              </div>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/[0.07]" role="progressbar" aria-label="Owner review progress" aria-valuemin={0} aria-valuemax={50} aria-valuenow={totalReviewed}>
                <span className="block h-full rounded-full bg-emerald-400" style={{ width: `${totalReviewed * 2}%` }} />
              </div>
              <p className="mt-2 font-mono text-[10px] text-zinc-600">{totalReviewed} reviewed · {50 - totalReviewed} remaining</p>
            </div>
            <ol className="max-h-[600px] overflow-y-auto p-2" aria-label="Businesses in the fixed evaluation set">
              {workspace.entries.map((entry, index) => {
                const draft = decisions[entry.leadId];
                const locked = entry.ownerReview.label !== "UNREVIEWED";
                const complete = isCompleteOwnerLabelingDecision(draft);
                const active = entry.leadId === currentEntry.leadId;
                return (
                  <li key={entry.leadId}>
                    <button
                      type="button"
                      onClick={() => setSelectedLeadId(entry.leadId)}
                      aria-current={active ? "step" : undefined}
                      className={cn(
                        "v2-focus-ring flex min-h-14 w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors",
                        active ? "bg-emerald-300/[0.08] text-white" : "text-zinc-400 hover:bg-white/[0.035] hover:text-zinc-100",
                      )}
                    >
                      <span className="grid size-7 shrink-0 place-items-center rounded-lg border border-white/[0.08] bg-black/20 font-mono text-[10px] text-zinc-500">{String(index + 1).padStart(2, "0")}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-semibold">{entry.businessName}</span>
                        <span className="mt-0.5 block text-[10px] text-zinc-600">{readable(entry.city)} · {readable(entry.niche)}</span>
                      </span>
                      {locked ? <LockKeyhole className="size-3.5 shrink-0 text-zinc-600" aria-label="Recorded" /> : complete ? <Check className="size-4 shrink-0 text-emerald-300" aria-label="Draft complete" /> : null}
                    </button>
                  </li>
                );
              })}
            </ol>
            </details>
          </aside>

          <main className="min-w-0 rounded-2xl border border-white/[0.08] bg-[#0e1014]" aria-labelledby="evaluation-business-name">
            <header className="border-b border-white/[0.07] px-4 py-5 sm:px-6">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-white/[0.09] bg-white/[0.03] px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.14em] text-zinc-500">Business {currentIndex + 1} of 50</span>
                    <span className={cn("rounded-full border px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.14em]", LABEL_TONES[currentEntry.engineAssessment.label])}>Engine says {readable(currentEntry.engineAssessment.label)}</span>
                  </div>
                  <h2 id="evaluation-business-name" className="mt-3 text-2xl font-semibold tracking-[-0.035em] text-white">{currentEntry.businessName}</h2>
                  <p className="mt-1.5 text-sm text-zinc-500">{readable(currentEntry.city)} · {readable(currentEntry.niche)} · {readable(currentEntry.audit.classification)}</p>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="icon-sm" onClick={() => move(-1)} disabled={currentIndex <= 0} aria-label="Previous business"><ChevronLeft aria-hidden="true" /></Button>
                  <Button variant="outline" size="icon-sm" onClick={() => move(1)} disabled={currentIndex >= 49} aria-label="Next business"><ChevronRight aria-hidden="true" /></Button>
                </div>
              </div>
            </header>

            <nav aria-label="Review section shortcuts" className="sticky top-16 z-10 flex gap-2 border-b border-white/[0.08] bg-[#0e1014] p-3">
              <a href="#quality-proof-heading" onClick={(event) => focusReviewSection(event, "quality-proof-heading")} className="v2-focus-ring inline-flex min-h-11 flex-1 items-center justify-center rounded-lg border border-white/[0.12] px-3 text-sm font-semibold text-zinc-200">Inspect evidence</a>
              <a href="#owner-verdict-heading" onClick={(event) => focusReviewSection(event, "owner-verdict-heading")} className="v2-focus-ring inline-flex min-h-11 flex-1 items-center justify-center rounded-lg border border-emerald-300/25 bg-emerald-300/[0.08] px-3 text-sm font-semibold text-emerald-100">Your verdict</a>
            </nav>

            <div className="grid gap-6 p-4 sm:p-6 2xl:grid-cols-[minmax(0,1.15fr)_minmax(340px,0.85fr)]">
              <div className="min-w-0 space-y-6">
                <section aria-labelledby="quality-scores-heading">
                  <h3 id="quality-scores-heading" className="text-xs font-semibold uppercase tracking-[0.15em] text-zinc-500">Five separate quality scores</h3>
                  <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
                    {SCORE_LABELS.map((score) => {
                      const value = currentEntry.engineAssessment.scores[score.key];
                      return (
                        <div key={score.key} className="rounded-xl border border-white/[0.07] bg-black/20 px-3 py-3">
                          <dt className="text-[9px] font-semibold uppercase tracking-[0.12em] text-zinc-600">{score.label}</dt>
                          <dd className="mt-2 font-mono text-lg font-semibold tabular-nums text-zinc-100">{value}<span className="text-[9px] text-zinc-700">/100</span></dd>
                        </div>
                      );
                    })}
                  </dl>
                </section>

                <section aria-labelledby="quality-proof-heading">
                  <div className="flex items-end justify-between gap-3">
                    <div>
                      <h3 id="quality-proof-heading" tabIndex={-1} className="v2-focus-ring scroll-mt-36 rounded text-sm font-semibold text-white">Proof behind the engine&apos;s verdict</h3>
                      <p className="mt-1 text-xs leading-5 text-zinc-500">Inspect the actual observation before agreeing.</p>
                    </div>
                    <a href={currentEntry.sourceEvidenceUrl} target="_blank" rel="noreferrer" className="v2-focus-ring inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2 text-xs font-semibold text-emerald-300 hover:text-emerald-200">Source record <ExternalLink className="size-3" aria-hidden="true" /></a>
                  </div>
                  {currentEntry.audit.claims.length > 0 ? (
                    <ul className="mt-3 space-y-2">
                      {currentEntry.audit.claims.slice(0, 6).map((claim) => (
                        <li key={claim.claimId} className="rounded-xl border border-white/[0.07] bg-white/[0.018] p-3.5">
                          <div className="flex flex-wrap items-center gap-2 text-[9px] font-semibold uppercase tracking-[0.13em]">
                            <span className={claim.severity === "CRITICAL" ? "text-rose-300" : claim.severity === "IMPORTANT" ? "text-amber-300" : "text-zinc-500"}>{readable(claim.severity)}</span>
                            {claim.conversionCritical ? <span className="text-emerald-300">Conversion critical</span> : null}
                            <span className="text-zinc-700">{claim.confidence}% confidence</span>
                          </div>
                          <p className="mt-2 text-sm leading-6 text-zinc-300">{claim.observation}</p>
                          <a href={claim.sourceUrl} target="_blank" rel="noreferrer" className="v2-focus-ring mt-2 inline-flex min-h-8 items-center gap-1 rounded-md text-[10px] font-semibold text-zinc-500 hover:text-zinc-200">Inspect evidence <ExternalLink className="size-3" aria-hidden="true" /></a>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-3 rounded-xl border border-amber-300/15 bg-amber-300/[0.04] p-4 text-sm text-amber-100/80">No supported negative website claims are available. Treat that as a reason to disagree or request more evidence.</p>
                  )}
                </section>
              </div>

              <section className="self-start rounded-2xl border border-white/[0.08] bg-[#090b0e] p-4 sm:p-5" aria-labelledby="owner-verdict-heading">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 id="owner-verdict-heading" tabIndex={-1} className="v2-focus-ring scroll-mt-36 rounded text-base font-semibold text-white">Your verdict</h3>
                    <p className="mt-1 text-xs leading-5 text-zinc-500">Judge the opportunity, not whether an email exists.</p>
                  </div>
                  {currentEntry.ownerReview.label !== "UNREVIEWED" ? <LockKeyhole className="size-4 text-zinc-500" aria-label="Recorded review" /> : null}
                </div>

                {currentEntry.ownerReview.label !== "UNREVIEWED" ? (
                  <div className="mt-4 rounded-xl border border-emerald-300/20 bg-emerald-300/[0.05] p-4">
                    <p className="text-xs font-semibold text-emerald-100">Recorded as {readable(currentEntry.ownerReview.label)}</p>
                    <p className="mt-2 text-xs leading-5 text-zinc-400">{currentEntry.ownerReview.reasons.map(readable).join(" · ")}</p>
                    {currentEntry.ownerReview.notes ? <p className="mt-2 text-xs leading-5 text-zinc-500">{currentEntry.ownerReview.notes}</p> : null}
                  </div>
                ) : (
                  <>
                    <div className="mt-4 grid gap-2" role="group" aria-label="Lead quality verdict">
                      {OWNER_LABEL_OPTIONS.map((option) => {
                        const active = currentDecision.label === option.value;
                        return (
                          <button
                            type="button"
                            key={option.value}
                            aria-pressed={active}
                            onClick={() => chooseLabel(option.value)}
                            className={cn(
                              "v2-focus-ring min-h-14 rounded-xl border px-3 py-2.5 text-left transition-colors",
                              active ? LABEL_TONES[option.value] : "border-white/[0.08] bg-white/[0.025] text-zinc-300 hover:border-white/[0.16] hover:bg-white/[0.05]",
                            )}
                          >
                            <span className="block text-sm font-semibold">{option.label}</span>
                            <span className="mt-0.5 block text-[11px] leading-4 opacity-70">{option.explanation}</span>
                          </button>
                        );
                      })}
                    </div>

                    {currentDecision.label ? (
                      <fieldset className="mt-5">
                        <legend className="text-xs font-semibold text-zinc-200">Why? Choose at least one.</legend>
                        <div className="mt-2 space-y-1.5">
                          {OWNER_REASON_OPTIONS[currentDecision.label].map((reason) => (
                            <label key={reason.value} className="flex min-h-10 cursor-pointer items-center gap-3 rounded-lg border border-white/[0.07] bg-white/[0.018] px-3 py-2 text-xs text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-200">
                              <input type="checkbox" checked={currentDecision.reasons.includes(reason.value)} onChange={() => toggleReason(reason.value)} className="size-4 accent-emerald-400" />
                              {reason.label}
                            </label>
                          ))}
                        </div>
                      </fieldset>
                    ) : null}

                    <label className="mt-5 block text-xs font-semibold text-zinc-200" htmlFor={`owner-note-${currentEntry.leadId}`}>Optional note</label>
                    <Textarea
                      id={`owner-note-${currentEntry.leadId}`}
                      value={currentDecision.notes}
                      maxLength={500}
                      placeholder="What did the engine miss or get right?"
                      className="mt-2 min-h-24 border-white/[0.1] bg-black/20 text-zinc-200 placeholder:text-zinc-700"
                      onChange={(event) => updateCurrent({ ...currentDecision, notes: event.currentTarget.value })}
                    />
                  </>
                )}

                <div className="mt-6 border-t border-white/[0.07] pt-5">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs font-semibold text-zinc-300">Reviewing as</span>
                    <div className="flex rounded-lg border border-white/[0.09] bg-black/20 p-1" role="group" aria-label="Review owner">
                      {(["RILEY", "AIDAN"] as const).map((owner) => (
                        <button key={owner} type="button" aria-pressed={reviewedBy === owner} onClick={() => setReviewedBy(owner)} className={cn("v2-focus-ring min-h-8 rounded-md px-2.5 text-[10px] font-semibold", reviewedBy === owner ? "bg-white/[0.09] text-white" : "text-zinc-600 hover:text-zinc-300")}>{readable(owner)}</button>
                      ))}
                    </div>
                  </div>
                  <Button className="mt-4 min-h-11 w-full" disabled={completedDrafts.length === 0 || incompleteDrafts.length > 0} onClick={downloadSubmission}>
                    <Download aria-hidden="true" />Download {completedDrafts.length || ""} review{completedDrafts.length === 1 ? "" : "s"}
                  </Button>
                  <p className="mt-3 text-center text-[10px] leading-4 text-zinc-600">Creates a private checkpoint file only. No score, database, campaign, or contact action changes here.</p>
                </div>
              </section>
            </div>
          </main>
        </div>
      ) : null}

      <div role="note" className="flex items-start gap-3 rounded-xl border border-amber-300/15 bg-amber-300/[0.04] px-4 py-3 text-xs leading-5 text-amber-100/75">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-amber-300" aria-hidden="true" />
        Quality Lab records owner judgment only. It cannot acquire leads, call providers, change qualification, assess consent, contact a business, send email, deploy, or spend money.
      </div>
    </div>
  );
}
