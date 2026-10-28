"use client";

import { ExternalLink, MapPin, Star } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { displayPhone, telHref, titleCase } from "@/lib/prospect-format";
import { useState } from "react";
import Link from 'next/link';
import type {Route} from 'next';

import { LogActivityForm } from "./log-activity-form";
import { CallerLaunch, useCallerHandoff } from "./caller-launch";

export type ProspectRowView = {
  prospectId: string; name: string; city: string; niche: string; label: "STRONG" | "WEAK" | "NO_WEBSITE";
  reasons: string[]; phone: string | null; address: string | null; websiteUrl: string | null; mapsUrl: string;
  lastOutcomeText: string | null; lastActivity: string | null; followUpAt: string | null; attempts: number;
  history: { id: string; when: string; who: string; what: string; note: string; followUpAt: string | null }[];
  /** Latest note and number fix sent from Axiom Caller (older ones stay in the database). */
  callerNote?: { note: string; who: string; when: string } | null;
  callerPhoneFix?: { previousPhone: string | null; who: string; when: string } | null;
  /** Google's number when the business's own website lists a different one. */
  altPhone?: string | null;
  googleRatingCount?: number | null; googleRating?: number | null;
};

const title = titleCase;
const BADGE: Record<ProspectRowView["label"], { text: string; className: string }> = {
  STRONG: { text: "Weak website", className: "danger" },
  NO_WEBSITE: { text: "No website", className: "warning" },
  WEAK: { text: "Site is OK", className: "neutral" },
};

/** One call-list row: the facts at a glance, with logging and history one click away. */
export function ProspectRow({ row }: { row: ProspectRowView }) {
  const callerSelected=useCallerHandoff(row.prospectId);
  const [open, setOpen] = useState(false);
  const badge = BADGE[row.label];
  return <>
    <tr id={`prospect-${row.prospectId}`} className="border-b border-[#efe9dc] align-top hover:bg-[#faf7f0]">
      <td data-col="business" className="px-3 py-3">
        <p className="font-semibold">{row.name}</p>
        <span className="owner-badge mt-1" data-tone={badge.className}>{badge.text}</span>
        {row.googleRatingCount ? <span className="ml-1.5 inline-flex items-center gap-0.5 text-[11px] font-medium text-[#6b4d16]"><Star className="size-3 fill-current" aria-hidden="true" />{row.googleRating ?? "–"} ({row.googleRatingCount})</span> : null}
        {row.callerNote ? <p className="mt-1 max-w-[260px] text-xs text-[#3b3a36]" title={`Note from Caller · ${row.callerNote.who} · ${row.callerNote.when}`}>📝 {row.callerNote.note}</p> : null}
      </td>
      <td data-col="where" className="px-3 py-3 text-sm">{title(row.city)}<br /><span className="text-[#5c584f]">{title(row.niche)}</span></td>
      <td data-col="why" className="max-w-[340px] px-3 py-3 text-sm">{row.reasons.slice(0, 2).map((reason) => <p key={reason}>{reason}</p>)}</td>
      <td data-col="phone" className="whitespace-nowrap px-3 py-3 text-sm">
        {row.phone ? <CallerLaunch prospectId={row.prospectId} phone={row.phone} className="tabular-nums text-[#8a6420] hover:underline" /> : <span className="text-[#5c584f]">—</span>}
        {row.altPhone ? <p className="text-[11px] text-[#5c584f]">or <a href={telHref(row.altPhone)} className="tabular-nums underline">{displayPhone(row.altPhone)}</a> (Google)</p> : null}
        {row.callerPhoneFix ? <p className="text-[11px] text-[#5c584f]" title={`Fixed in Caller by ${row.callerPhoneFix.who} · ${row.callerPhoneFix.when}`}>Number updated{row.callerPhoneFix.previousPhone ? ` (was ${displayPhone(row.callerPhoneFix.previousPhone)})` : ""}</p> : null}
        <div className="mt-1 flex gap-2 text-xs">
          <a href={row.mapsUrl} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-0.5 text-[#5c584f] hover:text-[#0a0a0a]"><MapPin className="size-3" aria-hidden="true" />Map</a>
          {row.websiteUrl ? <a href={row.websiteUrl} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-0.5 text-[#5c584f] hover:text-[#0a0a0a]"><ExternalLink className="size-3" aria-hidden="true" />Site</a> : null}
        </div>
      </td>
      <td data-col="result" className="px-3 py-3 text-sm">
        {row.lastOutcomeText ? <><p>{row.lastOutcomeText}</p><p className="text-xs text-[#5c584f]">{row.lastActivity}{row.attempts > 1 ? ` · ${row.attempts} tries` : ""}</p></> : <span className="text-[#5c584f]">Not contacted</span>}
        {row.followUpAt ? <p className="text-xs font-medium text-[#7a5208]">Follow up {row.followUpAt}</p> : null}
      </td>
      <td data-col="action" className="px-3 py-3 text-right">
        <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open}
          className={buttonVariants({ variant: "outline", size: "sm" })}>{open ? "Close" : "Log"}</button>
      </td>
    </tr>
    {open ? <tr className="border-b border-[#efe9dc] bg-[#faf7f0]">
      <td colSpan={6} className="px-3 py-3">
        <div className="grid gap-4 lg:grid-cols-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-[#5c584f]">Log a call or visit</p>
            {callerSelected?<p role="status">This record is open in Caller. Review and save the result there.</p>:<LogActivityForm prospectId={row.prospectId} />}
            <Link className="mt-3 inline-block text-sm underline" href={('/settings?conversionSource='+encodeURIComponent(row.prospectId)+'#orbit-handoff') as Route}>Create or link a confirmed client in Orbit</Link>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-[#5c584f]">History</p>
            {row.address ? <p className="mt-2 text-sm">Address: {row.address}</p> : null}
            {row.history.length ? <ul className="mt-2 space-y-2 text-sm">{row.history.map((item) => <li key={item.id}>
              <span className="font-medium">{item.when} · {item.who} · {item.what}</span>{item.note ? <span className="text-[#5c584f]"> — {item.note}</span> : null}
              {item.followUpAt ? <span className="text-xs text-[#7a5208]"> (follow up {item.followUpAt})</span> : null}
            </li>)}</ul> : <p className="mt-2 text-sm text-[#5c584f]">No calls or visits yet.</p>}
          </div>
        </div>
      </td>
    </tr> : null}
  </>;
}
