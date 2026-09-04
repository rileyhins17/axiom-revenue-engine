import { z } from "zod";

import {
  artifactReferenceDigest,
} from "@/lib/revenue-engine/artifact-reference-projection";

export const PRIVATE_KW_OWNER_AUTH_READINESS_VERSION =
  "kw-owner-auth-readiness-v1";

const TimestampSchema = z.string().datetime({ offset: true });
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const OriginSchema = z.string().url().refine((value) => {
  const parsed = new URL(value);
  return parsed.origin === value && parsed.username === "" && parsed.password === "";
}, "Trusted origins must be exact origins without credentials, paths, or fragments.");

const OwnerAuthReadinessInputSchema = z.object({
  readinessVersion: z.literal(PRIVATE_KW_OWNER_AUTH_READINESS_VERSION),
  environment: z.enum(["STAGING", "PRODUCTION"]),
  ownerAllowlist: z.array(z.string().email().transform((value) => value.toLowerCase())).length(2),
  emailVerification: z.object({
    requiredBeforeSession: z.literal(true),
    sendVerificationEmailConfigured: z.literal(true),
    sendOnSignUp: z.literal(true),
    sendOnSignIn: z.literal(true),
    tokenLifetimeSeconds: z.number().int().min(300).max(3_600),
  }).strict(),
  multiFactor: z.object({
    provider: z.literal("TOTP"),
    enrollmentRequiredForOwners: z.literal(true),
    requiredForOwnerActions: z.literal(true),
    backupCodesEnabled: z.literal(true),
    backupCodesEncryptedAtRest: z.literal(true),
    backupCodesSingleUse: z.literal(true),
    freshSessionRequiredToViewCodes: z.literal(true),
    accountLockoutEnabled: z.literal(true),
    maxFailedAttempts: z.number().int().min(3).max(10),
    lockoutDurationSeconds: z.number().int().min(300).max(3_600),
  }).strict(),
  session: z.object({
    serverOnlyLookup: z.literal(true),
    requestBodyFieldsIgnored: z.literal(true),
    secureCookie: z.literal(true),
    sameSite: z.enum(["lax", "strict"]),
    maxAgeSeconds: z.number().int().min(300).max(7 * 24 * 3_600),
  }).strict(),
  csrf: z.object({
    originCheckEnabled: z.literal(true),
    fetchMetadataChecksEnabled: z.literal(true),
    trustedOriginsExact: z.array(OriginSchema).min(1).max(8),
    wildcardOriginsAllowed: z.literal(false),
    localhostAllowedInProduction: z.literal(false),
  }).strict(),
  idempotency: z.object({
    enabled: z.literal(true),
    keyIncludesOperation: z.literal(true),
    keyIncludesActor: z.literal(true),
    keyIncludesPayloadDigest: z.literal(true),
    atomicStorage: z.literal(true),
    replayReturnsSameResult: z.literal(true),
  }).strict(),
  checkedAt: TimestampSchema,
}).strict().superRefine((input, context) => {
  const owners = [...input.ownerAllowlist].sort().join(",");
  if (owners !== "aidan@getaxiom.ca,riley@getaxiom.ca") {
    context.addIssue({
      code: "custom",
      message: "The owner authentication allowlist must contain exactly Riley and Aidan.",
      path: ["ownerAllowlist"],
    });
  }

  const origins = input.csrf.trustedOriginsExact;
  if (new Set(origins).size !== origins.length) {
    context.addIssue({
      code: "custom",
      message: "Trusted origins must not contain duplicates.",
      path: ["csrf", "trustedOriginsExact"],
    });
  }
  if (origins.some((origin) => origin.includes("*"))) {
    context.addIssue({
      code: "custom",
      message: "Wildcard trusted origins are not allowed in the owner boundary.",
      path: ["csrf", "trustedOriginsExact"],
    });
  }
  if (input.environment === "PRODUCTION" && origins.some((origin) => {
    const hostname = new URL(origin).hostname;
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
  })) {
    context.addIssue({
      code: "custom",
      message: "Production owner authentication cannot trust a loopback origin.",
      path: ["csrf", "trustedOriginsExact"],
    });
  }
});

const AuthoritySchema = z.object({
  validationOnly: z.literal(true),
  policySatisfied: z.literal(true),
  activationAuthorized: z.literal(false),
  ownerDecisionPersistenceAuthorized: z.literal(false),
  phaseInputCreationAuthorized: z.literal(false),
  progressReceiptCreationAuthorized: z.literal(false),
  phaseAdvancementAuthorized: z.literal(false),
  databaseReadAuthorized: z.literal(false),
  databaseMutationAuthorized: z.literal(false),
  providerOperationsAuthorized: z.literal(0),
  costAuthorizedUsd: z.literal(0),
  routeAuthorized: z.literal(false),
  uiMutationAuthorized: z.literal(false),
  outreachAuthorized: z.literal(false),
  sendAuthorized: z.literal(false),
  deploymentAuthorized: z.literal(false),
}).strict();

const ReadinessCoreSchema = z.object({
  readinessVersion: z.literal(PRIVATE_KW_OWNER_AUTH_READINESS_VERSION),
  readinessKind: z.literal("OWNER_AUTHENTICATION_READINESS"),
  state: z.literal("VALIDATED_NOT_ACTIVATED"),
  environment: z.enum(["STAGING", "PRODUCTION"]),
  ownerAllowlist: z.tuple([
    z.literal("aidan@getaxiom.ca"),
    z.literal("riley@getaxiom.ca"),
  ]),
  controls: z.object({
    verifiedEmailRequired: z.literal(true),
    verificationDeliveryConfigured: z.literal(true),
    mfaProvider: z.literal("TOTP"),
    mfaEnrollmentRequiredForOwners: z.literal(true),
    backupRecoveryEnabled: z.literal(true),
    serverOnlySessionLookup: z.literal(true),
    requestBodySessionFieldsIgnored: z.literal(true),
    csrfOriginAndFetchMetadataChecks: z.literal(true),
    exactTrustedOrigins: z.literal(true),
    atomicIdempotency: z.literal(true),
  }).strict(),
  trustedOrigins: z.array(OriginSchema).min(1).max(8),
  checkedAt: TimestampSchema,
  authority: AuthoritySchema,
}).strict();

