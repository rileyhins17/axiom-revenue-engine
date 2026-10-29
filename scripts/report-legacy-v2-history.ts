import { createHash } from "node:crypto";
import { closeSync, fstatSync, lstatSync, openSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import Database from "better-sqlite3";

import { buildLegacyHistoryReconciliation } from "../src/lib/revenue-engine/legacy-history-reconciliation";
import type { LegacyHistoryEventStatus, LegacyHistoryReconciliationInput } from "../src/lib/revenue-engine/legacy-history-reconciliation";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const DATA_ROOT = path.join(ROOT, "data");
const MAX_DATABASE_BYTES = 512_000_000;
const MAX_REPORT_BYTES = 50_000_000;
const REQUIRED_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  Lead: ["id", "websiteDomain", "phone", "email", "outreachStatus", "firstContactedAt", "lastContactedAt", "lastReplyAt", "createdAt"],
  OutreachSuppression: ["id", "domain", "email", "leadId", "reason", "createdAt", "expiresAt"],
  OutreachEmail: ["id", "leadId", "status", "sentAt"],
  OutreachSequence: ["id", "leadId", "status", "lastSentAt", "replyDetectedAt", "stopReason", "createdAt", "updatedAt"],
  OutreachSequenceStep: ["id", "sequenceId", "status", "scheduledFor", "sentAt", "createdAt", "updatedAt"],
  FunnelEvent: ["id", "eventType", "leadId", "sequenceId", "occurredAt"],
  RevenueBusiness: ["id", "normalizedDomain", "normalizedPhone"],
  RevenueLocation: ["id", "businessId"],
  RevenueContactPoint: ["id", "businessId", "channel", "value"],
  RevenueBusinessStopEvent: ["businessId", "reason", "createdAt"],
};

