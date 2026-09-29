import { createHash } from "node:crypto";

import { z } from "zod";

import {
  PrivateKwImportPlanSchema,
  type PrivateKwImportPlan,
} from "@/lib/revenue-engine/private-kw-import";

export const PRIVATE_KW_PERSISTENCE_PLAN_VERSION = "kw-private-persistence-plan-v2";
export const PRIVATE_KW_TARGET_SCHEMA_VERSION = "0054_revenue_shadow_kernel";

const SqlValueSchema = z.union([z.string(), z.number().finite(), z.null()]);
const PersistenceEntitySchema = z.enum(["SOURCE_RUN", "BUSINESS", "LOCATION", "SOURCE_RECORD"]);

const PersistencePreflightSchema = z
  .object({
    preflightId: z.string().min(1).max(120),
    entity: PersistenceEntitySchema,
    recordId: z.string().min(1).max(200),
    selectSql: z.string().min(1).max(2_000),
    bindings: z.array(SqlValueSchema).max(5),
    expected: z.record(z.string().min(1).max(100), SqlValueSchema),
    expectedFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

const PersistenceMutationSchema = z
  .object({
    statementId: z.string().min(1).max(120),
    entity: PersistenceEntitySchema,
    recordId: z.string().min(1).max(200),
    sql: z.string().min(1).max(3_000),
    bindings: z.array(SqlValueSchema).max(30),
    operation: z.literal("INSERT_IF_ABSENT"),
  })
  .strict();

export const PrivateKwPersistencePlanSchema = z
  .object({
    persistencePlanVersion: z.literal(PRIVATE_KW_PERSISTENCE_PLAN_VERSION),
    targetSchemaVersion: z.literal(PRIVATE_KW_TARGET_SCHEMA_VERSION),
    sourcePlanVersion: z.literal("kw-private-import-plan-v1"),
    sourceImportId: z.string().min(8).max(128),
    sourcePlanDigest: z.string().regex(/^[a-f0-9]{64}$/),
    preflights: z.array(PersistencePreflightSchema).min(1).max(200),
    mutations: z.array(PersistenceMutationSchema).min(1).max(200),
    summary: z
      .object({
        sourceRuns: z.number().int().positive().max(9),
        businesses: z.number().int().positive().max(50),
        locations: z.number().int().positive().max(50),
        sourceRecords: z.number().int().positive().max(50),
        totalStatements: z.number().int().positive().max(200),
        qualificationRows: z.literal(0),
        contactRows: z.literal(0),
        outreachRows: z.literal(0),
        costUsd: z.literal(0),
      })
      .strict(),
    requiresExactPreflightMatch: z.literal(true),
    mutationAuthorized: z.literal(false),
  })
  .strict()
  .superRefine((plan, context) => {
    if (plan.preflights.length !== plan.mutations.length || plan.summary.totalStatements !== plan.mutations.length) {
      context.addIssue({ code: "custom", message: "Every mutation requires one matching preflight.", path: ["mutations"] });
    }
    const preflightKeys = new Set(plan.preflights.map((item) => `${item.entity}|${item.recordId}`));
    const mutationKeys = new Set(plan.mutations.map((item) => `${item.entity}|${item.recordId}`));
    if (preflightKeys.size !== plan.preflights.length || mutationKeys.size !== plan.mutations.length) {
      context.addIssue({ code: "custom", message: "Persistence entity IDs must be unique.", path: ["mutations"] });
    }
    for (const key of mutationKeys) {
      if (!preflightKeys.has(key)) {
        context.addIssue({ code: "custom", message: "A mutation is missing its preflight.", path: ["mutations"] });
        break;
      }
    }
  });

export type PrivateKwPersistencePlan = z.infer<typeof PrivateKwPersistencePlanSchema>;
export type PersistencePreflight = z.infer<typeof PersistencePreflightSchema>;

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right, "en-CA"))
        .map(([key, child]) => [key, canonicalValue(child)]),
    );
  }
  return value;
}

function canonicalJson(value: unknown) {
  return JSON.stringify(canonicalValue(value));
}

