import { ownerSummaryScope, type OwnerSummaryActor } from "./revenue-engine/owner-summary-scope";
import { AUTOMATION_SETTINGS_DEFAULTS, isAdequateAutonomousLead, MAILBOX_DAILY_SEND_TARGET, MAILBOX_HOURLY_SEND_TARGET, MAILBOX_MIN_DELAY_SECONDS } from "@/lib/automation-policy";
import { getDatabase, type D1DatabaseLike } from "@/lib/cloudflare";
import { isLeadOutreachEligible, normalizePipelineEmail } from "@/lib/lead-qualification";

type Tone = "running" | "waiting" | "paused" | "stopped" | "action";
type QueueState = "ready" | "waiting_for_inbox" | "scheduled" | "unassigned";

const MAILBOX_SENDABLE_STATUS_VALUES = new Set(["active", "warming"]);

export type NextEmailScheduleRow = {
  scheduledFor: string | null;
  mailboxId: string | null;
};

export type OperatorStatus = {
  label: string;
  sentence: string;
  tone: Tone;
};

export type OperatorBlocker = {
  label: string;
  detail: string;
  actionNeeded: boolean;
};

export type OperatorMailbox = {
  id: string;
  gmailAddress: string;
  status: string;
  connected: boolean;
  dailyLimit: number;
  hourlyLimit: number;
  minDelaySeconds: number;
  sentToday: number;
  sentThisHour: number;
  leftToday: number;
  lastSentAt: string | null;
  nextAvailableAt: string | null;
  readyNow: boolean;
  stateLabel: string;
};

export type OperatorNextEmail = {
  id: string;
  sequenceId: string;
  leadId: number;
  businessName: string;
  city: string | null;
  niche: string | null;
  recipientEmail: string | null;
  senderEmail: string | null;
  scheduledFor: string | null;
  effectiveSendAt: string | null;
  queueState: QueueState;
  queueStateLabel: string;
  queueStateDetail: string | null;
  stepType: string;
};

export type OperatorRecentEmail = {
  id: string;
  sentAt: string | null;
  senderEmail: string;
  recipientEmail: string;
  subject: string;
  businessName: string | null;
};

export type OperatorActionItem = {
  id: string;
  label: string;
  detail: string;
  count: number;
  reason: string;
};

export type QueueCounts = {
  waitingToSend: number;
  queuedSequences: number;
  scheduledRawSteps: number;
  sendingNow: number;
  blocked: number;
};

export type OperatorSettings = {
  enabled: boolean;
  globalPaused: boolean;
  emergencyPaused: boolean;
  emergencyPausedAt: string | null;
  emergencyPausedBy: string | null;
  emergencyPauseReason: string | null;
  intakePaused: boolean;
  intakePausedAt: string | null;
  intakePausedBy: string | null;
  followUpsPaused: boolean;
};

export type AutomationOperatorConsoleData = {
  generatedAt: string;
  settings: OperatorSettings;
  status: OperatorStatus;
  metrics: {
    sentToday: number;
    leftToday: number;
    nextSendAt: string | null;
    inboxesReady: number;
    inboxesTotal: number;
    actionNeeded: number;
    waitingToSend: number;
  };
  mailboxes: OperatorMailbox[];
  nextEmails: OperatorNextEmail[];
  recentSent: OperatorRecentEmail[];
  actions: OperatorActionItem[];
  queue: QueueCounts;
};

