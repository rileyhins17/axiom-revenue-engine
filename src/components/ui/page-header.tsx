import type { ComponentType, ReactNode } from "react";

import { cn } from "@/lib/utils";

export type PageMetric = {
  label: string;
  value: ReactNode;
  detail?: string;
  tone?: "default" | "positive" | "warning" | "info";
};

const metricTone = {
  default: "text-white",
  positive: "text-emerald-300",
  warning: "text-amber-300",
  info: "text-sky-300",
};

export function PageHeader({
  eyebrow,
  title,
  description,
  icon: Icon,
  status,
  actions,
  metrics = [],
}: {
  eyebrow: string;
  title: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
  status?: ReactNode;
  actions?: ReactNode;
  metrics?: PageMetric[];
}) {
  return (
    <header className="page-header">
      <div className="page-header-main">
        <div className="page-header-icon" aria-hidden="true">
          <Icon className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <p className="page-header-eyebrow">{eyebrow}</p>
            {status}
          </div>
          <h1 className="page-header-title">{title}</h1>
          <p className="page-header-description">{description}</p>
        </div>
        {actions ? <div className="page-header-actions">{actions}</div> : null}
      </div>

      {metrics.length > 0 ? (
        <div className="page-metrics" role="list" aria-label={`${title} summary`}>
          {metrics.map((metric) => (
            <div className="page-metric" key={metric.label} role="listitem">
              <span className="page-metric-label">{metric.label}</span>
              <div className="mt-2 flex items-baseline gap-2">
                <span className={cn("page-metric-value", metricTone[metric.tone ?? "default"])}>{metric.value}</span>
                {metric.detail ? <span className="page-metric-detail">{metric.detail}</span> : null}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </header>
  );
}
