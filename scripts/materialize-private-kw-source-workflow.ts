import { pathToFileURL } from "node:url";

import Database from "better-sqlite3";

import {
  buildPrivateKwSourceWorkflowMaterializationPlan,
  verifyPrivateKwSourceWorkflowPreflight,
  type PrivateKwSourceWorkflowMaterializationPlan,
} from "../src/lib/revenue-engine/private-kw-source-workflow-materialization";
import {
  inspectPrivateKwDatabase,
  readPrivateKwJson,
  resolvePrivateKwDataPath,
  resolvePrivateKwDatabasePath,
} from "./private-kw-files";
import {
  assertCanonicalPrivateKwRevenueSchema,
  assertPrivateKwRequiredTables,
  assertPrivateKwSingleDatabase,
} from "./private-kw-database";

const MAX_PRIVATE_SOURCE_BYTES = 5_000_000;
const MAX_PRIVATE_MATERIALIZATION_BYTES = 10_000_000;
const MAX_PRIVATE_DATABASE_BYTES = 512_000_000;
const LOCAL_MATERIALIZATION_CLOCK_SKEW_MS = 5 * 60 * 1_000;

const REQUIRED_TABLES = [
  "RevenueSourceRun",
  "RevenueBusiness",
  "RevenueLocation",
  "RevenueSourceRecord",
  "RevenueWorkflowDefinition",
  "RevenueWorkflowRun",
  "RevenueWorkflowDelivery",
  "RevenueWorkflowAttempt",
  "RevenueWorkflowReceiptRevision",
  "RevenueWorkflowAttemptClosure",
  "RevenuePrivateKwMaterializationReceipt",
] as const;

function parseArgs(args: string[]) {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!name?.startsWith("--") || !value || value.startsWith("--")) {
      throw new Error("Usage: npm run kw:materialize-source-workflow -- --source-plan data/kw-evaluation/plan.json --materialization data/kw-evaluation/materialization.json --database data/kw-evaluation/shadow.sqlite");
    }
    if (values.has(name)) throw new Error(`Duplicate argument ${name}.`);
    values.set(name, value);
  }
  if (
    values.size !== 3
    || !values.has("--source-plan")
    || !values.has("--materialization")
    || !values.has("--database")
  ) {
    throw new Error("Exactly --source-plan, --materialization, and --database are required.");
  }
  return {
    sourcePlan: resolvePrivateKwDataPath(values.get("--source-plan")!),
    materialization: resolvePrivateKwDataPath(values.get("--materialization")!),
    database: resolvePrivateKwDatabasePath(values.get("--database")!),
  };
}

function assertFreshDatabaseClock(database: Database.Database, recordedAt: string) {
  const row = database.prepare(
    `SELECT strftime('%Y-%m-%dT%H:%M:%fZ', 'now') AS "databaseNow"`,
  ).get() as { databaseNow?: unknown } | undefined;
  if (!row || typeof row.databaseNow !== "string") {
    throw new Error("Local materialization could not read the database clock.");
  }
  const driftMs = Math.abs(Date.parse(row.databaseNow) - Date.parse(recordedAt));
  if (!Number.isFinite(driftMs) || driftMs > LOCAL_MATERIALIZATION_CLOCK_SKEW_MS) {
    throw new Error("Fresh local materialization approval is outside the database clock window.");
  }
}

