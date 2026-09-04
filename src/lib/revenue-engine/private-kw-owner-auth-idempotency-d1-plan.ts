import { z } from "zod";

import {
  artifactReferenceCanonicalJson,
  artifactReferenceDigest,
} from "@/lib/revenue-engine/artifact-reference-projection";
import {
  requireInProcessPrivateKwOwnerAuthIdempotencyCommitResult,
  type PrivateKwOwnerAuthIdempotencyCommitResult,
} from "@/lib/revenue-engine/private-kw-owner-auth-idempotency";
import {
  requireInProcessPrivateKwOwnerAuthServerBoundary,
  type PrivateKwOwnerAuthServerBoundary,
} from "@/lib/revenue-engine/private-kw-owner-auth-server-boundary";
import {
  PRIVATE_KW_OWNER_AUTH_MUTATION_CLAIM_EXISTS_PREDICATE,
  PRIVATE_KW_OWNER_AUTH_MUTATION_CLAIM_PREDICATE,
} from "@/lib/revenue-engine/private-kw-owner-auth-idempotency-recovery";

export const PRIVATE_KW_OWNER_AUTH_IDEMPOTENCY_D1_PLAN_VERSION =
  "kw-owner-auth-idempotency-d1-plan-v1";
export const PRIVATE_KW_OWNER_AUTH_IDEMPOTENCY_D1_TARGET_SCHEMA_VERSION =
  "0070_owner_auth_idempotency_outbox";

const TimestampSchema = z.string().datetime({ offset: true });
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const SqlValueSchema = z.union([z.string(), z.number().finite(), z.null()]);
const IdempotencyKeySchema = z.string().regex(
  /^kw-owner-mutation-idempotency:[a-f0-9]{64}$/,
);
const RecordIdSchema = z.string().regex(
  /^kw-owner-auth-idempotency:[a-f0-9]{64}$/,
);

export type PrivateKwOwnerAuthIdempotencyD1Statement = Readonly<{
  statementId: string;
  sql: string;
  bindings: readonly z.infer<typeof SqlValueSchema>[];
}>;

const StatementSchema = z.object({
  statementId: z.string().regex(/^[a-z][a-z0-9._:-]{2,159}$/),
  sql: z.string().trim().min(1).max(16_000),
  bindings: z.array(SqlValueSchema).max(100),
}).strict();

const AuthoritySchema = z.object({
  validationOnly: z.literal(true),
  atomicD1BatchRequired: z.literal(true),
  currentSessionDatabaseClockRequired: z.literal(true),
  operationMutationMustBeClaimGated: z.literal(true),
  outboxMustShareMutationBatch: z.literal(true),
  replaySkipsMutation: z.literal(true),
  mutationAuthorized: z.literal(false),
  ownerDecisionPersistenceAuthorized: z.literal(false),
  phaseInputCreationAuthorized: z.literal(false),
  progressReceiptCreationAuthorized: z.literal(false),
  phaseAdvancementAuthorized: z.literal(false),
  databaseReadAuthorized: z.literal(false),
  databaseMutationAuthorized: z.literal(false),
  routeAuthorized: z.literal(false),
  uiMutationAuthorized: z.literal(false),
  outreachAuthorized: z.literal(false),
  sendAuthorized: z.literal(false),
  deploymentAuthorized: z.literal(false),
  providerOperationsAuthorized: z.literal(0),
  costAuthorizedUsd: z.literal(0),
}).strict();

const MutationGateSchema = z.object({
  statementId: z.literal("guard:owner_mutation_claim"),
  sqlPredicate: z.string().trim().min(1).max(2_000),
  bindings: z.array(SqlValueSchema).max(20),
  executableByThisPlan: z.literal(false),
  mustBeEmbeddedInOperationStatement: z.literal(true),
  mustShareD1Batch: z.literal(true),
}).strict();

