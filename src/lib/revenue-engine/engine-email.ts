import type { ProspectDb } from "./engine-prospects-d1";

/**
 * First-touch email outreach for engine prospects (migration 0076).
 *
 * Every gate must pass before anything is sent: the Worker switch, the owner's
 * database switch, owner approval of this exact template version, SMTP
 * configuration, a weekday, and the daily cap. Each business and each address is
 * emailed at most once, ever; follow-ups are deliberately not implemented.
 */
export const EMAIL_TEMPLATE_VERSION = "first-touch-v1";
export const SENDER_POSTAL_ADDRESS = "Axiom Web, 257 Kipling Ave, Kitchener, ON N2C 2B9";
export const HARD_DAILY_CAP = 10;

export type EmailCandidate = { prospectId: string; name: string; city: string; niche: string; websiteUrl: string; reasons: string[]; email: string; sourceUrl: string };
export type OutgoingEmail = { to: string; subject: string; text: string; headers: Record<string, string> };
export type EmailTransport = { send(message: OutgoingEmail): Promise<void>; close(): Promise<void> };
export type EmailRunConfig = {
  workerSwitch: boolean; fromName: string; fromAddress: string; baseUrl: string;
  transport: (() => Promise<EmailTransport>) | null;
  newId: () => string; newToken: () => string;
};
export type EmailRunResult =
  | { status: "SKIPPED"; reason: string }
  | { status: "RAN"; sent: number; failed: number; remainingToday: number };

/** Permanent SMTP rejections that mean the address should never be tried again. */
export class PermanentEmailError extends Error {}

const torontoDay = (now: Date) => now.toLocaleDateString("en-CA", { timeZone: "America/Toronto" });
const torontoWeekday = (now: Date) => new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "America/Toronto" }).format(now);
const host = (url: string) => new URL(url).hostname.replace(/^www\./, "");

/** Plain-text first email. Only uses observed website problems; makes no claims about results. */
export function composeFirstEmail(candidate: EmailCandidate, unsubscribeUrl: string, fromName: string): { subject: string; text: string } {
  const site = host(candidate.websiteUrl);
  const reasons = candidate.reasons.slice(0, 2).map((reason) => `- ${reason}`).join("\n");
  const first = fromName.split(" ")[0] ?? fromName;
  const text = [
    `Hi ${candidate.name} team,`,
    "",
    `I'm ${first}, a web designer in Kitchener-Waterloo. I had a look at ${site} and noticed a couple of things that can make it harder for customers to reach you, especially on a phone:`,
    reasons,
    "",
    "If it would be useful, I can put together a free mock-up of a faster, phone-friendly version so you can see the difference. No obligation either way.",
    "",
    "Would that be worth a look?",
    "",
    fromName,
    "Axiom Web",
    "",
    "--",
    SENDER_POSTAL_ADDRESS,
    `You're receiving this because ${candidate.email} is listed on ${site}.`,
    `To stop all emails from us: ${unsubscribeUrl}`,
  ].join("\n");
  return { subject: `Quick question about the ${candidate.name} website`, text };
}

const CLOSED_OUTCOMES = `('NOT_INTERESTED','WON','WRONG_NUMBER','DO_NOT_CONTACT','MEETING_BOOKED','INTERESTED','CALL_BACK')`;

/** Weak-website businesses with a public email, never emailed, not suppressed, not closed or mid-conversation. */
export async function listEmailCandidates(db: ProspectDb, limit: number): Promise<EmailCandidate[]> {
  const { results } = await db.prepare(`
    SELECT p."prospectId", p."name", p."city", p."niche", p."websiteUrl", p."reasons", e."email", e."sourceUrl"
    FROM "EngineProspect" p JOIN "EngineProspectEmail" e ON e."prospectId" = p."prospectId"
    WHERE p."label" = 'STRONG' AND p."websiteUrl" IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM "EngineEmailSend" s WHERE s."prospectId" = p."prospectId" OR s."email" = e."email")
      AND NOT EXISTS (SELECT 1 FROM "EngineEmailSuppression" x WHERE x."email" = e."email" OR x."email" = '@' || substr(e."email", instr(e."email", '@') + 1))
      AND NOT EXISTS (SELECT 1 FROM "EngineProspectActivity" a WHERE a."prospectId" = p."prospectId" AND a."outcome" IN ${CLOSED_OUTCOMES})
    ORDER BY p."firstSeenAt", p."prospectId" LIMIT ?`).bind(limit).all<Record<string, string>>();
  return results.map((row) => {
    let reasons: string[] = [];
    try { reasons = JSON.parse(row.reasons ?? "[]") as string[]; } catch { reasons = []; }
    return { prospectId: row.prospectId!, name: row.name!, city: row.city!, niche: row.niche!, websiteUrl: row.websiteUrl!, reasons, email: row.email!, sourceUrl: row.sourceUrl! };
  });
}

