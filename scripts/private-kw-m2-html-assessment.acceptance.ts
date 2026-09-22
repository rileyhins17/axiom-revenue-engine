import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, lstatSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import fs from "node:fs";
import path from "node:path";
import { test, mock } from "node:test";
import Database from "better-sqlite3";

import { applyCanonicalPrivateKwMigrations } from "./private-kw-database";
import { PRIVATE_KW_M2_MIGRATION_FILES } from "./private-kw-m2-database";
import { applyPrivateKwM2Setup, preflightPrivateKwM2Setup } from "./private-kw-m2-setup";
import { executePrivateKwSourceWorkflowPlanForLocalDatabase } from "./materialize-private-kw-source-workflow";
import { executePrivateKwM2HtmlAssessment, recordPrivateKwM2HtmlAssessmentDecision } from "./execute-private-kw-m2-html-assessment";
import { readSetupFile } from "./private-kw-m2-snapshot";
import { privateKwM2SetupDigest } from "../src/lib/revenue-engine/private-kw-m2-setup-release";
import { buildPrivateKwSourceWorkflowMaterializationPlan, privateKwSourceWorkflowDigest } from "../src/lib/revenue-engine/private-kw-source-workflow-materialization";
import { createPrivateKwM2AssessmentFixture } from "../src/lib/revenue-engine/test-support/private-kw-m2-assessment-fixture";
import { createPrivateKwShadowSourceWorkflowFixture } from "../src/lib/revenue-engine/test-support/private-kw-shadow-source-workflow-fixture";