export function buildOperatorStatus(input: {
  now: Date;
  enabled: boolean;
  globalPaused: boolean;
  emergencyPaused: boolean;
  sentToday: number;
  nextSendAt: Date | string | null;
  actionNeededCount?: number;
}): OperatorStatus {
  if (input.emergencyPaused) {
    return {
      label: "Emergency stop on",
      tone: "stopped",
      sentence: "Emergency stop is on. No emails will send until it is cleared.",
    };
  }

  if (!input.enabled) {
    return {
      label: "Engine off",
      tone: "stopped",
      sentence: "Engine is off. No emails will send until automation is enabled.",
    };
  }

  if (input.globalPaused) {
    return {
      label: "Engine paused",
      tone: "paused",
      sentence: "Engine is paused. No emails will send until it is resumed.",
    };
  }

  if ((input.actionNeededCount ?? 0) > 0) {
    return {
      label: "Action needed",
      tone: "action",
      sentence: `Action needed. ${input.actionNeededCount} item${input.actionNeededCount === 1 ? "" : "s"} need operator attention.`,
    };
  }

  const nextSend = toDate(input.nextSendAt);
  if (!nextSend) {
    return {
      label: "Engine waiting",
      tone: "waiting",
      sentence: `Engine running. ${input.sentToday} sent today. No sends scheduled.`,
    };
  }

  return {
    label: "Engine running",
    tone: "running",
    sentence: `Engine running. ${input.sentToday} sent today. Next send ${relativeFuture(nextSend, input.now)}.`,
  };
}

export function getCanonicalWaitingCount(input: {
  scheduledInitialSteps: number;
  queuedSequences: number;
  scheduledRawSteps: number;
}) {
  if (input.scheduledInitialSteps > 0) return input.scheduledInitialSteps;
  if (input.queuedSequences > 0) return input.queuedSequences;
  return Math.max(0, input.scheduledRawSteps);
}

export function humanizeOperatorBlocker(reason: string | null | undefined): OperatorBlocker {
  switch (normalizeReason(reason)) {
    case "mailbox_cooldown":
      return {
        label: "Inbox cooling down",
        detail: "No action needed. Sending resumes automatically.",
        actionNeeded: false,
      };
    case "hourly_cap_reached":
      return {
        label: "Inbox hourly limit hit",
        detail: "No action needed. Sending resumes automatically next hour.",
        actionNeeded: false,
      };
    case "daily_cap_reached":
    case "global_daily_cap_reached":
      return {
        label: "Daily limit hit",
        detail: "No action needed. Sending resumes tomorrow.",
        actionNeeded: false,
      };
    case "outside_send_window":
      return {
        label: "Outside send window",
        detail: "No action needed. Sending resumes in the next allowed window.",
        actionNeeded: false,
      };
    case "domain_cooldown_active":
      return {
        label: "Company cooldown",
        detail: "No action needed. This company was contacted recently.",
        actionNeeded: false,
      };
    case "awaiting_follow_up_window":
      return {
        label: "Waiting for follow-up timing",
        detail: "No action needed. Follow-up timing is being respected.",
        actionNeeded: false,
      };
    case "mailbox_disconnected":
      return {
        label: "Inbox needs reconnecting",
        detail: "Reconnect Gmail before this sequence can send.",
        actionNeeded: true,
      };
    case "mailbox_disabled":
      return {
        label: "Inbox paused",
        detail: "Reactivate or reconnect the inbox before sending can continue.",
        actionNeeded: true,
      };
    case "global_pause":
      return {
        label: "Engine paused",
        detail: "Resume automation before queued email can send.",
        actionNeeded: true,
      };
    case "emergency_stop":
      return {
        label: "Emergency stop on",
        detail: "Clear emergency stop before any automation can run.",
        actionNeeded: true,
      };
    case "manual_pause":
      return {
        label: "Sequence paused",
        detail: "Resume this sequence if it should keep sending.",
        actionNeeded: true,
      };
    case "missing_enrichment":
      return {
        label: "Lead needs enrichment",
        detail: "Run enrichment repair before this email can send.",
        actionNeeded: true,
      };
    case "generation_failed_retryable":
    case "send_failed_retryable":
      return {
        label: "Retry queued",
        detail: "No action needed yet. Diagnostics will flag it if it stays stuck.",
        actionNeeded: false,
      };
    default:
      return {
        label: "Waiting normally",
        detail: "No action needed.",
        actionNeeded: false,
      };
  }
}

