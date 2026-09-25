import { createHash } from "node:crypto";

import { z } from "zod";

import {
  KW_LEAD_EVALUATION_TARGET_SIZE,
  KwEvaluationCitySchema,
  KwEvaluationNicheSchema,
} from "@/lib/revenue-engine/lead-quality-evaluation";
import {
  normalizePublicWebsiteUrl,
} from "@/lib/revenue-engine/public-website-url";

export const PRIVATE_KW_IMPORT_VERSION = "kw-private-seed-v1";
export const PRIVATE_KW_IMPORT_PLAN_VERSION = "kw-private-import-plan-v1";

const PrimitiveSourceValueSchema = z.union([
  z.string().max(1_000),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);

const PrivateSourcePayloadSchema = z
  .record(z.string().trim().min(1).max(100), PrimitiveSourceValueSchema)
  .superRefine((value, context) => {
    if (Object.keys(value).length > 50) {
      context.addIssue({ code: "custom", message: "A source payload may contain at most 50 fields." });
    }
    if (new TextEncoder().encode(JSON.stringify(value)).byteLength > 20_000) {
      context.addIssue({ code: "custom", message: "A source payload may contain at most 20 KB." });
    }
  });

const PrivateKwSourceRecordSchema = z
  .object({
    sourceOwnedId: z.string().trim().min(1).max(200),
    sourceEvidenceUrl: z.string().trim().min(1).max(2_048),
    businessName: z.string().trim().min(1).max(256),
    city: KwEvaluationCitySchema,
    region: z.literal("ON"),
    country: z.literal("CA"),
    niche: KwEvaluationNicheSchema,
    websiteUrl: z.string().trim().min(1).max(2_048).nullable(),
    phone: z.string().trim().min(1).max(40).nullable(),
    addressLine: z.string().trim().min(1).max(300).nullable(),
    postalCode: z.string().trim().min(1).max(20).nullable(),
    independenceStatus: z.enum(["UNKNOWN", "INDEPENDENT", "CHAIN", "FRANCHISE"]),
    capturedAt: z.string().datetime({ offset: true }),
    sourcePayload: PrivateSourcePayloadSchema,
  })
  .strict();

export const PrivateKwImportInputSchema = z
  .object({
    importVersion: z.literal(PRIVATE_KW_IMPORT_VERSION),
    importId: z.string().trim().min(8).max(128).regex(/^[a-z0-9][a-z0-9._-]+$/),
    adapter: z.enum(["MANUAL_RESEARCH", "LEGACY_READ_ONLY_EXPORT"]),
    queryText: z.string().trim().min(1).max(500),
    filters: PrivateSourcePayloadSchema,
    capturedAt: z.string().datetime({ offset: true }),
    costUsd: z.literal(0),
    records: z.array(PrivateKwSourceRecordSchema).min(1).max(KW_LEAD_EVALUATION_TARGET_SIZE),
  })
  .strict()
  .superRefine((input, context) => {
    const runCapturedAt = Date.parse(input.capturedAt);
    input.records.forEach((record, index) => {
      if (Date.parse(record.capturedAt) > runCapturedAt) {
        context.addIssue({
          code: "custom",
          message: "A source record cannot be captured after its enclosing source run.",
          path: ["records", index, "capturedAt"],
        });
      }
    });
  });

export type PrivateKwImportInput = z.infer<typeof PrivateKwImportInputSchema>;

const IdentitySignalsSchema = z
  .object({
    nameCity: z.string().min(1).max(80),
    domain: z.string().min(1).max(80).optional(),
    phone: z.string().min(1).max(80).optional(),
    nameAddressCity: z.string().min(1).max(80).optional(),
  })
  .strict();

const PreparedSourceRunSchema = z
  .object({
    id: z.string().min(1).max(80),
    adapter: z.enum(["MANUAL_RESEARCH", "LEGACY_READ_ONLY_EXPORT"]),
    city: KwEvaluationCitySchema,
    region: z.literal("ON"),
    country: z.literal("CA"),
    niche: KwEvaluationNicheSchema,
    geoCell: z.null(),
    queryText: z.string().min(1).max(500),
    filters: PrivateSourcePayloadSchema,
    capturedAt: z.string().datetime({ offset: true }),
    costUsd: z.literal(0),
    recordCount: z.number().int().positive().max(KW_LEAD_EVALUATION_TARGET_SIZE),
    status: z.literal("PREPARED"),
  })
  .strict();

const PreparedPrivateKwRecordSchema = z
  .object({
    sourceOwnedId: z.string().min(1).max(200),
    niche: KwEvaluationNicheSchema,
    business: z
      .object({
        id: z.string().min(1).max(80),
        canonicalName: z.string().min(1).max(256),
        normalizedName: z.string().min(1).max(256),
        normalizedDomain: z.string().min(1).max(253).nullable(),
        normalizedPhone: z.string().regex(/^\+1\d{10}$/).nullable(),
        independenceStatus: z.enum(["UNKNOWN", "INDEPENDENT", "CHAIN", "FRANCHISE"]),
        status: z.literal("RESEARCH_ONLY"),
      })
      .strict(),
    location: z
      .object({
        id: z.string().min(1).max(80),
        businessId: z.string().min(1).max(80),
        addressLine: z.string().min(1).max(300).nullable(),
        normalizedAddress: z.string().min(1).max(300).nullable(),
        city: KwEvaluationCitySchema,
        region: z.literal("ON"),
        country: z.literal("CA"),
        postalCode: z.string().regex(/^[A-Z]\d[A-Z] \d[A-Z]\d$/).nullable(),
        geoCell: z.null(),
      })
      .strict(),
    sourceRecord: z
      .object({
        id: z.string().min(1).max(80),
        sourceOwnedId: z.string().min(1).max(200),
        sourceRunId: z.string().min(1).max(80),
        businessId: z.string().min(1).max(80),
        niche: KwEvaluationNicheSchema,
        sourceEvidenceUrl: z.string().url(),
        websiteUrl: z.string().url().nullable(),
        identitySignals: IdentitySignalsSchema,
        sourcePayload: PrivateSourcePayloadSchema,
        capturedAt: z.string().datetime({ offset: true }),
      })
      .strict(),
    evaluationCandidateId: z.string().min(1).max(80),
  })
  .strict();

export const PrivateKwImportPlanSchema = z
  .object({
    planVersion: z.literal(PRIVATE_KW_IMPORT_PLAN_VERSION),
    importId: z.string().min(8).max(128),
    market: z.literal("KITCHENER_WATERLOO_CAMBRIDGE"),
    sourceRuns: z.array(PreparedSourceRunSchema).min(1).max(9),
    records: z.array(PreparedPrivateKwRecordSchema).min(1).max(KW_LEAD_EVALUATION_TARGET_SIZE),
    summary: z
      .object({
        loaded: z.number().int().min(1).max(KW_LEAD_EVALUATION_TARGET_SIZE),
        remaining: z.number().int().min(0).max(KW_LEAD_EVALUATION_TARGET_SIZE - 1),
        countsByCity: z.object({
          KITCHENER: z.number().int().nonnegative(),
          WATERLOO: z.number().int().nonnegative(),
          CAMBRIDGE: z.number().int().nonnegative(),
        }).strict(),
        countsByNiche: z.object({
          ROOFING: z.number().int().nonnegative(),
          HVAC: z.number().int().nonnegative(),
          LANDSCAPING: z.number().int().nonnegative(),
        }).strict(),
        balanced: z.boolean(),
        readyForAudit: z.boolean(),
        qualificationAuthorized: z.literal(false),
        outreachAuthorized: z.literal(false),
        providerCallsMade: z.literal(0),
        costUsd: z.literal(0),
      })
      .strict(),
  })
  .strict()
  .superRefine((plan, context) => {
    const sourceRuns = new Map(plan.sourceRuns.map((run) => [run.id, run]));
    const uniqueBusinesses = new Set(plan.records.map((record) => record.business.id));
    const uniqueCandidates = new Set(plan.records.map((record) => record.evaluationCandidateId));
    if (uniqueBusinesses.size !== plan.records.length || uniqueCandidates.size !== plan.records.length) {
      context.addIssue({ code: "custom", message: "Prepared business and candidate IDs must be unique.", path: ["records"] });
    }
    plan.records.forEach((record, index) => {
      const sourceRun = sourceRuns.get(record.sourceRecord.sourceRunId);
      if (
        record.location.businessId !== record.business.id ||
        record.sourceRecord.businessId !== record.business.id ||
        record.sourceRecord.sourceOwnedId !== record.sourceOwnedId ||
        record.sourceRecord.niche !== record.niche ||
        !sourceRun ||
        sourceRun.city !== record.location.city ||
        sourceRun.niche !== record.niche
      ) {
        context.addIssue({ code: "custom", message: "Prepared record relationships are inconsistent.", path: ["records", index] });
      }
    });
    if (
      plan.summary.loaded !== plan.records.length ||
      plan.summary.remaining !== KW_LEAD_EVALUATION_TARGET_SIZE - plan.records.length
    ) {
      context.addIssue({ code: "custom", message: "Prepared import summary does not match its records.", path: ["summary"] });
    }
  });

export type PrivateKwImportPlan = z.infer<typeof PrivateKwImportPlanSchema>;

const NON_BUSINESS_WEBSITE_HOSTS = [
  "facebook.com",
  "instagram.com",
  "linkedin.com",
  "x.com",
  "twitter.com",
  "google.com",
  "google.ca",
  "yelp.com",
  "yellowpages.ca",
];

function shortHash(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 24);
}

