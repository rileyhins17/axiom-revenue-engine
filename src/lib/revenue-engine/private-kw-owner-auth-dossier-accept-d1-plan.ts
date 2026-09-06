import { z } from "zod";

import {
  artifactReferenceCanonicalJson,
  artifactReferenceDigest,
} from "@/lib/revenue-engine/artifact-reference-projection";
import {
  projectPrivateKwAuthenticatedOwnerDecisionStorageRow,
  recheckPrivateKwAuthenticatedOwnerDecisionSessionBinding,
  requireInProcessPrivateKwAuthenticatedOwnerDecisionRecord,
  type PrivateKwAuthenticatedOwnerDecisionRecord,
} from "@/lib/revenue-engine/private-kw-authenticated-owner-decision";
import {
  requireInProcessPrivateKwOwnerAuthIdempotencyCommitResult,
  type PrivateKwOwnerAuthIdempotencyRecord,
} from "@/lib/revenue-engine/private-kw-owner-auth-idempotency";
import {
  buildPrivateKwOwnerAuthOperationClaim,
  PRIVATE_KW_OWNER_AUTH_MUTATION_CLAIM_EXISTS_PREDICATE,
  PRIVATE_KW_OWNER_AUTH_MUTATION_CLAIM_PREDICATE,
  requireInProcessPrivateKwOwnerAuthOperationClaim,
  type PrivateKwOwnerAuthOperationClaim,
} from "@/lib/revenue-engine/private-kw-owner-auth-idempotency-recovery";
import {
  requireInProcessPrivateKwOwnerAuthServerBoundary,
  type PrivateKwOwnerAuthServerBoundary,
} from "@/lib/revenue-engine/private-kw-owner-auth-server-boundary";

export const PRIVATE_KW_OWNER_DOSSIER_ACCEPT_D1_PLAN_VERSION =
  "kw-owner-dossier-accept-d1-plan-v1";
export const PRIVATE_KW_OWNER_DOSSIER_ACCEPT_REQUEST_VERSION =
  "kw-owner-dossier-accept-request-v1";
export const PRIVATE_KW_OWNER_DOSSIER_ACCEPT_RESULT_VERSION =
  "kw-owner-dossier-accept-result-v1";
export const PRIVATE_KW_OWNER_DOSSIER_ACCEPT_OPERATION =
  "owner.dossier.accept";

const TimestampSchema = z.string().datetime({ offset: true }).refine(
  (value) => Number.isFinite(Date.parse(value)),
  "Owner dossier transaction timestamps must resolve to a finite epoch.",
);
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const SqlValueSchema = z.union([z.string(), z.number().finite(), z.null()]);

const RequestPayloadSchema = z.object({
  requestVersion: z.literal(PRIVATE_KW_OWNER_DOSSIER_ACCEPT_REQUEST_VERSION),
  operation: z.literal(PRIVATE_KW_OWNER_DOSSIER_ACCEPT_OPERATION),
  ownerDecisionRecordId: z.string().regex(/^kw-owner-decision:[a-f0-9]{64}$/),
  ownerDecisionRecordDigest: Sha256Schema,
  businessId: z.string().min(1).max(512),
  decision: z.literal("ACCEPTED_FOR_READ_ONLY_SHADOW_PROGRESS"),
}).strict().superRefine((value, context) => {
  if (value.ownerDecisionRecordId !== `kw-owner-decision:${value.ownerDecisionRecordDigest}`) {
    context.addIssue({
      code: "custom",
      message: "Owner dossier request identity must bind the exact decision digest.",
      path: ["ownerDecisionRecordId"],
    });
  }
});

const OperationResultSchema = z.object({
  resultVersion: z.literal(PRIVATE_KW_OWNER_DOSSIER_ACCEPT_RESULT_VERSION),
  outcome: z.literal("OWNER_DECISION_RECORDED"),
  ownerDecisionRecordId: z.string().regex(/^kw-owner-decision:[a-f0-9]{64}$/),
  ownerDecisionRecordDigest: Sha256Schema,
  businessId: z.string().min(1).max(512),
}).strict().superRefine((value, context) => {
  if (value.ownerDecisionRecordId !== `kw-owner-decision:${value.ownerDecisionRecordDigest}`) {
    context.addIssue({
      code: "custom",
      message: "Owner dossier result identity must bind the exact decision digest.",
      path: ["ownerDecisionRecordId"],
    });
  }
});