export function executePrivateKwSourceWorkflowPlanForLocalDatabase(
  database: Database.Database,
  plan: PrivateKwSourceWorkflowMaterializationPlan,
) {
  const execute = database.transaction(() => {
    const states = plan.records.map((record) => {
      const rows = database.prepare(record.selectSql).all(...record.selectBindings) as Record<string, unknown>[];
      return verifyPrivateKwSourceWorkflowPreflight(record, rows).state;
    });
    const conflictIndex = states.findIndex((state) => state === "CONFLICT");
    if (conflictIndex >= 0) {
      const conflict = plan.records[conflictIndex];
      throw new Error(`Private KW source/workflow materialization conflict for ${conflict.entity}:${conflict.recordId}.`);
    }
    const receiptIndex = plan.records.findIndex((record) => record.entity === "MATERIALIZATION_RECEIPT");
    const receiptExists = states[receiptIndex] === "EXACT_MATCH";
    if (receiptExists && states.some((state) => state !== "EXACT_MATCH")) {
      throw new Error("A private KW materialization receipt exists without its exact complete row set.");
    }
    if (receiptExists) {
      return {
        executionPath: "EXACT_REPLAY" as const,
        insertedRows: { source: 0, workflow: 0, materializationReceipts: 0 },
      };
    }

    assertFreshDatabaseClock(database, plan.recordedAt);
    const missing = plan.records.filter((_, index) => states[index] === "MISSING");
    if (missing.at(-1)?.entity !== "MATERIALIZATION_RECEIPT") {
      throw new Error("A fresh private KW materialization must commit its receipt last.");
    }
    for (const record of missing) {
      const result = database.prepare(record.insertSql).run(...record.insertBindings);
      if (result.changes !== 1) {
        throw new Error(`Private KW materialization insert did not create exactly one row (${record.entity}:${record.recordId}).`);
      }
    }
    for (const record of plan.records) {
      const rows = database.prepare(record.selectSql).all(...record.selectBindings) as Record<string, unknown>[];
      if (verifyPrivateKwSourceWorkflowPreflight(record, rows).state !== "EXACT_MATCH") {
        throw new Error(`Committed private KW materialization row failed exact reload (${record.entity}:${record.recordId}).`);
      }
    }
    return {
      executionPath: "FRESH_COMMIT" as const,
      insertedRows: {
        source: missing.filter((record) => ["SOURCE_RUN", "BUSINESS", "LOCATION", "SOURCE_RECORD"].includes(record.entity)).length,
        workflow: missing.filter((record) => record.entity.startsWith("WORKFLOW_")).length,
        materializationReceipts: 1,
      },
    };
  });
  return execute.immediate();
}

export async function materializePrivateKwSourceWorkflowFile(args: string[]) {
  const files = parseArgs(args);
  const [sourceRead, materializationRead, databaseFile] = await Promise.all([
    readPrivateKwJson(files.sourcePlan, MAX_PRIVATE_SOURCE_BYTES),
    readPrivateKwJson(files.materialization, MAX_PRIVATE_MATERIALIZATION_BYTES),
    inspectPrivateKwDatabase(files.database, MAX_PRIVATE_DATABASE_BYTES),
  ]);
  if (sourceRead.file === materializationRead.file) {
    throw new Error("Source plan and source/workflow materialization approval must be different files.");
  }
  const plan = buildPrivateKwSourceWorkflowMaterializationPlan(
    sourceRead.value,
    materializationRead.value,
  );
  const database = new Database(databaseFile, { fileMustExist: true, timeout: 0 });
  try {
    database.pragma("foreign_keys = ON");
    assertPrivateKwSingleDatabase(database);
    assertPrivateKwRequiredTables(database, REQUIRED_TABLES, "source/workflow materialization");
    assertCanonicalPrivateKwRevenueSchema(database);
    const result = executePrivateKwSourceWorkflowPlanForLocalDatabase(database, plan);
    return {
      materializationId: plan.materializationId,
      workflowRunId: plan.workflowRunId,
      workflowReceiptId: plan.workflowReceiptId,
      executionPath: result.executionPath,
      insertedRows: result.insertedRows,
      committedAndReloaded: true as const,
      localOnly: true as const,
      localAssessmentMutationAuthorized: false as const,
      schemaMutationAuthorized: false as const,
      captureAuthorized: false as const,
      contactDiscoveryAuthorized: false as const,
      contactVerificationAuthorized: false as const,
      outreachAuthorized: false as const,
      sendAuthorized: false as const,
      providerOperationsAuthorized: 0 as const,
      costAuthorizedUsd: 0 as const,
    };
  } finally {
    database.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  materializePrivateKwSourceWorkflowFile(process.argv.slice(2))
    .then((result) => {
      console.log(`Local source/workflow materialization ${result.executionPath}: ${result.materializationId}`);
      console.log(`Sealed workflow receipt: ${result.workflowReceiptId}`);
      console.log("No assessment, capture, contact, outreach, provider, migration, deployment, or production action was authorized.");
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : "Private KW source/workflow materialization failed.");
      process.exitCode = 1;
    });
}