const PlanSchema = z.object({
  planVersion: z.literal(PRIVATE_KW_OWNER_AUTH_IDEMPOTENCY_D1_PLAN_VERSION),
  targetSchemaVersion: z.literal(PRIVATE_KW_OWNER_AUTH_IDEMPOTENCY_D1_TARGET_SCHEMA_VERSION),
  mode: z.literal("SHADOW"),
  transactionApi: z.literal("INJECTED_D1_BATCH"),
  plannedAt: TimestampSchema,
  idempotencyKey: IdempotencyKeySchema,
  boundaryId: z.string().regex(/^kw-owner-auth-server-boundary:[a-f0-9]{64}$/),
  boundaryDigest: Sha256Schema,
  recordId: RecordIdSchema,
  recordDigest: Sha256Schema,
  owner: z.enum(["RILEY", "AIDAN"]),
  operation: z.string().regex(/^[a-z][a-z0-9._:-]{2,159}$/),
  payloadDigest: Sha256Schema,
  resultDigest: Sha256Schema,
  sessionCreatedAt: TimestampSchema,
  sessionExpiresAt: TimestampSchema,
  mutationGate: MutationGateSchema,
  statements: z.array(StatementSchema).length(5),
  statementOrder: z.tuple([
    z.literal("reserve"),
    z.literal("reload-reservation"),
    z.literal("finalize"),
    z.literal("outbox"),
    z.literal("reload-committed"),
  ]),
  requiresOneD1Batch: z.literal(true),
  requiresDatabaseClock: z.literal(true),
  requiresAtomicMutationAndOutbox: z.literal(true),
  replayPath: z.literal("COMMITTED_ROW_SKIPS_MUTATION_AND_REPLAYS_RESULT"),
  conflictPath: z.literal("FAIL_CLOSED"),
  runtimeConnected: z.literal(false),
  migrationApplied: z.literal(false),
  mutationAuthorized: z.literal(false),
  ownerDecisionPersistenceAuthorized: z.literal(false),
  progressReceiptCreationAuthorized: z.literal(false),
  phaseAdvancementAuthorized: z.literal(false),
  routeAuthorized: z.literal(false),
  uiMutationAuthorized: z.literal(false),
  outreachAuthorized: z.literal(false),
  sendAuthorized: z.literal(false),
  deploymentAuthorized: z.literal(false),
  providerOperationsAuthorized: z.literal(0),
  costAuthorizedUsd: z.literal(0),
  authority: AuthoritySchema,
}).strict();

export type PrivateKwOwnerAuthIdempotencyD1Plan = z.infer<typeof PlanSchema>;

const trustedPlans = new WeakSet<object>();

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return Object.freeze(value);
}

function statement(
  statementId: string,
  sql: string,
  bindings: readonly z.infer<typeof SqlValueSchema>[] = [],
): PrivateKwOwnerAuthIdempotencyD1Statement {
  return { statementId, sql, bindings };
}

function authority() {
  return AuthoritySchema.parse({
    validationOnly: true,
    atomicD1BatchRequired: true,
    currentSessionDatabaseClockRequired: true,
    operationMutationMustBeClaimGated: true,
    outboxMustShareMutationBatch: true,
    replaySkipsMutation: true,
    mutationAuthorized: false,
    ownerDecisionPersistenceAuthorized: false,
    phaseInputCreationAuthorized: false,
    progressReceiptCreationAuthorized: false,
    phaseAdvancementAuthorized: false,
    databaseReadAuthorized: false,
    databaseMutationAuthorized: false,
    routeAuthorized: false,
    uiMutationAuthorized: false,
    outreachAuthorized: false,
    sendAuthorized: false,
    deploymentAuthorized: false,
    providerOperationsAuthorized: 0,
    costAuthorizedUsd: 0,
  });
}

function committedEvent(record: PrivateKwOwnerAuthIdempotencyCommitResult["record"]) {
  const core = {
    eventVersion: "kw-owner-auth-outbox-v1",
    eventKind: "OWNER_AUTH_MUTATION_COMMITTED" as const,
    idempotencyKey: record.idempotencyKey,
    recordId: record.recordId,
    owner: record.owner,
    operation: record.operation,
    payloadDigest: record.payloadDigest,
    recordDigest: record.recordDigest,
    state: "COMMITTED" as const,
    authority: {
      deliveryAuthorized: 0 as const,
      providerOperationsAuthorized: 0 as const,
      costAuthorizedUsd: 0 as const,
    },
  };
  const eventDigest = artifactReferenceDigest(core);
  return {
    ...core,
    eventId: `kw-owner-auth-outbox:${eventDigest}`,
    eventDigest,
  } as const;
}

function exactBoundaryAndCommit(
  boundaryValue: unknown,
  commitResultValue: unknown,
) {
  const boundary = requireInProcessPrivateKwOwnerAuthServerBoundary(boundaryValue);
  const commit = requireInProcessPrivateKwOwnerAuthIdempotencyCommitResult(
    commitResultValue,
  );
  if (
    commit.record.boundaryId !== boundary.boundaryId
    || commit.record.boundaryDigest !== boundary.boundaryDigest
    || commit.record.idempotencyKey !== boundary.idempotencyKey
    || commit.record.owner !== boundary.owner
    || commit.record.operation !== boundary.operation
    || commit.record.payloadDigest !== boundary.payloadDigest
  ) {
    throw new Error("The D1 plan requires the exact boundary and idempotency result pair.");
  }
  return { boundary, commit };
}

