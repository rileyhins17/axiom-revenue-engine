"use client";

import { Check, ChevronLeft, ChevronRight, Download, ExternalLink, ShieldCheck } from "lucide-react";
import * as React from "react";

import type { M2OwnerIdentityPacketResult } from "@/lib/revenue-engine/m2-owner-identity-packet";
import {
  buildM2OwnerIdentityDecisionLedger,
  emptyM2OwnerIdentityDraft,
  isM2OwnerIdentityDecisionComplete,
  m2OwnerIdentityAlternateKey,
  m2OwnerIdentityDraftStorageKey,
  restoreM2OwnerIdentityDrafts,
  selectM2OwnerIdentityDrafts,
  type M2OwnerAction,
  type M2OwnerIdentityDraft,
  type M2OwnerIdentityDraftMap,
  type M2OwnerMarket,
  type M2OwnerNiche,
  type M2OwnerReviewer,
} from "./m2-owner-identity-review-ledger";

const OWNER_DECISIONS_ENDPOINT = "/api/leads/m2/identity-decisions";

export type M2OwnerIdentitySavedSummary = {
  status: string;
  filename: string;
  reviewedBy: M2OwnerReviewer;
  reviewedAt: string;
  researchReviewSha256: string;
  decisionDigest: string;
};
export type M2OwnerIdentitySavedReview = M2OwnerIdentitySavedSummary & { decisions: unknown[] };

type OwnerDecisionSavePayload = {
  packetSha256: string;
  reviewedBy: M2OwnerReviewer;
  drafts: M2OwnerIdentityDraftMap;
};

function isSavedSummary(value: unknown): value is M2OwnerIdentitySavedSummary {
  if (!value || typeof value !== "object") return false;
  const summary = value as Partial<M2OwnerIdentitySavedSummary>;
  return typeof summary.status === "string"
    && typeof summary.filename === "string"
    && (summary.reviewedBy === "RILEY" || summary.reviewedBy === "AIDAN")
    && typeof summary.reviewedAt === "string"
    && typeof summary.researchReviewSha256 === "string"
    && typeof summary.decisionDigest === "string";
}

async function responseError(response: Response, fallback: string) {
  try {
    const body = await response.json() as { error?: unknown };
    if (typeof body.error === "string" && body.error.trim()) return body.error;
  } catch {
    // Keep the owner-facing fallback when the server did not return JSON.
  }
  return fallback;
}

export async function loadSavedM2OwnerIdentityDecisions(fetcher: typeof fetch = fetch): Promise<M2OwnerIdentitySavedReview | null> {
  const response = await fetcher(OWNER_DECISIONS_ENDPOINT, {
    method: "GET",
    credentials: "same-origin",
    cache: "no-store",
  });
  if (!response.ok) throw new Error(await responseError(response, "Saved owner decisions could not be loaded."));
  const body = await response.json() as { saved?: unknown };
  if (body.saved === null) return null;
  if (!isSavedSummary(body.saved)) throw new Error("The saved owner decision status could not be understood.");
  const review = body.saved as M2OwnerIdentitySavedSummary & { decisions?: unknown };
  if (!Array.isArray(review.decisions) || review.decisions.length !== 10) {
    throw new Error("The saved owner choices could not be understood.");
  }
  return review as M2OwnerIdentitySavedReview;
}