function inside(parent: string, child: string) {
  const relative = path.relative(parent, child);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

export function resolveLegacySnapshotPath(value: string): string {
  const file = path.resolve(ROOT, value);
  if (!inside(DATA_ROOT, file) || path.dirname(file) !== DATA_ROOT || path.extname(file).toLowerCase() !== ".sqlite") {
    throw new Error("Snapshot must be a direct .sqlite child of ignored data/.");
  }
  return file;
}

export function resolveLegacyReportPath(value: string): string {
  const file = path.resolve(ROOT, value);
  if (!inside(DATA_ROOT, file) || path.dirname(file) !== DATA_ROOT || path.extname(file).toLowerCase() !== ".json") {
    throw new Error("Report must be a direct .json child of ignored data/.");
  }
  return file;
}

function assertSidecarsAbsent(file: string) {
  for (const suffix of ["-wal", "-shm", "-journal"]) {
    try { lstatSync(file + suffix); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    throw new Error("Snapshot must not have SQLite sidecars.");
  }
}

function stableFileIdentity(file: string) {
  const dataStats = lstatSync(DATA_ROOT);
  if (!dataStats.isDirectory() || dataStats.isSymbolicLink() || realpathSync(DATA_ROOT) !== DATA_ROOT) throw new Error("Ignored data directory must be a canonical local directory.");
  const before = lstatSync(file, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink() || before.size === BigInt(0) || before.size > BigInt(MAX_DATABASE_BYTES)) {
    throw new Error("Snapshot must be a bounded regular local file.");
  }
  const fd = openSync(file, "r");
  try {
    const opened = fstatSync(fd, { bigint: true });
    if (before.dev !== opened.dev || before.ino !== opened.ino) throw new Error("Snapshot identity changed before read.");
    const bytes = readFileSync(fd);
    const after = fstatSync(fd, { bigint: true });
    const final = lstatSync(file, { bigint: true });
    if ([after, final].some((stat) => !stat.isFile() || stat.isSymbolicLink() || stat.dev !== before.dev || stat.ino !== before.ino)
      || before.size !== after.size || after.size !== final.size || after.size !== BigInt(bytes.length)
      || before.mtimeNs !== after.mtimeNs || after.mtimeNs !== final.mtimeNs
      || before.ctimeNs !== after.ctimeNs || after.ctimeNs !== final.ctimeNs) throw new Error("Snapshot changed while hashing.");
    return {
      device: after.dev.toString(), inode: after.ino.toString(), bytes: bytes.length,
      mtime: after.mtimeNs.toString(), ctime: after.ctimeNs.toString(),
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
  } finally { closeSync(fd); }
}

function assertSchema(database: Database.Database) {
  const tables = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[];
  const names = new Set(tables.map((row) => row.name));
  for (const [table, required] of Object.entries(REQUIRED_COLUMNS)) {
    if (!names.has(table)) throw new Error(`Snapshot schema is missing required table ${table}.`);
    const columns = new Set((database.pragma(`table_info("${table}")`) as { name: string }[]).map((row) => row.name));
    for (const column of required) if (!columns.has(column)) throw new Error(`Snapshot schema is missing required column ${table}.${column}.`);
  }
}

function text(value: unknown): string | null { return typeof value === "string" && value !== "" ? value : null; }
function id(value: unknown): string { return String(value); }
export function normalizeLegacySqliteUtcTimestamp(value: string): string {
  const sqliteUtc = /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(value);
  const isoUtc = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value);
  if (!sqliteUtc && !isoUtc) throw new Error("Snapshot contains an unsupported or ambiguous timestamp format.");
  const inputIso = sqliteUtc
    ? `${value.replace(" ", "T")}.000Z`
    : value.includes(".")
      ? value.replace(/\.(\d{1,3})Z$/, (_, fraction: string) => `.${fraction.padEnd(3, "0")}Z`)
      : value.replace(/Z$/, ".000Z");
  const parsed = Date.parse(inputIso);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== inputIso) throw new Error("Snapshot contains an invalid timestamp.");
  return inputIso;
}
function asStatus(value: string | null, allowed: readonly LegacyHistoryEventStatus[], fallback: LegacyHistoryEventStatus): LegacyHistoryEventStatus {
  const status = value?.toUpperCase() ?? fallback;
  return allowed.find((candidate) => candidate === status) ?? fallback;
}
const eventStatuses: readonly LegacyHistoryEventStatus[] = ["ACTIVE", "REVOKED", "EXPIRED", "SENT", "ACCEPTED", "DELIVERED", "UNKNOWN_OUTCOME", "FAILED", "CANCELLED", "BOUNCED", "REPLIED", "UNSUBSCRIBED", "COMPLAINT", "OUTREACH_SENT", "REPORTED_CONTACTED", "REPORTED_REPLIED", "REPORTED_BOUNCED", "OPEN", "CLICKED", "PREPARED", "APPROVED", "SKIPPED"];

function extraction(database: Database.Database, snapshotId: string, asOf: string): { input: LegacyHistoryReconciliationInput; rowCounts: Record<string, number>; schemaSha256: string } {
  const leadRows = database.prepare(`SELECT "id", "websiteDomain", "phone", "email", "outreachStatus", "firstContactedAt", "lastContactedAt", "lastReplyAt", "createdAt" FROM "Lead" ORDER BY "id"`).all()
    .map((row) => row as { id: number; websiteDomain: string | null; phone: string | null; email: string | null; outreachStatus: string | null; firstContactedAt: string | null; lastContactedAt: string | null; lastReplyAt: string | null; createdAt: string });
  const legacyLeads = leadRows.map((row) => ({ leadId: id(row.id), domain: text(row.websiteDomain), phone: text(row.phone), email: text(row.email) }));
  const businesses = database.prepare(`SELECT "id", "normalizedDomain", "normalizedPhone" FROM "RevenueBusiness" ORDER BY "id"`).all()
    .map((row) => row as { id: string; normalizedDomain: string | null; normalizedPhone: string | null })
    .map((row) => ({ businessId: row.id, domain: text(row.normalizedDomain), phone: text(row.normalizedPhone) }));
  const locations = database.prepare(`SELECT "id", "businessId" FROM "RevenueLocation" ORDER BY "id"`).all()
    .map((row) => row as { id: string; businessId: string })
    .map((row) => ({ locationId: row.id, businessId: row.businessId, phone: null }));
  const contactPoints = database.prepare(`SELECT "id", "businessId", "channel", "value" FROM "RevenueContactPoint" WHERE "channel" IN ('EMAIL', 'PHONE') ORDER BY "id"`).all()
    .map((row) => row as { id: string; businessId: string; channel: "EMAIL" | "PHONE"; value: string })
    .map((row) => ({ contactPointId: row.id, businessId: row.businessId, channel: row.channel, value: row.value }));
  const events: LegacyHistoryReconciliationInput["events"] = [];
  const suppressionRows = database.prepare(`SELECT "id", "leadId", "domain", "email", "createdAt", "expiresAt" FROM "OutreachSuppression" ORDER BY "id"`).all() as { id: string; leadId: number | null; domain: string | null; email: string | null; createdAt: string; expiresAt: string | null }[];
  for (const row of suppressionRows) {
    const expired = row.expiresAt !== null && Date.parse(normalizeLegacySqliteUtcTimestamp(row.expiresAt)) <= Date.parse(asOf);
    events.push({ eventId: `suppression:${row.id}`, leadId: row.leadId === null ? null : id(row.leadId), type: "SUPPRESSION", status: expired ? "EXPIRED" : "ACTIVE", occurredAt: row.createdAt, expiresAt: text(row.expiresAt), domain: text(row.domain), email: text(row.email) });
  }
  const emails = database.prepare(`SELECT "id", "leadId", "status", "sentAt" FROM "OutreachEmail" ORDER BY "id"`).all() as { id: string; leadId: number; status: string; sentAt: string }[];
  for (const row of emails) {
    const status = row.status.toUpperCase();
    const sentOutcome = ["SENT", "ACCEPTED", "DELIVERED", "BOUNCED"].includes(status);
    const projectedStatus = row.sentAt !== null && !sentOutcome ? "UNKNOWN_OUTCOME" : asStatus(row.status, eventStatuses, "UNKNOWN_OUTCOME");
    events.push({ eventId: `email:${row.id}`, leadId: id(row.leadId), type: "SEND", status: projectedStatus, occurredAt: row.sentAt, expiresAt: null });
  }
  const sequences = database.prepare(`SELECT "id", "leadId", "status", "lastSentAt", "replyDetectedAt", "stopReason", "createdAt", "updatedAt" FROM "OutreachSequence" ORDER BY "id"`).all() as { id: string; leadId: number; status: string; lastSentAt: string | null; replyDetectedAt: string | null; stopReason: string | null; createdAt: string; updatedAt: string }[];
  const sequenceLead = new Map<string, string>();
  const sequenceStopReason = new Map<string, string | null>();
  for (const row of sequences) {
    sequenceLead.set(row.id, id(row.leadId));
    sequenceStopReason.set(row.id, row.stopReason?.toUpperCase() ?? null);
    const stop = row.stopReason?.toUpperCase();
    const isKnownUnsent = ["QUEUED", "PAUSED", "COMPLETED", "CANCELLED", "STOPPED"].includes(row.status.toUpperCase());
    const status = stop === "REPLIED" ? "REPLIED" : stop === "BOUNCED" ? "BOUNCED" : row.lastSentAt ? "SENT" : isKnownUnsent ? "PREPARED" : "UNKNOWN_OUTCOME";
    const isOutcome = stop === "REPLIED" || stop === "BOUNCED";
    const outcomeAt = isOutcome ? row.replyDetectedAt ?? row.updatedAt ?? row.createdAt : row.lastSentAt ?? row.updatedAt ?? row.createdAt;
    events.push({ eventId: `sequence:${row.id}`, leadId: id(row.leadId), type: "SEQUENCE", status, occurredAt: outcomeAt, expiresAt: null });
    if (row.replyDetectedAt !== null && stop !== "REPLIED" && stop !== "BOUNCED") events.push({ eventId: `sequence-ambiguous-reply:${row.id}`, leadId: id(row.leadId), type: "SEQUENCE", status: "UNKNOWN_OUTCOME", occurredAt: row.replyDetectedAt, expiresAt: null });
    else if (row.replyDetectedAt !== null && stop === "REPLIED") events.push({ eventId: `sequence-reply:${row.id}`, leadId: id(row.leadId), type: "FUNNEL", status: "REPLIED", occurredAt: row.replyDetectedAt, expiresAt: null });
  }
  const steps = database.prepare(`SELECT "id", "sequenceId", "status", "scheduledFor", "sentAt", "createdAt", "updatedAt" FROM "OutreachSequenceStep" ORDER BY "id"`).all() as { id: string; sequenceId: string; status: string; scheduledFor: string; sentAt: string | null; createdAt: string; updatedAt: string }[];
  for (const row of steps) {
    const normalized = row.status.toUpperCase();
    const isKnownUnsent = ["SCHEDULED", "QUEUED", "PENDING", "CANCELLED", "FAILED"].includes(normalized);
    const hasSendEvidence = row.sentAt !== null;
    const sentOutcome = ["SENT", "ACCEPTED", "DELIVERED", "BOUNCED"].includes(normalized);
    const status = hasSendEvidence ? sentOutcome ? asStatus(row.status, eventStatuses, "UNKNOWN_OUTCOME") : "UNKNOWN_OUTCOME" : isKnownUnsent ? asStatus(row.status, eventStatuses, "PREPARED") : "UNKNOWN_OUTCOME";
    events.push({ eventId: `step:${row.id}`, leadId: sequenceLead.get(row.sequenceId) ?? null, type: "STEP", status, occurredAt: row.sentAt ?? row.updatedAt ?? row.createdAt, expiresAt: null });
  }
  const funnel = database.prepare(`SELECT "id", "leadId", "sequenceId", "eventType", "occurredAt" FROM "FunnelEvent" ORDER BY "id"`).all() as { id: string; leadId: number | null; sequenceId: string | null; eventType: string; occurredAt: string }[];
  const relevantFunnel = funnel.filter((row) => /^(OUTREACH_|REPLY_|BOUNCE_|UNSUBSCRIBE|COMPLAINT)/i.test(row.eventType));
  for (const row of relevantFunnel) {
    const eventType = row.eventType.toUpperCase();
    const bouncedReplyContradiction = eventType === "REPLY_DETECTED" && row.sequenceId !== null && sequenceStopReason.get(row.sequenceId) === "BOUNCED";
    const status = bouncedReplyContradiction ? "UNKNOWN_OUTCOME" : eventType === "OUTREACH_SENT" ? "SENT" : eventType === "REPLY_DETECTED" ? "REPLIED" : eventType.startsWith("BOUNCE_") ? "BOUNCED" : eventType.startsWith("UNSUBSCRIBE") ? "UNSUBSCRIBED" : eventType.startsWith("COMPLAINT") ? "COMPLAINT" : eventType === "OUTREACH_FAILED" ? "FAILED" : "UNKNOWN_OUTCOME";
    events.push({ eventId: `funnel:${row.id}`, leadId: row.leadId === null ? null : id(row.leadId), type: "FUNNEL", status, occurredAt: row.occurredAt, expiresAt: null });
  }
  for (const row of leadRows) {
    const leadId = id(row.id);
    const status = row.outreachStatus?.toUpperCase();
    const knownHistoryStatuses = ["OUTREACHED", "CONTACTED", "BOUNCED", "REPLIED", "INTERESTED", "SUPPRESSED"];
    if (["OUTREACHED", "CONTACTED"].includes(status ?? "") || row.firstContactedAt !== null || row.lastContactedAt !== null) {
      events.push({ eventId: `lead-contact-state:${row.id}`, leadId, type: "LEAD_STATE", status: "REPORTED_CONTACTED", occurredAt: row.lastContactedAt ?? row.firstContactedAt ?? row.createdAt, expiresAt: null });
    }
    if (["REPLIED", "INTERESTED"].includes(status ?? "") || row.lastReplyAt !== null) {
      events.push({ eventId: `lead-reply-state:${row.id}`, leadId, type: "LEAD_STATE", status: "REPORTED_REPLIED", occurredAt: row.lastReplyAt ?? row.lastContactedAt ?? row.createdAt, expiresAt: null });
    }
    if (status === "BOUNCED") events.push({ eventId: `lead-bounce-state:${row.id}`, leadId, type: "LEAD_STATE", status: "REPORTED_BOUNCED", occurredAt: row.lastContactedAt ?? row.firstContactedAt ?? row.createdAt, expiresAt: null });
    if (status === "SUPPRESSED") events.push({ eventId: `lead-suppression-state:${row.id}`, leadId, type: "SUPPRESSION", status: "ACTIVE", occurredAt: row.lastContactedAt ?? row.createdAt, expiresAt: null });
    const knownPreContactStatuses = ["NOT_CONTACTED", "ENRICHING", "ENRICHED", "READY_FOR_FIRST_TOUCH"];
    if (status !== null && status !== undefined && status !== "" && !knownPreContactStatuses.includes(status) && !knownHistoryStatuses.includes(status)) {
      events.push({ eventId: `lead-state-unknown:${row.id}`, leadId, type: "LEAD_STATE", status: "UNKNOWN_OUTCOME", occurredAt: row.lastContactedAt ?? row.lastReplyAt ?? row.createdAt, expiresAt: null });
    }
  }
  const v2BusinessStops = database.prepare(`SELECT "businessId", "reason", "createdAt" FROM "RevenueBusinessStopEvent" ORDER BY "businessId"`).all() as { businessId: string; reason: string; createdAt: string }[];
  const schema = database.prepare(`SELECT "type", "name", "tbl_name", "sql" FROM "sqlite_master" ORDER BY "type", "name", "tbl_name"`).all();
  const rowCounts: Record<string, number> = {};
  for (const table of Object.keys(REQUIRED_COLUMNS)) {
    rowCounts[table] = (database.prepare(`SELECT COUNT(*) AS count FROM "${table}"`).get() as { count: number }).count;
  }
  const normalizedEvents = events.map((event) => ({ ...event, occurredAt: normalizeLegacySqliteUtcTimestamp(event.occurredAt), expiresAt: event.expiresAt === null ? null : normalizeLegacySqliteUtcTimestamp(event.expiresAt) }));
  return { input: {
    snapshot: { snapshotId, asOf }, complete: true, legacyLeads, businesses, locations, contactPoints, events: normalizedEvents,
    v2BusinessStops: v2BusinessStops.map((row) => ({ businessId: row.businessId, kind: row.reason === "OTHER" ? "UNKNOWN" : "SUPPRESSION", status: "ACTIVE", expiresAt: null })),
  } as LegacyHistoryReconciliationInput, rowCounts, schemaSha256: createHash("sha256").update(JSON.stringify(schema)).digest("hex") };
}

function parseArgs(args: string[]) {
  if (args.length !== 6 || args[0] !== "--database" || args[2] !== "--as-of" || args[4] !== "--output") throw new Error("Usage: tsx scripts/report-legacy-v2-history.ts --database data/snapshot.sqlite --as-of 2026-09-22T12:00:00.000Z --output data/report.json");
  const asOf = args[3]!;
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(asOf) || new Date(asOf).toISOString() !== asOf) throw new Error("--as-of must be a canonical UTC ISO timestamp.");
  return { database: resolveLegacySnapshotPath(args[1]!), output: resolveLegacyReportPath(args[5]!), asOf };
}

