import { z } from "zod";

import {
  artifactReferenceCanonicalJson,
} from "@/lib/revenue-engine/artifact-reference-projection";
import {
  PrivateKwAuthenticatedOwnerDecisionRecordSchema,
  PrivateKwAuthenticatedOwnerDecisionStorageRowSchema,
  derivePrivateKwAuthenticatedOwnerDecisionStorageRowForValidation,
  projectPrivateKwAuthenticatedOwnerDecisionStorageRow,
  recheckPrivateKwAuthenticatedOwnerDecisionSessionBinding,
  requireInProcessPrivateKwAuthenticatedOwnerDecisionRecord,
  verifyPrivateKwAuthenticatedOwnerDecisionStoredBinding,
  type PrivateKwAuthenticatedOwnerDecisionRecord,
  type PrivateKwAuthenticatedOwnerSessionBindingRecheck,
} from "@/lib/revenue-engine/private-kw-authenticated-owner-decision";

export const PRIVATE_KW_AUTHENTICATED_OWNER_DECISION_D1_EXECUTOR_VERSION =
  "kw-authenticated-owner-decision-d1-v1";
export const PRIVATE_KW_AUTHENTICATED_OWNER_DECISION_TARGET_SCHEMA_VERSION =
  "0069_authenticated_owner_dossier_decisions";

const TimestampSchema = z.string().datetime({ offset: true });
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const SqlValueSchema = z.union([z.string(), z.number().finite(), z.null()]);
const SqlRowSchema = z.record(z.string(), SqlValueSchema);
type SqlValue = z.infer<typeof SqlValueSchema>;
type SqlRow = z.infer<typeof SqlRowSchema>;

export type PrivateKwAuthenticatedOwnerDecisionD1Statement = Readonly<{
  statementId: string;
  sql: string;
  bindings: readonly SqlValue[];
}>;

/**
 * Deliberately disconnected D1-shaped transaction boundary. No Worker, route,
 * script, runtime binding, or Cloudflare adapter imports this module.
 */
export interface PrivateKwAuthenticatedOwnerDecisionD1Boundary {
  batch(
    statements: readonly PrivateKwAuthenticatedOwnerDecisionD1Statement[],
  ): Promise<readonly unknown[]>;
}

const BatchResultSchema = z.object({
  success: z.literal(true),
  results: z.array(SqlRowSchema).max(10),
  changes: z.number().int().nonnegative(),
}).strict();
const DatabaseTimeRowSchema = z.object({ databaseNow: TimestampSchema }).strict();
const TriggerRowSchema = z.object({
  name: z.string().min(1),
  sql: z.string().min(1),
}).strict();

const REQUIRED_OWNER_DECISION_TRIGGER_MARKERS = {
  RevenuePrivateKwOwnerDecision_lineage_insert: {
    operation: "INSERT",
    marker: "REVENUE_PRIVATE_KW_OWNER_DECISION_LINEAGE_MISMATCH",
  },
  RevenuePrivateKwOwnerDecision_immutable_update: {
    operation: "UPDATE",
    marker: "REVENUE_PRIVATE_KW_OWNER_DECISION_APPEND_ONLY",
  },
  RevenuePrivateKwOwnerDecision_immutable_delete: {
    operation: "DELETE",
    marker: "REVENUE_PRIVATE_KW_OWNER_DECISION_APPEND_ONLY",
  },
} as const;

const OWNER_DECISION_WRITER_GUARD_PREDICATE = Object.keys(
  REQUIRED_OWNER_DECISION_TRIGGER_MARKERS,
).map(() => `EXISTS (
       SELECT 1 FROM "sqlite_master"
       WHERE "type" = 'trigger' AND "name" = ?
         AND instr("sql", ?) > 0 AND instr("sql", ?) > 0
     )`).join(" AND ");
const OWNER_DECISION_WRITER_GUARD_BINDINGS = Object.entries(
  REQUIRED_OWNER_DECISION_TRIGGER_MARKERS,
).flatMap(([name, requirement]) => [
  name,
  `BEFORE ${requirement.operation} ON "RevenuePrivateKwOwnerDecision"`,
  `RAISE(ABORT, '${requirement.marker}')`,
]);

const StoredOwnerDecisionRowSchema =
  PrivateKwAuthenticatedOwnerDecisionStorageRowSchema.extend({
    recordedAt: TimestampSchema,
    transactionKind: z.literal("D1_BATCH"),
  }).strict();
type StoredOwnerDecisionRow = z.infer<typeof StoredOwnerDecisionRowSchema>;

