import { createHash } from "node:crypto";

import { z } from "zod";

import {
  RevenueContactDiscoveryResultSchema,
  contactDiscoveryCanonicalJson,
  contactDiscoveryDigest,
  type RevenueContactDiscoveryCandidate,
  type RevenueContactDiscoveryResult,
  type RevenueContactEvidenceClaimSchema,
} from "@/lib/revenue-engine/contact-discovery";
import {
  RevenueContactVerificationResultSchema,
  contactVerificationResultMatchesCandidate,
  type RevenueContactVerificationResult,
} from "@/lib/revenue-engine/contact-verification";

export const REVENUE_CONTACT_PERSISTENCE_PLAN_VERSION = "revenue-contact-persistence-plan-v1";
export const REVENUE_CONTACT_PERSISTENCE_TARGET_SCHEMA_VERSION = "0063_harden_contact_record_lineage";

const SqlValueSchema = z.union([z.string(), z.number().finite(), z.null()]);
const EntitySchema = z.enum([
  "BUSINESS",
  "DISCOVERY_RECEIPT",
  "CONTACT_POINT",
  "EVIDENCE_CLAIM",
  "EVIDENCE_USE",
  "VERIFICATION_RESULT",
]);

const PreflightSchema = z.object({
  preflightId: z.string().min(1).max(260),
  entity: EntitySchema,
  recordId: z.string().min(1).max(220),
  ownership: z.enum(["PREREQUISITE", "GLOBAL_REUSABLE", "DISCOVERY_OWNED"]),
  selectSql: z.string().min(1).max(5_000),
  bindings: z.array(SqlValueSchema).max(8),
  expected: z.record(z.string().min(1).max(100), SqlValueSchema),
  expectedFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  rejectMultipleMatches: z.literal(true),
}).strict().superRefine((item, context) => {
  if (!/^\s*SELECT\b/i.test(item.selectSql) || /\b(?:INSERT|UPDATE|DELETE|REPLACE|DROP|ALTER)\b/i.test(item.selectSql)) {
    context.addIssue({ code: "custom", message: "Contact preflights must remain SELECT-only.", path: ["selectSql"] });
  }
});

const MutationSchema = z.object({
  statementId: z.string().min(1).max(260),
  entity: EntitySchema.exclude(["BUSINESS"]),
  recordId: z.string().min(1).max(220),
  sql: z.string().min(1).max(8_000),
  bindings: z.array(SqlValueSchema).max(50),
  operation: z.literal("INSERT_APPEND_ONLY"),
}).strict().superRefine((item, context) => {
  if (!/^\s*INSERT\s+INTO\b/i.test(item.sql) || /\b(?:UPDATE|DELETE|REPLACE|DROP|ALTER)\b/i.test(item.sql)) {
    context.addIssue({ code: "custom", message: "Contact persistence mutations must be append-only INSERT statements.", path: ["sql"] });
  }
});

