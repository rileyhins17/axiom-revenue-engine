import { getDatabase } from "@/lib/cloudflare";
import { getServerEnv } from "@/lib/env";
import { getValidAccessToken, sendGmailEmail } from "@/lib/gmail";
import { getPrisma, type GmailConnectionRecord } from "@/lib/prisma";

const ALERT_RECIPIENTS = ["aidan@getaxiom.ca", "riley@getaxiom.ca"] as const;
const ALERT_KV_KEY = "pipeline_alert:last_sent";
const ALERT_DEDUPE_MS = 60 * 60 * 1000;

type PipelineIssue = {
  code: string;
  detail: string;
  count?: number;
};

type AlertState = {
  sentAt?: string;
  signature?: string;
};

async function ensureKvStore() {
  await getDatabase()
    .prepare(
      `CREATE TABLE IF NOT EXISTS "KvStore" (
        "key" TEXT PRIMARY KEY,
        "value" TEXT NOT NULL,
        "updatedAt" TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
    )
    .run();
}

async function getAlertState(): Promise<AlertState | null> {
  await ensureKvStore();
  const row = await getDatabase()
    .prepare(`SELECT "value" FROM "KvStore" WHERE "key" = ?`)
    .bind(ALERT_KV_KEY)
    .first<{ value: string }>()
    .catch(() => null);
  if (!row?.value) return null;
  try {
    return JSON.parse(row.value) as AlertState;
  } catch {
    return null;
  }
}

async function setAlertState(state: AlertState) {
  await ensureKvStore();
  await getDatabase()
    .prepare(
      `INSERT INTO "KvStore" ("key", "value", "updatedAt") VALUES (?, ?, datetime('now'))
       ON CONFLICT ("key") DO UPDATE SET "value" = excluded."value", "updatedAt" = excluded."updatedAt"`,
    )
    .bind(ALERT_KV_KEY, JSON.stringify(state))
    .run();
}

function shouldSendAlert(state: AlertState | null, signature: string, now: Date) {
  if (!state?.sentAt || state.signature !== signature) return true;
  const lastSentAt = new Date(state.sentAt).getTime();
  return Number.isNaN(lastSentAt) || now.getTime() - lastSentAt >= ALERT_DEDUPE_MS;
}

async function countSql(query: string, params: unknown[] = []) {
  const row = await getDatabase()
    .prepare(query)
    .bind(...params)
    .first<{ count: number | string }>()
    .catch(() => null);
  return Number(row?.count || 0);
}

async function gatherPipelineIssues(now: Date): Promise<PipelineIssue[]> {
  const env = getServerEnv();
  const issues: PipelineIssue[] = [];
  const staleRunCutoff = new Date(now.getTime() - 5 * 60 * 1000).toISOString();
  const staleStepCutoff = new Date(now.getTime() - 5 * 60 * 1000).toISOString();
  const staleScrapeCutoff = new Date(now.getTime() - Math.max(env.WORKER_HEARTBEAT_STALE_MS * 2, 2 * 60 * 1000)).toISOString();
  const stuckPendingScrapeCutoff = new Date(now.getTime() - 45 * 60 * 1000).toISOString();

  const staleRuns = await countSql(
    `SELECT COUNT(*) AS count FROM "OutreachRun" WHERE "status" = 'RUNNING' AND datetime("startedAt") < datetime(?)`,
    [staleRunCutoff],
  );
  if (staleRuns > 0) {
    issues.push({ code: "stale_scheduler_run", count: staleRuns, detail: `${staleRuns} scheduler run(s) have been RUNNING for more than 5 minutes.` });
  }

  const staleClaims = await countSql(
    `SELECT COUNT(*) AS count FROM "OutreachSequenceStep"
     WHERE "status" IN ('CLAIMED', 'SENDING')
       AND ("claimedAt" IS NULL OR datetime("claimedAt") < datetime(?))`,
    [staleStepCutoff],
  );
  if (staleClaims > 0) {
    issues.push({ code: "stale_claimed_steps", count: staleClaims, detail: `${staleClaims} outreach step(s) are stuck in CLAIMED/SENDING.` });
  }

  const blockedDueSteps = await countSql(
    `SELECT COUNT(*) AS count FROM "OutreachSequenceStep"
     WHERE "status" = 'SCHEDULED'
       AND "errorMessage" IS NOT NULL
       AND datetime("scheduledFor") <= datetime(?)`,
    [now.toISOString()],
  );
  if (blockedDueSteps > 0) {
    issues.push({ code: "blocked_due_steps", count: blockedDueSteps, detail: `${blockedDueSteps} due scheduled step(s) still have blocker errors.` });
  }

  const staleScrapeJobs = await countSql(
    `SELECT COUNT(*) AS count FROM "ScrapeJob"
     WHERE "status" IN ('claimed', 'running')
       AND "finishedAt" IS NULL
       AND ("heartbeatAt" IS NULL OR datetime("heartbeatAt") < datetime(?))`,
    [staleScrapeCutoff],
  );
  if (staleScrapeJobs > 0) {
    issues.push({ code: "stale_scrape_job", count: staleScrapeJobs, detail: `${staleScrapeJobs} scrape job(s) have stale heartbeats.` });
  }

  const stuckPendingScrapes = await countSql(
    `SELECT COUNT(*) AS count FROM "ScrapeJob"
     WHERE "status" = 'pending'
       AND "finishedAt" IS NULL
       AND datetime("createdAt") < datetime(?)`,
    [stuckPendingScrapeCutoff],
  );
  if (stuckPendingScrapes > 0) {
    issues.push({ code: "stuck_pending_scrape", count: stuckPendingScrapes, detail: `${stuckPendingScrapes} scrape job(s) have been pending for more than 45 minutes.` });
  }

  const sendableMailboxes = await countSql(
    `SELECT COUNT(*) AS count FROM "OutreachMailbox"
     WHERE "gmailConnectionId" IS NOT NULL AND "status" IN ('ACTIVE', 'WARMING')`,
  );
  if (sendableMailboxes === 0) {
    issues.push({ code: "no_sendable_mailbox", count: 0, detail: "No connected ACTIVE/WARMING Gmail mailbox is available for outbound sends." });
  }

  return issues;
}

async function getAlertSender() {
  const prisma = getPrisma();
  const connections = await prisma.gmailConnection.findMany({
    where: { gmailAddress: { in: [...ALERT_RECIPIENTS] } },
    orderBy: { updatedAt: "desc" },
    take: 10,
  }) as GmailConnectionRecord[];
  return connections.find((connection) => connection.gmailAddress === "aidan@getaxiom.ca") ?? connections[0] ?? null;
}

function buildAlertEmail(issues: PipelineIssue[], now: Date) {
  const env = getServerEnv();
  const appUrl = env.APP_BASE_URL.replace(/\/$/, "");
  const issueItems = issues.map((issue) => `<li><strong>${issue.code}</strong>: ${issue.detail}</li>`).join("");
  const plainIssues = issues.map((issue) => `- ${issue.code}: ${issue.detail}`).join("\n");
  return {
    subject: `[Axiom Pipeline] Attention required: ${issues.length} reliability issue${issues.length === 1 ? "" : "s"}`,
    bodyPlain: `Axiom Pipeline needs attention.\n\nDetected at: ${now.toISOString()}\n\n${plainIssues}\n\nOpen the automation console and use Repair if the issue is still present:\n${appUrl}/automation`,
    bodyHtml: `<p>Axiom Pipeline needs attention.</p><p><strong>Detected at:</strong> ${now.toISOString()}</p><ul>${issueItems}</ul><p><a href="${appUrl}/automation">Open the automation console</a> and use Repair if the issue is still present.</p>`,
  };
}

export async function monitorPipelineHealthAndAlert() {
  const now = new Date();
  const issues = await gatherPipelineIssues(now);
  if (issues.length === 0) {
    return { sent: false, issues: [] as PipelineIssue[], reason: "healthy" };
  }

  const signature = issues.map((issue) => `${issue.code}:${issue.count ?? 0}`).sort().join("|");
  const state = await getAlertState();
  if (!shouldSendAlert(state, signature, now)) {
    return { sent: false, issues, reason: "deduped" };
  }

  const sender = await getAlertSender();
  if (!sender) {
    console.warn(`[pipeline-alert] ${issues.length} issue(s) detected, but no operator Gmail connection is available to send alerts.`);
    return { sent: false, issues, reason: "no_sender" };
  }

  const tokenResult = await getValidAccessToken({
    accessToken: sender.accessToken,
    refreshToken: sender.refreshToken,
    tokenExpiresAt: sender.tokenExpiresAt,
  });
  if (tokenResult.updated) {
    await getPrisma().gmailConnection.update({
      where: { id: sender.id },
      data: tokenResult.updated,
    });
  }

  const email = buildAlertEmail(issues, now);
  for (const recipient of ALERT_RECIPIENTS) {
    await sendGmailEmail({
      accessToken: tokenResult.accessToken,
      from: sender.gmailAddress,
      fromName: "Axiom Pipeline Monitor",
      to: recipient,
      subject: email.subject,
      bodyPlain: email.bodyPlain,
      bodyHtml: email.bodyHtml,
    });
  }
  await setAlertState({ sentAt: now.toISOString(), signature });
  return { sent: true, issues, reason: "sent" };
}