export function reportLegacyV2History(args: string[]) {
  const files = parseArgs(args);
  assertSidecarsAbsent(files.database);
  const before = stableFileIdentity(files.database);
  const database = new Database(files.database, { readonly: true, fileMustExist: true, timeout: 0 });
  let report;
  try {
    database.pragma("query_only = ON");
    database.pragma("foreign_keys = ON");
    database.exec("BEGIN");
    if ((database.pragma("database_list") as unknown[]).length !== 1) throw new Error("Snapshot must contain exactly one SQLite database.");
    if (database.pragma("integrity_check", { simple: true }) !== "ok" || (database.pragma("foreign_key_check") as unknown[]).length !== 0) throw new Error("Snapshot integrity or foreign-key check failed.");
    assertSchema(database);
    const projected = extraction(database, before.sha256, files.asOf);
    report = buildLegacyHistoryReconciliation(projected.input);
    (report as typeof report & { source?: unknown }).source = {
      snapshotSha256: before.sha256,
      schemaSha256: projected.schemaSha256,
      schemaValidationMode: "required-tables-and-columns-only; migration-ledger-not-verified",
      rowCounts: projected.rowCounts,
      rowProjectionVersion: "legacy-history-snapshot-v1",
    };
  } finally { database.close(); }
  assertSidecarsAbsent(files.database);
  const after = stableFileIdentity(files.database);
  if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error("Snapshot identity or content changed during report generation.");
  const payload = `${JSON.stringify({ ...report, mergeApproved: false, outreachAuthorized: false }, null, 2)}\n`;
  if (Buffer.byteLength(payload) > MAX_REPORT_BYTES) throw new Error("Report exceeds the maximum allowed size.");
  const fd = openSync(files.output, "wx", 0o600);
  try {
    writeFileSync(fd, payload, "utf8");
  } finally { closeSync(fd); }
  const output = lstatSync(files.output);
  if (!output.isFile() || output.isSymbolicLink()) throw new Error("Report output identity check failed.");
  return { output: files.output, snapshotId: before.sha256, leadCount: report.history.length, mappingCount: report.mappings.length, unresolvedHistory: report.unresolvedHistory };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = reportLegacyV2History(process.argv.slice(2));
    console.log(`Offline reconciliation report saved for ${result.mappingCount} legacy leads; unresolved history: ${result.unresolvedHistory}.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Offline reconciliation report failed.");
    process.exitCode = 1;
  }
}