function fingerprint(value: unknown) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function preflight(
  entity: z.infer<typeof PersistenceEntitySchema>,
  recordId: string,
  selectSql: string,
  expected: Record<string, z.infer<typeof SqlValueSchema>>,
  bindings: z.infer<typeof SqlValueSchema>[] = [recordId],
): PersistencePreflight {
  return PersistencePreflightSchema.parse({
    preflightId: `preflight:${entity.toLocaleLowerCase("en-CA")}:${recordId}`,
    entity,
    recordId,
    selectSql,
    bindings,
    expected,
    expectedFingerprint: fingerprint(expected),
  });
}

function mutation(
  entity: z.infer<typeof PersistenceEntitySchema>,
  recordId: string,
  sql: string,
  bindings: z.infer<typeof SqlValueSchema>[],
) {
  return PersistenceMutationSchema.parse({
    statementId: `insert:${entity.toLocaleLowerCase("en-CA")}:${recordId}`,
    entity,
    recordId,
    sql,
    bindings,
    operation: "INSERT_IF_ABSENT",
  });
}

export function verifyPersistencePreflight(
  item: PersistencePreflight,
  existingRows: readonly Record<string, unknown>[],
) {
  const validated = PersistencePreflightSchema.parse(item);
  if (existingRows.length === 0) return { state: "MISSING" as const, matches: true };
  if (existingRows.length !== 1) return { state: "CONFLICT" as const, matches: false };
  const [existingRow] = existingRows;
  const comparable = Object.fromEntries(
    Object.keys(validated.expected).map((key) => [key, existingRow[key] ?? null]),
  );
  const actualFingerprint = fingerprint(comparable);
  return {
    state: actualFingerprint === validated.expectedFingerprint ? "EXACT_MATCH" as const : "CONFLICT" as const,
    matches: actualFingerprint === validated.expectedFingerprint,
  };
}