export async function getAutomationOperatorConsole(actor: OwnerSummaryActor, now = new Date(), db: D1DatabaseLike = getDatabase()): Promise<AutomationOperatorConsoleData> {
  const scope = await ownerSummaryScope(actor, db);
  const [
    settingsRow,
    mailboxRows,
    queueRow,
    nextEmailRows,
    recentSentRows,
    stepBlockerRows,
    sequenceBlockerRows,
  ] = await Promise.all([
    readSettings(db),
    readMailboxes(db, now, scope.userId),
    readQueueCounts(db, scope.userId),
    readNextEmails(db, scope.userId),
    readRecentSent(db, scope.userId),
    readStepBlockers(db, scope.userId),
    readSequenceBlockers(db, scope.userId),
  ]);

  if (!settingsRow) throw new Error("OWNER_SUMMARY_UNAVAILABLE");
  const settings = normalizeSettings(settingsRow);
  const mailboxes = mailboxRows.map((row) => normalizeMailbox(row, now));
  const readyMailboxes = mailboxes.filter((mailbox) => mailbox.readyNow).length;
  const sentToday = mailboxes.reduce((sum, mailbox) => sum + mailbox.sentToday, 0);
  const leftToday = mailboxes.reduce((sum, mailbox) => sum + mailbox.leftToday, 0);
  const waitingToSend = getCanonicalWaitingCount(queueRow);
  const nextEmailSchedule = projectNextEmailSchedule(nextEmailRows, mailboxes, now);
  const nextSendAt = nextEmailSchedule[0]?.effectiveSendAt ?? null;
  const actions = buildActionItems(settings, mailboxes, stepBlockerRows, sequenceBlockerRows);
  const status = buildOperatorStatus({
    now,
    enabled: settings.enabled,
    globalPaused: settings.globalPaused,
    emergencyPaused: settings.emergencyPaused,
    sentToday,
    nextSendAt,
    actionNeededCount: actions.length,
  });

  await scope.assertCurrent();
  return {
    generatedAt: now.toISOString(),
    settings,
    status,
    metrics: {
      sentToday,
      leftToday,
      nextSendAt: nextSendAt ? nextSendAt.toISOString() : null,
      inboxesReady: readyMailboxes,
      inboxesTotal: mailboxes.length,
      actionNeeded: actions.reduce((sum, action) => sum + action.count, 0),
      waitingToSend,
    },
    mailboxes,
    nextEmails: nextEmailRows.map((row, index) => ({
      id: String(row.id),
      sequenceId: String(row.sequenceId),
      leadId: Number(row.leadId),
      businessName: cleanString(row.businessName) || "Unknown business",
      city: cleanString(row.city),
      niche: cleanString(row.niche),
      recipientEmail: normalizePipelineEmail(row.recipientEmail) || cleanString(row.recipientEmail),
      senderEmail: cleanString(row.senderEmail),
      scheduledFor: toIsoString(row.scheduledFor),
      effectiveSendAt: toIsoString(nextEmailSchedule[index]?.effectiveSendAt ?? null),
      queueState: nextEmailSchedule[index]?.state ?? "scheduled",
      queueStateLabel: nextEmailSchedule[index]?.label ?? "Scheduled",
      queueStateDetail: nextEmailSchedule[index]?.detail ?? null,
      stepType: cleanString(row.stepType) || "INITIAL",
    })),
    recentSent: recentSentRows.map((row) => ({
      id: String(row.id),
      sentAt: toIsoString(row.sentAt),
      senderEmail: cleanString(row.senderEmail) || "unknown",
      recipientEmail: cleanString(row.recipientEmail) || "unknown",
      subject: cleanString(row.subject) || "(no subject)",
      businessName: cleanString(row.businessName),
    })),
    actions,
    queue: {
      waitingToSend,
      queuedSequences: queueRow.queuedSequences,
      scheduledRawSteps: queueRow.scheduledRawSteps,
      sendingNow: queueRow.sendingNow,
      blocked: queueRow.blocked,
    },
  };
}

type SettingsRow = Partial<Record<keyof OperatorSettings, unknown>>;

