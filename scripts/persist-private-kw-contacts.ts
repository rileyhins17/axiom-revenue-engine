import { pathToFileURL } from "node:url";

import Database from "better-sqlite3";

import {
  PrivateKwContactInvocationApprovalSchema,
  PrivateKwContactReviewSchema,
  buildPrivateKwContactInvocation,
  buildPrivateKwContactInvocationReceiptRow,
  privateKwContactInvocationCanonicalJson,
} from "../src/lib/revenue-engine/private-kw-contact-invocation";
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
import {
  executePrivateKwContactPersistenceForLocalDatabase,
} from "./private-kw-contact-persistence-executor";
import {
  assertExactPrivateKwSourceMaterialization,
  loadExactPrivateKwLeadAssessment,
} from "./private-kw-contact-prerequisites";

const MAX_PRIVATE_SOURCE_BYTES = 5_000_000;
const MAX_PRIVATE_REVIEW_BYTES = 5_000_000;
const MAX_PRIVATE_APPROVAL_BYTES = 2_000_000;
const MAX_PRIVATE_DATABASE_BYTES = 512_000_000;

const REQUIRED_TABLES = [
  "RevenueSourceRun",
  "RevenueBusiness",
  "RevenueLocation",
  "RevenueSourceRecord",
  "RevenueWorkflowReceiptRevision",
  "RevenueWorkflowAttemptClosure",
  "RevenueLeadAssessmentReceipt",
  "RevenueContactDiscoveryReceipt",
  "RevenueContactPoint",
  "RevenueContactEvidenceClaim",
  "RevenueContactEvidenceUse",
  "RevenueVerificationResult",
  "RevenuePrivateKwContactPersistenceReceipt",
  "RevenuePrivateKwContactInvocationReceipt",
] as const;

type ReceiptRow = Record<string, string | number | null>;

export type PrivateKwContactInvocationReceiptBoundary = Readonly<{
  insert(database: Database.Database, receipt: Readonly<ReceiptRow>): void;
}>;

function parseArgs(args: string[]) {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!name?.startsWith("--") || !value || value.startsWith("--")) {
      throw new Error("Usage: npm run kw:persist-contacts -- --source-plan data/kw-evaluation/plan.json --review data/kw-evaluation/contact-review.json --approval data/kw-evaluation/contact-approval.json --database data/kw-evaluation/shadow.sqlite");
    }
    if (values.has(name)) throw new Error(`Duplicate argument ${name}.`);
    values.set(name, value);
  }
  if (
    values.size !== 4
    || !values.has("--source-plan")
    || !values.has("--review")
    || !values.has("--approval")
    || !values.has("--database")
  ) {
    throw new Error("Exactly --source-plan, --review, --approval, and --database are required.");
  }
  return {
    sourcePlan: resolvePrivateKwDataPath(values.get("--source-plan")!),
    review: resolvePrivateKwDataPath(values.get("--review")!),
    approval: resolvePrivateKwDataPath(values.get("--approval")!),
    database: resolvePrivateKwDatabasePath(values.get("--database")!),
  };
}

function selectInvocationReceipts(
  database: Database.Database,
  expected: ReceiptRow,
) {
  return database.prepare(`
    SELECT ${Object.keys(expected).map((column) => `"${column}"`).join(", ")}
    FROM "RevenuePrivateKwContactInvocationReceipt"
    WHERE "id" = ? OR "reviewId" = ? OR "materializationReceiptId" = ?
    ORDER BY "id"
  `).all(expected.id, expected.reviewId, expected.materializationReceiptId) as ReceiptRow[];
}

function receiptMatches(row: ReceiptRow, expected: ReceiptRow) {
  const comparable = Object.fromEntries(Object.keys(expected).map((key) => [key, row[key] ?? null]));
  return privateKwContactInvocationCanonicalJson(comparable)
    === privateKwContactInvocationCanonicalJson(expected);
}

