import { z } from "zod";

import {
  artifactReferenceCanonicalJson,
  artifactReferenceDigest,
} from "@/lib/revenue-engine/artifact-reference-projection";
import {
  PrivateKwAuthenticatedOwnerDecisionStorageRowSchema,
  derivePrivateKwAuthenticatedOwnerDecisionStorageRowForValidation,
  verifyPrivateKwAuthenticatedOwnerDecisionStoredBinding,
} from "@/lib/revenue-engine/private-kw-authenticated-owner-decision";
import {
  PrivateKwOwnerAuthIdempotencyRecordSchema,
} from "@/lib/revenue-engine/private-kw-owner-auth-idempotency";
import {
  PrivateKwOwnerAuthMutationAffectedRowProofSchema,
  buildPrivateKwOwnerAuthMutationAffectedRowProof,
  requireInProcessPrivateKwOwnerAuthMutationAffectedRowProof,
} from "@/lib/revenue-engine/private-kw-owner-auth-idempotency-recovery-proof";
import {
  PRIVATE_KW_OWNER_DOSSIER_ACCEPT_OPERATION,
  PRIVATE_KW_OWNER_DOSSIER_ACCEPT_TRIGGER_DEFINITION_DIGESTS,
  materializePrivateKwOwnerDossierAcceptFreshStatements,
  normalizePrivateKwOwnerAuthTriggerSql,
  requireInProcessPrivateKwOwnerDossierAcceptD1Plan,
  type PrivateKwOwnerDossierAcceptD1Plan,
  type PrivateKwOwnerDossierAcceptD1Statement,
} from "@/lib/revenue-engine/private-kw-owner-auth-dossier-accept-d1-plan";

export const PRIVATE_KW_OWNER_DOSSIER_ACCEPT_D1_EXECUTOR_VERSION =
  "kw-owner-dossier-accept-d1-executor-v1";

const TimestampSchema = z.string().datetime({ offset: true }).refine(
  (value) => Number.isFinite(Date.parse(value)),
  "D1 timestamps must resolve to finite epochs.",
);
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const SqlValueSchema = z.union([z.string(), z.number().finite(), z.null()]);
const SqlRowSchema = z.record(z.string(), SqlValueSchema);
type SqlRow = z.infer<typeof SqlRowSchema>;

const D1BatchResultSchema = z.object({
  success: z.literal(true),
  results: z.array(SqlRowSchema).max(100).nullable().transform((rows) => rows ?? []),
  meta: z.object({
    changes: z.number().int().nonnegative(),
  }).loose(),
}).loose();
type D1BatchResult = z.infer<typeof D1BatchResultSchema>;

const DatabaseTimeRowSchema = z.object({ databaseNow: TimestampSchema }).strict();
const TriggerRowSchema = z.object({
  type: z.literal("trigger"),
  name: z.string().min(1).max(160),
  tbl_name: z.enum([
    "RevenuePrivateKwOwnerDecision",
    "RevenuePrivateKwOwnerAuthIdempotency",
    "RevenuePrivateKwOwnerAuthMutationOutbox",
  ]),
  sql: z.string().min(1).max(16_000),
  schemaVersion: z.number().int().nonnegative().max(2_147_483_647),
}).strict();

const REQUIRED_TRIGGER_TABLES = {
  RevenuePrivateKwOwnerDecision_lineage_insert: "RevenuePrivateKwOwnerDecision",
  RevenuePrivateKwOwnerDecision_immutable_update: "RevenuePrivateKwOwnerDecision",
  RevenuePrivateKwOwnerDecision_immutable_delete: "RevenuePrivateKwOwnerDecision",
  RevenuePrivateKwOwnerAuthIdempotency_contract_insert:
    "RevenuePrivateKwOwnerAuthIdempotency",
  RevenuePrivateKwOwnerAuthIdempotency_transition_update:
    "RevenuePrivateKwOwnerAuthIdempotency",
  RevenuePrivateKwOwnerAuthIdempotency_immutable_delete:
    "RevenuePrivateKwOwnerAuthIdempotency",
  RevenuePrivateKwOwnerAuthMutationOutbox_contract_insert:
    "RevenuePrivateKwOwnerAuthMutationOutbox",
  RevenuePrivateKwOwnerAuthMutationOutbox_delivery_update:
    "RevenuePrivateKwOwnerAuthMutationOutbox",
  RevenuePrivateKwOwnerAuthMutationOutbox_immutable_delete:
    "RevenuePrivateKwOwnerAuthMutationOutbox",
} as const;

