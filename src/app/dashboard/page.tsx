import type { ReactNode } from "react";
import type { Route } from "next";
import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Bot,
  CheckCircle2,
  Clock,
  Clock3,
  Crosshair,
  DollarSign,
  Filter,
  Mail,
  MailCheck,
  Radar,
  Reply,
  Route as RouteIcon,
  ScrollText,
  Send,
  ShieldAlert,
  Target,
  TrendingUp,
  Users,
  Zap,
} from "lucide-react";

import { QuickActions } from "@/components/dashboard/quick-actions";
import { RefreshButton } from "@/components/dashboard/refresh-button";
import { ReplyInboxPanel } from "@/components/dashboard/reply-inbox-actions";
import {
  AUTOMATION_SETTINGS_DEFAULTS,
  MAILBOX_DAILY_SEND_TARGET,
} from "@/lib/automation-policy";
import { countAdequateLeadsToday, getAutonomousDailyLeadCap } from "@/lib/autonomous-intake";
import { getDatabase } from "@/lib/cloudflare";
import { getServerEnv } from "@/lib/env";
import { getAutomationOperatorConsole } from "@/lib/automation-operator-view";
import { listAutomationOverview } from "@/lib/outreach-automation";
import { getPrisma } from "@/lib/prisma";
import { listScrapeJobs } from "@/lib/scrape-jobs";
import { listRecentScrapeTargets, pickNextScrapeTarget, countActiveScrapeTargets } from "@/lib/scrape-targets";
import { requireSession } from "@/lib/session";
import { formatAppDateTime } from "@/lib/time";
import { isSendableMailbox, resolveGlobalDailySendCap, startOfUtcDay } from "@/lib/ui/data-accuracy";
import { SentEmailViewerTrigger } from "@/components/sent-email-viewer";

export const dynamic = "force-dynamic";

const EXPECTED_MAILBOX_COUNT = 2;

function emptyAutomationOverview() {
  return {
    settings: { ...AUTOMATION_SETTINGS_DEFAULTS },
    mailboxes: [],
    ready: [],
    sequences: [],
    queued: [],
    active: [],
    finished: [],
    recentSent: [],
    engine: {
      mode: "ACTIVE" as const,
      nextSendAt: null,
      overdueSendAt: null,
      scheduledToday: 0,
      blockedCount: 0,
      replyStoppedCount: 0,
      readyCount: 0,
      queuedCount: 0,
      waitingCount: 0,
      sendingCount: 0,
    },
    pipeline: {
      needsEnrichment: 0,
      enriching: 0,
      enriched: 0,
      readyForTouch: 0,
    },
    recentRuns: [],
    stats: {
      ready: 0,
      queued: 0,
      sending: 0,
      waiting: 0,
      blocked: 0,
      active: 0,
      paused: 0,
      stopped: 0,
      completed: 0,
      replied: 0,
      scheduledToday: 0,
    },
  };
}

const BUSINESS_TZ = "America/Toronto";

/**
 * Cloudflare Workers run in UTC. The business operates in Eastern time.
 * This returns the integer UTC offset for Eastern right now (-4 EDT / -5 EST)
 * by comparing what Intl reports as Eastern time vs. UTC.
 */
function getEasternOffsetHours(): number {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: BUSINESS_TZ,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? "0");
  const easternMs = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
  return Math.round((easternMs - now.getTime()) / 3_600_000); // -4 or -5
}

/**
 * Returns a Date representing midnight Eastern time today (expressed in UTC).
 * e.g. at 20:48 ET on May 4: returns 2026-05-04T04:00:00Z (EDT = UTC-4)
 */
function startOfTodayEastern(): Date {
  const offset = getEasternOffsetHours(); // e.g. -4
  const easternDateStr = new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TZ,
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date()); // "2026-05-04"
  const [year, month, day] = easternDateStr.split("-").map(Number);
  // Eastern midnight in UTC = that date at 00:00 ET = 00:00 - offset in UTC
  return new Date(Date.UTC(year, month - 1, day, -offset, 0, 0));
}