export async function emailSetting(db: ProspectDb) {
  return db.prepare(`SELECT "enabled","dailyCap","templateApprovedVersion" FROM "EngineEmailSetting" WHERE "id" = 1`).bind()
    .first<{ enabled: number; dailyCap: number; templateApprovedVersion: string | null }>();
}

export async function sentToday(db: ProspectDb, day: string) {
  return Number((await db.prepare(`SELECT COUNT(*) AS n FROM "EngineEmailSend" WHERE "sendDay" = ? AND "status" IN ('CLAIMED','SENT')`).bind(day).first<{ n: number }>())?.n ?? 0);
}

/** One daily batch. Safe to re-run: claims are unique per business and per address. */
export async function runDailyEmail(db: ProspectDb, config: EmailRunConfig, now = new Date()): Promise<EmailRunResult> {
  if (!config.workerSwitch) return { status: "SKIPPED", reason: "worker switch off" };
  const setting = await emailSetting(db);
  if (!setting) return { status: "SKIPPED", reason: "setting row missing" };
  if (setting.enabled !== 1) return { status: "SKIPPED", reason: "owner switch off" };
  if (setting.templateApprovedVersion !== EMAIL_TEMPLATE_VERSION) return { status: "SKIPPED", reason: "template not approved" };
  if (!config.transport || !config.fromAddress || !config.baseUrl) return { status: "SKIPPED", reason: "sender not configured" };
  if (["Sat", "Sun"].includes(torontoWeekday(now))) return { status: "SKIPPED", reason: "weekend" };

  const day = torontoDay(now);
  const cap = Math.min(HARD_DAILY_CAP, Math.max(0, setting.dailyCap));
  const remaining = cap - await sentToday(db, day);
  if (remaining <= 0) return { status: "SKIPPED", reason: "daily cap reached" };
  const candidates = await listEmailCandidates(db, remaining);
  if (candidates.length === 0) return { status: "SKIPPED", reason: "no eligible businesses" };

  const transport = await config.transport();
  let sent = 0; let failed = 0;
  try {
    for (const candidate of candidates) {
      const sendId = config.newId();
      const token = config.newToken();
      const claim = await db.prepare(`INSERT INTO "EngineEmailSend" ("sendId","prospectId","email","sendDay","templateVersion","unsubscribeToken","status")
        VALUES (?,?,?,?,?,?,'CLAIMED') ON CONFLICT DO NOTHING`).bind(sendId, candidate.prospectId, candidate.email, day, EMAIL_TEMPLATE_VERSION, token).run() as { changes?: number; meta?: { changes?: number } };
      if ((claim.meta?.changes ?? claim.changes ?? 0) !== 1) continue;
      const unsubscribeUrl = `${config.baseUrl.replace(/\/$/, "")}/unsubscribe?t=${token}`;
      const { subject, text } = composeFirstEmail(candidate, unsubscribeUrl, config.fromName);
      try {
        await transport.send({
          to: candidate.email, subject, text,
          headers: {
            "List-Unsubscribe": `<${config.baseUrl.replace(/\/$/, "")}/api/unsubscribe?t=${token}>, <mailto:${config.fromAddress}?subject=unsubscribe>`,
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
          },
        });
        await db.prepare(`UPDATE "EngineEmailSend" SET "status"='SENT', "finishedAt"=? WHERE "sendId"=?`).bind(new Date().toISOString(), sendId).run();
        await db.prepare(`INSERT INTO "EngineProspectActivity" ("activityId","idempotencyKey","prospectId","channel","outcome","note","followUpAt","actor","actorUserId")
          VALUES (?,?,?,'EMAIL','NOTE',?,NULL,'RILEY','engine-email') ON CONFLICT DO NOTHING`).bind(config.newId(), `email:${sendId}`, candidate.prospectId, `Automatic first email sent to ${candidate.email}`).run();
        sent += 1;
      } catch (error) {
        const detail = (error instanceof Error ? error.message : String(error)).slice(0, 300);
        await db.prepare(`UPDATE "EngineEmailSend" SET "status"='FAILED', "detail"=?, "finishedAt"=? WHERE "sendId"=?`).bind(detail, new Date().toISOString(), sendId).run();
        if (error instanceof PermanentEmailError) {
          await db.prepare(`INSERT INTO "EngineEmailSuppression" ("email","reason") VALUES (?,'BOUNCED') ON CONFLICT DO NOTHING`).bind(candidate.email).run();
        }
        failed += 1;
        if (!(error instanceof PermanentEmailError)) break; // provider trouble: stop for today, never hammer
      }
    }
  } finally {
    await transport.close().catch(() => undefined);
  }
  return { status: "RAN", sent, failed, remainingToday: Math.max(0, remaining - sent - failed) };
}

