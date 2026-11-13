import { readFccReplyCheck } from "@/lib/fcc-campaign-control";
import { torontoDay, torontoWeekday } from "@/lib/fcc-campaign-sender";
import { fccScreen } from "@/lib/fcc-campaign-status";
import { torontoMinute } from "@/lib/fcc-campaign-tick";
import { readKv } from "@/lib/outreach/outreach-control";
import { PAUSE_BOUNCES, inboxBouncesToday, inboxRef } from "@/lib/outreach/outreach-inboxes";
import { OUTREACH_REPLY_HOURS, OUTREACH_REPLY_STATE } from "@/lib/outreach/outreach-replies";
import { readInboxes, type Inbox } from "@/lib/outreach/outreach-model";
import { OUTREACH_AUTO_PAUSE_BY } from "@/lib/outreach/outreach-sender";
import { campaignSummaries } from "@/lib/outreach/outreach-status";
import type { ProspectDb } from "@/lib/revenue-engine/engine-prospects-d1";

/**
 * Self-check that runs every 15 minutes on the live Worker. Read-only: it never
 * changes business data or switches, it only tells Riley and Aidan when something
 * is wrong with the campaign emails, the inboxes or the screens, in plain words, and
 * when it is fixed again. FCC ended on Nov 12, 2026: it being paused is normal and no
 * longer a problem; it being switched on again is one.
 */
export type HealthCheck = { key: string; ok: boolean; problem: string; fix: string };
export type HealthEnv = Record<string, unknown>;

const when = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", weekday: "short", hour: "numeric", minute: "2-digit" }).format(new Date(iso));

