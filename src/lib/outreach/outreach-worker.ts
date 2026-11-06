/**
 * The Worker's send tick (cron `* 14-19 * * *`, every minute): for each sending inbox, side by side,
 * the campaigns' tick runs first and FCC's tick runs only when no campaign email left that inbox this
 * minute. So a campaign goes first in any inbox it shares with FCC (Riley, Nov 5: "While FCC runs,
 * cities go first"), and both share the inbox's daily amount and its 1-3 minute gap.
 *
 * Inboxes come from OutreachInbox rows; each one's app password is the Worker secret its row names.
 * Adding an inbox is a row plus `wrangler secret put <NAME>`, no code change.
 */
import { connect } from "cloudflare:sockets";

import { fccMailboxFromImap, type FccMailbox } from "@/lib/fcc-campaign-sender";
import { runFccSendTick, type FccTickResult } from "@/lib/fcc-campaign-tick";
import { fccReplyInboxFromImap } from "@/lib/fcc-campaign-replies";
import { fccInboxes, foundersMailer, sendConfig, type FccEnv, type OwnerEmail } from "@/lib/fcc-campaign-worker";
import { runOutreachReplyCheck } from "@/lib/outreach/outreach-replies";
import { inboxRef } from "@/lib/outreach/outreach-inboxes";
import { readInboxes, type Inbox } from "@/lib/outreach/outreach-model";
import { runOutreachTick, type OutreachInboxConfig, type OutreachTickResult } from "@/lib/outreach/outreach-sender";
import { runOutreachTestSends } from "@/lib/outreach/outreach-tests";
import type { EmailTransport } from "@/lib/revenue-engine/engine-email";
import type { ProspectDb } from "@/lib/revenue-engine/engine-prospects-d1";
import { openImap, type ImapSession } from "@/lib/revenue-engine/imap-client";
import { openSmtp, type SmtpStream } from "@/lib/revenue-engine/smtp-client";

export type OutreachEnv = FccEnv & Record<string, unknown>;

async function tls(hostname: string, port: number): Promise<SmtpStream> {
  const socket = connect({ hostname, port }, { secureTransport: "on", allowHalfOpen: false });
  await socket.opened;
  return { readable: socket.readable, writable: socket.writable, close: () => socket.close() };
}

/** Port 587 (Proton's submission server): a plain connection, upgraded with STARTTLS before the login. */
async function startTlsConnection(hostname: string, port: number) {
  const socket = connect({ hostname, port }, { secureTransport: "starttls", allowHalfOpen: false });
  await socket.opened;
  const stream: SmtpStream = { readable: socket.readable, writable: socket.writable, close: () => socket.close() };
  const startTls = async (): Promise<SmtpStream> => {
    const secure = socket.startTls();
    await secure.opened;
    return { readable: secure.readable, writable: secure.writable, close: () => secure.close() };
  };
  return { stream, startTls };
}

const secret = (env: OutreachEnv, name: string) => (typeof env[name] === "string" ? (env[name] as string).trim() : "");

/** "smtp.protonmail.ch:587" or "smtp.gmail.com" (port 465). */
export function hostAndPort(value: string, fallback: number) {
  const match = /^(.+):(\d{2,5})$/.exec(value.trim());
  return match ? { host: match[1]!, port: Number(match[2]) } : { host: value.trim(), port: fallback };
}

/** An inbox's SMTP and IMAP, or nulls when its password secret isn't set. SMTP on port 587 uses STARTTLS; any other port, TLS from the start. */
export function inboxConnections(env: OutreachEnv, inbox: Inbox) {
  const password = secret(env, inbox.passwordSecret);
  if (!password) return { transport: null, imap: null };
  const smtp = hostAndPort(inbox.smtpHost, 465);
  const login = { host: smtp.host, username: inbox.address, password, fromName: inbox.name, fromAddress: inbox.address };
  const transport = async (): Promise<EmailTransport> => {
    if (smtp.port === 587) {
      const { stream, startTls } = await startTlsConnection(smtp.host, smtp.port);
      return openSmtp(stream, login, () => crypto.randomUUID(), { startTls });
    }
    return openSmtp(await tls(smtp.host, smtp.port), login, () => crypto.randomUUID());
  };
  const imap = async (): Promise<ImapSession> => openImap(await tls(inbox.imapHost, 993), { username: inbox.address, password });
  return { transport, imap };
}

