import { createHmac, timingSafeEqual } from "node:crypto";

import { z } from "zod";

import { artifactReferenceCanonicalJson } from "@/lib/revenue-engine/artifact-reference-projection";

export const ARTIFACT_DELIVERY_CONTRACT_VERSION = "artifact-delivery-authorization-v1";
export const ARTIFACT_DELIVERY_TOKEN_PREFIX = "ared1";
export const ARTIFACT_DELIVERY_MAX_TTL_MS = 5 * 60 * 1_000;
export const ARTIFACT_DELIVERY_MIN_TTL_MS = 5 * 1_000;
export const ARTIFACT_DELIVERY_MAX_TOKEN_LENGTH = 4_096;

const TimestampSchema = z.string().datetime({ offset: true });
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const ArtifactRefSchema = z.string().regex(/^artifact:sha256:[a-f0-9]{64}$/);
const PrivateIdentifierSchema = z.string().trim().min(1).max(128);

export const ArtifactDeliveryKindSchema = z.enum([
  "DESKTOP_SCREENSHOT",
  "MOBILE_SCREENSHOT",
]);

const ArtifactDeliveryIssueRequestSchema = z.object({
  grantId: z.string().uuid(),
  authenticatedUserId: PrivateIdentifierSchema,
  authenticatedSessionId: PrivateIdentifierSchema,
  businessId: PrivateIdentifierSchema,
  websiteSnapshotId: PrivateIdentifierSchema,
  artifactKind: ArtifactDeliveryKindSchema,
  artifactRef: ArtifactRefSchema,
  websiteRefreshAfter: TimestampSchema,
  artifactExpiresAt: TimestampSchema,
  requestedTtlMs: z.number().int().min(ARTIFACT_DELIVERY_MIN_TTL_MS).max(ARTIFACT_DELIVERY_MAX_TTL_MS),
}).strict();

const ArtifactDeliveryExpectedContextSchema = ArtifactDeliveryIssueRequestSchema.omit({
  grantId: true,
  requestedTtlMs: true,
});

const ArtifactDeliveryClaimsCoreSchema = z.object({
  contractVersion: z.literal(ARTIFACT_DELIVERY_CONTRACT_VERSION),
  grantId: z.string().uuid(),
  audience: z.literal("OWNER_LEAD_DOSSIER_SCREENSHOT"),
  mode: z.literal("SHADOW"),
  issuerKind: z.literal("FIXTURE"),
  transport: z.literal("PRIVATE_SAME_ORIGIN_STREAM"),
  method: z.literal("GET"),
  mediaType: z.literal("image/webp"),
  disposition: z.literal("INLINE"),
  sessionBinding: Sha256Schema,
  businessId: PrivateIdentifierSchema,
  websiteSnapshotId: PrivateIdentifierSchema,
  artifactKind: ArtifactDeliveryKindSchema,
  artifactRef: ArtifactRefSchema,
  issuedAt: TimestampSchema,
  expiresAt: TimestampSchema,
  websiteRefreshAfter: TimestampSchema,
  artifactExpiresAt: TimestampSchema,
}).strict();

export const ArtifactDeliveryClaimsSchema = ArtifactDeliveryClaimsCoreSchema.superRefine((claims, context) => {
  const issuedAtMs = Date.parse(claims.issuedAt);
  const expiresAtMs = Date.parse(claims.expiresAt);
  if (expiresAtMs - issuedAtMs < ARTIFACT_DELIVERY_MIN_TTL_MS) {
    context.addIssue({ code: "custom", message: "Artifact delivery grant lifetime is too short.", path: ["expiresAt"] });
  }
  if (expiresAtMs - issuedAtMs > ARTIFACT_DELIVERY_MAX_TTL_MS) {
    context.addIssue({ code: "custom", message: "Artifact delivery grant exceeds the maximum lifetime.", path: ["expiresAt"] });
  }
  if (expiresAtMs > Date.parse(claims.websiteRefreshAfter)) {
    context.addIssue({ code: "custom", message: "Artifact delivery cannot outlive the website snapshot.", path: ["expiresAt"] });
  }
  if (expiresAtMs > Date.parse(claims.artifactExpiresAt)) {
    context.addIssue({ code: "custom", message: "Artifact delivery cannot outlive the stored artifact.", path: ["expiresAt"] });
  }
});

export type ArtifactDeliveryClaims = z.infer<typeof ArtifactDeliveryClaimsSchema>;