const StoredIdempotencyRowSchema = z.object({
  id: z.string(),
  recordVersion: z.literal("kw-owner-auth-idempotency-v1"),
  recordKind: z.literal("OWNER_AUTH_MUTATION_IDEMPOTENCY"),
  state: z.enum(["RESERVED", "COMMITTED"]),
  idempotencyKey: z.string(),
  boundaryId: z.string(),
  boundaryDigest: Sha256Schema,
  owner: z.enum(["RILEY", "AIDAN"]),
  operation: z.literal(PRIVATE_KW_OWNER_DOSSIER_ACCEPT_OPERATION),
  payloadDigest: Sha256Schema,
  recordId: z.string().nullable(),
  recordDigest: Sha256Schema.nullable(),
  resultDigest: Sha256Schema.nullable(),
  resultJson: z.string().nullable(),
  reservedAt: TimestampSchema,
  committedAt: TimestampSchema.nullable(),
  recordedAt: TimestampSchema.nullable(),
  transactionKind: z.literal("D1_BATCH"),
  recordScope: z.literal("OWNER_AUTH_MUTATION_IDEMPOTENCY_ONLY"),
  outboxRequired: z.literal(1),
  mutationAuthorized: z.literal(0),
  databaseMutationAuthorized: z.literal(0),
  routeAuthorized: z.literal(0),
  uiMutationAuthorized: z.literal(0),
  outreachAuthorized: z.literal(0),
  sendAuthorized: z.literal(0),
  deploymentAuthorized: z.literal(0),
  providerOperationsAuthorized: z.literal(0),
  costAuthorizedUsd: z.literal(0),
}).strict();

const StoredOwnerDecisionRowSchema =
  PrivateKwAuthenticatedOwnerDecisionStorageRowSchema.extend({
    recordedAt: TimestampSchema,
    transactionKind: z.literal("D1_BATCH"),
  }).strict();

const OutboxEventCoreSchema = z.object({
  eventVersion: z.literal("kw-owner-auth-outbox-v1"),
  eventKind: z.literal("OWNER_AUTH_MUTATION_COMMITTED"),
  idempotencyKey: z.string().regex(/^kw-owner-mutation-idempotency:[a-f0-9]{64}$/),
  recordId: z.string().regex(/^kw-owner-auth-idempotency:[a-f0-9]{64}$/),
  owner: z.enum(["RILEY", "AIDAN"]),
  operation: z.literal(PRIVATE_KW_OWNER_DOSSIER_ACCEPT_OPERATION),
  payloadDigest: Sha256Schema,
  recordDigest: Sha256Schema,
  state: z.literal("COMMITTED"),
  authority: z.object({
    deliveryAuthorized: z.literal(0),
    providerOperationsAuthorized: z.literal(0),
    costAuthorizedUsd: z.literal(0),
  }).strict(),
}).strict();
const OutboxEventSchema = OutboxEventCoreSchema.extend({
  eventId: z.string().regex(/^kw-owner-auth-outbox:[a-f0-9]{64}$/),
  eventDigest: Sha256Schema,
}).strict().superRefine((event, context) => {
  const { eventId: _eventId, eventDigest: _eventDigest, ...core } = event;
  void _eventId;
  void _eventDigest;
  const digest = artifactReferenceDigest(core);
  if (event.eventDigest !== digest || event.eventId !== `kw-owner-auth-outbox:${digest}`) {
    context.addIssue({
      code: "custom",
      message: "The outbox event identity must bind its exact content.",
      path: ["eventDigest"],
    });
  }
});

