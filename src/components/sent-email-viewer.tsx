"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { z } from "zod";
import { AlertTriangle, ArrowRight, CalendarClock, CheckCircle2, Copy, Inbox, Send, ShieldCheck, X } from "lucide-react";

import { legacyEmailSchema, type LegacyEmail as EmailDetail } from "@/lib/revenue-engine/legacy-mail-contract";

export function SentEmailViewerTrigger({
  emailId,
  children,
  className,
}: {
  emailId: string;
  children: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={className ?? "w-full text-left transition hover:bg-white/[0.025]"}
      >
        {children}
      </button>
      {open ? <SentEmailViewerModal key={emailId} emailId={emailId} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function formatRelativeTime(date: Date, now = new Date()): string {
  const diffMs = now.getTime() - date.getTime();
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diffMs < 45 * 1000) return "just now";
  if (diffMs < hour) return `${Math.round(diffMs / minute)} min ago`;
  if (diffMs < day) {
    const hours = Math.round(diffMs / hour);
    return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  }
  if (diffMs < 7 * day) {
    const days = Math.round(diffMs / day);
    return `${days} ${days === 1 ? "day" : "days"} ago`;
  }
  return date.toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" });
}

function nameFromEmail(email: string): string {
  const local = (email.split("@")[0] || "").trim();
  if (!local) return "";
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function senderInitials(email: string): string {
  const display = nameFromEmail(email);
  if (!display) return "?";
  const parts = display.split(" ");
  if (parts.length >= 2) return (parts[0]!.charAt(0) + parts[1]!.charAt(0)).toUpperCase();
  return display.slice(0, 2).toUpperCase();
}

function SentEmailViewerModal({ emailId, onClose }: { emailId: string; onClose: () => void }) {
  const [email, setEmail] = useState<EmailDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<"plain" | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    // The keyed modal remounts for a different message; initial state is empty.
    fetch(`/api/outreach/emails/${encodeURIComponent(emailId)}`, {
      signal: controller.signal, credentials: "same-origin", cache: "no-store",
    }).then(async response => {
      if (!response.ok) throw new Error("Unavailable");
      const data = await response.json();
      const parsed = z.object({ email: legacyEmailSchema }).parse(data).email;
      if (parsed.id !== emailId) throw new Error("Wrong message");
      if (!controller.signal.aborted) setEmail(parsed);
    }).catch(() => {
      if (!controller.signal.aborted) {
        setEmail(null);
        setError("This legacy message is unavailable. Close and reopen to try again. No mailbox was contacted.");
      }
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [emailId]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  const sentAt = useMemo(() => (email ? new Date(email.sentAt) : null), [email]);
  const sentAbsolute = useMemo(
    () => (sentAt ? sentAt.toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short" }) : ""),
    [sentAt],
  );
  const sentRelative = useMemo(() => (sentAt ? formatRelativeTime(sentAt) : ""), [sentAt]);

  const handleCopyPlain = async () => {
    if (!email?.bodyPlain) return;
    try {
      await navigator.clipboard.writeText(email.bodyPlain);
      setCopied("plain");
      setTimeout(() => setCopied(null), 1800);
    } catch {
      // Clipboard unavailable; ignore.
    }
  };

  const statusLabel = email
    ? email.status === "sent" || email.status === "delivered"
      ? "Legacy sent record"
      : email.status.replace(/_/g, " ")
    : "";
  const statusIsHealthy = email?.status === "sent" || email?.status === "delivered";

  return (
    <div
      className="email-viewer-overlay fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="email-viewer-title"
    >
      <div
        className="email-viewer-shell w-full max-w-[1120px] max-h-[92vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="email-viewer-header relative px-5 pt-5 pb-4 sm:px-8 sm:pt-6 sm:pb-5">
          <div className="flex items-start justify-between gap-5">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2.5">
                <span className="email-viewer-kicker">
                  <Send className="size-3" strokeWidth={2.4} />
                  Legacy email
                </span>
                {statusLabel ? (
                  <span
                    className={
                      statusIsHealthy
                        ? "email-viewer-status email-viewer-status-healthy"
                        : "email-viewer-status email-viewer-status-warning"
                    }
                  >
                    {statusIsHealthy ? (
                      <CheckCircle2 className="size-3" strokeWidth={2.6} />
                    ) : (
                      <AlertTriangle className="size-3" strokeWidth={2.4} />
                    )}
                    {statusLabel}
                  </span>
                ) : null}
              </div>
              <h2
                id="email-viewer-title"
                className="mt-4 max-w-[820px] truncate text-[24px] font-semibold leading-tight text-white sm:text-[30px]"
                title={email?.subject || ""}
              >
                {email?.subject || (loading ? "Loading…" : "Email")}
              </h2>
              <div className="mt-2 text-[13px] text-slate-500">
                {sentAbsolute ? <>Sent {sentAbsolute}</> : loading ? "Preparing reader" : null}
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="email-viewer-close shrink-0"
              aria-label="Close"
            >
              <X className="size-4" strokeWidth={2.4} />
            </button>
          </div>
          <div className="email-viewer-header-divider absolute inset-x-6 -bottom-px h-px" />
        </header>

        <div className="flex-1 overflow-auto email-viewer-body">
          {loading ? (
            <div className="email-viewer-loading">
              <span className="email-viewer-spinner" aria-hidden />
              <div className="email-viewer-loading-lines" aria-hidden>
                <span />
                <span />
                <span />
              </div>
            </div>
          ) : error ? (
            <div className="p-8">
              <div className="email-viewer-error">
                <AlertTriangle className="size-4" strokeWidth={2.3} />
                <span>{error}</span>
              </div>
            </div>
          ) : email ? (
            <div className="email-viewer-workspace">
              <EmailMetaRail
                email={email}
                sentAbsolute={sentAbsolute}
                sentRelative={sentRelative}
                statusLabel={statusLabel}
                statusIsHealthy={statusIsHealthy}
              />
              <section className="email-viewer-reader" aria-label="Email body">
                <EmailBody email={email} />
              </section>
            </div>
          ) : null}
        </div>

        <footer className="email-viewer-footer flex items-center justify-between gap-3 px-5 py-3 sm:px-8">
          <div className="min-w-0 truncate text-[12px] text-zinc-500">
            {sentAbsolute ? <>Sent {sentAbsolute}</> : null}
            {email?.status && !statusIsHealthy && email.failureRecorded ? (
              <span className="ml-2 text-amber-300">- Legacy failure recorded; provider details are not displayed.</span>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            {email?.bodyPlain ? (
              <button
                type="button"
                onClick={handleCopyPlain}
                className="email-viewer-action"
              >
                <Copy className="size-3" strokeWidth={2.3} />
                {copied === "plain" ? "Copied" : "Copy plain"}
              </button>
            ) : null}
            <button
              type="button"
              onClick={onClose}
              className="email-viewer-action email-viewer-action-strong"
            >
              Close
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

function EmailMetaRail({
  email,
  sentAbsolute,
  sentRelative,
  statusLabel,
  statusIsHealthy,
}: {
  email: EmailDetail;
  sentAbsolute: string;
  sentRelative: string;
  statusLabel: string;
  statusIsHealthy: boolean;
}) {
  return (
    <aside className="email-viewer-meta-rail" aria-label="Historical message details">
      <div className="email-viewer-thread-map">
        <AddressCard
          label="From"
          name={nameFromEmail(email.senderEmail)}
          email={email.senderEmail}
          initials={senderInitials(email.senderEmail)}
          tone="sender"
        />
        <div className="email-viewer-route-line" aria-hidden>
          <span />
          <ArrowRight className="size-3.5" strokeWidth={2.4} />
          <span />
        </div>
        <AddressCard
          label="To"
          name={nameFromEmail(email.recipientEmail)}
          email={email.recipientEmail}
          initials={senderInitials(email.recipientEmail)}
          tone="recipient"
        />
      </div>

      <div className="email-viewer-detail-list">
        <DetailRow
          icon={<ShieldCheck className="size-4" strokeWidth={2.2} />}
          label="Legacy status"
          value={statusLabel || "Unknown"}
          tone={statusIsHealthy ? "healthy" : "warning"}
        />
        <DetailRow
          icon={<CalendarClock className="size-4" strokeWidth={2.2} />}
          label="Sent"
          value={sentAbsolute || "Not recorded"}
          detail={sentRelative}
        />
        <DetailRow
          icon={<Inbox className="size-4" strokeWidth={2.2} />}
          label="Mailbox"
          value={email.senderEmail}
        />
      </div>

      {email.failureRecorded ? (
        <div className="email-viewer-rail-alert">
          <AlertTriangle className="size-4" strokeWidth={2.2} />
          <span>Legacy failure recorded; provider details are not displayed.</span>
        </div>
      ) : null}
    </aside>
  );
}

function AddressCard({
  label,
  name,
  email,
  initials,
  tone,
}: {
  label: string;
  name: string;
  email: string;
  initials: string;
  tone: "sender" | "recipient";
}) {
  const avatarClass =
    tone === "sender"
      ? "from-emerald-200 to-emerald-500 text-emerald-950"
      : "from-sky-200 to-cyan-500 text-sky-950";
  return (
    <div className="email-viewer-address-card" title={`${label}: ${email}`}>
      <div className={`email-viewer-address-avatar bg-gradient-to-br ${avatarClass}`} aria-hidden>
        {initials}
      </div>
      <div className="min-w-0">
        <div className="email-viewer-address-label">{label}</div>
        <div className="email-viewer-address-name">{name || email}</div>
        <div className="email-viewer-address-email">{email}</div>
      </div>
    </div>
  );
}

function DetailRow({
  icon,
  label,
  value,
  detail,
  tone,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  detail?: string;
  tone?: "healthy" | "warning";
}) {
  return (
    <div className="email-viewer-detail-row">
      <div className={`email-viewer-detail-icon ${tone ? `email-viewer-detail-icon-${tone}` : ""}`}>{icon}</div>
      <div className="min-w-0">
        <div className="email-viewer-detail-label">{label}</div>
        <div className="email-viewer-detail-value">{value}</div>
        {detail ? <div className="email-viewer-detail-caption">{detail}</div> : null}
      </div>
    </div>
  );
}

function EmailBody({ email }: { email: EmailDetail }) {
  return <div className="email-viewer-plain-wrap">
    <p className="mb-4 text-sm text-zinc-300">Saved plain text only. No remote images or mailbox connection. A legacy sent record does not prove delivery.</p>
    <pre className="email-viewer-plain whitespace-pre-wrap break-words">
      {email.bodyUnavailable === "TOO_LARGE" ? "Text exceeds the safe display limit. The original record remains saved."
        : email.bodyPlain || "No plain-text copy is available. HTML is not loaded."}
    </pre>
  </div>;
}