export const PrivateKwOwnerAuthReadinessSchema = ReadinessCoreSchema.extend({
  readinessId: z.string().regex(/^kw-owner-auth-readiness:[a-f0-9]{64}$/),
  readinessDigest: Sha256Schema,
}).strict().superRefine((readiness, context) => {
  const {
    readinessId: _readinessId,
    readinessDigest: _readinessDigest,
    ...core
  } = readiness;
  void _readinessId;
  void _readinessDigest;
  const expectedDigest = artifactReferenceDigest(core);
  if (
    readiness.readinessDigest !== expectedDigest
    || readiness.readinessId !== `kw-owner-auth-readiness:${expectedDigest}`
  ) {
    context.addIssue({
      code: "custom",
      message: "Owner authentication readiness identity must bind its exact content.",
      path: ["readinessDigest"],
    });
  }
  if (readiness.ownerAllowlist.join(",") !== "aidan@getaxiom.ca,riley@getaxiom.ca") {
    context.addIssue({
      code: "custom",
      message: "Owner authentication readiness must preserve the exact owner allowlist.",
      path: ["ownerAllowlist"],
    });
  }
});

export type PrivateKwOwnerAuthReadiness = z.infer<
  typeof PrivateKwOwnerAuthReadinessSchema
>;

const trustedOwnerAuthReadiness = new WeakSet<object>();

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return Object.freeze(value);
}

function authority() {
  return AuthoritySchema.parse({
    validationOnly: true,
    policySatisfied: true,
    activationAuthorized: false,
    ownerDecisionPersistenceAuthorized: false,
    phaseInputCreationAuthorized: false,
    progressReceiptCreationAuthorized: false,
    phaseAdvancementAuthorized: false,
    databaseReadAuthorized: false,
    databaseMutationAuthorized: false,
    providerOperationsAuthorized: 0,
    costAuthorizedUsd: 0,
    routeAuthorized: false,
    uiMutationAuthorized: false,
    outreachAuthorized: false,
    sendAuthorized: false,
    deploymentAuthorized: false,
  });
}

export function requireInProcessPrivateKwOwnerAuthReadiness(
  value: unknown,
): PrivateKwOwnerAuthReadiness {
  PrivateKwOwnerAuthReadinessSchema.parse(value);
  if (
    !value
    || typeof value !== "object"
    || !trustedOwnerAuthReadiness.has(value)
  ) {
    throw new Error("An exact in-process owner-auth readiness result is required.");
  }
  return value as PrivateKwOwnerAuthReadiness;
}

/**
 * Validates the complete owner-authentication policy without touching Better
 * Auth, a request, a database, a provider, a route, or an application secret.
 * A future server-only adapter must supply this snapshot from live config and
 * still keep activation separately gated.
 */
export function buildPrivateKwOwnerAuthReadiness(
  input: unknown,
): PrivateKwOwnerAuthReadiness {
  const snapshot = OwnerAuthReadinessInputSchema.parse(input);
  const ownerAllowlist = [...snapshot.ownerAllowlist].sort() as [
    "aidan@getaxiom.ca",
    "riley@getaxiom.ca",
  ];
  const core = ReadinessCoreSchema.parse({
    readinessVersion: snapshot.readinessVersion,
    readinessKind: "OWNER_AUTHENTICATION_READINESS",
    state: "VALIDATED_NOT_ACTIVATED",
    environment: snapshot.environment,
    ownerAllowlist,
    controls: {
      verifiedEmailRequired: snapshot.emailVerification.requiredBeforeSession,
      verificationDeliveryConfigured: snapshot.emailVerification.sendVerificationEmailConfigured,
      mfaProvider: snapshot.multiFactor.provider,
      mfaEnrollmentRequiredForOwners: snapshot.multiFactor.enrollmentRequiredForOwners,
      backupRecoveryEnabled:
        snapshot.multiFactor.backupCodesEnabled
        && snapshot.multiFactor.backupCodesEncryptedAtRest
        && snapshot.multiFactor.backupCodesSingleUse
        && snapshot.multiFactor.freshSessionRequiredToViewCodes,
      serverOnlySessionLookup: snapshot.session.serverOnlyLookup,
      requestBodySessionFieldsIgnored: snapshot.session.requestBodyFieldsIgnored,
      csrfOriginAndFetchMetadataChecks:
        snapshot.csrf.originCheckEnabled
        && snapshot.csrf.fetchMetadataChecksEnabled,
      exactTrustedOrigins: !snapshot.csrf.wildcardOriginsAllowed,
      atomicIdempotency:
        snapshot.idempotency.enabled
        && snapshot.idempotency.atomicStorage
        && snapshot.idempotency.replayReturnsSameResult,
    },
    trustedOrigins: snapshot.csrf.trustedOriginsExact,
    checkedAt: snapshot.checkedAt,
    authority: authority(),
  });
  const readinessDigest = artifactReferenceDigest(core);
  const trusted = deepFreeze(
    PrivateKwOwnerAuthReadinessSchema.parse({
      ...core,
      readinessId: `kw-owner-auth-readiness:${readinessDigest}`,
      readinessDigest,
    }),
  );
  trustedOwnerAuthReadiness.add(trusted);
  return trusted;
}
