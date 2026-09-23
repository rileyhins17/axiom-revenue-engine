"use client";

import { Check, ChevronLeft, ChevronRight, Download, ExternalLink, ShieldCheck } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import type { M2OwnerIdentityPacketResult } from "@/lib/revenue-engine/m2-owner-identity-packet";
import {
  buildM2OwnerIdentityDecisionLedger,
  emptyM2OwnerIdentityDraft,
  isM2OwnerIdentityDecisionComplete,
  m2OwnerIdentityAlternateKey,
  m2OwnerIdentityDraftStorageKey,
  type M2OwnerAction,
  type M2OwnerIdentityDraft,
  type M2OwnerIdentityDraftMap,
  type M2OwnerMarket,
  type M2OwnerNiche,
  type M2OwnerReviewer,
} from "./m2-owner-identity-review-ledger";

const ACTIONS: Array<{ value: M2OwnerAction; label: string; explanation: string }> = [
  { value: "KEEP", label: "Keep this business", explanation: "This business belongs in the evaluation set." },
  { value: "KEEP_AS_BLOCKED", label: "Keep it marked as blocked", explanation: "Keep the identity for review while access to its website remains blocked." },
  { value: "REPLACE", label: "Replace it", explanation: "Choose one of the supported alternatives listed in this research packet." },
  { value: "HOLD", label: "Hold for later", explanation: "There is not enough certainty to decide now." },
  { value: "REJECT", label: "Reject this business", explanation: "This business should not remain in the proposed evaluation set." },
];

const CITY_OPTIONS: Array<{ value: M2OwnerMarket; label: string }> = [
  { value: "KITCHENER", label: "Kitchener" },
  { value: "WATERLOO", label: "Waterloo" },
  { value: "CAMBRIDGE", label: "Cambridge" },
];
const NICHE_OPTIONS: Array<{ value: M2OwnerNiche; label: string }> = [
  { value: "ROOFING", label: "Roofing" },
  { value: "HVAC", label: "Heating and cooling" },
  { value: "LANDSCAPING", label: "Landscaping" },
];

function titleCase(value: string) {
  return value.toLowerCase().replaceAll("_", " ").replace(/(^|\s)\S/g, (letter) => letter.toUpperCase());
}

function safeStoredDraft(value: unknown, reviewIds: Set<string>): { reviewedBy: M2OwnerReviewer | null; drafts: M2OwnerIdentityDraftMap } | null {
  if (!value || typeof value !== "object") return null;
  const stored = value as { version?: unknown; reviewedBy?: unknown; drafts?: unknown };
  if (stored.version !== 1 || !stored.drafts || typeof stored.drafts !== "object" || Array.isArray(stored.drafts)) return null;
  const reviewedBy = stored.reviewedBy === "RILEY" || stored.reviewedBy === "AIDAN" ? stored.reviewedBy : null;
  const drafts: M2OwnerIdentityDraftMap = {};
  for (const [reviewId, valueForId] of Object.entries(stored.drafts)) {
    if (!reviewIds.has(reviewId) || !valueForId || typeof valueForId !== "object") continue;
    const item = valueForId as Partial<M2OwnerIdentityDraft>;
    const action = ["KEEP", "KEEP_AS_BLOCKED", "REPLACE", "HOLD", "REJECT"].includes(String(item.action))
      ? item.action as M2OwnerAction
      : null;
    const city = ["KITCHENER", "WATERLOO", "CAMBRIDGE"].includes(String(item.city)) ? item.city as M2OwnerMarket : "";
    const niche = ["ROOFING", "HVAC", "LANDSCAPING"].includes(String(item.niche)) ? item.niche as M2OwnerNiche : "";
    drafts[reviewId] = {
      action,
      rationale: typeof item.rationale === "string" ? item.rationale.slice(0, 500) : "",
      identityConfirmed: item.identityConfirmed === true,
      marketAndNicheConfirmed: item.marketAndNicheConfirmed === true,
      independenceConfirmed: item.independenceConfirmed === true,
      alternateKey: typeof item.alternateKey === "string" ? item.alternateKey.slice(0, 10_000) : "",
      city,
      niche,
    };
  }
  return { reviewedBy, drafts };
}

