import type { Metadata } from "next";
import { Ban, CheckCircle2, Inbox, MailCheck, MailX, Send } from "lucide-react";

import { EmailSwitch } from "@/components/email/email-switch";
import { getCloudflareBindings, getDatabase } from "@/lib/cloudflare";
import { shortDay } from "@/lib/prospect-format";
import { emailOverview, HARD_DAILY_CAP, type EmailOverview } from "@/lib/revenue-engine/engine-email";
import type { ProspectDb } from "@/lib/revenue-engine/engine-prospects-d1";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Email | Axiom Revenue Engine" };

function Stat({ icon: Icon, label, value }: { icon: typeof Send; label: string; value: string | number }) {
  return <div className="rounded-xl border border-slate-200 bg-white p-4">
    <p className="flex items-center gap-2 text-xs font-medium text-slate-600"><Icon className="size-4" aria-hidden="true" />{label}</p>
    <p className="mt-2 text-2xl font-semibold tabular-nums">{value}</p>
  </div>;
}

export default async function EmailPage() {
  await requireSession();
  let data: EmailOverview;
  try {
    data = await emailOverview(getDatabase() as unknown as ProspectDb);
  } catch {
    return <section className="mx-auto max-w-6xl px-6 py-8"><h1 className="text-2xl font-semibold">Email</h1><p className="mt-2 text-sm">Email data isn&apos;t available yet. Refresh in a minute.</p></section>;
  }
  const env = (getCloudflareBindings() ?? {}) as Record<string, unknown>;
  const ready = env.ENGINE_EMAIL_ENABLED === "true" && Boolean(env.ENGINE_SMTP_PASSWORD);
  const status = data.enabled && ready ? { text: "Sending up to 10 a day, weekdays at 10am", tone: "bg-emerald-50 text-[#7a5818] ring-emerald-200" }
    : data.enabled ? { text: "Switched on, waiting for the mailbox connection", tone: "bg-amber-50 text-amber-900 ring-amber-200" }
    : { text: "Automatic email is off", tone: "bg-slate-100 text-slate-700 ring-slate-200" };

  return <section className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 sm:px-6">
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold">Email</h1>
        <p className="text-sm text-slate-600">One short first email to businesses with a weak website and a public email address. Never more than {HARD_DAILY_CAP} a day, never twice, never after an unsubscribe or a &ldquo;do not contact&rdquo;.</p>
      </div>
      <span className={`rounded-full px-3 py-1 text-sm font-medium ring-1 ring-inset ${status.tone}`}>{status.text}</span>
    </header>

    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
      <Stat icon={Send} label="Sent today" value={`${data.sentToday} / ${Math.min(HARD_DAILY_CAP, data.dailyCap)}`} />
      <Stat icon={MailCheck} label="Sent all time" value={data.sentTotal} />
      <Stat icon={Inbox} label="Ready to email" value={data.eligible} />
      <Stat icon={CheckCircle2} label="Emails found" value={data.withEmail} />
      <Stat icon={Ban} label="Unsubscribed / blocked" value={data.suppressed} />
      <Stat icon={MailX} label="Failed" value={data.failedTotal} />
    </div>

    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="font-semibold">The email they get</h2>
        {data.preview ? <>
          <p className="mt-3 text-sm"><span className="text-slate-600">To:</span> {data.preview.to}</p>
          <p className="text-sm"><span className="text-slate-600">Subject:</span> {data.preview.subject}</p>
          <pre className="mt-3 whitespace-pre-wrap rounded-lg bg-slate-50 p-4 font-sans text-sm leading-relaxed">{data.preview.text}</pre>
        </> : <p className="mt-3 text-sm text-slate-600">No business is ready to email yet. The engine collects public emails from business websites on its next run.</p>}
      </div>
      <aside className="h-fit space-y-3 rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="font-semibold">Controls</h2>
        <p className="text-sm text-slate-600">{data.templateApproved ? "Email approved." : "Read the email on the left. Approve it before it can be switched on."}</p>
        <EmailSwitch enabled={data.enabled} templateApproved={data.templateApproved} ready={ready} />
        <p className="text-xs text-slate-600">Replies land in the riley@getaxiom.ca inbox. Log them on the call list. Unsubscribes are automatic and permanent.</p>
      </aside>
    </div>

    <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
      <h2 className="border-b border-slate-200 px-5 py-3 font-semibold">Sent</h2>
      {data.recent.length ? <table className="w-full text-left text-sm">
        <thead className="text-xs uppercase tracking-wide text-slate-600"><tr><th className="px-5 py-2">Business</th><th className="px-5 py-2">Email</th><th className="px-5 py-2">When</th><th className="px-5 py-2">Status</th></tr></thead>
        <tbody>{data.recent.map((row) => <tr key={row.sendId} className="border-t border-slate-100">
          <td className="px-5 py-2 font-medium">{row.name}</td><td className="px-5 py-2">{row.email}</td><td className="px-5 py-2">{shortDay(row.createdAt)}</td>
          <td className="px-5 py-2">{row.unsubscribed ? <span className="text-rose-700">Unsubscribed</span> : row.status === "SENT" ? "Sent" : row.status === "FAILED" ? <span className="text-rose-700" title={row.detail ?? ""}>Failed</span> : "Sending"}</td>
        </tr>)}</tbody>
      </table> : <p className="px-5 py-6 text-sm text-slate-600">Nothing sent yet.</p>}
    </div>
  </section>;
}