type MailboxRow = {
  id: string;
  gmailAddress: string;
  status: string | null;
  gmailConnectionId: string | null;
  dailyLimit: number | string | null;
  hourlyLimit: number | string | null;
  minDelaySeconds: number | string | null;
  lastSentAt: string | null;
  sentToday: number | string | null;
  sentThisHour: number | string | null;
};

type QueueRow = QueueCounts & {
  scheduledInitialSteps: number;
};

type NextEmailRow = {
  id: string;
  sequenceId: string;
  leadId: number | string;
  mailboxId: string | null;
  businessName: string | null;
  category: string | null;
  city: string | null;
  niche: string | null;
  recipientEmail: string | null;
  emailType: string | null;
  emailConfidence: number | string | null;
  emailFlags: string | null;
  axiomScore: number | string | null;
  isArchived: number | string | boolean | null;
  enrichmentData: string | null;
  senderEmail: string | null;
  scheduledFor: string | null;
  stepType: string | null;
};

type RecentSentRow = {
  id: string;
  sentAt: string | null;
  senderEmail: string | null;
  recipientEmail: string | null;
  subject: string | null;
  businessName: string | null;
};

type BlockerRow = {
  reason: string | null;
  count: number | string | null;
};

async function readSettings(db: D1DatabaseLike) {
  return db.prepare(
    `SELECT
       "enabled",
       "globalPaused",
       "emergencyPaused",
       "emergencyPausedAt",
       NULL AS "emergencyPausedBy",
       CASE WHEN "emergencyPauseReason" IS NOT NULL THEN 'Emergency stop recorded' ELSE NULL END AS "emergencyPauseReason",
       "intakePaused",
       "intakePausedAt",
       NULL AS "intakePausedBy",
       "followUpsPaused"
     FROM "OutreachAutomationSetting"
     WHERE "id" = 'global'
     LIMIT 1`,
  ).first<SettingsRow>();
}

async function readMailboxes(db: D1DatabaseLike, now: Date, userId: string) {
  const todayStart = startOfDay(now).toISOString();
  const hourStart = startOfHour(now).toISOString();
  const rows = await db.prepare(
    `SELECT
       m."id",
       m."gmailAddress",
       m."status",
       m."gmailConnectionId",
       m."dailyLimit",
       m."hourlyLimit",
       m."minDelaySeconds",
       m."lastSentAt",
       (
         SELECT COUNT(*)
         FROM "OutreachEmail" e
         WHERE e."mailboxId" = m."id" AND e."senderUserId" = m."userId"
           AND e."status" IN ('sent', 'delivered')
           AND datetime(e."sentAt") >= datetime(?)
       ) AS "sentToday",
       (
         SELECT COUNT(*)
         FROM "OutreachEmail" e
         WHERE e."mailboxId" = m."id" AND e."senderUserId" = m."userId"
           AND e."status" IN ('sent', 'delivered')
           AND datetime(e."sentAt") >= datetime(?)
       ) AS "sentThisHour"
     FROM "OutreachMailbox" m
     WHERE m."userId" = ?
     ORDER BY lower(m."gmailAddress") ASC`,
  ).bind(todayStart, hourStart, userId).all<MailboxRow>();

  return rows.results ?? [];
}

