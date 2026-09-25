import type { ProspectDb } from "@/lib/revenue-engine/engine-prospects-d1";

/**
 * Self-check that runs every 15 minutes on the live Worker. Read-only: it never
 * changes business data or switches, it only tells Riley and Aidan when something
 * is wrong, in plain words, and when it is fixed again.
 */
export type HealthCheck = { key: string; ok: boolean; problem: string; fix: string };
export type HealthEnv = Record<string, unknown>;

const DELIVERED = "('delivered','synced','completed','received','accepted')";
const hoursAgo = (now: Date, hours: number) => new Date(now.getTime() - hours * 3_600_000).toISOString();

async function count(db: ProspectDb, sql: string, ...binds: unknown[]) {
  const row = await db.prepare(sql).bind(...binds).first<{ n: number }>();
  return Number(row?.n ?? 0);
}

export async function runHealthChecks(db: ProspectDb, env: HealthEnv, now = new Date()): Promise<HealthCheck[]> {
  const checks: HealthCheck[] = [];
  const add = (key: string, ok: boolean, problem: string, fix: string) => checks.push({ key, ok, problem, fix });

  let dbOk = true;
  try { await db.prepare("SELECT 1 AS n").bind().first(); } catch { dbOk = false; }
  add("database", dbOk, "The app can't reach its database, so lists and call logging won't load.", "Usually Cloudflare fixes this itself within minutes. If it lasts over an hour, ask Claude to check the Cloudflare D1 status.");
  if (!dbOk) return checks;

  const safe = async <T,>(work: () => Promise<T>, fallback: T) => { try { return await work(); } catch { return fallback; } };

  const stops = await safe(async () => (await db.prepare(`SELECT enabled||globalPaused||emergencyPaused||intakePaused||followUpsPaused AS s FROM OutreachAutomationSetting LIMIT 1`).bind().first<{ s: string }>())?.s ?? null, null);
  add("safety-switches", stops === null || stops === "01111", "The old automatic outreach switches were changed from their safe OFF position.", "Nobody should turn these on. Ask Claude to review what changed and switch them back off.");

  add("login-email", Boolean(env.LOGIN_EMAIL), "Sign-in codes can't be emailed, so nobody can log in.", "Ask Claude to restore the LOGIN_EMAIL email binding and redeploy.");

  if (env.CALLER_V2_ENABLED !== undefined) {
    add("caller-enabled", env.CALLER_V2_ENABLED === "true", "Connected calling is switched off, so the Caller extension can't start new calls.", "If nobody meant to turn it off, ask Claude to set CALLER_V2_ENABLED back to true.");
  }

  const stuck = await safe(() => count(db, `SELECT COUNT(*) AS n FROM CallerProjection WHERE status NOT IN ${DELIVERED} AND nextAttemptAt < ?`, hoursAgo(now, 2)), 0);
  add("caller-sync", stuck === 0, `${stuck} saved call${stuck === 1 ? " hasn't" : "s haven't"} reached Orbit for over 2 hours.`, "The calls are safe in the engine. Open Settings and press Retry on the Caller sync, or ask Claude to check the Orbit link.");
  const stuckStops = await safe(() => count(db, `SELECT COUNT(*) AS n FROM CallerStopDelivery WHERE status NOT IN ${DELIVERED} AND nextAttemptAt < ?`, hoursAgo(now, 1)), 0);
  add("do-not-contact-sync", stuckStops === 0, `${stuckStops} "do not contact" request${stuckStops === 1 ? " hasn't" : "s haven't"} reached Orbit for over an hour.`, "Important: don't call those businesses from Orbit. Ask Claude to check the Orbit link.");

  const failedEmails = await safe(() => count(db, `SELECT COUNT(*) AS n FROM EngineEmailSend WHERE status = 'FAILED' AND createdAt >= ?`, hoursAgo(now, 24)), 0);
  add("email-sending", failedEmails === 0, `${failedEmails} automatic email${failedEmails === 1 ? "" : "s"} failed to send in the last day.`, "Check the Zoho mailbox is still active, or turn automatic email off on the Email page and ask Claude.");

  const budget = Number(env.AI_MONTHLY_BUDGET_USD ?? 5) || 5;
  const spent = await safe(async () => Number((await db.prepare(`SELECT COALESCE(SUM("costMicroUsd"),0) AS n FROM "AiUsage" WHERE "month" = ?`).bind(now.toISOString().slice(0, 7)).first<{ n: number }>())?.n ?? 0) / 1_000_000, 0);
  add("ai-budget", spent < budget * 0.9, `AI has used US$${spent.toFixed(2)} of its US$${budget.toFixed(2)} monthly budget. AI briefs and Ask AI stop at the limit.`, "It resets on the 1st. Nothing to do unless you want a higher cap.");

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

export function alertEmail(alerts: Awaited<ReturnType<typeof recordAndSelectAlerts>>) {
  const broken = [...alerts.newProblems, ...alerts.reminders];
  if (!broken.length && !alerts.fixed.length) return null;
  const subject = broken.length
    ? `⚠️ Axiom engine: ${broken.length === 1 ? broken[0]!.problem.split(".")[0] : `${broken.length} things need attention`}`
    : `✅ Axiom engine: fixed (${alerts.fixed.length === 1 ? alerts.fixed[0]!.key.replace(/-/g, " ") : `${alerts.fixed.length} issues`})`;
  const lines: string[] = [];
  if (alerts.newProblems.length) lines.push("Something just went wrong:", ...alerts.newProblems.flatMap((c) => [`• ${c.problem}`, `  What to do: ${c.fix}`]), "");
  if (alerts.reminders.length) lines.push("Still not fixed (daily reminder):", ...alerts.reminders.flatMap((c) => [`• ${c.problem}`, `  What to do: ${c.fix}`]), "");
  if (alerts.fixed.length) lines.push("Fixed now, no action needed:", ...alerts.fixed.map((c) => `• ${c.key.replace(/-/g, " ")} is working again.`), "");
  lines.push("This is an automatic check that runs every 15 minutes on operations.getaxiom.ca. You'll only hear from it when something changes.");
  const text = lines.join("\n");
  const html = `<!doctype html><html><body style="margin:0;background:#f7f5ef;font-family:Inter,Segoe UI,Arial,sans-serif;color:#0a0a0a"><div style="max-width:560px;margin:24px auto;background:#fffdf8;border:1px solid #e6e1d6;border-radius:14px;overflow:hidden"><div style="background:#0a0a0a;color:#f2f0ea;padding:16px 22px;font-size:12px;letter-spacing:.24em;font-weight:700">AXIOM · HEALTH</div><pre style="white-space:pre-wrap;font-family:inherit;font-size:14px;line-height:1.55;margin:0;padding:20px 22px">${text.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!)}</pre></div></body></html>`;
  return { subject, text, html };
}

export const OWNER_ALERT_INBOXES = ["rileyhinsperger@gmail.com", "aidanmageebusiness@gmail.com"] as const;