export function outreachConfig(env: OutreachEnv, inbox: Inbox): OutreachInboxConfig {
  const { transport, imap } = inboxConnections(env, inbox);
  return {
    inbox,
    ref: inboxRef(inbox.address, env.FCC_SENDER_ADDRESS),
    sender: { name: inbox.name, address: inbox.address },
    mailingAddress: env.FCC_CAMPAIGN_MAILING_ADDRESS,
    transport,
    mailbox: imap ? async (): Promise<FccMailbox> => fccMailboxFromImap(await imap()) : null,
    newId: () => crypto.randomUUID(),
  };
}

/**
 * Worker cron entry (every 15 minutes): the campaigns' reply check, once an hour from 7:00 to 21:00 Toronto. It reads
 * every sending inbox, whichever one sent the email, and tells both founders about new replies.
 */
export async function runOutreachReplyCheckCron(env: OutreachEnv, sendOwnerEmail?: OwnerEmail, now = new Date()) {
  const db = env.DB as ProspectDb;
  const inboxes = (await readInboxes(db).catch(() => [] as Inbox[])).filter((inbox) => inbox.enabled);
  const readable = inboxes.map((inbox) => ({ inbox, imap: inboxConnections(env, inbox).imap })).filter((row) => row.imap);
  const base = (env.APP_BASE_URL?.trim() || "https://operations.getaxiom.ca/").replace(/\/?$/, "/");
  const fccReadable = fccInboxes(env).filter((inbox) => inbox.address && inbox.password);
  return runOutreachReplyCheck(db, {
    screenUrl: `${base}campaigns`,
    inboxes: readable.map(({ inbox, imap }) => ({ address: inbox.address, open: async () => fccReplyInboxFromImap(await imap!()) })),
    tellFounders: foundersMailer(env, fccReadable, sendOwnerEmail),
  }, now);
}

/** Worker cron entry (every 15 minutes): sends any test emails a founder queued on a batch, to their own inbox only. */
export async function runOutreachTestCron(env: OutreachEnv, now = new Date()) {
  return runOutreachTestSends(env.DB as ProspectDb, {
    mailingAddress: env.FCC_CAMPAIGN_MAILING_ADDRESS,
    transportFor: (inbox) => inboxConnections(env, inbox).transport,
    newId: () => crypto.randomUUID(),
  }, now);
}

export type SendCronResult = { fcc: FccTickResult & { inboxes?: Record<string, FccTickResult> }; campaigns: Record<string, OutreachTickResult> };

const failed = (error: unknown) => `tick failed: ${error instanceof Error ? error.message.slice(0, 200) : "unknown"}`;

export async function runSendCron(env: OutreachEnv, now = new Date()): Promise<SendCronResult> {
  const db = env.DB as ProspectDb;
  // Before migration 0089 (or if the table can't be read) this is FCC exactly as before.
  const inboxes = await readInboxes(db).catch(() => [] as Inbox[]);
  const fcc = fccInboxes(env);
  const addresses = [...new Set([...fcc.map((inbox) => inbox.address.trim().toLowerCase()), ...inboxes.filter((inbox) => inbox.enabled).map((inbox) => inbox.address)])].filter(Boolean);
  const rows = await Promise.all(addresses.map(async (address) => {
    const settings = inboxes.find((inbox) => inbox.address === address && inbox.enabled);
    const campaign: OutreachTickResult = settings
      ? await runOutreachTick(db, outreachConfig(env, settings), now).catch((error): OutreachTickResult => ({ status: "SKIPPED", reason: failed(error) }))
      : { status: "SKIPPED", reason: "no settings row" };
    const fccInbox = fcc.find((inbox) => inbox.address.trim().toLowerCase() === address);
    const fccResult: FccTickResult | null = !fccInbox ? null
      : campaign.status === "SENT" ? { status: "SKIPPED", reason: "a campaign email went from this inbox this minute" }
        : await runFccSendTick(db, sendConfig(env, fccInbox)).catch((error): FccTickResult => ({ status: "SKIPPED", reason: failed(error) }));
    return { address, campaign, fcc: fccResult, fccInbox };
  }));
  // FCC's log line keeps its old shape: the first inbox's result, with each inbox's under `inboxes` when there are two.
  const fccRows = rows.filter((row) => row.fcc && row.fccInbox).sort((a, b) => Number(b.fccInbox!.primary) - Number(a.fccInbox!.primary));
  const headline = fccRows[0]?.fcc ?? { status: "SKIPPED", reason: "sender not configured" } as FccTickResult;
  const fccResult = fccRows.length > 1 ? { ...headline, inboxes: Object.fromEntries(fccRows.map((row) => [row.fccInbox!.name, row.fcc!])) } : headline;
  return { fcc: fccResult, campaigns: Object.fromEntries(rows.map((row) => [row.address, row.campaign])) };
}
