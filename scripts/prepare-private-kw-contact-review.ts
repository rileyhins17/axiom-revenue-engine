import { pathToFileURL } from "node:url";

import Database from "better-sqlite3";

import {
  PrivateKwContactReviewDraftSchema,
  buildPrivateKwContactReview,
} from "../src/lib/revenue-engine/private-kw-contact-invocation";
import {
  inspectPrivateKwDatabase,
  readPrivateKwJson,
  resolvePrivateKwDataPath,
  resolvePrivateKwDatabasePath,
  writePrivateKwJson,
} from "./private-kw-files";
import {
  assertCanonicalPrivateKwRevenueSchema,
  assertPrivateKwRequiredTables,
  assertPrivateKwSingleDatabase,
} from "./private-kw-database";
import {
  assertExactPrivateKwSourceMaterialization,
  loadExactPrivateKwLeadAssessment,
} from "./private-kw-contact-prerequisites";

const MAX_PRIVATE_SOURCE_BYTES = 5_000_000;
const MAX_PRIVATE_DRAFT_BYTES = 2_000_000;
const MAX_PRIVATE_DATABASE_BYTES = 512_000_000;

const REQUIRED_TABLES = [
  "RevenueSourceRun",
  "RevenueBusiness",
  "RevenueLocation",
  "RevenueSourceRecord",
  "RevenueWorkflowReceiptRevision",
  "RevenueWorkflowAttemptClosure",
  "RevenueLeadAssessmentReceipt",
] as const;

function parseArgs(args: string[]) {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!name?.startsWith("--") || !value || value.startsWith("--")) {
      throw new Error("Usage: npm run kw:prepare-contact-review -- --source-plan data/kw-evaluation/plan.json --draft data/kw-evaluation/contact-draft.json --database data/kw-evaluation/shadow.sqlite --output data/kw-evaluation/contact-review.json");
    }
    if (values.has(name)) throw new Error(`Duplicate argument ${name}.`);
    values.set(name, value);
  }
  if (
    values.size !== 4
    || !values.has("--source-plan")
    || !values.has("--draft")
    || !values.has("--database")
    || !values.has("--output")
  ) {
    throw new Error("Exactly --source-plan, --draft, --database, and --output are required.");
  }
  return {
    sourcePlan: resolvePrivateKwDataPath(values.get("--source-plan")!),
    draft: resolvePrivateKwDataPath(values.get("--draft")!),
    database: resolvePrivateKwDatabasePath(values.get("--database")!),
    output: resolvePrivateKwDataPath(values.get("--output")!),
  };
}

export async function preparePrivateKwContactReviewFile(args: string[]) {
  const files = parseArgs(args);
  if (new Set([files.sourcePlan, files.draft, files.output]).size !== 3) {
    throw new Error("Source plan, contact draft, and review output must be different files.");
  }
  const [sourceRead, draftRead, databaseFile] = await Promise.all([
    readPrivateKwJson(files.sourcePlan, MAX_PRIVATE_SOURCE_BYTES),
    readPrivateKwJson(files.draft, MAX_PRIVATE_DRAFT_BYTES),
    inspectPrivateKwDatabase(files.database, MAX_PRIVATE_DATABASE_BYTES),
  ]);
  const draft = PrivateKwContactReviewDraftSchema.parse(draftRead.value);
  const database = new Database(databaseFile, {
    fileMustExist: true,
    readonly: true,
    timeout: 0,
  });
  try {
    database.pragma("foreign_keys = ON");
    assertPrivateKwSingleDatabase(database);
    assertPrivateKwRequiredTables(database, REQUIRED_TABLES, "contact review");
    assertCanonicalPrivateKwRevenueSchema(database);
    const source = assertExactPrivateKwSourceMaterialization(database, sourceRead.value);
    const assessment = loadExactPrivateKwLeadAssessment(database, draft.assessment);
    const review = buildPrivateKwContactReview(source, assessment, draft);
    const output = await writePrivateKwJson(files.output, review);
    return {
      output,
      reviewId: review.reviewId,
      assessmentReceiptId: review.assessment.assessmentReceiptId,
      summary: review.summary,
      reviewOnly: true as const,
      databaseMutationPerformed: false as const,
      contactDiscoveryExecuted: false as const,
      contactVerificationExecuted: false as const,
      consentDecisionAuthorized: false as const,
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
  preparePrivateKwContactReviewFile(process.argv.slice(2))
    .then((result) => {
      console.log(`Prepared read-only contact review: ${result.reviewId}`);
      console.log(`${result.summary.candidates} evidence-backed routes; ${result.summary.verificationResults} fixture verification results.`);
      console.log(`Ignored output: ${result.output}`);
      console.log("No database mutation, provider request, consent decision, outreach, or prospect contact was authorized.");
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : "Private KW contact review preparation failed.");
      process.exitCode = 1;
    });
}