const StoredOutboxRowSchema = z.object({
  id: z.string(),
  outboxVersion: z.literal("kw-owner-auth-outbox-v1"),
  eventKind: z.literal("OWNER_AUTH_MUTATION_COMMITTED"),
  idempotencyKey: z.string(),
  recordId: z.string(),
  owner: z.enum(["RILEY", "AIDAN"]),
  operation: z.literal(PRIVATE_KW_OWNER_DOSSIER_ACCEPT_OPERATION),
  payloadDigest: Sha256Schema,
  recordDigest: Sha256Schema,
  eventDigest: Sha256Schema,
  eventJson: z.string(),
  deliveryState: z.literal("PENDING"),
  attemptCount: z.literal(0),
  createdAt: TimestampSchema,
  lastAttemptAt: z.null(),
  deliveredAt: z.null(),
  deliveryAuthorized: z.literal(0),
  providerOperationsAuthorized: z.literal(0),
  costAuthorizedUsd: z.literal(0),
}).strict();

const ExecutionAuthoritySchema = z.object({
  validationOnly: z.literal(true),
  injectedBoundaryOnly: z.literal(true),
  exactTriggerDefinitionsVerified: z.literal(true),
  exactDurableBundleReloadRequired: z.literal(true),
  postErrorReplayMustBeReadOnly: z.literal(true),
  runtimeConnectionAuthorized: z.literal(false),
  migrationApplicationAuthorized: z.literal(false),
  ownerDecisionPersistenceAuthorized: z.literal(false),
  phaseInputCreationAuthorized: z.literal(false),
  progressReceiptCreationAuthorized: z.literal(false),
  phaseAdvancementAuthorized: z.literal(false),
  routeAuthorized: z.literal(false),
  uiMutationAuthorized: z.literal(false),
  outreachAuthorized: z.literal(false),
  sendAuthorized: z.literal(false),
  deploymentAuthorized: z.literal(false),
  providerOperationsAuthorized: z.literal(0),
  costAuthorizedUsd: z.literal(0),
}).strict();

export const PrivateKwOwnerDossierAcceptD1ExecutionResultSchema = z.object({
  executorVersion: z.literal(PRIVATE_KW_OWNER_DOSSIER_ACCEPT_D1_EXECUTOR_VERSION),
  planId: z.string().regex(/^kw-owner-dossier-accept-d1-plan:[a-f0-9]{64}$/),
  planDigest: Sha256Schema,
  executionPath: z.enum(["FRESH_COMMIT", "EXACT_REPLAY"]),
  transactionApi: z.literal("INJECTED_D1_BATCH"),
  databaseNow: TimestampSchema,
  ownerDecisionRecordedAt: TimestampSchema,
  idempotencyCommittedAt: TimestampSchema,
  outboxCreatedAt: TimestampSchema,
  postErrorReloadPerformed: z.boolean(),
  exactTriggerDefinitionsVerified: z.literal(true),
  affectedRowProof: PrivateKwOwnerAuthMutationAffectedRowProofSchema,
  boundaryResponseValidated: z.literal(true),
  liveD1ExecutionProven: z.literal(false),
  runtimeConnected: z.literal(false),
  migrationApplied: z.literal(false),
  authority: ExecutionAuthoritySchema,
}).strict().superRefine((result, context) => {
  if (
    (result.executionPath === "FRESH_COMMIT" && result.postErrorReloadPerformed)
    || (result.postErrorReloadPerformed && result.executionPath !== "EXACT_REPLAY")
  ) {
    context.addIssue({
      code: "custom",
      message: "Only an exact replay may follow an ambiguous fresh-batch error.",
      path: ["postErrorReloadPerformed"],
    });
  }
  if (
    Date.parse(result.idempotencyCommittedAt) > Date.parse(result.databaseNow)
    || Date.parse(result.ownerDecisionRecordedAt) > Date.parse(result.databaseNow)
    || Date.parse(result.outboxCreatedAt) > Date.parse(result.databaseNow)
  ) {
    context.addIssue({
      code: "custom",
      message: "The final database clock must not precede a committed bundle row.",
      path: ["databaseNow"],
    });
  }
});

export type PrivateKwOwnerDossierAcceptD1ExecutionResult = z.infer<
  typeof PrivateKwOwnerDossierAcceptD1ExecutionResultSchema
