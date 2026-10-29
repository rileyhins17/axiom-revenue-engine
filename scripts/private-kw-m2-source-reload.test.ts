import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import Database from "better-sqlite3";

import { applyCanonicalPrivateKwMigrations } from "./private-kw-database";
import { executePrivateKwSourceWorkflowPlanForLocalDatabase } from "./materialize-private-kw-source-workflow";
import { reloadPrivateKwM2SourceMaterialization, requirePrivateKwM2SourceMaterializationReload } from "./private-kw-m2-source-reload";
import { buildPrivateKwSourceWorkflowMaterializationPlan } from "../src/lib/revenue-engine/private-kw-source-workflow-materialization";
import { createPrivateKwShadowSourceWorkflowFixture } from "../src/lib/revenue-engine/test-support/private-kw-shadow-source-workflow-fixture";

test("reloads exact source/workflow rows without mutation and rejects drift or copied capabilities", () => {
  const fixture = createPrivateKwShadowSourceWorkflowFixture({ suffix: `m2-reload-${Date.now().toString(36)}`, now: new Date() });
  const database = new Database(":memory:");
  try {
    database.pragma("foreign_keys = ON");
    applyCanonicalPrivateKwMigrations(database);
    database.exec(readFileSync("migrations/0069_private_kw_m2_html_assessment_lineage.sql", "utf8"));
    const plan = buildPrivateKwSourceWorkflowMaterializationPlan(fixture.source, fixture.materialization);
    executePrivateKwSourceWorkflowPlanForLocalDatabase(database, plan);
    const before = database.serialize();
    const first = reloadPrivateKwM2SourceMaterialization(database, {
      sourceValue: fixture.source,
      materializationValue: fixture.materialization,
      manifestValue: fixture.manifest,
      businessId: fixture.source.records[0]!.business.id,
    });
    assert.equal(first.record.evaluationCandidateId, plan.evaluationCandidateId);
    assert.deepEqual(database.serialize(), before);
    assert.strictEqual(requirePrivateKwM2SourceMaterializationReload(first), first);
    assert.throws(() => requirePrivateKwM2SourceMaterializationReload({ ...first }), /invalid or copied/);
    assert.throws(() => reloadPrivateKwM2SourceMaterialization(database, {
      sourceValue: fixture.source,
      materializationValue: fixture.materialization,
      manifestValue: { ...fixture.manifest, sourcePlanDigest: "f".repeat(64) },
      businessId: fixture.source.records[0]!.business.id,
    }), /manifest/);
    const missingReceipt = new Database(":memory:");
    applyCanonicalPrivateKwMigrations(missingReceipt);
    missingReceipt.exec(readFileSync("migrations/0069_private_kw_m2_html_assessment_lineage.sql", "utf8"));
    for (const record of plan.records.slice(0, -1)) missingReceipt.prepare(record.insertSql).run(...record.insertBindings);
    assert.throws(() => reloadPrivateKwM2SourceMaterialization(missingReceipt, {
      sourceValue: fixture.source,
      materializationValue: fixture.materialization,
      manifestValue: fixture.manifest,
      businessId: fixture.source.records[0]!.business.id,
    }), /MATERIALIZATION_RECEIPT|exact/);
    missingReceipt.close();
  } finally { database.close(); }
});

test("rejects an altered persisted source row", () => {
  const fixture = createPrivateKwShadowSourceWorkflowFixture({ suffix: `m2-reload-drift-${Date.now().toString(36)}`, now: new Date() });
  const database = new Database(":memory:");
  try {
    applyCanonicalPrivateKwMigrations(database);
    database.exec(readFileSync("migrations/0069_private_kw_m2_html_assessment_lineage.sql", "utf8"));
    const plan = buildPrivateKwSourceWorkflowMaterializationPlan(fixture.source, fixture.materialization);
    executePrivateKwSourceWorkflowPlanForLocalDatabase(database, plan);
    database.prepare('UPDATE "RevenueBusiness" SET "canonicalName" = ? WHERE "id" = ?').run("altered", fixture.source.records[0]!.business.id);
    assert.throws(() => reloadPrivateKwM2SourceMaterialization(database, {
      sourceValue: fixture.source,
      materializationValue: fixture.materialization,
      manifestValue: fixture.manifest,
      businessId: fixture.source.records[0]!.business.id,
    }), /BUSINESS|exact/);
  } finally { database.close(); }
});

test("binds the manifest record to the selected second business", () => {
  const fixture = createPrivateKwShadowSourceWorkflowFixture({ suffix: `m2-reload-second-${Date.now().toString(36)}`, materializationRecordIndex: 1, now: new Date() });
  const database = new Database(":memory:");
  try {
    applyCanonicalPrivateKwMigrations(database);
    database.exec(readFileSync("migrations/0069_private_kw_m2_html_assessment_lineage.sql", "utf8"));
    const plan = buildPrivateKwSourceWorkflowMaterializationPlan(fixture.source, fixture.materialization);
    executePrivateKwSourceWorkflowPlanForLocalDatabase(database, plan);
    const selectedBusinessId = fixture.source.records[1]!.business.id;
    const before = database.serialize();
    const result = reloadPrivateKwM2SourceMaterialization(database, {
      sourceValue: fixture.source,
      materializationValue: fixture.materialization,
      manifestValue: fixture.manifest,
      businessId: selectedBusinessId,
    });
    assert.equal(result.record.businessId, selectedBusinessId);
    assert.equal(result.record.sourceRecordId, fixture.source.records[1]!.sourceRecord.id);
    assert.deepEqual(database.serialize(), before);
  } finally { database.close(); }
});