/** Unsubscribe by token. Idempotent; suppresses the address permanently. */
export async function unsubscribe(db: ProspectDb, token: string): Promise<"DONE" | "UNKNOWN"> {
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(token)) return "UNKNOWN";
  const row = await db.prepare(`SELECT "prospectId","email" FROM "EngineEmailSend" WHERE "unsubscribeToken" = ?`).bind(token).first<{ prospectId: string; email: string }>();
  if (!row) return "UNKNOWN";
  await db.prepare(`INSERT INTO "EngineEmailSuppression" ("email","reason") VALUES (?,'UNSUBSCRIBED') ON CONFLICT DO NOTHING`).bind(row.email).run();
  await db.prepare(`INSERT INTO "EngineProspectActivity" ("activityId","idempotencyKey","prospectId","channel","outcome","note","followUpAt","actor","actorUserId")
    VALUES (?,?,?,'EMAIL','DO_NOT_CONTACT','Unsubscribed from email',NULL,'RILEY','engine-email') ON CONFLICT DO NOTHING`).bind(crypto.randomUUID(), `unsubscribe:${token}`, row.prospectId).run();
  return "DONE";
}

export type EmailOverview = {
  enabled: boolean; dailyCap: number; approvedVersion: string | null; templateApproved: boolean;
  sentToday: number; sentTotal: number; failedTotal: number; eligible: number; withEmail: number; suppressed: number;
  recent: { sendId: string; name: string; email: string; status: string; detail: string | null; createdAt: string; unsubscribed: boolean }[];
  preview: { to: string; subject: string; text: string } | null;
};

/** Everything the owner's Email page shows, in a handful of queries. */
export async function emailOverview(db: ProspectDb, now = new Date()): Promise<EmailOverview> {
  const day = torontoDay(now);
  const [setting, totals, withEmail, suppressed, recent, sample] = await Promise.all([
    emailSetting(db),
    db.prepare(`SELECT SUM("status" IN ('CLAIMED','SENT') AND "sendDay" = ?) AS today, SUM("status" = 'SENT') AS sent, SUM("status" = 'FAILED') AS failed FROM "EngineEmailSend"`).bind(day).first<Record<string, number | null>>(),
    db.prepare(`SELECT COUNT(*) AS n FROM "EngineProspectEmail"`).bind().first<{ n: number }>(),
    db.prepare(`SELECT COUNT(*) AS n FROM "EngineEmailSuppression"`).bind().first<{ n: number }>(),
    db.prepare(`SELECT s."sendId", p."name", s."email", s."status", s."detail", s."createdAt",
        EXISTS (SELECT 1 FROM "EngineEmailSuppression" x WHERE x."email" = s."email" AND x."reason" = 'UNSUBSCRIBED') AS unsubscribed
      FROM "EngineEmailSend" s JOIN "EngineProspect" p ON p."prospectId" = s."prospectId" ORDER BY s."createdAt" DESC LIMIT 50`).bind().all<Record<string, unknown>>(),
    listEmailCandidates(db, 500),
  ]);
  const first = sample[0];
  return {
    enabled: setting?.enabled === 1, dailyCap: setting?.dailyCap ?? 0, approvedVersion: setting?.templateApprovedVersion ?? null,
    templateApproved: setting?.templateApprovedVersion === EMAIL_TEMPLATE_VERSION,
    sentToday: Number(totals?.today ?? 0), sentTotal: Number(totals?.sent ?? 0), failedTotal: Number(totals?.failed ?? 0),
    eligible: sample.length, withEmail: Number(withEmail?.n ?? 0), suppressed: Number(suppressed?.n ?? 0),
    recent: recent.results.map((row) => ({ sendId: String(row.sendId), name: String(row.name), email: String(row.email), status: String(row.status), detail: (row.detail as string | null) ?? null, createdAt: String(row.createdAt), unsubscribed: Boolean(row.unsubscribed) })),
    preview: first ? { to: first.email, ...composeFirstEmail(first, "https://operations.getaxiom.ca/unsubscribe?t=…", "Riley Hinsperger") } : null,
  };
}

/** Owner changes to the email switch. Turning on requires approving the current template. */
export async function updateEmailSetting(db: ProspectDb, change: { enabled: boolean; approveTemplate: boolean }, userEmail: string) {
  const setting = await emailSetting(db);
  if (!setting) throw new Error("EMAIL_SETTING_MISSING");
  const approved = change.approveTemplate ? EMAIL_TEMPLATE_VERSION : setting.templateApprovedVersion;
  if (change.enabled && approved !== EMAIL_TEMPLATE_VERSION) throw new Error("TEMPLATE_NOT_APPROVED");
  await db.prepare(`UPDATE "EngineEmailSetting" SET "enabled" = ?, "templateApprovedVersion" = ?, "updatedAt" = ?, "updatedBy" = ? WHERE "id" = 1`)
    .bind(change.enabled ? 1 : 0, approved, new Date().toISOString(), userEmail.slice(0, 160)).run();
  return { enabled: change.enabled, templateApprovedVersion: approved };
}
