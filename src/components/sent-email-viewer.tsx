"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, ArrowRight, CalendarClock, CheckCircle2, Copy, Inbox, Send, ShieldCheck, X } from "lucide-react";

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

function extractEmailBodyMarkup(bodyHtml: string): string {
  const bodyMatch = bodyHtml.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  return (bodyMatch?.[1] ?? bodyHtml).trim();
}

export function buildEmailHtmlSrcDoc(bodyHtml: string): string {
  const messageHtml = extractEmailBodyMarkup(bodyHtml);
  return `<!doctype html><html><head><base target="_blank"><style>:root{color-scheme:dark;}html{background:#080d15;}body{font:15.5px/1.74 "Aptos","Inter","Segoe UI Variable Text","Segoe UI",system-ui,-apple-system,BlinkMacSystemFont,sans-serif;color:#e7edf6;padding:48px 40px 56px;margin:0;text-rendering:optimizeLegibility;-webkit-font-smoothing:antialiased;background:linear-gradient(180deg,#0b111c,#070b12);}main.message{max-width:640px;margin:0 auto;padding:0 0 0 28px;border-left:1px solid rgba(125,211,252,.24);}a{color:#7dd3fc;text-decoration:underline;text-decoration-color:rgba(125,211,252,0.32);text-underline-offset:3px;text-decoration-thickness:1px;}a:hover{text-decoration-color:rgba(125,211,252,0.78);}p{margin:0 0 18px;}p:last-child{margin-bottom:0;}strong,b{font-weight:650;color:#fff;}img{max-width:100%;height:auto;border-radius:8px;}blockquote{border-left:2px solid rgba(125,211,252,0.36);margin:2px 0 18px;padding:2px 0 2px 16px;color:#aab4c2;}ul,ol{padding-left:22px;margin:0 0 18px;}li{margin:4px 0;}@media (max-width:640px){body{padding:34px 24px 40px;font-size:15.5px;}main.message{padding-left:18px;}}</style></head><body><main class="message">${messageHtml}</main></body></html>`;
}

function SentEmailViewerModal({ emailId, onClose }: { emailId: string; onClose: () => void }) {
  const [email, setEmail] = useState<EmailDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<"plain" | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/outreach/emails/${emailId}`)
      .then(async (r) => (r.ok
        ? await r.json() as { email: EmailDetail }
        : Promise.reject(new Error(`HTTP ${r.status}`))))
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
      ? "Delivered"
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
                  Sent email
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
            {email?.status && !statusIsHealthy && email.errorMessage ? (
              <span className="ml-2 text-amber-300">- {email.errorMessage}</span>
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
    <aside className="email-viewer-meta-rail" aria-label="Delivery details">
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
          label="Delivery"
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

      {email.errorMessage ? (
        <div className="email-viewer-rail-alert">
          <AlertTriangle className="size-4" strokeWidth={2.2} />
          <span>{email.errorMessage}</span>
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
  if (email.bodyHtml && email.bodyHtml.trim().length > 0) {
    const srcDoc = buildEmailHtmlSrcDoc(email.bodyHtml);
    return (
      <iframe
        title={email.subject}
        srcDoc={srcDoc}
        sandbox=""
        className="email-viewer-frame w-full bg-transparent"
        style={{ minHeight: 420, height: "64vh", border: 0 }}
      />
    );
  }
  return (
    <div className="email-viewer-plain-wrap">
      <pre className="email-viewer-plain">
        {email.bodyPlain || "(empty)"}
      </pre>
    </div>
  );
}