export function buildPrivateKwPersistencePlan(value: PrivateKwImportPlan): PrivateKwPersistencePlan {
  const source = PrivateKwImportPlanSchema.parse(value);
  const preflights: PersistencePreflight[] = [];
  const mutations: z.infer<typeof PersistenceMutationSchema>[] = [];

  for (const run of source.sourceRuns) {
    const expected = {
      id: run.id,
      adapter: run.adapter,
      niche: run.niche,
      city: run.city,
      region: run.region,
      country: run.country,
      geoCell: run.geoCell,
      queryText: run.queryText,
      filtersJson: canonicalJson(run.filters),
      cursor: null,
      status: run.status,
      resultCount: run.recordCount,
      duplicateCount: 0,
      qualifiedCount: 0,
      costUsd: 0,
      startedAt: run.capturedAt,
      completedAt: null,
      cooldownUntil: null,
    };
    preflights.push(preflight(
      "SOURCE_RUN",
      run.id,
      `SELECT ${Object.keys(expected).map((column) => `"${column}"`).join(", ")} FROM "RevenueSourceRun" WHERE "id" = ?`,
      expected,
    ));
    mutations.push(mutation(
      "SOURCE_RUN",
      run.id,
      `INSERT OR IGNORE INTO "RevenueSourceRun" (${Object.keys(expected).map((column) => `"${column}"`).join(", ")}) VALUES (${Object.keys(expected).map(() => "?").join(", ")})`,
      Object.values(expected),
    ));
  }

  for (const record of source.records) {
    const business = {
      id: record.business.id,
      canonicalName: record.business.canonicalName,
      normalizedDomain: record.business.normalizedDomain,
      normalizedPhone: record.business.normalizedPhone,
      independenceStatus: record.business.independenceStatus,
      status: record.business.status,
    };
    preflights.push(preflight(
      "BUSINESS",
      record.business.id,
      `SELECT ${Object.keys(business).map((column) => `"${column}"`).join(", ")} FROM "RevenueBusiness" WHERE "id" = ? OR (? IS NOT NULL AND "normalizedDomain" = ?) OR (? IS NOT NULL AND "normalizedPhone" = ?)`,
      business,
      [record.business.id, record.business.normalizedDomain, record.business.normalizedDomain, record.business.normalizedPhone, record.business.normalizedPhone],
    ));
    mutations.push(mutation(
      "BUSINESS",
      record.business.id,
      `INSERT OR IGNORE INTO "RevenueBusiness" (${Object.keys(business).map((column) => `"${column}"`).join(", ")}) VALUES (${Object.keys(business).map(() => "?").join(", ")})`,
      Object.values(business),
    ));

    const location = {
      id: record.location.id,
      businessId: record.location.businessId,
      addressLine: record.location.addressLine,
      city: record.location.city,
      region: record.location.region,
      country: record.location.country,
      postalCode: record.location.postalCode,
      geoCell: record.location.geoCell,
    };
    preflights.push(preflight(
      "LOCATION",
      record.location.id,
      `SELECT ${Object.keys(location).map((column) => `"${column}"`).join(", ")} FROM "RevenueLocation" WHERE "id" = ?`,
      location,
    ));
    mutations.push(mutation(
      "LOCATION",
      record.location.id,
      `INSERT OR IGNORE INTO "RevenueLocation" (${Object.keys(location).map((column) => `"${column}"`).join(", ")}) VALUES (${Object.keys(location).map(() => "?").join(", ")})`,
      Object.values(location),
    ));

    const rawPayload = canonicalJson({
      sourceEvidenceUrl: record.sourceRecord.sourceEvidenceUrl,
      websiteUrl: record.sourceRecord.websiteUrl,
      niche: record.sourceRecord.niche,
      sourcePayload: record.sourceRecord.sourcePayload,
    });
    const identitySignals = canonicalJson({
      normalizedName: record.business.normalizedName,
      normalizedDomain: record.business.normalizedDomain,
      normalizedPhone: record.business.normalizedPhone,
      normalizedAddress: record.location.normalizedAddress,
      keys: record.sourceRecord.identitySignals,
    });
    const sourceRecord = {
      id: record.sourceRecord.id,
      sourceRunId: record.sourceRecord.sourceRunId,
      sourceOwnedId: record.sourceRecord.sourceOwnedId,
      businessId: record.sourceRecord.businessId,
      rawPayloadJson: rawPayload,
      identitySignalsJson: identitySignals,
      capturedAt: record.sourceRecord.capturedAt,
    };
    preflights.push(preflight(
      "SOURCE_RECORD",
      record.sourceRecord.id,
      `SELECT ${Object.keys(sourceRecord).map((column) => `"${column}"`).join(", ")} FROM "RevenueSourceRecord" WHERE "id" = ? OR ("sourceRunId" = ? AND "sourceOwnedId" = ?)`,
      sourceRecord,
      [record.sourceRecord.id, record.sourceRecord.sourceRunId, record.sourceRecord.sourceOwnedId],
    ));
    mutations.push(mutation(
      "SOURCE_RECORD",
      record.sourceRecord.id,
      `INSERT OR IGNORE INTO "RevenueSourceRecord" (${Object.keys(sourceRecord).map((column) => `"${column}"`).join(", ")}) VALUES (${Object.keys(sourceRecord).map(() => "?").join(", ")})`,
      Object.values(sourceRecord),
    ));
  }

  return PrivateKwPersistencePlanSchema.parse({
    persistencePlanVersion: PRIVATE_KW_PERSISTENCE_PLAN_VERSION,
    targetSchemaVersion: PRIVATE_KW_TARGET_SCHEMA_VERSION,
    sourcePlanVersion: source.planVersion,
    sourceImportId: source.importId,
    sourcePlanDigest: fingerprint(source),
    preflights,
    mutations,
    summary: {
      sourceRuns: source.sourceRuns.length,
      businesses: source.records.length,
      locations: source.records.length,
      sourceRecords: source.records.length,
      totalStatements: mutations.length,
      qualificationRows: 0,
      contactRows: 0,
      outreachRows: 0,
      costUsd: 0,
    },
    requiresExactPreflightMatch: true,
    mutationAuthorized: false,
  });
}