async function readQueueCounts(db: D1DatabaseLike, userId: string): Promise<QueueRow> {
  const row = await db.prepare(
    `SELECT
       (
         SELECT COUNT(*)
         FROM "OutreachSequenceStep" st
         JOIN "OutreachSequence" seq ON seq."id" = st."sequenceId"
         WHERE seq."queuedByUserId"=? AND st."status" = 'SCHEDULED'
           AND st."stepNumber" = 1
           AND seq."status" IN ('QUEUED', 'ACTIVE', 'WAITING', 'BLOCKED', 'SENDING')
       ) AS "scheduledInitialSteps",
       (
         SELECT COUNT(*)
         FROM "OutreachSequence"
         WHERE "queuedByUserId"=? AND "status" IN ('QUEUED', 'ACTIVE', 'WAITING', 'BLOCKED', 'SENDING')
       ) AS "queuedSequences",
       (
         SELECT COUNT(*)
         FROM "OutreachSequenceStep" st JOIN "OutreachSequence" seq ON seq."id"=st."sequenceId"
         WHERE seq."queuedByUserId"=? AND st."status" = 'SCHEDULED'
       ) AS "scheduledRawSteps",
       (
         SELECT COUNT(*)
         FROM "OutreachSequenceStep" st JOIN "OutreachSequence" seq ON seq."id"=st."sequenceId"
         WHERE seq."queuedByUserId"=? AND st."status" IN ('CLAIMED', 'GENERATING', 'SENDING')
       ) AS "sendingNow",
       (
         SELECT COUNT(*)
         FROM "OutreachSequence"
         WHERE "queuedByUserId"=? AND "status" IN ('BLOCKED', 'PAUSED')
       ) AS "blocked"`,
  ).bind(userId,userId,userId,userId,userId).first<Partial<QueueRow>>();

  return {
    scheduledInitialSteps: toNumber(row?.scheduledInitialSteps),
    queuedSequences: toNumber(row?.queuedSequences),
    scheduledRawSteps: toNumber(row?.scheduledRawSteps),
    sendingNow: toNumber(row?.sendingNow),
    blocked: toNumber(row?.blocked),
    waitingToSend: 0,
  };
}

async function readNextEmails(db: D1DatabaseLike, userId: string) {
  const rows = await db.prepare(
    `SELECT
       st."id",
       st."sequenceId",
       st."stepType",
       st."scheduledFor",
       seq."leadId",
       seq."assignedMailboxId" AS "mailboxId",
       l."businessName",
       l."category",
       l."city",
       l."niche",
       l."email" AS "recipientEmail",
       l."emailType",
       l."emailConfidence",
       l."emailFlags",
       l."axiomScore",
       l."isArchived",
       l."enrichmentData",
       m."gmailAddress" AS "senderEmail"
     FROM "OutreachSequenceStep" st
     JOIN "OutreachSequence" seq ON seq."id" = st."sequenceId"
     JOIN "Lead" l ON l."id" = seq."leadId"
     LEFT JOIN "OutreachMailbox" m ON m."id" = seq."assignedMailboxId" AND m."userId" = seq."queuedByUserId"
     WHERE seq."queuedByUserId" = ? AND st."status" = 'SCHEDULED'
       AND st."stepNumber" = 1
       AND seq."status" IN ('QUEUED', 'ACTIVE', 'WAITING', 'SENDING')
     ORDER BY datetime(st."scheduledFor") ASC
     LIMIT 80`,
  ).bind(userId).all<NextEmailRow>();

  return (rows.results ?? []).filter(isNextEmailRowSendable).slice(0, 5);
}

function isNextEmailRowSendable(row: NextEmailRow) {
  const lead = {
    axiomScore: toNumber(row.axiomScore),
    axiomTier: null,
    businessName: row.businessName,
    category: row.category,
    email: row.recipientEmail,
    emailType: row.emailType,
    emailConfidence: toNumber(row.emailConfidence),
    emailFlags: row.emailFlags,
    isArchived: toBool(row.isArchived),
  };

  return Boolean(row.enrichmentData) && isLeadOutreachEligible(lead) && isAdequateAutonomousLead(lead);
}

async function readRecentSent(db: D1DatabaseLike, userId: string) {
  const rows = await db.prepare(
    `SELECT
       e."id",
       e."sentAt",
       e."senderEmail",
       e."recipientEmail",
       e."subject",
       l."businessName"
     FROM "OutreachEmail" e
     LEFT JOIN "Lead" l ON l."id" = e."leadId"
     WHERE e."senderUserId" = ? AND e."status" IN ('sent', 'delivered')
     ORDER BY datetime(e."sentAt") DESC
     LIMIT 10`,
  ).bind(userId).all<RecentSentRow>();

  return rows.results ?? [];
}

