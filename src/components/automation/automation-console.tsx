"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import type { ReactNode } from "react";
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Clock3,
  Database,
  Inbox,
  Mail,
  Pause,
  Play,
  Power,
  RefreshCcw,
  ShieldAlert,
} from "lucide-react";
import { useRouter } from "next/navigation";

import { MailboxReactivateButton } from "@/components/mailbox-reactivate-button";
import { SentEmailViewerTrigger } from "@/components/sent-email-viewer";
import { PageHeader } from "@/components/ui/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { AutomationOperatorConsoleData, OperatorMailbox, OperatorNextEmail, OperatorRecentEmail } from "@/lib/automation-operator-view";

type Props = {
  data: AutomationOperatorConsoleData;
};

const TAB_ITEMS = [
  { value: "today", label: "Today" },
  { value: "queue", label: "Queue" },
  { value: "inboxes", label: "Inboxes" },
  { value: "sent", label: "Sent" },
] as const;

type TabValue = (typeof TAB_ITEMS)[number]["value"];

export function AutomationConsole({ data }: Props) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabValue>("today");
  const [refreshing, startRefresh] = useTransition();
  const generatedAt = useMemo(() => new Date(data.generatedAt), [data.generatedAt]);
  const [now, setNow] = useState(() => new Date());

  function refresh() {
    startRefresh(() => router.refresh());
  }

  useEffect(() => {
    const tick = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(tick);
  }, []);

  useEffect(() => {
    const refreshInterval = window.setInterval(() => {
      if (document.visibilityState === "visible" && !refreshing) {
        startRefresh(() => router.refresh());
      }
    }, 30_000);
    return () => window.clearInterval(refreshInterval);
  }, [refreshing, router, startRefresh]);

  return (
    <div className="mx-auto flex w-full max-w-[1540px] flex-col gap-5">
      <PageHeader
        eyebrow="Autonomous execution"
        title="Automation"
        description={data.status.sentence}
        icon={Bot}
        status={
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill tone={data.status.tone} label={data.status.label} />
            <span className="v2-pill"><Clock3 className="size-3.5" />Updated {formatTime(generatedAt)}</span>
          </div>
        }
        actions={
          <button
            type="button"
            onClick={refresh}
            disabled={refreshing}
            className="v2-btn-ghost v2-focus-ring inline-flex h-10 items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
          >
            <RefreshCcw className={`size-4 ${refreshing ? "animate-spin" : ""}`} />
            Refresh
          </button>
        }
        metrics={[
          { label: "Sent today", value: data.metrics.sentToday, detail: "across inboxes", tone: "positive" },
          { label: "Capacity left", value: data.metrics.leftToday, detail: "before daily caps" },
          { label: "Next send", value: formatDue(data.metrics.nextSendAt, now), detail: formatDateTime(data.metrics.nextSendAt), tone: "info" },
          { label: "Inboxes ready", value: `${data.metrics.inboxesReady}/${data.metrics.inboxesTotal}`, detail: readyDetail(data.mailboxes) },
        ]}
      />

      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as TabValue)} className="gap-5">
        <div className="-mx-3 overflow-x-auto px-3 sm:mx-0 sm:px-0">
          <TabsList className="min-w-max">
            {TAB_ITEMS.map((tab) => (
              <TabsTrigger key={tab.value} value={tab.value} className="h-11 shrink-0 px-4">
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <TabsContent value="today" className="mt-0">
          <TodayPanel data={data} now={now} setTab={setActiveTab} />
        </TabsContent>

        <TabsContent value="queue" className="mt-0">
          <QueuePanel data={data} now={now} />
        </TabsContent>

        <TabsContent value="inboxes" className="mt-0">
          <InboxPanel data={data} now={now} />
        </TabsContent>

        <TabsContent value="sent" className="mt-0">
          <SentPanel emails={data.recentSent} now={now} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function TodayPanel({
  data,
  now,
  setTab,
}: {
  data: AutomationOperatorConsoleData;
  now: Date;
  setTab: (tab: TabValue) => void;
}) {
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="space-y-5">
        <Panel
          title="Next emails"
          icon={<Mail className="size-4" />}
          action={
            <button
              type="button"
              onClick={() => setTab("queue")}
              className="text-sm font-medium text-emerald-200 transition hover:text-emerald-100"
            >
              View queue
            </button>
          }
        >
          <NextEmailList emails={data.nextEmails} now={now} />
        </Panel>
      </div>

      <aside className="space-y-5">
        {data.actions.length > 0 ? (
          <Panel title="Action needed" icon={<AlertTriangle className="size-4" />} tone="amber">
            <div className="space-y-3">
              {data.actions.slice(0, 4).map((action) => (
                <div key={action.id} className="rounded-lg border border-amber-400/18 bg-amber-400/[0.055] p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-medium text-amber-100">{action.label}</div>
                      <div className="mt-1 text-sm leading-5 text-amber-100/70">{action.detail}</div>
                    </div>
                    <span className="rounded-md border border-amber-400/20 bg-amber-400/[0.08] px-2 py-1 text-xs font-semibold tabular-nums text-amber-100">
                      {action.count}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        ) : null}

        <EmergencyStopPanel data={data} />
        <IntakePanel data={data} />
      </aside>
    </div>
  );
}

function QueuePanel({ data, now }: { data: AutomationOperatorConsoleData; now: Date }) {
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
      <Panel title="Waiting to send" icon={<Clock3 className="size-4" />}>
        <NextEmailList emails={data.nextEmails} now={now} />
      </Panel>

      <Panel title="Queue summary" icon={<Inbox className="size-4" />}>
        <div className="space-y-3">
          <SummaryRow label="Waiting to send" value={data.queue.waitingToSend} />
          <SummaryRow label="Sending now" value={data.queue.sendingNow} />
          <SummaryRow label="Needs attention" value={data.metrics.actionNeeded} />
          <div className="border-t border-white/[0.06] pt-3">
            <div className="text-xs font-medium uppercase tracking-normal text-zinc-500">Raw counts</div>
            <div className="mt-2 grid gap-2 text-sm text-zinc-400">
              <SummaryRow label="Active sequences" value={data.queue.queuedSequences} muted />
              <SummaryRow label="Scheduled steps" value={data.queue.scheduledRawSteps} muted />
              <SummaryRow label="Blocked/paused" value={data.queue.blocked} muted />
            </div>
          </div>
        </div>
      </Panel>
    </div>
  );
}

function InboxPanel({ data, now }: { data: AutomationOperatorConsoleData; now: Date }) {
  return (
    <Panel title="Inboxes" icon={<Inbox className="size-4" />}>
      <div className="divide-y divide-white/[0.06]">
        {data.mailboxes.map((mailbox) => (
          <MailboxRow key={mailbox.id} mailbox={mailbox} now={now} />
        ))}
        {data.mailboxes.length === 0 ? <EmptyMessage title="No inboxes found" detail="Connect Gmail in Settings before automation can send." /> : null}
      </div>
    </Panel>
  );
}

function SentPanel({ emails, now }: { emails: OperatorRecentEmail[]; now: Date }) {
  return (
    <Panel title="Recently sent" icon={<CheckCircle2 className="size-4" />}>
      <div className="divide-y divide-white/[0.06]">
        {emails.map((email) => (
          <SentEmailViewerTrigger key={email.id} emailId={email.id} className="block w-full text-left transition hover:bg-white/[0.025]">
            <div className="grid gap-2 px-4 py-4 md:grid-cols-[minmax(0,1fr)_220px] md:items-center md:px-5">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-white">{email.subject}</div>
                <div className="mt-1 flex min-w-0 flex-col gap-1 text-sm text-zinc-400 sm:flex-row sm:items-center sm:gap-2">
                  <span className="truncate">{email.businessName || email.recipientEmail}</span>
                  <span className="hidden text-zinc-600 sm:inline">/</span>
                  <span className="truncate font-mono text-xs">{email.recipientEmail}</span>
                </div>
              </div>
              <div className="text-left text-xs text-zinc-500 md:text-right">
                <div>{formatAgo(email.sentAt, now)}</div>
                <div className="mt-1 truncate font-mono">{email.senderEmail}</div>
              </div>
            </div>
          </SentEmailViewerTrigger>
        ))}
        {emails.length === 0 ? <EmptyMessage title="No sent emails yet" detail="Sent emails will appear here after the next successful send." /> : null}
      </div>
    </Panel>
  );
}

function NextEmailList({ emails, now }: { emails: OperatorNextEmail[]; now: Date }) {
  if (emails.length === 0) {
    return <EmptyMessage title="No emails waiting" detail="The queue is clear right now." />;
  }

  return (
    <div className="divide-y divide-white/[0.06]">
      {emails.map((email, index) => (
        <div key={email.id} className="grid gap-3 px-4 py-4 md:grid-cols-[40px_minmax(0,1fr)_180px] md:items-center md:px-5">
          <div className="hidden size-9 place-items-center rounded-lg border border-white/[0.08] bg-white/[0.035] text-sm font-semibold tabular-nums text-zinc-300 md:grid">
            {index + 1}
          </div>
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h3 className="min-w-0 truncate text-base font-semibold text-white">{email.businessName}</h3>
              <span className="rounded-md border border-emerald-400/20 bg-emerald-400/[0.08] px-2 py-1 text-xs font-medium text-emerald-200">
                {stepLabel(email.stepType)}
              </span>
            </div>
            <div className="mt-1 flex min-w-0 flex-col gap-1 text-sm text-zinc-400 sm:flex-row sm:items-center sm:gap-2">
              <span className="truncate">{[email.niche, email.city].filter(Boolean).join(" / ") || "Local service business"}</span>
              <span className="hidden text-zinc-600 sm:inline">/</span>
              <span className="truncate font-mono text-xs">{email.recipientEmail || "No email on row"}</span>
            </div>
          </div>
          <div className="text-left md:text-right">
            <div className="text-sm font-semibold text-zinc-100">{formatDue(email.effectiveSendAt ?? email.scheduledFor, now)}</div>
            <div className={email.queueState === "unassigned" ? "mt-1 text-xs font-medium text-amber-300" : "mt-1 text-xs font-medium text-zinc-400"}>
              {email.queueStateLabel}
            </div>
            <div className="mt-1 truncate text-xs text-zinc-500">{formatDateTime(email.effectiveSendAt ?? email.scheduledFor)}</div>
            <div className="mt-1 truncate font-mono text-xs text-zinc-500">{email.senderEmail || "Inbox assigned at send"}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function MailboxRow({ mailbox, now }: { mailbox: OperatorMailbox; now: Date }) {
  const attention = mailbox.stateLabel === "Needs reconnect" || mailbox.stateLabel === "Paused";
  return (
    <div className="grid gap-3 px-4 py-4 md:grid-cols-[minmax(0,1fr)_260px_180px] md:items-center md:px-5">
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className={`inline-flex size-2.5 rounded-full ${mailbox.readyNow ? "bg-emerald-400" : attention ? "bg-amber-300" : "bg-zinc-500"}`} />
          <h3 className="truncate text-sm font-semibold text-white">{mailbox.gmailAddress}</h3>
          <span className={`rounded-md border px-2 py-1 text-xs font-medium ${mailbox.readyNow ? "border-emerald-400/20 bg-emerald-400/[0.08] text-emerald-200" : attention ? "border-amber-400/20 bg-amber-400/[0.08] text-amber-200" : "border-white/[0.08] bg-white/[0.025] text-zinc-300"}`}>
            {mailbox.stateLabel}
          </span>
        </div>
        <div className="mt-2 text-sm text-zinc-400">
          {mailbox.sentToday}/{mailbox.dailyLimit} today, {mailbox.sentThisHour}/{mailbox.hourlyLimit} this hour
        </div>
      </div>

      <div className="text-sm text-zinc-400">
        <div>Next available: <span className="text-zinc-200">{formatAvailable(mailbox.nextAvailableAt, now)}</span></div>
        <div className="mt-1">Last sent: <span className="text-zinc-300">{formatAgo(mailbox.lastSentAt, now)}</span></div>
      </div>

      <div className="flex justify-start md:justify-end">
        {attention ? <MailboxReactivateButton mailboxId={mailbox.id} gmailAddress={mailbox.gmailAddress} /> : null}
      </div>
    </div>
  );
}

function EmergencyStopPanel({ data }: { data: AutomationOperatorConsoleData }) {
  const router = useRouter();
  const [state, setState] = useState(data.settings.emergencyPaused);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    const nextPaused = !state;
    const confirmed = window.confirm(
      nextPaused
        ? "Engage the emergency stop and halt intake, queueing, and sending?"
        : "Clear the emergency stop and let automation resume on the next cron tick?",
    );
    if (!confirmed) return;

    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/outreach/automation/emergency", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paused: nextPaused }),
      });
      const payload = (await response.json().catch(() => ({}))) as { emergencyPaused?: boolean; error?: string };
      if (!response.ok) throw new Error(payload.error || "Emergency stop update failed");
      setState(Boolean(payload.emergencyPaused));
      router.refresh();
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Emergency stop update failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <Panel title="Emergency stop" icon={<ShieldAlert className="size-4" />} tone={state ? "red" : "neutral"}>
      <div className="space-y-4">
        <p className="text-sm leading-6 text-zinc-400">
          {state ? "Automation is stopped across intake, queueing, and sending." : "Use only when sending must stop immediately."}
        </p>
        <button
          type="button"
          onClick={toggle}
          disabled={pending}
          className={`inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg border px-4 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${
            state
              ? "border-emerald-400/35 bg-emerald-400/[0.12] text-emerald-100 hover:bg-emerald-400/[0.18]"
              : "border-red-400/35 bg-red-500/[0.12] text-red-100 hover:bg-red-500/[0.2]"
          }`}
        >
          <Power className="size-4" />
          {state ? "Clear stop" : "Stop everything"}
        </button>
        {error ? <div className="text-sm text-red-300">{error}</div> : null}
      </div>
    </Panel>
  );
}

function IntakePanel({ data }: { data: AutomationOperatorConsoleData }) {
  const router = useRouter();
  const [paused, setPaused] = useState(data.settings.intakePaused);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    const nextPaused = !paused;
    const confirmed = window.confirm(
      nextPaused
        ? "Pause lead intake? Email sending will continue normally."
        : "Resume lead intake? The system will start scraping for new leads again.",
    );
    if (!confirmed) return;

    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/outreach/automation/intake-pause", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paused: nextPaused }),
      });
      const payload = (await response.json().catch(() => ({}))) as { intakePaused?: boolean; error?: string };
      if (!response.ok) throw new Error(payload.error || "Intake update failed");
      setPaused(Boolean(payload.intakePaused));
      router.refresh();
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Intake update failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <Panel title="Lead intake" icon={<Database className="size-4" />}>
      <div className="space-y-4">
        <p className="text-sm leading-6 text-zinc-400">
          {paused ? "New lead scraping is paused. Sending still runs." : "New lead scraping is active. Sending runs separately."}
        </p>
        <button
          type="button"
          onClick={toggle}
          disabled={pending}
          className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-white/[0.1] bg-white/[0.035] px-4 text-sm font-semibold text-zinc-200 transition hover:border-white/[0.18] hover:bg-white/[0.07] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {paused ? <Play className="size-4" /> : <Pause className="size-4" />}
          {paused ? "Resume intake" : "Pause intake"}
        </button>
        {error ? <div className="text-sm text-red-300">{error}</div> : null}
      </div>
    </Panel>
  );
}

function Panel({
  title,
  icon,
  children,
  action,
  tone = "neutral",
}: {
  title: string;
  icon: ReactNode;
  children: ReactNode;
  action?: ReactNode;
  tone?: "neutral" | "amber" | "red";
}) {
  const toneClass =
    tone === "amber"
      ? "border-amber-400/24 bg-amber-400/[0.035]"
      : tone === "red"
        ? "border-red-400/24 bg-red-500/[0.035]"
        : "border-white/[0.08] bg-[#0a111c]/80";

  return (
    <section className={`overflow-hidden rounded-lg border ${toneClass}`}>
      <div className="flex min-h-14 items-center justify-between gap-3 border-b border-white/[0.06] px-4 py-3 sm:px-5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-white/[0.08] bg-white/[0.035] text-zinc-300">
            {icon}
          </span>
          <h2 className="truncate text-sm font-semibold text-white">{title}</h2>
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      {children}
    </section>
  );
}

function StatusPill({ tone, label }: { tone: string; label: string }) {
  const className =
    tone === "running"
      ? "border-emerald-400/30 bg-emerald-400/[0.1] text-emerald-200"
      : tone === "action"
        ? "border-amber-400/30 bg-amber-400/[0.1] text-amber-200"
        : tone === "stopped"
          ? "border-red-400/30 bg-red-400/[0.1] text-red-200"
          : "border-white/[0.1] bg-white/[0.04] text-zinc-200";

  return (
    <span className={`v2-pill ${className}`}>
      <CheckCircle2 className="size-3.5" />
      {label}
    </span>
  );
}

function SummaryRow({ label, value, muted = false }: { label: string; value: string | number; muted?: boolean }) {
  return (
    <div className={`flex items-center justify-between gap-3 text-sm ${muted ? "text-zinc-500" : "text-zinc-300"}`}>
      <span>{label}</span>
      <span className="font-mono tabular-nums text-zinc-100">{value}</span>
    </div>
  );
}

function EmptyMessage({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="px-4 py-8 text-center sm:px-5">
      <div className="text-sm font-semibold text-zinc-200">{title}</div>
      <div className="mt-1 text-sm text-zinc-500">{detail}</div>
    </div>
  );
}

function readyDetail(mailboxes: OperatorMailbox[]) {
  const cooling = mailboxes.filter((mailbox) => mailbox.stateLabel === "Cooling down").length;
  if (cooling > 0) return `${cooling} cooling down`;
  const attention = mailboxes.filter((mailbox) => mailbox.stateLabel === "Needs reconnect" || mailbox.stateLabel === "Paused").length;
  if (attention > 0) return `${attention} needs attention`;
  return "Ready to send";
}

function stepLabel(stepType: string) {
  if (stepType === "INITIAL") return "First touch";
  return stepType.replaceAll("_", " ").toLowerCase();
}

function formatTime(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Toronto",
  }).format(date);
}

function formatDateTime(value: string | null) {
  const date = parseDate(value);
  if (!date) return "No send scheduled";
  return new Intl.DateTimeFormat("en-CA", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Toronto",
  }).format(date);
}

function formatDue(value: string | null, now: Date) {
  const date = parseDate(value);
  if (!date) return "None";

  const diffMs = date.getTime() - now.getTime();
  if (diffMs <= 45_000) return "Now";
  const absMinutes = Math.max(1, Math.round(diffMs / 60_000));

  if (absMinutes < 60) return `${absMinutes} min`;
  const hours = Math.round(absMinutes / 60);
  if (hours < 24) return `${hours} hr`;
  const days = Math.round(hours / 24);
  return `${days} day`;
}

function formatAvailable(value: string | null, now: Date) {
  const date = parseDate(value);
  if (!date) return "Ready";
  if (date.getTime() <= now.getTime()) return "Ready";
  return formatDue(value, now);
}

function formatAgo(value: string | null, now: Date) {
  const date = parseDate(value);
  if (!date) return "Never";

  const diffMs = now.getTime() - date.getTime();
  if (diffMs <= 45_000) return "just now";
  const minutes = Math.max(1, Math.round(diffMs / 60_000));
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function parseDate(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