function insertInvocationReceipt(database: Database.Database, expected: ReceiptRow) {
  const columns = Object.keys(expected);
  const result = database.prepare(
    `INSERT INTO "RevenuePrivateKwContactInvocationReceipt" (${columns.map((column) => `"${column}"`).join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
  ).run(...Object.values(expected));
  if (result.changes !== 1) throw new Error("Local contact invocation did not insert exactly one final receipt.");
}

export function executePrivateKwContactInvocationForLocalDatabase(
  database: Database.Database,
  input: {
    source: unknown;
    review: unknown;
    approval: unknown;
  },
  receiptBoundary: PrivateKwContactInvocationReceiptBoundary = { insert: insertInvocationReceipt },
) {
  const review = PrivateKwContactReviewSchema.parse(input.review);
  const approval = PrivateKwContactInvocationApprovalSchema.parse(input.approval);
  const execute = database.transaction(() => {
    const source = assertExactPrivateKwSourceMaterialization(database, input.source);
    const assessment = loadExactPrivateKwLeadAssessment(database, review.draft.assessment);
    const invocation = buildPrivateKwContactInvocation(source, assessment, review, approval);
    const expectedReceipt = buildPrivateKwContactInvocationReceiptRow(invocation);
    const existing = selectInvocationReceipts(database, expectedReceipt);
    if (existing.length > 1 || (existing.length === 1 && !receiptMatches(existing[0]!, expectedReceipt))) {
      throw new Error("Local contact invocation receipt identity conflicts with existing history.");
    }

    const materialization = executePrivateKwContactPersistenceForLocalDatabase(database, {
      discovery: invocation.review.discovery,
      verifications: invocation.review.verifications,
      approval: invocation.approval.persistenceApproval,
    });
    if (existing.length === 1) {
      if (materialization.executionPath !== "EXACT_REPLAY") {
        throw new Error("An invocation receipt exists without an exact contact materialization replay.");
      }
      return {
        invocation,
        materialization,
        executionPath: "EXACT_REPLAY" as const,
        invocationReceiptsInserted: 0 as const,
      };
    }
    if (materialization.executionPath !== "FRESH_COMMIT") {
      throw new Error("An exact contact bundle exists without its final invocation receipt.");
    }
    receiptBoundary.insert(database, expectedReceipt);
    const reloaded = selectInvocationReceipts(database, expectedReceipt);
    if (reloaded.length !== 1 || !receiptMatches(reloaded[0]!, expectedReceipt)) {
      throw new Error("Committed local contact invocation receipt failed exact reload.");
    }
    return {
      invocation,
      materialization,
      executionPath: "FRESH_COMMIT" as const,
      invocationReceiptsInserted: 1 as const,
    };
  });
  return execute.immediate();
}

export async function persistPrivateKwContactsFile(args: string[]) {
  const files = parseArgs(args);
  if (new Set([files.sourcePlan, files.review, files.approval]).size !== 3) {
    throw new Error("Source plan, contact review, and contact approval must be different files.");
  }
  const [sourceRead, reviewRead, approvalRead, databaseFile] = await Promise.all([
    readPrivateKwJson(files.sourcePlan, MAX_PRIVATE_SOURCE_BYTES),
    readPrivateKwJson(files.review, MAX_PRIVATE_REVIEW_BYTES),
    readPrivateKwJson(files.approval, MAX_PRIVATE_APPROVAL_BYTES),
    inspectPrivateKwDatabase(files.database, MAX_PRIVATE_DATABASE_BYTES),
  ]);
  const database = new Database(databaseFile, { fileMustExist: true, timeout: 0 });
  try {
    database.pragma("foreign_keys = ON");
    assertPrivateKwSingleDatabase(database);
    assertPrivateKwRequiredTables(database, REQUIRED_TABLES, "contact invocation");
    assertCanonicalPrivateKwRevenueSchema(database);
    const result = executePrivateKwContactInvocationForLocalDatabase(database, {
      source: sourceRead.value,
      review: reviewRead.value,
      approval: approvalRead.value,
    });
    return {
      invocationId: result.invocation.invocationId,
      reviewId: result.invocation.reviewId,
      assessmentReceiptId: result.invocation.assessment.assessmentReceiptId,
      materializationId: result.materialization.materializationId,
      discoveryResultId: result.materialization.discoveryResultId,
      verificationResultIds: result.materialization.verificationResultIds,
      executionPath: result.executionPath,
      insertedRows: {
        ...result.materialization.insertedRows,
        invocationReceipts: result.invocationReceiptsInserted,
      },
      committedAndReloaded: true as const,
      localOnly: true as const,
      contactDiscoveryExecuted: false as const,
      contactVerificationExecuted: false as const,
      consentDecisionAuthorized: false as const,
      qualificationAuthorized: false as const,
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
  persistPrivateKwContactsFile(process.argv.slice(2))
    .then((result) => {
      console.log(`Local reviewed contact invocation ${result.executionPath}: ${result.invocationId}`);
      console.log(`${result.verificationResultIds.length} fixture verification results persisted under the exact assessed business.`);
      console.log("No provider request, consent decision, qualification change, outreach, mailbox, or production action was authorized.");
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : "Private KW reviewed contact persistence failed.");
      process.exitCode = 1;
    });
}