export const RevenueContactPersistencePlanSchema = z.object({
  persistencePlanVersion: z.literal(REVENUE_CONTACT_PERSISTENCE_PLAN_VERSION),
  targetSchemaVersion: z.literal(REVENUE_CONTACT_PERSISTENCE_TARGET_SCHEMA_VERSION),
  sourceDiscoveryResultId: z.string().min(1).max(160),
  sourceDiscoveryResultDigest: z.string().regex(/^[a-f0-9]{64}$/),
  sourceVerificationResultIds: z.array(z.string().min(1).max(160)).max(250),
  planDigest: z.string().regex(/^[a-f0-9]{64}$/),
  preflights: z.array(PreflightSchema).min(2).max(2_000),
  mutations: z.array(MutationSchema).min(1).max(2_000),
  summary: z.object({
    discoveryReceipts: z.literal(1),
    contactPointVersions: z.number().int().min(0).max(25),
    evidenceClaims: z.number().int().min(0).max(500),
    evidenceUses: z.number().int().min(0).max(500),
    verificationResults: z.number().int().min(0).max(250),
    consentRows: z.literal(0),
    qualificationRows: z.literal(0),
    outreachRows: z.literal(0),
    providerOperations: z.literal(0),
    costUsd: z.literal(0),
  }).strict(),
  requiresAtomicBatch: z.literal(true),
  requiresExactPreflightMatch: z.literal(true),
  executorImplemented: z.literal(false),
  databaseAccessAuthorized: z.literal(false),
  mutationAuthorized: z.literal(false),
  qualificationAuthorized: z.literal(false),
  outreachAuthorized: z.literal(false),
  sendAuthorized: z.literal(false),
  providerOperationsAuthorized: z.literal(0),
  costAuthorizedUsd: z.literal(0),
}).strict().superRefine((plan, context) => {
  const { planDigest, ...core } = plan;
  if (planDigest !== contactDiscoveryDigest(core)) {
    context.addIssue({ code: "custom", message: "Contact persistence plan digest must bind the exact plan.", path: ["planDigest"] });
  }
  const preflightKeys = new Set(plan.preflights.map((item) => `${item.entity}|${item.recordId}`));
  const mutationKeys = new Set(plan.mutations.map((item) => `${item.entity}|${item.recordId}`));
  if (preflightKeys.size !== plan.preflights.length || mutationKeys.size !== plan.mutations.length) {
    context.addIssue({ code: "custom", message: "Contact persistence identities must be unique.", path: ["mutations"] });
  }
  if (plan.preflights.some((item) => /\bLIMIT\s+1\b/i.test(item.selectSql))) {
    context.addIssue({ code: "custom", message: "Contact collision preflights must inspect every matching identity.", path: ["preflights"] });
  }
  for (const mutation of plan.mutations) {
    if (!preflightKeys.has(`${mutation.entity}|${mutation.recordId}`)) {
      context.addIssue({ code: "custom", message: "Every contact mutation requires an exact preflight.", path: ["mutations"] });
      break;
    }
  }
});

export type RevenueContactPersistencePlan = z.infer<typeof RevenueContactPersistencePlanSchema>;
export type RevenueContactPersistencePreflight = z.infer<typeof PreflightSchema>;
export type RevenueContactPersistenceObservation = {
  preflightId: string;
  rows: readonly Record<string, unknown>[];
};

type SqlValue = z.infer<typeof SqlValueSchema>;
type Entity = z.infer<typeof EntitySchema>;
type EvidenceClaim = z.infer<typeof RevenueContactEvidenceClaimSchema>;

function fingerprint(value: unknown) {
  return createHash("sha256").update(contactDiscoveryCanonicalJson(value)).digest("hex");
}

function versionedId(prefix: string, value: unknown) {
  return `${prefix}:${fingerprint(value)}`;
}

function makePreflight(input: {
  entity: Entity;
  recordId: string;
  ownership: RevenueContactPersistencePreflight["ownership"];
  selectSql: string;
  bindings: SqlValue[];
  expected: Record<string, SqlValue>;
}): RevenueContactPersistencePreflight {
  return PreflightSchema.parse({
    preflightId: `preflight:${input.entity.toLocaleLowerCase("en-CA")}:${input.recordId}`,
    ...input,
    expectedFingerprint: fingerprint(input.expected),
    rejectMultipleMatches: true,
  });
}