// Registered in setup.test.ts, so the shared real operation lock has one test process owner.
// No independent *.test.ts file is used: parallel setup/assessment suites would contend by design.
async function createRun() {
  const token = `m2-assessment-test-${randomUUID()}`;
  const relative = (label: string, extension = "json") => `data/kw-evaluation/${token}-${label}.${extension}`;
  const owned = new Map<string, { dev: bigint; ino: bigint }>();
  const generated = new Set<string>();
  const remember = (file: string) => {
    const stats = lstatSync(file, { bigint: true });
    assert(stats.isFile() && !stats.isSymbolicLink());
    owned.set(path.resolve(file), { dev: stats.dev, ino: stats.ino });
  };
  const write = (file: string, value: unknown) => {
    writeFileSync(file, JSON.stringify(value), { flag: "wx" }); remember(file);
  };
  const cleanup = () => {
    for (const file of generated) if (existsSync(file) && !owned.has(path.resolve(file))) remember(file);
    for (const [file, identity] of owned) {
      if (!existsSync(file)) continue;
      assert.equal(path.dirname(file), path.resolve("data/kw-evaluation"));
      const current = lstatSync(file, { bigint: true });
      assert(current.isFile() && !current.isSymbolicLink() && current.dev === identity.dev && current.ino === identity.ino);
      unlinkSync(file);
    }
  };
  const captureTime = new Date(Date.now() - 60_000);
  const captures = await Promise.all([0, 1, 2].map((businessIndex) => createPrivateKwM2AssessmentFixture({ now: captureTime, businessIndex })));
  const chain = captures[0].chain;
  const databasePath = relative("database", "sqlite");
  writeFileSync(databasePath, Buffer.alloc(0), { flag: "wx" }); remember(databasePath);
  const database = new Database(databasePath, { fileMustExist: true });
  const operations = captures.map((capture, index) => ({ businessId: capture.request.businessId,
    materializationPath: relative(`materialization-${index}`), requestPath: relative(`request-${index}`),
    candidatePath: relative(`candidate-${index}`), approvalPath: relative(`approval-${index}`),
    progressPath: relative(`progress-${index}`), reportPath: relative(`report-${index}`) }));
  try {
    applyCanonicalPrivateKwMigrations(database);
    database.exec('CREATE TABLE "AssessmentProbe" (id INTEGER PRIMARY KEY, note TEXT NOT NULL); INSERT INTO "AssessmentProbe" VALUES (1, \'unchanged\')');
    for (let index = 0; index < operations.length; index++) {
      const selected = chain.sourcePlan.records[index]!;
      const template = createPrivateKwShadowSourceWorkflowFixture({ now: new Date(), selectedWebsiteUrl: selected.sourceRecord.websiteUrl }).materialization;
      const auditInput = { ...template.auditInput, businessId: selected.business.id, businessName: selected.business.canonicalName,
        niche: selected.niche.toLowerCase(), expectedServices: [selected.niche], expectedLocations: [selected.location.city],
        sourceEvidenceUrl: selected.sourceRecord.sourceEvidenceUrl, requestedUrl: selected.sourceRecord.websiteUrl };
      const materialization = { ...template, sourceImportId: chain.sourcePlan.importId, sourcePlanDigest: chain.manifest.sourcePlanDigest,
        businessId: selected.business.id, evaluationCandidateId: selected.evaluationCandidateId, auditInput,
        auditInputDigest: privateKwSourceWorkflowDigest(auditInput) };
      executePrivateKwSourceWorkflowPlanForLocalDatabase(database, buildPrivateKwSourceWorkflowMaterializationPlan(chain.sourcePlan, materialization));
      write(operations[index].materializationPath, materialization);
      write(operations[index].requestPath, captures[index].request);
      for (const file of [operations[index].candidatePath, operations[index].approvalPath, operations[index].progressPath, operations[index].reportPath]) generated.add(file);
    }
  } finally { database.close(); }
  const releasePath = relative("release");
  const receiptPath = relative("setup-receipt");
  const backupPath = relative("backup", "sqlite");
  generated.add(receiptPath); generated.add(backupPath);
  const core = { envelopeVersion: "kw-m2-local-0069-release-v1", status: "APPROVED",
    repositoryCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), migrationRange: "0054-0069",
    migrationManifest: PRIVATE_KW_M2_MIGRATION_FILES.map((filename) => ({ filename,
      sha256: createHash("sha256").update(execFileSync("git", ["show", `HEAD:migrations/${filename}`])).digest("hex") })),
    databasePath, backupPath, receiptPath, quarantinePath: relative("quarantine", "sqlite"),
    localSchemaMutationAuthorized: true, remoteMigrationAuthorized: false, providerOperationsAuthorized: 0,
    runtimeQualificationAuthorized: false, runtimeContactAuthorized: false, runtimeOutreachAuthorized: false,
    runtimeSendAuthorized: false, deploymentAuthorized: false, costAuthorizedUsd: 0,
    rollbackPolicy: "QUARANTINE_AND_OWNER_APPROVED_RESTORE", approvedBy: "RILEY",
    reviewedAt: new Date(Date.now() - 60_000).toISOString(), expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    rationale: "Synthetic local assessment acceptance setup only.", confirmation: "APPROVE_M2_LOCAL_0069_SETUP" };
  const digest = privateKwM2SetupDigest(core);
  write(releasePath, { ...core, envelopeId: `kw-m2-local-0069-release:${digest}`, envelopeDigest: digest });
  const setup = await preflightPrivateKwM2Setup(releasePath);
  try { await applyPrivateKwM2Setup(setup); } finally { await setup.releaseLock(); }
  remember(receiptPath); remember(backupPath);
  const runPath = relative("run");
  const sourcePlanPath = relative("source"); const manifestPath = relative("manifest");
  write(sourcePlanPath, chain.sourcePlan); write(manifestPath, chain.manifest);
  write(runPath, { runVersion: "kw-m2-html-assessment-run-v1", setupReleasePath: releasePath, sourcePlanPath, manifestPath, operations });
  const dependencies = {
    receiptStore: { async loadSealed(operationId: string) {
      for (const capture of captures) { const receipt = await capture.receiptStore.loadSealed(operationId); if (receipt) return receipt; }
      return null;
    } },
    evidenceStore: { async reloadPrivateKwHtmlEvidenceReadOnly(identity: unknown) {
      for (const capture of captures) {
        try { return await capture.evidenceStore.reloadPrivateKwHtmlEvidenceReadOnly(identity); } catch { /* next distinct business store */ }
      }
      throw new Error("MISSING_SYNTHETIC_EVIDENCE");
    } },
  };
  const approve = async (index: number) => {
    const operation = operations[index];
    await executePrivateKwM2HtmlAssessment(runPath, operation.businessId, "PREPARE", dependencies);
    const result = await recordPrivateKwM2HtmlAssessmentDecision(runPath, operation.businessId, {
      approvedBy: "RILEY", reviewedAt: new Date().toISOString(), rationale: "Synthetic separate owner assessment approval.",
      confirmation: "RECORD_LOCAL_HTML_WEBSITE_FIT_ASSESSMENT" });
    assert.equal(result.status, "OWNER_DECISION_RECORDED");
  };
  return { runPath, databasePath, receiptPath, backupPath, operations, dependencies, approve, cleanup, captureTime, remember, generated };
}