export const PrivateKwAuthenticatedOwnerDecisionD1ResultSchema = z.object({
  executorVersion: z.literal(
    PRIVATE_KW_AUTHENTICATED_OWNER_DECISION_D1_EXECUTOR_VERSION,
  ),
  targetSchemaVersion: z.literal(
    PRIVATE_KW_AUTHENTICATED_OWNER_DECISION_TARGET_SCHEMA_VERSION,
  ),
  executionPath: z.enum(["FRESH_COMMIT", "EXACT_REPLAY", "DURABLE_RELOAD"]),
  transactionApi: z.literal("INJECTED_D1_BATCH"),
  record: PrivateKwAuthenticatedOwnerDecisionRecordSchema,
  decisionRecordedAt: TimestampSchema,
  databaseNow: TimestampSchema,
  bindingKeyVersion: z.string().regex(/^[a-z0-9][a-z0-9._-]{2,63}$/),
  bindingIntegrityVerified: z.literal(true),
  currentOwnerSessionRechecked: z.boolean(),
  currentOwnerSessionAtDatabaseClock: z.boolean(),
  committedAndReloaded: z.literal(true),
  databaseReadPerformed: z.literal(true),
  databaseMutationPerformed: z.boolean(),
  decisionPersistenceScope: z.literal("AUTHENTICATED_OWNER_DECISION_ONLY"),
  runtimeConnected: z.literal(false),
  durableDecisionRecorded: z.literal(true),
  ownerDecisionPersistenceAuthorized: z.literal(false),
  phaseInputCreationAuthorized: z.literal(false),
  progressReceiptCreationAuthorized: z.literal(false),
  phaseAdvancementAuthorized: z.literal(false),
  browserCaptureAuthorized: z.literal(false),
  contactDiscoveryAuthorized: z.literal(false),
  contactVerificationAuthorized: z.literal(false),
  consentDecisionAuthorized: z.literal(false),
  qualificationAuthorized: z.literal(false),
  mailboxSyncAuthorized: z.literal(false),
  outreachAuthorized: z.literal(false),
  sendAuthorized: z.literal(false),
  deploymentAuthorized: z.literal(false),
  providerOperationsAuthorized: z.literal(0),
  costAuthorizedUsd: z.literal(0),
}).strict().superRefine((result, context) => {
  const committed = result.executionPath === "FRESH_COMMIT";
  if (result.databaseMutationPerformed !== committed) {
    context.addIssue({
      code: "custom",
      message: "Only a fresh authenticated owner decision commit may report a mutation.",
      path: ["databaseMutationPerformed"],
    });
  }
  const sessionRecheckRequired = result.executionPath !== "DURABLE_RELOAD";
  if (
    result.currentOwnerSessionRechecked !== sessionRecheckRequired
    || result.currentOwnerSessionAtDatabaseClock !== sessionRecheckRequired
  ) {
    context.addIssue({
      code: "custom",
      message: "Only commit/replay may claim a current rechecked owner session.",
      path: ["currentOwnerSessionRechecked"],
    });
  }
  if (
    result.bindingKeyVersion !== result.record.authentication.bindingKeyVersion
    || Date.parse(result.decisionRecordedAt) < Date.parse(result.record.preparedAt)
    || Date.parse(result.decisionRecordedAt)
      >= Date.parse(result.record.authentication.sessionExpiresAt)
    || Date.parse(result.databaseNow) < Date.parse(result.decisionRecordedAt)
  ) {
    context.addIssue({
      code: "custom",
      message: "Durable owner decision chronology or binding key version drifted.",
      path: ["decisionRecordedAt"],
    });
  }
});

export type PrivateKwAuthenticatedOwnerDecisionD1Result = z.infer<
  typeof PrivateKwAuthenticatedOwnerDecisionD1ResultSchema
>;

const trustedDurableOwnerDecisionResults = new WeakSet<object>();

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return Object.freeze(value);
}

export function requireTrustedPrivateKwAuthenticatedOwnerDecisionD1Result(
  value: unknown,
): PrivateKwAuthenticatedOwnerDecisionD1Result {
  PrivateKwAuthenticatedOwnerDecisionD1ResultSchema.parse(value);
  if (
    !value
    || typeof value !== "object"
    || !trustedDurableOwnerDecisionResults.has(value)
  ) {
    throw new Error(
      "Authenticated owner decision persistence must be the exact in-process result of the private durable reload boundary.",
    );
  }
  return value as PrivateKwAuthenticatedOwnerDecisionD1Result;
}

