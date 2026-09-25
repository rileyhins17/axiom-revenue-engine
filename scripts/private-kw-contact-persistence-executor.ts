import Database from "better-sqlite3";

import type { RevenueContactDiscoveryResult } from "../src/lib/revenue-engine/contact-discovery";
import {
  PrivateKwContactPersistencePlanSchema,
  buildPrivateKwContactPersistencePlan,
  verifyPrivateKwContactPersistencePreflight,
  type PrivateKwContactPersistenceApproval,
  type PrivateKwContactPersistencePlan,
} from "../src/lib/revenue-engine/private-kw-contact-persistence";
import type { RevenueContactVerificationResult } from "../src/lib/revenue-engine/contact-verification";
import {
  assertCanonicalPrivateKwRevenueSchema,
  assertPrivateKwRequiredTables,
  assertPrivateKwSingleDatabase,
} from "./private-kw-database";

const LOCAL_CONTACT_APPROVAL_CLOCK_SKEW_MS = 5 * 60 * 1_000;

const REQUIRED_TABLES = [
  "RevenueBusiness",
  "RevenueContactDiscoveryReceipt",
  "RevenueContactPoint",
  "RevenueContactEvidenceClaim",
  "RevenueContactEvidenceUse",
  "RevenueVerificationResult",
  "RevenuePrivateKwContactPersistenceReceipt",
] as const;

function assertFreshDatabaseClock(database: Database.Database, recordedAt: string) {
  const row = database.prepare(
    `SELECT strftime('%Y-%m-%dT%H:%M:%fZ', 'now') AS "databaseNow"`,
  ).get() as { databaseNow?: unknown } | undefined;
  if (!row || typeof row.databaseNow !== "string") {
    throw new Error("Local contact persistence could not read the database clock.");
  }
  const driftMs = Math.abs(Date.parse(row.databaseNow) - Date.parse(recordedAt));
  if (!Number.isFinite(driftMs) || driftMs > LOCAL_CONTACT_APPROVAL_CLOCK_SKEW_MS) {
    throw new Error("Fresh local contact persistence approval is outside the database clock window.");
  }
}

export function executePrivateKwContactPersistencePlanForLocalDatabase(
  database: Database.Database,
  value: PrivateKwContactPersistencePlan,
) {
  const plan = PrivateKwContactPersistencePlanSchema.parse(value);
  const execute = database.transaction(() => {
    const states = plan.records.map((record) => {
      const rows = database.prepare(record.selectSql).all(...record.selectBindings) as Record<string, unknown>[];
      return verifyPrivateKwContactPersistencePreflight(record, rows).state;
    });
    const conflictIndex = states.findIndex((state) => state === "CONFLICT");
    if (conflictIndex >= 0) {
      const conflict = plan.records[conflictIndex]!;
      throw new Error(`Private KW contact persistence conflict for ${conflict.entity}:${conflict.recordId}.`);
    }

    const businessIndex = plan.records.findIndex((record) => record.entity === "BUSINESS");
    if (businessIndex < 0 || states[businessIndex] !== "EXACT_MATCH") {
      throw new Error("Private KW contact persistence requires the exact existing business prerequisite.");
    }
    const discoveryIndex = plan.records.findIndex((record) => record.entity === "DISCOVERY_RECEIPT");
    const materializationIndex = plan.records.length - 1;
    const discoveryOwnedIndexes = plan.records
      .map((record, index) => ({ record, index }))
      .filter(({ record }) => record.ownership === "DISCOVERY_OWNED" && record.entity !== "MATERIALIZATION_RECEIPT")
      .map(({ index }) => index);
    const materializationExists = states[materializationIndex] === "EXACT_MATCH";
    const baseRecordsExact = plan.records.every((record, index) =>
      record.entity === "BUSINESS"
      || record.entity === "MATERIALIZATION_RECEIPT"
      || states[index] === "EXACT_MATCH");

    if (materializationExists) {
      if (!baseRecordsExact) {
        throw new Error("A private KW contact persistence receipt exists without its exact complete row set.");
      }
      return {
        executionPath: "EXACT_REPLAY" as const,
        insertedRows: { contact: 0, verification: 0, materializationReceipts: 0 },
      };
    }
    if (baseRecordsExact) {
      throw new Error("An exact contact bundle exists without its local materialization receipt.");
    }
    const discoveryExists = discoveryIndex >= 0 && states[discoveryIndex] === "EXACT_MATCH";
    if (
      discoveryExists
      || discoveryOwnedIndexes.some((index) => states[index] !== "MISSING")
    ) {
      throw new Error("A partial discovery-owned contact bundle cannot be repaired by local persistence.");
    }

    assertFreshDatabaseClock(database, plan.recordedAt);
    const missing = plan.records.filter((_, index) => states[index] === "MISSING");
    if (missing.at(-1)?.entity !== "MATERIALIZATION_RECEIPT") {
      throw new Error("Fresh local contact persistence must commit its materialization receipt last.");
    }
    for (const record of missing) {
      if (record.operation !== "INSERT_APPEND_ONLY" || record.insertSql === null) {
        throw new Error(`Private KW contact persistence cannot mutate prerequisite ${record.entity}:${record.recordId}.`);
      }
      const result = database.prepare(record.insertSql).run(...record.insertBindings);
      if (result.changes !== 1) {
        throw new Error(`Private KW contact persistence insert did not create exactly one row (${record.entity}:${record.recordId}).`);
      }
    }
    for (const record of plan.records) {
      const rows = database.prepare(record.selectSql).all(...record.selectBindings) as Record<string, unknown>[];
      if (verifyPrivateKwContactPersistencePreflight(record, rows).state !== "EXACT_MATCH") {
        throw new Error(`Committed private KW contact persistence row failed exact reload (${record.entity}:${record.recordId}).`);
      }
    }
    return {
      executionPath: "FRESH_COMMIT" as const,
      insertedRows: {
        contact: missing.filter((record) => [
          "DISCOVERY_RECEIPT",
          "CONTACT_POINT",
          "EVIDENCE_CLAIM",
          "EVIDENCE_USE",
        ].includes(record.entity)).length,
        verification: missing.filter((record) => record.entity === "VERIFICATION_RESULT").length,
        materializationReceipts: 1,
      },
    };
  });
  return execute.immediate();
}

export function executePrivateKwContactPersistenceForLocalDatabase(
  database: Database.Database,
  input: {
    discovery: RevenueContactDiscoveryResult;
    verifications?: readonly RevenueContactVerificationResult[];
    approval: PrivateKwContactPersistenceApproval;
  },
) {
  assertPrivateKwSingleDatabase(database);
  assertPrivateKwRequiredTables(database, REQUIRED_TABLES, "contact persistence");
  assertCanonicalPrivateKwRevenueSchema(database);
  const plan = buildPrivateKwContactPersistencePlan(input);
  const result = executePrivateKwContactPersistencePlanForLocalDatabase(database, plan);
  return {
    materializationId: plan.materializationId,
    discoveryResultId: plan.discoveryResultId,
    verificationResultIds: plan.verificationResultIds,
    executionPath: result.executionPath,
    insertedRows: result.insertedRows,
    committedAndReloaded: true as const,
    localOnly: true as const,
    contactDiscoveryAuthorized: false as const,
    contactVerificationAuthorized: false as const,
    consentDecisionAuthorized: false as const,
    qualificationAuthorized: false as const,
    outreachAuthorized: false as const,
    sendAuthorized: false as const,
    providerOperationsAuthorized: 0 as const,
    costAuthorizedUsd: 0 as const,
  };
}