export type PrivateKwOwnerDossierAcceptRequestPayload = z.infer<
  typeof RequestPayloadSchema
>;
export type PrivateKwOwnerDossierAcceptOperationResult = z.infer<
  typeof OperationResultSchema
>;

export type PrivateKwOwnerDossierAcceptD1Statement = Readonly<{
  statementId: string;
  sql: string;
  bindings: readonly z.infer<typeof SqlValueSchema>[];
  expectedChanges: 0 | 1;
}>;

const StatementSchema = z.object({
  statementId: z.string().regex(/^[a-z][a-z0-9._:-]{2,159}$/),
  sql: z.string().trim().min(1).max(32_000),
  bindings: z.array(SqlValueSchema).max(256),
  expectedChanges: z.union([z.literal(0), z.literal(1)]),
}).strict();

const AuthoritySchema = z.object({
  validationOnly: z.literal(true),
  disposableDatabaseOnly: z.literal(true),
  exactOwnerDecisionTargetRequired: z.literal(true),
  exactCurrentSessionRecheckRequired: z.literal(true),
  regularInsertConflictMustAbort: z.literal(true),
  missingCommitMustAbortOutboxInsert: z.literal(true),
  exactReplayMustBeReadOnly: z.literal(true),
  oneD1BatchRequired: z.literal(true),
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

const OperationClaimSchema = z.custom<PrivateKwOwnerAuthOperationClaim>(
  (value) => {
    try {
      requireInProcessPrivateKwOwnerAuthOperationClaim(value);
      return true;
    } catch {
      return false;
    }
  },
  "The concrete owner action requires its exact in-process reservation claim.",
);

const PlanCoreSchema = z.object({
  planVersion: z.literal(PRIVATE_KW_OWNER_DOSSIER_ACCEPT_D1_PLAN_VERSION),
  mode: z.literal("SHADOW"),
  targetSchemaVersions: z.tuple([
    z.literal("0069_authenticated_owner_dossier_decisions"),
    z.literal("0070_owner_auth_idempotency_outbox"),
  ]),
  operation: z.literal(PRIVATE_KW_OWNER_DOSSIER_ACCEPT_OPERATION),
  plannedAt: TimestampSchema,
  owner: z.enum(["RILEY", "AIDAN"]),
  businessId: z.string().min(1).max(512),
  ownerDecisionRecordId: z.string().regex(/^kw-owner-decision:[a-f0-9]{64}$/),
  ownerDecisionRecordDigest: Sha256Schema,
  idempotencyKey: z.string().regex(/^kw-owner-mutation-idempotency:[a-f0-9]{64}$/),
  idempotencyRecordId: z.string().regex(/^kw-owner-auth-idempotency:[a-f0-9]{64}$/),
  idempotencyRecordDigest: Sha256Schema,
  boundaryId: z.string().regex(/^kw-owner-auth-server-boundary:[a-f0-9]{64}$/),
  boundaryDigest: Sha256Schema,
  payloadDigest: Sha256Schema,
  resultDigest: Sha256Schema,
  outboxEventId: z.string().regex(/^kw-owner-auth-outbox:[a-f0-9]{64}$/),
  outboxEventDigest: Sha256Schema,
  operationClaim: OperationClaimSchema,
  preflightStatements: z.array(StatementSchema).length(5),
  freshBatchStatements: z.array(StatementSchema).length(8),
  replayStatements: z.array(StatementSchema).length(5),
  freshBatchOrder: z.tuple([
    z.literal("reserve:owner_auth_idempotency"),
    z.literal("mutation:owner_auth_operation"),
    z.literal("finalize:owner_auth_idempotency"),
    z.literal("insert:owner_auth_outbox"),
    z.literal("read:owner_auth_committed"),
    z.literal("read:authenticated_owner_decision"),
    z.literal("read:owner_auth_outbox"),
    z.literal("read:owner_auth_database_time"),
  ]),
  expectedFreshChanges: z.object({
    reservation: z.literal(1),
    ownerDecision: z.literal(1),
    finalization: z.literal(1),
    outbox: z.literal(1),
  }).strict(),
  expectedReplayChanges: z.object({
    reservation: z.literal(0),
    ownerDecision: z.literal(0),
    finalization: z.literal(0),
    outbox: z.literal(0),
  }).strict(),
  transactionFailureBehavior: z.literal("ANY_STATEMENT_ERROR_ROLLS_BACK_WHOLE_D1_BATCH"),
  replayBehavior: z.literal("READ_EXACT_COMMITTED_BUNDLE_WITHOUT_MUTATION"),
  runtimeConnected: z.literal(false),
  migrationApplied: z.literal(false),
  authority: AuthoritySchema,
}).strict();

const PlanSchema = PlanCoreSchema.extend({
  planId: z.string().regex(/^kw-owner-dossier-accept-d1-plan:[a-f0-9]{64}$/),
  planDigest: Sha256Schema,
}).strict().superRefine((plan, context) => {
  const { planId: _planId, planDigest: _planDigest, ...core } = plan;
  void _planId;
  void _planDigest;
  const expectedPlanDigest = artifactReferenceDigest(core);
  if (
    plan.planDigest !== expectedPlanDigest
    || plan.planId !== `kw-owner-dossier-accept-d1-plan:${expectedPlanDigest}`
  ) {
    context.addIssue({
      code: "custom",
      message: "Concrete owner transaction plan identity must bind its exact content.",
      path: ["planDigest"],
    });
  }
  if (
    plan.ownerDecisionRecordId !== `kw-owner-decision:${plan.ownerDecisionRecordDigest}`
    || plan.outboxEventId !== `kw-owner-auth-outbox:${plan.outboxEventDigest}`
  ) {
    context.addIssue({
      code: "custom",
      message: "Concrete owner transaction identities must bind their exact digests.",
      path: ["ownerDecisionRecordId"],
    });
  }
  if (
    artifactReferenceCanonicalJson(plan.freshBatchStatements.map((item) => item.statementId))
      !== artifactReferenceCanonicalJson(plan.freshBatchOrder)
  ) {
    context.addIssue({
      code: "custom",
      message: "Concrete owner transaction statement order drifted.",
      path: ["freshBatchOrder"],
    });
  }
});

export type PrivateKwOwnerDossierAcceptD1Plan = z.infer<typeof PlanSchema>;

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
  expectedChanges: 0 | 1 = 0,
): PrivateKwOwnerDossierAcceptD1Statement {
  return StatementSchema.parse({ statementId, sql, bindings, expectedChanges });
}

export function buildPrivateKwOwnerDossierAcceptRequestPayload(
  recordValue: unknown,
): PrivateKwOwnerDossierAcceptRequestPayload {
  const record = requireInProcessPrivateKwAuthenticatedOwnerDecisionRecord(recordValue);
  return deepFreeze(RequestPayloadSchema.parse({
    requestVersion: PRIVATE_KW_OWNER_DOSSIER_ACCEPT_REQUEST_VERSION,
    operation: PRIVATE_KW_OWNER_DOSSIER_ACCEPT_OPERATION,
    ownerDecisionRecordId: record.recordId,
    ownerDecisionRecordDigest: record.recordDigest,
    businessId: record.businessId,
    decision: record.decision.decision,
  }));
}

export function buildPrivateKwOwnerDossierAcceptOperationResult(
  recordValue: unknown,
): PrivateKwOwnerDossierAcceptOperationResult {
  const record = requireInProcessPrivateKwAuthenticatedOwnerDecisionRecord(recordValue);
  return deepFreeze(OperationResultSchema.parse({
    resultVersion: PRIVATE_KW_OWNER_DOSSIER_ACCEPT_RESULT_VERSION,
    outcome: "OWNER_DECISION_RECORDED",
    ownerDecisionRecordId: record.recordId,
    ownerDecisionRecordDigest: record.recordDigest,
    businessId: record.businessId,
  }));
}

const REQUIRED_TRIGGER_MARKERS = {
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
  RevenuePrivateKwOwnerAuthIdempotency_contract_insert: {
    operation: "INSERT",
    marker: "REVENUE_PRIVATE_KW_OWNER_AUTH_IDEMPOTENCY_CONTRACT_MISMATCH",
  },
  RevenuePrivateKwOwnerAuthIdempotency_transition_update: {
    operation: "UPDATE",
    marker: "REVENUE_PRIVATE_KW_OWNER_AUTH_IDEMPOTENCY_INVALID_TRANSITION",
  },
  RevenuePrivateKwOwnerAuthIdempotency_immutable_delete: {
    operation: "DELETE",
    marker: "REVENUE_PRIVATE_KW_OWNER_AUTH_IDEMPOTENCY_APPEND_ONLY",
  },
  RevenuePrivateKwOwnerAuthMutationOutbox_contract_insert: {
    operation: "INSERT",
    marker: "REVENUE_PRIVATE_KW_OWNER_AUTH_OUTBOX_CONTRACT_MISMATCH",
  },
  RevenuePrivateKwOwnerAuthMutationOutbox_delivery_update: {
    operation: "UPDATE",
    marker: "REVENUE_PRIVATE_KW_OWNER_AUTH_OUTBOX_INVALID_TRANSITION",
  },
  RevenuePrivateKwOwnerAuthMutationOutbox_immutable_delete: {
    operation: "DELETE",
    marker: "REVENUE_PRIVATE_KW_OWNER_AUTH_OUTBOX_APPEND_ONLY",
  },
} as const;

const TRIGGER_NAMES = Object.keys(REQUIRED_TRIGGER_MARKERS);
const TRIGGER_GUARD_PREDICATE = TRIGGER_NAMES.map(() => `EXISTS (
       SELECT 1 FROM "sqlite_master"
       WHERE "type" = 'trigger' AND "name" = ?
         AND instr("sql", ?) > 0 AND instr("sql", ?) > 0
     )`).join(" AND ");
const TRIGGER_GUARD_BINDINGS = Object.entries(REQUIRED_TRIGGER_MARKERS)
  .flatMap(([name, requirement]) => [
    name,
    `BEFORE ${requirement.operation} ON "${name.startsWith("RevenuePrivateKwOwnerDecision_") ? "RevenuePrivateKwOwnerDecision" : name.startsWith("RevenuePrivateKwOwnerAuthIdempotency_") ? "RevenuePrivateKwOwnerAuthIdempotency" : "RevenuePrivateKwOwnerAuthMutationOutbox"}"`,
    `RAISE(ABORT, '${requirement.marker}')`,
  ]);

const IDEMPOTENCY_COLUMNS = [
  "id", "recordVersion", "recordKind", "state", "idempotencyKey",
  "boundaryId", "boundaryDigest", "owner", "operation", "payloadDigest",
  "recordId", "recordDigest", "resultDigest", "resultJson", "reservedAt",
  "committedAt", "recordedAt", "transactionKind", "recordScope",
  "outboxRequired", "mutationAuthorized", "databaseMutationAuthorized",
  "routeAuthorized", "uiMutationAuthorized", "outreachAuthorized",
  "sendAuthorized", "deploymentAuthorized", "providerOperationsAuthorized",
  "costAuthorizedUsd",
] as const;

const OUTBOX_COLUMNS = [
  "id", "outboxVersion", "eventKind", "idempotencyKey", "recordId",
  "owner", "operation", "payloadDigest", "recordDigest", "eventDigest",
  "eventJson", "deliveryState", "attemptCount", "createdAt", "lastAttemptAt",
  "deliveredAt", "deliveryAuthorized", "providerOperationsAuthorized",
  "costAuthorizedUsd",
] as const;

function selectColumns(columns: readonly string[]) {
  return columns.map((column) => `"${column}"`).join(", ");
}

function committedEvent(record: PrivateKwOwnerAuthIdempotencyRecord) {
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
  return deepFreeze({
    ...core,
    eventId: `kw-owner-auth-outbox:${eventDigest}`,
    eventDigest,
  });
}

function selectIdempotency(record: PrivateKwOwnerAuthIdempotencyRecord) {
  return statement(
    "read:owner_auth_committed",
    `SELECT ${selectColumns(IDEMPOTENCY_COLUMNS)}
     FROM "RevenuePrivateKwOwnerAuthIdempotency"
     WHERE "id" = ?`,
    [record.idempotencyKey],
  );
}

function selectOwnerDecision(record: PrivateKwAuthenticatedOwnerDecisionRecord) {
  return statement(
    "read:authenticated_owner_decision",
    `SELECT * FROM "RevenuePrivateKwOwnerDecision"
     WHERE "id" = ? AND "decisionDigest" = ?`,
    [record.recordId, record.recordDigest],
  );
}

function selectOutbox(
  record: PrivateKwOwnerAuthIdempotencyRecord,
  eventId: string,
) {
  return statement(
    "read:owner_auth_outbox",
    `SELECT ${selectColumns(OUTBOX_COLUMNS)}
     FROM "RevenuePrivateKwOwnerAuthMutationOutbox"
     WHERE "id" = ? AND "idempotencyKey" = ? AND "recordId" = ?`,
    [eventId, record.idempotencyKey, record.recordId],
  );
}

const readDatabaseTime = () => statement(
  "read:owner_auth_database_time",
  `SELECT strftime('%Y-%m-%dT%H:%M:%fZ', 'now') AS "databaseNow"`,
);

const readTriggerGuards = () => statement(
  "read:owner_auth_transaction_guards",
  `SELECT "name", "sql" FROM "sqlite_master"
   WHERE "type" = 'trigger' AND "name" IN (${TRIGGER_NAMES.map(() => "?").join(", ")})
   ORDER BY "name"`,
  TRIGGER_NAMES,
);

function assertExactPair(input: {
  boundary: PrivateKwOwnerAuthServerBoundary;
  idempotencyRecord: PrivateKwOwnerAuthIdempotencyRecord;
  decisionRecord: PrivateKwAuthenticatedOwnerDecisionRecord;
  result: PrivateKwOwnerDossierAcceptOperationResult;
  request: PrivateKwOwnerDossierAcceptRequestPayload;
  sessionRecheck: ReturnType<typeof recheckPrivateKwAuthenticatedOwnerDecisionSessionBinding>;
}) {
  const { boundary, idempotencyRecord, decisionRecord, result, request, sessionRecheck } = input;
  if (
    boundary.operation !== PRIVATE_KW_OWNER_DOSSIER_ACCEPT_OPERATION
    || boundary.owner !== decisionRecord.decision.decidedBy
    || boundary.owner !== sessionRecheck.authenticatedOwner
    || boundary.sessionCreatedAt !== sessionRecheck.sessionCreatedAt
    || boundary.sessionExpiresAt !== sessionRecheck.sessionExpiresAt
    || boundary.sessionExpiresAt !== decisionRecord.authentication.sessionExpiresAt
    || boundary.payloadDigest !== artifactReferenceDigest(request)
    || idempotencyRecord.idempotencyKey !== boundary.idempotencyKey
    || idempotencyRecord.boundaryId !== boundary.boundaryId
    || idempotencyRecord.boundaryDigest !== boundary.boundaryDigest
    || idempotencyRecord.owner !== boundary.owner
    || idempotencyRecord.operation !== boundary.operation
    || idempotencyRecord.payloadDigest !== boundary.payloadDigest
    || idempotencyRecord.resultDigest !== artifactReferenceDigest(result)
    || artifactReferenceCanonicalJson(idempotencyRecord.result)
      !== artifactReferenceCanonicalJson(result)
    || Date.parse(decisionRecord.preparedAt) < Date.parse(boundary.sessionCreatedAt)
    || Date.parse(decisionRecord.preparedAt) >= Date.parse(boundary.sessionExpiresAt)
  ) {
    throw new Error(
      "The concrete owner dossier transaction requires one exact boundary, session, decision, request, and idempotency result.",
    );
  }
}

function authority() {
  return AuthoritySchema.parse({
    validationOnly: true,
    disposableDatabaseOnly: true,
    exactOwnerDecisionTargetRequired: true,
    exactCurrentSessionRecheckRequired: true,
    regularInsertConflictMustAbort: true,
    missingCommitMustAbortOutboxInsert: true,
    exactReplayMustBeReadOnly: true,
    oneD1BatchRequired: true,
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

export function buildPrivateKwOwnerDossierAcceptD1Plan(input: {
  boundaryValue: unknown;
  idempotencyCommitResultValue: unknown;
  ownerDecisionRecordValue: unknown;
  currentSessionValue: unknown;
  bindingKey: Uint8Array;
  bindingKeyVersion: string;
  plannedAt: string;
}): PrivateKwOwnerDossierAcceptD1Plan {
  const boundary = requireInProcessPrivateKwOwnerAuthServerBoundary(input.boundaryValue);
  const commit = requireInProcessPrivateKwOwnerAuthIdempotencyCommitResult(
    input.idempotencyCommitResultValue,
  );
  const decisionRecord = requireInProcessPrivateKwAuthenticatedOwnerDecisionRecord(
    input.ownerDecisionRecordValue,
  );
  const sessionRecheck = recheckPrivateKwAuthenticatedOwnerDecisionSessionBinding(
    decisionRecord,
    input.currentSessionValue,
    { bindingKey: input.bindingKey, bindingKeyVersion: input.bindingKeyVersion },
  );
  const plannedAt = TimestampSchema.parse(input.plannedAt);
  if (
    Date.parse(plannedAt) < Date.parse(boundary.sessionCreatedAt)
    || Date.parse(plannedAt) >= Date.parse(boundary.sessionExpiresAt)
  ) {
    throw new Error("The concrete owner dossier transaction must be planned inside the current owner session.");
  }
  const request = buildPrivateKwOwnerDossierAcceptRequestPayload(decisionRecord);
  const result = buildPrivateKwOwnerDossierAcceptOperationResult(decisionRecord);
  assertExactPair({
    boundary,
    idempotencyRecord: commit.record,
    decisionRecord,
    result,
    request,
    sessionRecheck,
  });

  const decisionValues = projectPrivateKwAuthenticatedOwnerDecisionStorageRow(decisionRecord);
  const decisionColumns = Object.keys(decisionValues);
  const claimPredicate = PRIVATE_KW_OWNER_AUTH_MUTATION_CLAIM_PREDICATE;
  const claimExistsPredicate =
    PRIVATE_KW_OWNER_AUTH_MUTATION_CLAIM_EXISTS_PREDICATE;
  const claimBindings = [
    boundary.idempotencyKey,
    boundary.boundaryDigest,
    boundary.owner,
    boundary.operation,
    boundary.payloadDigest,
  ] as const;
  const operationSql = `INSERT INTO "RevenuePrivateKwOwnerDecision"
    (${decisionColumns.map((column) => `"${column}"`).join(", ")}, "recordedAt", "transactionKind")
   SELECT ${decisionColumns.map(() => "?").join(", ")},
     strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'D1_BATCH'
   WHERE ${claimExistsPredicate}
     AND julianday('now') >= julianday(?)
     AND julianday('now') < julianday(?)
     AND ${TRIGGER_GUARD_PREDICATE}`;
  const operationClaim = buildPrivateKwOwnerAuthOperationClaim({
    boundaryValue: boundary,
    mutationKind: "INSERT",
    targetTable: "RevenuePrivateKwOwnerDecision",
    sql: operationSql,
  });
  const idempotencyRecord = commit.record;
  const idempotencyJson = artifactReferenceCanonicalJson(idempotencyRecord);
  const event = committedEvent(idempotencyRecord);
  const eventJson = artifactReferenceCanonicalJson(event);

  const reservationValues = [
    idempotencyRecord.idempotencyKey,
    idempotencyRecord.recordVersion,
    idempotencyRecord.recordKind,
    "RESERVED",
    idempotencyRecord.idempotencyKey,
    idempotencyRecord.boundaryId,
    idempotencyRecord.boundaryDigest,
    idempotencyRecord.owner,
    idempotencyRecord.operation,
    idempotencyRecord.payloadDigest,
  ];
  const freshBatchStatements = [
    statement(
      "reserve:owner_auth_idempotency",
      `INSERT INTO "RevenuePrivateKwOwnerAuthIdempotency"
        ("id", "recordVersion", "recordKind", "state", "idempotencyKey",
         "boundaryId", "boundaryDigest", "owner", "operation", "payloadDigest",
         "resultJson", "reservedAt", "transactionKind", "recordScope",
         "outboxRequired", "mutationAuthorized", "databaseMutationAuthorized",
         "routeAuthorized", "uiMutationAuthorized", "outreachAuthorized",
         "sendAuthorized", "deploymentAuthorized", "providerOperationsAuthorized",
         "costAuthorizedUsd")
       SELECT ${reservationValues.map(() => "?").join(", ")}, NULL,
         strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'D1_BATCH',
         'OWNER_AUTH_MUTATION_IDEMPOTENCY_ONLY', 1, 0, 0, 0, 0, 0, 0, 0, 0, 0
       WHERE julianday('now') >= julianday(?)
         AND julianday('now') < julianday(?)
         AND ${TRIGGER_GUARD_PREDICATE}`,
      [
        ...reservationValues,
        boundary.sessionCreatedAt,
        boundary.sessionExpiresAt,
        ...TRIGGER_GUARD_BINDINGS,
      ],
      1,
    ),
    statement(
      "mutation:owner_auth_operation",
      operationSql,
      [
        ...Object.values(decisionValues),
        ...claimBindings,
        boundary.sessionCreatedAt,
        boundary.sessionExpiresAt,
        ...TRIGGER_GUARD_BINDINGS,
      ],
      1,
    ),
    statement(
      "finalize:owner_auth_idempotency",
      `UPDATE "RevenuePrivateKwOwnerAuthIdempotency"
       SET "state" = CASE WHEN changes() = 1 THEN 'COMMITTED' ELSE NULL END,
           "recordId" = ?, "recordDigest" = ?,
           "resultDigest" = ?, "resultJson" = ?,
           "committedAt" = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
           "recordedAt" = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE ${claimPredicate}
         AND EXISTS (
           SELECT 1 FROM "RevenuePrivateKwOwnerDecision"
           WHERE "id" = ? AND "decisionDigest" = ? AND "businessId" = ?
             AND "decisionJson" = ?
         )
         AND julianday('now') >= julianday(?)
         AND julianday('now') < julianday(?)`,
      [
        idempotencyRecord.recordId,
        idempotencyRecord.recordDigest,
        idempotencyRecord.resultDigest,
        idempotencyJson,
        ...claimBindings,
        decisionRecord.recordId,
        decisionRecord.recordDigest,
        decisionRecord.businessId,
        artifactReferenceCanonicalJson(decisionRecord),
        boundary.sessionCreatedAt,
        boundary.sessionExpiresAt,
      ],
      1,
    ),
    statement(
      "insert:owner_auth_outbox",
      `INSERT INTO "RevenuePrivateKwOwnerAuthMutationOutbox"
        ("id", "outboxVersion", "eventKind", "idempotencyKey", "recordId",
         "owner", "operation", "payloadDigest", "recordDigest", "eventDigest",
         "eventJson", "deliveryState", "attemptCount", "createdAt",
         "deliveryAuthorized", "providerOperationsAuthorized", "costAuthorizedUsd")
       VALUES (?, 'kw-owner-auth-outbox-v1', 'OWNER_AUTH_MUTATION_COMMITTED', ?,
         (SELECT "recordId" FROM "RevenuePrivateKwOwnerAuthIdempotency"
          WHERE "id" = ? AND "state" = 'COMMITTED' AND "recordId" = ?
            AND "recordDigest" = ?),
         ?, ?, ?, ?, ?, ?, 'PENDING', 0,
         strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 0, 0, 0)`,
      [
        event.eventId,
        idempotencyRecord.idempotencyKey,
        idempotencyRecord.idempotencyKey,
        idempotencyRecord.recordId,
        idempotencyRecord.recordDigest,
        idempotencyRecord.owner,
        idempotencyRecord.operation,
        idempotencyRecord.payloadDigest,
        idempotencyRecord.recordDigest,
        event.eventDigest,
        eventJson,
      ],
      1,
    ),
    selectIdempotency(idempotencyRecord),
    selectOwnerDecision(decisionRecord),
    selectOutbox(idempotencyRecord, event.eventId),
    readDatabaseTime(),
  ] as const;

  const replayStatements = [
    readTriggerGuards(),
    selectIdempotency(idempotencyRecord),
    selectOwnerDecision(decisionRecord),
    selectOutbox(idempotencyRecord, event.eventId),
    readDatabaseTime(),
  ] as const;
  const preflightStatements = replayStatements;

  const core = PlanCoreSchema.parse({
    planVersion: PRIVATE_KW_OWNER_DOSSIER_ACCEPT_D1_PLAN_VERSION,
    mode: "SHADOW",
    targetSchemaVersions: [
      "0069_authenticated_owner_dossier_decisions",
      "0070_owner_auth_idempotency_outbox",
    ],
    operation: PRIVATE_KW_OWNER_DOSSIER_ACCEPT_OPERATION,
    plannedAt,
    owner: boundary.owner,
    businessId: decisionRecord.businessId,
    ownerDecisionRecordId: decisionRecord.recordId,
    ownerDecisionRecordDigest: decisionRecord.recordDigest,
    idempotencyKey: idempotencyRecord.idempotencyKey,
    idempotencyRecordId: idempotencyRecord.recordId,
    idempotencyRecordDigest: idempotencyRecord.recordDigest,
    boundaryId: boundary.boundaryId,
    boundaryDigest: boundary.boundaryDigest,
    payloadDigest: boundary.payloadDigest,
    resultDigest: idempotencyRecord.resultDigest,
    outboxEventId: event.eventId,
    outboxEventDigest: event.eventDigest,
    operationClaim,
    preflightStatements,
    freshBatchStatements,
    replayStatements,
    freshBatchOrder: freshBatchStatements.map((item) => item.statementId),
    expectedFreshChanges: {
      reservation: 1,
      ownerDecision: 1,
      finalization: 1,
      outbox: 1,
    },
    expectedReplayChanges: {
      reservation: 0,
      ownerDecision: 0,
      finalization: 0,
      outbox: 0,
    },
    transactionFailureBehavior: "ANY_STATEMENT_ERROR_ROLLS_BACK_WHOLE_D1_BATCH",
    replayBehavior: "READ_EXACT_COMMITTED_BUNDLE_WITHOUT_MUTATION",
    runtimeConnected: false,
    migrationApplied: false,
    authority: authority(),
  });
  const planDigest = artifactReferenceDigest(core);
  const parsed = PlanSchema.parse({
    ...core,
    planId: `kw-owner-dossier-accept-d1-plan:${planDigest}`,
    planDigest,
  });
  const plan = deepFreeze(parsed);
  trustedPlans.add(plan);
  return plan;
}

export function requireInProcessPrivateKwOwnerDossierAcceptD1Plan(
  value: unknown,
): PrivateKwOwnerDossierAcceptD1Plan {
  PlanSchema.parse(value);
  if (!value || typeof value !== "object" || !trustedPlans.has(value)) {
    throw new Error("An exact in-process owner dossier D1 transaction plan is required.");
  }
  requireInProcessPrivateKwOwnerAuthOperationClaim(
    (value as PrivateKwOwnerDossierAcceptD1Plan).operationClaim,
  );
  return value as PrivateKwOwnerDossierAcceptD1Plan;
}
