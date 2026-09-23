import { Users } from "lucide-react";

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

  const activeDealCount = leads.filter((l) => l.dealStage && l.dealStage !== "LOST").length;
  const recordedRecurringEstimate = leads
    .filter((l) => l.dealStage === "ACTIVE" || l.dealStage === "RETAINED")
    .reduce((sum, l) => sum + (l.monthlyValue ?? 0), 0);

  return (
    <div className="mx-auto flex min-w-0 w-full max-w-[1600px] flex-col gap-6">
      <section className="rounded-[28px] bg-[#f6f8f3] p-5 text-[#263a2f] shadow-xl shadow-black/10 sm:p-7 lg:p-8" aria-labelledby="clients-title">
        <div className="mx-auto max-w-[1160px]">
          <div className="flex flex-col gap-5 border-b border-[#dfe7dd] pb-6 sm:flex-row sm:items-end sm:justify-between">
            <div className="max-w-2xl">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#537262]">Axiom · Client relationships</p>
              <h1 id="clients-title" className="mt-2 text-3xl font-semibold tracking-tight text-[#24382d] sm:text-4xl">Clients and opportunities</h1>
              <p className="mt-2 text-sm leading-6 text-[#586d60]">Keep replies, deals, and the next owner action together. These records support your review; they do not send messages.</p>
            </div>
            {read.available ? (
              <div className="grid grid-cols-2 gap-3 sm:min-w-[420px]">
                <div className="rounded-2xl bg-white p-4 ring-1 ring-inset ring-[#e4ebe2]">
                  <p className="text-xs font-semibold text-[#53675a]">Active deals</p>
                  <p className="mt-2 text-2xl font-semibold tabular-nums text-[#294333]">{activeDealCount.toLocaleString()}</p>
                  <p className="mt-1 text-xs text-[#566a5d]">Open opportunities</p>
                </div>
                <div className="rounded-2xl bg-white p-4 ring-1 ring-inset ring-[#e4ebe2]">
                  <p className="text-xs font-semibold text-[#53675a]">Recorded recurring estimate</p>
                  <p className="mt-2 text-2xl font-semibold tabular-nums text-[#294333]">${recordedRecurringEstimate.toLocaleString()}</p>
                  <p className="mt-1 text-xs leading-5 text-[#566a5d]">Per month from active/retained records · not cash received</p>
                </div>
              </div>
            ) : (
              <div role="alert" className="rounded-2xl border border-amber-200 bg-white p-4 text-sm text-[#624b18] ring-1 ring-inset ring-amber-100 sm:max-w-sm">
                <p className="font-semibold">Client records could not be verified</p>
                <p className="mt-1 leading-6">The deal and recurring estimate totals are unavailable. Refresh this page or ask an owner to check the client records.</p>
              </div>
            )}
          </div>
          <div className="mt-4 flex items-start gap-2 text-xs leading-5 text-[#566a5d]">
            <Users className="mt-0.5 size-4 shrink-0 text-[#537262]" aria-hidden="true" />
            <p>Recurring estimates are values entered in client records. They are not confirmed invoices or collected cash.</p>
          </div>
        </div>
      </section>

      {read.available ? (
        <ClientsBoard initialLeads={leads} />
      ) : (
        <section className="rounded-2xl border border-amber-200 bg-[#fffdf7] p-6 text-[#3e3520] shadow-sm sm:p-8" aria-labelledby="client-data-unavailable">
          <h2 id="client-data-unavailable" className="text-lg font-semibold">Your client board is temporarily unavailable</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[#665d47]">No empty board or zero totals are shown because the latest client records could not be read. Wait a moment and refresh. This page warning does not change any live system activity.</p>
        </section>
      )}
    </div>
  );
}
