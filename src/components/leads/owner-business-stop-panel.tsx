"use client";

import { AlertTriangle, CircleAlert, LoaderCircle, RefreshCw, ShieldAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";

type StopReason = "OWNER_DECISION" | "PROSPECT_REQUEST" | "OTHER";

type BusinessStop = {
  stopId: string;
  businessId: string;
  reason: StopReason;
  source: "OWNER_ACTION";
  note: string;
  actorUserId: string;
  createdAt: string;
};

type PanelState = "loading" | "ready" | "unavailable";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseStop(value: unknown, businessId: string): BusinessStop {
  if (!isRecord(value)
    || typeof value.stopId !== "string"
    || value.businessId !== businessId
    || (value.reason !== "OWNER_DECISION" && value.reason !== "PROSPECT_REQUEST" && value.reason !== "OTHER")
    || value.source !== "OWNER_ACTION"
    || typeof value.note !== "string"
    || typeof value.actorUserId !== "string"
    || typeof value.createdAt !== "string"
    || !Number.isFinite(new Date(value.createdAt).getTime())) {
    throw new Error("The saved contact stop could not be verified for this business.");
  }

  return {
    stopId: value.stopId,
    businessId,
    reason: value.reason,
    source: "OWNER_ACTION",
    note: value.note,
    actorUserId: value.actorUserId,
    createdAt: value.createdAt,
  };
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Toronto",
    timeZoneName: "short",
  }).format(new Date(value));
}

function readableReason(reason: StopReason) {
  if (reason === "OWNER_DECISION") return "Owner decision";
  if (reason === "PROSPECT_REQUEST") return "Prospect requested no contact";
  return "Other reason";
}

function errorMessage(value: unknown, fallback: string) {
  if (isRecord(value) && typeof value.error === "string" && value.error.trim()) return value.error;
  return fallback;
}