/** Returns the current date string (YYYY-MM-DD) in Eastern time */
function todayEasternStr(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TZ,
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

function relativeAgo(date: Date | string | null | undefined): string {
  if (!date) return "never";
  const d = typeof date === "string" ? new Date(date) : date;
  const diff = Date.now() - d.getTime();
  if (!Number.isFinite(diff) || diff < 0) return formatAppDateTime(d, undefined, "—");
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  return `${days}d ago`;
}

function relativeFuture(date: Date | string | null | undefined): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  const diff = d.getTime() - Date.now();
  if (!Number.isFinite(diff)) return "—";
  if (diff <= 0) return "now";
  const m = Math.round(diff / 60_000);
  if (m < 1) return "<1m";
  if (m < 60) return `in ${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `in ${h}h`;
  const days = Math.floor(h / 24);
  return `in ${days}d`;
}

async function getSendsToday(): Promise<{ total: number; perSender: Record<string, number> }> {
  const since = startOfUtcDay().toISOString();
  const result = await getDatabase()
    .prepare(
      `SELECT "senderEmail", COUNT(*) AS count FROM "OutreachEmail"
       WHERE "status" = 'sent' AND "sentAt" >= ?
       GROUP BY "senderEmail"`,
    )
    .bind(since)
    .all<{ senderEmail: string; count: number | string }>();

  const perSender: Record<string, number> = {};
  let total = 0;
  for (const row of result.results ?? []) {
    const c = Number(row.count || 0);
    perSender[row.senderEmail] = c;
    total += c;
  }
  return { total, perSender };
}

async function get7DaySeries(): Promise<{
  leadsFound: number[];
  enriched: number[];
  queued: number[];
  sent: number[];
  replied: number[];
}> {
  const db = getDatabase();
  const offsetHours = getEasternOffsetHours(); // -4 (EDT) or -5 (EST)
  // SQLite modifier string: adjusts a stored UTC timestamp to Eastern local time
  // so that date() returns the Eastern calendar date, not the UTC calendar date.
  const tzMod = `${offsetHours} hours`; // e.g. "-4 hours"

  // Build 7 Eastern calendar dates (YYYY-MM-DD) oldest → newest.
  // We compute them as plain UTC dates using the Eastern calendar day as the
  // date portion (offset only matters for the time, not the calendar day here).
  const todayStr = todayEasternStr(); // "2026-05-04"
  const [ty, tm, td] = todayStr.split("-").map(Number);
  const dayKeys: string[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.UTC(ty, tm - 1, td - i));
    dayKeys.push(d.toISOString().slice(0, 10));
  }

  // Start of 7-day window = Eastern midnight 6 days ago (UTC-expressed)
  const start7 = new Date(startOfTodayEastern().getTime() - 6 * 86_400_000).toISOString();

  // Group by Eastern calendar date using SQLite's datetime() offset modifier.
  // date(datetime(col, '-4 hours')) converts the UTC timestamp to Eastern time
  // before extracting the date, so midnight crossings land on the correct day.
  const toSeries = (rows: Array<{ d: string; c: number | string }>) => {
    const map = new Map<string, number>();
    for (const row of rows) {
      if (row.d) map.set(row.d, Number(row.c || 0));
    }
    return dayKeys.map((k) => map.get(k) ?? 0);
  };

  const [leadsFoundRows, enrichedRows, queuedRows, sentRows, repliedRows] = await Promise.all([
    db
      .prepare(`SELECT date(datetime("createdAt", '${tzMod}')) AS d, COUNT(*) AS c FROM "Lead" WHERE "createdAt" >= ? GROUP BY 1`)
      .bind(start7)
      .all<{ d: string; c: number | string }>(),
    db
      .prepare(`SELECT date(datetime("enrichedAt", '${tzMod}')) AS d, COUNT(*) AS c FROM "Lead" WHERE "enrichedAt" IS NOT NULL AND "enrichedAt" >= ? GROUP BY 1`)
      .bind(start7)
      .all<{ d: string; c: number | string }>(),
    db
      .prepare(`SELECT date(datetime("createdAt", '${tzMod}')) AS d, COUNT(*) AS c FROM "OutreachSequence" WHERE "createdAt" >= ? GROUP BY 1`)
      .bind(start7)
      .all<{ d: string; c: number | string }>(),
    db
      .prepare(`SELECT date(datetime("sentAt", '${tzMod}')) AS d, COUNT(*) AS c FROM "OutreachEmail" WHERE "status" = 'sent' AND "sentAt" >= ? GROUP BY 1`)
      .bind(start7)
      .all<{ d: string; c: number | string }>(),
    db
      .prepare(`SELECT date(datetime("replyDetectedAt", '${tzMod}')) AS d, COUNT(*) AS c FROM "OutreachSequence" WHERE "replyDetectedAt" IS NOT NULL AND "replyDetectedAt" >= ? GROUP BY 1`)
      .bind(start7)
      .all<{ d: string; c: number | string }>(),
  ]);
  return {
    leadsFound: toSeries(leadsFoundRows.results ?? []),
    enriched: toSeries(enrichedRows.results ?? []),
    queued: toSeries(queuedRows.results ?? []),
    sent: toSeries(sentRows.results ?? []),
    replied: toSeries(repliedRows.results ?? []),
  };
}

type CrmStats = {
  mrr: number;
  activeClients: number;
  inPipeline: number;
  renewalsDue: number;
  lostDeals: number;
  forecast: number;
};

const EMPTY_CRM_STATS: CrmStats = {
  mrr: 0,
  activeClients: 0,
  inPipeline: 0,
  renewalsDue: 0,
  lostDeals: 0,
  forecast: 0,
};

async function getCrmStats(): Promise<CrmStats> {
  const db = getDatabase();
  const now = new Date().toISOString();
  const in30 = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  const [mrrRow, activeCount, proposalCount, renewalCount, lostCount, forecastRow] = await Promise.all([
    db.prepare(
      `SELECT COALESCE(SUM("monthlyValue"), 0) AS mrr FROM "Lead"
       WHERE "dealStage" IN ('ACTIVE', 'RETAINED') AND "monthlyValue" IS NOT NULL AND "isArchived" = 0`,
    ).first<{ mrr: number | string }>(),
    db.prepare(
      `SELECT COUNT(*) AS c FROM "Lead" WHERE "dealStage" IN ('ACTIVE', 'RETAINED') AND "isArchived" = 0`,
    ).first<{ c: number | string }>(),
    db.prepare(
      `SELECT COUNT(*) AS c FROM "Lead"
       WHERE "dealStage" IS NOT NULL AND "dealStage" != 'LOST' AND "isArchived" = 0`,
    ).first<{ c: number | string }>(),
    db.prepare(
      `SELECT COUNT(*) AS c FROM "Lead"
       WHERE "renewalDate" IS NOT NULL AND "renewalDate" <= ? AND "renewalDate" >= ? AND "isArchived" = 0`,
    ).bind(in30, now).first<{ c: number | string }>(),
    db.prepare(
      `SELECT COUNT(*) AS c FROM "Lead" WHERE "dealStage" = 'LOST' AND "isArchived" = 0`,
    ).first<{ c: number | string }>(),
    db.prepare(
      `SELECT COALESCE(SUM(
        CASE "dealStage"
          WHEN 'PROPOSAL_SENT' THEN "monthlyValue" * 0.2
          WHEN 'NEGOTIATING' THEN "monthlyValue" * 0.5
          WHEN 'SIGNED' THEN "monthlyValue" * 0.9
          ELSE 0
        END
      ), 0) AS forecast FROM "Lead"
       WHERE "dealStage" IN ('PROPOSAL_SENT', 'NEGOTIATING', 'SIGNED')
         AND "monthlyValue" IS NOT NULL AND "isArchived" = 0`,
    ).first<{ forecast: number | string }>(),
  ]);

  return {
    mrr: Number(mrrRow?.mrr ?? 0),
    activeClients: Number(activeCount?.c ?? 0),
    inPipeline: Number(proposalCount?.c ?? 0),
    renewalsDue: Number(renewalCount?.c ?? 0),
    lostDeals: Number(lostCount?.c ?? 0),
    forecast: Number(forecastRow?.forecast ?? 0),
  };
}

type ReplyInboxItem = {
  id: number;
  businessName: string;
  city: string | null;
  niche: string | null;
  email: string | null;
  lastReplyAt: string | null;
  dealStage: string | null;
  replyAgeLabel: string;
  replyAgeHours: number;
};

async function getReplyInbox(): Promise<ReplyInboxItem[]> {
  const db = getDatabase();
  const result = await db.prepare(`
    SELECT id, businessName, city, niche, email, lastReplyAt, dealStage
    FROM "Lead"
    WHERE outreachStatus = 'REPLIED' AND dealStage IS NULL AND isArchived = 0
    ORDER BY lastReplyAt DESC
    LIMIT 10
  `).all<Omit<ReplyInboxItem, "replyAgeLabel" | "replyAgeHours">>();

  const nowMs = Date.now();
  return (result.results ?? []).map((item) => {
    const replyAge = item.lastReplyAt ? nowMs - new Date(item.lastReplyAt).getTime() : 0;
    const mins = Math.max(0, Math.floor(replyAge / 60_000));
    const hours = Math.floor(mins / 60);
    const days = Math.floor(hours / 24);
    return {
      ...item,
      replyAgeLabel: days > 0 ? `${days}d ago` : hours > 0 ? `${hours}h ago` : mins > 0 ? `${mins}m ago` : "just now",
      replyAgeHours: hours,
    };
  });
}

async function getConversionFunnel() {
  const db = getDatabase();
  const [totalRow, qualifiedRow, contactedRow, repliedRow, pipelineRow, wonRow] = await Promise.all([
    db.prepare(`SELECT COUNT(DISTINCT leadId) AS c FROM "FunnelEvent" WHERE eventType = 'LEAD_DISCOVERED'`).first<{ c: number | string }>(),
    db.prepare(`SELECT COUNT(DISTINCT leadId) AS c FROM "FunnelEvent" WHERE eventType = 'LEAD_QUALIFIED'`).first<{ c: number | string }>(),
    db.prepare(`SELECT COUNT(DISTINCT leadId) AS c FROM "FunnelEvent" WHERE eventType = 'OUTREACH_SENT'`).first<{ c: number | string }>(),
    db.prepare(`SELECT COUNT(DISTINCT leadId) AS c FROM "FunnelEvent" WHERE eventType = 'REPLY_DETECTED'`).first<{ c: number | string }>(),
    db.prepare(`SELECT COUNT(DISTINCT leadId) AS c FROM "FunnelEvent" WHERE eventType = 'OPPORTUNITY_CREATED'`).first<{ c: number | string }>(),
    db.prepare(`SELECT COUNT(DISTINCT leadId) AS c FROM "FunnelEvent" WHERE eventType = 'DEAL_WON'`).first<{ c: number | string }>(),
  ]);
  return {
    total: Number(totalRow?.c ?? 0),
    qualified: Number(qualifiedRow?.c ?? 0),
    contacted: Number(contactedRow?.c ?? 0),
    replied: Number(repliedRow?.c ?? 0),
    pipeline: Number(pipelineRow?.c ?? 0),
    won: Number(wonRow?.c ?? 0),
  };
}

async function getQualificationRoutes() {
  const row = await getDatabase()
    .prepare(
      `SELECT
        SUM(CASE WHEN "band" IN ('OUTREACH','PRIORITY') AND "recommendedChannel" = 'EMAIL' THEN 1 ELSE 0 END) AS emailReady,
        SUM(CASE WHEN "band" IN ('OUTREACH','PRIORITY') AND "recommendedChannel" IN ('PHONE','FORM') THEN 1 ELSE 0 END) AS directReady,
        SUM(CASE WHEN "band" IN ('OUTREACH','PRIORITY') AND "recommendedChannel" = 'SOCIAL' THEN 1 ELSE 0 END) AS socialReady,
        SUM(CASE WHEN "band" = 'REVIEW' THEN 1 ELSE 0 END) AS needsReview,
        SUM(CASE WHEN "hardGateStatus" = 'DISQUALIFIED' THEN 1 ELSE 0 END) AS disqualified
       FROM "QualificationSnapshot"
       WHERE "policyVersion" = 'axiom-revenue-v2'`,
    )
    .first<Record<string, number | string | null>>();

  return {
    directReady: Number(row?.directReady || 0),
    disqualified: Number(row?.disqualified || 0),
    emailReady: Number(row?.emailReady || 0),
    needsReview: Number(row?.needsReview || 0),
    socialReady: Number(row?.socialReady || 0),
  };
}

type FollowUpItem = {
  id: number;
  businessName: string;
  dealStage: string;
  nextAction: string | null;
  nextActionDueAt: string | null;
  monthlyValue: number | null;
};

async function getFollowUpItems() {
  const db = getDatabase();
  const now = new Date().toISOString();
  const easternToday = startOfTodayEastern();
  const todayStart = easternToday.toISOString();
  const tomorrowStart = new Date(easternToday.getTime() + 86_400_000).toISOString();
  const staleCutoff = new Date(Date.now() - 14 * 86_400_000).toISOString();
  const riskyCutoff = new Date(Date.now() - 21 * 86_400_000).toISOString();

  const [overdue, dueToday, stale, risky] = await Promise.all([
    // Overdue: past-due action items
    db.prepare(`
      SELECT id, businessName, dealStage, nextAction, nextActionDueAt, monthlyValue
      FROM "Lead"
      WHERE dealStage IS NOT NULL AND dealStage != 'LOST'
        AND nextActionDueAt IS NOT NULL AND nextActionDueAt < ?
        AND isArchived = 0
      ORDER BY nextActionDueAt ASC LIMIT 8
    `).bind(todayStart).all<FollowUpItem>(),

    // Due today
    db.prepare(`
      SELECT id, businessName, dealStage, nextAction, nextActionDueAt, monthlyValue
      FROM "Lead"
      WHERE dealStage IS NOT NULL AND dealStage != 'LOST'
        AND nextActionDueAt >= ? AND nextActionDueAt < ?
        AND isArchived = 0
      ORDER BY nextActionDueAt ASC LIMIT 8
    `).bind(todayStart, tomorrowStart).all<FollowUpItem>(),

    // Stale: open deal, no outbound or reply in 14+ days
    db.prepare(`
      SELECT id, businessName, dealStage, nextAction, nextActionDueAt, monthlyValue
      FROM "Lead"
      WHERE dealStage IN ('PROPOSAL_SENT', 'NEGOTIATING')
        AND (lastReplyAt IS NULL OR lastReplyAt < ?)
        AND (lastContactedAt IS NULL OR lastContactedAt < ?)
        AND isArchived = 0
      ORDER BY lastContactedAt ASC LIMIT 8
    `).bind(staleCutoff, staleCutoff).all<FollowUpItem>(),

    // Risky: proposal sent 21+ days ago, no sign
    db.prepare(`
      SELECT id, businessName, dealStage, nextAction, nextActionDueAt, monthlyValue
      FROM "Lead"
      WHERE dealStage = 'PROPOSAL_SENT'
        AND proposalSentAt IS NOT NULL AND proposalSentAt < ?
        AND isArchived = 0
      ORDER BY proposalSentAt ASC LIMIT 8
    `).bind(riskyCutoff).all<FollowUpItem>(),
  ]);

  // dedupe stale vs risky by id — risky takes precedence
  const riskyIds = new Set((risky.results ?? []).map((r) => r.id));
  const filteredStale = (stale.results ?? []).filter((r) => !riskyIds.has(r.id));

  return {
    overdue: overdue.results ?? [],
    dueToday: dueToday.results ?? [],
    stale: filteredStale,
    risky: risky.results ?? [],
    now,
  };
}

type AuditEntry = { id: string; type: string; title: string; createdAt: string; businessName: string | null; leadId: number | null };

async function getAuditLog(): Promise<AuditEntry[]> {
  const db = getDatabase();
  const rows = await db.prepare(
    `SELECT a."id", a."type", a."title", a."createdAt",
            l."businessName", l."id" AS "leadId"
     FROM "CrmActivity" a
     LEFT JOIN "Lead" l ON a."leadId" = l."id"
     ORDER BY datetime(a."createdAt") DESC
     LIMIT 20`,
  ).all<AuditEntry>().catch(() => ({ results: [] as AuditEntry[] }));
  return rows.results ?? [];
}

type ScrapeTargetRow = { id: string; niche: string; city: string; status: string; lastScrapedAt: string | null; leadCount: number };

type MessageVariantMetric = {
  campaignKey: string;
  variantKey: string;
  sent: number | string;
  replied: number | string;
  lastSentAt: string | null;
};

async function getMessageVariantMetrics(): Promise<MessageVariantMetric[]> {
  const rows = await getDatabase().prepare(
    `SELECT
       step."campaignKey",
       step."variantKey",
       COUNT(DISTINCT step."sequenceId") AS "sent",
       COUNT(DISTINCT CASE WHEN EXISTS (
         SELECT 1 FROM "FunnelEvent" reply
         WHERE reply."eventType" = 'REPLY_DETECTED'
           AND reply."sequenceId" = step."sequenceId"
           AND datetime(reply."occurredAt") >= datetime(step."sentAt")
       ) THEN step."sequenceId" END) AS "replied",
       MAX(step."sentAt") AS "lastSentAt"
     FROM "OutreachSequenceStep" step
     WHERE step."stepType" = 'INITIAL'
       AND step."status" = 'SENT'
       AND step."campaignKey" IS NOT NULL
       AND step."variantKey" IS NOT NULL
       AND step."validationStatus" = 'PASSED'
     GROUP BY step."campaignKey", step."variantKey"
     ORDER BY COUNT(DISTINCT step."sequenceId") DESC, step."variantKey" ASC
     LIMIT 8`,
  ).all<MessageVariantMetric>().catch(() => ({ results: [] as MessageVariantMetric[] }));
  return rows.results ?? [];
}

async function getScrapeTargetList(): Promise<ScrapeTargetRow[]> {
  const db = getDatabase();
  const rows = await db.prepare(
    `SELECT st."id", st."niche", st."city", st."status", st."lastScrapedAt",
            (SELECT COUNT(*) FROM "Lead" l WHERE l."niche" = st."niche" AND l."city" = st."city" AND COALESCE(l."isArchived",0) = 0) AS "leadCount"
     FROM "ScrapeTarget" st
     WHERE st."status" != 'disabled'
     ORDER BY st."lastScrapedAt" DESC
     LIMIT 20`,
  ).all<ScrapeTargetRow>().catch(() => ({ results: [] as ScrapeTargetRow[] }));
  return rows.results ?? [];
}

export default async function DashboardPage() {
  const session = await requireSession();
  const canOpenBusinessReview = session.user.role === "admin";

  const prisma = getPrisma();
  const renderNowMs = new Date().getTime();
  const emptyFollowUps = { overdue: [], dueToday: [], stale: [], risky: [], now: new Date().toISOString() };
  const readCritical = <T, F>(read: () => Promise<T>, fallback: F) =>
    Promise.resolve()
      .then(read)
      .then((value) => ({ value, unavailable: false }))
      .catch(() => ({ value: fallback, unavailable: true }));

  const [
    automationRead,
    operatorConsoleRead,
    scrapeJobs,
    leadCount,
    repliedCount,
    contactedCount,
    adequateToday,
    sendsTodayRead,
    recentTargets,
    nextTarget,
    activeTargets,
    series,
    crmStats,
    followUpsRead,
    connectedRowsRead,
    totalSentAllTime,
    replyInboxRead,
    funnel,
    qualificationRoutes,
    messageVariantsRead,
    auditLogRead,
    scrapeTargetList,
  ] = await Promise.all([
    readCritical(listAutomationOverview, emptyAutomationOverview()),
    readCritical(getAutomationOperatorConsole, null),
    listScrapeJobs(8).catch(() => []),
    prisma.lead.count({ where: { isArchived: false } }),
    prisma.lead.count({ where: { outreachStatus: "REPLIED", isArchived: false } }),
    prisma.lead.count({ where: { firstContactedAt: { not: null }, isArchived: false } }).catch(async () => {
      const r = await getDatabase()
        .prepare(`SELECT COUNT(*) AS c FROM "Lead" WHERE "firstContactedAt" IS NOT NULL AND COALESCE("isArchived", 0) = 0`)
        .first<{ c: number | string }>();
      return Number(r?.c || 0);
    }),
    countAdequateLeadsToday().catch(() => 0),
    readCritical(getSendsToday, { total: 0, perSender: {} as Record<string, number> }),
    listRecentScrapeTargets(5).catch(() => []),
    pickNextScrapeTarget().catch(() => null),
    countActiveScrapeTargets().catch(() => 0),
    get7DaySeries().catch(() => ({
      leadsFound: Array(7).fill(0),
      enriched: Array(7).fill(0),
      queued: Array(7).fill(0),
      sent: Array(7).fill(0),
      replied: Array(7).fill(0),
    })),
    getCrmStats().catch(() => EMPTY_CRM_STATS),
    readCritical(getFollowUpItems, emptyFollowUps),
    // Direct mailbox-table check — independent of listAutomationOverview()
    // so a broken helper doesn't make the banner falsely show "not connected".
    readCritical(() => getDatabase()
      .prepare(`SELECT LOWER("gmailAddress") AS gmailAddress, "status", "gmailConnectionId", "dailyLimit" FROM "OutreachMailbox"`)
      .all<{ gmailAddress: string; status: string | null; gmailConnectionId: string | null; dailyLimit: number | string | null }>()
      .then((r) => r.results ?? []),
      [] as Array<{ gmailAddress: string; status: string | null; gmailConnectionId: string | null; dailyLimit: number | string | null }>),
    getDatabase()
      .prepare(`SELECT COUNT(*) AS c FROM "OutreachEmail" WHERE "status" = 'sent'`)
      .first<{ c: number | string }>()
      .then((r) => Number(r?.c ?? 0))
      .catch(() => 0),
    readCritical(getReplyInbox, [] as ReplyInboxItem[]),
    getConversionFunnel().catch(() => ({ total: 0, qualified: 0, contacted: 0, replied: 0, pipeline: 0, won: 0 })),
    getQualificationRoutes().catch(() => ({ emailReady: 0, directReady: 0, socialReady: 0, needsReview: 0, disqualified: 0 })),
    readCritical(getMessageVariantMetrics, [] as MessageVariantMetric[]),
    readCritical(getAuditLog, [] as AuditEntry[]),
    getScrapeTargetList().catch(() => [] as ScrapeTargetRow[]),
  ]);

  const automation = automationRead.value;
  const operatorConsole = operatorConsoleRead.value;
  const sendsToday = sendsTodayRead.value;
  const followUps = followUpsRead.value;
  const connectedRows = connectedRowsRead.value;
  const replyInbox = replyInboxRead.value;
  const messageVariants = messageVariantsRead.value;
  const auditLog = auditLogRead.value;
  const criticalStatusUnavailable = [automationRead, operatorConsoleRead, sendsTodayRead, followUpsRead, connectedRowsRead, replyInboxRead]
    .some((read) => read.unavailable);
  const diagnosticsUnavailable = criticalStatusUnavailable || messageVariantsRead.unavailable || auditLogRead.unavailable;

  const activeScrape = scrapeJobs.find((j) => j.status === "running" || j.status === "claimed") ?? null;
  const replyRate = contactedCount > 0 ? (repliedCount / contactedCount) * 100 : 0;
  const intakeCap = getAutonomousDailyLeadCap();
  const globalSendCap = resolveGlobalDailySendCap({
    envCap: getServerEnv().AUTONOMOUS_MAX_SENDS_PER_DAY,
    mailboxCaps: connectedRows.filter(isSendableMailbox).map((row) => Number(row.dailyLimit || 0)),
    fallbackPerMailboxCap: MAILBOX_DAILY_SEND_TARGET,
    expectedMailboxCount: EXPECTED_MAILBOX_COUNT,
  });

  const aidanSends = sendsToday.perSender["aidan@getaxiom.ca"] || 0;
  const rileySends = sendsToday.perSender["riley@getaxiom.ca"] || 0;

  const intakePct = Math.min(100, (adequateToday / intakeCap) * 100);
  const sendPct = Math.min(100, (sendsToday.total / globalSendCap) * 100);
  const aidanPct = Math.min(100, (aidanSends / MAILBOX_DAILY_SEND_TARGET) * 100);
  const rileyPct = Math.min(100, (rileySends / MAILBOX_DAILY_SEND_TARGET) * 100);

  const intakeTone: ToneKey = adequateToday >= intakeCap ? "amber" : "emerald";
  const sendTone: ToneKey = sendsToday.total >= globalSendCap ? "amber" : "cyan";

  const connectedSet = new Set(connectedRows.filter(isSendableMailbox).map((r) => (r.gmailAddress || "").toLowerCase()));
  const aidanConnected = connectedSet.has("aidan@getaxiom.ca");
  const rileyConnected = connectedSet.has("riley@getaxiom.ca");
  const followUpAttentionCount = followUps.overdue.length + followUps.dueToday.length;
  const sendCapacityRemaining = Math.max(0, globalSendCap - sendsToday.total);
  const nextQueueEmails = operatorConsole?.nextEmails ?? [];
  const nextQueueEmail = nextQueueEmails[0] ?? null;
  const effectiveNextSendAt = operatorConsole?.metrics.nextSendAt ?? automation.engine.nextSendAt;
  const nextSendTarget = nextQueueEmail
    ? [
        nextQueueEmail.businessName,
        [nextQueueEmail.niche, nextQueueEmail.city].filter(Boolean).join(" / "),
      ].filter(Boolean).join(" · ")
    : "No email queued";
  const operatingMode = criticalStatusUnavailable
    ? "Status unavailable"
    : automation.settings.emergencyPaused
      ? "Emergency stop"
      : automation.engine.mode === "ACTIVE"
        ? "Autonomous"
        : automation.engine.mode;
  const riskItems = [
    automation.settings.emergencyPaused ? "Emergency stop blocks all automation" : null,
    "Mail route not verified",
    automation.engine.blockedCount > 0 ? `${automation.engine.blockedCount} blocked sequence${automation.engine.blockedCount === 1 ? "" : "s"}` : null,
    followUpAttentionCount > 0 ? `${followUpAttentionCount} client follow-up${followUpAttentionCount === 1 ? "" : "s"} due` : null,
  ].filter((item): item is string => Boolean(item));
  const runbookItems = [
    {
      label: "Mail route not verified",
      detail: "No paid inbox is assumed. Cloudflare forwarding and an owner reply route have not been proven.",
      icon: <Mail className="size-4" />,
      tone: "amber" as ToneKey,
    },
    automation.engine.blockedCount > 0
      ? {
          label: "Clear blocked sequences",
          detail: "Use Automation diagnostics to repair stale blockers.",
          href: "/automation" as Route,
          icon: <ShieldAlert className="size-4" />,
          tone: "amber" as ToneKey,
        }
      : automation.engine.overdueSendAt
      ? {
          label: "Scheduler behind",
          detail: `Oldest scheduled ${relativeAgo(automation.engine.overdueSendAt)} — ${automation.engine.queuedCount} queued, ${automation.engine.waitingCount} waiting.`,
          href: "/automation" as Route,
          icon: <ShieldAlert className="size-4" />,
          tone: "amber" as ToneKey,
        }
      : {
          label: "Scheduler clear",
          detail: `${automation.engine.queuedCount} queued, ${automation.engine.waitingCount} waiting.`,
          href: "/automation" as Route,
          icon: <Bot className="size-4" />,
          tone: "cyan" as ToneKey,
        },
    followUpAttentionCount > 0
      ? {
          label: "Work client replies",
          detail: `${followUpAttentionCount} follow-up${followUpAttentionCount === 1 ? "" : "s"} due now.`,
          href: "/clients" as Route,
          icon: <Reply className="size-4" />,
          tone: "violet" as ToneKey,
        }
      : {
          label: "Advance lead supply",
          detail: `${adequateToday}/${intakeCap} adequate leads captured today.`,
          href: "/vault" as Route,
          icon: <RouteIcon className="size-4" />,
          tone: "emerald" as ToneKey,
        },
  ];

  return (
    <div className="mx-auto flex max-w-[1320px] flex-col gap-5 text-[#20352c]">
      <header className="page-header-main border-b border-[#dce5dd] pb-5">
        <div className="min-w-0 flex-1">
          <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#537262]">Your workspace</span>
          <h1 className="mt-1 text-4xl font-semibold tracking-[-0.045em] text-[#20352c]">Today</h1>
          <p className="mt-1 text-sm text-[#52645a]">The decisions and people that need your attention.</p>
        </div>
        <div className="page-header-actions">
          <RefreshButton />
          <div className="rounded-lg border border-[#dce5dd] bg-white px-3 py-1.5 text-right text-[11px] text-[#52645a]">
          <div className="font-medium text-[#20352c]">
            {new Intl.DateTimeFormat("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: BUSINESS_TZ }).format(new Date())}
          </div>
          <div className="text-[10.5px] text-[#52645a]">
            {formatAppDateTime(new Date(), { hour: "numeric", minute: "2-digit" }, "")}
          </div>
          </div>
        </div>
      </header>

      {criticalStatusUnavailable ? (
        <div
          className="flex flex-wrap items-start gap-3 rounded-xl border border-amber-300 bg-[#fff8e8] px-4 py-3 text-sm text-[#583d12]"
          role="alert"
          aria-live="polite"
        >
          <ShieldAlert className="mt-0.5 size-4 shrink-0 text-amber-700" aria-hidden="true" />
          <div>
            <p className="font-semibold">Some status could not be checked</p>
            <p className="mt-1 text-[#745a2d]">
              Email, reply, or follow-up information may be incomplete. Do not start new external work until it is checked. This warning does not pause the live system.
            </p>
          </div>
        </div>
      ) : null}

      {!automationRead.unavailable && automation.settings.emergencyPaused ? (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-rose-200 bg-[#fff1ef] px-5 py-4 text-sm text-[#602b25]" role="alert" aria-live="polite">
          <ShieldAlert className="size-5 shrink-0 text-rose-700" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="font-semibold">System stop is on</p>
            <p className="mt-1 text-[#81534e]">The latest status says new intake, queueing, and sending are blocked.</p>
          </div>
          <Link href="/settings" className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-rose-300 bg-white px-4 text-sm font-semibold text-[#602b25] hover:bg-rose-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-700">
            Review safety <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        </div>
      ) : null}

      <section aria-label="Today owner action desk" className="grid gap-5">
        <div className="relative isolate overflow-hidden rounded-[28px] bg-[#143c2e] px-6 py-7 text-white shadow-[0_22px_48px_-34px_rgba(12,48,32,0.8)] sm:px-9 sm:py-9 lg:px-10">
          <div className="pointer-events-none absolute -right-24 -top-44 -z-10 size-[28rem] rounded-full border-[70px] border-white/[0.045]" aria-hidden="true" />
          <div className="grid items-end gap-8 lg:grid-cols-[minmax(0,1.35fr)_minmax(250px,0.65fr)]">
            <div className="max-w-2xl">
              <p className="inline-flex items-center rounded-full border border-white/20 bg-white/[0.08] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.15em] text-[#d1ebd9]">Your next decision</p>
              <h2 className="mt-5 max-w-xl text-3xl font-semibold leading-[1.12] tracking-[-0.045em] sm:text-4xl">Choose which businesses deserve a closer look.</h2>
              <p className="mt-4 max-w-xl text-sm leading-6 text-[#d1e1d5]">Check each proposed business and record whether to keep it, replace it, or pause for more research. This is a private review.</p>
              {canOpenBusinessReview ? (
                <Link href="/leads/m2/identity" className="mt-6 inline-flex min-h-12 w-full items-center justify-center gap-3 rounded-xl bg-[#eef5e9] px-6 text-sm font-bold text-[#174633] shadow-sm transition hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white sm:w-fit">
                  Review businesses <ArrowRight className="size-4" aria-hidden="true" />
                </Link>
              ) : (
                <p className="mt-6 inline-flex rounded-xl border border-white/25 px-4 py-3 text-sm text-[#d5e6d7]">A named owner can complete this review.</p>
              )}
            </div>
            <div className="rounded-2xl border border-white/20 bg-white/[0.07] p-5 backdrop-blur-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#bcd8c6]">What this decision does</p>
              <ol className="mt-4 grid gap-4 text-sm">
                <li className="flex gap-3"><span className="font-semibold text-[#cfe8ae]">01</span><span>Confirm the right company and location.</span></li>
                <li className="flex gap-3"><span className="font-semibold text-[#cfe8ae]">02</span><span>Record your choice and why.</span></li>
                <li className="flex gap-3"><span className="font-semibold text-[#cfe8ae]">03</span><span>Save it for the next research step.</span></li>
              </ol>
              <p className="mt-5 border-t border-white/15 pt-4 text-xs leading-5 text-[#bed3c5]">Nobody is contacted from this review.</p>
            </div>
          </div>
        </div>

        <div className="grid overflow-hidden rounded-[24px] border border-[#dce5dd] bg-white shadow-sm lg:grid-cols-[minmax(0,1.5fr)_minmax(280px,0.8fr)]">
          <section aria-labelledby="today-attention" className="p-5 sm:p-7 lg:p-8">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.15em] text-[#537262]">People</p>
                <h2 id="today-attention" className="mt-1 text-2xl font-semibold tracking-tight text-[#20352c]">Replies and follow-ups</h2>
              </div>
            </div>
            {replyInboxRead.unavailable || followUpsRead.unavailable ? (
              <div className="mt-5 rounded-xl border border-amber-300 bg-[#fff8e8] px-4 py-3 text-sm leading-6 text-[#583d12]" role="status">
                Reply or follow-up status could not be checked. Open the client board and confirm before taking action.
              </div>
            ) : replyInbox.length > 0 || followUpAttentionCount > 0 ? (
              <ul className="mt-5 divide-y divide-[#e4ebe2] overflow-hidden rounded-2xl border border-[#e4ebe2] bg-white" aria-label="Immediate owner actions">
                {followUps.overdue.slice(0, 3).map((item) => (
                  <li key={`overdue-${item.id}`}>
                    <Link href={`/clients/${item.id}`} className="flex min-h-16 items-center justify-between gap-3 px-4 py-3 text-sm hover:bg-[#fbfcfa] focus-visible:outline focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-[#145943] sm:px-5">
                      <span className="min-w-0"><strong className="block truncate text-[#20352c]">{item.businessName}</strong><span className="text-xs text-[#9a5424]">Overdue · {item.nextAction ?? "Client follow-up"}</span></span><span className="shrink-0 font-semibold text-[#145943]">Open action <ArrowRight className="ml-1 inline size-3.5" aria-hidden="true" /></span>
                    </Link>
                  </li>
                ))}
                {replyInbox.slice(0, Math.max(0, 3 - Math.min(3, followUps.overdue.length))).map((item) => (
                  <li key={`reply-${item.id}`}>
                    <Link href={`/clients/${item.id}`} className="flex min-h-16 items-center justify-between gap-3 px-4 py-3 text-sm hover:bg-[#fbfcfa] focus-visible:outline focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-[#145943] sm:px-5">
                      <span className="min-w-0"><strong className="block truncate text-[#20352c]">{item.businessName}</strong><span className="text-xs text-[#52645a]">Reply recorded · {item.replyAgeLabel}</span></span><span className="shrink-0 font-semibold text-[#145943]">Review reply <ArrowRight className="ml-1 inline size-3.5" aria-hidden="true" /></span>
                    </Link>
                  </li>
                ))}
                {followUps.dueToday.slice(0, Math.max(0, 3 - Math.min(3, followUps.overdue.length + replyInbox.length))).map((item) => (
                  <li key={`due-${item.id}`}>
                    <Link href={`/clients/${item.id}`} className="flex min-h-16 items-center justify-between gap-3 px-4 py-3 text-sm hover:bg-[#fbfcfa] focus-visible:outline focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-[#145943] sm:px-5">
                      <span className="min-w-0"><strong className="block truncate text-[#20352c]">{item.businessName}</strong><span className="text-xs text-[#52645a]">Due today · {item.nextAction ?? "Client follow-up"}</span></span><span className="shrink-0 font-semibold text-[#145943]">Open action <ArrowRight className="ml-1 inline size-3.5" aria-hidden="true" /></span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-5 rounded-xl border border-[#e4ebe2] bg-[#f8faf7] px-4 py-4 text-sm text-[#53675a]">No recorded replies or client actions are due right now.</p>
            )}
            <Link href="/clients" className="mt-4 inline-flex min-h-10 items-center gap-2 text-sm font-semibold text-[#145943] hover:text-[#0f4634] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145943]">See all client actions <ArrowRight className="size-4" aria-hidden="true" /></Link>
          </section>

          <aside className="border-t border-[#dce5dd] bg-[#f7f9f5] p-5 sm:p-7 lg:border-l lg:border-t-0 lg:p-8">
            <section aria-labelledby="today-readiness">
              <div className="flex items-center justify-between gap-3">
                <h3 id="today-readiness" className="text-sm font-semibold text-[#20352c]">Safety and email status</h3>
                <Link href="/settings" className="inline-flex min-h-8 items-center text-xs font-semibold text-[#145943] hover:underline">Details</Link>
              </div>
              <p className="mt-1 text-xs text-[#52645a]">{operatorConsoleRead.unavailable ? "Last checked: unavailable" : `Last checked ${formatAppDateTime(operatorConsole?.generatedAt, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`}</p>
              <div className="mt-3 grid gap-2">
                <div className="flex items-center justify-between gap-3 rounded-xl bg-[#f6f8f3] px-3.5 py-3">
                  <span className="text-sm text-[#53675a]">System stop</span>
                  <span className={`text-sm font-semibold ${automationRead.unavailable ? "text-amber-800" : automation.settings.emergencyPaused ? "text-rose-800" : "text-[#53675a]"}`}>
                    {automationRead.unavailable ? "Unknown" : automation.settings.emergencyPaused ? "On" : "Not active at last check"}
                  </span>
                </div>
                <div className="rounded-xl bg-[#fff8e8] px-3.5 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm text-[#745a2d]">Email route</span><span className="text-sm font-semibold text-[#745a2d]">Not verified</span>
                  </div>
                  <p className="mt-1 text-xs leading-5 text-[#806b45]">Forwarding and a working owner reply path have not been confirmed. Email is not cleared for use.</p>
                </div>
              </div>
            </section>

          </aside>
        </div>
      </section>

      <details className="group overflow-hidden rounded-xl border border-[#dce5dd] bg-white">
        <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 text-sm font-semibold text-[#52645a] hover:bg-[#f7f9f6] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145943]">
          <span>Operator details</span>
          <span className="text-xs font-normal text-[#68766c]">Optional diagnostics</span>
        </summary>
        {diagnosticsUnavailable ? (
          <p className="border-t border-[#dce5dd] bg-[#fff8e8] px-5 py-4 text-sm leading-6 text-amber-900">Diagnostics are hidden because some critical status could not be verified. This screen does not pause the live system.</p>
        ) : <div className="flex max-w-[1500px] flex-col gap-6 bg-[#0d0f13] p-4 text-white sm:p-6">
      <ControlRoomHero
        mode={operatingMode}
        hasRisk={riskItems.length > 0}
        risks={riskItems}
        sentToday={sendsToday.total}
        sendCap={globalSendCap}
        sendCapacityRemaining={sendCapacityRemaining}
        adequateToday={adequateToday}
        intakeCap={intakeCap}
        queued={automation.engine.queuedCount}
        waiting={automation.engine.waitingCount}
        blocked={automation.engine.blockedCount}
        nextSendAt={effectiveNextSendAt}
        overdueSendAt={effectiveNextSendAt ? null : automation.engine.overdueSendAt ?? null}
        nextTarget={nextSendTarget}
        runbookItems={runbookItems}
      />

      {/* Quick Actions */}
      <QuickActions />

      {automation.settings.emergencyPaused ? (
        <div
          className="v2-card border-red-400/25 bg-red-500/[0.07] px-4 py-3"
          role="alert"
          aria-live="polite"
        >
          <div className="flex flex-wrap items-center gap-3">
            <span className="v2-pill border-red-400/30 bg-red-500/[0.12] text-red-200">
              <ShieldAlert className="size-3" aria-hidden="true" />
              Emergency stop active
            </span>
            <span className="text-sm text-red-100/80">
              Intake, queueing, and sending are blocked until the stop is cleared in Settings.
            </span>
            <Link
              href="/settings"
              className="ml-auto inline-flex items-center gap-1 rounded-md border border-red-400/30 bg-red-500/[0.08] px-2 py-1 text-[11px] font-semibold text-red-200 transition hover:bg-red-500/[0.16]"
            >
              Open Settings
              <ArrowRight className="size-3" aria-hidden="true" />
            </Link>
          </div>
        </div>
      ) : null}

      <div className="flex items-start gap-3 rounded-xl border border-amber-400/25 bg-amber-400/[0.05] px-4 py-3 text-sm" role="status">
        <Mail className="mt-0.5 size-4 shrink-0 text-amber-300" aria-hidden="true" />
        <div>
          <p className="font-semibold text-amber-100">Mail route not verified</p>
          <p className="mt-1 text-amber-100/75">No paid inbox is assumed. Cloudflare forwarding and an owner reply route have not been proven.</p>
        </div>
      </div>
      <SendsTimeline
        upcoming={
          nextQueueEmails.map((s) => ({
            id: s.id,
            leadId: s.leadId,
            businessName: s.businessName,
            recipientEmail: s.recipientEmail ?? "",
            senderEmail: s.senderEmail,
            nextSendAt: s.effectiveSendAt ?? s.scheduledFor,
            scheduledFor: s.scheduledFor,
            queueStateLabel: s.queueStateLabel,
            stepNumber: 1,
            stepType: s.stepType,
          }))
        }
        followUpsPaused={Boolean(automation.settings?.followUpsPaused)}
        nowMs={renderNowMs}
        recent={
          (automation.recentSent ?? []).slice(0, 10).map((e) => ({
            id: e.id,
            sentAt: e.sentAt,
            subject: e.subject,
            senderEmail: e.senderEmail,
            recipientEmail: e.recipientEmail,
            businessName: e.lead?.businessName ?? null,
          }))
        }
      />

      <section className="grid gap-4 xl:grid-cols-4">
        <Panel
          title="Autonomous Intake"
          subtitle="Lead generation today (UTC)"
          accent="emerald"
          href="/vault"
        >
          <RatioMeter
            label="Adequate leads"
            value={adequateToday}
            cap={intakeCap}
            pct={intakePct}
            tone={intakeTone}
            footnote="score >= 30, owner >= 0.50 or staff >= 0.65, no role inboxes"
          />
          <Divider />
          <KvRow icon={<Radar className="size-3.5" />} label="Active targets" value={activeTargets.toLocaleString()} />
          <KvRow icon={<Activity className="size-3.5" />} label="Scrape state" value={activeScrape ? `${activeScrape.niche} · ${activeScrape.city}` : "Idle"} />
          <KvRow icon={<Clock3 className="size-3.5" />} label="Next dispatch" value={nextTarget ? `${nextTarget.niche} · ${nextTarget.city}` : "—"} />
          <Divider />
          <SubLabel>Recently dispatched</SubLabel>
          <ul className="space-y-1">
            {recentTargets.length === 0 ? (
              <li className="text-xs text-zinc-600">No dispatches yet — autonomous intake will start on the next cron tick.</li>
            ) : (
              recentTargets.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-3 text-xs">
                  <span className="truncate text-zinc-300">
                    <span className="font-mono text-zinc-500">{t.niche}</span>
                    <span className="px-1.5 text-zinc-700">·</span>
                    <span>{t.city}</span>
                  </span>
                  <span className="shrink-0 font-mono text-[10.5px] text-zinc-500">{relativeAgo(t.lastRunAt)}</span>
                </li>
              ))
            )}
          </ul>
        </Panel>

        <Panel
          title="Send Health"
          subtitle="Outbound email volume today (UTC)"
          accent="cyan"
          href="/settings"
        >
          <RatioMeter
            label="Sent today"
            value={sendsToday.total}
            cap={globalSendCap}
            pct={sendPct}
            tone={sendTone}
            footnote={`${MAILBOX_DAILY_SEND_TARGET}/day per mailbox · ${globalSendCap}/day configured`}
          />
          <Divider />
          <MailboxBar email="aidan@getaxiom.ca" sent={aidanSends} cap={MAILBOX_DAILY_SEND_TARGET} pct={aidanPct} connected={aidanConnected} />
          <MailboxBar email="riley@getaxiom.ca" sent={rileySends} cap={MAILBOX_DAILY_SEND_TARGET} pct={rileyPct} connected={rileyConnected} />
          <Divider />
          <KvRow icon={<Mail className="size-3.5" />} label="Total sent (all-time)" value={totalSentAllTime.toLocaleString()} />
          <KvRow icon={<MailCheck className="size-3.5" />} label="Reply rate" value={`${replyRate.toFixed(1)}%`} />
          <KvRow icon={<Reply className="size-3.5" />} label="Replies (all-time)" value={repliedCount.toLocaleString()} />
          <KvRow icon={<Bot className="size-3.5" />} label="Engine" value={automation.engine.mode} />
        </Panel>

        <Panel
          title="Pipeline Throughput"
          subtitle="Last 7 days"
          accent="violet"
          href="/vault"
        >
          <Sparkline label="Leads found" series={series.leadsFound} tone="emerald" />
          <Sparkline label="Enriched" series={series.enriched} tone="cyan" />
          <Sparkline label="Queued" series={series.queued} tone="violet" />
          <Sparkline label="Sent" series={series.sent} tone="blue" />
          <Sparkline label="Replied" series={series.replied} tone="amber" />
          <Divider />
          <KvRow icon={<Target className="size-3.5" />} label="Total leads" value={leadCount.toLocaleString()} />
          <KvRow icon={<CheckCircle2 className="size-3.5" />} label="Contacted" value={contactedCount.toLocaleString()} />
        </Panel>

        <Panel
          title="Revenue"
          subtitle="CRM deal pipeline"
          accent="amber"
          href="/clients"
        >
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-3xl font-semibold text-emerald-300 tabular-nums">
              ${crmStats.mrr.toLocaleString()}
            </span>
            <span className="text-xs text-zinc-500">/mo MRR</span>
          </div>
          {crmStats.forecast > 0 && (
            <div className="flex items-center gap-2 mt-1.5">
              <TrendingUp className="size-3 text-amber-400" />
              <span className="text-[11px] text-amber-300 font-medium">
                +${Math.round(crmStats.forecast).toLocaleString()}/mo weighted forecast
              </span>
            </div>
          )}
          <Divider />
          <KvRow icon={<Users className="size-3.5" />} label="Active clients" value={crmStats.activeClients.toLocaleString()} />
          <KvRow icon={<DollarSign className="size-3.5" />} label="In pipeline" value={crmStats.inPipeline.toLocaleString()} />
          <KvRow
            icon={<CheckCircle2 className="size-3.5" />}
            label="Renewals due ≤30d"
            value={
              crmStats.renewalsDue > 0 ? (
                <span className="text-amber-300">{crmStats.renewalsDue}</span>
              ) : (
                "0"
              )
            }
          />
          <KvRow icon={<Reply className="size-3.5" />} label="Lost deals" value={crmStats.lostDeals.toLocaleString()} />
          <Divider />
          <Link
            href="/clients"
            className="inline-flex items-center gap-1.5 text-xs text-emerald-400 hover:text-emerald-300 transition-colors font-medium"
          >
            <Users className="size-3.5" />
            Open client board →
          </Link>
        </Panel>
      </section>

      {/* Reply Inbox — interactive client component */}
      <ReplyInboxPanel items={replyInbox} />

      {/* Conversion Funnel */}
      <div className="v2-card overflow-hidden">
        <header className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
          <div>
            <div className="text-sm font-semibold text-white">Conversion Funnel</div>
            <div className="mt-0.5 text-[11px] text-zinc-500">Evidence ledger · deduplicated, all time</div>
          </div>
          <Filter className="size-4 text-zinc-600" />
        </header>
        <div className="p-4">
          <FunnelBar steps={[
            { label: "Scraped", value: funnel.total, tone: "zinc" },
            { label: "Qualified", value: funnel.qualified, tone: "cyan" },
            { label: "Contacted", value: funnel.contacted, tone: "violet" },
            { label: "Replied", value: funnel.replied, tone: "amber" },
            { label: "In Pipeline", value: funnel.pipeline, tone: "emerald" },
            { label: "Won", value: funnel.won, tone: "emerald" },
          ]} />
          <div className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-white/[0.06] bg-white/[0.06] md:grid-cols-5">
            {[
              { label: "Email ready", value: qualificationRoutes.emailReady, tone: "text-emerald-300" },
              { label: "Call / form", value: qualificationRoutes.directReady, tone: "text-cyan-300" },
              { label: "Social route", value: qualificationRoutes.socialReady, tone: "text-violet-300" },
              { label: "Needs review", value: qualificationRoutes.needsReview, tone: "text-amber-300" },
              { label: "Hard gated", value: qualificationRoutes.disqualified, tone: "text-zinc-400" },
            ].map((route) => (
              <div key={route.label} className="bg-[#101114] px-3 py-3">
                <div className={`font-mono text-lg font-semibold ${route.tone}`}>{route.value.toLocaleString()}</div>
                <div className="mt-0.5 text-[10px] uppercase tracking-[0.12em] text-zinc-600">{route.label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Evidence-bound messaging experiments */}
      <div className="v2-card overflow-hidden">
        <header className="flex flex-col gap-2 border-b border-white/[0.06] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-2.5">
            <div className="mt-0.5 rounded-lg border border-violet-400/15 bg-violet-400/10 p-1.5">
              <Radar className="size-4 text-violet-300" />
            </div>
            <div>
              <div className="text-sm font-semibold text-white">Message Learning Lab</div>
              <div className="mt-0.5 text-[11px] text-zinc-500">
                Evidence-first copy · first-touch reply attribution · no guessed historical variants
              </div>
            </div>
          </div>
          <span className="w-fit rounded-full border border-emerald-400/15 bg-emerald-400/10 px-2 py-1 font-mono text-[9px] uppercase tracking-[0.12em] text-emerald-300">
            policy evidence-first-v1
          </span>
        </header>
        {messageVariants.length === 0 ? (
          <div className="grid gap-3 p-4 md:grid-cols-[1fr_auto] md:items-center">
            <div>
              <div className="text-xs font-medium text-zinc-200">The experiment ledger is ready.</div>
              <p className="mt-1 max-w-2xl text-[11px] leading-relaxed text-zinc-500">
                New sends will store the exact evidence, opener, CTA, policy, and variant used. Old emails stay unassigned so this view never invents attribution.
              </p>
            </div>
            <div className="rounded-xl border border-white/[0.06] bg-black/20 px-4 py-3 text-right">
              <div className="font-mono text-xl font-semibold text-zinc-300">0</div>
              <div className="text-[9px] uppercase tracking-[0.12em] text-zinc-600">policy sends</div>
            </div>
          </div>
        ) : (
          <div className="divide-y divide-white/[0.05]">
            {messageVariants.map((variant) => {
              const sent = Number(variant.sent || 0);
              const replied = Number(variant.replied || 0);
              const rate = sent > 0 ? (replied / sent) * 100 : 0;
              return (
                <div key={`${variant.campaignKey}:${variant.variantKey}`} className="grid gap-3 px-4 py-3 md:grid-cols-[minmax(0,1fr)_90px_90px_100px] md:items-center">
                  <div className="min-w-0">
                    <div className="truncate font-mono text-[11px] text-zinc-200">{variant.variantKey.replace(/__/g, " · ")}</div>
                    <div className="mt-0.5 truncate text-[10px] text-zinc-600">{variant.campaignKey} · last sent {relativeAgo(variant.lastSentAt)}</div>
                  </div>
                  <div>
                    <div className="font-mono text-sm text-zinc-300">{sent.toLocaleString()}</div>
                    <div className="text-[9px] uppercase tracking-[0.1em] text-zinc-600">sent</div>
                  </div>
                  <div>
                    <div className="font-mono text-sm text-amber-300">{replied.toLocaleString()}</div>
                    <div className="text-[9px] uppercase tracking-[0.1em] text-zinc-600">replied</div>
                  </div>
                  <div>
                    <div className="font-mono text-sm text-emerald-300">{rate.toFixed(1)}%</div>
                    <div className="text-[9px] uppercase tracking-[0.1em] text-zinc-600">reply rate</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Audit Log & Scrape Targets */}
      <div className="grid gap-4 xl:grid-cols-2">
        {/* Audit Log */}
        <div className="v2-card overflow-hidden">
          <header className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
            <div className="flex items-center gap-2">
              <ScrollText className="size-4 text-zinc-500" />
              <span className="text-sm font-semibold text-white">Audit Log</span>
            </div>
            <span className="font-mono text-[10px] text-zinc-600">{auditLog.length} recent</span>
          </header>
          <div className="divide-y divide-white/[0.05] max-h-[280px] overflow-y-auto">
            {auditLog.length === 0 ? (
              <div className="px-4 py-8 text-center text-[11px] text-zinc-600">No activity logged yet</div>
            ) : (
              auditLog.map((entry) => (
                <div key={entry.id} className="flex items-start justify-between gap-3 px-4 py-2.5">
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-zinc-200 truncate">{entry.title}</div>
                    <div className="text-[10px] text-zinc-600 mt-0.5 truncate">
                      {entry.type.replace(/_/g, " ").toLowerCase()}
                      {entry.businessName ? ` · ${entry.businessName}` : ""}
                    </div>
                  </div>
                  <span className="shrink-0 font-mono text-[10px] text-zinc-600">
                    {relativeAgo(entry.createdAt)}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Scrape Targets */}
        <div className="v2-card overflow-hidden">
          <header className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
            <div className="flex items-center gap-2">
              <Crosshair className="size-4 text-zinc-500" />
              <span className="text-sm font-semibold text-white">Scrape Targets</span>
            </div>
            <span className="font-mono text-[10px] text-zinc-600">{scrapeTargetList.length} shown</span>
          </header>
          <div className="divide-y divide-white/[0.05] max-h-[280px] overflow-y-auto">
            {scrapeTargetList.length === 0 ? (
              <div className="px-4 py-8 text-center text-[11px] text-zinc-600">No scrape targets configured</div>
            ) : (
              scrapeTargetList.map((target) => (
                <div key={target.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-zinc-200 truncate">{target.niche}</div>
                    <div className="text-[10px] text-zinc-600 mt-0.5">{target.city}</div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="font-mono text-[10px] text-zinc-500">{Number(target.leadCount)} leads</span>
                    <span className={`rounded border px-1.5 py-0.5 text-[9px] font-semibold uppercase ${
                      target.status === "active" ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-300" :
                      target.status === "exhausted" ? "border-amber-500/20 bg-amber-500/10 text-amber-300" :
                      "border-zinc-600/20 bg-zinc-600/10 text-zinc-400"
                    }`}>
                      {target.status}
                    </span>
                    <span className="font-mono text-[10px] text-zinc-600">{relativeAgo(target.lastScrapedAt)}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Follow-Ups panel */}
      <FollowUpsPanel data={followUps} />
        </div>}
      </details>
    </div>
  );
}

type UpcomingSend = {
  id: string;
  leadId: number;
  businessName: string;
  recipientEmail: string;
  senderEmail: string | null;
  nextSendAt: Date | string | null;
  scheduledFor?: Date | string | null;
  queueStateLabel?: string | null;
  stepNumber?: number;
  stepType?: string;
};

type RecentSend = {
  id: string;
  sentAt: Date | string;
  subject: string;
  senderEmail: string;
  recipientEmail: string;
  businessName: string | null;
};

function SendsTimeline({ upcoming, recent, followUpsPaused, nowMs }: { upcoming: UpcomingSend[]; recent: RecentSend[]; followUpsPaused?: boolean; nowMs: number }) {
  return (
    <section className="grid gap-4 xl:grid-cols-2">
      <div className="v2-card overflow-hidden">
        <header className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-white">
              <Clock3 className="size-4 text-emerald-300" />
              Next 5 emails
            </div>
            <div className="mt-0.5 text-[11px] text-zinc-500">
              {followUpsPaused
                ? "First-touch-only mode. Follow-ups paused, not shown here."
                : "Who's getting an email next, from which inbox, and exactly when."}
            </div>
          </div>
          <Link href={"/automation" as Route} className="text-[11px] text-zinc-400 hover:text-white inline-flex items-center gap-1">
            See all <ArrowRight className="size-3" />
          </Link>
        </header>
        <div className="divide-y divide-white/[0.06]">
          {upcoming.length === 0 ? (
            <div className="px-4 py-6 text-center text-xs text-zinc-600">
              No emails scheduled right now.
            </div>
          ) : (
            upcoming.map((s, idx) => {
              const when = s.nextSendAt ? new Date(s.nextSendAt) : null;
              const rawScheduledAt = s.scheduledFor ? new Date(s.scheduledFor) : null;
              const diffMs = when ? when.getTime() - nowMs : 0;
              const isImminent = diffMs > 0 && diffMs <= 15 * 60_000;
              const wasBacklogged = Boolean(
                rawScheduledAt &&
                  when &&
                  Number.isFinite(rawScheduledAt.getTime()) &&
                  rawScheduledAt.getTime() < nowMs - 60_000 &&
                  rawScheduledAt.getTime() !== when.getTime(),
              );
              return (
                <div key={s.id} className="px-4 py-3">
                  <div className="flex items-start gap-3">
                    <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/[0.12] text-[11px] font-semibold text-emerald-300">
                      {idx + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <Link
                          href={`/clients/${s.leadId}` as Route}
                          className="truncate text-sm font-medium text-white hover:text-emerald-300"
                        >
                          {s.businessName}
                        </Link>
                        <span className={`shrink-0 font-mono text-[11px] tabular-nums ${isImminent ? "text-emerald-300" : "text-zinc-200"}`}>
                          {when ? relativeFuture(when) : "—"}
                        </span>
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-zinc-400">
                        <span>Sending to <span className="font-mono text-zinc-300">{s.recipientEmail || "—"}</span></span>
                        {s.senderEmail ? <span>from <span className="font-mono text-zinc-300">{s.senderEmail}</span></span> : null}
                        {s.stepNumber && s.stepNumber > 1 ? (
                          <span className="inline-flex items-center rounded-full border border-amber-400/30 bg-amber-400/[0.08] px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-[0.12em] text-amber-200">
                            {s.stepType === "FOLLOW_UP_1" ? "Follow-up 1" : s.stepType === "FOLLOW_UP_2" ? "Follow-up 2" : s.stepType === "FOLLOW_UP_3" ? "Follow-up 3" : `Step ${s.stepNumber}`}
                          </span>
                        ) : (
                          <span className="inline-flex items-center rounded-full border border-emerald-400/30 bg-emerald-400/[0.08] px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-[0.12em] text-emerald-200">
                            First touch
                          </span>
                        )}
                        {s.queueStateLabel ? (
                          <span className="inline-flex items-center rounded-full border border-white/[0.09] bg-white/[0.035] px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-[0.12em] text-zinc-300">
                            {s.queueStateLabel}
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-0.5 text-[10px] text-zinc-600">
                        {when ? formatAppDateTime(when, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }, "—") : "—"}
                        {wasBacklogged && rawScheduledAt ? ` | queued ${relativeAgo(rawScheduledAt)}` : ""}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      <div className="v2-card overflow-hidden">
        <header className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-white">
              <Mail className="size-4 text-cyan-300" />
              Recent emails
            </div>
            <div className="mt-0.5 text-[11px] text-zinc-500">
              Click any row to read the full email that went out.
            </div>
          </div>
          <Link href={"/automation" as Route} className="text-[11px] text-zinc-400 hover:text-white inline-flex items-center gap-1">
            See all <ArrowRight className="size-3" />
          </Link>
        </header>
        <div className="divide-y divide-white/[0.06]">
          {recent.length === 0 ? (
            <div className="px-4 py-6 text-center text-xs text-zinc-600">No emails sent yet.</div>
          ) : (
            recent.map((e) => (
              <SentEmailViewerTrigger key={e.id} emailId={e.id}>
                <div className="flex items-start justify-between gap-3 px-4 py-2.5">
                  <div className="min-w-0">
                    <div className="truncate text-sm text-white">
                      {e.businessName || e.recipientEmail}
                    </div>
                    <div className="mt-0.5 truncate text-[11px] text-zinc-400">{e.subject}</div>
                    <div className="mt-0.5 truncate font-mono text-[10.5px] text-zinc-600">
                      {e.senderEmail} → {e.recipientEmail}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="font-mono text-[11px] tabular-nums text-zinc-300">
                      {formatAppDateTime(e.sentAt, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }, "—")}
                    </div>
                    <div className="text-[10px] text-zinc-600 mt-0.5">{relativeAgo(e.sentAt)}</div>
                  </div>
                </div>
              </SentEmailViewerTrigger>
            ))
          )}
        </div>
      </div>
    </section>
  );
}

function ControlRoomHero({
  mode,
  hasRisk,
  risks,
  sentToday,
  sendCap,
  sendCapacityRemaining,
  adequateToday,
  intakeCap,
  queued,
  waiting,
  blocked,
  nextSendAt,
  overdueSendAt,
  nextTarget,
  runbookItems,
}: {
  mode: string;
  hasRisk: boolean;
  risks: string[];
  sentToday: number;
  sendCap: number;
  sendCapacityRemaining: number;
  adequateToday: number;
  intakeCap: number;
  queued: number;
  waiting: number;
  blocked: number;
  nextSendAt: Date | string | null;
  overdueSendAt: Date | string | null;
  nextTarget: string;
  runbookItems: Array<{
    label: string;
    detail: string;
    href?: Route;
    icon: ReactNode;
    tone: ToneKey;
  }>;
}) {
  const statusTone = hasRisk
    ? "border-amber-400/30 bg-amber-400/[0.07] text-amber-100"
    : "border-emerald-400/30 bg-emerald-400/[0.08] text-emerald-100";
  const sendPct = Math.min(100, (sentToday / Math.max(1, sendCap)) * 100);
  const intakePct = Math.min(100, (adequateToday / Math.max(1, intakeCap)) * 100);

  return (
    <section className="v2-card overflow-hidden">
      <div className="grid gap-0 xl:grid-cols-[minmax(0,1.1fr)_minmax(420px,0.9fr)]">
        <div className="border-b border-white/[0.06] p-5 xl:border-b-0 xl:border-r">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <span className={`inline-flex items-center gap-2 rounded-md border px-2.5 py-1 text-xs font-semibold ${statusTone}`}>
                {hasRisk ? <ShieldAlert className="size-3.5" /> : <Zap className="size-3.5" />}
                {mode}
              </span>
              <h2 className="mt-4 max-w-3xl text-2xl font-semibold tracking-[-0.02em] text-white md:text-3xl">
                {hasRisk ? "Pipeline needs operator attention" : "Pipeline is ready to keep moving"}
              </h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">
                {hasRisk
                  ? risks.join(". ")
                  : "Lead capture, sequencing, reply handling, and CRM movement are available from this surface."}
              </p>
            </div>
            <div className="grid min-w-[240px] grid-cols-2 gap-2">
              <HeroMetric label="Send capacity" value={sendCapacityRemaining} suffix="left" tone="cyan" />
              <HeroMetric label="Queue load" value={queued + waiting + blocked} suffix="steps" tone={blocked > 0 ? "amber" : "emerald"} />
            </div>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-3">
            <ProgressTile
              icon={<Send className="size-4" />}
              label="Sends today"
              value={`${sentToday}/${sendCap}`}
              pct={sendPct}
              tone="cyan"
            />
            <ProgressTile
              icon={<Target className="size-4" />}
              label="Adequate leads"
              value={`${adequateToday}/${intakeCap}`}
              pct={intakePct}
              tone="emerald"
            />
            <div className="v2-tile flex flex-col justify-between p-4">
              {nextSendAt ? (
                <>
                  <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                    <Clock3 className="size-4" />
                    Next send
                  </div>
                  <div className="mt-3 text-sm font-semibold text-white">{relativeFuture(nextSendAt)}</div>
                  <div className="mt-1 truncate text-xs text-zinc-500">{nextTarget}</div>
                </>
              ) : overdueSendAt ? (
                <>
                  <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-400">
                    <Clock3 className="size-4" />
                    Overdue send
                  </div>
                  <div className="mt-3 text-sm font-semibold text-amber-300">scheduled {relativeAgo(overdueSendAt)}</div>
                  <div className="mt-1 truncate text-xs text-zinc-500">scheduler not advancing — {nextTarget}</div>
                </>
              ) : (
                <>
                  <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                    <Clock3 className="size-4" />
                    Next send
                  </div>
                  <div className="mt-3 text-sm font-semibold text-white">idle</div>
                  <div className="mt-1 truncate text-xs text-zinc-500">{nextTarget}</div>
                </>
              )}
            </div>
          </div>
        </div>

        <aside className="p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-white">Operator runbook</div>
              <div className="mt-0.5 text-xs text-zinc-500">Highest-value next moves</div>
            </div>
            <span className="rounded-md border border-white/[0.08] bg-black/20 px-2 py-1 font-mono text-[10px] text-zinc-500">
              live
            </span>
          </div>
          <div className="mt-4 space-y-2">
            {runbookItems.map((item) => (
              <div
                key={item.label}
                className="group relative flex min-h-16 items-center gap-3 rounded-lg border border-white/[0.07] bg-white/[0.02] p-3 transition hover:border-white/[0.14] hover:bg-white/[0.045]"
              >
                {item.href ? <Link href={item.href} aria-label={`${item.label}. ${item.detail}`} className="absolute inset-0 rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-400" /> : null}
                <span className={`grid size-9 shrink-0 place-items-center rounded-md border ${TONE[item.tone].border} ${TONE[item.tone].bg} ${TONE[item.tone].text}`}>
                  {item.icon}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-zinc-100">{item.label}</span>
                  <span className="mt-0.5 block text-xs leading-5 text-zinc-500">{item.detail}</span>
                </span>
                {item.href ? <ArrowRight className="size-4 shrink-0 text-zinc-600 transition group-hover:translate-x-0.5 group-hover:text-zinc-300" aria-hidden="true" /> : null}
              </div>
            ))}
          </div>
        </aside>
      </div>
    </section>
  );
}

function HeroMetric({
  label,
  value,
  suffix,
  tone,
}: {
  label: string;
  value: number;
  suffix: string;
  tone: ToneKey;
}) {
  return (
    <div className="v2-tile p-3">
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">{label}</div>
      <div className={`mt-1 font-mono text-2xl font-semibold tabular-nums ${TONE[tone].text}`}>
        {value.toLocaleString()}
      </div>
      <div className="text-[10px] text-zinc-600">{suffix}</div>
    </div>
  );
}

function ProgressTile({
  icon,
  label,
  value,
  pct,
  tone,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  pct: number;
  tone: ToneKey;
}) {
  return (
    <div className="v2-tile p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
          <span className={TONE[tone].text}>{icon}</span>
          {label}
        </div>
        <span className="font-mono text-xs text-zinc-300">{value}</span>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/[0.05]">
        <div className={`h-full rounded-full ${TONE[tone].bar}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

// ---------- Follow-Ups Panel ----------

function FollowUpItemRow({ item, nowMs, overdue = false }: { item: FollowUpItem; nowMs: number; overdue?: boolean }) {
  const dueLabel = item.nextActionDueAt
    ? (() => {
        const d = new Date(item.nextActionDueAt);
        if (isNaN(d.getTime())) return null;
        const diff = Math.ceil((d.getTime() - nowMs) / 86_400_000);
        if (diff < 0) return `${Math.abs(diff)}d ago`;
        if (diff === 0) return "Today";
        if (diff === 1) return "Tomorrow";
        return `${diff}d`;
      })()
    : null;

  return (
    <Link href={`/clients/${item.id}`} className="flex items-start justify-between gap-2 py-1.5 border-b border-white/[0.04] last:border-0 hover:bg-white/[0.02] -mx-1 px-1 rounded transition-colors">
      <div className="min-w-0">
        <div className={`text-xs font-medium truncate ${overdue ? "text-red-200" : "text-zinc-200"}`}>
          {item.businessName}
        </div>
        <div className="text-[10.5px] text-zinc-500 truncate mt-px">
          {item.nextAction ?? item.dealStage.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())}
        </div>
      </div>
      <div className="flex flex-col items-end gap-0.5 shrink-0">
        {dueLabel && (
          <span className={`text-[10px] font-mono ${overdue ? "text-red-400" : "text-zinc-500"}`}>{dueLabel}</span>
        )}
        {item.monthlyValue ? (
          <span className="text-[10px] font-mono text-emerald-400">${item.monthlyValue.toLocaleString()}</span>
        ) : null}
      </div>
    </Link>
  );
}

function FollowUpGroup({
  icon,
  title,
  items,
  emptyLabel,
  nowMs,
  overdue = false,
}: {
  icon: ReactNode;
  title: string;
  items: FollowUpItem[];
  emptyLabel: string;
  nowMs: number;
  overdue?: boolean;
}) {
  return (
    <div className="p-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-zinc-500">{icon}</span>
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.15em] text-zinc-400">{title}</span>
        {items.length > 0 && (
          <span className={`font-mono text-[10px] border rounded px-1 py-px ${
            overdue
              ? "text-red-400 border-red-500/20 bg-red-500/10"
              : "text-zinc-500 border-white/[0.09] bg-black/30"
          }`}>
            {items.length}
          </span>
        )}
      </div>
      {items.length === 0 ? (
        <p className="text-[11px] text-zinc-700">{emptyLabel}</p>
      ) : (
        <div>
          {items.map((item) => (
            <FollowUpItemRow key={item.id} item={item} nowMs={nowMs} overdue={overdue} />
          ))}
        </div>
      )}
    </div>
  );
}

function FollowUpsPanel({ data }: { data: { overdue: FollowUpItem[]; dueToday: FollowUpItem[]; stale: FollowUpItem[]; risky: FollowUpItem[]; now: string } }) {
  const hasAny = data.overdue.length > 0 || data.dueToday.length > 0 || data.stale.length > 0 || data.risky.length > 0;
  const nowMs = Date.parse(data.now);

  return (
    <div className="v2-card overflow-hidden">
      <header className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
        <div>
          <div className="text-sm font-semibold text-white">Follow-Ups</div>
          <div className="mt-0.5 text-[11px] text-zinc-500">
            {hasAny ? "Items requiring attention" : "All clear"}
          </div>
        </div>
        <Link
          href="/clients"
          className="text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors font-medium flex items-center gap-1"
        >
          Board
          <span className="text-[10px]">→</span>
        </Link>
      </header>
      <div className="grid grid-cols-2 xl:grid-cols-4 divide-x divide-y xl:divide-y-0 divide-white/[0.05]">
        <FollowUpGroup
          icon={<Clock className="size-3.5" />}
          title="Overdue"
          items={data.overdue}
          emptyLabel="No overdue actions"
          nowMs={nowMs}
          overdue
        />
        <FollowUpGroup
          icon={<Clock3 className="size-3.5" />}
          title="Due Today"
          items={data.dueToday}
          emptyLabel="Nothing due today"
          nowMs={nowMs}
        />
        <FollowUpGroup
          icon={<Users className="size-3.5" />}
          title="Stale Deals"
          items={data.stale}
          emptyLabel="No stale deals"
          nowMs={nowMs}
        />
        <FollowUpGroup
          icon={<AlertTriangle className="size-3.5" />}
          title="Risky Proposals"
          items={data.risky}
          emptyLabel="No risky proposals"
          nowMs={nowMs}
        />
      </div>
    </div>
  );
}

type ToneKey = "emerald" | "cyan" | "violet" | "blue" | "amber" | "red" | "zinc";

const TONE: Record<ToneKey, { ring: string; bar: string; text: string; bg: string; border: string }> = {
  emerald: {
    ring: "stroke-emerald-400",
    bar: "bg-emerald-400",
    text: "text-emerald-300",
    bg: "bg-emerald-400/10",
    border: "border-emerald-400/30",
  },
  cyan: { ring: "stroke-cyan-400", bar: "bg-cyan-400", text: "text-cyan-300", bg: "bg-cyan-400/10", border: "border-cyan-400/30" },
  violet: { ring: "stroke-violet-400", bar: "bg-violet-400", text: "text-violet-300", bg: "bg-violet-400/10", border: "border-violet-400/30" },
  blue: { ring: "stroke-blue-400", bar: "bg-blue-400", text: "text-blue-300", bg: "bg-blue-400/10", border: "border-blue-400/30" },
  amber: { ring: "stroke-amber-400", bar: "bg-amber-400", text: "text-amber-300", bg: "bg-amber-400/10", border: "border-amber-400/30" },
  red: { ring: "stroke-red-400", bar: "bg-red-400", text: "text-red-300", bg: "bg-red-400/10", border: "border-red-400/30" },
  zinc: { ring: "stroke-zinc-500", bar: "bg-zinc-500", text: "text-zinc-300", bg: "bg-zinc-500/10", border: "border-zinc-500/30" },
};

function Panel({
  title,
  subtitle,
  accent,
  href,
  children,
}: {
  title: string;
  subtitle: string;
  accent: ToneKey;
  href?: Route;
  children: ReactNode;
}) {
  const headerContent = (
    <>
      <div>
        <div className="text-sm font-semibold text-white">{title}</div>
        <div className="mt-0.5 text-[11px] text-zinc-500">{subtitle}</div>
      </div>
      <div className="flex items-center gap-2">
        <span className={`inline-flex h-2 w-2 rounded-full ${TONE[accent].bar}`} />
        {href && <ArrowRight className="size-3 text-zinc-600 group-hover:text-zinc-400 transition-colors" />}
      </div>
    </>
  );

  return (
    <div className="v2-card overflow-hidden">
      {href ? (
        <Link href={href} className="group flex items-center justify-between border-b border-white/[0.06] px-4 py-3 transition-colors hover:bg-white/[0.02]">
          {headerContent}
        </Link>
      ) : (
        <header className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
          {headerContent}
        </header>
      )}
      <div className="space-y-3 p-4">{children}</div>
    </div>
  );
}

function Divider() {
  return <div className="-mx-4 my-2 h-px bg-white/[0.06]" />;
}

function SubLabel({ children }: { children: ReactNode }) {
  return <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">{children}</div>;
}

function RatioMeter({
  label,
  value,
  cap,
  pct,
  tone,
  footnote,
}: {
  label: string;
  value: number;
  cap: number;
  pct: number;
  tone: ToneKey;
  footnote?: string;
}) {
  const t = TONE[tone];
  const radius = 36;
  const circumference = 2 * Math.PI * radius;
  const dash = (pct / 100) * circumference;

  return (
    <div className="flex items-center gap-4">
      <div className="relative size-24 shrink-0">
        <svg viewBox="0 0 88 88" className="size-24 -rotate-90">
          <circle cx="44" cy="44" r={radius} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="6" />
          <circle
            cx="44"
            cy="44"
            r={radius}
            fill="none"
            className={t.ring}
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={`${dash} ${circumference}`}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <div className={`animate-counter-up font-mono text-2xl font-semibold tabular-nums ${t.text}`}>{value}</div>
          <div className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">/ {cap}</div>
        </div>
      </div>
      <div className="min-w-0">
        <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-zinc-400">{label}</div>
        <div className="mt-1 text-2xl font-semibold tabular-nums text-white">{pct.toFixed(0)}%</div>
        {footnote ? <div className="mt-1 text-[11px] leading-4 text-zinc-500">{footnote}</div> : null}
      </div>
    </div>
  );
}

function KvRow({ icon, label, value }: { icon: ReactNode; label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 text-xs">
      <span className="inline-flex items-center gap-2 text-zinc-500">
        {icon}
        {label}
      </span>
      <span className="truncate font-mono tabular-nums text-zinc-200">{value}</span>
    </div>
  );
}

function MailboxBar({
  email,
  sent,
  cap,
  pct,
  connected,
}: {
  email: string;
  sent: number;
  cap: number;
  pct: number;
  connected: boolean;
}) {
  const tone: ToneKey = !connected ? "red" : pct >= 100 ? "amber" : "cyan";
  const t = TONE[tone];

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-3 text-[11px]">
        <span className="truncate font-mono text-zinc-300">{email}</span>
        <span className={`shrink-0 ${connected ? t.text : "text-red-300"}`}>
          {connected ? `${sent} / ${cap}` : "not connected"}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.05]">
        {connected ? (
          <div className={`h-full ${t.bar} progress-animate transition-[width]`} style={{ width: `${pct}%` }} />
        ) : null}
      </div>
    </div>
  );
}

