import type Database from "better-sqlite3";

import {
  DurableEvidencePersistencePlanSchema,
  verifyDurableEvidencePreflight,
  type DurableEvidencePersistencePlan,
} from "../src/lib/revenue-engine/durable-evidence-persistence-plan";
import {
  FencedEvidenceResumePersistencePlanSchema,
  verifyFencedEvidenceResumePreflight,
  type FencedEvidenceResumePersistencePlan,
} from "../src/lib/revenue-engine/fenced-evidence-resume-persistence-plan";
import {
  ArtifactManifestAvailabilityReceiptSchema,
  type ArtifactManifestAvailabilityReceipt,
} from "../src/lib/revenue-engine/artifact-manifest-availability";
import { artifactReferenceCanonicalJson } from "../src/lib/revenue-engine/artifact-reference-projection";

type SqlValue = string | number | null;

let savepointCounter = 0;

/** Run a local write unit without accidentally nesting BEGIN statements. */
export function runPrivateKwLocalWriteUnit<T>(database: Database.Database, work: () => T): T {
  if (!database.inTransaction) {
    return database.transaction(work).immediate();
  }
  const name = `private_kw_local_${++savepointCounter}`;
  database.exec(`SAVEPOINT "${name}"`);
  try {
    const value = work();
    database.exec(`RELEASE SAVEPOINT "${name}"`);
    return value;
  } catch (error) {
    database.exec(`ROLLBACK TO SAVEPOINT "${name}"`);
    database.exec(`RELEASE SAVEPOINT "${name}"`);
    throw error;
  }
}