function statement(
  statementId: string,
  sql: string,
  bindings: readonly SqlValue[] = [],
): PrivateKwAuthenticatedOwnerDecisionD1Statement {
  return { statementId, sql, bindings };
}

const OWNER_DECISION_TRIGGER_STATEMENT = statement(
  "read:owner_decision_writer_guards",
  `SELECT "name", "sql" FROM "sqlite_master"
   WHERE "type" = 'trigger' AND "name" IN (${Object.keys(
    REQUIRED_OWNER_DECISION_TRIGGER_MARKERS,
  ).map(() => "?").join(", ")})
   ORDER BY "name"`,
  Object.keys(REQUIRED_OWNER_DECISION_TRIGGER_MARKERS),
);

const DATABASE_TIME_STATEMENT = statement(
  "read:owner_decision_database_time",
  `SELECT strftime('%Y-%m-%dT%H:%M:%fZ', 'now') AS "databaseNow"`,
);

const ROW_COLUMNS = [
  "id",
  "decisionVersion",
  "recordKind",
  "decisionDigest",
  "manifestId",
  "manifestDigest",
  "sourceImportId",
  "sourcePlanDigest",
  "businessId",
  "evaluationCandidateId",
  "sourceRecordId",
  "parentCheckpointId",
  "parentCheckpointDigest",
  "previousPhaseReceiptId",
  "previousPhaseReceiptDigest",
  "dossierDigest",
  "dossierGeneratedAt",
  "websiteSnapshotId",
  "qualificationSnapshotId",
  "contactInvocationId",
  "contactInvocationDigest",
  "contactReviewId",
  "acceptanceProofId",
  "acceptanceProofDigest",
  "decision",
  "decidedBy",
  "decidedAt",
  "authProvider",
  "authSubjectBindingDigest",
  "authSessionBindingDigest",
  "authDecisionBindingDigest",
  "authBindingKeyVersion",
  "sessionExpiresAt",
  "decisionJson",
  "preparedAt",
  "recordedAt",
  "transactionKind",
  "recordScope",
  "authenticatedSessionRequired",
  "verifiedOwnerEmailRequired",
  "currentSessionRecheckAtFutureWriteRequired",
  "exactTrustedDecisionInstanceRequired",
  "durableExactReloadRequiredBeforeProgress",
  "ownerDecisionPersistenceAuthorized",
  "phaseInputCreationAuthorized",
  "progressReceiptCreationAuthorized",
  "phaseAdvancementAuthorized",
  "browserCaptureAuthorized",
  "contactDiscoveryAuthorized",
  "contactVerificationAuthorized",
  "consentDecisionAuthorized",
  "qualificationAuthorized",
  "mailboxSyncAuthorized",
  "outreachAuthorized",
  "sendAuthorized",
  "deploymentAuthorized",
  "providerOperationsAuthorized",
  "costAuthorizedUsd",
] as const;

function selectOwnerDecisionStatement(recordId: string) {
  return statement(
    "read:authenticated_owner_decision",
    `SELECT ${ROW_COLUMNS.map((column) => `"${column}"`).join(", ")}
     FROM "RevenuePrivateKwOwnerDecision"
     WHERE "id" = ? ORDER BY "id"`,
    [recordId],
  );
}

function insertOwnerDecisionStatement(
  record: PrivateKwAuthenticatedOwnerDecisionRecord,
) {
  const values = projectPrivateKwAuthenticatedOwnerDecisionStorageRow(record);
  const columns = Object.keys(values);
  return statement(
    "insert:authenticated_owner_decision",
    `INSERT OR IGNORE INTO "RevenuePrivateKwOwnerDecision"
      (${columns.map((column) => `"${column}"`).join(", ")}, "recordedAt", "transactionKind")
     SELECT ${columns.map(() => "?").join(", ")},
       strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'D1_BATCH'
     WHERE julianday('now') >= julianday(?)
       AND julianday('now') < julianday(?)
       AND ${OWNER_DECISION_WRITER_GUARD_PREDICATE}`,
    [
      ...Object.values(values),
      record.preparedAt,
      record.authentication.sessionExpiresAt,
      ...OWNER_DECISION_WRITER_GUARD_BINDINGS,
    ],
  );
}

function parseBatchResults(raw: readonly unknown[], expectedCount: number) {
  if (raw.length !== expectedCount) {
    throw new Error(
      "D1 returned an unexpected authenticated owner decision batch result count.",
    );
  }
  return raw.map((result) => BatchResultSchema.parse(result));
}

