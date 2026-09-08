"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";

const pageSchema = z.object({
  source: z.literal("SAVED_OUTBOUND_ONLY"),
  records: z.array(z.object({
    intentId: z.string().regex(/^[a-f0-9]{64}$/), mailboxId: z.string().min(1).max(256),
    state: z.enum(["SENT", "UNKNOWN", "DISPATCHING", "REJECTED"]),
    from: z.string().max(254), to: z.string().max(254), subject: z.string().max(200),
    bodyPlain: z.string().max(131072), recordedAt: z.number().int().nonnegative().max(8640000000000),
  }).strict()).max(5),
  nextCursor: z.string().max(81).regex(/^(0|[1-9][0-9]{0,15})\.[a-f0-9]{64}$/).nullable(),
}).strict();
type HistoryPage = z.infer<typeof pageSchema>;
type Props = { leadId: number; leadName: string; leadEmail: string | null };

const states = {
  SENT: { title: "Accepted by mail service", detail: "Acceptance is recorded. This is not confirmation of inbox delivery.", color: "text-emerald-300" },
  UNKNOWN: { title: "Delivery uncertain", detail: "The outcome is unresolved. Do not send this message again.", color: "text-amber-300" },
  DISPATCHING: { title: "Delivery uncertain", detail: "An attempt was recorded without a final result. Do not send this message again.", color: "text-amber-300" },
  REJECTED: { title: "Rejected by mail service", detail: "A rejection was recorded. This page will not retry it.", color: "text-rose-300" },
} as const;
const buttonClass = "rounded-lg border border-white/20 px-3 py-2 text-sm text-zinc-200 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-300 disabled:opacity-50";

/** Keyed by client so a prop change cannot display the previous client's mail,
 * even for the frame before effects run. No hidden legacy composer or inbox sync. */
export function EmailThreadPanel(props: Props) {
  return <SavedHistory key={props.leadId} leadId={props.leadId} leadName={props.leadName} />;
}

function SavedHistory({ leadId, leadName }: Pick<Props, "leadId" | "leadName">) {
  const [page, setPage] = useState<HistoryPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [cursors, setCursors] = useState<Array<string | null>>([null]);
  const active = useRef<AbortController | null>(null);
  const load = useCallback(async (cursor: string | null, nextCursors: Array<string | null>) => {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    setLoading(true); setError(false); setPage(null);
    try {
      const response = await fetch(`/api/clients/${leadId}/emails${cursor ? "?cursor=" + encodeURIComponent(cursor) : ""}`, {
        signal: controller.signal, cache: "no-store", credentials: "same-origin",
      });
      if (!response.ok) throw new Error("History unavailable");
      const result = pageSchema.parse(await response.json());
      if (controller.signal.aborted) return;
      setPage(result); setCursors(nextCursors);
    } catch {
      if (!controller.signal.aborted) setError(true);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [leadId]);
  useEffect(() => { void load(null, [null]); return () => active.current?.abort(); }, [load]);

  return (
    <section aria-label={`Saved email activity for ${leadName}`} className="min-w-0 rounded-2xl border border-white/10 bg-zinc-950 p-4 text-zinc-200 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-white">Saved email activity</h3>
          <p className="mt-1 max-w-xl text-sm text-zinc-400">Recorded outgoing replies only—not a live inbox. Reading this page never contacts a mail service.</p>
        </div>
        <button type="button" className={buttonClass} disabled={loading}
          onClick={() => void load(cursors[cursors.length - 1], cursors)}>Refresh saved records</button>
      </div>
      <p className="my-4 rounded-xl border border-violet-300/20 bg-violet-300/5 p-3 text-sm text-violet-200">
        Read-only during the rebuild. Reply approval and incoming-mail integration are not ready.
        Legacy emails are not automatically imported into this view.
      </p>
      <div aria-live="polite" aria-atomic="true" className="text-sm text-zinc-300">
        {loading ? "Loading saved records…" : error ? "Saved records could not be loaded. No mailbox was contacted." :
          page?.records.length ? `Page ${cursors.length} · ${page.records.length} saved records` :
          "No saved outgoing replies for this client. This does not mean their inbox is empty."}
      </div>
      {error && <button type="button" className={buttonClass + " mt-3"}
        onClick={() => void load(cursors[cursors.length - 1], cursors)}>Try reading again</button>}
      {page && <ol className="mt-4 space-y-3" aria-label="Saved outgoing replies">
        {page.records.map(record => {
          const state = states[record.state];
          return <li key={record.intentId} className="min-w-0 rounded-xl border border-white/10 bg-zinc-900/50 p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <h4 className="min-w-0 break-words text-base font-medium text-white">{record.subject}</h4>
              <span className={"text-sm font-medium " + state.color}>{state.title}</span>
            </div>
            <p className="mt-2 text-sm text-zinc-300">{state.detail}</p>
            <dl className="mt-3 grid min-w-0 gap-1 text-sm text-zinc-400">
              <div className="break-all"><dt className="inline text-zinc-300">From: </dt><dd className="inline">{record.from}</dd></div>
              <div className="break-all"><dt className="inline text-zinc-300">To: </dt><dd className="inline">{record.to}</dd></div>
              <div><dt className="inline text-zinc-300">Recorded: </dt><dd className="inline"><time dateTime={new Date(record.recordedAt * 1000).toISOString()}>
                {new Intl.DateTimeFormat("en-CA", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Toronto" }).format(record.recordedAt * 1000)} ET
              </time></dd></div>
            </dl>
            <details className="mt-3">
              <summary className="cursor-pointer rounded text-sm text-violet-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-300">View exact saved message</summary>
              <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-relaxed text-zinc-200">{record.bodyPlain}</p>
              <p className="mt-3 break-all text-xs text-zinc-400">Reply reference: {record.intentId}</p>
            </details>
          </li>;
        })}
      </ol>}
      {page && <nav aria-label="Saved email pages" className="mt-4 flex flex-wrap gap-2">
        <button type="button" className={buttonClass} disabled={loading || cursors.length < 2}
          onClick={() => { const prior = cursors.slice(0, -1); void load(prior[prior.length - 1], prior); }}>Newer records</button>
        <button type="button" className={buttonClass} disabled={loading || !page.nextCursor}
          onClick={() => { if (page.nextCursor) void load(page.nextCursor, [...cursors, page.nextCursor]); }}>Older records</button>
      </nav>}
    </section>
  );
}
