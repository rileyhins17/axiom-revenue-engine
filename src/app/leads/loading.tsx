import { Sparkles } from "lucide-react";

import { PageHeader } from "@/components/ui/page-header";

export default function LeadsLoading() {
  return (
    <div className="mx-auto flex max-w-[1500px] flex-col gap-5" role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Verifying the current lead queue</span>
      <PageHeader
        eyebrow="Evidence-first pipeline"
        title="Leads"
        description="Verifying current website evidence, qualification scores, and reachable routes."
        icon={Sparkles}
      />
      <section aria-hidden="true" className="overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0e1014]">
        <div className="border-b border-white/[0.07] px-5 py-4">
          <div className="h-4 w-40 animate-pulse rounded bg-white/[0.07] motion-reduce:animate-none" />
          <div className="mt-2 h-3 w-72 max-w-full animate-pulse rounded bg-white/[0.045] motion-reduce:animate-none" />
        </div>
        {[0, 1, 2].map((item) => (
          <div key={item} className="border-b border-white/[0.07] px-5 py-6 last:border-0">
            <div className="h-5 w-52 animate-pulse rounded bg-white/[0.07] motion-reduce:animate-none" />
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
              {[0, 1, 2, 3, 4].map((score) => <div key={score} className="h-16 animate-pulse rounded-xl bg-white/[0.035] motion-reduce:animate-none" />)}
            </div>
            <div className="mt-4 grid gap-2 md:grid-cols-3">
              {[0, 1, 2].map((claim) => <div key={claim} className="h-20 animate-pulse rounded-xl bg-white/[0.025] motion-reduce:animate-none" />)}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