function parseDatabaseNow(result: z.infer<typeof BatchResultSchema>) {
  if (result.results.length !== 1) {
    throw new Error("Authenticated owner decision requires one database-time row.");
  }
  return DatabaseTimeRowSchema.parse(result.results[0]).databaseNow;
}

function assertOwnerDecisionWriterGuards(
  result: z.infer<typeof BatchResultSchema>,
) {
  const rows = result.results.map((row) => TriggerRowSchema.parse(row));
  const expectedNames = Object.keys(REQUIRED_OWNER_DECISION_TRIGGER_MARKERS)
    .sort((left, right) => left.localeCompare(right, "en-CA"));
  if (
    rows.length !== expectedNames.length
    || rows.some((row, index) => row.name !== expectedNames[index])
  ) {
    throw new Error(
      "Durable authenticated owner decisions require every exact migration-0069 writer guard.",
    );
  }
  for (const row of rows) {
    const requirement = REQUIRED_OWNER_DECISION_TRIGGER_MARKERS[
      row.name as keyof typeof REQUIRED_OWNER_DECISION_TRIGGER_MARKERS
    ];
    if (
      !requirement
      || !row.sql.includes(
        `BEFORE ${requirement.operation} ON "RevenuePrivateKwOwnerDecision"`,
      )
      || !row.sql.includes(`RAISE(ABORT, '${requirement.marker}')`)
    ) {
      throw new Error(`Authenticated owner decision writer guard drifted: ${row.name}.`);
    }
  }
}

function assertSessionCurrentAtDatabaseClock(
  recheck: PrivateKwAuthenticatedOwnerSessionBindingRecheck,
  record: PrivateKwAuthenticatedOwnerDecisionRecord,
  databaseNow: string,
) {
  const databaseNowMs = Date.parse(databaseNow);
  if (
    databaseNowMs < Date.parse(recheck.sessionCreatedAt)
    || databaseNowMs < Date.parse(record.preparedAt)
    || databaseNowMs >= Date.parse(recheck.sessionExpiresAt)
  ) {
    throw new Error(
      "The authenticated owner session is not current at the database clock.",
    );
  }
}

function exactRecordFromRow(
  raw: SqlRow,
  dependencies: { bindingKey: Uint8Array; bindingKeyVersion: string },
) {
  const row = StoredOwnerDecisionRowSchema.parse(raw);
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(row.decisionJson) as unknown;
  } catch {
    throw new Error("Stored authenticated owner decision JSON is invalid.");
  }
  const record = verifyPrivateKwAuthenticatedOwnerDecisionStoredBinding(
    parsedJson,
    dependencies,
  );
  const expected = derivePrivateKwAuthenticatedOwnerDecisionStorageRowForValidation(
    record,
  );
  const comparable = Object.fromEntries(
    Object.keys(expected).map((key) => [
      key,
      row[key as keyof StoredOwnerDecisionRow],
    ]),
  );
  if (
    artifactReferenceCanonicalJson(comparable)
      !== artifactReferenceCanonicalJson(expected)
    || row.decisionJson !== artifactReferenceCanonicalJson(record)
  ) {
    throw new Error(
      "Stored authenticated owner decision does not exactly match its mirrored durable row.",
    );
  }
  return { row, record };
}

function durableResult(input: {
  executionPath: "FRESH_COMMIT" | "EXACT_REPLAY" | "DURABLE_RELOAD";
  row: StoredOwnerDecisionRow;
  record: PrivateKwAuthenticatedOwnerDecisionRecord;
  databaseNow: string;
}) {
  const sessionRechecked = input.executionPath !== "DURABLE_RELOAD";
  const parsed = PrivateKwAuthenticatedOwnerDecisionD1ResultSchema.parse({
    executorVersion: PRIVATE_KW_AUTHENTICATED_OWNER_DECISION_D1_EXECUTOR_VERSION,
    targetSchemaVersion:
      PRIVATE_KW_AUTHENTICATED_OWNER_DECISION_TARGET_SCHEMA_VERSION,
    executionPath: input.executionPath,
    transactionApi: "INJECTED_D1_BATCH",
    record: input.record,
    decisionRecordedAt: input.row.recordedAt,
    databaseNow: input.databaseNow,
    bindingKeyVersion: input.row.authBindingKeyVersion,
    bindingIntegrityVerified: true,
    currentOwnerSessionRechecked: sessionRechecked,
    currentOwnerSessionAtDatabaseClock: sessionRechecked,
    committedAndReloaded: true,
    databaseReadPerformed: true,
    databaseMutationPerformed: input.executionPath === "FRESH_COMMIT",
    decisionPersistenceScope: "AUTHENTICATED_OWNER_DECISION_ONLY",
    runtimeConnected: false,
    durableDecisionRecorded: true,
    ownerDecisionPersistenceAuthorized: false,
    phaseInputCreationAuthorized: false,
    progressReceiptCreationAuthorized: false,
    phaseAdvancementAuthorized: false,
    browserCaptureAuthorized: false,
    contactDiscoveryAuthorized: false,
    contactVerificationAuthorized: false,
    consentDecisionAuthorized: false,
    qualificationAuthorized: false,
    mailboxSyncAuthorized: false,
    outreachAuthorized: false,
    sendAuthorized: false,
    deploymentAuthorized: false,
    providerOperationsAuthorized: 0,
    costAuthorizedUsd: 0,
  });
  const trusted = deepFreeze(parsed);
  trustedDurableOwnerDecisionResults.add(trusted);
  return trusted;
}

