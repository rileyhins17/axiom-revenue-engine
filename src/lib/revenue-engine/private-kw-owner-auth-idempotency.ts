import { z } from "zod";

import {
  artifactReferenceCanonicalJson,
  artifactReferenceDigest,
} from "@/lib/revenue-engine/artifact-reference-projection";
import {
  requireInProcessPrivateKwOwnerAuthServerBoundary,
  type PrivateKwOwnerAuthServerBoundary,
} from "@/lib/revenue-engine/private-kw-owner-auth-server-boundary";

export const PRIVATE_KW_OWNER_AUTH_IDEMPOTENCY_VERSION =
  "kw-owner-auth-idempotency-v1";

const TimestampSchema = z.string().datetime({ offset: true });
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const IdempotencyKeySchema = z.string().regex(
  /^kw-owner-mutation-idempotency:[a-f0-9]{64}$/,
);
const OperationSchema = z.string().trim().regex(/^[a-z][a-z0-9._:-]{2,159}$/);

type JsonValue = null | boolean | number | string | JsonValue[] | {
  [key: string]: JsonValue;
};

const SENSITIVE_RESULT_KEY = /pass(?:word)?|secret|token|cookie|authorization|api[_-]?key|private[_-]?key/i;
const MAX_RESULT_BYTES = 32_768;
const MAX_RESULT_DEPTH = 12;
const MAX_RESULT_COLLECTION_ITEMS = 100;

function safeJsonValue(
  value: unknown,
  depth = 0,
  seen = new WeakSet<object>(),
): JsonValue {
  if (depth > MAX_RESULT_DEPTH) {
    throw new Error("Owner-auth idempotency results are too deeply nested.");
  }
  if (value === null) return null;
  if (typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Owner-auth idempotency results must contain finite numbers.");
    return value;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new Error("Owner-auth idempotency results cannot contain cycles.");
    seen.add(value);
    if (value.length > MAX_RESULT_COLLECTION_ITEMS) {
      throw new Error("Owner-auth idempotency result arrays are too large.");
    }
    const output = value.map((child) => safeJsonValue(child, depth + 1, seen));
    return output;
  }
  if (typeof value === "object") {
    if (seen.has(value)) throw new Error("Owner-auth idempotency results cannot contain cycles.");
    seen.add(value);
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error("Owner-auth idempotency results must be plain JSON objects.");
    }
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length > MAX_RESULT_COLLECTION_ITEMS) {
      throw new Error("Owner-auth idempotency result objects are too large.");
    }
    const output: { [key: string]: JsonValue } = Object.create(null) as { [key: string]: JsonValue };
    for (const [key, child] of entries) {
      if (SENSITIVE_RESULT_KEY.test(key)) {
        throw new Error("Owner-auth idempotency results cannot contain secret-like fields.");
      }
      output[key] = safeJsonValue(child, depth + 1, seen);
    }
    return output;
  }
  throw new Error("Owner-auth idempotency results must be JSON data.");
}

const JsonValueSchema = z.custom<JsonValue>((value) => {
  try {
    safeJsonValue(value);
    return true;
  } catch {
    return false;
  }
}, "Owner-auth idempotency results must be bounded, safe JSON data.");

