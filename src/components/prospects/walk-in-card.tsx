"use client";

import { MapPin, Phone } from "lucide-react";
import { useState } from "react";

import { LogActivityForm } from "./log-activity-form";

export type WalkInView = {
  prospectId: string; name: string; niche: string; label: "STRONG" | "WEAK" | "NO_WEBSITE"; address: string; phone: string | null;
  reasons: string[]; mapsUrl: string; last: string | null;
};

export function WalkInCard({ stop, index }: { stop: WalkInView; index: number }) {
  const [open, setOpen] = useState(false);
  return <li className="rounded-xl border border-slate-200 bg-white p-4">
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="font-semibold"><span className="mr-2 inline-flex size-6 items-center justify-center rounded-full bg-slate-900 text-xs text-white">{index}</span>{stop.name}</p>
        <p className="mt-1 text-sm">{stop.address}</p>
        <p className="mt-1 text-xs text-slate-600">{stop.niche} · {stop.label === "NO_WEBSITE" ? "No website" : stop.reasons[0] ?? "Weak website"}{stop.last ? ` · last: ${stop.last}` : ""}</p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1 text-xs">
        <a href={stop.mapsUrl} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 font-medium text-[#7a5818] hover:underline"><MapPin className="size-3.5" aria-hidden="true" />Map</a>
        {stop.phone ? <a href={`tel:${stop.phone.replace(/[^\d+]/g, "")}`} className="inline-flex items-center gap-1 tabular-nums text-slate-700 hover:underline"><Phone className="size-3.5" aria-hidden="true" />{stop.phone}</a> : null}
      </div>
    </div>
    <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open}
      className="mt-3 rounded-md owner-cta px-3 py-1.5 text-sm font-semibold  ">{open ? "Close" : "Log visit"}</button>
    {open ? <LogActivityForm prospectId={stop.prospectId} defaultChannel="VISIT" /> : null}
  </li>;
}
