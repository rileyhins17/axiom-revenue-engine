import { connect } from "cloudflare:sockets";

import { fccMailboxFromImap, runFccDailySend, type FccRunResult } from "./fcc-campaign-sender";
import type { ProspectDb } from "./revenue-engine/engine-prospects-d1";
import { openImap } from "./revenue-engine/imap-client";
import { openSmtp, type SmtpStream } from "./revenue-engine/smtp-client";

type FccEnv = {
  DB: unknown;
  FCC_SENDER_ADDRESS?: string; FCC_SENDER_NAME?: string; FCC_SMTP_HOST?: string; FCC_IMAP_HOST?: string;
  FCC_SMTP_PASSWORD?: string; FCC_CAMPAIGN_MAILING_ADDRESS?: string;
};

async function tls(hostname: string, port: number): Promise<SmtpStream> {
  const socket = connect({ hostname, port }, { secureTransport: "on", allowHalfOpen: false });
  await socket.opened;
  return { readable: socket.readable, writable: socket.writable, close: () => socket.close() };
}

/** Worker cron entry for the FCC weekday batch. Missing config or no recorded go means no send. */
export async function runFccCampaignCron(env: FccEnv): Promise<FccRunResult> {
  const from = env.FCC_SENDER_ADDRESS?.trim() ?? "";
  const password = env.FCC_SMTP_PASSWORD?.trim() ?? "";
  const fromName = env.FCC_SENDER_NAME?.trim() || "Aidan Magee";
  const smtpHost = env.FCC_SMTP_HOST?.trim() || "smtp.gmail.com";
  const imapHost = env.FCC_IMAP_HOST?.trim() || "imap.gmail.com";
  const configured = Boolean(from && password);
  return runFccDailySend(env.DB as ProspectDb, {
    fromAddress: from,
    mailingAddress: env.FCC_CAMPAIGN_MAILING_ADDRESS,
    newId: () => crypto.randomUUID(),
    transport: configured
      ? async () => openSmtp(await tls(smtpHost, 465), { host: smtpHost, username: from, password, fromName, fromAddress: from }, () => crypto.randomUUID())
      : null,
    mailbox: configured
      ? async () => fccMailboxFromImap(await openImap(await tls(imapHost, 993), { username: from, password }))
      : null,
  });
}
