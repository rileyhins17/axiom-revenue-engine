"use client";

import { MapPin } from "lucide-react";

import { useState } from "react";

import { Button, buttonVariants } from "@/components/ui/button";

import { LogActivityForm } from "./log-activity-form";
import { CallerLaunch } from "./caller-launch";

export type WalkInView = {
  prospectId: string; name: string; niche: string; label: "STRONG" | "WEAK" | "NO_WEBSITE"; address: string; phone: string | null;
  reasons: string[]; mapsUrl: string; last: string | null;
};

export function WalkInCard({ stop, index }: { stop: WalkInView; index: number }) {
  const [open, setOpen] = useState(false);
  return <li className="owner-panel flex flex-col gap-3">
    <div className="flex items-start gap-3">
      <span className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-[#0a0a0a] text-xs font-semibold text-[#f2e3c2]">{index}</span>
      <div className="min-w-0">
        <p className="font-semibold leading-snug">{stop.name}</p>
        <p className="mt-0.5 text-sm text-[#3b3a36]">{stop.address}</p>
        <p className="owner-meta mt-0.5">{stop.niche} · {stop.label === "NO_WEBSITE" ? "No website" : stop.reasons[0] ?? "Weak website"}{stop.last ? ` · last: ${stop.last}` : ""}</p>
      </div>
    </div>
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen((value) => !value)} aria-expanded={open}>{open ? "Close" : "Log visit"}</Button>
      <a href={stop.mapsUrl} target="_blank" rel="noreferrer noopener" className={buttonVariants({ variant: "ghost", size: "sm" })}><MapPin aria-hidden="true" />Map</a>
      {stop.phone ? <CallerLaunch prospectId={stop.prospectId} phone={stop.phone} className={buttonVariants({ variant: "ghost", size: "sm" })} /> : null}
    </div>
    {open ? <LogActivityForm prospectId={stop.prospectId} defaultChannel="VISIT" /> : null}
  </li>;
}
