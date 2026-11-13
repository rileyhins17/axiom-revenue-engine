/**
 * Test emails: a founder presses "Send me a test" on a batch and gets its first sample emails (each
 * first email, then its follow-up in the same thread) in their own inbox, exactly as a contact would.
 * They only ever go to the founders' own inboxes (TEST_INBOXES, fixed in code). The screen only queues
 * the request; the 15-minute check sends it, because only the Worker's schedules open mail connections.
 */
import { readKv, writeKv } from "@/lib/outreach/outreach-control";
import { readInboxes, type Inbox } from "@/lib/outreach/outreach-model";
import { batchReview } from "@/lib/outreach/outreach-status";
import { torontoDay } from "@/lib/fcc-campaign-sender";
import type { EmailTransport } from "@/lib/revenue-engine/engine-email";
import type { ProspectDb } from "@/lib/revenue-engine/engine-prospects-d1";

/** The only addresses a test email can go to: Riley's and Aidan's own. */
export const TEST_INBOXES = new Set(["rileyhinsperger@gmail.com", "aidanmageebusiness@gmail.com", "rileyhinspergerbusiness@gmail.com"]);
const REQUESTS = "outreach.testRequests";
const RESULTS = "outreach.testResults";

export type TestRequest = { id: string; batchId: string; to: string; by: string; count: number; at: string };
export type TestResult = { id: string; batchId: string; to: string; by: string; sent: number; at: string; error: string | null };

export async function requestTestSend(db: ProspectDb, request: Omit<TestRequest, "at">, now = new Date()) {
  const to = request.to.trim().toLowerCase();
  if (!TEST_INBOXES.has(to)) throw new Error("Test emails only go to Riley's or Aidan's own inbox.");
  const pending = (await readKv<TestRequest[]>(db, REQUESTS)) ?? [];
  if (pending.length >= 5) throw new Error("Five tests are already waiting; they go within 15 minutes.");
  await writeKv(db, REQUESTS, [...pending, { ...request, to, count: Math.max(1, Math.min(3, request.count)), at: now.toISOString() }], now);
}

export async function readTestResults(db: ProspectDb) {
  return { pending: (await readKv<TestRequest[]>(db, REQUESTS)) ?? [], done: (await readKv<TestResult[]>(db, RESULTS)) ?? [] };
}

/** Sends every queued test. Each request is taken off the queue before sending, so a crash can't send it twice. */
export async function runOutreachTestSends(db: ProspectDb, deps: {
  mailingAddress: string | null | undefined; transportFor: (inbox: Inbox) => (() => Promise<EmailTransport>) | null; newId: () => string;
}, now = new Date()) {
  const pending = (await readKv<TestRequest[]>(db, REQUESTS)) ?? [];
  if (pending.length === 0) return { sent: 0, requests: 0 };
  await writeKv(db, REQUESTS, [], now);
  const inboxes = await readInboxes(db);
  const results: TestResult[] = [];
  let total = 0;
  for (const request of pending) {
    let sent = 0;
    let error: string | null = null;
    try {
      if (!TEST_INBOXES.has(request.to)) throw new Error("not one of our own inboxes");
      const review = await batchReview(db, request.batchId, deps.mailingAddress, request.count);
      if (!review) throw new Error("the batch is gone");
      for (const sample of review.samples) {
        if (!sample.first) continue;
        const address = /<([^>]+)>/.exec(sample.from)?.[1] ?? "";
        const inbox = inboxes.find((row) => row.address === address);
        const open = inbox ? deps.transportFor(inbox) : null;
        if (!inbox || !open) throw new Error(`no password for ${address || "the sending inbox"}`);
        const transport = await open();
        try {
          const emails = [sample.first, ...(sample.followUp ? [sample.followUp] : [])];
          let previous: string | null = null;
          for (const [index, email] of emails.entries()) {
            const messageId = `<ax-test-${deps.newId()}@${address.split("@")[1]}>`;
            await db.prepare(`INSERT INTO "OutreachSend" ("sendId","campaignKey","contactId","kind","step","email","senderAddress","sendDay","messageId","subject","status","createdAt")
              VALUES (?,?,NULL,'test',?,?,?,?,?,?,'CLAIMED',?)`).bind(deps.newId(), review.campaign.key, index + 1, request.to, address, torontoDay(now), messageId, email.subject, new Date().toISOString()).run();
            await transport.send({
              to: request.to, subject: email.subject, text: email.text, ...(email.html ? { html: email.html } : {}),
              headers: { "Message-ID": messageId, "X-Axiom-Test": "yes", ...(previous ? { "In-Reply-To": previous, References: previous } : {}) },
            });
            await db.prepare(`UPDATE "OutreachSend" SET "status" = 'SENT', "finishedAt" = ? WHERE "messageId" = ? AND "kind" = 'test'`).bind(new Date().toISOString(), messageId).run();
            previous = messageId;
            sent += 1;
          }
        } finally {
          await transport.close().catch(() => undefined);
        }
      }
    } catch (caught) {
      error = (caught instanceof Error ? caught.message : String(caught)).slice(0, 200);
    }
    total += sent;
    results.push({ id: request.id, batchId: request.batchId, to: request.to, by: request.by, sent, at: new Date().toISOString(), error });
  }
  const done = (await readKv<TestResult[]>(db, RESULTS)) ?? [];
  await writeKv(db, RESULTS, [...results, ...done].slice(0, 10), now);
  return { sent: total, requests: pending.length };
}