function digestBindings(record: PrivateKwOwnerAuthIdempotencyCommitResult["record"]) {
  return [
    record.idempotencyKey,
    record.boundaryDigest,
    record.owner,
    record.operation,
    record.payloadDigest,
  ] as const;
}

function buildStatements(
  boundary: PrivateKwOwnerAuthServerBoundary,
  record: PrivateKwOwnerAuthIdempotencyCommitResult["record"],
) {
  const recordJson = artifactReferenceCanonicalJson(record);
  const event = committedEvent(record);
  const eventJson = artifactReferenceCanonicalJson(event);
  const rowColumns = [
    "id", "recordVersion", "recordKind", "state", "idempotencyKey",
    "boundaryId", "boundaryDigest", "owner", "operation", "payloadDigest",
    "reservedAt", "transactionKind", "recordScope", "outboxRequired",
    "mutationAuthorized", "databaseMutationAuthorized", "routeAuthorized",
    "uiMutationAuthorized", "outreachAuthorized", "sendAuthorized",
    "deploymentAuthorized", "providerOperationsAuthorized", "costAuthorizedUsd",
  ];
  const reservationColumns = [
    ...rowColumns.slice(0, 10),
    "resultJson",
    ...rowColumns.slice(10),
  ];
  const rowValues = [
    record.idempotencyKey,
    record.recordVersion,
    record.recordKind,
    "RESERVED",
    record.idempotencyKey,
    record.boundaryId,
    record.boundaryDigest,
    record.owner,
    record.operation,
    record.payloadDigest,
  ];
  const guard = PRIVATE_KW_OWNER_AUTH_MUTATION_CLAIM_PREDICATE;
  const guardBindings = digestBindings(record);
  return [
    statement(
      "reserve:owner_auth_idempotency",
      `INSERT OR IGNORE INTO "RevenuePrivateKwOwnerAuthIdempotency"
        (${reservationColumns.map((column) => `"${column}"`).join(", ")})
       SELECT ${rowValues.map(() => "?").join(", ")}, NULL,
         strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'D1_BATCH',
         'OWNER_AUTH_MUTATION_IDEMPOTENCY_ONLY', 1, 0, 0, 0, 0, 0, 0, 0, 0, 0
       WHERE julianday('now') >= julianday(?)
         AND julianday('now') < julianday(?)`,
      [...rowValues, boundary.sessionCreatedAt, boundary.sessionExpiresAt],
    ),
    statement(
      "read:owner_auth_reservation",
      `SELECT "id", "state", "boundaryDigest", "owner", "operation", "payloadDigest",
          "recordId", "recordDigest", "resultDigest", "resultJson", "reservedAt", "committedAt", "recordedAt"
       FROM "RevenuePrivateKwOwnerAuthIdempotency"
       WHERE "id" = ?`,
      [record.idempotencyKey],
    ),
    statement(
      "finalize:owner_auth_idempotency",
      `UPDATE "RevenuePrivateKwOwnerAuthIdempotency"
       SET "state" = 'COMMITTED', "recordId" = ?, "recordDigest" = ?,
           "resultDigest" = ?, "resultJson" = ?,
           "committedAt" = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
           "recordedAt" = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE ${guard}
         AND julianday('now') >= julianday(?)
         AND julianday('now') < julianday(?)`,
      [
        record.recordId,
        record.recordDigest,
        record.resultDigest,
        recordJson,
        ...guardBindings,
        boundary.sessionCreatedAt,
        boundary.sessionExpiresAt,
      ],
    ),
    statement(
      "insert:owner_auth_outbox",
      `INSERT OR IGNORE INTO "RevenuePrivateKwOwnerAuthMutationOutbox"
        ("id", "outboxVersion", "eventKind", "idempotencyKey", "recordId",
         "owner", "operation", "payloadDigest", "recordDigest", "eventDigest",
         "eventJson", "deliveryState", "attemptCount", "createdAt",
         "deliveryAuthorized", "providerOperationsAuthorized", "costAuthorizedUsd")
       SELECT ?, 'kw-owner-auth-outbox-v1', 'OWNER_AUTH_MUTATION_COMMITTED',
         ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', 0,
         strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 0, 0, 0
       FROM "RevenuePrivateKwOwnerAuthIdempotency"
       WHERE "id" = ? AND "state" = 'COMMITTED'
         AND "recordId" = ? AND "recordDigest" = ?`,
      [
        event.eventId,
        record.idempotencyKey,
        record.recordId,
        record.owner,
        record.operation,
        record.payloadDigest,
        record.recordDigest,
        event.eventDigest,
        eventJson,
        record.idempotencyKey,
        record.recordId,
        record.recordDigest,
      ],
    ),
    statement(
      "read:owner_auth_committed",
      `SELECT "id", "recordVersion", "recordKind", "state", "idempotencyKey",
          "boundaryId", "boundaryDigest", "owner", "operation", "payloadDigest",
          "recordId", "recordDigest", "resultDigest", "resultJson", "reservedAt",
          "committedAt", "recordedAt", "transactionKind", "recordScope",
          "outboxRequired", "mutationAuthorized", "databaseMutationAuthorized",
          "routeAuthorized", "uiMutationAuthorized", "outreachAuthorized", "sendAuthorized",
          "deploymentAuthorized", "providerOperationsAuthorized", "costAuthorizedUsd"
       FROM "RevenuePrivateKwOwnerAuthIdempotency"
       WHERE "id" = ?`,
      [record.idempotencyKey],
    ),
  ] as const;
}

