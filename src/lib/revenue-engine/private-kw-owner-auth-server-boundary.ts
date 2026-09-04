import { z } from "zod";

import {
  artifactReferenceDigest,
} from "@/lib/revenue-engine/artifact-reference-projection";
import {
  PrivateKwAuthenticatedOwnerSessionSchema,
  type PrivateKwAuthenticatedOwnerSession,
} from "@/lib/revenue-engine/private-kw-authenticated-owner-decision";
import {
  requireInProcessPrivateKwOwnerAuthReadiness,
  type PrivateKwOwnerAuthReadiness,
} from "@/lib/revenue-engine/private-kw-owner-auth-readiness";

export const PRIVATE_KW_OWNER_AUTH_SERVER_BOUNDARY_VERSION =
  "kw-owner-auth-server-boundary-v1";

const TimestampSchema = z.string().datetime({ offset: true });
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const OriginSchema = z.string().url().refine((value) => {
  const parsed = new URL(value);
  return parsed.origin === value && parsed.username === "" && parsed.password === "";
}, "Request origins must be exact origins without credentials, paths, or fragments.");
const OperationSchema = z.string().trim().regex(
  /^[a-z][a-z0-9._:-]{2,159}$/,
  "Mutation operations must use a stable lowercase identifier.",
);
const MethodSchema = z.enum(["POST", "PUT", "PATCH", "DELETE"]);

const OwnerAuthRequestSchema = z.object({
  method: MethodSchema,
  origin: OriginSchema,
  headers: z.record(z.string(), z.string()),
  // The body is intentionally carried as opaque input and is never consulted
  // for identity, session, owner, or authorization data.
  body: z.unknown(),
}).strict();