>;

export interface PrivateKwOwnerDossierAcceptD1Boundary {
  batch(
    statements: readonly PrivateKwOwnerDossierAcceptD1Statement[],
  ): Promise<readonly unknown[]>;
}

interface PreparedBatchDatabaseLike<TStatement> {
  prepare(query: string): {
    bind(...values: unknown[]): TStatement;
  };
  batch(statements: TStatement[]): Promise<readonly unknown[]>;
}

export function createPrivateKwOwnerDossierAcceptD1Boundary<TStatement>(
  database: PreparedBatchDatabaseLike<TStatement>,
): PrivateKwOwnerDossierAcceptD1Boundary {
  return {
    async batch(statements) {
      const prepared = statements.map((item) =>
        database.prepare(item.sql).bind(...item.bindings));
      return await database.batch(prepared);
    },
  };
}

const trustedExecutionResults = new WeakSet<object>();

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return Object.freeze(value);
}

function parseBatchResults(raw: readonly unknown[], expectedCount: number) {
  if (raw.length !== expectedCount) {
    throw new Error(`D1 returned ${raw.length} results; ${expectedCount} exact results were required.`);
  }
  return raw.map((result) => D1BatchResultSchema.parse(result));
}

function requireReadResult(result: D1BatchResult, statementId: string) {
  if (result.meta.changes !== 0) {
    throw new Error(`${statementId} unexpectedly reported changed rows.`);
  }
  return result.results;
}

function parseDatabaseNow(result: D1BatchResult, plan: PrivateKwOwnerDossierAcceptD1Plan) {
  const rows = requireReadResult(result, "read:owner_auth_database_time");
  if (rows.length !== 1) throw new Error("The owner action requires exactly one database-time row.");
  const databaseNow = DatabaseTimeRowSchema.parse(rows[0]).databaseNow;
  const now = Date.parse(databaseNow);
  if (
    now < Date.parse(plan.sessionCreatedAt)
    || now < Date.parse(plan.plannedAt)
    || now >= Date.parse(plan.sessionExpiresAt)
  ) {
    throw new Error("The exact owner session is not current at the database clock.");
  }
  return databaseNow;
}

function assertExactTriggerDefinitions(result: D1BatchResult) {
  const rows = requireReadResult(result, "read:owner_auth_transaction_guards")
    .map((row) => TriggerRowSchema.parse(row));
  const expected = Object.entries(
    PRIVATE_KW_OWNER_DOSSIER_ACCEPT_TRIGGER_DEFINITION_DIGESTS,
  ).sort(([left], [right]) => left.localeCompare(right, "en-CA"));
  if (rows.length !== expected.length) {
    throw new Error(
      "The exact nine owner-auth trigger definitions are required and unexpected target-table triggers are forbidden.",
    );
  }
  const schemaVersion = rows[0]?.schemaVersion;
  if (schemaVersion === undefined) {
    throw new Error("The owner-auth trigger read omitted its exact schema version.");
  }
  rows.forEach((row, index) => {
    const [expectedName, expectedDigest] = expected[index] ?? [];
    const actualDigest = artifactReferenceDigest(
      normalizePrivateKwOwnerAuthTriggerSql(row.sql),
    );
    const expectedTable = expectedName
      ? REQUIRED_TRIGGER_TABLES[expectedName as keyof typeof REQUIRED_TRIGGER_TABLES]
      : undefined;
    if (
      row.name !== expectedName
      || row.tbl_name !== expectedTable
      || row.schemaVersion !== schemaVersion
      || actualDigest !== expectedDigest
    ) {
      throw new Error(`Owner-auth trigger definition drifted: ${row.name}.`);
    }
  });
  return schemaVersion;
}

function parseCanonicalJson(value: string, description: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new Error(`${description} is not valid JSON.`);
  }
  if (value !== artifactReferenceCanonicalJson(parsed)) {
    throw new Error(`${description} is not canonical JSON.`);
  }
  return parsed;
}

