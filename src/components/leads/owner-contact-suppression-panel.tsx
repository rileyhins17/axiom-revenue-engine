"use client";

import { AlertTriangle, CircleAlert, LoaderCircle, RefreshCw, ShieldAlert } from "lucide-react";
import * as React from "react";

export type OwnerContactSuppressionPoint = Readonly<{
  contactPointId: string;
  businessId: string;
  channel: "EMAIL" | "PHONE" | "FORM" | "SOCIAL";
  label: string | null;
  value: string;
}>;
type SuppressionReason = "UNSUBSCRIBE" | "COMPLAINT" | "BOUNCE";
type ContactSuppression = {
  suppressionId: string;
  businessId: string;
  contactPointId: string;
  reason: SuppressionReason;
  note: string;
  actorUserId: string;
  observedAt: string;
  createdAt: string;
};
type PanelState = "loading" | "ready" | "unavailable";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function errorMessage(value: unknown, fallback: string) {
  return isRecord(value) && typeof value.error === "string" && value.error.trim() ? value.error : fallback;
}

function parseSuppression(value: unknown, businessId: string, contactPointId: string): ContactSuppression {
  if (!isRecord(value)
    || typeof value.suppressionId !== "string"
    || value.businessId !== businessId
    || value.contactPointId !== contactPointId
    || (value.reason !== "UNSUBSCRIBE" && value.reason !== "COMPLAINT" && value.reason !== "BOUNCE")
    || typeof value.note !== "string"
    || typeof value.actorUserId !== "string"
    || typeof value.observedAt !== "string"
    || !Number.isFinite(Date.parse(value.observedAt))
    || typeof value.createdAt !== "string"
    || !Number.isFinite(Date.parse(value.createdAt))) {
    throw new Error("The saved email stop could not be verified for this business and contact.");
  }
  return {
    suppressionId: value.suppressionId,
    businessId,
    contactPointId: value.contactPointId,
    reason: value.reason,
    note: value.note,
    actorUserId: value.actorUserId,
    observedAt: value.observedAt,
    createdAt: value.createdAt,
  };
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
    timeZone: "America/Toronto", timeZoneName: "short",
  }).format(new Date(value));
}

function localDateTimeValue(date = new Date()) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function readableReason(reason: SuppressionReason) {
  if (reason === "UNSUBSCRIBE") return "Unsubscribe request";
  if (reason === "COMPLAINT") return "Complaint";
  return "Bounce";
}