const IdempotencyAuthoritySchema = z.object({
  validationOnly: z.literal(true),
  atomicStorageRequired: z.literal(true),
  replayReturnsSameResult: z.literal(true),
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

const IdempotencyRecordCoreSchema = z.object({
  recordVersion: z.literal(PRIVATE_KW_OWNER_AUTH_IDEMPOTENCY_VERSION),
  recordKind: z.literal("OWNER_AUTH_MUTATION_IDEMPOTENCY"),
  state: z.literal("COMMITTED"),
  idempotencyKey: IdempotencyKeySchema,
  boundaryId: z.string().regex(/^kw-owner-auth-server-boundary:[a-f0-9]{64}$/),
  boundaryDigest: Sha256Schema,
  owner: z.enum(["RILEY", "AIDAN"]),
  operation: OperationSchema,
  payloadDigest: Sha256Schema,
  result: JsonValueSchema,
  resultDigest: Sha256Schema,
  storedAt: TimestampSchema,
  authority: IdempotencyAuthoritySchema,
}).strict();

export const PrivateKwOwnerAuthIdempotencyRecordSchema = IdempotencyRecordCoreSchema.extend({
  recordId: z.string().regex(/^kw-owner-auth-idempotency:[a-f0-9]{64}$/),
  recordDigest: Sha256Schema,
}).strict().superRefine((record, context) => {
  const {
    recordId: _recordId,
    recordDigest: _recordDigest,
    ...core
  } = record;
  void _recordId;
  void _recordDigest;
  const expectedResultDigest = artifactReferenceDigest(record.result);
  const expectedRecordDigest = artifactReferenceDigest(core);
  if (record.resultDigest !== expectedResultDigest) {
    context.addIssue({
      code: "custom",
      message: "Idempotency result digest must bind the exact safe result.",
      path: ["resultDigest"],
    });
  }
  if (
    record.recordDigest !== expectedRecordDigest
    || record.recordId !== `kw-owner-auth-idempotency:${expectedRecordDigest}`
  ) {
    context.addIssue({
      code: "custom",
      message: "Idempotency record identity must bind its exact content.",
      path: ["recordDigest"],
    });
  }
});

export type PrivateKwOwnerAuthIdempotencyRecord = z.infer<
  typeof PrivateKwOwnerAuthIdempotencyRecordSchema
>;

const CommitResultCoreSchema = z.object({
  executionPath: z.enum(["FRESH_COMMIT", "EXACT_REPLAY"]),
  record: PrivateKwOwnerAuthIdempotencyRecordSchema,
  result: JsonValueSchema,
}).strict();

export const PrivateKwOwnerAuthIdempotencyCommitResultSchema =
  CommitResultCoreSchema.extend({
    resultDigest: Sha256Schema,
  }).strict().superRefine((result, context) => {
    if (result.resultDigest !== artifactReferenceDigest(result.result)) {
      context.addIssue({
        code: "custom",
        message: "Idempotency commit result must preserve the exact result digest.",
        path: ["resultDigest"],
      });
    }
    if (artifactReferenceCanonicalJson(result.result) !== artifactReferenceCanonicalJson(result.record.result)) {
      context.addIssue({
        code: "custom",
        message: "Idempotency commit result must mirror its stored record result.",
        path: ["result"],
      });
    }
  });

export type PrivateKwOwnerAuthIdempotencyCommitResult = z.infer<
  typeof PrivateKwOwnerAuthIdempotencyCommitResultSchema
>;

export type PrivateKwOwnerAuthIdempotencyStore = {
  insertIfAbsent(candidate: PrivateKwOwnerAuthIdempotencyRecord): Promise<{
    inserted: boolean;
    existing: unknown | null;
  }>;
};

const trustedIdempotencyResults = new WeakSet<object>();

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return Object.freeze(value);
}

function serverNow(dependencies: { now?: () => Date }) {
  const value = (dependencies.now ?? (() => new Date()))();
  const milliseconds = value.getTime();
  if (!Number.isFinite(milliseconds)) {
    throw new Error("Owner-auth idempotency time must be a valid server timestamp.");
  }
  return { milliseconds, iso: value.toISOString() };
}

function authority() {
  return IdempotencyAuthoritySchema.parse({
    validationOnly: true,
    atomicStorageRequired: true,
    replayReturnsSameResult: true,
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

function candidateFromBoundary(
  boundary: PrivateKwOwnerAuthServerBoundary,
  resultValue: unknown,
  storedAt: string,
): PrivateKwOwnerAuthIdempotencyRecord {
  const result = safeJsonValue(resultValue);
  const resultJson = artifactReferenceCanonicalJson(result);
  if (resultJson.length > MAX_RESULT_BYTES) {
    throw new Error("Owner-auth idempotency results exceed the bounded JSON limit.");
  }
  const core = IdempotencyRecordCoreSchema.parse({
    recordVersion: PRIVATE_KW_OWNER_AUTH_IDEMPOTENCY_VERSION,
    recordKind: "OWNER_AUTH_MUTATION_IDEMPOTENCY",
    state: "COMMITTED",
    idempotencyKey: boundary.idempotencyKey,
    boundaryId: boundary.boundaryId,
    boundaryDigest: boundary.boundaryDigest,
    owner: boundary.owner,
    operation: boundary.operation,
    payloadDigest: boundary.payloadDigest,
    result,
    resultDigest: artifactReferenceDigest(result),
    storedAt,
    authority: authority(),
  });
  const recordDigest = artifactReferenceDigest(core);
  return deepFreeze(PrivateKwOwnerAuthIdempotencyRecordSchema.parse({
    ...core,
    recordId: `kw-owner-auth-idempotency:${recordDigest}`,
    recordDigest,
  }));
}

function assertSameIntent(
  candidate: PrivateKwOwnerAuthIdempotencyRecord,
  existingValue: unknown,
) {
  const existing = PrivateKwOwnerAuthIdempotencyRecordSchema.parse(existingValue);
  if (
    existing.idempotencyKey !== candidate.idempotencyKey
    || existing.boundaryId !== candidate.boundaryId
    || existing.boundaryDigest !== candidate.boundaryDigest
    || existing.owner !== candidate.owner
    || existing.operation !== candidate.operation
    || existing.payloadDigest !== candidate.payloadDigest
    || existing.resultDigest !== candidate.resultDigest
    || artifactReferenceCanonicalJson(existing.result)
      !== artifactReferenceCanonicalJson(candidate.result)
  ) {
    throw new Error("Owner-auth idempotency key already belongs to a conflicting intent or result.");
  }
  return deepFreeze(existing);
}

function trustedCommitResult(
  executionPath: "FRESH_COMMIT" | "EXACT_REPLAY",
  record: PrivateKwOwnerAuthIdempotencyRecord,
): PrivateKwOwnerAuthIdempotencyCommitResult {
  const trusted = deepFreeze(PrivateKwOwnerAuthIdempotencyCommitResultSchema.parse({
    executionPath,
    record,
    result: record.result,
    resultDigest: record.resultDigest,
  }));
  trustedIdempotencyResults.add(trusted);
  return trusted;
}

export function requireInProcessPrivateKwOwnerAuthIdempotencyCommitResult(
  value: unknown,
): PrivateKwOwnerAuthIdempotencyCommitResult {
  PrivateKwOwnerAuthIdempotencyCommitResultSchema.parse(value);
  if (
    !value
    || typeof value !== "object"
    || !trustedIdempotencyResults.has(value)
  ) {
    throw new Error("An exact in-process owner-auth idempotency result is required.");
  }
  return value as PrivateKwOwnerAuthIdempotencyCommitResult;
}

/**
 * Validates an atomic insert-if-absent/replay protocol without executing the
 * owner mutation. The injected store is a future server adapter seam; this
 * module has no D1, Better Auth, route, provider, or runtime connection.
 */
export async function commitPrivateKwOwnerAuthIdempotency(
  input: {
    boundaryValue: unknown;
    resultValue: unknown;
  },
  store: PrivateKwOwnerAuthIdempotencyStore,
  dependencies: { now?: () => Date } = {},
): Promise<PrivateKwOwnerAuthIdempotencyCommitResult> {
  const boundary = requireInProcessPrivateKwOwnerAuthServerBoundary(input.boundaryValue);
  const { milliseconds: nowMs, iso: storedAt } = serverNow(dependencies);
  if (
    nowMs < Date.parse(boundary.sessionCreatedAt)
    || nowMs >= Date.parse(boundary.sessionExpiresAt)
  ) {
    throw new Error("Owner-auth idempotency requires a current server session window.");
  }
  const candidate = candidateFromBoundary(boundary, input.resultValue, storedAt);
  const outcome = await store.insertIfAbsent(candidate);
  if (outcome.inserted) return trustedCommitResult("FRESH_COMMIT", candidate);
  if (!outcome.existing) {
    throw new Error("Atomic idempotency store reported a replay without its existing result.");
  }
  const existing = assertSameIntent(candidate, outcome.existing);
  return trustedCommitResult("EXACT_REPLAY", existing);
}