function exactIdempotencyRow(raw: SqlRow, plan: PrivateKwOwnerDossierAcceptD1Plan) {
  const row = StoredIdempotencyRowSchema.parse(raw);
  if (row.state === "RESERVED") return { state: "RESERVED" as const, row };
  if (!row.resultJson || !row.recordId || !row.recordDigest || !row.resultDigest
    || !row.committedAt || !row.recordedAt) {
    throw new Error("The committed idempotency row is incomplete.");
  }
  const record = PrivateKwOwnerAuthIdempotencyRecordSchema.parse(
    parseCanonicalJson(row.resultJson, "Stored idempotency resultJson"),
  );
  if (
    row.resultJson !== plan.expectedIdempotencyRecordJson
    || row.id !== plan.idempotencyKey
    || row.idempotencyKey !== plan.idempotencyKey
    || row.boundaryId !== plan.boundaryId
    || row.boundaryDigest !== plan.boundaryDigest
    || row.owner !== plan.owner
    || row.payloadDigest !== plan.payloadDigest
    || row.recordId !== plan.idempotencyRecordId
    || row.recordDigest !== plan.idempotencyRecordDigest
    || row.resultDigest !== plan.resultDigest
    || record.idempotencyKey !== plan.idempotencyKey
    || record.recordId !== plan.idempotencyRecordId
    || record.recordDigest !== plan.idempotencyRecordDigest
    || record.resultDigest !== plan.resultDigest
    || row.committedAt !== row.recordedAt
    || Date.parse(row.reservedAt) > Date.parse(row.committedAt)
    || Date.parse(record.storedAt) > Date.parse(row.committedAt)
  ) {
    throw new Error("The durable idempotency row does not exactly match this owner action.");
  }
  return { state: "COMMITTED" as const, row, record };
}

function exactOwnerDecisionRow(
  raw: SqlRow,
  plan: PrivateKwOwnerDossierAcceptD1Plan,
  dependencies: { bindingKey: Uint8Array; bindingKeyVersion: string },
) {
  const row = StoredOwnerDecisionRowSchema.parse(raw);
  if (row.decisionJson !== plan.expectedOwnerDecisionRecordJson) {
    throw new Error("The durable owner decision JSON does not match this owner action.");
  }
  const record = verifyPrivateKwAuthenticatedOwnerDecisionStoredBinding(
    parseCanonicalJson(row.decisionJson, "Stored owner decisionJson"),
    dependencies,
  );
  const expected = derivePrivateKwAuthenticatedOwnerDecisionStorageRowForValidation(record);
  const comparable = Object.fromEntries(
    Object.keys(expected).map((key) => [key, row[key as keyof typeof row]]),
  );
  if (
    artifactReferenceCanonicalJson(comparable) !== artifactReferenceCanonicalJson(expected)
    || record.recordId !== plan.ownerDecisionRecordId
    || record.recordDigest !== plan.ownerDecisionRecordDigest
    || record.businessId !== plan.businessId
    || record.decision.decidedBy !== plan.owner
    || record.authentication.sessionExpiresAt !== plan.sessionExpiresAt
    || record.authentication.bindingKeyVersion !== dependencies.bindingKeyVersion
    || Date.parse(row.recordedAt) < Date.parse(record.preparedAt)
    || Date.parse(row.recordedAt) >= Date.parse(plan.sessionExpiresAt)
  ) {
    throw new Error("The durable owner decision row does not exactly mirror its signed record.");
  }
  return { row, record };
}

function exactOutboxRow(raw: SqlRow, plan: PrivateKwOwnerDossierAcceptD1Plan) {
  const row = StoredOutboxRowSchema.parse(raw);
  if (row.eventJson !== plan.expectedOutboxEventJson) {
    throw new Error("The durable outbox JSON does not match this owner action.");
  }
  const event = OutboxEventSchema.parse(
    parseCanonicalJson(row.eventJson, "Stored outbox eventJson"),
  );
  if (
    row.id !== plan.outboxEventId
    || row.eventDigest !== plan.outboxEventDigest
    || row.idempotencyKey !== plan.idempotencyKey
    || row.recordId !== plan.idempotencyRecordId
    || row.owner !== plan.owner
    || row.payloadDigest !== plan.payloadDigest
    || row.recordDigest !== plan.idempotencyRecordDigest
    || event.eventId !== plan.outboxEventId
    || event.eventDigest !== plan.outboxEventDigest
  ) {
    throw new Error("The durable outbox row does not exactly mirror its event.");
  }
  return { row, event };
}