export async function runHealthChecks(db: ProspectDb, env: HealthEnv, now = new Date()): Promise<HealthCheck[]> {
  const checks: HealthCheck[] = [];
  const add = (key: string, ok: boolean, problem: string, fix: string) => checks.push({ key, ok, problem, fix });

  let dbOk = true;
  try { await db.prepare("SELECT 1 AS n").bind().first(); } catch { dbOk = false; }
  add("database", dbOk, "The app can't reach its database, so no campaign emails can go out and the screens won't load.", "Usually Cloudflare fixes this itself within minutes. If it lasts over an hour, ask Claude to check the Cloudflare D1 status.");
  if (!dbOk) return checks;

  add("login-email", Boolean(env.LOGIN_EMAIL), "Sign-in codes can't be emailed, so nobody can log in.", "Ask Claude to restore the LOGIN_EMAIL email binding and redeploy.");

  // FCC ended on Nov 12, 2026 and stays paused, so a pause there is no longer reported, and neither is a locked or a
  // quiet FCC. Those checks are simply no longer made: a check that is not made sends nothing, so an alert that was
  // open when they went gets no "fixed" email either. Only FCC sending again is a problem. Numbers that can't be read
  // are reported, and every campaign and inbox check below runs all the same.
  let fcc: Awaited<ReturnType<typeof fccScreen>> | null = null;
  try { fcc = await fccScreen(db, now); } catch { fcc = null; }
  add("fcc-screen", fcc !== null, "The old FCC numbers can't be read, so the FCC archive screen may not load. Campaign emails are not affected.", "Ask Claude to check the Worker logs for the FCC status queries.");
  if (fcc) {
    add("fcc-live", fcc.state !== "live",
      "FCC emails are switched on again. FCC ended on Nov 12, 2026 and should stay paused.",
      "Open More, FCC archive and press Pause, unless you both decided to restart it.");
  }

  const minute = torontoMinute(now);

  // Each campaign: an automatic pause (a founder's own Pause needs no email), and a live campaign with approved people
  // waiting that has sent nothing an hour into its send hours.
  const campaigns = await campaignSummaries(db, now).catch(() => null);
  add("campaigns-screen", campaigns !== null, "The campaign numbers can't be read, so these checks can't see the campaigns.", "Ask Claude to check the Worker logs for the campaign queries.");
  for (const { campaign, counts } of campaigns ?? []) {
    const autoPaused = campaign.state === "paused" && campaign.stateBy === OUTREACH_AUTO_PAUSE_BY;
    add(`campaign-paused:${campaign.key}`, !autoPaused,
      `The ${campaign.name} campaign paused itself: ${campaign.stateReason ?? "no reason saved"}${campaign.stateAt ? ` (${when(campaign.stateAt)})` : ""}. Nothing in it sends until someone presses Resume.`,
      "Read the reason on its Campaigns screen. Once it's sorted, press Resume there.");
    const sendDay = campaign.sendDays.includes(torontoWeekday(now)) && (!campaign.startDay || torontoDay(now) >= campaign.startDay) && (!campaign.endDay || torontoDay(now) <= campaign.endDay);
    const silent = sendDay && campaign.state === "live" && !campaign.problem && counts.ready + counts.followUpsDue > 0 && counts.sentToday === 0
      && minute >= campaign.windowStart + 60 && minute < campaign.windowEnd;
    add(`campaign-sending:${campaign.key}`, !silent,
      `No ${campaign.name} emails have gone out today, though it is live and ${counts.ready + counts.followUpsDue} ${counts.ready + counts.followUpsDue === 1 ? "is" : "are"} waiting.`,
      `Look at "Last check" on its Campaigns screen for the reason, then ask Claude to read the Worker logs.`);
  }

  // An inbox sends nothing more today once 3 of its emails bounced, whatever sent them. That is not a pause, so the
  // pause alerts stay quiet (Aidan, Nov 5: a city bounce never pauses anything else); this says why the inbox went quiet.
  const fccFirstInbox = typeof env.FCC_SENDER_ADDRESS === "string" ? env.FCC_SENDER_ADDRESS : null;
  for (const inbox of (await readInboxes(db).catch(() => [] as Inbox[])).filter((row) => row.enabled)) {
    const bounces = await inboxBouncesToday(db, torontoDay(now), inboxRef(inbox.address, fccFirstInbox)).catch(() => 0);
    const owner = inbox.name.trim().split(/\s+/)[0] || inbox.address;
    add(`inbox-resting:${inbox.address}`, bounces < PAUSE_BOUNCES,
      `${owner}'s inbox (${inbox.address}) has stopped sending for today: ${bounces} of its emails bounced today. Nothing is paused; it starts again tomorrow.`,
      "Look at who bounced on the campaign's screen. If one list is bad, pause that campaign before tomorrow.");
  }

  // The campaigns' hourly reply check (7:00 to 21:00, every day). Once anyone has been emailed, a check that hasn't
  // finished for 2 hours inside those hours, or an inbox it couldn't open, means a city reply could sit unseen
  // (Riley, Nov 5: "a city reply is never missed, whichever inbox it lands in").
  const emailedAny = Number((await db.prepare(`SELECT COUNT(*) AS n FROM "OutreachContact" WHERE "firstSentAt" IS NOT NULL`).bind()
    .first<{ n: number }>().catch(() => null))?.n ?? 0) > 0;
  if (emailedAny) {
    const replies = await readKv<{ at?: string; unread?: string[] }>(db, OUTREACH_REPLY_STATE).catch(() => null);
    const inHours = minute >= OUTREACH_REPLY_HOURS.from + 120 && minute < OUTREACH_REPLY_HOURS.to + 30;
    const stale = inHours && (!replies?.at || Date.parse(replies.at) < now.getTime() - 2 * 3_600_000);
    add("campaign-reply-check", !stale,
      `The hourly check of the inboxes for campaign replies hasn't finished since ${replies?.at ? when(replies.at) : "it started"}, so a city reply could be waiting unseen.`,
      "Look in both Gmail inboxes yourself today, then ask Claude to read the Worker logs (an inbox's app password may have changed).");
    const unread = replies?.unread ?? [];
    add("campaign-reply-inboxes", unread.length === 0,
      `The last reply check couldn't open ${unread.join(" and ")}, so replies there may be waiting unseen.`,
      "Look in that inbox yourself, then ask Claude to check it (its app password may have changed).");
  }

  // FCC's 9 a.m. reply check still runs (people emailed before Nov 12 can still answer) and emails both founders who
  // wrote back. If it hasn't finished by 10:30, replies sit unseen.
  const replyCheck = await readFccReplyCheck(db).catch(() => null);
  const replyCheckLate = minute >= 10 * 60 + 30 && replyCheck?.day !== torontoDay(now);
  add("fcc-reply-check", !replyCheckLate,
    "Today's 9 a.m. reply check hasn't finished, so replies may be waiting in the inboxes unseen.",
    "Check both Gmail inboxes yourself today, then ask Claude to look at the reply check (an inbox's app password may have changed).");

  return checks;
}

type AlertState = { checkKey: string; status: "OK" | "PROBLEM"; lastNotifiedAt: string | null; since: string };

