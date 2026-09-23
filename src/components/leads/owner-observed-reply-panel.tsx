"use client";

import { CircleAlert, LoaderCircle, MessageSquareText, Plus, RefreshCw } from "lucide-react";
import * as React from "react";

type Owner = "RILEY" | "AIDAN";
type ReplyCategory = "INTEREST" | "QUESTION" | "NEGATIVE" | "REFERRAL" | "OUT_OF_OFFICE" | "OTHER";
type ReplyStatus = {
  replyId: string;
  businessId: string;
  contactPointId: string;
  category: ReplyCategory;
  summary: string;
  observedAt: string;
  owner: Owner;
  action: string;
  dueAt: string;
  taskId: string | null;
  status: string;
  createdAt: string;
};

export type OwnerObservedReplyContact = {
  contactPointId: string;
  businessId: string;
  channel: string;
  label: string | null;
  value: string;
};

type PanelState = "loading" | "ready" | "unavailable";
const CATEGORIES: { value: ReplyCategory; label: string }[] = [
  { value: "INTEREST", label: "Interested" },
  { value: "QUESTION", label: "Question" },
  { value: "NEGATIVE", label: "Not interested" },
  { value: "REFERRAL", label: "Referral" },
  { value: "OUT_OF_OFFICE", label: "Out of office" },
  { value: "OTHER", label: "Other" },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isDate(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "" && Number.isFinite(Date.parse(value));
}

function parseReply(value: unknown, businessId: string): ReplyStatus {
  if (!isRecord(value)
    || typeof value.replyId !== "string" || !value.replyId.trim()
    || value.businessId !== businessId
    || typeof value.contactPointId !== "string" || !value.contactPointId.trim()
    || !CATEGORIES.some(({ value: category }) => category === value.category)
    || typeof value.summary !== "string" || !value.summary.trim()
    || !isDate(value.observedAt)
    || (value.owner !== "RILEY" && value.owner !== "AIDAN")
    || typeof value.action !== "string" || !value.action.trim()
    || !isDate(value.dueAt)
    || typeof value.taskId !== "string" || !value.taskId.trim()
    || (value.status !== "OPEN" && value.status !== "COMPLETED" && value.status !== "CANCELLED")
    || !isDate(value.createdAt)) {
    throw new Error("A saved reply could not be read for this business.");
  }
  return {
    replyId: value.replyId,
    businessId,
    contactPointId: value.contactPointId,
    category: value.category as ReplyCategory,
    summary: value.summary,
    observedAt: value.observedAt,
    owner: value.owner,
    action: value.action,
    dueAt: value.dueAt,
    taskId: value.taskId,
    status: value.status,
    createdAt: value.createdAt,
  };
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
    timeZone: "America/Toronto", timeZoneName: "short",
  }).format(new Date(value));
}

function torontoDateTimeToIso(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const target = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]));
  const formatter = new Intl.DateTimeFormat("en-CA", {
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "America/Toronto",
  });
  let candidate = target;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(candidate)).map(({ type, value: part }) => [type, part]));
    candidate += target - Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute));
  }
  const parts = Object.fromEntries(formatter.formatToParts(new Date(candidate)).map(({ type, value: part }) => [type, part]));
  return Number(parts.year) === Number(match[1]) && Number(parts.month) === Number(match[2]) && Number(parts.day) === Number(match[3])
    && Number(parts.hour) === Number(match[4]) && Number(parts.minute) === Number(match[5]) ? new Date(candidate).toISOString() : null;
}