type ExactBundle = Readonly<{
  databaseNow: string;
  idempotency: ReturnType<typeof exactIdempotencyRow> & { state: "COMMITTED" };
  decision: ReturnType<typeof exactOwnerDecisionRow>;
  outbox: ReturnType<typeof exactOutboxRow>;
}>;

function assertExactBundleChronology(bundle: ExactBundle) {
  const reservedAt = Date.parse(bundle.idempotency.row.reservedAt);
  const decisionRecordedAt = Date.parse(bundle.decision.row.recordedAt);
  const committedAt = Date.parse(bundle.idempotency.row.committedAt as string);
  const recordedAt = Date.parse(bundle.idempotency.row.recordedAt as string);
  const outboxCreatedAt = Date.parse(bundle.outbox.row.createdAt);
  const databaseNow = Date.parse(bundle.databaseNow);
  if (
    reservedAt > decisionRecordedAt
    || decisionRecordedAt > committedAt
    || committedAt !== recordedAt
    || committedAt > outboxCreatedAt
    || outboxCreatedAt > databaseNow
  ) {
    throw new Error("The exact owner-action durable bundle chronology is invalid.");
  }
}

function parseReadBatch(
  raw: readonly unknown[],
  plan: PrivateKwOwnerDossierAcceptD1Plan,
  dependencies: { bindingKey: Uint8Array; bindingKeyVersion: string },
):
  | { state: "ABSENT"; databaseNow: string; schemaVersion: number }
  | { state: "COMMITTED"; bundle: ExactBundle; schemaVersion: number } {
  const [triggerResult, idempotencyResult, decisionResult, outboxResult, timeResult] =
    parseBatchResults(raw, 5);
  if (!triggerResult || !idempotencyResult || !decisionResult || !outboxResult || !timeResult) {
    throw new Error("The exact owner-action read batch is incomplete.");
  }
  const schemaVersion = assertExactTriggerDefinitions(triggerResult);
  const databaseNow = parseDatabaseNow(timeResult, plan);
  const idempotencyRows = requireReadResult(idempotencyResult, "read:owner_auth_committed");
  const decisionRows = requireReadResult(decisionResult, "read:authenticated_owner_decision");
  const outboxRows = requireReadResult(outboxResult, "read:owner_auth_outbox");
  if (idempotencyRows.length === 0) {
    if (decisionRows.length !== 0 || outboxRows.length !== 0) {
      throw new Error("A partial owner-action bundle exists without its idempotency record.");
    }
    return { state: "ABSENT", databaseNow, schemaVersion };
  }
  if (idempotencyRows.length !== 1) {
    throw new Error("The owner action has an ambiguous idempotency result.");
  }
  const idempotency = exactIdempotencyRow(idempotencyRows[0] as SqlRow, plan);
  if (idempotency.state === "RESERVED") {
    if (decisionRows.length !== 0 || outboxRows.length !== 0) {
      throw new Error("A reserved owner action has an invalid partial durable bundle.");
    }
    throw new Error("The owner action remains RESERVED and requires reviewed recovery.");
  }
  if (decisionRows.length !== 1 || outboxRows.length !== 1) {
    throw new Error("The committed owner action is missing its exact decision or outbox row.");
  }
  const decision = exactOwnerDecisionRow(decisionRows[0] as SqlRow, plan, dependencies);
  const outbox = exactOutboxRow(outboxRows[0] as SqlRow, plan);
  const bundle = { databaseNow, idempotency, decision, outbox } satisfies ExactBundle;
  assertExactBundleChronology(bundle);
  return {
    state: "COMMITTED",
    bundle,
    schemaVersion,
  };
}