export const ArtifactDeliveryGrantSchema = z.object({
  contractVersion: z.literal(ARTIFACT_DELIVERY_CONTRACT_VERSION),
  grantId: z.string().uuid(),
  token: z.string().min(1).max(ARTIFACT_DELIVERY_MAX_TOKEN_LENGTH),
  deliveryPath: z.string().startsWith("/api/v1/artifacts/delivery/").max(ARTIFACT_DELIVERY_MAX_TOKEN_LENGTH + 64),
  expiresAt: TimestampSchema,
  authority: z.object({
    authenticatedSessionRequired: z.literal(true),
    exactDossierMatchRequired: z.literal(true),
    runtimeConnected: z.literal(false),
    providerReadAuthorized: z.literal(false),
    providerOperationsAuthorized: z.literal(0),
    mutationAuthorized: z.literal(false),
    outreachAuthorized: z.literal(false),
    sendAuthorized: z.literal(false),
    costAuthorizedUsd: z.literal(0),
  }).strict(),
}).strict();

export type ArtifactDeliveryGrant = z.infer<typeof ArtifactDeliveryGrantSchema>;

export class ArtifactDeliveryAuthorizationError extends Error {
  readonly code: "INVALID_GRANT" | "NOT_YET_VALID" | "EXPIRED" | "CONTEXT_MISMATCH";

  constructor(code: ArtifactDeliveryAuthorizationError["code"]) {
    super({
      INVALID_GRANT: "The private artifact delivery grant is invalid.",
      NOT_YET_VALID: "The private artifact delivery grant is not active.",
      EXPIRED: "The private artifact delivery grant has expired.",
      CONTEXT_MISMATCH: "The private artifact delivery grant does not match this session and dossier.",
    }[code]);
    this.name = "ArtifactDeliveryAuthorizationError";
    this.code = code;
  }
}

function signingKey(value: Uint8Array) {
  if (!(value instanceof Uint8Array) || value.byteLength < 32) {
    throw new Error("Artifact delivery signing keys must contain at least 32 bytes.");
  }
  return value;
}

function sessionBinding(userId: string, sessionId: string, key: Uint8Array) {
  return createHmac("sha256", key)
    .update(artifactReferenceCanonicalJson({ bindingVersion: "artifact-delivery-session-v1", sessionId, userId }))
    .digest("hex");
}

function unsignedToken(payloadSegment: string) {
  return `${ARTIFACT_DELIVERY_TOKEN_PREFIX}.${payloadSegment}`;
}

function signPayload(payloadSegment: string, key: Uint8Array) {
  return createHmac("sha256", key).update(unsignedToken(payloadSegment)).digest("base64url");
}

function exactEqual(left: unknown, right: unknown) {
  return artifactReferenceCanonicalJson(left) === artifactReferenceCanonicalJson(right);
}

function parseAndVerifyToken(token: string, keyValue: Uint8Array) {
  if (token.length === 0 || token.length > ARTIFACT_DELIVERY_MAX_TOKEN_LENGTH) {
    throw new ArtifactDeliveryAuthorizationError("INVALID_GRANT");
  }
  const segments = token.split(".");
  if (segments.length !== 3 || segments[0] !== ARTIFACT_DELIVERY_TOKEN_PREFIX) {
    throw new ArtifactDeliveryAuthorizationError("INVALID_GRANT");
  }
  const [, payloadSegment, suppliedSignature] = segments;
  if (!payloadSegment || !suppliedSignature) {
    throw new ArtifactDeliveryAuthorizationError("INVALID_GRANT");
  }
  const key = signingKey(keyValue);
  const expectedSignature = signPayload(payloadSegment, key);
  let suppliedBytes: Buffer;
  let expectedBytes: Buffer;
  try {
    suppliedBytes = Buffer.from(suppliedSignature, "base64url");
    expectedBytes = Buffer.from(expectedSignature, "base64url");
  } catch {
    throw new ArtifactDeliveryAuthorizationError("INVALID_GRANT");
  }
  if (
    suppliedBytes.byteLength !== expectedBytes.byteLength
    || Buffer.from(suppliedBytes).toString("base64url") !== suppliedSignature
    || !timingSafeEqual(suppliedBytes, expectedBytes)
  ) {
    throw new ArtifactDeliveryAuthorizationError("INVALID_GRANT");
  }

  let rawClaims: unknown;
  try {
    const payloadBytes = Buffer.from(payloadSegment, "base64url");
    if (payloadBytes.toString("base64url") !== payloadSegment) {
      throw new Error("Non-canonical base64url payload.");
    }
    rawClaims = JSON.parse(payloadBytes.toString("utf8"));
  } catch {
    throw new ArtifactDeliveryAuthorizationError("INVALID_GRANT");
  }
  const parsed = ArtifactDeliveryClaimsSchema.safeParse(rawClaims);
  if (!parsed.success) throw new ArtifactDeliveryAuthorizationError("INVALID_GRANT");
  if (Buffer.from(artifactReferenceCanonicalJson(parsed.data), "utf8").toString("base64url") !== payloadSegment) {
    throw new ArtifactDeliveryAuthorizationError("INVALID_GRANT");
  }
  return parsed.data;
}

