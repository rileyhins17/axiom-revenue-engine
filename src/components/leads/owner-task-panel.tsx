"use client";

import { CalendarClock, Check, CircleAlert, LoaderCircle, Plus, RefreshCw, X } from "lucide-react";
import * as React from "react";

type Owner = "RILEY" | "AIDAN";

type OwnerTask = {
  taskId: string;
  businessId: string;
  owner: Owner;
  action: string;
  dueAt: string;
  status: string;
  createdAt: string;
  completedAt?: string;
};

type PanelState = "loading" | "ready" | "unavailable";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseTask(value: unknown, businessId: string): OwnerTask {
  if (!isRecord(value)
    || typeof value.taskId !== "string"
    || value.businessId !== businessId
    || (value.owner !== "RILEY" && value.owner !== "AIDAN")
    || typeof value.action !== "string"
    || typeof value.dueAt !== "string"
    || typeof value.status !== "string"
    || typeof value.createdAt !== "string"
    || (value.completedAt !== undefined && typeof value.completedAt !== "string")) {
    throw new Error("The saved task response was incomplete or did not match this business.");
  }

  return {
    taskId: value.taskId,
    businessId,
    owner: value.owner,
    action: value.action,
    dueAt: value.dueAt,
    status: value.status,
    createdAt: value.createdAt,
    ...(typeof value.completedAt === "string" ? { completedAt: value.completedAt } : {}),
  };
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Invalid date";
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Toronto",
    timeZoneName: "short",
  }).format(date);
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
    const parts = Object.fromEntries(formatter.formatToParts(new Date(candidate)).map(({ type, value: partValue }) => [type, partValue]));
    const represented = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute));
    candidate += target - represented;
  }
  const finalParts = Object.fromEntries(formatter.formatToParts(new Date(candidate)).map(({ type, value: partValue }) => [type, partValue]));
  const matches = Number(finalParts.year) === Number(match[1])
    && Number(finalParts.month) === Number(match[2])
    && Number(finalParts.day) === Number(match[3])
    && Number(finalParts.hour) === Number(match[4])
    && Number(finalParts.minute) === Number(match[5]);
  return matches ? new Date(candidate).toISOString() : null;
}

function readableStatus(status: string) {
  return status.toLowerCase().replaceAll("_", " ").replace(/(^|\s)\S/g, (character) => character.toUpperCase());
}

function isTerminal(status: string) {
  return ["COMPLETED", "CANCELLED"].includes(status.toUpperCase());
}

function errorMessage(value: unknown, fallback: string) {
  if (isRecord(value) && typeof value.error === "string" && value.error.trim()) return value.error;
  return fallback;
}

function sortTasks(tasks: OwnerTask[]) {
  return [...tasks].sort((left, right) => {
    const dueDifference = new Date(left.dueAt).getTime() - new Date(right.dueAt).getTime();
    return Number.isNaN(dueDifference) || dueDifference === 0
      ? new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
      : dueDifference;
  });
}