function makeMutation(
  entity: Exclude<Entity, "BUSINESS">,
  recordId: string,
  row: Record<string, SqlValue>,
  table: string,
) {
  const columns = Object.keys(row);
  return MutationSchema.parse({
    statementId: `insert:${entity.toLocaleLowerCase("en-CA")}:${recordId}`,
    entity,
    recordId,
    sql: `INSERT INTO "${table}" (${columns.map((column) => `"${column}"`).join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
    bindings: Object.values(row),
    operation: "INSERT_APPEND_ONLY",
  });
}

function makePersistenceItem(input: {
  entity: Exclude<Entity, "BUSINESS">;
  recordId: string;
  ownership: RevenueContactPersistencePreflight["ownership"];
  row: Record<string, SqlValue>;
  table: string;
  whereSql: string;
  bindings: SqlValue[];
}) {
  const columns = Object.keys(input.row);
  return {
    preflight: makePreflight({
      entity: input.entity,
      recordId: input.recordId,
      ownership: input.ownership,
      selectSql: `SELECT ${columns.map((column) => `"${column}"`).join(", ")} FROM "${input.table}" WHERE ${input.whereSql}`,
      bindings: input.bindings,
      expected: input.row,
    }),
    mutation: makeMutation(input.entity, input.recordId, input.row, input.table),
  };
}

function primaryEvidence(candidate: RevenueContactDiscoveryCandidate) {
  return [...candidate.evidenceClaims].sort((left, right) =>
    right.confidence - left.confidence
    || Date.parse(right.capturedAt) - Date.parse(left.capturedAt)
    || left.evidenceId.localeCompare(right.evidenceId, "en-CA"),
  )[0]!;
}

function verificationRow(
  result: RevenueContactVerificationResult,
  contactPointId: string,
): Record<string, SqlValue> {
  const observation = result.observation;
  return {
    id: versionedId("revenue-verification", { contactPointId, verificationResultId: result.verificationResultId }),
    contactPointId,
    provider: observation.provider,
    status: observation.status,
    catchAll: observation.channel === "EMAIL" ? Number(observation.catchAll) : null,
    staleAfter: observation.staleAfter,
    detailsJson: contactDiscoveryCanonicalJson(observation),
    verifiedAt: observation.verifiedAt,
    createdAt: result.completedAt,
    persistenceVersion: REVENUE_CONTACT_PERSISTENCE_PLAN_VERSION,
    verificationResultId: result.verificationResultId,
    verificationVersion: result.verificationVersion,
    requestId: result.requestId,
    requestDigest: result.requestDigest,
    candidateId: result.candidateId,
    candidateDigest: result.candidateDigest,
    resultDigest: result.verificationResultDigest,
    resultJson: contactDiscoveryCanonicalJson(result),
    sourceUrl: observation.sourceUrl,
    ownerStatus: result.ownerProjection.status,
    recommendedAction: result.recommendedAction,
    usableRoute: Number(result.usableRoute),
    consentBasis: result.consentBasis,
    complianceReviewRequired: Number(result.complianceReviewRequired),
    autonomousEmailEligible: 0,
    mode: result.mode,
    verifierKind: result.verifierKind,
    runtimeConnected: 0,
    verificationPersistenceAuthorized: 0,
    qualificationPersistenceAuthorized: 0,
    outreachAuthorized: 0,
    sendAuthorized: 0,
    providerOperationsAuthorized: 0,
    costAuthorizedUsd: 0,
  };
}

export function verifyContactPersistencePreflight(
  item: RevenueContactPersistencePreflight,
  rows: readonly Record<string, unknown>[],
) {
  const preflight = PreflightSchema.parse(item);
  if (rows.length === 0) return { state: "MISSING" as const, matches: true, matchCount: 0 };
  if (rows.length !== 1) return { state: "CONFLICT" as const, matches: false, matchCount: rows.length };
  const comparable = Object.fromEntries(Object.keys(preflight.expected).map((key) => [key, rows[0]![key] ?? null]));
  const matches = fingerprint(comparable) === preflight.expectedFingerprint;
  return { state: matches ? "EXACT_MATCH" as const : "CONFLICT" as const, matches, matchCount: 1 };
}

export function evaluateRevenueContactPersistencePlan(
  value: RevenueContactPersistencePlan,
  observations: readonly RevenueContactPersistenceObservation[],
) {
  const plan = RevenueContactPersistencePlanSchema.parse(value);
  const byId = new Map(observations.map((item) => [item.preflightId, item.rows]));
  if (byId.size !== observations.length || byId.size !== plan.preflights.length) {
    return { state: "BLOCKED" as const, reason: "Every preflight requires exactly one observation.", mutationAuthorized: false as const };
  }
  const states = plan.preflights.map((item) => {
    const rows = byId.get(item.preflightId);
    if (!rows) return { item, state: "CONFLICT" as const };
    return { item, state: verifyContactPersistencePreflight(item, rows).state };
  });
  if (states.some(({ state }) => state === "CONFLICT")) {
    return { state: "BLOCKED" as const, reason: "A primary or alternate identity conflicts with the exact plan.", mutationAuthorized: false as const };
  }
  const business = states.find(({ item }) => item.entity === "BUSINESS");
  if (!business || business.state !== "EXACT_MATCH") {
    return { state: "BLOCKED" as const, reason: "The exact business prerequisite is missing.", mutationAuthorized: false as const };
  }
  const receipt = states.find(({ item }) => item.entity === "DISCOVERY_RECEIPT")!;
  const discoveryOwned = states.filter(({ item }) => item.ownership === "DISCOVERY_OWNED");
  if (receipt.state === "EXACT_MATCH" && discoveryOwned.some(({ state }) => state !== "EXACT_MATCH")) {
    return { state: "BLOCKED" as const, reason: "An existing discovery receipt has an incomplete append-only record set.", mutationAuthorized: false as const };
  }
  if (receipt.state === "MISSING" && discoveryOwned.some(({ item, state }) => item.entity !== "DISCOVERY_RECEIPT" && state !== "MISSING")) {
    return { state: "BLOCKED" as const, reason: "Discovery-owned records exist without their exact parent receipt.", mutationAuthorized: false as const };
  }
  const exactReplay = states.filter(({ item }) => item.entity !== "BUSINESS").every(({ state }) => state === "EXACT_MATCH");
  return {
    state: exactReplay ? "EXACT_REPLAY" as const : "FRESH_PLAN" as const,
    reason: exactReplay ? "Every append-only record matches exactly." : "The append-only record set is absent and collision-free.",
    mutationAuthorized: false as const,
    executorImplemented: false as const,
  };
}

export function buildRevenueContactPersistencePlan(input: {
  discovery: RevenueContactDiscoveryResult;
  verifications?: readonly RevenueContactVerificationResult[];
}): RevenueContactPersistencePlan {
  const discovery = RevenueContactDiscoveryResultSchema.parse(input.discovery);
  const verifications = (input.verifications ?? []).map((item) => RevenueContactVerificationResultSchema.parse(item));
  if (new Set(verifications.map((item) => item.verificationResultId)).size !== verifications.length
    || new Set(verifications.map((item) => item.requestId)).size !== verifications.length) {
    throw new Error("Contact verification result and request identities must be unique within one persistence plan.");
  }
  const candidateById = new Map(discovery.candidates.map((candidate) => [candidate.candidateId, candidate]));
  for (const verification of verifications) {
    const candidate = candidateById.get(verification.candidateId);
    if (!candidate || !contactVerificationResultMatchesCandidate(verification, candidate)) {
      throw new Error("Every verification must match one exact discovery candidate.");
    }
    if (Date.parse(verification.completedAt) < Date.parse(discovery.completedAt)) {
      throw new Error("Verification persistence cannot predate contact discovery completion.");
    }
  }

  const items: Array<{ preflight: RevenueContactPersistencePreflight; mutation: z.infer<typeof MutationSchema> }> = [];
  const businessExpected = { id: discovery.businessId };
  const businessPreflight = makePreflight({
    entity: "BUSINESS",
    recordId: discovery.businessId,
    ownership: "PREREQUISITE",
    selectSql: `SELECT "id" FROM "RevenueBusiness" WHERE "id" = ?`,
    bindings: [discovery.businessId],
    expected: businessExpected,
  });

  const allEvidence = new Map<string, EvidenceClaim>();
  let evidenceUseCount = 0;
  for (const candidate of discovery.candidates) {
    evidenceUseCount += candidate.evidenceClaims.length;
    for (const evidence of candidate.evidenceClaims) allEvidence.set(evidence.evidenceId, evidence);
  }
  const receiptRow = {
    id: discovery.discoveryResultId,
    persistenceVersion: REVENUE_CONTACT_PERSISTENCE_PLAN_VERSION,
    discoveryVersion: discovery.discoveryVersion,
    requestId: discovery.requestId,
    requestDigest: discovery.requestDigest,
    businessId: discovery.businessId,
    candidateCount: discovery.candidates.length,
    evidenceClaimCount: allEvidence.size,
    evidenceUseCount,
    resultDigest: discovery.discoveryResultDigest,
    resultJson: contactDiscoveryCanonicalJson(discovery),
    completedAt: discovery.completedAt,
    mode: discovery.mode,
    adapterKind: discovery.adapterKind,
    runtimeConnected: 0,
    sourceContactPersistenceAuthorized: 0,
    sourceVerificationAuthorized: 0,
    outreachAuthorized: 0,
    sendAuthorized: 0,
    providerOperationsAuthorized: 0,
    costAuthorizedUsd: 0,
    createdAt: discovery.completedAt,
  } satisfies Record<string, SqlValue>;
  items.push(makePersistenceItem({
    entity: "DISCOVERY_RECEIPT",
    recordId: discovery.discoveryResultId,
    ownership: "DISCOVERY_OWNED",
    row: receiptRow,
    table: "RevenueContactDiscoveryReceipt",
    whereSql: `"id" = ? OR "requestId" = ?`,
    bindings: [discovery.discoveryResultId, discovery.requestId],
  }));

  const contactPointByCandidate = new Map<string, string>();
  for (const candidate of discovery.candidates) {
    const contactPointId = versionedId("revenue-contact-point", {
      discoveryResultId: discovery.discoveryResultId,
      candidateId: candidate.candidateId,
      candidateDigest: candidate.candidateDigest,
    });
    contactPointByCandidate.set(candidate.candidateId, contactPointId);
    const source = primaryEvidence(candidate);
    const row = {
      id: contactPointId,
      businessId: candidate.businessId,
      channel: candidate.channel,
      value: candidate.value,
      label: candidate.label,
      personName: candidate.personName,
      role: candidate.role,
      sourceUrl: source.sourceUrl,
      sourceCapturedAt: source.capturedAt,
      automationPermitted: 0,
      status: "CANDIDATE",
      createdAt: discovery.completedAt,
      updatedAt: discovery.completedAt,
      persistenceVersion: REVENUE_CONTACT_PERSISTENCE_PLAN_VERSION,
      discoveryReceiptId: discovery.discoveryResultId,
      candidateId: candidate.candidateId,
      candidateDigest: candidate.candidateDigest,
      candidateJson: contactDiscoveryCanonicalJson(candidate),
      recipientKind: candidate.recipientKind,
      socialPlatform: candidate.socialPlatform,
      consentBasis: "UNASSESSED",
    } satisfies Record<string, SqlValue>;
    items.push(makePersistenceItem({
      entity: "CONTACT_POINT", recordId: contactPointId, ownership: "DISCOVERY_OWNED", row,
      table: "RevenueContactPoint", whereSql: `"id" = ? OR ("discoveryReceiptId" = ? AND "candidateId" = ?)`,
      bindings: [contactPointId, discovery.discoveryResultId, candidate.candidateId],
    }));
  }

  for (const evidence of [...allEvidence.values()].sort((left, right) => left.evidenceId.localeCompare(right.evidenceId, "en-CA"))) {
    const row = {
      id: evidence.evidenceId,
      evidenceVersion: evidence.evidenceVersion,
      sourceUrl: evidence.sourceUrl,
      capturedAt: evidence.capturedAt,
      method: evidence.method,
      observation: evidence.observation,
      confidence: evidence.confidence,
      publicationJson: contactDiscoveryCanonicalJson(evidence.publication),
      evidenceJson: contactDiscoveryCanonicalJson(evidence),
      createdAt: evidence.capturedAt,
    } satisfies Record<string, SqlValue>;
    items.push(makePersistenceItem({
      entity: "EVIDENCE_CLAIM", recordId: evidence.evidenceId, ownership: "GLOBAL_REUSABLE", row,
      table: "RevenueContactEvidenceClaim", whereSql: `"id" = ?`, bindings: [evidence.evidenceId],
    }));
  }

  for (const candidate of discovery.candidates) {
    const contactPointId = contactPointByCandidate.get(candidate.candidateId)!;
    for (const evidence of candidate.evidenceClaims) {
      const evidenceUseId = versionedId("revenue-contact-evidence-use", {
        discoveryResultId: discovery.discoveryResultId, contactPointId, evidenceClaimId: evidence.evidenceId,
      });
      const row = {
        id: evidenceUseId,
        discoveryReceiptId: discovery.discoveryResultId,
        contactPointId,
        evidenceClaimId: evidence.evidenceId,
        businessId: discovery.businessId,
        createdAt: discovery.completedAt,
      } satisfies Record<string, SqlValue>;
      items.push(makePersistenceItem({
        entity: "EVIDENCE_USE", recordId: evidenceUseId, ownership: "DISCOVERY_OWNED", row,
        table: "RevenueContactEvidenceUse",
        whereSql: `"id" = ? OR ("discoveryReceiptId" = ? AND "contactPointId" = ? AND "evidenceClaimId" = ?)`,
        bindings: [evidenceUseId, discovery.discoveryResultId, contactPointId, evidence.evidenceId],
      }));
    }
  }

  for (const verification of verifications.sort((left, right) => left.verificationResultId.localeCompare(right.verificationResultId, "en-CA"))) {
    const contactPointId = contactPointByCandidate.get(verification.candidateId)!;
    const row = verificationRow(verification, contactPointId);
    items.push(makePersistenceItem({
      entity: "VERIFICATION_RESULT", recordId: String(row.id), ownership: "DISCOVERY_OWNED", row,
      table: "RevenueVerificationResult", whereSql: `"id" = ? OR ("contactPointId" = ? AND "verificationResultId" = ?)`,
      bindings: [row.id, contactPointId, verification.verificationResultId],
    }));
  }

  const sourceVerificationResultIds = verifications.map((item) => item.verificationResultId).sort((left, right) => left.localeCompare(right, "en-CA"));
  const core = {
    persistencePlanVersion: REVENUE_CONTACT_PERSISTENCE_PLAN_VERSION,
    targetSchemaVersion: REVENUE_CONTACT_PERSISTENCE_TARGET_SCHEMA_VERSION,
    sourceDiscoveryResultId: discovery.discoveryResultId,
    sourceDiscoveryResultDigest: discovery.discoveryResultDigest,
    sourceVerificationResultIds,
    preflights: [businessPreflight, ...items.map((item) => item.preflight)],
    mutations: items.map((item) => item.mutation),
    summary: {
      discoveryReceipts: 1 as const,
      contactPointVersions: discovery.candidates.length,
      evidenceClaims: allEvidence.size,
      evidenceUses: evidenceUseCount,
      verificationResults: verifications.length,
      consentRows: 0 as const,
      qualificationRows: 0 as const,
      outreachRows: 0 as const,
      providerOperations: 0 as const,
      costUsd: 0 as const,
    },
    requiresAtomicBatch: true as const,
    requiresExactPreflightMatch: true as const,
    executorImplemented: false as const,
    databaseAccessAuthorized: false as const,
    mutationAuthorized: false as const,
    qualificationAuthorized: false as const,
    outreachAuthorized: false as const,
    sendAuthorized: false as const,
    providerOperationsAuthorized: 0 as const,
    costAuthorizedUsd: 0 as const,
  };
  return RevenueContactPersistencePlanSchema.parse({ ...core, planDigest: contactDiscoveryDigest(core) });
}
