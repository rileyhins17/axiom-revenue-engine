"use client";

import { Check, ExternalLink, RefreshCw, ShieldCheck } from "lucide-react";
import * as React from "react";

import type { M2ManualWebsiteObservation } from "@/lib/revenue-engine/m2-manual-website-observation";

const ENDPOINT = "/api/leads/m2/manual-observations";
type Target = {
  reviewId: string;
  businessName: string;
  approvedWebsiteUrl: string;
  businessIdentityDigest: string;
  observations: M2ManualWebsiteObservation[];
};
type Dossier = { version: string; targets: Target[] };
type EvidenceState = "OBSERVED" | "INSUFFICIENT";
type Command = {
  commandId: string;
  reviewId: string;
  observedUrl: string;
  confidence: "LOW" | "MEDIUM" | "HIGH";
  evidenceState: EvidenceState;
  observation: string;
  noCopiedOrPersonalData: true;
};

async function responseError(response: Response, fallback: string) {
  try {
    const body = await response.json() as { error?: unknown };
    if (typeof body.error === "string" && body.error.trim()) return body.error;
  } catch { /* Use the owner-facing fallback when the server response is not JSON. */ }
  return fallback;
}

export async function loadM2ManualObservationDossier(fetcher: typeof fetch = fetch): Promise<Dossier> {
  const response = await fetcher(ENDPOINT, { method: "GET", credentials: "same-origin", cache: "no-store" });
  if (!response.ok) throw new Error(await responseError(response, "Manual M2 website observations could not be loaded."));
  const body = await response.json() as Dossier;
  if (body.version !== "kw-m2-manual-observation-dossier-v1" || !Array.isArray(body.targets)) {
    throw new Error("The manual M2 website review could not be understood.");
  }
  return body;
}

export async function submitM2ManualWebsiteObservation(command: Command, fetcher: typeof fetch = fetch) {
  const response = await fetcher(ENDPOINT, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(command),
  });
  if (!response.ok) throw new Error(await responseError(response, "The manual observation could not be saved."));
  const body = await response.json() as { observation?: M2ManualWebsiteObservation };
  if (!body.observation || body.observation.method !== "MANUAL" || body.observation.assessment.websiteNeed !== "UNKNOWN"
    || body.observation.assessment.qualification !== "RESEARCH") throw new Error("The saved observation could not be verified.");
  return body.observation;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-CA", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Toronto" }).format(new Date(value));
}

