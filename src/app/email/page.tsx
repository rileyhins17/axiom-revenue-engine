import type { Metadata } from "next";
import { AlertTriangle, Ban, CheckCircle2, Inbox, List, Mail, MailCheck, MailX, Send, SlidersHorizontal } from "lucide-react";

import { EmailSwitch } from "@/components/email/email-switch";
import { Badge, Empty, Notice, OwnerPage, PageHeader, Panel, StatCard } from "@/components/owner/kit";
import { getCloudflareBindings, getDatabase } from "@/lib/cloudflare";
import { shortDay } from "@/lib/prospect-format";
import { emailOverview, HARD_DAILY_CAP, type EmailOverview } from "@/lib/revenue-engine/engine-email";
import type { ProspectDb } from "@/lib/revenue-engine/engine-prospects-d1";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Email | Axiom Revenue Engine" };

export default async function EmailPage() {
  await requireSession();
  let data: EmailOverview;
  try {
    data = await emailOverview(getDatabase() as unknown as ProspectDb);
  } catch {
    return <OwnerPage><PageHeader eyebrow="Archive: Axiom Web" title="Website email" /><Notice tone="warning" icon={AlertTriangle} title="Email data isn't available yet." role="status">Refresh in a minute.</Notice></OwnerPage>;
  }
  const env = (getCloudflareBindings() ?? {}) as Record<string, unknown>;
  const ready = env.ENGINE_EMAIL_ENABLED === "true" && Boolean(env.ENGINE_SMTP_PASSWORD);
  const status = data.enabled && ready ? { text: "Sending up to 10 a day, weekdays at 10am", tone: "success" as const }
    : data.enabled ? { text: "Switched on, waiting for the mailbox connection", tone: "warning" as const }
    : { text: "Automatic email is off", tone: "neutral" as const };

  return <OwnerPage>
    <PageHeader eyebrow="Archive: Axiom Web" title="Website email" status={<Badge tone={status.tone}>{status.text}</Badge>}
      description={<>The old website campaign&apos;s automatic email, archived and off. FCC emails are on the FCC screen. This one sent one short first email to businesses with a weak website and a public email address. Never more than {HARD_DAILY_CAP} a day, never twice, never after an unsubscribe or a &ldquo;do not contact&rdquo;.</>} />

    <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3">
      <StatCard icon={Send} label="Sent today" value={`${data.sentToday} / ${Math.min(HARD_DAILY_CAP, data.dailyCap)}`} />
      <StatCard icon={MailCheck} label="Sent all time" value={data.sentTotal} />
      <StatCard icon={Inbox} label="Ready to email" value={data.eligible} />
      <StatCard icon={CheckCircle2} label="Emails found" value={data.withEmail} />
      <StatCard icon={Ban} label="Unsubscribed / blocked" value={data.suppressed} />
      <StatCard icon={MailX} label="Failed" value={data.failedTotal} />
    </div>

    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
      <Panel title="The email they get" icon={Mail}>
        {data.preview ? <>
          <p className="text-sm"><span className="text-[#5c584f]">To:</span> {data.preview.to}</p>
          <p className="text-sm"><span className="text-[#5c584f]">Subject:</span> {data.preview.subject}</p>
          <pre className="mt-3 whitespace-pre-wrap rounded-xl bg-[#f6f1e6] p-4 font-sans text-sm leading-relaxed">{data.preview.text}</pre>
        </> : <Empty>No business is ready to email yet. The engine collects public emails from business websites on its next run.</Empty>}
      </Panel>
      <Panel title="Controls" icon={SlidersHorizontal} description={data.templateApproved ? "Email approved." : "Read the email on the left. Approve it before it can be switched on."}>
        <EmailSwitch enabled={data.enabled} templateApproved={data.templateApproved} ready={ready} />
        <p className="owner-meta mt-3">Replies land in the riley@getaxiom.ca inbox. Log them on the call list. Unsubscribes are automatic and permanent.</p>
      </Panel>
    </div>

    <Panel title="Sent" icon={List} flush>
      {data.recent.length ? <div className="overflow-x-auto"><table className="owner-table min-w-[560px]">
        <thead><tr><th>Business</th><th>Email</th><th>When</th><th>Status</th></tr></thead>
        <tbody>{data.recent.map((row) => <tr key={row.sendId}>
          <td className="font-semibold">{row.name}</td><td>{row.email}</td><td className="whitespace-nowrap">{shortDay(row.createdAt)}</td>
          <td>{row.unsubscribed ? <Badge tone="danger">Unsubscribed</Badge> : row.status === "SENT" ? <Badge tone="success">Sent</Badge> : row.status === "FAILED" ? <span title={row.detail ?? ""}><Badge tone="danger">Failed</Badge></span> : <Badge tone="neutral">Sending</Badge>}</td>
        </tr>)}</tbody>
      </table></div> : <div className="px-5 py-6 sm:px-6"><Empty>Nothing sent yet.</Empty></div>}
    </Panel>
  </OwnerPage>;
}
