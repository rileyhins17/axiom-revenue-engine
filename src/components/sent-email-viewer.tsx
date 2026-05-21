"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowRight, CheckCircle2, Clock, Copy, Mail, X } from "lucide-react";

type EmailDetail = {
  id: string;
  senderEmail: string;
  recipientEmail: string;
  subject: string;
  bodyHtml: string | null;
  bodyPlain: string | null;
  status: string;
  errorMessage: string | null;
  sentAt: string;
};

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
      {open ? <SentEmailViewerModal emailId={emailId} onClose={() => setOpen(false)} /> : null}
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
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/outreach/emails/${emailId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data) => {
        if (!cancelled) {
          setEmail(data.email);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load email");
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
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

  const sentAt = email ? new Date(email.sentAt) : null;
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

  const statusLabel =
    email?.status === "sent" ? "Delivered" : email?.status ? email.status.replace(/_/g, " ") : "";
  const statusIsHealthy = email?.status === "sent";

  return (
    <div
      className="email-viewer-overlay fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="email-viewer-title"
    >
      <div
        className="email-viewer-shell w-full max-w-3xl max-h-[92vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="email-viewer-header relative px-6 pt-6 pb-5">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="v2-eyebrow flex items-center gap-1.5">
                  <Mail className="size-3" strokeWidth={2.4} />
                  Sent email
                </span>
                {statusLabel ? (
                  <span
                    className={
                      statusIsHealthy
                        ? "inline-flex items-center gap-1 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-emerald-200"
                        : "inline-flex items-center gap-1 rounded-full border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-amber-200"
                    }
                  >
                    {statusIsHealthy ? <CheckCircle2 className="size-3" strokeWidth={2.6} /> : null}
                    {statusLabel}
                  </span>
                ) : null}
              </div>
              <h2
                id="email-viewer-title"
                className="mt-3 text-[22px] font-semibold leading-tight text-white tracking-[-0.02em] truncate"
                title={email?.subject || ""}
              >
                {email?.subject || (loading ? "Loading…" : "Email")}
              </h2>
              {email ? (
                <div className="mt-5 flex flex-wrap items-center gap-2.5">
                  <AddressChip
                    label="From"
                    name={nameFromEmail(email.senderEmail)}
                    email={email.senderEmail}
                    initials={senderInitials(email.senderEmail)}
                    tone="sender"
                  />
                  <ArrowRight className="size-3.5 text-zinc-600" strokeWidth={2.4} />
                  <AddressChip
                    label="To"
                    name={nameFromEmail(email.recipientEmail)}
                    email={email.recipientEmail}
                    initials={senderInitials(email.recipientEmail)}
                    tone="recipient"
                  />
                  {sentAt ? (
                    <span
                      className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.025] px-2.5 py-1 text-[11px] text-zinc-400"
                      title={sentAbsolute}
                    >
                      <Clock className="size-3" strokeWidth={2.2} />
                      {sentRelative}
                    </span>
                  ) : null}
                </div>
              ) : null}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="email-viewer-close shrink-0 rounded-full border border-white/[0.08] bg-white/[0.04] p-2 text-zinc-400 transition hover:border-white/20 hover:bg-white/[0.08] hover:text-white"
              aria-label="Close"
            >
              <X className="size-4" strokeWidth={2.4} />
            </button>
          </div>
          <div className="email-viewer-header-divider absolute inset-x-6 -bottom-px h-px" />
        </header>

        <div className="flex-1 overflow-auto email-viewer-body">
          {loading ? (
            <div className="flex h-72 items-center justify-center text-sm text-zinc-500">
              <span className="inline-flex items-center gap-2">
                <span className="email-viewer-spinner" aria-hidden />
                Loading email…
              </span>
            </div>
          ) : error ? (
            <div className="p-8 text-center text-sm text-red-300">{error}</div>
          ) : email ? (
            <EmailBody email={email} />
          ) : null}
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-white/[0.06] bg-white/[0.015] px-6 py-3">
          <div className="min-w-0 truncate text-[11px] text-zinc-500">
            {sentAbsolute ? <>Sent {sentAbsolute}</> : null}
            {email?.status && email.status !== "sent" && email.errorMessage ? (
              <span className="ml-2 text-amber-300">— {email.errorMessage}</span>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            {email?.bodyPlain ? (
              <button
                type="button"
                onClick={handleCopyPlain}
                className="inline-flex items-center gap-1.5 rounded-md border border-white/[0.08] bg-white/[0.03] px-2.5 py-1.5 text-[11px] font-medium text-zinc-300 transition hover:border-white/15 hover:bg-white/[0.07] hover:text-white"
              >
                <Copy className="size-3" strokeWidth={2.3} />
                {copied === "plain" ? "Copied" : "Copy plain"}
              </button>
            ) : null}
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center rounded-md border border-white/[0.1] bg-white/[0.04] px-3 py-1.5 text-[11px] font-medium text-zinc-200 transition hover:border-white/20 hover:bg-white/[0.08] hover:text-white"
            >
              Close
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

function AddressChip({
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
  const dotClass =
    tone === "sender"
      ? "bg-gradient-to-br from-emerald-300/90 to-emerald-500/70 text-emerald-950"
      : "bg-gradient-to-br from-sky-300/85 to-sky-500/65 text-sky-950";
  return (
    <span
      className="inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.03] py-1 pl-1 pr-2.5 text-[11.5px] text-zinc-200"
      title={`${label}: ${email}`}
    >
      <span
        className={`grid size-5 place-items-center rounded-full text-[9.5px] font-semibold tracking-tight ${dotClass}`}
        aria-hidden
      >
        {initials}
      </span>
      <span className="text-zinc-500">{label}</span>
      <span className="font-medium text-zinc-100 truncate max-w-[200px]">{name || email}</span>
    </span>
  );
}

function EmailBody({ email }: { email: EmailDetail }) {
  if (email.bodyHtml && email.bodyHtml.trim().length > 0) {
    const srcDoc = `<base target="_blank"><style>html,body{background:transparent;}body{font:14.5px/1.65 "Comic Sans MS","Comic Sans","Chalkboard SE",cursive,sans-serif;color:#e4e4e7;padding:32px 40px;margin:0;}a{color:#6ee7b7;text-decoration:underline;text-decoration-color:rgba(110,231,183,0.4);text-underline-offset:2px;}a:hover{text-decoration-color:rgba(110,231,183,0.85);}p{margin:0 0 14px;}p:last-child{margin-bottom:0;}img{max-width:100%;height:auto;border-radius:6px;}blockquote{border-left:2px solid rgba(110,231,183,0.35);margin:0 0 14px;padding:2px 0 2px 14px;color:#a1a1aa;}</style>${email.bodyHtml}`;
    return (
      <iframe
        title={email.subject}
        srcDoc={srcDoc}
        sandbox=""
        className="w-full bg-transparent"
        style={{ minHeight: 360, height: "62vh", border: 0 }}
      />
    );
  }
  return (
    <pre className="px-10 py-8 text-[14.5px] leading-[1.65] text-zinc-200 whitespace-pre-wrap font-sans">
      {email.bodyPlain || "(empty)"}
    </pre>
  );
}