async function readStepBlockers(db: D1DatabaseLike, userId: string) {
  const rows = await db.prepare(
    `SELECT st."errorMessage" AS "reason", COUNT(*) AS "count"
     FROM "OutreachSequenceStep" st JOIN "OutreachSequence" seq ON seq."id"=st."sequenceId"
     WHERE seq."queuedByUserId"=? AND st."errorMessage" IN (
       'mailbox_disconnected',
       'mailbox_disabled',
       'global_pause',
       'emergency_stop',
       'manual_pause',
       'missing_enrichment',
       'generation_failed_retryable',
       'send_failed_retryable'
     )
     GROUP BY st."errorMessage"
     LIMIT 12`,
  ).bind(userId).all<BlockerRow>();

  return rows.results ?? [];
}

async function readSequenceBlockers(db: D1DatabaseLike, userId: string) {
  const rows = await db.prepare(
    `SELECT seq."stopReason" AS "reason", COUNT(*) AS "count"
     FROM "OutreachSequence" seq
     WHERE seq."queuedByUserId"=? AND seq."stopReason" IN (
       'mailbox_disconnected',
       'mailbox_disabled',
       'global_pause',
       'emergency_stop',
       'manual_pause',
       'missing_enrichment',
       'generation_failed_retryable',
       'send_failed_retryable'
     )
     GROUP BY seq."stopReason"
     LIMIT 12`,
  ).bind(userId).all<BlockerRow>();

  return rows.results ?? [];
}

function normalizeSettings(row: SettingsRow | null): OperatorSettings {
  return {
    enabled: toBool(row?.enabled, AUTOMATION_SETTINGS_DEFAULTS.enabled),
    globalPaused: toBool(row?.globalPaused, AUTOMATION_SETTINGS_DEFAULTS.globalPaused),
    emergencyPaused: toBool(row?.emergencyPaused, AUTOMATION_SETTINGS_DEFAULTS.emergencyPaused),
    emergencyPausedAt: toIsoString(row?.emergencyPausedAt),
    emergencyPausedBy: cleanString(row?.emergencyPausedBy),
    emergencyPauseReason: cleanString(row?.emergencyPauseReason),
    intakePaused: toBool(row?.intakePaused, AUTOMATION_SETTINGS_DEFAULTS.intakePaused),
    intakePausedAt: toIsoString(row?.intakePausedAt),
    intakePausedBy: cleanString(row?.intakePausedBy),
    followUpsPaused: toBool(row?.followUpsPaused, AUTOMATION_SETTINGS_DEFAULTS.followUpsPaused),
  };
}

function normalizeMailbox(row: MailboxRow, now: Date): OperatorMailbox {
  const dailyLimit = positiveNumber(row.dailyLimit, MAILBOX_DAILY_SEND_TARGET);
  const hourlyLimit = positiveNumber(row.hourlyLimit, MAILBOX_HOURLY_SEND_TARGET);
  const minDelaySeconds = positiveNumber(row.minDelaySeconds, MAILBOX_MIN_DELAY_SECONDS);
  const sentToday = toNumber(row.sentToday);
  const sentThisHour = toNumber(row.sentThisHour);
  const lastSentAt = toDate(row.lastSentAt);
  const status = cleanString(row.status) || "unknown";
  const connected = Boolean(cleanString(row.gmailConnectionId));
  const cooldownReadyAt = lastSentAt ? new Date(lastSentAt.getTime() + minDelaySeconds * 1000) : null;
  const belowDailyCap = sentToday < dailyLimit;
  const belowHourlyCap = sentThisHour < hourlyLimit;
  const hourlyReadyAt = belowHourlyCap ? null : nextHourStart(now);
  const nextAvailableAt = maxDate([cooldownReadyAt, hourlyReadyAt]);
  const availableNow = !nextAvailableAt || nextAvailableAt.getTime() <= now.getTime();
  const statusAllowsSending = MAILBOX_SENDABLE_STATUS_VALUES.has(status.toLowerCase());
  const readyNow = connected && belowDailyCap && belowHourlyCap && availableNow && statusAllowsSending;

  return {
    id: row.id,
    gmailAddress: row.gmailAddress,
    status,
    connected,
    dailyLimit,
    hourlyLimit,
    minDelaySeconds,
    sentToday,
    sentThisHour,
    leftToday: Math.max(0, dailyLimit - sentToday),
    lastSentAt: lastSentAt ? lastSentAt.toISOString() : null,
    nextAvailableAt: nextAvailableAt ? nextAvailableAt.toISOString() : null,
    readyNow,
    stateLabel: mailboxStateLabel({ connected, status, belowDailyCap, belowHourlyCap, availableNow }),
  };
}

