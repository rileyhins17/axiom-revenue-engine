export default function LeadDetailLoading() {
  return (
    <div className="mx-auto max-w-[1320px] space-y-4 text-[#263a2f]" role="status" aria-live="polite" aria-busy="true">
      <div className="h-9 w-36 animate-pulse rounded-lg bg-[#edf4eb] motion-reduce:animate-none" aria-hidden="true" />
      <section className="rounded-[22px] border border-[#dce6d9] bg-white p-5 shadow-sm sm:p-8">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#406849]">Business details</p>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight">Loading this business…</h1>
        <p className="mt-2 text-sm text-[#617367]">Checking its current evidence and contact status.</p>
      </section>
      <div className="grid gap-4 xl:grid-cols-2" aria-hidden="true">
        <div className="h-52 animate-pulse rounded-2xl border border-[#e1e9df] bg-[#f4f8f2] motion-reduce:animate-none" />
        <div className="h-52 animate-pulse rounded-2xl border border-[#e1e9df] bg-[#f4f8f2] motion-reduce:animate-none" />
      </div>
    </div>
  );
}