function ManualRecord({ record }: { record: M2ManualWebsiteObservation }) {
  return <li className="rounded-xl border border-[#dce9dd] bg-[#f8fbf8] p-3.5 text-sm">
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-medium text-[#5b6d62]">
      <span>{formatDate(record.observedAt)} · {{ RILEY: "Riley", AIDAN: "Aidan", CODEX: "Codex" }[record.recordedBy]}</span>
      <span className="rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-900">Website need: UNKNOWN</span>
      <span className="rounded-full bg-slate-100 px-2 py-0.5 font-semibold text-slate-800">Qualification: RESEARCH</span>
    </div>
    <p className="mt-2 leading-5 text-[#34483b]">{record.evidenceState === "INSUFFICIENT" ? "Not enough evidence was available to record an observation." : record.observation}</p>
    <p className="mt-2 break-all text-xs text-[#66756c]">{record.observedUrl} · Manual · {record.confidence.toLocaleLowerCase()} confidence · {record.auditVersion}</p>
  </li>;
}

export function M2ManualWebsiteObservations() {
  const [dossier, setDossier] = React.useState<Dossier | null>(null);
  const [selectedReviewId, setSelectedReviewId] = React.useState("");
  const [url, setUrl] = React.useState("");
  const [confidence, setConfidence] = React.useState<Command["confidence"]>("LOW");
  const [evidenceState, setEvidenceState] = React.useState<EvidenceState>("OBSERVED");
  const [observation, setObservation] = React.useState("");
  const [noCopiedOrPersonalData, setNoCopiedOrPersonalData] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [expanded, setExpanded] = React.useState(false);
  const [loaded, setLoaded] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const retryCommand = React.useRef<Command | null>(null);

  const reload = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await loadM2ManualObservationDossier();
      setDossier(next);
      setSelectedReviewId((current) => current && next.targets.some((item) => item.reviewId === current)
        ? current : next.targets[0]?.reviewId ?? "");
      setLoaded(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Manual M2 website observations could not be loaded.");
      setLoaded(true);
    } finally { setLoading(false); }
  }, []);

  const toggleExpanded = () => {
    if (!expanded && !loaded) void reload();
    setExpanded((current) => !current);
  };

  const selected = dossier?.targets.find((target) => target.reviewId === selectedReviewId) ?? null;
  React.useEffect(() => {
    if (selected && !url) setUrl(selected.approvedWebsiteUrl);
  }, [selected, url]);

  const submit = async () => {
    if (!selected) return;
    const existing = retryCommand.current;
    const command: Command = existing ?? {
      commandId: crypto.randomUUID(),
      reviewId: selected.reviewId,
      observedUrl: url.trim(),
      confidence,
      evidenceState,
      observation: evidenceState === "OBSERVED" ? observation.trim() : "",
      noCopiedOrPersonalData: true,
    };
    retryCommand.current = command;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const saved = await submitM2ManualWebsiteObservation(command);
      retryCommand.current = null;
      setMessage(saved.evidenceState === "INSUFFICIENT" ? "Saved. The website remains UNKNOWN and the business remains in RESEARCH." : "Saved. The observation is visible in this dossier and remains UNKNOWN / RESEARCH.");
      setObservation("");
      setNoCopiedOrPersonalData(false);
      await reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The manual observation could not be saved.");
    } finally { setSaving(false); }
  };

  const hasPendingRetry = retryCommand.current !== null;
  const readyToSave = selected && noCopiedOrPersonalData && !loading && !saving
    && (hasPendingRetry || (url.trim().length > 0 && (evidenceState === "INSUFFICIENT" || observation.trim().length >= 20)));

  return <section className="mx-auto mt-5 max-w-[1580px] rounded-2xl border border-[#dbe7dc] bg-white p-3.5 shadow-[0_10px_28px_-26px_rgba(27,62,44,0.45)] sm:p-4" aria-labelledby="m2-manual-observations-heading">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><p className="text-xs font-bold uppercase tracking-[0.12em] text-[#2e6b4f]">Optional · M2 manual evidence</p><h2 id="m2-manual-observations-heading" className="mt-1 text-base font-semibold text-[#203a2c]">Website observations</h2></div>
      <button type="button" onClick={toggleExpanded} aria-expanded={expanded} aria-controls="m2-manual-observations-content" className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-[#d5e0d7] px-3 text-sm font-semibold text-[#344c3d] hover:bg-[#f6f9f6]">{expanded ? "Hide optional observations" : "Open optional observations"}</button>
    </div>
    {expanded ? <div id="m2-manual-observations-content" className="mt-3 border-t border-[#e8eee9] pt-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-3xl text-sm leading-5 text-[#63726a]">This is an optional way for an owner to record a manual website observation for an identity already selected in the saved review. It does not require Riley to perform this work and does not satisfy, advance, or count toward any real M2 assessment gate.</p>
        <button type="button" onClick={() => void reload()} disabled={loading || saving} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-[#d5e0d7] px-3 text-sm font-semibold text-[#344c3d] hover:bg-[#f6f9f6] disabled:opacity-50"><RefreshCw className="size-4" aria-hidden="true" />Reload saved notes</button>
      </div>
      {loading ? <p className="mt-4 text-sm text-[#63726a]" role="status">Loading the current reviewed identities…</p> : null}
      {error ? <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3 text-sm text-[#674c1f]" role="alert">{error}</p> : null}
      {message ? <p className="mt-4 rounded-xl border border-[#cfe5d4] bg-[#edf7ef] px-3.5 py-3 text-sm text-[#286547]" role="status" aria-live="polite">{message}</p> : null}
      {dossier?.targets.length === 0 ? <p className="mt-4 rounded-xl bg-[#f7f9f6] p-4 text-sm text-[#63726a]">Save the current owner identity decisions before entering optional manual evidence.</p> : null}
      {dossier?.targets.length ? <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,0.86fr)_minmax(0,1.14fr)]">
      <div className="space-y-4">
        <label className="block text-sm font-semibold text-[#34483b]">Reviewed business
          <select value={selectedReviewId} onChange={(event) => { setSelectedReviewId(event.target.value); setUrl(""); retryCommand.current = null; }} disabled={hasPendingRetry || saving} className="mt-1.5 h-11 w-full rounded-lg border border-[#d5e0d7] bg-white px-3 font-normal focus:border-[#4d9970] focus:outline-none focus:ring-2 focus:ring-[#a7d5b8]">
            {dossier.targets.map((target) => <option key={target.reviewId} value={target.reviewId}>{target.businessName} · {target.reviewId}</option>)}
          </select>
        </label>
        {selected ? <a href={selected.approvedWebsiteUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-10 items-center gap-2 text-sm font-semibold text-[#145c46] underline underline-offset-2"><ExternalLink className="size-4" aria-hidden="true" />Open approved website in a new tab</a> : null}
        <label className="block text-sm font-semibold text-[#34483b]">Exact URL you manually observed
          <input type="url" value={url} onChange={(event) => setUrl(event.target.value)} disabled={hasPendingRetry || saving} maxLength={2048} className="mt-1.5 h-11 w-full rounded-lg border border-[#d5e0d7] px-3 font-normal focus:border-[#4d9970] focus:outline-none focus:ring-2 focus:ring-[#a7d5b8]" />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm font-semibold text-[#34483b]">Confidence
            <select value={confidence} onChange={(event) => setConfidence(event.target.value as Command["confidence"])} disabled={hasPendingRetry || saving} className="mt-1.5 h-11 w-full rounded-lg border border-[#d5e0d7] bg-white px-3 font-normal"><option value="LOW">Low</option><option value="MEDIUM">Medium</option><option value="HIGH">High</option></select>
          </label>
          <label className="block text-sm font-semibold text-[#34483b]">Evidence state
            <select value={evidenceState} onChange={(event) => setEvidenceState(event.target.value as EvidenceState)} disabled={hasPendingRetry || saving} className="mt-1.5 h-11 w-full rounded-lg border border-[#d5e0d7] bg-white px-3 font-normal"><option value="OBSERVED">I observed a specific fact</option><option value="INSUFFICIENT">Not enough evidence</option></select>
          </label>
        </div>
        {evidenceState === "OBSERVED" ? <label className="block text-sm font-semibold text-[#34483b]">Your own-word company-level observation
          <textarea value={observation} onChange={(event) => setObservation(event.target.value)} disabled={hasPendingRetry || saving} maxLength={500} minLength={20} rows={3} placeholder="Example: The service options are grouped into a single narrow column." className="mt-1.5 w-full rounded-lg border border-[#d5e0d7] px-3 py-2 font-normal leading-5 focus:border-[#4d9970] focus:outline-none focus:ring-2 focus:ring-[#a7d5b8]" />
        </label> : <p className="rounded-lg bg-[#f7f9f6] px-3.5 py-3 text-sm leading-5 text-[#63726a]">This records that the available evidence was insufficient. It will not claim the site is missing or needs a rebuild.</p>}
        <label className="flex items-start gap-2.5 text-sm leading-5 text-[#42564a]"><input type="checkbox" checked={noCopiedOrPersonalData} onChange={(event) => setNoCopiedOrPersonalData(event.target.checked)} disabled={hasPendingRetry || saving} className="mt-1 size-4 accent-[#1d7953]" /><span>I wrote this myself and included no copied page text, personal names, or contact details.</span></label>
        <button type="button" onClick={() => void submit()} disabled={!readyToSave} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-[#174e37] px-4 text-sm font-semibold text-white hover:bg-[#21533d] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#196b50] disabled:cursor-not-allowed disabled:bg-[#b7c4ba]"><Check className="size-4" aria-hidden="true" />{saving ? "Saving…" : hasPendingRetry ? "Retry the same save" : "Save manual observation"}</button>
        <p className="flex items-start gap-2 border-t border-[#e8eee9] pt-3 text-xs leading-5 text-[#6b7b70]" role="note"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-[#2b7750]" aria-hidden="true" /><span>No page content, screenshots, DOM, or contact data are stored. A manual note is evidence only; it cannot qualify a business or create a contact route.</span></p>
      </div>
      <div className="space-y-3">
        <div><h3 className="font-semibold text-[#203a2c]">Saved observations</h3><p className="mt-1 text-xs leading-5 text-[#63726a]">Each saved item is immutable and remains separate from identity decisions and real assessment gates.</p></div>
        {selected?.observations.length ? <ol className="space-y-2.5" aria-label="Saved manual website observations">{selected.observations.map((record) => <ManualRecord key={record.observationId} record={record} />)}</ol> : <p className="rounded-xl bg-[#f7f9f6] p-4 text-sm text-[#63726a]">No manual observations have been saved for this business.</p>}
      </div></div> : null}
    </div> : null}
  </section>;
}
