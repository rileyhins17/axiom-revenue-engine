import { connect } from "cloudflare:sockets";

import { fccReplyInboxFromImap, runFccReplyCheck, type FccOwnerMail, type FccReplyCheckResult } from "./fcc-campaign-replies";
import { fccMailboxFromImap, type FccSendConfig } from "./fcc-campaign-sender";
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
  /** A second sending inbox (Riley's, Nov 1). It only sends once its own app password is set. */
  FCC_SENDER2_ADDRESS?: string; FCC_SENDER2_NAME?: string; FCC_SMTP_PASSWORD_2?: string;
};
type OwnerEmail = (mail: FccOwnerMail & { to: string }) => Promise<void>;
/** A sending inbox: the first is always Aidan's (it may still lack a password); an added one counts only with its password. */
export type FccInbox = { address: string; name: string; password: string; primary: boolean };

async function tls(hostname: string, port: number): Promise<SmtpStream> {
  const socket = connect({ hostname, port }, { secureTransport: "on", allowHalfOpen: false });
  await socket.opened;
  return { readable: socket.readable, writable: socket.writable, close: () => socket.close() };
}

export function fccInboxes(env: FccEnv): FccInbox[] {
  const first = { address: env.FCC_SENDER_ADDRESS?.trim() ?? "", name: env.FCC_SENDER_NAME?.trim() || "Aidan Magee", password: env.FCC_SMTP_PASSWORD?.trim() ?? "", primary: true };
  const second = { address: env.FCC_SENDER2_ADDRESS?.trim() ?? "", name: env.FCC_SENDER2_NAME?.trim() || "Riley Hinsperger", password: env.FCC_SMTP_PASSWORD_2?.trim() ?? "", primary: false };
  return second.address && second.password && second.address.toLowerCase() !== first.address.toLowerCase() ? [first, second] : [first];
}

const hosts = (env: FccEnv) => ({ smtp: env.FCC_SMTP_HOST?.trim() || "smtp.gmail.com", imap: env.FCC_IMAP_HOST?.trim() || "imap.gmail.com" });

function smtpFor(env: FccEnv, inbox: FccInbox) {
  const host = hosts(env).smtp;
  return async () => openSmtp(await tls(host, 465), { host, username: inbox.address, password: inbox.password, fromName: inbox.name, fromAddress: inbox.address }, () => crypto.randomUUID());
}

function imapFor(env: FccEnv, inbox: FccInbox) {
  return async () => openImap(await tls(hosts(env).imap, 993), { username: inbox.address, password: inbox.password });
}

function sendConfig(env: FccEnv, inbox: FccInbox): FccSendConfig {
  const configured = Boolean(inbox.address && inbox.password);
  return {
    fromAddress: inbox.address,
    fromName: inbox.name,
    primary: inbox.primary,
    mailingAddress: env.FCC_CAMPAIGN_MAILING_ADDRESS,
    newId: () => crypto.randomUUID(),
    transport: configured ? smtpFor(env, inbox) : null,
    mailbox: configured ? async () => fccMailboxFromImap(await imapFor(env, inbox)()) : null,
  };
}

/**
 * Worker cron entry: one FCC send tick a minute for each inbox, side by side.
 * Missing config or no recorded go means no send. The first inbox's result is
 * the headline; with two inboxes, each one's result is under `inboxes`.
 */
export async function runFccCampaignCron(env: FccEnv): Promise<FccTickResult & { inboxes?: Record<string, FccTickResult> }> {
  const inboxes = fccInboxes(env);
  const results = await Promise.all(inboxes.map((inbox) => runFccSendTick(env.DB as ProspectDb, sendConfig(env, inbox))
    .catch((error): FccTickResult => ({ status: "SKIPPED", reason: `tick failed: ${error instanceof Error ? error.message.slice(0, 200) : "unknown"}` }))));
  if (results.length === 1) return results[0]!;
  return { ...results[0]!, inboxes: Object.fromEntries(inboxes.map((inbox, index) => [inbox.name, results[index]!])) };
}

/**
 * Worker cron entry (every 15 minutes): the daily reply check, which runs once a
 * day from 9:00 Toronto and reads every sending inbox. The founders hear through
 * the engine's own alert email, or from the first FCC Gmail when that fails.
 */
export async function runFccReplyCheckCron(env: FccEnv, sendOwnerEmail?: OwnerEmail): Promise<FccReplyCheckResult> {
  const readable = fccInboxes(env).filter((inbox) => inbox.address && inbox.password);
  const base = (env.APP_BASE_URL?.trim() || "https://operations.getaxiom.ca/").replace(/\/?$/, "/");
  return runFccReplyCheck(env.DB as ProspectDb, {
    screenUrl: `${base}fcc`,
    inboxes: readable.map((inbox) => ({ address: inbox.address, open: async () => fccReplyInboxFromImap(await imapFor(env, inbox)()) })),
    async tellFounders(mail) {
      let gmail: EmailTransport | null = null;
      try {
        for (const to of OWNER_ALERT_INBOXES) {
          try {
            if (!sendOwnerEmail) throw new Error("the engine's alert email is not set up");
            await sendOwnerEmail({ to, ...mail });
          } catch (error) {
            if (!readable[0]) throw error;
            gmail ??= await smtpFor(env, readable[0])();
            await gmail.send({ to, subject: mail.subject, text: mail.text, headers: {} });
          }
        }
      } finally {
        await (gmail as EmailTransport | null)?.close().catch(() => undefined);
      }
    },
  });
}
