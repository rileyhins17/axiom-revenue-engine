/**
 * The owner app's building blocks. Every screen uses the same page frame, header,
 * sections, numbers, badges and notices, so the app reads as one thing.
 * Styles: the "Owner UI kit" block at the end of src/app/globals.css.
 */
import type { Route } from "next";
import Link from "next/link";
import type { ComponentType, ReactNode } from "react";

import { cn } from "@/lib/utils";

type IconType = ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" | "false" }>;
export type Tone = "success" | "warning" | "danger" | "neutral" | "gold";

/** The page frame: one width and one rhythm for every screen. */
export function OwnerPage({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cn("owner-stagger mx-auto w-full max-w-6xl space-y-6", className)}>{children}</section>;
}

/** Eyebrow, serif title, one plain sentence, an optional status badge and actions. */
export function PageHeader({ eyebrow, title, description, status, actions }: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  status?: ReactNode;
  actions?: ReactNode;
}) {
  return <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
    <div className="min-w-0 space-y-2">
      {eyebrow ? <p className="owner-eyebrow">{eyebrow}</p> : null}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1>{title}</h1>
        {status}
      </div>
      {description ? <p className="owner-lede">{description}</p> : null}
    </div>
    {actions ? <div className="flex flex-wrap items-center gap-2 sm:justify-end">{actions}</div> : null}
  </header>;
}

/** A section of a page. `flush` lets a table or list run edge to edge under the title. */
export function Panel({ title, icon: Icon, count, description, action, flush, className, children, id }: {
  title?: ReactNode;
  icon?: IconType;
  count?: number;
  description?: ReactNode;
  action?: ReactNode;
  flush?: boolean;
  className?: string;
  children?: ReactNode;
  id?: string;
}) {
  return <section id={id} className={cn("owner-panel", flush && "is-flush", className)}>
    {title ? <div className="owner-panel-head">
      <div className="min-w-0">
        <h2 className="owner-panel-title">
          {Icon ? <Icon aria-hidden="true" /> : null}
          <span className="min-w-0">{title}</span>
          {count !== undefined ? <span className="owner-panel-count">({count})</span> : null}
        </h2>
        {description ? <p className="owner-panel-description">{description}</p> : null}
      </div>
      {action ? <div className="owner-panel-action">{action}</div> : null}
    </div> : null}
    {children}
  </section>;
}

/** A labelled number. With `href` the whole card opens that screen. */
export function StatCard({ icon: Icon, label, value, detail, href, className }: {
  icon?: IconType;
  label: ReactNode;
  value: ReactNode;
  detail?: ReactNode;
  href?: Route;
  className?: string;
}) {
  const body = <>
    <p className="owner-stat-label">{Icon ? <Icon aria-hidden="true" /> : null}{label}</p>
    <p className="owner-stat-value">{value}</p>
    {detail ? <p className="owner-stat-detail">{detail}</p> : null}
  </>;
  return href
    ? <Link href={href} className={cn("owner-panel owner-stat", className)}>{body}</Link>
    : <div className={cn("owner-panel owner-stat", className)}>{body}</div>;
}

export function Badge({ tone = "neutral", icon: Icon, children }: { tone?: Tone; icon?: IconType; children: ReactNode }) {
  return <span className="owner-badge" data-tone={tone}>{Icon ? <Icon aria-hidden="true" /> : null}{children}</span>;
}

/** Something to know (info), to watch (warning), to fix (danger) or done (success). At most one action. */
export function Notice({ tone = "info", icon: Icon, title, children, action, role }: {
  tone?: "info" | "warning" | "danger" | "success";
  icon?: IconType;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  role?: "status" | "alert";
}) {
  return <div className="owner-notice" data-tone={tone} role={role}>
    <div className="owner-notice-body">
      {Icon ? <Icon aria-hidden="true" /> : null}
      <div className="min-w-0">
        {title ? <p className="owner-notice-title">{title}</p> : null}
        {children ? <div>{children}</div> : null}
      </div>
    </div>
    {action ? <div className="flex-none">{action}</div> : null}
  </div>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="owner-empty">{children}</p>;
}