export async function persistPrivateKwAuthenticatedOwnerDecisionD1(
  boundary: PrivateKwAuthenticatedOwnerDecisionD1Boundary,
  recordValue: unknown,
  currentSessionValue: unknown,
  dependencies: { bindingKey: Uint8Array; bindingKeyVersion: string },
) {
  const record = requireInProcessPrivateKwAuthenticatedOwnerDecisionRecord(
    recordValue,
  );
  const sessionRecheck =
    recheckPrivateKwAuthenticatedOwnerDecisionSessionBinding(
      record,
      currentSessionValue,
      dependencies,
    );
  const [guardResult, insertResult, timeResult, reloadResult] = parseBatchResults(
    await boundary.batch([
      OWNER_DECISION_TRIGGER_STATEMENT,
      insertOwnerDecisionStatement(record),
      DATABASE_TIME_STATEMENT,
      selectOwnerDecisionStatement(record.recordId),
    ]),
    4,
  );
  assertOwnerDecisionWriterGuards(guardResult);
  const databaseNow = parseDatabaseNow(timeResult);
  assertSessionCurrentAtDatabaseClock(sessionRecheck, record, databaseNow);
  if (insertResult.changes > 1 || reloadResult.results.length !== 1) {
    throw new Error(
      "Authenticated owner decision did not commit and reload exactly one durable row.",
    );
  }
  const { row, record: reloadedRecord } = exactRecordFromRow(
    reloadResult.results[0],
    dependencies,
  );
  if (reloadedRecord.recordDigest !== record.recordDigest) {
    throw new Error(
      "Durable authenticated owner decision conflicts with the exact trusted candidate.",
    );
  }
  return durableResult({
    executionPath: insertResult.changes === 1 ? "FRESH_COMMIT" : "EXACT_REPLAY",
    row,
    record: reloadedRecord,
    databaseNow,
  });
}

export async function loadPrivateKwAuthenticatedOwnerDecisionD1(
  boundary: PrivateKwAuthenticatedOwnerDecisionD1Boundary,
  identityValue: unknown,
  dependencies: { bindingKey: Uint8Array; bindingKeyVersion: string },
) {
  const identity = z.object({
    recordId: z.string().regex(/^kw-owner-decision:[a-f0-9]{64}$/),
    recordDigest: Sha256Schema,
  }).strict().superRefine((value, context) => {
    if (value.recordId !== `kw-owner-decision:${value.recordDigest}`) {
      context.addIssue({
        code: "custom",
        message: "Authenticated owner decision identity and digest must match.",
      });
    }
  }).parse(identityValue);
  const [guardResult, timeResult, reloadResult] = parseBatchResults(
    await boundary.batch([
      OWNER_DECISION_TRIGGER_STATEMENT,
      DATABASE_TIME_STATEMENT,
      selectOwnerDecisionStatement(identity.recordId),
    ]),
    3,
  );
  assertOwnerDecisionWriterGuards(guardResult);
  const databaseNow = parseDatabaseNow(timeResult);
  if (reloadResult.results.length !== 1) {
    throw new Error(
      "The exact durable authenticated owner decision is missing or ambiguous.",
    );
  }
  const { row, record } = exactRecordFromRow(
    reloadResult.results[0],
    dependencies,
  );
  if (record.recordDigest !== identity.recordDigest) {
    throw new Error(
      "Durable authenticated owner decision digest does not match the requested identity.",
    );
  }
  return durableResult({
    executionPath: "DURABLE_RELOAD",
    row,
    record,
    databaseNow,
  });
}
