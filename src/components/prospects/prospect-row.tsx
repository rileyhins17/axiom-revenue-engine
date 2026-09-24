"use client";

import { ExternalLink, MapPin } from "lucide-react";
import { useState } from "react";

import { LogActivityForm } from "./log-activity-form";

export type ProspectRowView = {
  prospectId: string; name: string; city: string; niche: string; label: "STRONG" | "WEAK" | "NO_WEBSITE";
  reasons: string[]; phone: string | null; address: string | null; websiteUrl: string | null; mapsUrl: string;
  lastOutcomeText: string | null; lastActivity: string | null; followUpAt: string | null; attempts: number;
  history: { id: string; when: string; who: string; what: string; note: string; followUpAt: string | null }[];
};

const title = (value: string) => value === "HVAC" ? value : value.charAt(0) + value.slice(1).toLowerCase();
const BADGE: Record<ProspectRowView["label"], { text: string; className: string }> = {
  STRONG: { text: "Weak website", className: "bg-rose-50 text-rose-800 ring-rose-200" },
  NO_WEBSITE: { text: "No website", className: "bg-amber-50 text-amber-900 ring-amber-200" },
  WEAK: { text: "Site is OK", className: "bg-slate-100 text-slate-700 ring-slate-200" },
};

/** One call-list row: the facts at a glance, with logging and history one click away. */
export function ProspectRow({ row }: { row: ProspectRowView }) {
  const [open, setOpen] = useState(false);
  const badge = BADGE[row.label];
  return <>
    <tr className="border-b border-slate-200 align-top hover:bg-slate-50">
      <td className="px-3 py-3">
        <p className="font-medium">{row.name}</p>
        <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${badge.className}`}>{badge.text}</span>
      </td>
      <td className="px-3 py-3 text-sm">{title(row.city)}<br /><span className="text-slate-600">{title(row.niche)}</span></td>
      <td className="max-w-[340px] px-3 py-3 text-sm">{row.reasons.slice(0, 2).map((reason) => <p key={reason}>{reason}</p>)}</td>
      <td className="whitespace-nowrap px-3 py-3 text-sm">
        {row.phone ? <a href={`tel:${row.phone.replace(/[^\d+]/g, "")}`} className="font-medium tabular-nums text-emerald-800 hover:underline">{row.phone}</a> : <span className="text-slate-600">—</span>}
        <div className="mt-1 flex gap-2 text-xs">
          <a href={row.mapsUrl} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-0.5 text-slate-600 hover:text-slate-900"><MapPin className="size-3" aria-hidden="true" />Map</a>
          {row.websiteUrl ? <a href={row.websiteUrl} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-0.5 text-slate-600 hover:text-slate-900"><ExternalLink className="size-3" aria-hidden="true" />Site</a> : null}
        </div>
      </td>
      <td className="px-3 py-3 text-sm">
        {row.lastOutcomeText ? <><p>{row.lastOutcomeText}</p><p className="text-xs text-slate-600">{row.lastActivity}{row.attempts > 1 ? ` · ${row.attempts} tries` : ""}</p></> : <span className="text-slate-600">Not contacted</span>}
        {row.followUpAt ? <p className="text-xs font-medium text-amber-800">Follow up {row.followUpAt}</p> : null}
      </td>
      <td className="px-3 py-3 text-right">
        <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open}
          className="rounded-md bg-emerald-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-800">{open ? "Close" : "Log"}</button>
      </td>
    </tr>
    {open ? <tr className="border-b border-slate-200 bg-slate-50">
      <td colSpan={6} className="px-3 py-3">
        <div className="grid gap-4 lg:grid-cols-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Log a call or visit</p>
            <LogActivityForm prospectId={row.prospectId} />
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">History</p>
            {row.address ? <p className="mt-2 text-sm">Address: {row.address}</p> : null}
            {row.history.length ? <ul className="mt-2 space-y-2 text-sm">{row.history.map((item) => <li key={item.id}>
              <span className="font-medium">{item.when} · {item.who} · {item.what}</span>{item.note ? <span className="text-slate-600"> — {item.note}</span> : null}
              {item.followUpAt ? <span className="text-xs text-amber-800"> (follow up {item.followUpAt})</span> : null}
            </li>)}</ul> : <p className="mt-2 text-sm text-slate-600">No calls or visits yet.</p>}
          </div>
        </div>
      </td>
    </tr> : null}
  </>;
}
