import { ClientsBoard } from "@/components/ClientsBoard";
import { getPrisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function ClientsPage() {
  await requireSession();

  const read = await Promise.resolve().then(() => getPrisma().lead.findMany({
    where: {
      isArchived: false,
      OR: [
        { outreachStatus: { in: ["REPLIED", "INTERESTED"] } },
        { dealStage: { not: null } },
      ],
    },
    orderBy: { lastUpdated: "desc" },
  })).then((leads) => ({ available: true as const, leads }))
    .catch(() => ({ available: false as const, leads: [] }));

  const leads = read.leads;

  return (
    <div className="mx-auto flex min-w-0 w-full max-w-[1320px] flex-col gap-7 text-[#202d26]">
      <header className="relative overflow-hidden rounded-[1.75rem] border border-[#d9ded3] bg-[#f8f5ec] px-6 py-7 sm:px-9 sm:py-9">
        <div className="pointer-events-none absolute -right-8 -top-16 size-64 rounded-full border border-[#dfe5d7] sm:right-14 sm:top-[-8.5rem] sm:size-[26rem]" aria-hidden="true" />
        <div className="relative max-w-3xl">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#426b53]">Relationships · owner workspace</p>
          <h1 id="clients-title" className="mt-3 text-[2rem] font-semibold leading-[1.08] tracking-[-0.045em] text-[#18251e] sm:text-[3.15rem]">Clients &amp; opportunities</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-[#526057] sm:text-base">Keep real conversations and client work moving. Start with the next human follow-up, then update each relationship as it progresses.</p>
        </div>
        <div className="relative mt-6 flex flex-wrap items-center gap-2 text-xs text-[#56655a]">
          <span className="inline-flex items-center gap-2 rounded-full border border-[#d4ded1] bg-[#edf2e8] px-3 py-1.5 font-medium text-[#325541]"><span className="size-1.5 rounded-full bg-[#39734e]" aria-hidden="true" />Owner-managed records</span>
          <span className="rounded-full border border-[#e2dfd5] bg-white/70 px-3 py-1.5">Counts reflect records in this workspace</span>
        </div>
      </header>

      {!read.available ? (
        <div role="alert" className="rounded-xl border border-amber-200 bg-[#fff9eb] px-4 py-3 text-sm text-[#654b17]">
          <strong>Client records could not be verified.</strong> Refresh before relying on a deal or follow-up count.
        </div>
      ) : null}

      {read.available ? (
        <ClientsBoard initialLeads={leads} />
      ) : (
        <section className="rounded-xl border border-amber-200 bg-[#fffdf7] p-6 text-[#3e3520]" aria-labelledby="client-data-unavailable">
          <h2 id="client-data-unavailable" className="text-lg font-semibold">Your client board is temporarily unavailable</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[#665d47]">No empty board or zero totals are shown because the latest client records could not be read. Wait a moment and refresh. This page warning does not change any live system activity.</p>
        </section>
      )}
    </div>
  );
}