/** Async counterpart used when a local adapter deliberately preserves D1's Promise boundary. */
export async function runPrivateKwLocalAsyncWriteUnit<T>(database: Database.Database, work: () => Promise<T>): Promise<T> {
  if (database.inTransaction) {
    const savepoint = `private_kw_local_async_${++savepointCounter}`;
    database.exec(`SAVEPOINT "${savepoint}"`);
    try {
      const value = await work();
      database.exec(`RELEASE SAVEPOINT "${savepoint}"`);
      return value;
    } catch (error) {
      database.exec(`ROLLBACK TO SAVEPOINT "${savepoint}"`);
      database.exec(`RELEASE SAVEPOINT "${savepoint}"`);
      throw error;
    }
  }
  database.exec("BEGIN IMMEDIATE");
  try {
    const value = await work();
    database.exec("COMMIT");
    return value;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

function selectAll(database: Database.Database, sql: string, bindings: readonly SqlValue[]) {
  // The durable planner still emits LIMIT 1 for its ordinary path. The local
  // executor deliberately removes it so alternate identities remain visible.
  const collisionSafeSql = sql.replace(/\s+LIMIT\s+1\s*$/i, "");
  return database.prepare(collisionSafeSql).all(...bindings) as Array<Record<string, unknown>>;
}

function exactPlanMutation(
  database: Database.Database,
  preflight: { entity: string; recordId: string },
  mutation: { entity: string; recordId: string; sql: string; bindings: readonly SqlValue[] },
) {
  if (preflight.entity !== mutation.entity || preflight.recordId !== mutation.recordId) {
    throw new Error(`Local persistence plan mutation does not match preflight ${preflight.entity}|${preflight.recordId}.`);
  }
  const result = database.prepare(mutation.sql).run(...mutation.bindings);
  if (result.changes !== 1) {
    throw new Error(`Local persistence plan mutation ${mutation.entity}|${mutation.recordId} changed ${result.changes} rows; exactly one was required.`);
  }
}

function executePlan(
  database: Database.Database,
  preflights: readonly { entity: string; recordId: string; selectSql: string; bindings: readonly SqlValue[] }[],
  mutations: readonly { entity: string; recordId: string; sql: string; bindings: readonly SqlValue[] }[],
  verify: (preflight: never, rows: Array<Record<string, unknown>>) => { state: "MISSING" | "EXACT_MATCH" | "CONFLICT" },
) {
  const mutationByKey = new Map(mutations.map((mutation) => [`${mutation.entity}|${mutation.recordId}`, mutation]));
  const preflightRows = preflights.map((preflight) => ({
    preflight,
    rows: selectAll(database, preflight.selectSql, preflight.bindings),
  }));
  const decisions = preflightRows.map(({ preflight, rows }) => ({
    preflight,
    rows,
    result: rows.length > 1
      ? { state: "CONFLICT" as const }
      : verify(preflight as never, rows),
  }));
  if (decisions.some(({ result }) => result.state === "CONFLICT")) {
    throw new Error("Local persistence preflight found a duplicate or divergent alternate identity.");
  }
  const missing = decisions.filter(({ result }) => result.state === "MISSING");
  let insertedRows = 0;
  for (const { preflight } of missing) {
    const mutation = mutationByKey.get(`${preflight.entity}|${preflight.recordId}`);
    if (!mutation) throw new Error(`Local persistence plan is missing mutation ${preflight.entity}|${preflight.recordId}.`);
    exactPlanMutation(database, preflight, mutation);
    insertedRows += 1;
  }
  if (insertedRows !== missing.length) throw new Error("Local persistence mutation count did not match missing preflight count.");
  for (const preflight of preflights) {
    const rows = selectAll(database, preflight.selectSql, preflight.bindings);
    const result = verify(preflight as never, rows);
    if (result.state !== "EXACT_MATCH") {
      throw new Error(`Local persistence reload did not exactly match ${preflight.entity}|${preflight.recordId}.`);
    }
  }
  return { executionPath: insertedRows > 0 ? "FRESH_COMMIT" as const : "EXACT_REPLAY" as const, insertedRows };
}

export function executePrivateKwLocalDurableEvidencePlan(
  database: Database.Database,
  value: DurableEvidencePersistencePlan,
) {
  const plan = DurableEvidencePersistencePlanSchema.parse(value);
  return runPrivateKwLocalWriteUnit(database, () => executePlan(
    database,
    plan.preflights,
    plan.mutations,
    (preflight, rows) => verifyDurableEvidencePreflight(preflight, rows[0] ?? null),
  ));
}

export function executePrivateKwLocalFencedEvidenceResumePlan(
  database: Database.Database,
  value: FencedEvidenceResumePersistencePlan,
) {
  const plan = FencedEvidenceResumePersistencePlanSchema.parse(value);
  return runPrivateKwLocalWriteUnit(database, () => executePlan(
    database,
    plan.preflights,
    plan.mutations,
    (preflight, rows) => verifyFencedEvidenceResumePreflight(preflight, rows),
  ));
}

const availabilityRow = (receipt: ArtifactManifestAvailabilityReceipt) => ({
  id: receipt.receiptId,
  availabilityVersion: receipt.availabilityVersion,
  manifestId: receipt.manifestId,
  state: receipt.state,
  checkedAt: receipt.checkedAt,
  validThrough: receipt.validThrough,
  expiresAt: receipt.expiresAt,
  checkerKind: receipt.checkerKind,
  objectSetDigest: receipt.objectSetDigest,
  receiptDigest: receipt.receiptDigest,
  receiptJson: artifactReferenceCanonicalJson(receipt),
  providerReadPerformed: receipt.providerReadPerformed ? 1 : 0,
  providerOperationsAuthorized: 0,
  releaseAuthorized: 0,
  deletionAuthorized: 0,
  costUsd: 0,
});

export function executePrivateKwLocalAvailabilityReceipt(
  database: Database.Database,
  value: ArtifactManifestAvailabilityReceipt,
) {
  const receipt = ArtifactManifestAvailabilityReceiptSchema.parse(value);
  const expected = availabilityRow(receipt);
  return runPrivateKwLocalWriteUnit(database, () => {
    const rows = database.prepare(`SELECT * FROM "RevenueArtifactManifestAvailabilityReceipt"
      WHERE "id" = ? OR "manifestId" = ? ORDER BY "id"`).all(receipt.receiptId, receipt.manifestId) as Array<Record<string, unknown>>;
    if (rows.length > 1) throw new Error("Availability receipt has a duplicate or divergent manifest identity.");
    const comparable = rows[0] && Object.fromEntries(Object.keys(expected).map((key) => [key, rows[0]?.[key] ?? null]));
    const exact = comparable && artifactReferenceCanonicalJson(comparable) === artifactReferenceCanonicalJson(expected);
    if (rows.length === 1 && !exact) throw new Error("Availability receipt conflicts with the durable manifest identity.");
    if (rows.length === 0) {
      const columns = Object.keys(expected);
      const result = database.prepare(`INSERT INTO "RevenueArtifactManifestAvailabilityReceipt" (${columns.map((column) => `"${column}"`).join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`).run(...Object.values(expected));
      if (result.changes !== 1) throw new Error("Availability receipt insert did not change exactly one row.");
    }
    const reloaded = database.prepare(`SELECT * FROM "RevenueArtifactManifestAvailabilityReceipt" WHERE "id" = ? ORDER BY "id"`).all(receipt.receiptId) as Array<Record<string, unknown>>;
    if (reloaded.length !== 1) throw new Error("Availability receipt did not reload exactly one row.");
    const reloadedComparable = Object.fromEntries(Object.keys(expected).map((key) => [key, reloaded[0]?.[key] ?? null]));
    if (artifactReferenceCanonicalJson(reloadedComparable) !== artifactReferenceCanonicalJson(expected)) throw new Error("Availability receipt reload diverged from its canonical receipt.");
    return { executionPath: rows.length === 0 ? "FRESH_COMMIT" as const : "EXACT_REPLAY" as const, insertedRows: rows.length === 0 ? 1 : 0 };
  });
}

export function sqlTables(sql: string) {
  const tables = new Set<string>();
  for (const match of sql.matchAll(/\b(?:FROM|INTO|UPDATE|JOIN)\s+"([A-Za-z0-9_]+)"/gi)) tables.add(match[1]!);
  return tables;
}
