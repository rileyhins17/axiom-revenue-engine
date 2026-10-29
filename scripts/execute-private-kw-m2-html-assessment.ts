import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { closeSync, fstatSync, fsyncSync, linkSync, lstatSync, openSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Database from "better-sqlite3";
import { z } from "zod";

import { PrivateKwImportPlanSchema } from "../src/lib/revenue-engine/private-kw-import";
import { PrivateKwShadowSliceManifestSchema } from "../src/lib/revenue-engine/private-kw-shadow-slice";
import { privateKwM2Digest } from "../src/lib/revenue-engine/private-kw-m2-authorization";
import {
  assertPrivateKwM2HtmlAssessmentApproval, buildPrivateKwM2HtmlAssessmentCandidate, buildPrivateKwM2HtmlAssessmentPlan,
  m2AssessmentJson, parseM2EvidenceContext, PrivateKwM2HtmlAssessmentApprovalSchema,
  recordPrivateKwM2HtmlAssessmentApproval, type PrivateKwM2HtmlAssessmentPlan, type PrivateKwM2HtmlAssessmentContext,
} from "../src/lib/revenue-engine/private-kw-m2-html-assessment";
import { PrivateKwM2HtmlEvidenceRequestSchema } from "../src/lib/revenue-engine/private-kw-m2-html-evidence-schema";
import { reloadPrivateKwM2WebsiteEvidenceReceipt, type PrivateKwM2WebsiteEvidenceReceiptReloadInput } from "../src/lib/revenue-engine/private-kw-m2-html-evidence-workflow";
import { projectPrivateKwM2OwnerLeadDetail } from "../src/lib/revenue-engine/private-kw-m2-owner-projection";
import { buildPrivateKwM2ResearchReport } from "../src/lib/revenue-engine/private-kw-m2-terminal-report";
import { LocalM2OwnerConsoleSchema } from "../src/lib/revenue-engine/m2-owner-console-contract";
import {
  PrivateKwM2SetupReleaseEnvelopeSchema, PrivateKwM2TimedDatabaseSetupReceiptSchema,
  privateKwM2SetupDigest,
} from "../src/lib/revenue-engine/private-kw-m2-setup-release";
import { PRIVATE_KW_M2_MIGRATION_FILES } from "./private-kw-m2-database";
import { reloadPrivateKwM2SourceMaterialization } from "./private-kw-m2-source-reload";
import { PRIVATE_KW_M2_SETUP_LOCK_PATH } from "./private-kw-m2-setup";
import {
  assertSetupDirectory, assertSetupFileUnchanged, assertSetupSidecarsAbsent,
  createSetupTemp, inspectSetupSnapshot, inspectSetupSqlite, readSetupFile, removeSetupTemp, sameSetupInode,
  type SetupFileIdentity,
} from "./private-kw-m2-snapshot";

const ROOT = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const DATA = path.join(ROOT, "data", "kw-evaluation");
const DataPath = z.string().regex(/^data\/kw-evaluation\/[A-Za-z0-9._-]+\.json$/);
const OperationSchema = z.object({ businessId: z.string().min(1).max(128), materializationPath: DataPath,
  requestPath: DataPath, candidatePath: DataPath, approvalPath: DataPath, progressPath: DataPath, reportPath: DataPath }).strict();
export const PrivateKwM2AssessmentRunSchema = z.object({
  runVersion: z.literal("kw-m2-html-assessment-run-v1"), setupReleasePath: DataPath,
  sourcePlanPath: DataPath, manifestPath: DataPath, operations: z.array(OperationSchema).min(1).max(10),
}).strict().superRefine((run, ctx) => {
  if (new Set(run.operations.map((op) => op.businessId)).size !== run.operations.length) {
    ctx.addIssue({ code: "custom", message: "One assessment operation per selected business is required." });
  }
  const paths = [run.setupReleasePath, run.sourcePlanPath, run.manifestPath,
    ...run.operations.flatMap((op) => [op.materializationPath, op.requestPath, op.candidatePath, op.approvalPath, op.progressPath, op.reportPath])];
  if (new Set(paths.map((item) => item.toLowerCase())).size !== paths.length) {
    ctx.addIssue({ code: "custom", message: "Assessment inputs and outputs must use distinct paths." });
  }
});
type Operation = z.infer<typeof OperationSchema>;
type Dependencies = Pick<PrivateKwM2WebsiteEvidenceReceiptReloadInput, "receiptStore" | "evidenceStore"> & { clock?: () => Date };

function absolute(relative: string) { return path.resolve(ROOT, DataPath.parse(relative)); }
function exists(file: string) {
  try { lstatSync(file); return true; } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

/** Shares Task8's lock; no setup/migration operation is invoked here. */
async function withAssessmentLock<T>(action: (check: () => void) => Promise<T>) {
  const directories = [ROOT, path.join(ROOT, "data"), DATA].map((directory) => ({ directory, stats: assertSetupDirectory(directory) }));
  const fd = openSync(PRIVATE_KW_M2_SETUP_LOCK_PATH, "wx", 0o600);
  const held = fstatSync(fd, { bigint: true });
  let lockIdentity: SetupFileIdentity | undefined;
  try {
    writeFileSync(fd, `${process.pid}:${randomBytes(32).toString("hex")}\n`);
    fsyncSync(fd);
    lockIdentity = readSetupFile(PRIVATE_KW_M2_SETUP_LOCK_PATH).identity;
    const check = () => {
      directories.forEach(({ directory, stats }) => assertSetupDirectory(directory, stats));
      const current = assertSetupFileUnchanged(PRIVATE_KW_M2_SETUP_LOCK_PATH, lockIdentity!);
      if (!sameSetupInode(held, current.stats) || !sameSetupInode(held, fstatSync(fd, { bigint: true }))) throw new Error("Assessment lock changed.");
    };
    check();
    return await action(check);
  } finally {
    try {
      const current = lstatSync(PRIVATE_KW_M2_SETUP_LOCK_PATH, { bigint: true });
      if (!current.isFile() || current.isSymbolicLink() || !sameSetupInode(held, current)) throw new Error("Assessment lock replaced; replacement retained.");
      unlinkSync(PRIVATE_KW_M2_SETUP_LOCK_PATH);
    } finally { closeSync(fd); }
  }
}

function inputs(checkLock: () => void) {
  const reads = new Map<string, SetupFileIdentity>();
  return {
    read(relative: string): unknown {
      checkLock();
      const file = absolute(relative);
      const read = readSetupFile(file, 25_000_000);
      const prior = reads.get(file);
      if (prior && privateKwM2SetupDigest(prior) !== privateKwM2SetupDigest(read.identity)) throw new Error("Recorded assessment input changed.");
      reads.set(file, read.identity);
      return JSON.parse(read.bytes.toString("utf8"));
    },
    check() { checkLock(); reads.forEach((identity, file) => assertSetupFileUnchanged(file, identity)); },
  };
}

/** Exclusive atomic publication. Existing exact bytes are read without any mutation. */
function publish(relative: string, value: unknown, check: () => void) {
  const target = absolute(relative);
  const bytes = Buffer.from(m2AssessmentJson(value) + "\n");
  check();
  if (exists(target)) {
    if (!readSetupFile(target, 25_000_000).bytes.equals(bytes)) throw new Error("Assessment output conflicts with durable evidence.");
    return;
  }
  const temp = createSetupTemp(DATA);
  let identity: SetupFileIdentity | undefined;
  try {
    const fd = openSync(temp.file, "wx", 0o600);
    try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
    identity = readSetupFile(temp.file).identity;
    check();
    assertSetupFileUnchanged(temp.file, identity);
    linkSync(temp.file, target);
    if (!readSetupFile(target).bytes.equals(bytes)) throw new Error("Assessment publication changed.");
  } finally {
    if (identity) removeSetupTemp(temp, { fileIdentity: identity });
    // Partial output is retained; no recursive cleanup or completion inference.
  }
}

function snapshot(database: Database.Database) {
  // inspectSetupSqlite performs PRAGMA integrity_check; use a fresh handle for each proof.
  const clone = new Database(database.serialize());
  try { return inspectSetupSqlite(clone, "POST_0069"); } finally { clone.close(); }
}
function matchSnapshot(actual: { contentDigest: string; schemaDigest: string }, expected: { contentDigest: string; schemaDigest: string }) {
  if (actual.contentDigest !== expected.contentDigest || actual.schemaDigest !== expected.schemaDigest) throw new Error("Assessment database has unauthorized or incomplete state.");
}
function insertPlan(database: Database.Database, plan: PrivateKwM2HtmlAssessmentPlan) {
  for (const { table, row, keys } of plan.rows) {
    // All identifiers and values originate in the fixed typed planner, never in caller SQL.
    const collision = database.prepare(`SELECT * FROM "${table}" WHERE ${keys.map((key) => `"${key}" = ?`).join(" OR ")}`)
      .all(...keys.map((key) => row[key]));
    if (collision.length) throw new Error(`Assessment row/key conflict in ${table}.`);
    const columns = Object.keys(row);
    const result = database.prepare(`INSERT INTO "${table}" (${columns.map((key) => `"${key}"`).join(",")}) VALUES (${columns.map(() => "?").join(",")})`)
      .run(...columns.map((key) => row[key]));
    if (result.changes !== 1) throw new Error("Assessment insert did not create one exact row.");
  }
}

function rowProof(database: Database.Database, plan: PrivateKwM2HtmlAssessmentPlan) {
  for (const { table, row, keys } of plan.rows) {
    const found = database.prepare(`SELECT * FROM "${table}" WHERE ${keys.map((key) => `"${key}" = ?`).join(" OR ")}`)
      .all(...keys.map((key) => row[key]));
    if (found.length !== 1 || m2AssessmentJson(found[0]) !== m2AssessmentJson(row)) throw new Error("Assessment durable row mismatch.");
  }
}

function progressOutput(plan: PrivateKwM2HtmlAssessmentPlan) {
  return { website: plan.websiteProgress, assessment: plan.assessmentProgress, lineageId: plan.lineageId, lineageDigest: plan.lineageDigest };
}

/** Exact reconstruction, including both phases, previous checkpoint and every assessment row digest.
 * A self-consistent progress document cannot supply its own expected plan. */
export function reloadPrivateKwM2HtmlAssessmentProgress(value: unknown, verifiedPlan: PrivateKwM2HtmlAssessmentPlan) {
  const expected = progressOutput(verifiedPlan);
  if (m2AssessmentJson(value) !== m2AssessmentJson(expected)) throw new Error("M2 HTML progress differs from its authenticated assessment and prior checkpoint.");
  return expected;
}

export async function executePrivateKwM2HtmlAssessment(runPath: string, businessId: string,
  mode: "PREPARE" | "EXECUTE" | "VERIFY" | "INSPECT" = "PREPARE", dependencies: Dependencies = {}) {
  return withAssessmentLock(async (checkLock) => {
    const clock = dependencies.clock ?? (() => new Date());
    const files = inputs(checkLock);
    const run = PrivateKwM2AssessmentRunSchema.parse(files.read(runPath));
    const requested = mode === "INSPECT" ? run.operations.at(-1) : run.operations.find((operation) => operation.businessId === businessId);
    if (!requested) throw new Error("Business is outside this bounded assessment run.");
    const source = PrivateKwImportPlanSchema.parse(files.read(run.sourcePlanPath));
    const manifest = PrivateKwShadowSliceManifestSchema.parse(files.read(run.manifestPath));
    if (run.operations.some((op) => !manifest.records.some((record) => record.businessId === op.businessId))) throw new Error("Run exceeds its approved exact-ten manifest.");
    const release = PrivateKwM2SetupReleaseEnvelopeSchema.parse(files.read(run.setupReleasePath));
    const setup = PrivateKwM2TimedDatabaseSetupReceiptSchema.parse(files.read(release.receiptPath));
    const setupTime = Date.parse(setup.completedAt);
    if (setupTime < Date.parse(release.reviewedAt) || setupTime >= Date.parse(release.expiresAt) || setupTime > clock().getTime()
      || setup.setupReleaseEnvelopeId !== release.envelopeId || setup.setupReleaseEnvelopeDigest !== release.envelopeDigest
      || setup.databasePath !== release.databasePath || setup.backupRestore.backupPath !== release.backupPath
      || setup.migrationsCommit !== release.repositoryCommit
      || privateKwM2SetupDigest(setup.migrationManifest) !== privateKwM2SetupDigest(release.migrationManifest)) {
      throw new Error("Timed setup receipt does not prove this recorded release.");
    }
    const allOutputPaths = run.operations.flatMap((op) => [op.candidatePath, op.approvalPath, op.progressPath, op.reportPath]);
    if (allOutputPaths.includes(runPath) || allOutputPaths.includes(release.receiptPath)) throw new Error("Assessment output overlaps its run/setup proof.");
    // Historical setup is tied to exact approved blobs; unrelated HEAD changes do not invalidate it.
    const dirty = execFileSync("git", ["status", "--porcelain", "--", "migrations"], { cwd: ROOT, encoding: "utf8" }).trim();
    if (dirty) throw new Error("Assessment requires unchanged approved migration files.");
    let migration = "";
    for (const filename of PRIVATE_KW_M2_MIGRATION_FILES) {
      const old = execFileSync("git", ["show", `${release.repositoryCommit}:migrations/${filename}`], { cwd: ROOT });
      const current = execFileSync("git", ["show", `HEAD:migrations/${filename}`], { cwd: ROOT });
      const sha = createHash("sha256").update(old).digest("hex");
      if (!old.equals(current) || sha !== release.migrationManifest.find((entry) => entry.filename === filename)?.sha256) throw new Error("Approved migration version changed.");
      if (filename.startsWith("0069_")) migration = old.toString("utf8");
    }
    if (!migration) throw new Error("Missing approved 0069 migration.");
    const databasePath = path.resolve(ROOT, setup.databasePath);
    const backupPath = path.resolve(ROOT, setup.backupRestore.backupPath);
    assertSetupSidecarsAbsent(databasePath); assertSetupSidecarsAbsent(backupPath);
    const original = readSetupFile(databasePath);
    if (original.identity.device !== setup.fileIdentity.device || original.identity.inode !== setup.fileIdentity.inode) throw new Error("Assessment database is a replaced or copied file.");
    const backup = assertSetupFileUnchanged(backupPath, setup.backupRestore.backupFileIdentity);
    const backupProof = inspectSetupSnapshot(backupPath);
    if (backupProof.contentDigest !== setup.backupRestore.logicalSnapshotDigest) throw new Error("Assessment backup proof changed.");
    const reference = new Database(backup.bytes);
    const actual = new Database(databasePath, { readonly: true, fileMustExist: true, timeout: 0 });
    const completed = new Map<string, PrivateKwM2HtmlAssessmentPlan>();
    type Terminal = { context: PrivateKwM2HtmlAssessmentContext; at: Date; report?: ReturnType<typeof buildPrivateKwM2ResearchReport> };
    const terminals = new Map<string, Terminal>();
    const unavailable = new Set<string>();
    let prior = { id: setup.receiptId, digest: setup.receiptDigest };
    const check = () => { files.check(); assertSetupFileUnchanged(backupPath, backup.identity); };
    const readContext = async (operation: Operation, at: Date, reader = actual, checkpoint = prior, identity = original.identity) => {
      const request = PrivateKwM2HtmlEvidenceRequestSchema.parse(files.read(operation.requestPath));
      if (request.businessId !== operation.businessId || privateKwM2Digest(request.sourcePlan) !== privateKwM2Digest(source)
        || privateKwM2Digest(request.manifest) !== privateKwM2Digest(manifest)) throw new Error("Task4 request does not match the canonical source and manifest.");
      const materialization = files.read(operation.materializationPath);
      const reloadInput = { sourceValue: source, manifestValue: manifest, materializationValue: materialization, businessId: operation.businessId };
      const before = reloadPrivateKwM2SourceMaterialization(reader, reloadInput);
      // Historical time proves existing evidence only. Every fresh assessment write separately
      // checks the current approval; research reports and blocked outcomes cannot authorize rows.
      const evidence = await reloadPrivateKwM2WebsiteEvidenceReceipt({ request, ...dependencies }, { clock: () => at });
      if (evidence.requestedAt !== request.requestedAt) throw new Error("Evidence request time mismatch.");
      const after = reloadPrivateKwM2SourceMaterialization(reader, reloadInput);
      if (privateKwM2Digest(before) !== privateKwM2Digest(after)) throw new Error("Source materialization changed during HTML reload.");
      const selected = source.records.find((record) => record.business.id === operation.businessId)!;
      const owner = request.ownerEnvelope as { expiresAt: string };
      const expiry = new Date(Math.min(Date.parse(owner.expiresAt), Date.parse(evidence.authorizationExpiresAt))).toISOString();
      check(); assertSetupFileUnchanged(databasePath, identity);
      return parseM2EvidenceContext({ businessId: operation.businessId, businessName: selected.business.canonicalName,
        evaluationCandidateId: selected.evaluationCandidateId, sourceRecordId: selected.sourceRecord.id,
        sourceEvidenceUrl: selected.sourceRecord.sourceEvidenceUrl, sourceCapturedAt: selected.sourceRecord.capturedAt,
        sourceMaterializationReceiptId: after.plan.materializationId, sourceMaterializationDigest: after.plan.materializationDigest,
        sourcePlanDigest: after.plan.sourcePlanDigest, workflowReceiptId: after.plan.workflowReceiptId,
        workflowReceiptDigest: after.plan.records.find((row) => row.entity === "WORKFLOW_RECEIPT")!.expected.receiptDigest,
        manifestId: manifest.manifestId, manifestDigest: manifest.manifestDigest,
        task1ChainDigest: privateKwM2Digest({ researchPacket: request.researchPacket, authorization: request.authorization,
          ownerEnvelope: request.ownerEnvelope, manifest, sourcePlan: source, researchPolicy: request.researchPolicy }),
        setupReceiptId: setup.receiptId, setupReceiptDigest: setup.receiptDigest,
        priorM2CheckpointId: checkpoint.id, priorM2CheckpointDigest: checkpoint.digest, approvalExpiresAt: expiry, evidence });
    };
    const assertTerminalOutputs = (operation: Operation, report?: ReturnType<typeof buildPrivateKwM2ResearchReport>) => {
      const forbidden = [operation.candidatePath, operation.approvalPath, operation.progressPath,
        ...(!report ? [operation.reportPath] : [])];
      if (forbidden.some((file) => exists(absolute(file)))) throw new Error("Non-assessment outcome has conflicting assessment output.");
      if (report && exists(absolute(operation.reportPath))) {
        files.read(operation.reportPath);
        if (!readSetupFile(absolute(operation.reportPath)).bytes.equals(Buffer.from(m2AssessmentJson(report) + "\n"))) {
          throw new Error("Research report conflicts with durable evidence.");
        }
      }
    };
    let freshPlan: PrivateKwM2HtmlAssessmentPlan | undefined;
    let prepared: unknown;
    let expectedBefore: ReturnType<typeof snapshot>;
    let expectedAfter: ReturnType<typeof snapshot>;
    try {
      actual.exec("BEGIN");
      reference.pragma("foreign_keys = ON");
      reference.exec(migration);
      if (snapshot(reference).schemaDigest !== setup.schemaDigest) throw new Error("Setup schema differs from approved reconstruction.");
      const rows = actual.prepare('SELECT "businessId", "recordedAt" FROM "RevenuePrivateKwM2HtmlAssessmentLineage" LIMIT 11').all() as { businessId: string; recordedAt: string }[];
      if (rows.length > 10 || new Set(rows.map((row) => row.businessId)).size !== rows.length
        || rows.some((row) => !run.operations.some((op) => op.businessId === row.businessId))) throw new Error("Unexpected completed assessment set.");
      let firstPending: Operation | undefined;
      let requestedContext: PrivateKwM2HtmlAssessmentContext | undefined;
      let requestedAt: Date | undefined;
      for (const operation of run.operations) {
        const stored = rows.find((row) => row.businessId === operation.businessId);
        if (!stored) {
          const isRequested = operation.businessId === requested.businessId;
          const hasReport = exists(absolute(operation.reportPath));
          const operationIndex = run.operations.indexOf(operation);
          const afterRequested = operationIndex > run.operations.indexOf(requested);
          const hasLaterAssessment = rows.some((row) => run.operations.findIndex((op) => op.businessId === row.businessId) > operationIndex);
          if (firstPending || (afterRequested && !hasReport && !hasLaterAssessment)) { firstPending ??= operation; continue; }
          const request = PrivateKwM2HtmlEvidenceRequestSchema.parse(files.read(operation.requestPath));
          const historical = mode === "INSPECT" || !isRequested || hasReport || mode === "VERIFY";
          const at = historical ? new Date(request.requestedAt) : clock();
          if (!Number.isFinite(at.getTime()) || at.getTime() > clock().getTime()) throw new Error("Invalid evidence verification time.");
          let context: PrivateKwM2HtmlAssessmentContext;
          try { context = await readContext(operation, at); }
          catch (error) {
            // A missing capture can be shown as unavailable, but schema, identity, artifact or
            // database contradictions fail the entire inspection. Never hide a corrupt receipt.
            if (mode !== "INSPECT" || !(error instanceof Error) || error.message !== "M2_WEBSITE_RECEIPT_REPLAY_MISSING") throw error;
            unavailable.add(operation.businessId); firstPending = operation; continue;
          }
          if (context.evidence.status === "COMPLETE") {
            firstPending = operation;
            // A stray report file never selects historical time for a fresh assessment approval.
            if (isRequested) { requestedContext = context; requestedAt = clock(); }
            continue;
          }
          const report = context.evidence.status === "PARTIAL" || context.evidence.status === "RESEARCH_REQUIRED"
            ? buildPrivateKwM2ResearchReport(context) : undefined;
          if (!report && (context.evidence.status !== "FAILED" || !context.evidence.blockedEvidence
            || !["ROBOTS_OR_TERMS_BLOCKED", "RETENTION_BLOCKED"].includes(context.evidence.stopReason ?? ""))) {
            throw new Error("Only durable research or blocked outcomes can leave assessment review.");
          }
          assertTerminalOutputs(operation, report);
          if (report && !hasReport && !isRequested && mode !== "INSPECT") { firstPending = operation; continue; }
          terminals.set(operation.businessId, { context, at, report });
          prior = report ? { id: report.reportId, digest: report.reportDigest }
            : { id: context.evidence.operationId, digest: context.evidence.operationDigest };
          continue;
        }
        if (firstPending) throw new Error("Assessment completion order does not match its prior checkpoint.");
        const at = new Date(stored.recordedAt);
        if (!Number.isFinite(at.getTime()) || at.getTime() < setupTime || at.getTime() > clock().getTime()) throw new Error("Invalid completed assessment time.");
        const context = await readContext(operation, at);
        const approval = PrivateKwM2HtmlAssessmentApprovalSchema.parse(files.read(operation.approvalPath));
        const plan = buildPrivateKwM2HtmlAssessmentPlan(context, approval, at);
        rowProof(actual, plan); insertPlan(reference, plan);
        completed.set(operation.businessId, plan);
        prior = { id: plan.assessmentProgress.id, digest: plan.assessmentProgress.digest };
        if (operation.businessId !== businessId) {
          const progress = files.read(operation.progressPath);
          reloadPrivateKwM2HtmlAssessmentProgress(progress, plan);
        }
      }
      expectedBefore = snapshot(reference);
      matchSnapshot(snapshot(actual), expectedBefore);
      if (!rows.length) assertSetupFileUnchanged(databasePath, setup.fileIdentity);
      if (mode !== "INSPECT" && !completed.has(businessId) && !terminals.has(businessId)) {
        if (firstPending?.businessId !== businessId) throw new Error("Complete the next selected business in order.");
        if (mode === "VERIFY") throw new Error("No completed assessment exists to verify.");
        const at = requestedAt ?? clock();
        const context = requestedContext ?? await readContext(requested, at);
        if (mode === "PREPARE") {
          const existing = exists(absolute(requested.candidatePath)) ? files.read(requested.candidatePath) as { candidate?: { assessedAt?: string } } : undefined;
          const assessedAt = existing?.candidate?.assessedAt ?? at.toISOString();
          prepared = { context, candidate: buildPrivateKwM2HtmlAssessmentCandidate(context, assessedAt) };
        } else {
          const approval = PrivateKwM2HtmlAssessmentApprovalSchema.parse(files.read(requested.approvalPath));
          freshPlan = buildPrivateKwM2HtmlAssessmentPlan(context, approval, at);
          insertPlan(reference, freshPlan);
        }
      }
      expectedAfter = snapshot(reference);
    } finally { actual.close(); reference.close(); }
    check(); assertSetupSidecarsAbsent(databasePath); assertSetupFileUnchanged(databasePath, original.identity);
    if (mode === "INSPECT") {
      // Inspection never prepares, approves, inserts or republishes missing output. Its only
      // transient file is the same owned operation lock used by setup and assessment writers.
      const result = LocalM2OwnerConsoleSchema.parse({
        status: "VERIFIED_LOCAL", verifiedAt: clock().toISOString(), manifestId: manifest.manifestId,
        manifestSize: 10, selectedCount: run.operations.length,
        entries: run.operations.map((operation) => {
          const record = source.records.find((entry) => entry.business.id === operation.businessId)!;
          const plan = completed.get(operation.businessId);
          const terminal = terminals.get(operation.businessId);
          return { businessId: operation.businessId, businessName: record.business.canonicalName,
            sourceUrl: record.sourceRecord.sourceEvidenceUrl,
            status: plan ? "COMPLETE" : terminal?.report ? "RESEARCH_REVIEW" : terminal ? "BLOCKED" : unavailable.has(operation.businessId) ? "UNAVAILABLE" : "PENDING",
            reason: plan ? null : terminal?.report ? "More website research is required. No assessment was approved."
              : terminal ? terminal.context.evidence.stopReason : unavailable.has(operation.businessId)
                ? "No verifiable saved capture is available. Capture or failure evidence needs review."
                : "This business has not completed the ordered local assessment workflow.",
            detail: plan ? projectPrivateKwM2OwnerLeadDetail(plan) : null, research: terminal?.report ?? null };
        }),
      });
      check(); assertSetupFileUnchanged(databasePath, original.identity);
      return result;
    }
    const terminal = terminals.get(businessId);
    if (terminal) {
      // Reopen and reload durable source/capture immediately before publishing even a research-only
      // report. Neither its existing bytes nor the first in-memory context are proof of completion.
      const reader = new Database(databasePath, { readonly: true, fileMustExist: true, timeout: 0 });
      try {
        reader.exec("BEGIN");
        const checkpoint = { id: terminal.context.priorM2CheckpointId, digest: terminal.context.priorM2CheckpointDigest };
        const context = await readContext(requested, terminal.at, reader, checkpoint);
        if (m2AssessmentJson(context) !== m2AssessmentJson(terminal.context)) throw new Error("Research evidence changed before publication.");
        matchSnapshot(snapshot(reader), expectedAfter);
      } finally { reader.close(); }
      const finalCheck = () => {
        check(); assertSetupSidecarsAbsent(databasePath); assertSetupFileUnchanged(databasePath, original.identity);
        assertTerminalOutputs(requested, terminal.report);
      };
      finalCheck();
      if (!terminal.report) return { status: "BLOCKED" as const, businessId, insertedRows: 0,
        operationId: terminal.context.evidence.operationId, operationDigest: terminal.context.evidence.operationDigest,
        stopReason: terminal.context.evidence.stopReason, blockedEvidence: terminal.context.evidence.blockedEvidence,
        networkRequestCount: 0, providerOperations: 0, costAuthorizedUsd: 0 };
      const existed = exists(absolute(requested.reportPath));
      publish(requested.reportPath, terminal.report, finalCheck);
      if (m2AssessmentJson(files.read(requested.reportPath)) !== m2AssessmentJson(terminal.report)) throw new Error("Research report did not reload exactly.");
      finalCheck();
      return { status: "RESEARCH_REVIEW" as const, executionPath: existed ? "EXACT_REPLAY" as const : "CREATED" as const,
        insertedRows: 0, reportPath: requested.reportPath, report: terminal.report };
    }
    const reloadAssessment = async (plan: PrivateKwM2HtmlAssessmentPlan, identity: SetupFileIdentity, durable: boolean) => {
      assertSetupSidecarsAbsent(databasePath); assertSetupFileUnchanged(databasePath, identity);
      const reader = new Database(databasePath, { readonly: true, fileMustExist: true, timeout: 0 });
      try {
        reader.exec("BEGIN");
        const stored = durable ? reader.prepare('SELECT "recordedAt" FROM "RevenuePrivateKwM2HtmlAssessmentLineage" WHERE "id" = ?').get(plan.lineageId) as { recordedAt: string } | undefined : undefined;
        if (durable && !stored) throw new Error("Missing committed assessment lineage.");
        const recordedAt = new Date(stored?.recordedAt ?? String(plan.rows.at(-1)!.row.recordedAt));
        const checkpoint = { id: plan.context.priorM2CheckpointId, digest: plan.context.priorM2CheckpointDigest };
        const context = await readContext(requested, durable ? recordedAt : clock(), reader, checkpoint, identity);
        const approval = PrivateKwM2HtmlAssessmentApprovalSchema.parse(files.read(requested.approvalPath));
        const reconstructed = buildPrivateKwM2HtmlAssessmentPlan(context, approval, recordedAt);
        if (m2AssessmentJson(reconstructed) !== m2AssessmentJson(plan)) throw new Error("Assessment changed during final durable reload.");
        if (durable) { rowProof(reader, reconstructed); matchSnapshot(snapshot(reader), expectedAfter); }
        return reconstructed;
      } finally { reader.close(); assertSetupSidecarsAbsent(databasePath); assertSetupFileUnchanged(databasePath, identity); }
    };
    if (prepared) {
      publish(requested.candidatePath, prepared, check);
      return { status: "PENDING_OWNER_ASSESSMENT_APPROVAL" as const, candidatePath: requested.candidatePath, preparation: prepared };
    }
    if (freshPlan) {
      const plan = await reloadAssessment(freshPlan, original.identity, false);
      for (const [output, value] of [[requested.progressPath, progressOutput(plan)],
        [requested.reportPath, projectPrivateKwM2OwnerLeadDetail(plan)]] as const) {
        if (exists(absolute(output))) {
          files.read(output);
          if (!readSetupFile(absolute(output)).bytes.equals(Buffer.from(m2AssessmentJson(value) + "\n"))) {
            throw new Error("Assessment output conflicts with durable evidence.");
          }
        }
      }
      assertPrivateKwM2HtmlAssessmentApproval(plan.approval, plan.context, clock());
      const writer = new Database(databasePath, { fileMustExist: true, timeout: 0 });
      try {
        writer.pragma("foreign_keys = ON"); writer.pragma("synchronous = FULL");
        if (writer.pragma("journal_mode", { simple: true }) !== "delete") throw new Error("Assessment requires DELETE journal mode.");
        assertSetupFileUnchanged(databasePath, original.identity);
        writer.transaction(() => {
          check(); assertPrivateKwM2HtmlAssessmentApproval(plan.approval, plan.context, clock());
          matchSnapshot(snapshot(writer), expectedBefore);
          insertPlan(writer, plan); rowProof(writer, plan);
          matchSnapshot(snapshot(writer), expectedAfter);
          check();
        }).immediate();
      } finally { writer.close(); }
    }
    check();
    const after = inspectSetupSnapshot(databasePath, "POST_0069");
    matchSnapshot(after, expectedAfter);
    if (after.fileIdentity.device !== original.identity.device || after.fileIdentity.inode !== original.identity.inode) throw new Error("Assessment file replaced during execution.");
    if (!freshPlan) assertSetupFileUnchanged(databasePath, original.identity);
    const plan = await reloadAssessment(freshPlan ?? completed.get(businessId)!, after.fileIdentity, true);
    // Publication is derived only after durable verification. Missing progress/report can be
    // regenerated after interruption; conflicting existing bytes cannot be repaired here.
    const finalCheck = () => { check(); assertSetupSidecarsAbsent(databasePath); assertSetupFileUnchanged(databasePath, after.fileIdentity); };
    const ownerDetail = projectPrivateKwM2OwnerLeadDetail(plan);
    publish(requested.progressPath, progressOutput(plan), finalCheck);
    reloadPrivateKwM2HtmlAssessmentProgress(files.read(requested.progressPath), plan);
    publish(requested.reportPath, ownerDetail, finalCheck);
    if (m2AssessmentJson(files.read(requested.reportPath)) !== m2AssessmentJson(ownerDetail)) throw new Error("Owner report did not reload exactly.");
    finalCheck();
    return { status: freshPlan ? "FRESH_COMMIT" as const : "EXACT_REPLAY" as const,
      insertedRows: freshPlan ? plan.rows.length : 0, lineageId: plan.lineageId,
      reportPath: requested.reportPath, ownerDetail };
  });
}

/** Explicit operator decision recording; preparation and execution never approve themselves. */
export async function recordPrivateKwM2HtmlAssessmentDecision(runPath: string, businessId: string,
  decision: Parameters<typeof recordPrivateKwM2HtmlAssessmentApproval>[2]) {
  return withAssessmentLock(async (checkLock) => {
    const files = inputs(checkLock);
    const run = PrivateKwM2AssessmentRunSchema.parse(files.read(runPath));
    const operation = run.operations.find((op) => op.businessId === businessId);
    if (!operation) throw new Error("Business is outside this bounded assessment run.");
    const prepared = z.object({ context: z.unknown(), candidate: z.unknown() }).strict().parse(files.read(operation.candidatePath));
    const approval = recordPrivateKwM2HtmlAssessmentApproval(prepared.candidate, prepared.context, decision);
    publish(operation.approvalPath, approval, () => files.check());
    return { status: "OWNER_DECISION_RECORDED", approvalId: approval.approvalId, approvalPath: operation.approvalPath };
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [runPath, businessId, option, decisionPath, ...extra] = process.argv.slice(2);
  const main = async () => {
    if (!runPath || !businessId || extra.length || (decisionPath && option !== "--record-decision")) throw new Error("Usage: <run.json> <business-id> [--execute | --verify | --record-decision <decision.json>] or <run.json> --inspect");
    if (businessId === "--inspect") {
      if (option || decisionPath) throw new Error("Inspection does not accept mutation options.");
      return executePrivateKwM2HtmlAssessment(runPath, "", "INSPECT");
    }
    if (option === "--record-decision") {
      if (!decisionPath) throw new Error("A recorded explicit operator decision is required.");
      const decision = JSON.parse(readSetupFile(absolute(decisionPath), 25_000).bytes.toString("utf8"));
      return recordPrivateKwM2HtmlAssessmentDecision(runPath, businessId, decision);
    }
    if (option && !["--execute", "--verify"].includes(option)) throw new Error("Unknown assessment mode.");
    return executePrivateKwM2HtmlAssessment(runPath, businessId, option === "--execute" ? "EXECUTE" : option === "--verify" ? "VERIFY" : "PREPARE");
  };
  main().then((result) => process.stdout.write(JSON.stringify(result) + "\n")).catch((error: unknown) => {
    process.stderr.write(JSON.stringify({ status: "EXTERNAL_BLOCKER", error: error instanceof Error ? error.message : String(error) }) + "\n");
    process.exitCode = 1;
  });
}
