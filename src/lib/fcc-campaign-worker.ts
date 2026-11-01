import { connect } from "cloudflare:sockets";

import { fccReplyInboxFromImap, runFccReplyCheck, type FccOwnerMail, type FccReplyCheckResult } from "./fcc-campaign-replies";
import { fccMailboxFromImap } from "./fcc-campaign-sender";
import { runFccSendTick, type FccTickResult } from "./fcc-campaign-tick";
import { OWNER_ALERT_INBOXES } from "./ops/health";
import type { EmailTransport } from "./revenue-engine/engine-email";
import type { ProspectDb } from "./revenue-engine/engine-prospects-d1";
import { openImap } from "./revenue-engine/imap-client";
import { openSmtp, type SmtpStream } from "./revenue-engine/smtp-client";

type FccEnv = {
  DB: unknown;
  FCC_SENDER_ADDRESS?: string; FCC_SENDER_NAME?: string; FCC_SMTP_HOST?: string; FCC_IMAP_HOST?: string;
  FCC_SMTP_PASSWORD?: string; FCC_CAMPAIGN_MAILING_ADDRESS?: string; APP_BASE_URL?: string;
};
type OwnerEmail = (mail: FccOwnerMail & { to: string }) => Promise<void>;

async function tls(hostname: string, port: number): Promise<SmtpStream> {
  const socket = connect({ hostname, port }, { secureTransport: "on", allowHalfOpen: false });
  await socket.opened;
  return { readable: socket.readable, writable: socket.writable, close: () => socket.close() };
}

/** Worker cron entry: one FCC send tick a minute. Missing config or no recorded go means no send. */
export async function runFccCampaignCron(env: FccEnv): Promise<FccTickResult> {
  const from = env.FCC_SENDER_ADDRESS?.trim() ?? "";
  const password = env.FCC_SMTP_PASSWORD?.trim() ?? "";
  const fromName = env.FCC_SENDER_NAME?.trim() || "Aidan Magee";
  const smtpHost = env.FCC_SMTP_HOST?.trim() || "smtp.gmail.com";
  const imapHost = env.FCC_IMAP_HOST?.trim() || "imap.gmail.com";
  const configured = Boolean(from && password);
  return runFccSendTick(env.DB as ProspectDb, {
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

/**
 * Worker cron entry (every 15 minutes): the daily reply check, which runs once a
 * day from 9:00 Toronto. The founders hear through the engine's own alert email,
 * or from the FCC Gmail when that fails.
 */
export async function runFccReplyCheckCron(env: FccEnv, sendOwnerEmail?: OwnerEmail): Promise<FccReplyCheckResult> {
  const from = env.FCC_SENDER_ADDRESS?.trim() ?? "";
  const password = env.FCC_SMTP_PASSWORD?.trim() ?? "";
  const fromName = env.FCC_SENDER_NAME?.trim() || "Aidan Magee";
  const smtpHost = env.FCC_SMTP_HOST?.trim() || "smtp.gmail.com";
  const imapHost = env.FCC_IMAP_HOST?.trim() || "imap.gmail.com";
  const base = (env.APP_BASE_URL?.trim() || "https://operations.getaxiom.ca/").replace(/\/?$/, "/");
  return runFccReplyCheck(env.DB as ProspectDb, {
    fromAddress: from,
    screenUrl: `${base}fcc`,
    inbox: from && password
      ? async () => fccReplyInboxFromImap(await openImap(await tls(imapHost, 993), { username: from, password }))
      : null,
    async tellFounders(mail) {
      let gmail: EmailTransport | null = null;
      try {
        for (const to of OWNER_ALERT_INBOXES) {
          try {
            if (!sendOwnerEmail) throw new Error("the engine's alert email is not set up");
            await sendOwnerEmail({ to, ...mail });
          } catch {
            gmail ??= await openSmtp(await tls(smtpHost, 465), { host: smtpHost, username: from, password, fromName, fromAddress: from }, () => crypto.randomUUID());
            await gmail.send({ to, subject: mail.subject, text: mail.text, headers: {} });
          }
        }
      } finally {
        await (gmail as EmailTransport | null)?.close().catch(() => undefined);
      }
    },
  });
}