function parseFreshBatch(
  raw: readonly unknown[],
  plan: PrivateKwOwnerDossierAcceptD1Plan,
  dependencies: { bindingKey: Uint8Array; bindingKeyVersion: string },
) {
  const results = parseBatchResults(raw, 8);
  const expectedChanges = [1, 1, 1, 1] as const;
  expectedChanges.forEach((expected, index) => {
    const result = results[index];
    if (!result || result.meta.changes !== expected || result.results.length !== 0) {
      throw new Error(`Fresh owner-action statement ${index + 1} did not affect exactly one row.`);
    }
  });
  const [, , , , idempotencyResult, decisionResult, outboxResult, timeResult] = results;
  if (!idempotencyResult || !decisionResult || !outboxResult || !timeResult) {
    throw new Error("The fresh owner-action batch omitted its exact durable reload.");
  }
  const databaseNow = parseDatabaseNow(timeResult, plan);
  for (const [statementId, result] of [
    ["read:owner_auth_committed", idempotencyResult],
    ["read:authenticated_owner_decision", decisionResult],
    ["read:owner_auth_outbox", outboxResult],
  ] as const) requireReadResult(result, statementId);
  if (
    idempotencyResult.results.length !== 1
    || decisionResult.results.length !== 1
    || outboxResult.results.length !== 1
  ) {
    throw new Error("The fresh owner action did not reload one exact durable bundle.");
  }
  const idempotency = exactIdempotencyRow(idempotencyResult.results[0] as SqlRow, plan);
  if (idempotency.state !== "COMMITTED") {
    throw new Error("The fresh owner action did not reload a committed idempotency row.");
  }
  const decision = exactOwnerDecisionRow(decisionResult.results[0] as SqlRow, plan, dependencies);
  const outbox = exactOutboxRow(outboxResult.results[0] as SqlRow, plan);
  const bundle = { databaseNow, idempotency, decision, outbox } satisfies ExactBundle;
  assertExactBundleChronology(bundle);
  return bundle;
}

function authority() {
  return ExecutionAuthoritySchema.parse({
    validationOnly: true,
    injectedBoundaryOnly: true,
    exactTriggerDefinitionsVerified: true,
    exactDurableBundleReloadRequired: true,
    postErrorReplayMustBeReadOnly: true,
    runtimeConnectionAuthorized: false,
    migrationApplicationAuthorized: false,
    ownerDecisionPersistenceAuthorized: false,
    phaseInputCreationAuthorized: false,
    progressReceiptCreationAuthorized: false,
    phaseAdvancementAuthorized: false,
    routeAuthorized: false,
    uiMutationAuthorized: false,
    outreachAuthorized: false,
    sendAuthorized: false,
    deploymentAuthorized: false,
    providerOperationsAuthorized: 0,
    costAuthorizedUsd: 0,
  });
}

function executionResult(input: {
  plan: PrivateKwOwnerDossierAcceptD1Plan;
  executionPath: "FRESH_COMMIT" | "EXACT_REPLAY";
  bundle: ExactBundle;
  postErrorReloadPerformed: boolean;
}) {
  const fresh = input.executionPath === "FRESH_COMMIT";
  const affectedRowProof = buildPrivateKwOwnerAuthMutationAffectedRowProof({
    claimValue: input.plan.operationClaim,
    executionPath: input.executionPath,
    claimMatched: fresh,
    operationRowsAffected: fresh ? 1 : 0,
    idempotencyRowsInserted: fresh ? 1 : 0,
    idempotencyRowsAfter: 1,
    outboxRowsInserted: fresh ? 1 : 0,
    outboxRowsAfter: 1,
    ownerMutationRowsChanged: fresh ? 1 : 0,
    unrelatedRowsChanged: 0,
    transactionState: "COMMITTED",
    failureReason: null,
  });
  const candidate = {
    executorVersion: PRIVATE_KW_OWNER_DOSSIER_ACCEPT_D1_EXECUTOR_VERSION,
    planId: input.plan.planId,
    planDigest: input.plan.planDigest,
    executionPath: input.executionPath,
    transactionApi: "INJECTED_D1_BATCH",
    databaseNow: input.bundle.databaseNow,
    ownerDecisionRecordedAt: input.bundle.decision.row.recordedAt,
    idempotencyCommittedAt: input.bundle.idempotency.row.committedAt,
    outboxCreatedAt: input.bundle.outbox.row.createdAt,
    postErrorReloadPerformed: input.postErrorReloadPerformed,
    exactTriggerDefinitionsVerified: true,
    affectedRowProof,
    boundaryResponseValidated: true,
    liveD1ExecutionProven: false,
    runtimeConnected: false,
    migrationApplied: false,
    authority: authority(),
  };
  const parsed = PrivateKwOwnerDossierAcceptD1ExecutionResultSchema.parse(candidate);
  const trusted = deepFreeze({
    ...parsed,
    // Zod intentionally clones parsed objects. Preserve the exact WeakSet-backed
    // proof instance after validating the full surrounding result contract.
    affectedRowProof,
  });
  PrivateKwOwnerDossierAcceptD1ExecutionResultSchema.parse(trusted);
  trustedExecutionResults.add(trusted);
  return trusted;
}