function Sparkline({ label, series, tone }: { label: string; series: number[]; tone: ToneKey }) {
  const t = TONE[tone];
  const max = Math.max(1, ...series);
  const total = series.reduce((sum, n) => sum + n, 0);
  const today = series[series.length - 1] || 0;
  const W = 160;
  const H = 28;
  const step = W / Math.max(1, series.length - 1);
  const points = series
    .map((n, i) => `${i * step},${H - (n / max) * (H - 4) - 2}`)
    .join(" ");
  const last = series.length - 1;
  const lastY = H - (today / max) * (H - 4) - 2;

  return (
    <div className="grid grid-cols-[1fr_auto] items-center gap-3">
      <div>
        <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-zinc-500">{label}</div>
        <div className="mt-0.5 flex items-baseline gap-2">
          <span className="font-mono text-lg font-semibold tabular-nums text-white">{today}</span>
          <span className="text-[10px] text-zinc-500">today · {total} / 7d</span>
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-7 w-[160px]">
        <polyline
          points={points}
          fill="none"
          className={t.ring}
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx={last * step} cy={lastY} r="2" className={`${t.ring} fill-current ${t.text}`} />
      </svg>
    </div>
  );
}

function FunnelBar({ steps }: { steps: Array<{ label: string; value: number; tone: ToneKey }> }) {
  const max = Math.max(1, steps[0]?.value ?? 1);
  return (
    <div className="space-y-2.5">
      {steps.map((step, i) => {
        const pct = Math.max(2, (step.value / max) * 100);
        const t = TONE[step.tone];
        const prev = i > 0 ? steps[i - 1].value : null;
        const convRate = prev && prev > 0 ? ((step.value / prev) * 100).toFixed(1) : null;
        return (
          <div key={step.label}>
            <div className="flex items-center justify-between gap-3 mb-1">
              <span className="text-[11px] font-medium text-zinc-400">{step.label}</span>
              <div className="flex items-center gap-2">
                {convRate && i > 0 && (
                  <span className="text-[10px] font-mono text-zinc-600">{convRate}%</span>
                )}
                <span className="font-mono text-xs font-semibold tabular-nums text-zinc-200">{step.value.toLocaleString()}</span>
              </div>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-white/[0.04]">
              <div className={`h-full rounded-full ${t.bar} transition-[width]`} style={{ width: `${pct}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