function EmailPointRow({ businessId, contact }: { businessId: string; contact: OwnerContactSuppressionPoint }) {
  const [state, setState] = React.useState<PanelState>("loading");
  const [suppression, setSuppression] = React.useState<ContactSuppression | null>(null);
  const [reason, setReason] = React.useState<SuppressionReason>("UNSUBSCRIBE");
  const [note, setNote] = React.useState("");
  const [observedAtLocal, setObservedAtLocal] = React.useState("");
  const [personallyObserved, setPersonallyObserved] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [message, setMessage] = React.useState<{ tone: "error" | "success"; text: string } | null>(null);
  const sequence = React.useRef(0);
  const retryKeys = React.useRef(new Map<string, string>());
  const endpoint = `/api/v1/leads/${encodeURIComponent(businessId)}/contacts/${encodeURIComponent(contact.contactPointId)}/suppressions`;

  const load = React.useCallback(async () => {
    const current = ++sequence.current;
    setState("loading");
    setSuppression(null);
    setMessage(null);
    try {
      const response = await fetch(endpoint, { headers: { Accept: "application/json" }, credentials: "same-origin", cache: "no-store" });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(errorMessage(body, "The saved email stop is unavailable right now."));
      if (!isRecord(body) || !(body.suppression === null || isRecord(body.suppression))) {
        throw new Error("The saved email stop response could not be read.");
      }
      const saved = body.suppression === null ? null : parseSuppression(body.suppression, businessId, contact.contactPointId);
      if (sequence.current !== current) return;
      setSuppression(saved);
      setState("ready");
    } catch (error) {
      if (sequence.current !== current) return;
      setSuppression(null);
      setState("unavailable");
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "The saved email stop is unavailable right now." });
    }
  }, [businessId, contact.contactPointId, endpoint]);

  React.useEffect(() => {
    setObservedAtLocal(localDateTimeValue());
    void load();
    return () => { sequence.current += 1; };
  }, [load]);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const cleanNote = note.trim();
    const observedDate = new Date(observedAtLocal);
    if (state !== "ready" || suppression || !personallyObserved || !cleanNote || !Number.isFinite(observedDate.getTime())) return;
    const command = { reason, note: cleanNote, observedAt: observedDate.toISOString() };
    const identity = JSON.stringify({ businessId, contactPointId: contact.contactPointId, ...command });
    const idempotencyKey = retryKeys.current.get(identity) ?? crypto.randomUUID();
    retryKeys.current.set(identity, idempotencyKey);
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
      if (!response.ok) throw new Error(errorMessage(body, "The email stop could not be saved."));
      if (!isRecord(body) || !isRecord(body.suppression)) throw new Error("The saved email stop could not be verified.");
      const posted = parseSuppression(body.suppression, businessId, contact.contactPointId);
      if (posted.contactPointId !== contact.contactPointId || posted.suppressionId !== `contact-suppression:${idempotencyKey}` || posted.reason !== command.reason ||
          posted.note !== command.note || posted.observedAt !== command.observedAt) {
        throw new Error("The saved email stop did not match this exact command.");
      }

      // Fetch the resource again explicitly before showing the stop as saved.
      const readbackResponse = await fetch(endpoint, { headers: { Accept: "application/json" }, credentials: "same-origin", cache: "no-store" });
      const readbackBody: unknown = await readbackResponse.json().catch(() => null);
      if (!readbackResponse.ok || !isRecord(readbackBody) || !isRecord(readbackBody.suppression)) {
        throw new Error("The save may have reached the server, but its current status could not be confirmed.");
      }
      const readback = parseSuppression(readbackBody.suppression, businessId, contact.contactPointId);
      if (readback.suppressionId !== `contact-suppression:${idempotencyKey}` || readback.reason !== command.reason ||
          readback.note !== command.note || readback.observedAt !== command.observedAt) {
        throw new Error("The readback did not match this exact command. The saved status remains uncertain.");
      }
      setSuppression(readback);
      setMessage({ tone: "success", text: "Email stop saved and verified. It applies to this business and matching later email records." });
    } catch (error) {
      setMessage({
        tone: "error",
        text: `${error instanceof Error ? error.message : "The email stop could not be saved."} If the save may have reached the server, refresh status or retry without changing the reason, note, or observed time so the same key is reused.`,
      });
    } finally {
      setPending(false);
    }
  };

  return (
    <article className="rounded-xl border border-[#e4ebe2] bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-[#263b2d]">{contact.label?.trim() || "Email contact"}</p>
          <p className="mt-1 break-all text-sm font-medium text-[#263b2d]">{contact.value}</p>
          <p className="mt-1 text-xs text-[#617367]">Check source in research details.</p>
        </div>
        <button type="button" onClick={() => void load()} disabled={state === "loading" || pending} className="v2-focus-ring inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-[#dfe8e1] bg-white px-3 text-xs font-semibold text-[#405347] hover:border-[#a8c8ae] disabled:opacity-50">
          <RefreshCw className="size-3.5" aria-hidden="true" /> Refresh status
        </button>
      </div>

      {message ? <p className={`mt-3 rounded-lg border px-3 py-2 text-xs leading-5 ${message.tone === "error" ? "border-rose-200 bg-rose-50 text-rose-900" : "border-emerald-200 bg-emerald-50 text-emerald-900"}`} role="status" aria-live="polite">
        {message.tone === "error" ? <CircleAlert className="mr-1.5 inline size-3.5" aria-hidden="true" /> : null}{message.text}
      </p> : null}

      {state === "loading" ? <div className="mt-4 flex items-center gap-2 text-xs text-[#617367]" role="status"><LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> Checking saved email status…</div>
        : state === "unavailable" ? <div className="mt-4 text-xs leading-5 text-[#45584b]"><p>Contact status could not be confirmed. Pause email contact until it can be checked.</p><button type="button" onClick={() => void load()} className="v2-focus-ring mt-2 inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-[#dfe8e1] bg-white px-3 font-semibold"><RefreshCw className="size-3.5" aria-hidden="true" /> Try again</button></div>
        : suppression ? <div className="mt-4" role="status" aria-live="polite"><p className="flex items-center gap-2 text-sm font-semibold text-rose-800"><AlertTriangle className="size-4" aria-hidden="true" /> Do not email this contact</p><dl className="mt-3 grid gap-x-3 gap-y-1.5 text-xs sm:grid-cols-[110px_1fr]"><dt className="font-semibold text-[#617367]">Reason</dt><dd className="text-[#263b2d]">{readableReason(suppression.reason)}</dd><dt className="font-semibold text-[#617367]">Observation</dt><dd className="whitespace-pre-wrap break-words text-[#405347]">{suppression.note}</dd><dt className="font-semibold text-[#617367]">Observed</dt><dd className="text-[#53645b]"><time dateTime={suppression.observedAt}>{formatDateTime(suppression.observedAt)}</time></dd><dt className="font-semibold text-[#617367]">Recorded</dt><dd className="text-[#53645b]"><time dateTime={suppression.createdAt}>{formatDateTime(suppression.createdAt)}</time></dd></dl><p className="mt-3 text-xs leading-5 text-[#617367]">This stop remains active for this email at this business, including matching later email records.</p></div>
        : <form onSubmit={submit} className="mt-4 grid gap-3">
          <p className="text-xs leading-5 text-[#45584b]">Record a stop only after personally observing an unsubscribe, complaint, or bounce. It is permanent for this email at this business.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1.5 text-xs font-semibold text-[#405347]">Observed event<select value={reason} onChange={(event) => setReason(event.target.value as SuppressionReason)} disabled={pending} className="v2-focus-ring min-h-10 rounded-lg border border-[#d5dfd6] bg-white px-3 text-sm font-normal text-[#263b2d]"><option value="UNSUBSCRIBE">Unsubscribe request</option><option value="COMPLAINT">Complaint</option><option value="BOUNCE">Bounce</option></select></label>
            <label className="grid gap-1.5 text-xs font-semibold text-[#405347]">When did you observe it?<input type="datetime-local" value={observedAtLocal} onChange={(event) => setObservedAtLocal(event.target.value)} required disabled={pending} className="v2-focus-ring min-h-10 rounded-lg border border-[#d5dfd6] bg-white px-3 text-sm font-normal text-[#263b2d]" /></label>
          </div>
          <label className="grid gap-1.5 text-xs font-semibold text-[#405347]">Short observation summary<textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={300} required disabled={pending} rows={2} placeholder="Example: Unsubscribe request received by owner" className="v2-focus-ring min-h-16 resize-y rounded-lg border border-[#d5dfd6] bg-white px-3 py-2 text-sm font-normal leading-5 text-[#263b2d] placeholder:text-[#87968b]" /><span className="font-normal text-[#617367]">Do not paste or include any part of the incoming message.</span></label>
          <label className="flex items-start gap-2 text-xs leading-5 text-[#405347]"><input type="checkbox" checked={personallyObserved} onChange={(event) => setPersonallyObserved(event.target.checked)} disabled={pending} className="v2-focus-ring mt-0.5 size-4 accent-[#315c3b]" /><span>I personally observed this event. I am recording only its type, time, and a short summary; I am not pasting message content.</span></label>
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-950"><p className="break-all font-semibold">This permanently blocks {contact.value} for this business.</p><p className="text-amber-900">Matching later email records inherit the stop. There is no release control in this panel.</p></div>
          <button type="submit" disabled={pending || state !== "ready" || !personallyObserved || !note.trim() || !observedAtLocal} className="v2-focus-ring inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-lg border border-rose-300 bg-rose-50 px-4 text-xs font-semibold text-rose-800 hover:bg-rose-100 disabled:opacity-50 sm:w-fit">{pending ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" /> : <ShieldAlert className="size-3.5" aria-hidden="true" />}{pending ? "Saving email stop…" : "Record do not email"}</button>
        </form>}
    </article>
  );
}

export function OwnerContactSuppressionPanel({ businessId, contactPoints }: { businessId: string; contactPoints: readonly OwnerContactSuppressionPoint[] }) {
  const emailPoints = contactPoints.filter((contact) => contact.businessId === businessId && contact.channel === "EMAIL");
  const [expanded, setExpanded] = React.useState(false);
  const [selectedContactPointId, setSelectedContactPointId] = React.useState("");
  if (emailPoints.length === 0) return null;
  const selectedContact = emailPoints.find((contact) => contact.contactPointId === selectedContactPointId) ?? emailPoints[0]!;
  return <section className="overflow-hidden rounded-2xl border border-[#dfe8e1] bg-[#f8fbf8] shadow-sm" aria-labelledby="owner-contact-suppression-title">
    <header className="flex items-start gap-3 px-4 py-4 sm:px-5"><div className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl border border-rose-200 bg-rose-50 text-rose-700"><ShieldAlert className="size-4" aria-hidden="true" /></div><div className="min-w-0 flex-1"><h2 id="owner-contact-suppression-title" className="text-sm font-semibold text-[#203a2a]">Email do-not-contact records</h2><p className="mt-1 text-xs leading-5 text-[#5d6d62]">Check one saved email contact at a time and record any unsubscribe, complaint, or bounce you personally observed.</p></div><button type="button" aria-expanded={expanded} aria-controls="owner-contact-suppression-content" onClick={() => setExpanded((value) => !value)} className="v2-focus-ring min-h-9 shrink-0 rounded-lg border border-[#dfe8e1] bg-white px-3 text-xs font-semibold text-[#405347] hover:border-[#a8c8ae]">{expanded ? "Close" : `Review ${emailPoints.length} email ${emailPoints.length === 1 ? "contact" : "contacts"}`}</button></header>
    {expanded ? <div id="owner-contact-suppression-content" className="grid gap-3 border-t border-[#e4ebe2] p-4 sm:p-5">
      <label className="grid max-w-xl gap-1.5 text-xs font-semibold text-[#405347]">Email contact to review<select value={selectedContact.contactPointId} onChange={(event) => setSelectedContactPointId(event.target.value)} className="v2-focus-ring min-h-10 rounded-lg border border-[#d5dfd6] bg-white px-3 text-sm font-normal text-[#263b2d]">{emailPoints.map((contact) => <option key={contact.contactPointId} value={contact.contactPointId}>{contact.value} · {contact.label?.trim() || "No saved label"}</option>)}</select></label>
      <p className="text-xs leading-5 text-[#617367]">Only the selected email contact is checked. The other {emailPoints.length - 1} {emailPoints.length - 1 === 1 ? "contact remains" : "contacts remain"} unchecked until selected. Pause email contact for any point whose status has not been confirmed.</p>
      <EmailPointRow key={selectedContact.contactPointId} businessId={businessId} contact={selectedContact} />
    </div> : null}
  </section>;
}