export function OwnerBusinessStopPanel({ businessId }: { businessId: string }) {
  const router = useRouter();
  const [state, setState] = React.useState<PanelState>("loading");
  const [stop, setStop] = React.useState<BusinessStop | null>(null);
  const [reason, setReason] = React.useState<StopReason | "">("");
  const [note, setNote] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [message, setMessage] = React.useState<{ tone: "error" | "success"; text: string } | null>(null);
  const requestSequence = React.useRef(0);
  const idempotencyKeys = React.useRef(new Map<string, string>());
  const endpoint = `/api/v1/leads/${encodeURIComponent(businessId)}/stops`;

  const loadStop = React.useCallback(async () => {
    const sequence = ++requestSequence.current;
    setState("loading");
    setMessage(null);
    try {
      const response = await fetch(endpoint, { headers: { Accept: "application/json" }, credentials: "same-origin" });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(errorMessage(body, "The saved contact stop is unavailable right now."));
      if (!isRecord(body) || !(body.stop === null || isRecord(body.stop))) {
        throw new Error("The saved contact stop response could not be read.");
      }
      const nextStop = body.stop === null ? null : parseStop(body.stop, businessId);
      if (requestSequence.current !== sequence) return;
      setStop(nextStop);
      setState("ready");
    } catch (error) {
      if (requestSequence.current !== sequence) return;
      setStop(null);
      setState("unavailable");
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "The saved contact stop is unavailable right now." });
    }
  }, [businessId, endpoint]);

  React.useEffect(() => {
    void loadStop();
    return () => { requestSequence.current += 1; };
  }, [loadStop]);

  const submitStop = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const cleanNote = note.trim();
    if (!reason || !cleanNote || state !== "ready" || stop) return;

    const command = { reason, note: cleanNote };
    const commandIdentity = JSON.stringify({ businessId, ...command });
    const idempotencyKey = idempotencyKeys.current.get(commandIdentity) ?? crypto.randomUUID();
    idempotencyKeys.current.set(commandIdentity, idempotencyKey);
    setPending(true);
    setMessage(null);

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        credentials: "same-origin",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ ...command, idempotencyKey }),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(errorMessage(body, "The contact stop could not be saved."));
      if (!isRecord(body) || !isRecord(body.stop)) throw new Error("The saved contact stop could not be verified.");
      const savedStop = parseStop(body.stop, businessId);
      if (savedStop.stopId !== `business-stop:${idempotencyKey}` || savedStop.reason !== command.reason || savedStop.note !== command.note) {
        throw new Error("The saved contact stop did not match this exact command.");
      }
      setStop(savedStop);
      setMessage({ tone: "success", text: "Contact stop saved and verified. The business dossier is refreshing." });
      router.refresh();
    } catch (error) {
      setMessage({
        tone: "error",
        text: `${error instanceof Error ? error.message : "The contact stop could not be saved."} If the request may have reached the server, retry without changing the reason or note so it uses the same safe retry key.`,
      });
    } finally {
      setPending(false);
    }
  };

  return (
    <section className="overflow-hidden rounded-2xl border border-rose-300/25 bg-[#171014]" aria-labelledby="owner-business-stop-title">
      <header className="flex flex-col gap-3 border-b border-rose-300/10 px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:px-5">
        <div className="flex gap-3">
          <div className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl border border-rose-300/20 bg-rose-300/[0.08] text-rose-200">
            <ShieldAlert className="size-4" aria-hidden="true" />
          </div>
          <div>
            <h2 id="owner-business-stop-title" className="text-sm font-semibold text-white">Do not contact</h2>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-zinc-400">A saved owner stop blocks this business in the v2 owner view. This panel only records and displays the stop.</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void loadStop()}
          disabled={state === "loading" || pending}
          className="v2-focus-ring inline-flex min-h-9 shrink-0 items-center justify-center gap-1.5 self-start rounded-lg border border-white/[0.1] px-3 text-xs font-semibold text-zinc-300 hover:border-white/[0.2] hover:text-white disabled:opacity-50"
        >
          <RefreshCw className="size-3.5" aria-hidden="true" /> Refresh
        </button>
      </header>

      {message ? (
        <p className={`mx-4 mt-4 rounded-lg border px-3 py-2 text-xs leading-5 sm:mx-5 ${message.tone === "error" ? "border-rose-300/20 bg-rose-300/[0.05] text-rose-100" : "border-emerald-300/20 bg-emerald-300/[0.05] text-emerald-100"}`} role="status" aria-live="polite">
          {message.tone === "error" ? <CircleAlert className="mr-1.5 inline size-3.5" aria-hidden="true" /> : null}
          {message.text}
        </p>
      ) : null}

      {state === "loading" ? (
        <div className="flex items-center gap-2 px-4 py-5 text-xs text-zinc-400 sm:px-5" role="status">
          <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> Checking saved contact status…
        </div>
      ) : state === "unavailable" ? (
        <div className="px-4 py-5 text-xs text-zinc-300 sm:px-5">
          <p>Contact status could not be confirmed. Do not contact this business until the saved status can be checked.</p>
          <button type="button" onClick={() => void loadStop()} className="v2-focus-ring mt-3 inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-white/[0.1] px-3 font-semibold text-zinc-200 hover:border-white/[0.2]">
            <RefreshCw className="size-3.5" aria-hidden="true" /> Try again
          </button>
        </div>
      ) : stop ? (
        <div className="px-4 py-5 sm:px-5" role="status" aria-live="polite">
          <p className="flex items-center gap-2 text-sm font-semibold text-rose-100"><AlertTriangle className="size-4 shrink-0" aria-hidden="true" /> Contact stopped</p>
          <dl className="mt-3 grid gap-3 text-xs sm:grid-cols-[minmax(140px,0.45fr)_minmax(0,1fr)]">
            <dt className="font-semibold text-zinc-400">Reason</dt>
            <dd className="text-zinc-100">{readableReason(stop.reason)}</dd>
            <dt className="font-semibold text-zinc-400">Owner note</dt>
            <dd className="whitespace-pre-wrap break-words text-zinc-200">{stop.note}</dd>
            <dt className="font-semibold text-zinc-400">Recorded</dt>
            <dd className="text-zinc-300"><time dateTime={stop.createdAt}>{formatDateTime(stop.createdAt)}</time></dd>
          </dl>
        </div>
      ) : (
        <form onSubmit={submitStop} className="grid gap-4 px-4 py-4 sm:px-5">
          <p className="text-xs leading-5 text-zinc-300">No owner stop is currently recorded. Choose a reason and leave a note to permanently add a local do-not-contact record.</p>
          <div className="grid gap-3 sm:grid-cols-[minmax(180px,0.55fr)_minmax(0,1fr)] sm:items-start">
            <label className="grid gap-1.5 text-xs font-semibold text-zinc-300">
              Reason
              <select value={reason} onChange={(event) => setReason(event.target.value as StopReason | "")} required disabled={pending} className="v2-focus-ring min-h-10 rounded-lg border border-white/[0.1] bg-[#111318] px-3 text-sm text-white">
                <option value="" disabled>Select a reason</option>
                <option value="OWNER_DECISION">Owner decision</option>
                <option value="PROSPECT_REQUEST">Prospect requested no contact</option>
                <option value="OTHER">Other</option>
              </select>
            </label>
            <label className="grid gap-1.5 text-xs font-semibold text-zinc-300">
              Note
              <textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} required disabled={pending} rows={3} placeholder="Record the context for this contact stop" className="v2-focus-ring min-h-24 resize-y rounded-lg border border-white/[0.1] bg-black/20 px-3 py-2 text-sm font-normal leading-5 text-white placeholder:text-zinc-600" />
            </label>
          </div>
          <div className="rounded-lg border border-amber-300/20 bg-amber-300/[0.05] px-3 py-2.5 text-xs leading-5 text-amber-100">
            <p className="font-semibold">This action adds an irreversible local record.</p>
            <p className="mt-0.5 text-amber-100/80">There is no resume control here. Confirm the reason and note before saving. If a save response is uncertain, retry the unchanged command.</p>
          </div>
          <button type="submit" disabled={pending || state !== "ready" || !reason || !note.trim()} className="v2-focus-ring inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-lg border border-rose-300/25 bg-rose-300/[0.08] px-4 text-xs font-semibold text-rose-100 hover:bg-rose-300/[0.14] disabled:opacity-50 sm:w-fit">
            {pending ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" /> : <ShieldAlert className="size-3.5" aria-hidden="true" />}
            {pending ? "Saving contact stop…" : "Record do not contact"}
          </button>
          {pending ? <p className="sr-only" role="status">Saving do not contact record…</p> : null}
        </form>
      )}
    </section>
  );
}
