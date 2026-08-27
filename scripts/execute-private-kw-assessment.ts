import { pathToFileURL } from "node:url";

import Database from "better-sqlite3";

import {
  executePrivateRevenueLeadAssessmentD1,
  type RevenueLeadAssessmentD1Boundary,
  type RevenueLeadAssessmentD1Statement,
} from "../src/lib/revenue-engine/lead-assessment-d1";
import {
  buildPrivateKwAssessmentInvocation,
  type PrivateKwAssessmentInvocationInput,
} from "../src/lib/revenue-engine/private-kw-assessment-invocation";
import {
  PrivateKwImportPlanSchema,
} from "../src/lib/revenue-engine/private-kw-import";
import {
  buildPrivateKwPersistencePlan,
  verifyPersistencePreflight,
} from "../src/lib/revenue-engine/private-kw-persistence-plan";
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

const MAX_PRIVATE_PLAN_BYTES = 5_000_000;
const MAX_PRIVATE_INVOCATION_BYTES = 1_000_000;
const MAX_PRIVATE_DATABASE_BYTES = 512_000_000;

const REQUIRED_TABLES = [
  "RevenueSourceRun",
  "RevenueBusiness",
  "RevenueLocation",
  "RevenueSourceRecord",
  "RevenueWorkflowReceiptRevision",
  "RevenueWorkflowAttemptClosure",
  "RevenueWebsiteSnapshot",
  "RevenueEvidenceClaim",
  "RevenueQualificationSnapshot",
  "RevenueLeadAssessmentReceipt",
] as const;

function parseArgs(args: string[]) {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!name?.startsWith("--") || !value || value.startsWith("--")) {
      throw new Error("Usage: npm run kw:execute-assessment -- --source-plan data/kw-evaluation/plan.json --invocation data/kw-evaluation/assessment.json --database data/kw-evaluation/shadow.sqlite");
    }
    if (values.has(name)) throw new Error(`Duplicate argument ${name}.`);
    values.set(name, value);
  }
  if (
    values.size !== 3
    || !values.has("--source-plan")
    || !values.has("--invocation")
    || !values.has("--database")
  ) {
    throw new Error("Exactly --source-plan, --invocation, and --database are required.");
  }
  return {
    sourcePlan: resolvePrivateKwDataPath(values.get("--source-plan")!),
    invocation: resolvePrivateKwDataPath(values.get("--invocation")!),
    database: resolvePrivateKwDatabasePath(values.get("--database")!),
  };
}

function createBoundary(database: Database.Database): RevenueLeadAssessmentD1Boundary {
  const transaction = database.transaction((statements: readonly RevenueLeadAssessmentD1Statement[]) => statements.map((item) => {
    const prepared = database.prepare(item.sql);
    if (prepared.reader) {
      return {
        success: true,
        results: prepared.all(...item.bindings) as Record<string, string | number | null>[],
        changes: 0,
      };
    }
    const result = prepared.run(...item.bindings);
    return { success: true, results: [], changes: result.changes };
  }));
  return { async batch(statements) { return transaction(statements); } };
}

function assertExactSourceMaterialization(database: Database.Database, sourceValue: unknown) {
  const source = PrivateKwImportPlanSchema.parse(sourceValue);
  const persistencePlan = buildPrivateKwPersistencePlan(source);
  for (const item of persistencePlan.preflights) {
    const rows = database.prepare(item.selectSql).all(...item.bindings) as Record<string, unknown>[];
    const result = verifyPersistencePreflight(item, rows);
    if (result.state !== "EXACT_MATCH") {
      throw new Error(`Private KW source plan is not exactly materialized (${item.entity}:${result.state}).`);
    }
  }
  return source;
}

export async function executePrivateKwAssessmentFile(args: string[]) {
  const files = parseArgs(args);
  const [sourceRead, invocationRead, databaseFile] = await Promise.all([
    readPrivateKwJson(files.sourcePlan, MAX_PRIVATE_PLAN_BYTES),
    readPrivateKwJson(files.invocation, MAX_PRIVATE_INVOCATION_BYTES),
    inspectPrivateKwDatabase(files.database, MAX_PRIVATE_DATABASE_BYTES),
  ]);
  if (sourceRead.file === invocationRead.file) throw new Error("Source plan and invocation files must be different.");

  const database = new Database(databaseFile, { fileMustExist: true, timeout: 0 });
  try {
    database.pragma("foreign_keys = ON");
    assertPrivateKwSingleDatabase(database);
    assertPrivateKwRequiredTables(database, REQUIRED_TABLES, "shadow assessment");
    assertCanonicalPrivateKwRevenueSchema(database);
    const source = assertExactSourceMaterialization(database, sourceRead.value);
    const invocation = buildPrivateKwAssessmentInvocation(
      source,
      invocationRead.value as PrivateKwAssessmentInvocationInput,
    );
    const selected = source.records.find((record) => record.business.id === invocation.businessId);
    if (!selected) throw new Error("Approved KW candidate is absent from the exact source plan.");

    const result = await executePrivateRevenueLeadAssessmentD1(
      createBoundary(database),
      invocation.request,
    );
    if (result.assessment.business.id !== selected.business.id) {
      throw new Error("Committed assessment does not belong to the approved KW candidate.");
    }
    return {
      invocationId: invocation.invocationId,
      assessmentId: result.assessment.assessmentId,
      executionPath: result.executionPath,
      insertedRows: result.insertedRows,
      localOnly: true as const,
      sourceMutationPerformed: false as const,
      workflowMutationPerformed: false as const,
      contactDiscoveryPerformed: false as const,
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
  executePrivateKwAssessmentFile(process.argv.slice(2))
    .then((result) => {
      console.log(`Local shadow assessment ${result.executionPath}: ${result.assessmentId}`);
      console.log("No source, workflow, contact, outreach, provider, or production action was authorized.");
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : "Private KW assessment failed.");
      process.exitCode = 1;
    });
}
