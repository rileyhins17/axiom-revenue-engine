import { pathToFileURL } from "node:url";

import Database from "better-sqlite3";

import {
  buildPrivateKwSourceWorkflowProgressReceiptInput,
  type PrivateKwSourceWorkflowStoredRecordSnapshot,
} from "../src/lib/revenue-engine/private-kw-source-workflow-progress";
import {
  buildPrivateKwSourceWorkflowMaterializationPlan,
} from "../src/lib/revenue-engine/private-kw-source-workflow-materialization";
import {
  assertCanonicalPrivateKwRevenueSchema,
  assertPrivateKwRequiredTables,
  assertPrivateKwSingleDatabase,
} from "./private-kw-database";
import {
  inspectPrivateKwDatabase,
  readPrivateKwJson,
  resolvePrivateKwDataPath,
  resolvePrivateKwDatabasePath,
  writePrivateKwJson,
} from "./private-kw-files";

const MAX_PRIVATE_JSON_BYTES = 10_000_000;
const MAX_PRIVATE_DATABASE_BYTES = 512_000_000;

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

function usage() {
  return "Usage: npm run kw:prepare-source-workflow-progress -- --manifest data/kw-evaluation/shadow-slice-manifest.json --source-plan data/kw-evaluation/plan.json --materialization data/kw-evaluation/materialization.json --database data/kw-evaluation/shadow.sqlite --output data/kw-evaluation/source-workflow-phase-receipt.json";
}

function parseArgs(args: string[]) {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!name?.startsWith("--") || !value || value.startsWith("--")) throw new Error(usage());
    if (values.has(name)) throw new Error(`Duplicate argument ${name}.`);
    values.set(name, value);
  }
  const required = ["--manifest", "--source-plan", "--materialization", "--database", "--output"] as const;
  if (values.size !== required.length || required.some((name) => !values.has(name))) {
    throw new Error(usage());
  }
  const files = {
    manifest: resolvePrivateKwDataPath(values.get("--manifest")!),
    sourcePlan: resolvePrivateKwDataPath(values.get("--source-plan")!),
    materialization: resolvePrivateKwDataPath(values.get("--materialization")!),
    database: resolvePrivateKwDatabasePath(values.get("--database")!),
    output: resolvePrivateKwDataPath(values.get("--output")!),
  };
  if (new Set(Object.values(files)).size !== Object.values(files).length) {
    throw new Error("Manifest, source plan, materialization approval, database, and output must be different files.");
  }
  return files;
}

export async function preparePrivateKwSourceWorkflowProgressFile(
  args: string[],
  now: () => Date = () => new Date(),
) {
  const files = parseArgs(args);
  const [manifestRead, sourceRead, materializationRead, databaseFile] = await Promise.all([
    readPrivateKwJson(files.manifest, MAX_PRIVATE_JSON_BYTES),
    readPrivateKwJson(files.sourcePlan, MAX_PRIVATE_JSON_BYTES),
    readPrivateKwJson(files.materialization, MAX_PRIVATE_JSON_BYTES),
    inspectPrivateKwDatabase(files.database, MAX_PRIVATE_DATABASE_BYTES),
  ]);
  const plan = buildPrivateKwSourceWorkflowMaterializationPlan(sourceRead.value, materializationRead.value);
  const database = new Database(databaseFile, { fileMustExist: true, readonly: true, timeout: 0 });
  let storedRecords: PrivateKwSourceWorkflowStoredRecordSnapshot[];
  try {
    database.pragma("foreign_keys = ON");
    database.pragma("query_only = ON");
    assertPrivateKwSingleDatabase(database);
    assertPrivateKwRequiredTables(database, REQUIRED_TABLES, "source/workflow progress verification");
    assertCanonicalPrivateKwRevenueSchema(database);
    const readExactSnapshot = database.transaction(() => plan.records.map((record) => ({
      entity: record.entity,
      recordId: record.recordId,
      rows: database.prepare(record.selectSql).all(...record.selectBindings) as Record<string, unknown>[],
    })));
    storedRecords = readExactSnapshot.deferred();
  } finally {
    database.close();
  }

  const receipt = buildPrivateKwSourceWorkflowProgressReceiptInput({
    manifestValue: manifestRead.value,
    sourceValue: sourceRead.value,
    materializationValue: materializationRead.value,
    storedRecords,
    recordedAt: now().toISOString(),
  });
  const output = await writePrivateKwJson(files.output, receipt);
  return {
    output,
    businessId: receipt.businessId,
    materializationReceiptId: receipt.proof.primaryReceiptId,
    workflowReceiptId: receipt.proof.supportingReceipts[0]!.receiptId,
    verifiedRecords: storedRecords.length,
    progressRecordingOnly: true as const,
    phaseExecutionAuthorized: false as const,
    databaseMutationAuthorized: false as const,
    providerOperationsAuthorized: 0 as const,
    costAuthorizedUsd: 0 as const,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  preparePrivateKwSourceWorkflowProgressFile(process.argv.slice(2))
    .then((result) => {
      console.log(`Prepared source/workflow progress proof for ${result.businessId}.`);
      console.log(`Verified ${result.verifiedRecords} exact stored rows, including ${result.materializationReceiptId} and ${result.workflowReceiptId}.`);
      console.log(`Ignored output: ${result.output}`);
      console.log("This read-only proof authorizes no workflow execution, database mutation, provider, capture, outreach, deployment, send, or spend action.");
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : "Private KW source/workflow progress preparation failed.");
      process.exitCode = 1;
    });
}