function mailboxStateLabel(input: { connected: boolean; status: string; belowDailyCap: boolean; belowHourlyCap: boolean; availableNow: boolean }) {
  if (!input.connected) return "Needs reconnect";
  const lowerStatus = input.status.toLowerCase();
  if (["paused", "disabled"].includes(lowerStatus)) return "Paused";
  if (!MAILBOX_SENDABLE_STATUS_VALUES.has(lowerStatus)) return "Needs reconnect";
  if (!input.belowDailyCap) return "Daily limit";
  if (!input.belowHourlyCap) return "Hourly limit";
  if (!input.availableNow) return "Cooling down";
  return "Ready";
}

export function estimateNextSendAt(firstScheduledAt: string | null, mailboxes: OperatorMailbox[], now: Date) {
  if (!firstScheduledAt) return null;

  const scheduled = toDate(firstScheduledAt) ?? now;
  const availableMailboxes = mailboxes
    .filter((mailbox) => isMailboxUsableForProjection(mailbox))
    .map((mailbox) => toDate(mailbox.nextAvailableAt) ?? now)
    .sort((a, b) => a.getTime() - b.getTime());
  const earliestMailbox = availableMailboxes[0] ?? null;
  if (!earliestMailbox) return null;

  return new Date(Math.max(scheduled.getTime(), earliestMailbox.getTime(), now.getTime()));
}

export function projectNextEmailSchedule(
  rows: NextEmailScheduleRow[],
  mailboxes: OperatorMailbox[],
  now: Date,
) {
  const mailboxById = new Map(mailboxes.map((mailbox) => [mailbox.id, mailbox]));
  const availabilityByMailboxId = new Map<string, Date>();

  for (const mailbox of mailboxes) {
    if (!isMailboxUsableForProjection(mailbox)) continue;
    availabilityByMailboxId.set(mailbox.id, toDate(mailbox.nextAvailableAt) ?? now);
  }

  return rows.map((row) => {
    const mailboxId = cleanString(row.mailboxId);
    const mailbox = mailboxId ? mailboxById.get(mailboxId) ?? null : null;
    const projectedMailboxId = mailbox && availabilityByMailboxId.has(mailbox.id)
      ? mailbox.id
      : (!mailboxId ? getEarliestAvailableMailboxId(availabilityByMailboxId) : null);

    if (!projectedMailboxId) {
      return {
        effectiveSendAt: null,
        state: "unassigned" as QueueState,
        label: mailbox ? "Inbox unavailable" : "No inbox assigned",
        detail: "Connect or reactivate a sending inbox before this can leave.",
      };
    }

    const projectedMailbox = mailboxById.get(projectedMailboxId);
    const scheduled = toDate(row.scheduledFor) ?? now;
    const mailboxAvailableAt = availabilityByMailboxId.get(projectedMailboxId) ?? now;
    const effectiveSendAt = new Date(Math.max(scheduled.getTime(), mailboxAvailableAt.getTime(), now.getTime()));
    const waitingOnMailbox = effectiveSendAt.getTime() > Math.max(scheduled.getTime(), now.getTime());
    const state: QueueState = effectiveSendAt.getTime() <= now.getTime() + 45_000
      ? "ready"
      : waitingOnMailbox
        ? "waiting_for_inbox"
        : "scheduled";

    if (projectedMailbox) {
      availabilityByMailboxId.set(
        projectedMailboxId,
        new Date(effectiveSendAt.getTime() + projectedMailbox.minDelaySeconds * 1000),
      );
    }

    return {
      effectiveSendAt,
      state,
      label: state === "ready" ? "Ready now" : state === "waiting_for_inbox" ? "Waiting for inbox" : "Scheduled",
      detail: waitingOnMailbox ? "Mailbox cooldown/caps set the actual send time." : null,
    };
  });
}

