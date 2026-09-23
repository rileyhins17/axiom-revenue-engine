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
    <div className="mx-auto flex min-w-0 w-full max-w-[1280px] flex-col gap-5 text-[#24352e]">
      <header className="flex flex-col gap-3 border-b border-[#dedfd7] pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-2xl">
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#416b55]">Relationships</p>
          <h1 id="clients-title" className="mt-2 text-[2rem] font-semibold leading-tight tracking-[-0.04em] text-[#1e3027] sm:text-[2.65rem]">Clients & opportunities</h1>
          <p className="mt-2 text-sm leading-6 text-[#53655a]">See who replied, what needs a follow-up, and where each deal stands.</p>
        </div>
        <span className="w-fit rounded-full border border-[#d7e2d8] bg-[#edf4ed] px-3 py-1.5 text-xs font-semibold text-[#24543a]">Owner-managed records</span>
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