function normalizedBusinessName(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en-CA")
    .replace(/&/g, " and ")
    .replace(/\b(incorporated|inc|limited|ltd|corporation|corp)\b\.?/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizedAddress(value: string | null) {
  if (!value) return null;
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en-CA")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ") || null;
}

function normalizedPostalCode(value: string | null) {
  if (!value) return null;
  const compact = value.toLocaleUpperCase("en-CA").replace(/\s+/g, "");
  if (!/^[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z]\d[ABCEGHJ-NPRSTV-Z]\d$/.test(compact)) {
    return null;
  }
  return `${compact.slice(0, 3)} ${compact.slice(3)}`;
}

function normalizedCanadianPhone(value: string | null) {
  if (!value) return null;
  const digits = value.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

function normalizedWebsite(value: string | null) {
  if (!value) return { url: null, domain: null };
  const url = normalizePublicWebsiteUrl(value);
  const hostname = new URL(url).hostname.replace(/^www\./, "");
  if (NON_BUSINESS_WEBSITE_HOSTS.some((host) => hostname === host || hostname.endsWith(`.${host}`))) {
    throw new Error("A listing or social profile must be source evidence, not the business website.");
  }
  return { url, domain: hostname };
}

function normalizeSourceEvidenceUrl(value: string) {
  return normalizePublicWebsiteUrl(value);
}

function signalMap(input: {
  normalizedName: string;
  city: z.infer<typeof KwEvaluationCitySchema>;
  normalizedDomain: string | null;
  normalizedPhone: string | null;
  normalizedAddress: string | null;
}) {
  const signals: Record<string, string> = {
    nameCity: `name-city:${shortHash(`${input.normalizedName}|${input.city}`)}`,
  };
  if (input.normalizedDomain) signals.domain = `domain:${shortHash(input.normalizedDomain)}`;
  if (input.normalizedPhone) signals.phone = `phone:${shortHash(input.normalizedPhone)}`;
  if (input.normalizedAddress) {
    signals.nameAddressCity = `name-address-city:${shortHash(`${input.normalizedName}|${input.normalizedAddress}|${input.city}`)}`;
  }
  return signals;
}

function primaryIdentitySignal(signals: Record<string, string>) {
  return signals.domain || signals.phone || signals.nameAddressCity || signals.nameCity;
}

export function preparePrivateKwImport(value: PrivateKwImportInput) {
  const input = PrivateKwImportInputSchema.parse(value);
  const seenSourceIds = new Set<string>();
  const seenIdentitySignals = new Map<string, string>();
  const prepared = [...input.records]
    .sort((left, right) => left.sourceOwnedId.localeCompare(right.sourceOwnedId, "en-CA"))
    .map((record, index) => {
      if (seenSourceIds.has(record.sourceOwnedId)) {
        throw new Error(`Duplicate sourceOwnedId at sorted record ${index + 1}.`);
      }
      seenSourceIds.add(record.sourceOwnedId);

      const normalizedName = normalizedBusinessName(record.businessName);
      if (!normalizedName) throw new Error(`Business ${record.sourceOwnedId} has no usable normalized name.`);
      const website = normalizedWebsite(record.websiteUrl);
      const phone = normalizedCanadianPhone(record.phone);
      if (record.phone && !phone) throw new Error(`Business ${record.sourceOwnedId} has an invalid Canadian phone number.`);
      const postalCode = normalizedPostalCode(record.postalCode);
      if (record.postalCode && !postalCode) throw new Error(`Business ${record.sourceOwnedId} has an invalid Canadian postal code.`);
      const address = normalizedAddress(record.addressLine);
      const sourceEvidenceUrl = normalizeSourceEvidenceUrl(record.sourceEvidenceUrl);
      const signals = signalMap({
        normalizedName,
        city: record.city,
        normalizedDomain: website.domain,
        normalizedPhone: phone,
        normalizedAddress: address,
      });

      for (const signal of Object.values(signals)) {
        const existing = seenIdentitySignals.get(signal);
        if (existing) {
          throw new Error(`Potential duplicate businesses ${existing} and ${record.sourceOwnedId} share identity signal ${signal}.`);
        }
        seenIdentitySignals.set(signal, record.sourceOwnedId);
      }

      const businessId = `business:${shortHash(primaryIdentitySignal(signals))}`;
      return {
        sourceOwnedId: record.sourceOwnedId,
        niche: record.niche,
        business: {
          id: businessId,
          canonicalName: record.businessName,
          normalizedName,
          normalizedDomain: website.domain,
          normalizedPhone: phone,
          independenceStatus: record.independenceStatus,
          status: "RESEARCH_ONLY" as const,
        },
        location: {
          id: `location:${shortHash(`${businessId}|${record.city}|${address || ""}|${postalCode || ""}`)}`,
          businessId,
          addressLine: record.addressLine,
          normalizedAddress: address,
          city: record.city,
          region: record.region,
          country: record.country,
          postalCode,
          geoCell: null,
        },
        sourceRecord: {
          id: `source-record:${shortHash(`${input.importId}|${input.adapter}|${record.sourceOwnedId}`)}`,
          sourceOwnedId: record.sourceOwnedId,
          businessId,
          sourceEvidenceUrl,
          websiteUrl: website.url,
          identitySignals: signals,
          sourcePayload: record.sourcePayload,
          capturedAt: record.capturedAt,
        },
      };
    });

  const countsByCity = Object.fromEntries(
    KwEvaluationCitySchema.options.map((city) => [
      city,
      prepared.filter((record) => record.location.city === city).length,
    ]),
  );
  const countsByNiche = Object.fromEntries(
    KwEvaluationNicheSchema.options.map((niche) => [
      niche,
      input.records.filter((record) => record.niche === niche).length,
    ]),
  );
  const balanced = Object.values(countsByCity).every((count) => count >= 10)
    && Object.values(countsByNiche).every((count) => count >= 10);
  const sourceRuns = KwEvaluationCitySchema.options.flatMap((city) =>
    KwEvaluationNicheSchema.options
      .map((niche) => {
        const recordCount = prepared.filter(
          (record) => record.location.city === city && record.niche === niche,
        ).length;
        if (recordCount === 0) return null;
        return {
          id: `source-run:${shortHash(`${input.importId}|${city}|${niche}`)}`,
          adapter: input.adapter,
          city,
          region: "ON" as const,
          country: "CA" as const,
          niche,
          geoCell: null,
          queryText: input.queryText,
          filters: input.filters,
          capturedAt: input.capturedAt,
          costUsd: 0,
          recordCount,
          status: "PREPARED" as const,
        };
      })
      .filter((run) => run !== null),
  );
  const sourceRunIdByCohort = new Map(
    sourceRuns.map((run) => [`${run.city}|${run.niche}`, run.id]),
  );

  return PrivateKwImportPlanSchema.parse({
    planVersion: PRIVATE_KW_IMPORT_PLAN_VERSION,
    importId: input.importId,
    market: "KITCHENER_WATERLOO_CAMBRIDGE" as const,
    sourceRuns,
    records: prepared.map((record) => ({
      ...record,
      sourceRecord: {
        ...record.sourceRecord,
        sourceRunId: sourceRunIdByCohort.get(`${record.location.city}|${record.niche}`)!,
        niche: record.niche,
      },
      evaluationCandidateId: `evaluation-candidate:${shortHash(`${input.importId}|${record.business.id}`)}`,
    })),
    summary: {
      loaded: prepared.length,
      remaining: KW_LEAD_EVALUATION_TARGET_SIZE - prepared.length,
      countsByCity,
      countsByNiche,
      balanced,
      readyForAudit: prepared.length === KW_LEAD_EVALUATION_TARGET_SIZE && balanced,
      qualificationAuthorized: false,
      outreachAuthorized: false,
      providerCallsMade: 0,
      costUsd: 0,
    },
  });
}
