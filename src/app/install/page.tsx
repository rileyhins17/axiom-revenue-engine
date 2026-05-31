import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Install Axiom Ops on iOS",
  description: "Add the Axiom Pipeline Engine to your iPhone Home Screen as a full-screen app.",
};

const STEPS = [
  "Open this page in Safari on your iPhone (not Chrome — profiles only install from Safari).",
  "Tap Download profile below. Safari will ask to allow the download — tap Allow.",
  "Open Settings. A new Profile Downloaded banner appears near the top — tap it.",
  "Tap Install (top right), enter your passcode, then tap Install again to confirm.",
  "Done. The Axiom Ops icon is now on your Home Screen — full screen, no address bar.",
];

export default function InstallPage() {
  return (
    <main className="min-h-screen bg-background text-zinc-100">
      <div className="mx-auto flex max-w-md flex-col gap-6 px-5 py-10">
        <header className="flex flex-col gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-emerald-400">
            iOS Home Screen App
          </span>
          <h1 className="text-2xl font-semibold tracking-[-0.02em] text-white">
            Install Axiom Ops
          </h1>
          <p className="text-sm leading-6 text-zinc-400">
            Adds the pipeline to your iPhone Home Screen as a full-screen app with the Axiom
            icon and no Safari address bar. Always points at the live dashboard, so it can
            never land on a broken link.
          </p>
        </header>

        <a
          href="/api/ios-profile"
          className="inline-flex items-center justify-center rounded-lg border border-emerald-400/30 bg-emerald-400/[0.1] px-4 py-3 text-sm font-semibold text-emerald-200 transition hover:bg-emerald-400/[0.18]"
        >
          Download profile
        </a>

        <ol className="flex flex-col gap-3">
          {STEPS.map((step, i) => (
            <li key={i} className="flex items-start gap-3 text-sm leading-6 text-zinc-300">
              <span className="mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-[11px] font-semibold text-zinc-200">
                {i + 1}
              </span>
              <span>{step}</span>
            </li>
          ))}
        </ol>

        <p className="text-[11px] leading-5 text-zinc-500">
          Already have an old icon that shows a 404? Delete it from the Home Screen first, then
          install this profile — it replaces the old Web Clip cleanly.
        </p>
      </div>
    </main>
  );
}