export function issueFixtureArtifactDeliveryGrant(
  value: unknown,
  dependencies: { signingKey: Uint8Array; now?: () => Date },
): ArtifactDeliveryGrant {
  const request = ArtifactDeliveryIssueRequestSchema.parse(value);
  const key = signingKey(dependencies.signingKey);
  const issuedAt = (dependencies.now ?? (() => new Date()))().toISOString();
  const issuedAtMs = Date.parse(issuedAt);
  const expiresAtMs = Math.min(
    issuedAtMs + request.requestedTtlMs,
    Date.parse(request.websiteRefreshAfter),
    Date.parse(request.artifactExpiresAt),
  );
  if (expiresAtMs - issuedAtMs < ARTIFACT_DELIVERY_MIN_TTL_MS) {
    throw new ArtifactDeliveryAuthorizationError("EXPIRED");
  }
  const claims = ArtifactDeliveryClaimsSchema.parse({
    contractVersion: ARTIFACT_DELIVERY_CONTRACT_VERSION,
    grantId: request.grantId,
    audience: "OWNER_LEAD_DOSSIER_SCREENSHOT",
    mode: "SHADOW",
    issuerKind: "FIXTURE",
    transport: "PRIVATE_SAME_ORIGIN_STREAM",
    method: "GET",
    mediaType: "image/webp",
    disposition: "INLINE",
    sessionBinding: sessionBinding(request.authenticatedUserId, request.authenticatedSessionId, key),
    businessId: request.businessId,
    websiteSnapshotId: request.websiteSnapshotId,
    artifactKind: request.artifactKind,
    artifactRef: request.artifactRef,
    issuedAt,
    expiresAt: new Date(expiresAtMs).toISOString(),
    websiteRefreshAfter: request.websiteRefreshAfter,
    artifactExpiresAt: request.artifactExpiresAt,
  });
  const payloadSegment = Buffer.from(artifactReferenceCanonicalJson(claims), "utf8").toString("base64url");
  const token = `${unsignedToken(payloadSegment)}.${signPayload(payloadSegment, key)}`;
  return ArtifactDeliveryGrantSchema.parse({
    contractVersion: ARTIFACT_DELIVERY_CONTRACT_VERSION,
    grantId: claims.grantId,
    token,
    deliveryPath: `/api/v1/artifacts/delivery/${token}`,
    expiresAt: claims.expiresAt,
    authority: {
      authenticatedSessionRequired: true,
      exactDossierMatchRequired: true,
      runtimeConnected: false,
      providerReadAuthorized: false,
      providerOperationsAuthorized: 0,
      mutationAuthorized: false,
      outreachAuthorized: false,
      sendAuthorized: false,
      costAuthorizedUsd: 0,
    },
  });
}

export function verifyFixtureArtifactDeliveryGrant(
  token: string,
  expectedValue: unknown,
  dependencies: { signingKey: Uint8Array; now?: () => Date },
) {
  const expected = ArtifactDeliveryExpectedContextSchema.parse(expectedValue);
  const key = signingKey(dependencies.signingKey);
  const claims = parseAndVerifyToken(token, key);
  const nowMs = (dependencies.now ?? (() => new Date()))().getTime();
  if (!Number.isFinite(nowMs)) {
    throw new ArtifactDeliveryAuthorizationError("INVALID_GRANT");
  }
  if (nowMs < Date.parse(claims.issuedAt)) {
    throw new ArtifactDeliveryAuthorizationError("NOT_YET_VALID");
  }
  if (nowMs >= Date.parse(claims.expiresAt)) {
    throw new ArtifactDeliveryAuthorizationError("EXPIRED");
  }
  const expectedClaims = {
    sessionBinding: sessionBinding(expected.authenticatedUserId, expected.authenticatedSessionId, key),
    businessId: expected.businessId,
    websiteSnapshotId: expected.websiteSnapshotId,
    artifactKind: expected.artifactKind,
    artifactRef: expected.artifactRef,
    websiteRefreshAfter: expected.websiteRefreshAfter,
    artifactExpiresAt: expected.artifactExpiresAt,
  };
  const actualClaims = {
    sessionBinding: claims.sessionBinding,
    businessId: claims.businessId,
    websiteSnapshotId: claims.websiteSnapshotId,
    artifactKind: claims.artifactKind,
    artifactRef: claims.artifactRef,
    websiteRefreshAfter: claims.websiteRefreshAfter,
    artifactExpiresAt: claims.artifactExpiresAt,
  };
  if (!exactEqual(expectedClaims, actualClaims)) {
    throw new ArtifactDeliveryAuthorizationError("CONTEXT_MISMATCH");
  }
  return Object.freeze(claims);
}