function isMailboxUsableForProjection(mailbox: OperatorMailbox) {
  return mailbox.connected && MAILBOX_SENDABLE_STATUS_VALUES.has(mailbox.status.toLowerCase()) && mailbox.leftToday > 0;
}

function getEarliestAvailableMailboxId(availabilityByMailboxId: Map<string, Date>) {
  return Array.from(availabilityByMailboxId.entries()).sort((a, b) => a[1].getTime() - b[1].getTime())[0]?.[0] ?? null;
}

function buildActionItems(
  settings: OperatorSettings,
  mailboxes: OperatorMailbox[],
  stepBlockers: BlockerRow[],
  sequenceBlockers: BlockerRow[],
): OperatorActionItem[] {
  const actionMap = new Map<string, OperatorActionItem>();

  const add = (reason: string, count = 1) => {
    const copy = humanizeOperatorBlocker(reason);
    if (!copy.actionNeeded) return;
    const existing = actionMap.get(reason);
    if (existing) {
      existing.count += count;
      return;
    }
    actionMap.set(reason, {
      id: reason,
      reason,
      label: copy.label,
      detail: copy.detail,
      count,
    });
  };

  if (!settings.enabled) add("global_pause");
  if (settings.globalPaused) add("global_pause");
  if (settings.emergencyPaused) add("emergency_stop");
  for (const mailbox of mailboxes) {
    if (!mailbox.connected || mailbox.stateLabel === "Needs reconnect") {
      add("mailbox_disconnected");
    } else if (mailbox.stateLabel === "Paused") {
      add("mailbox_disabled");
    }
  }

  for (const row of [...stepBlockers, ...sequenceBlockers]) {
    add(normalizeReason(row.reason), toNumber(row.count));
  }

  return Array.from(actionMap.values()).sort((a, b) => b.count - a.count);
}

function relativeFuture(date: Date, now: Date) {
  const diffMs = date.getTime() - now.getTime();
  if (diffMs <= 45_000) return "now";
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 60) return `in ${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `in ${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.round(hours / 24);
  return `in ${days} day${days === 1 ? "" : "s"}`;
}

function normalizeReason(value: string | null | undefined) {
  return cleanString(value)?.toLowerCase().replaceAll(" ", "_") || "";
}

function toBool(value: unknown, fallback = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const lower = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(lower)) return true;
    if (["0", "false", "no", "off"].includes(lower)) return false;
  }
  return fallback;
}

function toNumber(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function positiveNumber(value: unknown, fallback: number) {
  const parsed = toNumber(value);
  return parsed > 0 ? parsed : fallback;
}

function startOfDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0));
}

function startOfHour(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), date.getUTCHours(), 0, 0));
}

function nextHourStart(date: Date) {
  const next = startOfHour(date);
  next.setUTCHours(next.getUTCHours() + 1);
  return next;
}

function maxDate(values: Array<Date | null>) {
  const dates = values.filter((value): value is Date => Boolean(value));
  if (dates.length === 0) return null;
  return dates.reduce((max, value) => (value.getTime() > max.getTime() ? value : max), dates[0]);
}

function toDate(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toIsoString(value: unknown) {
  if (!value) return null;
  const date = toDate(value as Date | string);
  return date ? date.toISOString() : String(value);
}

function cleanString(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  return text.length > 0 ? text : null;
}
