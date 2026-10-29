import { pathToFileURL } from "node:url";

import Database from "better-sqlite3";

import {
  buildPrivateKwOwnerLabelingPacket,
} from "../src/lib/revenue-engine/private-kw-owner-labeling";
import { KW_LEAD_EVALUATION_TARGET_SIZE } from "../src/lib/revenue-engine/lead-quality-evaluation";
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

type AssessmentReferenceRow = {
  id: string;
  assessmentDigest: string;
  workflowReceiptId: string;
  websiteSnapshotId: string;
  qualificationSnapshotId: string;
  businessId: string;
  recordedAt: string;
};

function parseArgs(args: string[]) {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!name?.startsWith("--") || !value || value.startsWith("--")) {
      throw new Error("Usage: npm run kw:prepare-owner-labeling -- --source-plan data/kw-evaluation/plan.json --database data/kw-evaluation/shadow.sqlite --output data/kw-evaluation/owner-labeling.json");
    }
    if (values.has(name)) throw new Error(`Duplicate argument ${name}.`);
    values.set(name, value);
  }
  if (values.size !== 3 || !values.has("--source-plan") || !values.has("--database") || !values.has("--output")) {
    throw new Error("Exactly --source-plan, --database, and --output are required.");
  }
  return {
    sourcePlan: resolvePrivateKwDataPath(values.get("--source-plan")!),
    database: resolvePrivateKwDatabasePath(values.get("--database")!),
    output: resolvePrivateKwDataPath(values.get("--output")!),
  };
}

function currentAssessmentRows(database: Database.Database, businessIds: string[]) {
  const rows = database.prepare(`
    SELECT
      "id", "assessmentDigest", "workflowReceiptId", "websiteSnapshotId",
      "qualificationSnapshotId", "businessId", "recordedAt"
    FROM "RevenueLeadAssessmentReceipt"
    WHERE "businessId" IN (${businessIds.map(() => "?").join(", ")})
    ORDER BY "businessId" ASC, "recordedAt" DESC, "id" DESC
  `).all(...businessIds) as AssessmentReferenceRow[];
  const grouped = new Map<string, AssessmentReferenceRow[]>();
  rows.forEach((row) => grouped.set(row.businessId, [...grouped.get(row.businessId) ?? [], row]));
  return [...grouped.values()].map((businessRows) => {
    if (businessRows.length > 1 && businessRows[0]?.recordedAt === businessRows[1]?.recordedAt) {
      throw new Error("The current assessment is ambiguous for one owner-labeling business.");
    }
    return businessRows[0]!;
  });
}

export function assertCompletePrivateKwOwnerLabelingCohort(sourceCount: number, assessmentCount: number) {
  if (sourceCount !== KW_LEAD_EVALUATION_TARGET_SIZE) {
    throw new Error(`Owner labeling requires the fixed ${KW_LEAD_EVALUATION_TARGET_SIZE}-business source cohort before review begins.`);
  }
  if (assessmentCount !== sourceCount) {
    throw new Error(`Owner labeling requires one current exact assessment for all ${sourceCount} source businesses.`);
  }
}

export async function preparePrivateKwOwnerLabelingFile(args: string[]) {
  const files = parseArgs(args);
  if (files.sourcePlan === files.output) {
    throw new Error("Source plan and owner-labeling output must be different files.");
  }
  const [sourceRead, databaseFile] = await Promise.all([
    readPrivateKwJson(files.sourcePlan, MAX_PRIVATE_SOURCE_BYTES),
    inspectPrivateKwDatabase(files.database, MAX_PRIVATE_DATABASE_BYTES),
  ]);
  const database = new Database(databaseFile, { fileMustExist: true, readonly: true, timeout: 0 });
  try {
    database.pragma("foreign_keys = ON");
    assertPrivateKwSingleDatabase(database);
    assertPrivateKwRequiredTables(database, REQUIRED_TABLES, "owner-labeling");
    assertCanonicalPrivateKwRevenueSchema(database);
    const source = assertExactPrivateKwSourceMaterialization(database, sourceRead.value);
    const rows = currentAssessmentRows(database, source.records.map((record) => record.business.id));
    assertCompletePrivateKwOwnerLabelingCohort(source.records.length, rows.length);
    const assessments = rows.map((row) => loadExactPrivateKwLeadAssessment(database, {
      assessmentReceiptId: row.id,
      assessmentDigest: row.assessmentDigest,
      workflowReceiptId: row.workflowReceiptId,
      websiteSnapshotId: row.websiteSnapshotId,
      qualificationSnapshotId: row.qualificationSnapshotId,
    }));
    const packet = buildPrivateKwOwnerLabelingPacket(source, assessments, new Date().toISOString());
    const output = await writePrivateKwJson(files.output, packet);
    return {
      output,
      packetId: packet.packetId,
      summary: packet.summary,
      databaseMutationPerformed: false as const,
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
  preparePrivateKwOwnerLabelingFile(process.argv.slice(2))
    .then((result) => {
      console.log(`Prepared immutable owner-labeling checkpoint: ${result.packetId}`);
      console.log(`${result.summary.reviewed}/${result.summary.targetSize} leads reviewed; ${result.summary.loaded} exact assessments loaded.`);
      console.log(`Ignored output: ${result.output}`);
      console.log("No database mutation, provider request, qualification change, outreach, send, or spend was authorized.");
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : "Private KW owner-labeling preparation failed.");
      process.exitCode = 1;
    });
}
