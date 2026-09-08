import { Building2 } from "lucide-react";

import { PageHeader } from "@/components/ui/page-header";

export default function LeadDetailLoading() {
  return (
    <div className="mx-auto flex max-w-[1500px] flex-col gap-5" role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Verifying the current lead dossier</span>
      <div className="h-9 w-36 animate-pulse rounded-lg bg-white/[0.04] motion-reduce:animate-none" aria-hidden="true" />
      <PageHeader
        eyebrow="Evidence-first pipeline"
        title="Lead dossier"
        description="Verifying the business identity, current website audit, route evidence, and v2 history."
        icon={Building2}
      />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.55fr)]" aria-hidden="true">
        <div className="h-72 animate-pulse rounded-2xl border border-white/[0.08] bg-white/[0.025] motion-reduce:animate-none" />
        <div className="h-72 animate-pulse rounded-2xl border border-white/[0.08] bg-white/[0.025] motion-reduce:animate-none" />
      </div>
      <div className="h-[440px] animate-pulse rounded-2xl border border-white/[0.08] bg-white/[0.025] motion-reduce:animate-none" aria-hidden="true" />
    </div>
  );
}