/** Decides which changes are worth an email: new problems, fixes, and a daily reminder. */
export async function recordAndSelectAlerts(db: ProspectDb, checks: HealthCheck[], now = new Date()) {
  const { results } = await db.prepare(`SELECT "checkKey","status","lastNotifiedAt","since" FROM "HealthAlertState"`).bind().all<AlertState>();
  const previous = new Map(results.map((row) => [row.checkKey, row]));
  const newProblems: HealthCheck[] = []; const reminders: HealthCheck[] = []; const fixed: HealthCheck[] = [];
  const at = now.toISOString();
  for (const check of checks) {
    const before = previous.get(check.key);
    const status = check.ok ? "OK" : "PROBLEM";
    let notify = false;
    if (!check.ok && before?.status !== "PROBLEM") { newProblems.push(check); notify = true; }
    else if (!check.ok && (!before?.lastNotifiedAt || Date.parse(before.lastNotifiedAt) < now.getTime() - 24 * 3_600_000)) { reminders.push(check); notify = true; }
    else if (check.ok && before?.status === "PROBLEM") { fixed.push(check); notify = true; }
    await db.prepare(`INSERT INTO "HealthAlertState" ("checkKey","status","summary","since","lastNotifiedAt","updatedAt") VALUES (?,?,?,?,?,?)
      ON CONFLICT("checkKey") DO UPDATE SET "status"=excluded."status","summary"=excluded."summary",
        "since"=CASE WHEN "HealthAlertState"."status"=excluded."status" THEN "HealthAlertState"."since" ELSE excluded."since" END,
        "lastNotifiedAt"=COALESCE(excluded."lastNotifiedAt","HealthAlertState"."lastNotifiedAt"),"updatedAt"=excluded."updatedAt"`)
      .bind(check.key, status, check.ok ? "OK" : check.problem.slice(0, 500), at, notify ? at : null, at).run();
  }
  return { newProblems, reminders, fixed };
}

/** What each check says once it's fine again. */
const FIXED: Record<string, string> = {
  database: "The database is reachable again.",
  "login-email": "Sign-in codes can be emailed again.",
  "fcc-screen": "The old FCC numbers can be read again.",
  "fcc-live": "FCC emails are paused again.",
  "fcc-reply-check": "Today's reply check has finished.",
  "campaigns-screen": "The campaign numbers can be read again.",
  "campaign-reply-check": "The hourly check of the inboxes for campaign replies is finishing again.",
  "campaign-reply-inboxes": "Every inbox can be read for replies again.",
};
const fixedText = (check: HealthCheck) => FIXED[check.key]
  ?? (check.key.startsWith("campaign-paused:") ? `The ${check.key.slice(16)} campaign is no longer paused.`
    : check.key.startsWith("campaign-sending:") ? `${check.key.slice(17)} campaign emails are going out again.`
      : check.key.startsWith("inbox-resting:") ? `${check.key.slice(14)} can send again today.`
      : `${check.key.replace(/-/g, " ")} is working again.`);

export function alertEmail(alerts: Awaited<ReturnType<typeof recordAndSelectAlerts>>) {
  const broken = [...alerts.newProblems, ...alerts.reminders];
  if (!broken.length && !alerts.fixed.length) return null;
  const subject = broken.length
    ? `⚠️ Axiom engine: ${broken.length === 1 ? broken[0]!.problem.split(/[.:]/)[0] : `${broken.length} things need attention`}`
    : `✅ Axiom engine: ${alerts.fixed.length === 1 ? fixedText(alerts.fixed[0]!).replace(/\.$/, "") : `${alerts.fixed.length} issues fixed`}`;
  const lines: string[] = [];
  if (alerts.newProblems.length) lines.push("Something just went wrong:", ...alerts.newProblems.flatMap((c) => [`• ${c.problem}`, `  What to do: ${c.fix}`]), "");
  if (alerts.reminders.length) lines.push("Still not fixed (daily reminder):", ...alerts.reminders.flatMap((c) => [`• ${c.problem}`, `  What to do: ${c.fix}`]), "");
  if (alerts.fixed.length) lines.push("Fixed now, no action needed:", ...alerts.fixed.map((c) => `• ${fixedText(c)}`), "");
  lines.push("This is an automatic check that runs every 15 minutes on operations.getaxiom.ca. You'll only hear from it when something changes.");
  const text = lines.join("\n");
  const html = `<!doctype html><html><body style="margin:0;background:#f7f5ef;font-family:Inter,Segoe UI,Arial,sans-serif;color:#0a0a0a"><div style="max-width:560px;margin:24px auto;background:#fffdf8;border:1px solid #e6e1d6;border-radius:14px;overflow:hidden"><div style="background:#0a0a0a;color:#f2f0ea;padding:16px 22px;font-size:12px;letter-spacing:.24em;font-weight:700">AXIOM · HEALTH</div><pre style="white-space:pre-wrap;font-family:inherit;font-size:14px;line-height:1.55;margin:0;padding:20px 22px">${text.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!)}</pre></div></body></html>`;
  return { subject, text, html };
}

export const OWNER_ALERT_INBOXES = ["rileyhinsperger@gmail.com", "aidanmageebusiness@gmail.com"] as const;
