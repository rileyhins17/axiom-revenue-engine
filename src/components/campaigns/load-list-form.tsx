"use client";

import { AlertTriangle, CheckCircle2, FileUp, ListChecks, Upload } from "lucide-react";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Sample = { row: number; to: string; from: string; subject: string; text: string; followUp: { subject: string; text: string } | null };
type Checked = {
  saved: boolean; batchId: string | null; rows: number; ready: number; held: number; skipped: number;
  holds: Array<{ row: number; email: string; reason: string }>; samples: Sample[]; wordsChanged: boolean; wordsVersion: string; domains: number;
};

const area = "w-full rounded-md border border-[#d9d3c5] bg-white px-3 py-2 font-mono text-[13px] leading-relaxed text-[#202c26] outline-none focus-visible:border-[#202c26] focus-visible:ring-[3px] focus-visible:ring-[#202c26]/15";

function Email({ label, from, to, subject, text }: { label: string; from: string; to: string; subject: string; text: string }) {
  return <div className="rounded-xl border border-[#e6e1d6] bg-[#fffdf8]">
    <div className="space-y-0.5 border-b border-[#efe9dc] px-4 py-3 text-sm">
      <p className="owner-meta">{label}</p>
      <p><span className="text-[#5c584f]">From:</span> {from}</p>
      <p className="break-all"><span className="text-[#5c584f]">To:</span> {to}</p>
      <p className="font-semibold"><span className="font-normal text-[#5c584f]">Subject:</span> {subject}</p>
    </div>
    <pre className="whitespace-pre-wrap px-4 py-3 font-sans text-sm leading-relaxed text-[#202c26]">{text}</pre>
  </div>;
}

/**
 * Check a list (nothing is saved), then load it as a batch that waits for the campaign's approver. The words are
 * the campaign's own unless they are edited here; edited words are saved with the batch.
 */