const BoundaryAuthoritySchema = z.object({
  validationOnly: z.literal(true),
  policySatisfied: z.literal(true),
  currentVerifiedOwnerSessionRequired: z.literal(true),
  serverOnlySessionLookup: z.literal(true),
  requestBodySessionFieldsIgnored: z.literal(true),
  csrfAndFetchMetadataValidated: z.literal(true),
  idempotencyValidated: z.literal(true),
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

const BoundaryCoreSchema = z.object({
  boundaryVersion: z.literal(PRIVATE_KW_OWNER_AUTH_SERVER_BOUNDARY_VERSION),
  boundaryKind: z.literal("OWNER_AUTH_SERVER_REQUEST"),
  state: z.literal("VALIDATED_NOT_ACTIVATED"),
  readinessId: z.string().regex(/^kw-owner-auth-readiness:[a-f0-9]{64}$/),
  readinessDigest: Sha256Schema,
  environment: z.enum(["STAGING", "PRODUCTION"]),
  owner: z.enum(["RILEY", "AIDAN"]),
  verifiedEmail: z.literal(true),
  sessionCreatedAt: TimestampSchema,
  sessionExpiresAt: TimestampSchema,
  request: z.object({
    method: MethodSchema,
    origin: OriginSchema,
    originHeader: OriginSchema,
    fetchSite: z.literal("same-origin"),
    fetchMode: z.literal("cors"),
    fetchDestination: z.literal("empty"),
    requestBodySessionFieldsIgnored: z.literal(true),
  }).strict(),
  operation: OperationSchema,
  payloadDigest: Sha256Schema,
  idempotencyKey: z.string().regex(/^kw-owner-mutation-idempotency:[a-f0-9]{64}$/),
  authority: BoundaryAuthoritySchema,
}).strict();

export const PrivateKwOwnerAuthServerBoundarySchema = BoundaryCoreSchema.extend({
  boundaryId: z.string().regex(/^kw-owner-auth-server-boundary:[a-f0-9]{64}$/),
  boundaryDigest: Sha256Schema,
}).strict().superRefine((boundary, context) => {
  const {
    boundaryId: _boundaryId,
    boundaryDigest: _boundaryDigest,
    ...core
  } = boundary;
  void _boundaryId;
  void _boundaryDigest;
  const expectedDigest = artifactReferenceDigest(core);
  if (
    boundary.boundaryDigest !== expectedDigest
    || boundary.boundaryId !== `kw-owner-auth-server-boundary:${expectedDigest}`
  ) {
    context.addIssue({
      code: "custom",
      message: "Owner-auth server boundary identity must bind its exact content.",
      path: ["boundaryDigest"],
    });
  }
  if (boundary.request.origin !== boundary.request.originHeader) {
    context.addIssue({
      code: "custom",
      message: "The request Origin header must match the exact request origin.",
      path: ["request", "originHeader"],
    });
  }
});

export type PrivateKwOwnerAuthServerBoundary = z.infer<
  typeof PrivateKwOwnerAuthServerBoundarySchema
>;

const trustedOwnerAuthServerBoundaries = new WeakSet<object>();

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return Object.freeze(value);
}

function validNow(dependencies: { now?: () => Date }) {
  const value = (dependencies.now ?? (() => new Date()))();
  const milliseconds = value.getTime();
  if (!Number.isFinite(milliseconds)) {
    throw new Error("Owner-auth server boundary time must be a valid server timestamp.");
  }
  return { milliseconds };
}

function ownerForSession(session: PrivateKwAuthenticatedOwnerSession) {
  if (session.authenticatedEmail === "riley@getaxiom.ca") return "RILEY" as const;
  if (session.authenticatedEmail === "aidan@getaxiom.ca") return "AIDAN" as const;
  throw new Error("The server session email is not an authorized Axiom owner.");
}

function normalizedHeaders(headers: Record<string, string>) {
  const normalized = new Map<string, string>();
  for (const [rawName, rawValue] of Object.entries(headers)) {
    const name = rawName.trim().toLowerCase();
    if (!name || normalized.has(name)) {
      throw new Error("Owner-auth request headers must have unique, non-empty names.");
    }
    normalized.set(name, rawValue.trim());
  }
  return normalized;
}

function requireCsrfAndFetchMetadata(
  request: z.infer<typeof OwnerAuthRequestSchema>,
  readiness: PrivateKwOwnerAuthReadiness,
) {
  if (!readiness.trustedOrigins.includes(request.origin)) {
    throw new Error("The request origin is not in the exact owner-auth trusted-origin set.");
  }
  const headers = normalizedHeaders(request.headers);
  const originHeader = headers.get("origin");
  const fetchSite = headers.get("sec-fetch-site");
  const fetchMode = headers.get("sec-fetch-mode");
  const fetchDestination = headers.get("sec-fetch-dest");
  if (
    originHeader !== request.origin
    || fetchSite !== "same-origin"
    || fetchMode !== "cors"
    || fetchDestination !== "empty"
  ) {
    throw new Error(
      "Owner-auth mutations require an exact Origin and same-origin Fetch Metadata headers.",
    );
  }
  return { originHeader, fetchSite, fetchMode, fetchDestination } as const;
}

function payloadDigest(payload: unknown) {
  try {
    return artifactReferenceDigest(payload);
  } catch {
    throw new Error("Owner-auth mutation payload must be canonical JSON data.");
  }
}

function expectedIdempotencyKey(input: {
  owner: "RILEY" | "AIDAN";
  operation: string;
  payloadDigest: string;
}) {
  return `kw-owner-mutation-idempotency:${artifactReferenceDigest({
    boundaryVersion: PRIVATE_KW_OWNER_AUTH_SERVER_BOUNDARY_VERSION,
    owner: input.owner,
    operation: input.operation,
    payloadDigest: input.payloadDigest,
  })}`;
}

function authority() {
  return BoundaryAuthoritySchema.parse({
    validationOnly: true,
    policySatisfied: true,
    currentVerifiedOwnerSessionRequired: true,
    serverOnlySessionLookup: true,
    requestBodySessionFieldsIgnored: true,
    csrfAndFetchMetadataValidated: true,
    idempotencyValidated: true,
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

export function requireInProcessPrivateKwOwnerAuthServerBoundary(
  value: unknown,
): PrivateKwOwnerAuthServerBoundary {
  PrivateKwOwnerAuthServerBoundarySchema.parse(value);
  if (
    !value
    || typeof value !== "object"
    || !trustedOwnerAuthServerBoundaries.has(value)
  ) {
    throw new Error("An exact in-process owner-auth server boundary result is required.");
  }
  return value as PrivateKwOwnerAuthServerBoundary;
}

/**
 * Validates the future server-only owner mutation boundary. A live adapter may
 * pass a Better Auth session obtained on the server, but this module does not
 * call Better Auth, inspect a request body for identity, persist idempotency,
 * mutate a database, or authorize any operation.
 */
export function buildPrivateKwOwnerAuthServerBoundary(
  input: {
    readinessValue: unknown;
    serverSessionValue: unknown;
    request: unknown;
    operation: unknown;
    payload: unknown;
    idempotencyKey: unknown;
  },
  dependencies: { now?: () => Date } = {},
): PrivateKwOwnerAuthServerBoundary {
  const readiness = requireInProcessPrivateKwOwnerAuthReadiness(input.readinessValue);
  const request = OwnerAuthRequestSchema.parse(input.request);
  const operation = OperationSchema.parse(input.operation);
  const idempotencyKey = z.string().parse(input.idempotencyKey);
  const session = PrivateKwAuthenticatedOwnerSessionSchema.parse(input.serverSessionValue);
  const owner = ownerForSession(session);
  const { milliseconds: nowMs } = validNow(dependencies);
  const createdMs = Date.parse(session.sessionCreatedAt);
  const expiresMs = Date.parse(session.sessionExpiresAt);
  if (
    !Number.isFinite(createdMs)
    || !Number.isFinite(expiresMs)
    || expiresMs <= createdMs
    || nowMs < createdMs
    || nowMs >= expiresMs
  ) {
    throw new Error("The server-provided verified owner session must be current.");
  }
  const csrf = requireCsrfAndFetchMetadata(request, readiness);
  const digest = payloadDigest(input.payload);
  const expectedKey = expectedIdempotencyKey({
    owner,
    operation,
    payloadDigest: digest,
  });
  if (idempotencyKey !== expectedKey) {
    throw new Error("Owner-auth mutation idempotency key does not match its actor, operation, and payload.");
  }
  const core = BoundaryCoreSchema.parse({
    boundaryVersion: PRIVATE_KW_OWNER_AUTH_SERVER_BOUNDARY_VERSION,
    boundaryKind: "OWNER_AUTH_SERVER_REQUEST",
    state: "VALIDATED_NOT_ACTIVATED",
    readinessId: readiness.readinessId,
    readinessDigest: readiness.readinessDigest,
    environment: readiness.environment,
    owner,
    verifiedEmail: session.authenticatedEmailVerified,
    sessionCreatedAt: session.sessionCreatedAt,
    sessionExpiresAt: session.sessionExpiresAt,
    request: {
      method: request.method,
      origin: request.origin,
      originHeader: csrf.originHeader,
      fetchSite: csrf.fetchSite,
      fetchMode: csrf.fetchMode,
      fetchDestination: csrf.fetchDestination,
      requestBodySessionFieldsIgnored: true,
    },
    operation,
    payloadDigest: digest,
    idempotencyKey,
    authority: authority(),
  });
  const boundaryDigest = artifactReferenceDigest(core);
  const trusted = deepFreeze(PrivateKwOwnerAuthServerBoundarySchema.parse({
    ...core,
    boundaryId: `kw-owner-auth-server-boundary:${boundaryDigest}`,
    boundaryDigest,
  }));
  trustedOwnerAuthServerBoundaries.add(trusted);
  return trusted;
}