export function OwnerTaskPanel({ businessId, stopState }: { businessId: string; stopState: "CLEAR" | "STOPPED" | "UNAVAILABLE" }) {
  const [state, setState] = React.useState<PanelState>("loading");
  const [tasks, setTasks] = React.useState<OwnerTask[]>([]);
  const [owner, setOwner] = React.useState<Owner>("RILEY");
  const [action, setAction] = React.useState("");
  const [dueAt, setDueAt] = React.useState("");
  const [pending, setPending] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<{ tone: "error" | "success"; text: string } | null>(null);
  const requestSequence = React.useRef(0);
  const idempotencyKeys = React.useRef(new Map<string, string>());
  const endpoint = `/api/v1/leads/${encodeURIComponent(businessId)}/tasks`;

  const loadTasks = React.useCallback(async () => {
    const sequence = ++requestSequence.current;
    setState("loading");
    setMessage(null);
    try {
      const response = await fetch(endpoint, { headers: { Accept: "application/json" } });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(errorMessage(body, "Saved owner tasks are unavailable right now."));
      if (!isRecord(body) || !Array.isArray(body.tasks)) throw new Error("The saved task list could not be read.");
      const next = body.tasks.map((task) => parseTask(task, businessId));
      if (requestSequence.current !== sequence) return;
      setTasks(sortTasks(next));
      setState("ready");
    } catch (error) {
      if (requestSequence.current !== sequence) return;
      setState("unavailable");
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Saved owner tasks are unavailable right now." });
    }
  }, [businessId, endpoint]);

  React.useEffect(() => {
    void loadTasks();
    return () => { requestSequence.current += 1; };
  }, [loadTasks]);

  const submit = async (payload: Record<string, unknown>, pendingKey: string, commandIdentity: string) => {
    setPending(pendingKey);
    setMessage(null);
    const idempotencyKey = idempotencyKeys.current.get(commandIdentity) ?? crypto.randomUUID();
    idempotencyKeys.current.set(commandIdentity, idempotencyKey);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, idempotencyKey }),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(errorMessage(body, "The task change could not be saved."));
      if (!isRecord(body)) throw new Error("The saved task response could not be read.");
      const task = parseTask(body.task, businessId);
      setTasks((current) => sortTasks([task, ...current.filter((item) => item.taskId !== task.taskId)]));
      if (idempotencyKeys.current.get(commandIdentity) === idempotencyKey) idempotencyKeys.current.delete(commandIdentity);
      setMessage({ tone: "success", text: "Task saved." });
      return true;
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "The task change could not be saved." });
      return false;
    } finally {
      setPending(null);
    }
  };

  const createTask = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (stopState !== "CLEAR") {
      setMessage({ tone: "error", text: "Do not create a new task while this business is stopped or its stop state is unavailable." });
      return;
    }
    const normalizedAction = action.trim();
    const selectedTime = torontoDateTimeToIso(dueAt);
    if (!normalizedAction || !selectedTime) {
      setMessage({ tone: "error", text: "Enter a next action and a valid Toronto due time." });
      return;
    }
    const payload = {
      operation: "CREATE",
      owner,
      action: normalizedAction,
      dueAt: selectedTime,
    };
    const commandIdentity = JSON.stringify({ businessId, ...payload });
    const saved = await submit(payload, "create", commandIdentity);
    if (saved) {
      setAction("");
      setDueAt("");
    }
  };

  const changeTask = async (task: OwnerTask, operation: "COMPLETE" | "CANCEL") => {
    if (operation === "COMPLETE" && stopState !== "CLEAR") {
      setMessage({ tone: "error", text: "Do not complete a task while this business is stopped or its stop state is unavailable. Cancel it if appropriate." });
      return;
    }
    const note = operation === "COMPLETE" ? "Marked complete by owner." : "Cancelled by owner.";
    const commandIdentity = JSON.stringify({ businessId, operation, taskId: task.taskId, note });
    await submit({ operation, taskId: task.taskId, note }, `${operation}:${task.taskId}`, commandIdentity);
  };

  return (
    <section className="rounded-2xl border border-[#dfe8e1] bg-white shadow-sm" aria-labelledby="owner-task-panel-title">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-[#edf0eb] bg-[#f8fbf8] px-4 py-4 sm:px-5">
        <div>
          <div className="flex items-center gap-2">
            <CalendarClock className="size-4 text-[#32815b]" aria-hidden="true" />
            <h2 id="owner-task-panel-title" className="text-sm font-semibold text-[#203a2a]">Owner tasks</h2>
          </div>
          <p className="mt-1 text-xs leading-5 text-[#5d6d62]">Keep the next human action and its due time attached to this business.</p>
        </div>
        <button
          type="button"
          onClick={() => void loadTasks()}
          disabled={state === "loading" || pending !== null}
          className="v2-focus-ring inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-[#dfe8e1] bg-white px-3 text-xs font-semibold text-[#405347] hover:border-[#a8c8ae] hover:bg-[#f8fbf8] disabled:opacity-50"
        >
          <RefreshCw className="size-3.5" aria-hidden="true" /> Refresh
        </button>
      </header>

      {message ? (
        <p className={`mx-4 mt-4 rounded-lg border px-3 py-2 text-xs leading-5 sm:mx-5 ${message.tone === "error" ? "border-rose-200 bg-rose-50 text-rose-900" : "border-emerald-200 bg-emerald-50 text-emerald-900"}`} role="status" aria-live="polite">
          {message.tone === "error" ? <CircleAlert className="mr-1.5 inline size-3.5" aria-hidden="true" /> : <Check className="mr-1.5 inline size-3.5" aria-hidden="true" />}
          {message.text}
        </p>
      ) : null}

      {stopState !== "CLEAR" ? (
        <p className="mx-4 mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs leading-5 text-rose-900 sm:mx-5" role="status">
          {stopState === "STOPPED"
            ? "This business is stopped. Existing tasks remain visible; cancel open tasks that should no longer be done. New tasks and completion are blocked."
            : "Business stop status is unavailable. New tasks and completion are blocked until the saved status can be checked."}
        </p>
      ) : null}

      {state === "loading" ? (
        <div className="flex items-center gap-2 px-4 py-5 text-xs text-[#617367] sm:px-5" role="status">
          <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> Loading saved tasks…
        </div>
      ) : state === "unavailable" ? (
        <div className="px-4 py-5 text-xs leading-5 text-[#53645b] sm:px-5">
          <p>Saved tasks could not be loaded. Try again when the owner-task service is available.</p>
          <button type="button" onClick={() => void loadTasks()} className="v2-focus-ring mt-3 inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-[#dfe8e1] bg-white px-3 font-semibold text-[#405347] hover:border-[#a8c8ae]">
            <RefreshCw className="size-3.5" aria-hidden="true" /> Try again
          </button>
        </div>
      ) : (
        <>
          {tasks.length === 0 ? (
            <p className="px-4 py-5 text-xs text-[#617367] sm:px-5">No saved owner tasks for this business yet.</p>
          ) : (
            <ul className="divide-y divide-[#edf0eb]" aria-label="Saved owner tasks">
              {tasks.map((task) => (
                <li key={task.taskId} className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:px-5">
                  <div className="min-w-0">
                    <p className="break-words text-sm font-medium leading-6 text-[#263b2d]">{task.action}</p>
                    <p className="mt-1 text-xs text-[#617367]">
                      <span className="font-semibold text-[#405347]">{task.owner === "RILEY" ? "Riley" : "Aidan"}</span>
                      <span aria-hidden="true"> · </span>
                      <time dateTime={task.dueAt}>Due {formatDateTime(task.dueAt)}</time>
                      <span aria-hidden="true"> · </span>
                      <span>{readableStatus(task.status)}</span>
                    </p>
                  </div>
                  {!isTerminal(task.status) ? (
                    <div className="flex shrink-0 gap-2">
                      {stopState === "CLEAR" ? (
                        <button type="button" onClick={() => void changeTask(task, "COMPLETE")} disabled={pending !== null} className="v2-focus-ring inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 text-xs font-semibold text-emerald-800 hover:bg-emerald-100 disabled:opacity-50" aria-label={`Complete task: ${task.action}`}>
                          <Check className="size-3.5" aria-hidden="true" /> Complete
                        </button>
                      ) : null}
                      <button type="button" onClick={() => void changeTask(task, "CANCEL")} disabled={pending !== null} className="v2-focus-ring inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-[#dfe8e1] bg-white px-3 text-xs font-semibold text-[#405347] hover:border-rose-300 hover:bg-rose-50 hover:text-rose-800 disabled:opacity-50" aria-label={`Cancel task: ${task.action}`}>
                        <X className="size-3.5" aria-hidden="true" /> Cancel
                      </button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}

          {stopState === "CLEAR" ? <form onSubmit={createTask} className="grid gap-3 border-t border-[#edf0eb] bg-[#fbfcfa] px-4 py-4 sm:grid-cols-[minmax(0,1fr)_140px_210px_auto] sm:items-end sm:px-5">
            <label className="grid gap-1.5 text-xs font-semibold text-[#405347]">
              Next action
              <input value={action} onChange={(event) => setAction(event.target.value)} maxLength={500} required disabled={pending !== null} placeholder="For example, review the website evidence" className="v2-focus-ring min-h-10 rounded-lg border border-[#d5dfd6] bg-white px-3 text-sm font-normal text-[#263b2d] placeholder:text-[#87968b] disabled:bg-[#f3f6f3]" />
            </label>
            <label className="grid gap-1.5 text-xs font-semibold text-[#405347]">
              Owner
              <select value={owner} onChange={(event) => setOwner(event.target.value as Owner)} disabled={pending !== null} className="v2-focus-ring min-h-10 rounded-lg border border-[#d5dfd6] bg-white px-3 text-sm text-[#263b2d] disabled:bg-[#f3f6f3]">
                <option value="RILEY">Riley</option>
                <option value="AIDAN">Aidan</option>
              </select>
            </label>
            <label className="grid gap-1.5 text-xs font-semibold text-[#405347]">
              Due time (Toronto)
              <input type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)} required disabled={pending !== null} className="v2-focus-ring min-h-10 rounded-lg border border-[#d5dfd6] bg-white px-3 text-sm text-[#263b2d] disabled:bg-[#f3f6f3]" />
            </label>
            <button type="submit" disabled={pending !== null || state !== "ready"} className="v2-focus-ring inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-[#a8c8ae] bg-[#edf7ef] px-4 text-xs font-semibold text-[#285f40] hover:bg-[#e1f1e4] disabled:opacity-50">
              {pending === "create" ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" /> : <Plus className="size-3.5" aria-hidden="true" />}
              Save task
            </button>
            <p className="text-[11px] text-[#617367] sm:col-span-4">Due times are entered and shown in America/Toronto. Saving a task records an owner action only.</p>
          </form> : null}
        </>
      )}

      {pending ? <p className="sr-only" role="status">{pending === "create" ? "Saving new task…" : "Saving task update…"}</p> : null}
    </section>
  );
}