export function registerM2AssessmentAcceptanceTests() {
  test("M2 assessment real files: first write, exact replay, second business, restart and expired historical proof", async () => {
    const run = await createRun();
    try {
      const baseline = readSetupFile(path.resolve(run.databasePath)).identity;
      const setupBytes = readFileSync(run.receiptPath); const backupBytes = readFileSync(run.backupPath);
      await assert.rejects(executePrivateKwM2HtmlAssessment(run.runPath, run.operations[0].businessId, "EXECUTE", run.dependencies), /ENOENT/);
      assert.deepEqual(readSetupFile(path.resolve(run.databasePath)).identity, baseline);
      await run.approve(0);
      const first = await executePrivateKwM2HtmlAssessment(run.runPath, run.operations[0].businessId, "EXECUTE", run.dependencies);
      assert.equal(first.status, "FRESH_COMMIT"); assert.equal("insertedRows" in first && first.insertedRows, 8);
      const afterFirst = readSetupFile(path.resolve(run.databasePath)).identity;
      const replay = await executePrivateKwM2HtmlAssessment(run.runPath, run.operations[0].businessId, "VERIFY", run.dependencies);
      assert.equal(replay.status, "EXACT_REPLAY"); assert.equal("insertedRows" in replay && replay.insertedRows, 0);
      assert.deepEqual(readSetupFile(path.resolve(run.databasePath)).identity, afterFirst);
      await run.approve(1);
      const second = await executePrivateKwM2HtmlAssessment(run.runPath, run.operations[1].businessId, "EXECUTE", run.dependencies);
      assert.equal(second.status, "FRESH_COMMIT");
      assert("ownerDetail" in second);
      assert.equal(second.ownerDetail.classification.value, "UNKNOWN");
      assert.deepEqual(second.ownerDetail.routes, []);
      const afterSecond = readSetupFile(path.resolve(run.databasePath)).identity;
      const later = new Date(run.captureTime.getTime() + 10 * 86_400_000);
      const old = await executePrivateKwM2HtmlAssessment(run.runPath, run.operations[1].businessId, "VERIFY", { ...run.dependencies, clock: () => later });
      assert.equal(old.status, "EXACT_REPLAY");
      await assert.rejects(executePrivateKwM2HtmlAssessment(run.runPath, run.operations[2].businessId, "PREPARE", { ...run.dependencies, clock: () => later }), /expired|AUTHORIZATION/);
      assert.deepEqual(readSetupFile(path.resolve(run.databasePath)).identity, afterSecond);
      const child = `import {createPrivateKwM2AssessmentFixture as fixture} from './src/lib/revenue-engine/test-support/private-kw-m2-assessment-fixture.ts';
import {executePrivateKwM2HtmlAssessment as run} from './scripts/execute-private-kw-m2-html-assessment.ts';
const [file,business,time]=process.argv.slice(1); const captures=await Promise.all([0,1,2].map(businessIndex=>fixture({now:new Date(time),businessIndex})));
const receiptStore={async loadSealed(id){for(const c of captures){const r=await c.receiptStore.loadSealed(id);if(r)return r;}return null;}};
const evidenceStore={async reloadPrivateKwHtmlEvidenceReadOnly(id){for(const c of captures){try{return await c.evidenceStore.reloadPrivateKwHtmlEvidenceReadOnly(id);}catch{}}throw new Error('missing');}};
console.log(JSON.stringify(await run(file,business,'VERIFY',{receiptStore,evidenceStore})));`;
      const restarted = JSON.parse(execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", child,
        run.runPath, run.operations[1].businessId, run.captureTime.toISOString()], { encoding: "utf8" }));
      assert.equal(restarted.status, "EXACT_REPLAY");
      assert.deepEqual(readSetupFile(path.resolve(run.databasePath)).identity, afterSecond);
      assert.deepEqual(readFileSync(run.receiptPath), setupBytes); assert.deepEqual(readFileSync(run.backupPath), backupBytes);
    } finally { run.cleanup(); }
  });

  test("M2 assessment rejects unrelated drift, missing evidence, partial rows, sidecars and copied databases", async () => {
    const run = await createRun();
    try {
      await run.approve(0);
      await executePrivateKwM2HtmlAssessment(run.runPath, run.operations[0].businessId, "EXECUTE", run.dependencies);
      const clean = readFileSync(run.databasePath);
      const verify = () => executePrivateKwM2HtmlAssessment(run.runPath, run.operations[0].businessId, "VERIFY", run.dependencies);
      const corrupt = async (sql: string, pattern: RegExp) => {
        const db = new Database(run.databasePath); try { db.exec(sql); } finally { db.close(); }
        const suspect = readFileSync(run.databasePath);
        await assert.rejects(verify(), pattern); assert.deepEqual(readFileSync(run.databasePath), suspect);
        writeFileSync(run.databasePath, clean); // reset only this synthetic fixture, never a runner recovery path
      };
      await corrupt('UPDATE "AssessmentProbe" SET note = \'unauthorized\'', /unauthorized|incomplete/);
      await corrupt('UPDATE "RevenueBusiness" SET canonicalName = \'changed\'', /BUSINESS|exact/);
      const db = new Database(run.databasePath);
      const trigger = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'RevenueEvidenceClaim_assessment_immutable_delete'").get() as { sql: string };
      db.close();
      await corrupt(`DROP TRIGGER "RevenueEvidenceClaim_assessment_immutable_delete"; DELETE FROM "RevenueEvidenceClaim" WHERE id = (SELECT id FROM "RevenueEvidenceClaim" LIMIT 1); ${trigger.sql}`, /durable row mismatch/);
      await assert.rejects(executePrivateKwM2HtmlAssessment(run.runPath, run.operations[0].businessId, "VERIFY", {
        ...run.dependencies, receiptStore: { async loadSealed() { return null; } },
      }), /receipt|RECEIPT/);
      assert.deepEqual(readFileSync(run.databasePath), clean);
      const sidecar = run.databasePath + "-wal";
      writeFileSync(sidecar, "synthetic", { flag: "wx" }); run.remember(sidecar);
      await assert.rejects(verify(), /sidecars/); unlinkSync(sidecar);
      const held = run.databasePath + ".held";
      renameSync(run.databasePath, held); run.remember(held);
      writeFileSync(run.databasePath, clean, { flag: "wx" }); run.remember(run.databasePath);
      await assert.rejects(verify(), /replaced or copied/);
    } finally { run.cleanup(); }
  });

  test("M2 assessment rolls back before final lineage and regenerates missing post-commit output", async () => {
    const run = await createRun();
    try {
      await run.approve(0);
      const before = readFileSync(run.databasePath);
      let reloads = 0;
      await assert.rejects(executePrivateKwM2HtmlAssessment(run.runPath, run.operations[0].businessId, "EXECUTE", {
        ...run.dependencies, receiptStore: { async loadSealed(id: string) {
          if (++reloads === 2) return null;
          return run.dependencies.receiptStore.loadSealed(id);
        } },
      }), /receipt|RECEIPT/);
      assert.equal(reloads, 2, "the pre-write evidence reload must be independent");
      assert.deepEqual(readFileSync(run.databasePath), before);
      const original = Database.prototype.prepare;
      let inserts = 0;
      const stub = mock.method(Database.prototype, "prepare", function (this: Database.Database, sql: string) {
        if (sql.startsWith('INSERT INTO "RevenuePrivateKwM2HtmlAssessmentLineage"')) {
          inserts++;
          if (inserts === 2) throw new Error("SYNTHETIC_LINEAGE_FAILURE"); // first is independent reference
        }
        return original.call(this, sql);
      });
      try {
        await assert.rejects(executePrivateKwM2HtmlAssessment(run.runPath, run.operations[0].businessId, "EXECUTE", run.dependencies), /SYNTHETIC_LINEAGE_FAILURE/);
      } finally { stub.mock.restore(); }
      assert.deepEqual(readFileSync(run.databasePath), before);
      const operation = run.operations[0];
      writeFileSync(operation.reportPath, JSON.stringify({ syntheticConflict: true }), { flag: "wx" }); run.remember(operation.reportPath);
      await assert.rejects(executePrivateKwM2HtmlAssessment(run.runPath, operation.businessId, "EXECUTE", run.dependencies), /output conflicts/);
      assert.deepEqual(readFileSync(run.databasePath), before);
      unlinkSync(operation.reportPath); // remove ONLY the deliberately conflicting synthetic test file
      const originalLink = fs.linkSync;
      const publication = mock.method(fs, "linkSync", (source: Parameters<typeof fs.linkSync>[0], target: Parameters<typeof fs.linkSync>[1]) => {
        if (path.resolve(target.toString()) === path.resolve(operation.progressPath)) throw new Error("SYNTHETIC_PROGRESS_INTERRUPTION");
        return originalLink(source, target);
      });
      try {
        await assert.rejects(executePrivateKwM2HtmlAssessment(run.runPath, operation.businessId, "EXECUTE", run.dependencies), /SYNTHETIC_PROGRESS_INTERRUPTION/);
      } finally { publication.mock.restore(); }
      assert.equal(existsSync(operation.progressPath), false);
      const committed = readSetupFile(path.resolve(run.databasePath)).identity;
      const regenerated = await executePrivateKwM2HtmlAssessment(run.runPath, operation.businessId, "VERIFY", run.dependencies);
      run.remember(operation.reportPath);
      assert.equal(regenerated.status, "EXACT_REPLAY");
      assert.deepEqual(readSetupFile(path.resolve(run.databasePath)).identity, committed);
      await run.approve(1);
      const second = run.operations[1];
      let selectedReloads = 0;
      await assert.rejects(executePrivateKwM2HtmlAssessment(run.runPath, second.businessId, "EXECUTE", {
        ...run.dependencies, receiptStore: { async loadSealed(id: string) {
          const receipt = await run.dependencies.receiptStore.loadSealed(id);
          if (receipt?.businessId === second.businessId && ++selectedReloads === 3) return null;
          return receipt;
        } },
      }), /receipt|RECEIPT/);
      assert.equal(selectedReloads, 3, "the reopened durable assessment must reload evidence before reporting");
      assert.equal(existsSync(second.reportPath), false);
      const secondCommitted = readSetupFile(path.resolve(run.databasePath)).identity;
      const recovered = await executePrivateKwM2HtmlAssessment(run.runPath, second.businessId, "VERIFY", run.dependencies);
      assert.equal(recovered.status, "EXACT_REPLAY");
      assert.deepEqual(readSetupFile(path.resolve(run.databasePath)).identity, secondCommitted);
    } finally { run.cleanup(); }
  });
}