export function requireInProcessPrivateKwOwnerDossierAcceptD1ExecutionResult(
  value: unknown,
): PrivateKwOwnerDossierAcceptD1ExecutionResult {
  PrivateKwOwnerDossierAcceptD1ExecutionResultSchema.parse(value);
  if (!value || typeof value !== "object" || !trustedExecutionResults.has(value)) {
    throw new Error("An exact in-process owner dossier D1 execution result is required.");
  }
  requireInProcessPrivateKwOwnerAuthMutationAffectedRowProof(
    (value as PrivateKwOwnerDossierAcceptD1ExecutionResult).affectedRowProof,
  );
  return value as PrivateKwOwnerDossierAcceptD1ExecutionResult;
}

export async function executePrivateKwOwnerDossierAcceptD1(
  boundary: PrivateKwOwnerDossierAcceptD1Boundary,
  planValue: unknown,
  dependencies: { bindingKey: Uint8Array; bindingKeyVersion: string },
) {
  const plan = requireInProcessPrivateKwOwnerDossierAcceptD1Plan(planValue);
  const plannedDecision = verifyPrivateKwAuthenticatedOwnerDecisionStoredBinding(
    parseCanonicalJson(
      plan.expectedOwnerDecisionRecordJson,
      "Planned owner decision JSON",
    ),
    dependencies,
  );
  if (
    plannedDecision.recordId !== plan.ownerDecisionRecordId
    || plannedDecision.recordDigest !== plan.ownerDecisionRecordDigest
    || plannedDecision.businessId !== plan.businessId
    || plannedDecision.decision.decidedBy !== plan.owner
    || plannedDecision.authentication.sessionExpiresAt !== plan.sessionExpiresAt
  ) {
    throw new Error("The executor binding material does not verify this exact owner-action plan.");
  }
  const preflight = parseReadBatch(
    await boundary.batch(plan.preflightStatements),
    plan,
    dependencies,
  );
  if (preflight.state === "COMMITTED") {
    return executionResult({
      plan,
      executionPath: "EXACT_REPLAY",
      bundle: preflight.bundle,
      postErrorReloadPerformed: false,
    });
  }
  try {
    const freshStatements = materializePrivateKwOwnerDossierAcceptFreshStatements(
      plan,
      preflight.schemaVersion,
    );
    const bundle = parseFreshBatch(
      await boundary.batch(freshStatements),
      plan,
      dependencies,
    );
    return executionResult({
      plan,
      executionPath: "FRESH_COMMIT",
      bundle,
      postErrorReloadPerformed: false,
    });
  } catch (freshError) {
    let replay: ReturnType<typeof parseReadBatch>;
    try {
      replay = parseReadBatch(
        await boundary.batch(plan.replayStatements),
        plan,
        dependencies,
      );
    } catch (reloadError) {
      throw new AggregateError(
        [freshError, reloadError],
        "The fresh owner action failed and its read-only recovery reload was not exact.",
      );
    }
    if (replay.state !== "COMMITTED") throw freshError;
    return executionResult({
      plan,
      executionPath: "EXACT_REPLAY",
      bundle: replay.bundle,
      postErrorReloadPerformed: true,
    });
  }
}