export function M2OwnerIdentityReview({ result }: { result: M2OwnerIdentityPacketResult }) {
  const readyPacket = result.status === "READY" ? result : null;
  const [drafts, setDrafts] = React.useState<M2OwnerIdentityDraftMap>({});
  const [reviewedBy, setReviewedBy] = React.useState<M2OwnerReviewer | null>(null);
  const [currentIndex, setCurrentIndex] = React.useState(0);
  const [hydratedFor, setHydratedFor] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (result.status !== "READY") return;
    const packet = result;
    const reviewIds = new Set(packet.selected.map((candidate) => candidate.reviewId));
    let saved: ReturnType<typeof safeStoredDraft> = null;
    try {
      const raw = localStorage.getItem(m2OwnerIdentityDraftStorageKey(packet.packetSha256));
      saved = raw ? safeStoredDraft(JSON.parse(raw) as unknown, reviewIds) : null;
    } catch {
      saved = null;
    }
    setDrafts(saved?.drafts ?? {});
    setReviewedBy(saved?.reviewedBy ?? null);
    setCurrentIndex(0);
    setHydratedFor(packet.packetSha256);
  }, [result]);

  React.useEffect(() => {
    if (!readyPacket || hydratedFor !== readyPacket.packetSha256) return;
    try {
      localStorage.setItem(m2OwnerIdentityDraftStorageKey(readyPacket.packetSha256), JSON.stringify({
        version: 1,
        reviewedBy,
        drafts,
      }));
    } catch {
      // The owner can still download the file if browser storage is unavailable.
    }
  }, [drafts, hydratedFor, readyPacket, reviewedBy]);

  if (!readyPacket) {
    const unavailableReason = result.status === "UNAVAILABLE" ? result.reason : "The exact research packet could not be verified.";
    return (
      <div className="mx-auto flex max-w-4xl flex-col gap-5">
        <header className="rounded-2xl border border-[#e5e9e6] bg-white px-5 py-5 shadow-sm sm:px-7">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#718078]">Business review</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-[#1f2d25]">Choose businesses to research</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[#66756c]">Check each business identity before the research set moves forward.</p>
        </header>
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-[#674c1f]" role="status" aria-live="polite">
          <h2 className="font-semibold">This review packet is unavailable</h2>
          <p className="mt-2 text-sm leading-6">{unavailableReason}</p>
          <p className="mt-3 text-sm leading-6">No review can be recorded until the exact local research packet is available.</p>
        </section>
      </div>
    );
  }

  const candidates = readyPacket.selected;
  const candidate = candidates[currentIndex] ?? candidates[0]!;
  const draft = drafts[candidate.reviewId] ?? emptyM2OwnerIdentityDraft();
  const completedCount = candidates.filter((item) => isM2OwnerIdentityDecisionComplete(item, drafts[item.reviewId], readyPacket.supportedAlternates)).length;
  const canExport = completedCount === 10 && reviewedBy !== null;

  const updateCurrent = (patch: Partial<M2OwnerIdentityDraft>) => {
    setDrafts((current) => ({
      ...current,
      [candidate.reviewId]: { ...(current[candidate.reviewId] ?? emptyM2OwnerIdentityDraft()), ...patch },
    }));
    setMessage(null);
  };

  const chooseAction = (action: M2OwnerAction) => {
    updateCurrent({
      ...emptyM2OwnerIdentityDraft(),
      action,
      rationale: draft.rationale,
    });
  };

  const downloadLedger = () => {
    try {
      const ledger = buildM2OwnerIdentityDecisionLedger({
        packet: readyPacket,
        reviewedBy,
        reviewedAt: new Date().toISOString(),
        drafts,
      });
      const blob = new Blob([`${JSON.stringify(ledger, null, 2)}\n`], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `m2-owner-decisions-${readyPacket.packetSha256.slice(0, 12)}.json`;
      link.click();
      URL.revokeObjectURL(url);
      setMessage("Downloaded the ten owner decisions. Replacement identities still need source-plan validation before the next stage.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The decision file could not be created.");
    }
  };

  const needsConfirmations = draft.action === "KEEP" || draft.action === "KEEP_AS_BLOCKED" || draft.action === "REPLACE";
  const rationaleId = `m2-rationale-${candidate.reviewId}`;
  const confirmations = [
    { key: "identityConfirmed" as const, label: "I confirmed this is the correct business identity." },
    { key: "marketAndNicheConfirmed" as const, label: "I confirmed the city and business type from the supporting evidence." },
    { key: "independenceConfirmed" as const, label: "I accept the available ownership evidence for this evaluation." },
  ];

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-4 rounded-2xl border border-[#e5e9e6] bg-white px-5 py-5 shadow-sm sm:px-7">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#718078]">Business review</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-[#1f2d25]">Choose businesses to research</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[#66756c]">Choose which businesses belong in the evaluation set. This records identity decisions only; it does not qualify, contact, or approve outreach.</p>
        </div>
        <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-800">Review only · no outreach</span>
      </header>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <section className="min-w-0 rounded-2xl border border-[#e5e9e6] bg-white shadow-sm" aria-labelledby="m2-candidate-name">
          <div className="border-b border-[#edf0ed] px-5 py-4 sm:px-7">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-medium uppercase tracking-[0.12em] text-[#718078]">Candidate {currentIndex + 1} of 10</p>
                <h2 id="m2-candidate-name" className="mt-1 text-lg font-semibold text-[#1f2d25]">{candidate.name}</h2>
              </div>
              <span className="rounded-full bg-[#f2f5f2] px-3 py-1 text-xs font-medium text-[#52645a]">Candidate {currentIndex + 1}</span>
            </div>
            <div className="mt-4 h-2 overflow-hidden rounded-full bg-[#edf0ed]" role="progressbar" aria-label="Identity review progress" aria-valuemin={0} aria-valuemax={10} aria-valuenow={completedCount}>
              <div className="h-full rounded-full bg-[#32815b] transition-[width]" style={{ width: `${completedCount * 10}%` }} />
            </div>
            <p className="mt-2 text-xs text-[#66756c]">{completedCount} of 10 decisions complete</p>
          </div>

          <div className="grid gap-5 px-5 py-5 sm:px-7 sm:py-6">
            {candidate.accessBlocked ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-5 text-[#674c1f]" role="note">
                Access to this business&apos;s website was blocked during research. You can keep it marked as blocked, or hold, reject, or replace it.
              </div>
            ) : null}

            <section aria-labelledby="m2-identity-evidence-heading">
              <h3 id="m2-identity-evidence-heading" className="text-sm font-semibold text-[#28382f]">Identity evidence</h3>
              <dl className="mt-3 grid gap-3 rounded-xl border border-[#edf0ed] bg-[#fafbfa] p-4 sm:grid-cols-2">
                <div><dt className="text-xs text-[#718078]">City</dt><dd className="mt-1 text-sm font-medium text-[#2d4035]">{titleCase(candidate.city)}</dd></div>
                <div><dt className="text-xs text-[#718078]">Business type</dt><dd className="mt-1 text-sm font-medium text-[#2d4035]">{titleCase(candidate.niche)}</dd></div>
                <div className="sm:col-span-2"><dt className="text-xs text-[#718078]">Ownership information</dt><dd className="mt-1 text-sm leading-5 text-[#42534a]">{candidate.independenceClaim}</dd><p className="mt-1 text-xs leading-5 text-[#718078]">This information is stated by the business and has not been confirmed against a registry.</p></div>
              </dl>
              <div className="mt-3 flex flex-wrap gap-2">
                <a className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-[#dce4de] bg-white px-3 py-2 text-sm font-medium text-[#286547] hover:bg-[#f5f9f6] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#32815b]" href={candidate.officialWebsite} target="_blank" rel="noreferrer noopener">
                  Official website <ExternalLink className="size-4" aria-hidden="true" />
                </a>
                <a className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-[#dce4de] bg-white px-3 py-2 text-sm font-medium text-[#286547] hover:bg-[#f5f9f6] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#32815b]" href={candidate.primarySource} target="_blank" rel="noreferrer noopener">
                  Supporting source <ExternalLink className="size-4" aria-hidden="true" />
                </a>
              </div>
            </section>

            <fieldset>
              <legend className="text-sm font-semibold text-[#28382f]">What should happen with this business?</legend>
              <div className="mt-3 grid gap-2" role="group" aria-label="Owner decision">
                {ACTIONS.map((item) => {
                  const unavailable = (item.value === "KEEP" && candidate.accessBlocked)
                    || (item.value === "KEEP_AS_BLOCKED" && !candidate.accessBlocked);
                  return (
                    <button
                      key={item.value}
                      type="button"
                      aria-pressed={draft.action === item.value}
                      disabled={unavailable}
                      onClick={() => chooseAction(item.value)}
                      className={`min-h-14 rounded-xl border px-4 py-3 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#32815b] disabled:cursor-not-allowed disabled:opacity-45 ${draft.action === item.value ? "border-[#65a27e] bg-[#f0f7f2]" : "border-[#e5e9e6] bg-white hover:bg-[#fafbfa]"}`}
                    >
                      <span className="block text-sm font-semibold text-[#2b3c32]">{item.label}</span>
                      <span className="mt-0.5 block text-xs leading-5 text-[#68776e]">{item.explanation}</span>
                    </button>
                  );
                })}
              </div>
            </fieldset>

            {draft.action === "REPLACE" ? (
              <section className="rounded-xl border border-[#dce4de] bg-[#f8faf8] p-4" aria-labelledby="m2-replacement-heading">
                <h3 id="m2-replacement-heading" className="text-sm font-semibold text-[#28382f]">Choose a supported alternative</h3>
                <p className="mt-1 text-xs leading-5 text-[#66756c]">Only alternatives already included in this packet can be selected.</p>
                {readyPacket.supportedAlternates.length === 0 ? (
                  <p className="mt-3 text-sm text-[#674c1f]">No supported alternatives are available. Choose Hold or Reject instead.</p>
                ) : (
                  <div className="mt-3 grid gap-2" role="group" aria-label="Supported alternatives">
                      {readyPacket.supportedAlternates.map((alternate) => (
                        <div key={m2OwnerIdentityAlternateKey(alternate)} className={`rounded-lg border p-3 ${draft.alternateKey === m2OwnerIdentityAlternateKey(alternate) ? "border-[#65a27e] bg-white" : "border-[#e5e9e6] bg-white"}`}>
                          <button type="button" aria-pressed={draft.alternateKey === m2OwnerIdentityAlternateKey(alternate)} onClick={() => updateCurrent({ alternateKey: m2OwnerIdentityAlternateKey(alternate), city: "", niche: "", identityConfirmed: false, marketAndNicheConfirmed: false, independenceConfirmed: false })} className="w-full rounded text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#32815b]">
                            <span className="block text-sm font-semibold text-[#2b3c32]">{alternate.name}</span>
                            <span className="mt-1 block text-xs leading-5 text-[#66756c]">{alternate.reason}</span>
                          </button>
                          <span className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[#286547]">
                            <a href={alternate.officialWebsite} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 underline underline-offset-2"><span className="sr-only">Official website: </span>Official website<ExternalLink className="size-3" aria-hidden="true" /></a>
                            <a href={alternate.sourceUrl} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 underline underline-offset-2"><span className="sr-only">Supporting source: </span>Supporting source<ExternalLink className="size-3" aria-hidden="true" /></a>
                          </span>
                        </div>
                      ))}
                  </div>
                )}
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <label className="block text-xs font-semibold text-[#405248]">Confirm the replacement&apos;s city
                    <select value={draft.city} onChange={(event) => updateCurrent({ city: event.currentTarget.value as M2OwnerMarket | "" })} className="mt-1.5 min-h-11 w-full rounded-lg border border-[#dce4de] bg-white px-3 text-sm font-normal text-[#2d4035] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#32815b]">
                      <option value="">Choose a city</option>{CITY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                  </label>
                  <label className="block text-xs font-semibold text-[#405248]">Confirm the replacement&apos;s business type
                    <select value={draft.niche} onChange={(event) => updateCurrent({ niche: event.currentTarget.value as M2OwnerNiche | "" })} className="mt-1.5 min-h-11 w-full rounded-lg border border-[#dce4de] bg-white px-3 text-sm font-normal text-[#2d4035] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#32815b]">
                      <option value="">Choose a business type</option>{NICHE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                  </label>
                </div>
                <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-[#674c1f]">Replacement city and business type must still be matched to the reviewed source plan before this identity can move to the next stage.</p>
              </section>
            ) : null}

            {needsConfirmations ? (
              <fieldset className="rounded-xl border border-[#e5e9e6] p-4">
                <legend className="px-1 text-sm font-semibold text-[#28382f]">Confirm each detail before keeping or replacing this identity</legend>
                <div className="grid gap-2">
                  {confirmations.map((item) => (
                    <label key={item.key} className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg px-2 py-2 text-sm leading-5 text-[#405248] hover:bg-[#f8faf8]">
                      <input className="mt-0.5 size-4 accent-[#32815b]" type="checkbox" checked={draft[item.key]} onChange={(event) => updateCurrent({ [item.key]: event.currentTarget.checked })} />
                      {item.label}
                    </label>
                  ))}
                </div>
              </fieldset>
            ) : null}

            {draft.action ? (
              <div>
                <label className="block text-sm font-semibold text-[#28382f]" htmlFor={rationaleId}>Why did you choose this?</label>
                <textarea id={rationaleId} value={draft.rationale} onChange={(event) => updateCurrent({ rationale: event.currentTarget.value })} maxLength={500} rows={3} placeholder="Record the evidence or concern behind this decision (at least 10 characters)." className="mt-2 min-h-24 w-full rounded-xl border border-[#dce4de] bg-white px-3 py-2.5 text-sm leading-5 text-[#2d4035] placeholder:text-[#8a978f] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#32815b]" />
                <p className="mt-1 text-right text-xs text-[#718078]">{draft.rationale.trim().length}/500 · at least 10 characters</p>
              </div>
            ) : null}

            <div className="flex items-center justify-between border-t border-[#edf0ed] pt-4">
              <Button variant="outline" disabled={currentIndex === 0} onClick={() => setCurrentIndex((index) => Math.max(0, index - 1))}><ChevronLeft aria-hidden="true" />Previous</Button>
              <Button variant="outline" disabled={currentIndex === candidates.length - 1} onClick={() => setCurrentIndex((index) => Math.min(candidates.length - 1, index + 1))}>Next<ChevronRight aria-hidden="true" /></Button>
            </div>
          </div>
        </section>

        <aside className="flex flex-col gap-4">
          <section className="rounded-2xl border border-[#e5e9e6] bg-white p-5 shadow-sm" aria-labelledby="m2-reviewer-heading">
            <h2 id="m2-reviewer-heading" className="text-sm font-semibold text-[#28382f]">Who is reviewing?</h2>
            <p className="mt-1 text-xs leading-5 text-[#68776e]">Choose the owner making these decisions. There is no preselected reviewer.</p>
            <div className="mt-3 grid grid-cols-2 gap-2" role="group" aria-label="Reviewing owner">
              {(["RILEY", "AIDAN"] as const).map((owner) => <button key={owner} type="button" aria-pressed={reviewedBy === owner} onClick={() => { setReviewedBy(owner); setMessage(null); }} className={`min-h-11 rounded-lg border text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#32815b] ${reviewedBy === owner ? "border-[#65a27e] bg-[#f0f7f2] text-[#286547]" : "border-[#dce4de] bg-white text-[#52645a] hover:bg-[#fafbfa]"}`}>{titleCase(owner)}</button>)}
            </div>
            {!reviewedBy ? <p className="mt-2 text-xs text-[#8b5b27]">Select the reviewer to enable the final download.</p> : null}
          </section>

          <section className="rounded-2xl border border-[#e5e9e6] bg-white p-5 shadow-sm" aria-labelledby="m2-progress-heading">
            <div className="flex items-center justify-between gap-3">
              <h2 id="m2-progress-heading" className="text-sm font-semibold text-[#28382f]">Review progress</h2>
              <span className="text-sm font-semibold text-[#286547]">{completedCount}/10</span>
            </div>
            <ol className="mt-3 space-y-1.5">
              {candidates.map((item, index) => {
                const complete = isM2OwnerIdentityDecisionComplete(item, drafts[item.reviewId], readyPacket.supportedAlternates);
                return <li key={item.reviewId}><button type="button" onClick={() => setCurrentIndex(index)} aria-current={index === currentIndex ? "step" : undefined} className={`flex min-h-10 w-full items-center gap-2 rounded-lg px-2 text-left text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#32815b] ${index === currentIndex ? "bg-[#f0f7f2] font-semibold text-[#286547]" : "text-[#5e6e64] hover:bg-[#f8faf8]"}`}><span className="w-16 shrink-0">Candidate {index + 1}</span><span className="min-w-0 flex-1 truncate">{item.name}</span>{complete ? <Check className="size-4 shrink-0 text-[#32815b]" aria-label="Complete" /> : <span className="size-2 shrink-0 rounded-full bg-[#c9d2cc]" aria-label="Incomplete" />}</button></li>;
              })}
            </ol>
            <Button className="mt-4 min-h-11 w-full" disabled={!canExport} onClick={downloadLedger}><Download aria-hidden="true" />Download owner decisions</Button>
            {!canExport ? <p className="mt-2 text-center text-xs leading-5 text-[#718078]">Complete all ten decisions and choose a reviewer first.</p> : null}
            {message ? <p className="mt-3 rounded-lg border border-[#dce4de] bg-[#f8faf8] px-3 py-2 text-xs leading-5 text-[#405248]" role="status" aria-live="polite">{message}</p> : null}
          </section>

          <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-[#674c1f]" role="note">
            <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <p>This creates a private decision file only. It does not capture evidence, contact anyone, authorize outreach, or send email. Any replacement must pass source-plan validation later.</p>
          </div>
        </aside>
      </div>
    </div>
  );
}