export async function saveM2OwnerIdentityDecisions(
  payload: OwnerDecisionSavePayload,
  fetcher: typeof fetch = fetch,
): Promise<M2OwnerIdentitySavedSummary> {
  const response = await fetcher(OWNER_DECISIONS_ENDPOINT, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(await responseError(response, "Owner decisions could not be saved."));
  const body = await response.json() as { saved?: unknown };
  if (!isSavedSummary(body.saved)) throw new Error("The saved owner decision confirmation could not be understood.");
  return body.saved;
}

const ACTIONS: Array<{ value: M2OwnerAction; label: string; explanation: string }> = [
  { value: "KEEP", label: "Keep", explanation: "Include this business in the group we research." },
  { value: "KEEP_AS_BLOCKED", label: "Keep as blocked", explanation: "Keep its place, with the website access issue clearly marked." },
  { value: "REPLACE", label: "Replace", explanation: "Choose a supported local business instead." },
  { value: "HOLD", label: "Hold", explanation: "Pause this choice until there is more information." },
  { value: "REJECT", label: "Reject", explanation: "Remove this business from the proposed group." },
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

function safeStoredDraft(value: unknown, reviewIds: Set<string>): M2OwnerIdentityDraftMap | null {
  if (!value || typeof value !== "object") return null;
  const stored = value as { version?: unknown; reviewedBy?: unknown; drafts?: unknown };
  if (stored.version !== 1 || !stored.drafts || typeof stored.drafts !== "object" || Array.isArray(stored.drafts)) return null;
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
  return drafts;
}

export function M2OwnerIdentityReview({ result, actor }: { result: M2OwnerIdentityPacketResult; actor: M2OwnerReviewer | null }) {
  const readyPacket = result.status === "READY" ? result : null;
  const [drafts, setDrafts] = React.useState<M2OwnerIdentityDraftMap>({});
  const [currentIndex, setCurrentIndex] = React.useState(0);
  const [hydratedFor, setHydratedFor] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState<M2OwnerIdentitySavedSummary | null>(null);
  const [savedDrafts, setSavedDrafts] = React.useState<M2OwnerIdentityDraftMap | null>(null);
  const [showingSaved, setShowingSaved] = React.useState(false);
  const [savedStatusLoading, setSavedStatusLoading] = React.useState(true);
  const [savedStatusError, setSavedStatusError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const draftsModified = React.useRef(false);
  const browserDraftsAtLoad = React.useRef<M2OwnerIdentityDraftMap>({});
  const latestDrafts = React.useRef<M2OwnerIdentityDraftMap>({});

  React.useEffect(() => {
    if (result.status !== "READY") return;
    const packet = result;
    draftsModified.current = false;
    const reviewIds = new Set(packet.selected.map((candidate) => candidate.reviewId));
    let storedDrafts: ReturnType<typeof safeStoredDraft> = null;
    try {
      const raw = localStorage.getItem(m2OwnerIdentityDraftStorageKey(packet.packetSha256));
      storedDrafts = raw ? safeStoredDraft(JSON.parse(raw) as unknown, reviewIds) : null;
    } catch {
      storedDrafts = null;
    }
    browserDraftsAtLoad.current = storedDrafts ?? {};
    latestDrafts.current = storedDrafts ?? {};
    setDrafts(storedDrafts ?? {});
    setSaved(null);
    setSavedDrafts(null);
    setShowingSaved(false);
    setCurrentIndex(0);
    setHydratedFor(packet.packetSha256);
  }, [result]);

  React.useEffect(() => {
    if (!readyPacket || !actor) {
      setSavedStatusLoading(false);
      return;
    }
    let cancelled = false;
    setSavedStatusLoading(true);
    setSavedStatusError(null);
    void loadSavedM2OwnerIdentityDecisions()
      .then((review) => {
        if (cancelled || !review) return;
        if (review.researchReviewSha256 !== readyPacket.packetSha256) {
          throw new Error("The saved review belongs to a different business list.");
        }
        const restored = restoreM2OwnerIdentityDrafts(readyPacket, review.decisions);
        const display = selectM2OwnerIdentityDrafts(browserDraftsAtLoad.current, restored, draftsModified.current);
        setSaved(review);
        setSavedDrafts(restored);
        setShowingSaved(display.showingSaved);
        if (!draftsModified.current) {
          latestDrafts.current = display.drafts;
          setDrafts(display.drafts);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) setSavedStatusError(error instanceof Error ? error.message : "Saved owner decisions could not be loaded.");
      })
      .finally(() => { if (!cancelled) setSavedStatusLoading(false); });
    return () => { cancelled = true; };
  }, [actor, readyPacket]);

  React.useEffect(() => {
    if (!readyPacket || hydratedFor !== readyPacket.packetSha256) return;
    try {
      localStorage.setItem(m2OwnerIdentityDraftStorageKey(readyPacket.packetSha256), JSON.stringify({
        version: 1,
        drafts,
      }));
    } catch {
      // The owner can still download the file if browser storage is unavailable.
    }
  }, [drafts, hydratedFor, readyPacket]);

  if (!readyPacket) {
    return (
      <div className="mx-auto flex max-w-5xl flex-col gap-6">
        <header className="rounded-[28px] bg-[#123d31] px-6 py-8 text-white shadow-lg sm:px-9 sm:py-10">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-200">Business review</p>
          <h1 className="mt-3 max-w-3xl text-3xl font-semibold tracking-tight sm:text-4xl">Choose the businesses worth researching</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-emerald-50/90 sm:text-base">We couldn’t verify the current business list, so this review is paused. Your choices won’t be saved until the list can be checked.</p>
        </header>
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-[#674c1f]" role="status" aria-live="polite">
          <h2 className="font-semibold">The business list could not be verified</h2>
          <p className="mt-2 text-sm leading-6">No review can be saved from this page right now. Try refreshing, or ask an administrator for help.</p>
        </section>
      </div>
    );
  }

  const candidates = readyPacket.selected;
  const candidate = candidates[currentIndex] ?? candidates[0]!;
  const draft = drafts[candidate.reviewId] ?? emptyM2OwnerIdentityDraft();
  const completedCount = candidates.filter((item) => isM2OwnerIdentityDecisionComplete(item, drafts[item.reviewId], readyPacket.supportedAlternates)).length;
  const canDownload = completedCount === 10 && actor !== null;
  const canSave = canDownload && !savedStatusLoading && !savedStatusError;

  const updateCurrent = (patch: Partial<M2OwnerIdentityDraft>) => {
    draftsModified.current = true;
    const next = {
      ...latestDrafts.current,
      [candidate.reviewId]: { ...(latestDrafts.current[candidate.reviewId] ?? emptyM2OwnerIdentityDraft()), ...patch },
    };
    latestDrafts.current = next;
    setDrafts(next);
    setShowingSaved(false);
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
        reviewedBy: actor,
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
      setMessage("Downloaded a copy. Any replacement still needs a source check before research begins.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The download copy could not be created.");
    }
  };

  const saveDecisions = async () => {
    if (!canSave || !actor || saving) return;
    setSaving(true);
    setMessage(null);
    try {
      const completeDrafts = Object.fromEntries(candidates.map((item) => [
        item.reviewId,
        latestDrafts.current[item.reviewId] ?? emptyM2OwnerIdentityDraft(),
      ])) as M2OwnerIdentityDraftMap;
      const summary = await saveM2OwnerIdentityDecisions({
        packetSha256: readyPacket.packetSha256,
        reviewedBy: actor,
        drafts: completeDrafts,
      });
      setSaved(summary);
      setSavedDrafts(completeDrafts);
      const display = selectM2OwnerIdentityDrafts(latestDrafts.current, completeDrafts, false);
      setShowingSaved(display.showingSaved);
      if (display.showingSaved) {
        browserDraftsAtLoad.current = completeDrafts;
        draftsModified.current = false;
      }
      setSavedStatusError(null);
      setMessage(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Owner decisions could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  const needsConfirmations = draft.action === "KEEP" || draft.action === "KEEP_AS_BLOCKED" || draft.action === "REPLACE";
  const rationaleId = `m2-rationale-${candidate.reviewId}`;
  const confirmations = [
    { key: "identityConfirmed" as const, label: "The name and website belong to this business." },
    { key: "marketAndNicheConfirmed" as const, label: "The city and type of work match the information shown above." },
    { key: "independenceConfirmed" as const, label: "The available ownership information is enough for this review." },
  ];

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 pb-6">
      <header className="relative overflow-hidden rounded-[28px] bg-gradient-to-br from-[#174937] via-[#123d31] to-[#0b3026] px-6 py-7 text-white shadow-[0_18px_48px_-24px_rgba(12,53,40,0.65)] sm:px-9 sm:py-9">
        <div className="pointer-events-none absolute -right-16 -top-28 size-80 rounded-full border border-white/10" aria-hidden="true" />
        <div className="pointer-events-none absolute -right-2 -top-16 size-56 rounded-full border border-white/10" aria-hidden="true" />
        <div className="relative grid gap-7 lg:grid-cols-[minmax(0,1fr)_280px] lg:items-end">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-200">Axiom · business review</p>
            <h1 className="mt-3 max-w-3xl text-3xl font-semibold tracking-tight sm:text-4xl">Choose businesses for a closer look</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-emerald-50/90 sm:text-base">Review one business at a time. Decide whether to keep it in the research group, then move on. Save your choices when you finish all ten.</p>
          </div>
          <section className="rounded-2xl border border-white/15 bg-white/10 p-4 backdrop-blur-sm" aria-label="Review progress">
            <div className="flex items-end justify-between gap-3">
              <div><p className="text-xs font-medium text-emerald-100">Decisions complete</p><p className="mt-1 text-3xl font-semibold tracking-tight">{completedCount}<span className="text-lg text-emerald-100/80"> / {candidates.length}</span></p></div>
              <p className="pb-1 text-xs font-medium text-emerald-100">{candidates.length - completedCount} to go</p>
            </div>
            <div className="mt-4 h-2 overflow-hidden rounded-full bg-black/20" role="progressbar" aria-label="Business review progress" aria-valuemin={0} aria-valuemax={candidates.length} aria-valuenow={completedCount}>
              <div className="h-full rounded-full bg-emerald-300 transition-[width]" style={{ width: `${(completedCount / candidates.length) * 100}%` }} />
            </div>
          </section>
        </div>
      </header>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <section className="min-w-0 overflow-hidden rounded-[24px] border border-[#dfe8e1] bg-white shadow-[0_12px_36px_-28px_rgba(16,54,39,0.38)]" aria-labelledby="m2-candidate-name">
          <div className="border-b border-[#e8eee9] bg-[#fbfcfb] px-5 py-5 sm:px-8">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#5c7466]">Business {currentIndex + 1} of {candidates.length}</p>
                <h2 id="m2-candidate-name" className="mt-2 break-words text-2xl font-semibold tracking-tight text-[#17382b] sm:text-3xl">{candidate.name}</h2>
              </div>
              {candidate.accessBlocked ? (
                <span className="inline-flex shrink-0 items-center rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-[#81551d]">Website access blocked</span>
              ) : (
                <span className="inline-flex shrink-0 items-center rounded-full border border-[#cfe5d4] bg-[#edf7ef] px-3 py-1.5 text-xs font-semibold text-[#286547]">Ready for your review</span>
              )}
            </div>
          </div>

          <div className="grid gap-7 px-5 py-6 sm:px-8 sm:py-8">
            {candidate.accessBlocked ? (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3.5 text-sm leading-5 text-[#674c1f]" role="note">
                We couldn&apos;t open this business&apos;s website. You can keep it flagged, choose another business, or leave the decision for later.
              </div>
            ) : null}

            <section className="rounded-2xl border border-[#e8eee9] bg-[#f8faf8] p-4 sm:p-5" aria-labelledby="m2-business-details-heading">
              <h3 id="m2-business-details-heading" className="text-xs font-bold uppercase tracking-[0.12em] text-[#64786b]">About this business</h3>
              <dl className="mt-4 grid gap-4 sm:grid-cols-2">
                <div><dt className="text-xs font-medium text-[#718078]">City</dt><dd className="mt-1 text-sm font-semibold text-[#243d30]">{titleCase(candidate.city)}</dd></div>
                <div><dt className="text-xs font-medium text-[#718078]">Type of work</dt><dd className="mt-1 text-sm font-semibold text-[#243d30]">{titleCase(candidate.niche)}</dd></div>
                <div className="sm:col-span-2"><dt className="text-xs font-medium text-[#718078]">Ownership information</dt><dd className="mt-1 text-sm leading-5 text-[#344c3d]">{candidate.independenceClaim}</dd><p className="mt-1 text-xs leading-5 text-[#75847a]">This is how the business describes itself; we have not checked it against a registry.</p></div>
              </dl>
              <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 border-t border-[#e3ebe4] pt-3">
                <a className="inline-flex min-h-10 items-center gap-1.5 rounded-md text-sm font-semibold text-[#216444] underline decoration-[#a3c7ad] underline-offset-4 hover:text-[#123d31] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#32815b]" href={candidate.officialWebsite} target="_blank" rel="noreferrer noopener">
                  Business website <ExternalLink className="size-3.5" aria-hidden="true" />
                </a>
                <a className="inline-flex min-h-10 items-center gap-1.5 rounded-md text-sm font-semibold text-[#216444] underline decoration-[#a3c7ad] underline-offset-4 hover:text-[#123d31] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#32815b]" href={candidate.primarySource} target="_blank" rel="noreferrer noopener">
                  Ownership source <ExternalLink className="size-3.5" aria-hidden="true" />
                </a>
              </div>
            </section>

            <fieldset>
              <legend className="text-lg font-semibold tracking-tight text-[#17382b]">What should we do?</legend>
              <p className="mt-1 text-sm text-[#69796e]">Choose one option for this business.</p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2" role="group" aria-label="Decision for this business">
                {ACTIONS.map((item) => {
                  const unavailable = (item.value === "KEEP" && candidate.accessBlocked)
                    || (item.value === "KEEP_AS_BLOCKED" && !candidate.accessBlocked);
                  const selected = draft.action === item.value;
                  return (
                    <button
                      key={item.value}
                      type="button"
                      aria-pressed={selected}
                      disabled={unavailable}
                      onClick={() => chooseAction(item.value)}
                      className={`group flex min-h-[112px] items-start gap-3 rounded-2xl border p-4 text-left transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#32815b] disabled:cursor-not-allowed disabled:opacity-40 ${selected ? "border-[#2a704b] bg-[#edf7ef] shadow-[0_6px_18px_-12px_rgba(25,95,59,0.55)] ring-1 ring-[#2a704b]" : "border-[#dfe8e1] bg-white hover:border-[#a8c8ae] hover:bg-[#f8fbf8]"}`}
                    >
                      <span className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border ${selected ? "border-[#2a704b] bg-[#2a704b] text-white" : "border-[#cbd8ce] bg-[#f8faf8] text-transparent group-hover:border-[#82ab8d]"}`} aria-hidden="true"><Check className="size-3.5" /></span>
                      <span><span className="block text-base font-semibold text-[#203a2c]">{item.label}</span><span className="mt-1 block text-sm leading-5 text-[#66776b]">{item.explanation}</span></span>
                    </button>
                  );
                })}
              </div>
            </fieldset>

            {draft.action === "REPLACE" ? (
              <section className="rounded-2xl border border-[#cfe2d3] bg-[#f4faf5] p-4 sm:p-5" aria-labelledby="m2-replacement-heading">
                <h3 id="m2-replacement-heading" className="text-base font-semibold text-[#203a2c]">Choose a replacement business</h3>
                <p className="mt-1 text-sm leading-5 text-[#66776b]">Pick one of the reviewed alternatives below.</p>
                {readyPacket.supportedAlternates.length === 0 ? (
                  <p className="mt-3 rounded-xl bg-amber-50 px-3 py-3 text-sm leading-5 text-[#674c1f]">There are no reviewed alternatives to choose from. Select Hold or Reject instead.</p>
                ) : (
                  <div className="mt-3 grid gap-2" role="group" aria-label="Supported alternatives">
                      {readyPacket.supportedAlternates.map((alternate) => (
                        <div key={m2OwnerIdentityAlternateKey(alternate)} className={`rounded-xl border bg-white p-3 transition-colors ${draft.alternateKey === m2OwnerIdentityAlternateKey(alternate) ? "border-[#2a704b] ring-1 ring-[#2a704b]" : "border-[#dfe8e1]"}`}>
                          <button type="button" aria-pressed={draft.alternateKey === m2OwnerIdentityAlternateKey(alternate)} onClick={() => updateCurrent({ alternateKey: m2OwnerIdentityAlternateKey(alternate), city: "", niche: "", identityConfirmed: false, marketAndNicheConfirmed: false, independenceConfirmed: false })} className="w-full rounded text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#32815b]">
                            <span className="block text-sm font-semibold text-[#203a2c]">{alternate.name}</span>
                            <span className="mt-1 block text-sm leading-5 text-[#66776b]">{alternate.reason}</span>
                          </button>
                          <span className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm font-medium text-[#216444]">
                            <a href={alternate.officialWebsite} target="_blank" rel="noreferrer noopener" className="inline-flex min-h-9 items-center gap-1 underline underline-offset-2"><span className="sr-only">Business website: </span>Business website<ExternalLink className="size-3" aria-hidden="true" /></a>
                            <a href={alternate.sourceUrl} target="_blank" rel="noreferrer noopener" className="inline-flex min-h-9 items-center gap-1 underline underline-offset-2"><span className="sr-only">Ownership source: </span>Ownership source<ExternalLink className="size-3" aria-hidden="true" /></a>
                          </span>
                        </div>
                      ))}
                  </div>
                )}
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <label className="block text-sm font-semibold text-[#405248]">Confirm the replacement&apos;s city
                    <select value={draft.city} onChange={(event) => updateCurrent({ city: event.currentTarget.value as M2OwnerMarket | "" })} className="mt-1.5 min-h-11 w-full rounded-xl border border-[#cfdcd1] bg-white px-3 text-sm font-normal text-[#2d4035] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#32815b]">
                      <option value="">Choose a city</option>{CITY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                  </label>
                  <label className="block text-sm font-semibold text-[#405248]">Confirm the replacement&apos;s type of work
                    <select value={draft.niche} onChange={(event) => updateCurrent({ niche: event.currentTarget.value as M2OwnerNiche | "" })} className="mt-1.5 min-h-11 w-full rounded-xl border border-[#cfdcd1] bg-white px-3 text-sm font-normal text-[#2d4035] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#32815b]">
                      <option value="">Choose a business type</option>{NICHE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                  </label>
                </div>
                <p className="mt-3 text-xs leading-5 text-[#66776b]">A replacement is recorded for owner review. It still needs a later source check before research begins.</p>
              </section>
            ) : null}

            {needsConfirmations ? (
              <fieldset className="rounded-2xl border border-[#e5e9e6] bg-[#fbfcfb] p-4 sm:p-5">
                <legend className="px-1 text-sm font-semibold text-[#28382f]">A quick check before you continue</legend>
                <div className="grid gap-1">
                  {confirmations.map((item) => (
                    <label key={item.key} className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg px-2 py-2.5 text-sm leading-5 text-[#405248] hover:bg-[#f3f7f4]">
                      <input className="mt-0.5 size-4 shrink-0 accent-[#216444]" type="checkbox" checked={draft[item.key]} onChange={(event) => updateCurrent({ [item.key]: event.currentTarget.checked })} />
                      {item.label}
                    </label>
                  ))}
                </div>
              </fieldset>
            ) : null}

            {draft.action ? (
              <div className="rounded-2xl border border-[#e8eee9] p-4 sm:p-5">
                <label className="block text-sm font-semibold text-[#28382f]" htmlFor={rationaleId}>What led you to this choice?</label>
                <p className="mt-1 text-xs leading-5 text-[#718078]">A short note helps the owners understand your decision.</p>
                <textarea id={rationaleId} value={draft.rationale} onChange={(event) => updateCurrent({ rationale: event.currentTarget.value })} maxLength={500} rows={3} placeholder="Add a brief reason (at least 10 characters)." className="mt-3 min-h-24 w-full rounded-xl border border-[#d3dfd5] bg-white px-3 py-2.5 text-sm leading-5 text-[#2d4035] placeholder:text-[#8a978f] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#32815b]" />
                <p className="mt-1 text-right text-xs text-[#718078]">{draft.rationale.trim().length} / 500</p>
              </div>
            ) : null}

            <div className="flex items-center justify-between gap-3 border-t border-[#e8eee9] pt-5">
              <button type="button" disabled={currentIndex === 0} onClick={() => setCurrentIndex((index) => Math.max(0, index - 1))} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-[#d5e0d7] bg-white px-4 text-sm font-semibold text-[#344c3d] transition hover:bg-[#f5f8f5] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#32815b] disabled:cursor-not-allowed disabled:opacity-40"><ChevronLeft aria-hidden="true" className="size-4" />Previous</button>
              <span className="text-xs font-medium text-[#75847a]">{currentIndex + 1} of {candidates.length}</span>
              <button type="button" disabled={currentIndex === candidates.length - 1} onClick={() => setCurrentIndex((index) => Math.min(candidates.length - 1, index + 1))} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[#173f30] px-4 text-sm font-semibold text-white transition hover:bg-[#21533d] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#32815b] disabled:cursor-not-allowed disabled:opacity-40">Next business<ChevronRight aria-hidden="true" className="size-4" /></button>
            </div>
          </div>
        </section>

        <aside className="flex flex-col gap-5 lg:sticky lg:top-5">
          <section className="rounded-[22px] border border-[#dfe8e1] bg-white p-5 shadow-[0_12px_36px_-28px_rgba(16,54,39,0.38)] sm:p-6" aria-labelledby="m2-progress-heading">
            <div className="flex items-start justify-between gap-3">
              <div><p className="text-xs font-bold uppercase tracking-[0.12em] text-[#6c7d70]">Your review</p><h2 id="m2-progress-heading" className="mt-1 text-lg font-semibold text-[#203a2c]">Jump to a business</h2></div>
              <span className="rounded-full bg-[#edf7ef] px-2.5 py-1 text-xs font-bold text-[#286547]">{completedCount}/{candidates.length}</span>
            </div>
            <div className="mt-4 grid grid-cols-5 gap-2" role="group" aria-label="Business review steps">
              {candidates.map((item, index) => {
                const complete = isM2OwnerIdentityDecisionComplete(item, drafts[item.reviewId], readyPacket.supportedAlternates);
                const current = index === currentIndex;
                return <button key={item.reviewId} type="button" onClick={() => setCurrentIndex(index)} aria-current={current ? "step" : undefined} aria-label={`Go to business ${index + 1}: ${item.name}${complete ? ", decision complete" : ", decision incomplete"}`} title={item.name} className={`relative flex min-h-11 items-center justify-center rounded-xl border text-sm font-bold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#32815b] ${current ? "border-[#173f30] bg-[#173f30] text-white shadow-sm" : complete ? "border-[#cce2d0] bg-[#edf7ef] text-[#286547] hover:bg-[#e1f1e5]" : "border-[#e0e8e1] bg-[#f8faf8] text-[#69796e] hover:border-[#b8d2bd] hover:bg-white"}`}>{complete ? <Check className="size-4" aria-hidden="true" /> : index + 1}</button>;
              })}
            </div>
            <div className="mt-5 border-t border-[#e8eee9] pt-4">
              <p className="text-xs font-medium text-[#718078]">Signed in as</p>
              {actor ? <p className="mt-1 text-sm font-semibold text-[#203a2c]">{titleCase(actor)}</p> : <p className="mt-1 text-sm leading-5 text-[#8b5b27]">This admin account cannot save owner decisions.</p>}
            </div>
          </section>

          <section className="rounded-[22px] border border-[#dfe8e1] bg-white p-5 shadow-[0_12px_36px_-28px_rgba(16,54,39,0.38)] sm:p-6" aria-labelledby="m2-save-heading">
            <h2 id="m2-save-heading" className="text-lg font-semibold text-[#203a2c]">Save your review</h2>
            <p className="mt-1 text-sm leading-5 text-[#69796e]">Your choices are stored privately in this workspace.</p>
            <button type="button" disabled={!canSave || saving} onClick={() => void saveDecisions()} className="mt-4 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#173f30] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-[#21533d] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#32815b] disabled:cursor-not-allowed disabled:bg-[#b7c4ba] disabled:text-white/90 disabled:shadow-none">
              {saving ? "Saving…" : "Save owner decisions"}
            </button>
            {!canDownload ? <p className="mt-2 text-xs leading-5 text-[#718078]">Complete all ten decisions and sign in as a listed owner to save.</p> : null}
            {canDownload ? <button type="button" className="mt-2 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-[#d5e0d7] bg-white px-4 text-sm font-semibold text-[#344c3d] transition hover:bg-[#f5f8f5] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#32815b]" onClick={downloadLedger}><Download aria-hidden="true" className="size-4" />Download a copy</button> : null}
            {savedStatusLoading ? <p className="mt-3 text-center text-xs text-[#718078]" role="status">Checking for a saved review…</p> : null}
            {savedStatusError ? <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs leading-5 text-[#674c1f]" role="status" aria-live="polite">{savedStatusError}</p> : null}
            {saved && showingSaved ? <p className="mt-3 rounded-xl border border-[#cfe5d4] bg-[#edf7ef] px-3 py-2.5 text-xs leading-5 text-[#286547]" role="status" aria-live="polite">Showing the review saved {new Date(saved.reviewedAt).toLocaleString()} by {titleCase(saved.reviewedBy)}. Saving does not start research or contact businesses.</p> : null}
            {saved && !showingSaved ? <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs leading-5 text-[#674c1f]" role="status" aria-live="polite"><p>A review was saved {new Date(saved.reviewedAt).toLocaleString()} by {titleCase(saved.reviewedBy)}. The choices shown here are unsaved browser changes.</p><button type="button" disabled={!savedDrafts} onClick={() => { if (!savedDrafts) return; latestDrafts.current = savedDrafts; setDrafts(savedDrafts); setShowingSaved(true); setMessage("Loaded the saved choices. Any unsaved browser changes were replaced."); }} className="mt-2 min-h-10 rounded-md font-semibold underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#32815b]">Load saved choices</button></div> : null}
            {message ? <p className="mt-3 rounded-xl border border-[#dce4de] bg-[#f8faf8] px-3 py-2.5 text-xs leading-5 text-[#405248]" role="status" aria-live="polite">{message}</p> : null}
            <div className="mt-4 flex items-start gap-2.5 border-t border-[#e8eee9] pt-4 text-xs leading-5 text-[#6b7b70]" role="note">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-[#2b7750]" aria-hidden="true" />
              <p>Saving does not approve research, contact, or email. Those steps need a separate owner review.</p>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
