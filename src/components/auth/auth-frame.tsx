import type { ComponentType, ReactNode } from "react";

import { BrandMark } from "@/components/brand-mark";

type AuthSignal = {
  icon: ComponentType<{ className?: string }>;
  label: string;
};

export function AuthFrame({
  badge,
  title,
  description,
  signals,
  formTitle,
  formDescription,
  children,
  footer,
}: {
  badge: string;
  title: ReactNode;
  description: string;
  signals: AuthSignal[];
  formTitle: string;
  formDescription: string;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <main className="auth-shell">
      <div className="auth-grid" aria-hidden="true" />
      <div className="auth-frame">
        <section className="auth-story">
          <div className="flex items-center justify-between gap-4">
            <BrandMark className="w-[172px] justify-start" imageClassName="h-9" showBorder={false} priority />
            <span className="auth-version">OPS / 04</span>
          </div>

          <div className="max-w-2xl">
            <div className="auth-kicker">
              <span className="size-1.5 rounded-full bg-emerald-300" />
              {badge}
            </div>
            <h1 className="auth-title">{title}</h1>
            <p className="auth-description">{description}</p>
          </div>

          <div className="auth-signals">
            {signals.map(({ icon: Icon, label }, index) => (
              <div className="auth-signal" key={label}>
                <span className="auth-signal-index">0{index + 1}</span>
                <Icon className="size-4 text-emerald-300" aria-hidden="true" />
                <span>{label}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="auth-form-panel">
          <div className="auth-form-wrap">
            <div className="mb-8">
              <p className="auth-form-eyebrow">Protected workspace</p>
              <h2 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-white">{formTitle}</h2>
              <p className="mt-2 text-sm leading-6 text-zinc-400">{formDescription}</p>
            </div>
            {children}
            <div className="mt-7 border-t border-white/[0.08] pt-5 text-sm text-zinc-500">{footer}</div>
          </div>
        </section>
      </div>
    </main>
  );
}

export const authInputClassName =
  "h-12 rounded-xl border-white/[0.1] bg-black/25 px-4 text-[15px] shadow-none focus-visible:border-emerald-300/60 focus-visible:ring-emerald-300/20";

export const authLabelClassName =
  "text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-500";

export function AuthError({ message }: { message: string }) {
  return (
    <p
      aria-live="polite"
      role="alert"
      className="flex items-start gap-2.5 rounded-xl border border-rose-400/25 bg-rose-400/[0.08] px-3.5 py-3 text-sm leading-5 text-rose-100"
    >
      <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-rose-300" />
      {message}
    </p>
  );
}