export function buildPrivateKwOwnerAuthIdempotencyD1Plan(
  input: {
    boundaryValue: unknown;
    commitResultValue: unknown;
    plannedAt: string;
  },
): PrivateKwOwnerAuthIdempotencyD1Plan {
  const { boundary, commit } = exactBoundaryAndCommit(
    input.boundaryValue,
    input.commitResultValue,
  );
  if (commit.executionPath !== "FRESH_COMMIT" && commit.executionPath !== "EXACT_REPLAY") {
    throw new Error("Owner-auth D1 planning requires a committed or exact-replay result.");
  }
  const record = commit.record;
  const statements = buildStatements(boundary, record);
  const plan = PlanSchema.parse({
    planVersion: PRIVATE_KW_OWNER_AUTH_IDEMPOTENCY_D1_PLAN_VERSION,
    targetSchemaVersion: PRIVATE_KW_OWNER_AUTH_IDEMPOTENCY_D1_TARGET_SCHEMA_VERSION,
    mode: "SHADOW",
    transactionApi: "INJECTED_D1_BATCH",
    plannedAt: input.plannedAt,
    idempotencyKey: record.idempotencyKey,
    boundaryId: record.boundaryId,
    boundaryDigest: record.boundaryDigest,
    recordId: record.recordId,
    recordDigest: record.recordDigest,
    owner: record.owner,
    operation: record.operation,
    payloadDigest: record.payloadDigest,
    resultDigest: record.resultDigest,
    sessionCreatedAt: boundary.sessionCreatedAt,
    sessionExpiresAt: boundary.sessionExpiresAt,
    mutationGate: {
      statementId: "guard:owner_mutation_claim",
      sqlPredicate: PRIVATE_KW_OWNER_AUTH_MUTATION_CLAIM_EXISTS_PREDICATE,
      bindings: [...digestBindings(record)],
      executableByThisPlan: false,
      mustBeEmbeddedInOperationStatement: true,
      mustShareD1Batch: true,
    },
    statements,
    statementOrder: ["reserve", "reload-reservation", "finalize", "outbox", "reload-committed"],
    requiresOneD1Batch: true,
    requiresDatabaseClock: true,
    requiresAtomicMutationAndOutbox: true,
    replayPath: "COMMITTED_ROW_SKIPS_MUTATION_AND_REPLAYS_RESULT",
    conflictPath: "FAIL_CLOSED",
    runtimeConnected: false,
    migrationApplied: false,
    mutationAuthorized: false,
    ownerDecisionPersistenceAuthorized: false,
    progressReceiptCreationAuthorized: false,
    phaseAdvancementAuthorized: false,
    routeAuthorized: false,
    uiMutationAuthorized: false,
    outreachAuthorized: false,
    sendAuthorized: false,
    deploymentAuthorized: false,
    providerOperationsAuthorized: 0,
    costAuthorizedUsd: 0,
    authority: authority(),
  });
  const trusted = deepFreeze(plan);
  trustedPlans.add(trusted);
  return trusted;
}

export function requireInProcessPrivateKwOwnerAuthIdempotencyD1Plan(
  value: unknown,
): PrivateKwOwnerAuthIdempotencyD1Plan {
  PlanSchema.parse(value);
  if (!value || typeof value !== "object" || !trustedPlans.has(value)) {
    throw new Error("An exact in-process owner-auth D1 plan is required.");
  }
  return value as PrivateKwOwnerAuthIdempotencyD1Plan;
}