export function LoadListForm({ campaign, first, followUp, approvers, hasFollowUp }: {
  campaign: string; first: string; followUp: string; approvers: string; hasFollowUp: boolean;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [csv, setCsv] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [firstText, setFirstText] = useState(first);
  const [followText, setFollowText] = useState(followUp);
  const [busy, setBusy] = useState<"check" | "load" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checked, setChecked] = useState<{ result: Checked; inputs: string } | null>(null);
  const wordsEdited = firstText !== first || followText !== followUp;
  const inputs = JSON.stringify([name.trim(), csv, wordsEdited ? firstText : null, wordsEdited ? followText : null]);
  const current = checked && checked.inputs === inputs ? checked.result : null;

  const send = async (save: boolean) => {
    setBusy(save ? "load" : "check"); setError(null);
    try {
      const response = await fetch("/api/campaigns/load", {
        method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" },
        body: JSON.stringify({ campaign, name: name.trim(), csv, ...(wordsEdited ? { first: firstText, followUp: followText } : {}), save }),
      });
      const data = (await response.json().catch(() => ({}))) as Checked & { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Could not check the list.");
      setChecked({ result: data, inputs });
      if (save && data.batchId) router.push(`/campaigns/${campaign}/batches/${data.batchId}` as Route);
    } catch (caught) {
      setChecked(null);
      setError(caught instanceof Error ? caught.message : "Could not check the list.");
    } finally {
      setBusy(null);
    }
  };
  const readFile = async (file: File | undefined) => {
    if (!file) return;
    setFileName(file.name);
    setCsv(await file.text());
    if (!name.trim()) setName(file.name.replace(/\.csv$/i, "").replace(/[_-]+/g, " ").trim());
  };

  return <div className="space-y-6">
    <div className="grid gap-4 md:grid-cols-2">
      <label className="block space-y-1.5 text-sm font-medium">
        <span>Batch name</span>
        <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Cities batch 2" maxLength={120} />
      </label>
      <label className="block space-y-1.5 text-sm font-medium">
        <span>The list (a CSV file with an email column)</span>
        <Input type="file" accept=".csv,text/csv" onChange={(event) => void readFile(event.target.files?.[0])} />
        <span className="owner-meta block font-normal">{fileName ? `${fileName}: ${csv.split(/\r?\n/).filter((line) => line.trim()).length - 1} rows` : "Or paste it below."}</span>
      </label>
    </div>
    <label className="block space-y-1.5 text-sm font-medium">
      <span>Or paste the CSV</span>
      <textarea className={area} rows={5} value={csv} onChange={(event) => { setCsv(event.target.value); setFileName(null); }} spellCheck={false}
        placeholder={"email,first_name,city,...\nclerk@springfield.gov,Jo,Springfield,..."} />
    </label>

    <div className="grid gap-4 lg:grid-cols-2">
      <label className="block space-y-1.5 text-sm font-medium">
        <span>First email (starts with &ldquo;Subject: ...&rdquo;)</span>
        <textarea className={area} rows={12} value={firstText} onChange={(event) => setFirstText(event.target.value)} spellCheck />
      </label>
      {hasFollowUp ? <label className="block space-y-1.5 text-sm font-medium">
        <span>Follow-up (goes in the same thread as &ldquo;Re: &rdquo; the first subject)</span>
        <textarea className={area} rows={12} value={followText} onChange={(event) => setFollowText(event.target.value)} spellCheck />
      </label> : null}
    </div>
    <p className="owner-meta">Blanks like {"{city}"} come from the list&rsquo;s columns; {"{sender_name}"} is the sending inbox&rsquo;s name. The engine adds the mailing address and the &ldquo;no thanks&rdquo; line itself.
      {wordsEdited ? " You changed the words: this batch is approved and sent with them." : ""}</p>

    <div className="flex flex-wrap gap-3">
      <Button type="button" variant="outline" size="lg" disabled={busy !== null || !csv.trim() || !name.trim()} onClick={() => void send(false)}>
        <ListChecks aria-hidden="true" />{busy === "check" ? "Checking..." : "Check the list (saves nothing)"}</Button>
      <Button type="button" size="lg" disabled={busy !== null || !current || current.ready === 0} onClick={() => void send(true)}>
        <Upload aria-hidden="true" />{busy === "load" ? "Loading..." : `Load this batch (waits for ${approvers})`}</Button>
    </div>
    {!current && !error ? <p className="owner-meta">Check the list first. Loading is allowed only for exactly what was checked.</p> : null}
    {error ? <p role="alert" className="flex gap-2 text-sm font-medium text-[#a1231b]"><AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />{error}</p> : null}

    {current ? <div className="space-y-5" role="status">
      <p className="flex items-center gap-2 text-base font-medium"><CheckCircle2 className="size-5" aria-hidden="true" />
        {current.rows} rows: {current.ready} ready, {current.held} held. {current.domains} email {current.domains === 1 ? "domain" : "domains"} checked for a mail server.</p>
      {current.wordsChanged ? <p className="flex gap-2 rounded-lg border border-[#e8c88b] bg-[#fdf6e7] px-4 py-3 text-sm">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        These words are new. This batch is approved and sent with them; batches already approved keep sending their own words.</p> : null}
      {current.samples.length ? <div className="space-y-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold"><FileUp className="size-4" aria-hidden="true" />The first {current.samples.length} emails, exactly as they would go</h3>
        <div className="grid gap-3 xl:grid-cols-2">
          {current.samples.map((sample) => <div key={sample.row} className="space-y-3">
            <Email label={`Row ${sample.row} · first email`} from={sample.from} to={sample.to} subject={sample.subject} text={sample.text} />
            {sample.followUp ? <Email label={`Row ${sample.row} · follow-up, if they don't reply`} from={sample.from} to={sample.to} subject={sample.followUp.subject} text={sample.followUp.text} /> : null}
          </div>)}
        </div>
      </div> : null}
      {current.holds.length ? <div className="overflow-x-auto">
        <table className="owner-table min-w-[520px]">
          <thead><tr><th>Row</th><th>Email</th><th>Held because</th></tr></thead>
          <tbody>{current.holds.map((hold) => <tr key={hold.row}><td className="tabular-nums">{hold.row}</td><td className="break-all">{hold.email}</td><td>{hold.reason}</td></tr>)}</tbody>
        </table>
        {current.held > current.holds.length ? <p className="owner-meta mt-2">And {current.held - current.holds.length} more.</p> : null}
      </div> : null}
    </div> : null}
  </div>;
}