function localDateTimeValue() {
  const date = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}`;
}

function readable(value: string) {
  return value.toLowerCase().replaceAll("_", " ").replace(/(^|\s)\S/g, (part) => part.toUpperCase());
}

function errorMessage(value: unknown, fallback: string) {
  return isRecord(value) && typeof value.error === "string" && value.error.trim() ? value.error : fallback;
}

export function OwnerObservedReplyPanel({ businessId, stopState, contactPoints }: {
  businessId: string;
  stopState: "CLEAR" | "STOPPED" | "UNAVAILABLE";
  contactPoints: readonly OwnerObservedReplyContact[];
}) {
  const emailContacts = React.useMemo(() => contactPoints.filter((point) => point.businessId === businessId && point.channel === "EMAIL"), [businessId, contactPoints]);
  const [state, setState] = React.useState<PanelState>("loading");
  const [replies, setReplies] = React.useState<ReplyStatus[]>([]);
  const [expanded, setExpanded] = React.useState(false);
  const [contactPointId, setContactPointId] = React.useState(emailContacts[0]?.contactPointId ?? "");
  const [category, setCategory] = React.useState<ReplyCategory>("INTEREST");
  const [summary, setSummary] = React.useState("");
  const [observedAt, setObservedAt] = React.useState("");
  const [owner, setOwner] = React.useState<Owner>("RILEY");
  const [action, setAction] = React.useState("");
  const [dueAt, setDueAt] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [message, setMessage] = React.useState<{ tone: "error" | "success"; text: string } | null>(null);
  const requestSequence = React.useRef(0);
  const retryKeys = React.useRef(new Map<string, string>());
  const endpoint = `/api/v1/leads/${encodeURIComponent(businessId)}/replies`;

  const load = React.useCallback(async () => {
    const sequence = ++requestSequence.current;
    setState("loading");
    setMessage(null);
    try {
      const response = await fetch(endpoint, { headers: { Accept: "application/json" }, credentials: "same-origin", cache: "no-store" });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(errorMessage(body, "Saved replies are unavailable right now."));
      if (!isRecord(body) || !Array.isArray(body.replies)) throw new Error("The saved reply list could not be read.");
      const next = body.replies.map((reply) => parseReply(reply, businessId));
      if (requestSequence.current !== sequence) return;
      setReplies(next.sort((left, right) => Date.parse(right.observedAt) - Date.parse(left.observedAt)));
      setState("ready");
    } catch (error) {
      if (requestSequence.current !== sequence) return;
      setReplies([]);
      setState("unavailable");
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Saved replies are unavailable right now." });
    }
  }, [businessId, endpoint]);

  React.useEffect(() => {
    setObservedAt(localDateTimeValue());
    void load();
    return () => { requestSequence.current += 1; };
  }, [load]);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const cleanSummary = summary.trim();
    const cleanAction = action.trim();
    const observedIso = torontoDateTimeToIso(observedAt);
    const dueIso = torontoDateTimeToIso(dueAt);
    if (stopState !== "CLEAR" || state !== "ready" || !emailContacts.some((point) => point.contactPointId === contactPointId) || !cleanSummary || cleanSummary.length > 300 || !cleanAction || cleanAction.length > 300 || !observedIso || !dueIso) return;
    const command = { contactPointId, category, summary: cleanSummary, observedAt: observedIso, owner, action: cleanAction, dueAt: dueIso };
    const identity = JSON.stringify({ businessId, ...command });
    const idempotencyKey = retryKeys.current.get(identity) ?? crypto.randomUUID();
    retryKeys.current.set(identity, idempotencyKey);
    setPending(true);
    setMessage(null);
    try {
      const response = await fetch(endpoint, { method: "POST", credentials: "same-origin", headers: { Accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify({ ...command, idempotencyKey }) });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(errorMessage(body, "The reply could not be saved."));
      if (!isRecord(body) || !isRecord(body.reply)) throw new Error("The saved reply could not be verified.");
      const saved = parseReply(body.reply, businessId);
      if (saved.contactPointId !== command.contactPointId || saved.category !== command.category || saved.summary !== command.summary || saved.observedAt !== command.observedAt || saved.owner !== command.owner || saved.action !== command.action || saved.dueAt !== command.dueAt) {
        throw new Error("The saved reply did not match the details entered.");
      }
      setSummary("");
      setAction("");
      await load();
      retryKeys.current.delete(identity);
      setMessage({ tone: "success", text: "Reply saved. Use Owner tasks below to review or complete its next action." });
    } catch (error) {
      setMessage({ tone: "error", text: `${error instanceof Error ? error.message : "The reply could not be saved."} If the save may have reached the server, retry without changing these details to use the same saved key.` });
    } finally {
      setPending(false);
    }
  };

  // A current dossier can omit an older contact while its observed reply is
  // still part of this business's history. Read the ledger before hiding an
  // empty panel, and never offer a new record without a current email route.
  if (emailContacts.length === 0 && state === "ready" && replies.length === 0) return null;
  return <section className="overflow-hidden rounded-2xl border border-[#dfe8e1] bg-white shadow-sm" aria-labelledby="owner-observed-reply-title">
    <header className="flex items-start gap-3 bg-[#f8fbf8] px-4 py-4 sm:px-5">
      <div className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl border border-[#dfe8e1] bg-white text-[#32815b]"><MessageSquareText className="size-4" aria-hidden="true" /></div>
      <div className="min-w-0 flex-1"><h2 id="owner-observed-reply-title" className="text-sm font-semibold text-[#203a2a]">Observed email replies</h2><p className="mt-1 text-xs leading-5 text-[#5d6d62]">Record what you personally received and the next owner action. Do not paste any part of the message.</p></div>
      {stopState === "CLEAR" && emailContacts.length > 0 ? <button type="button" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)} className="v2-focus-ring inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-lg border border-[#dfe8e1] bg-white px-3 text-xs font-semibold text-[#405347] hover:border-[#a8c8ae]">{expanded ? "Close" : <><Plus className="size-3.5" aria-hidden="true" /> Add reply</>}</button> : null}
    </header>
    {stopState !== "CLEAR" ? <p className="border-t border-rose-100 bg-rose-50 px-4 py-2.5 text-xs leading-5 text-rose-900 sm:px-5" role="status">{stopState === "STOPPED" ? "This business is stopped. New reply actions are blocked." : "The business stop status is unavailable. New reply actions are blocked until the saved status can be checked."}</p> : null}
    {message ? <p className={`mx-4 mt-3 rounded-lg border px-3 py-2 text-xs leading-5 sm:mx-5 ${message.tone === "error" ? "border-rose-200 bg-rose-50 text-rose-900" : "border-emerald-200 bg-emerald-50 text-emerald-900"}`} role="status" aria-live="polite">{message.tone === "error" ? <CircleAlert className="mr-1.5 inline size-3.5" aria-hidden="true" /> : null}{message.text}</p> : null}
    {state === "loading" ? <p className="flex items-center gap-2 px-4 py-4 text-xs text-[#617367] sm:px-5" role="status"><LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> Loading saved replies…</p>
      : state === "unavailable" ? <div className="px-4 py-4 text-xs leading-5 text-[#53645b] sm:px-5"><p>Saved replies could not be checked. Try again before relying on this list.</p><button type="button" onClick={() => void load()} className="v2-focus-ring mt-2 inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-[#dfe8e1] bg-white px-3 font-semibold"><RefreshCw className="size-3.5" aria-hidden="true" /> Try again</button></div>
        : replies.length === 0 ? <div className="flex items-center justify-between gap-3 px-4 py-3 sm:px-5"><p className="text-xs text-[#617367]">No replies recorded yet.</p><button type="button" onClick={() => void load()} aria-label="Refresh replies" className="v2-focus-ring grid size-9 shrink-0 place-items-center rounded-lg border border-[#dfe8e1] text-[#405347]"><RefreshCw className="size-3.5" aria-hidden="true" /></button></div>
          : <><ul className="divide-y divide-[#edf0eb]" aria-label="Saved email replies">{replies.map((reply) => {
            const contact = emailContacts.find((point) => point.contactPointId === reply.contactPointId);
            return <li key={reply.replyId} className="px-4 py-3 sm:px-5"><div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1"><p className="text-xs font-semibold text-[#405347]">{readable(reply.category)}{contact ? ` · ${contact.label?.trim() || contact.value}` : " · Saved email contact"}</p><time className="text-[11px] text-[#617367]" dateTime={reply.observedAt}>{formatDateTime(reply.observedAt)}</time></div><p className="mt-1 break-words text-sm leading-5 text-[#263b2d]">{reply.summary}</p><p className="mt-1 text-xs text-[#617367]">Next: {reply.action} · {reply.owner === "RILEY" ? "Riley" : "Aidan"} · Due {formatDateTime(reply.dueAt)} · {readable(reply.status)}</p><p className="mt-1 text-[11px] text-[#617367]">{reply.taskId ? "This action is in Owner tasks. Use that section to review or complete it." : "No linked owner task is available."}</p></li>;
          })}</ul><div className="flex justify-end border-t border-[#edf0eb] px-4 py-2 sm:px-5"><button type="button" onClick={() => void load()} disabled={pending} className="v2-focus-ring inline-flex min-h-8 items-center gap-1.5 rounded-lg px-2 text-xs font-semibold text-[#405347] hover:bg-[#f4f8f3] disabled:opacity-50"><RefreshCw className="size-3.5" aria-hidden="true" /> Refresh</button></div></>}
    {expanded && stopState === "CLEAR" && emailContacts.length > 0 ? <form onSubmit={submit} className="grid gap-3 border-t border-[#edf0eb] bg-[#fbfcfa] p-4 sm:grid-cols-2 sm:p-5">
      <label className="grid gap-1.5 text-xs font-semibold text-[#405347] sm:col-span-2">Email contact<select value={contactPointId} onChange={(event) => setContactPointId(event.target.value)} required disabled={pending} className="v2-focus-ring min-h-10 rounded-lg border border-[#d5dfd6] bg-white px-3 text-sm font-normal text-[#263b2d]">{emailContacts.map((point) => <option key={point.contactPointId} value={point.contactPointId}>{point.value} · {point.label?.trim() || "Email contact"}</option>)}</select></label>
      <label className="grid gap-1.5 text-xs font-semibold text-[#405347]">Reply type<select value={category} onChange={(event) => setCategory(event.target.value as ReplyCategory)} disabled={pending} className="v2-focus-ring min-h-10 rounded-lg border border-[#d5dfd6] bg-white px-3 text-sm font-normal text-[#263b2d]">{CATEGORIES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
      <label className="grid gap-1.5 text-xs font-semibold text-[#405347]">When received (Toronto)<input type="datetime-local" value={observedAt} onChange={(event) => setObservedAt(event.target.value)} required disabled={pending} className="v2-focus-ring min-h-10 rounded-lg border border-[#d5dfd6] bg-white px-3 text-sm font-normal text-[#263b2d]" /></label>
      <label className="grid gap-1.5 text-xs font-semibold text-[#405347] sm:col-span-2">Short factual summary<textarea value={summary} onChange={(event) => setSummary(event.target.value)} maxLength={300} required disabled={pending} rows={2} placeholder="For example: Asked for a call next week" className="v2-focus-ring min-h-16 resize-y rounded-lg border border-[#d5dfd6] bg-white px-3 py-2 text-sm font-normal leading-5 text-[#263b2d] placeholder:text-[#87968b]" /><span className="font-normal text-[#617367]">Up to 300 characters. Do not paste any part of the message. Record do-not-contact requests in the email stop control.</span></label>
      <label className="grid gap-1.5 text-xs font-semibold text-[#405347]">Next action<input value={action} onChange={(event) => setAction(event.target.value)} maxLength={300} required disabled={pending} placeholder="For example, call to discuss timing" className="v2-focus-ring min-h-10 rounded-lg border border-[#d5dfd6] bg-white px-3 text-sm font-normal text-[#263b2d] placeholder:text-[#87968b]" /></label>
      <label className="grid gap-1.5 text-xs font-semibold text-[#405347]">Owner<select value={owner} onChange={(event) => setOwner(event.target.value as Owner)} disabled={pending} className="v2-focus-ring min-h-10 rounded-lg border border-[#d5dfd6] bg-white px-3 text-sm text-[#263b2d]"><option value="RILEY">Riley</option><option value="AIDAN">Aidan</option></select></label>
      <label className="grid gap-1.5 text-xs font-semibold text-[#405347] sm:col-span-2">Action due (Toronto)<input type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)} required disabled={pending} className="v2-focus-ring min-h-10 rounded-lg border border-[#d5dfd6] bg-white px-3 text-sm text-[#263b2d]" /></label>
      <div className="flex flex-wrap items-center justify-between gap-3 sm:col-span-2"><p className="text-[11px] leading-4 text-[#617367]">This records your observation and creates a linked owner action. It does not send a reply.</p><button type="submit" disabled={pending || state !== "ready" || !contactPointId || !summary.trim() || !action.trim() || !observedAt || !dueAt} className="v2-focus-ring inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-[#a8c8ae] bg-[#edf7ef] px-4 text-xs font-semibold text-[#285f40] disabled:opacity-50">{pending ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" /> : null}{pending ? "Saving reply…" : "Save reply"}</button></div>
    </form> : null}
  </section>;
}
