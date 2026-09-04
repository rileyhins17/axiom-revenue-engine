import { readFileSync, readdirSync } from "node:fs";

import Database from "better-sqlite3";

import {
  PRIVATE_KW_AUTHENTICATED_OWNER_DECISION_CONFIRMATION,
  PRIVATE_KW_AUTHENTICATED_OWNER_DECISION_DECLARATION_VERSION,
  buildPrivateKwAuthenticatedOwnerDecisionRecord,
} from "@/lib/revenue-engine/private-kw-authenticated-owner-decision";
import {
  loadPrivateKwAuthenticatedOwnerDecisionD1,
  persistPrivateKwAuthenticatedOwnerDecisionD1,
  type PrivateKwAuthenticatedOwnerDecisionD1Boundary,
  type PrivateKwAuthenticatedOwnerDecisionD1Statement,
} from "@/lib/revenue-engine/private-kw-authenticated-owner-decision-d1";
import {
  createPrivateKwOwnerDossierProgressFixture,
} from "@/lib/revenue-engine/test-support/private-kw-owner-dossier-progress-fixture";

export const SYNTHETIC_OWNER_PROGRESS_BINDING_KEY = Buffer.from(
  "synthetic-owner-progress-authorization-binding-key-v1",
  "utf8",
);
export const SYNTHETIC_OWNER_PROGRESS_BINDING_KEY_VERSION =
  "owner-progress-authorization-key-v1";

function migratedDatabase() {
  const database = new Database(":memory:");
  database.pragma("foreign_keys = ON");
  const migrationRoot = new URL("../../../../migrations/", import.meta.url);
  const migrations = readdirSync(migrationRoot)
    .filter((name) => /^(005[4-9]|006[0-9])_.*\.sql$/.test(name))
    .sort();
  if (
    migrations.length !== 16
    || !migrations[0]?.startsWith("0054_")
    || !migrations.at(-1)?.startsWith("0069_")
  ) {
    throw new Error("Synthetic owner-progress fixture requires migrations 0054-0069.");
  }
  for (const migration of migrations) {
    database.exec(readFileSync(new URL(migration, migrationRoot), "utf8"));
  }
  return database;
}

function insertBusiness(
  database: Database.Database,
  fixture: Awaited<ReturnType<typeof createPrivateKwOwnerDossierProgressFixture>>,
) {
  database.prepare(`INSERT INTO "RevenueBusiness"
    ("id", "canonicalName", "normalizedDomain", "independenceStatus", "status")
    VALUES (?, ?, ?, ?, ?)`)
    .run(
      fixture.ownerDossier.lead.business.businessId,
      fixture.ownerDossier.lead.business.canonicalName,
      fixture.ownerDossier.lead.business.normalizedDomain,
      fixture.ownerDossier.lead.business.independenceStatus,
      "ACTIVE",
    );
}

function createBoundary(database: Database.Database) {
  let calls = 0;
  const transaction = database.transaction((
    statements: readonly PrivateKwAuthenticatedOwnerDecisionD1Statement[],
  ) => statements.map((item) => {
    const prepared = database.prepare(item.sql);
    if (prepared.reader) {
      return {
        success: true,
        results: prepared.all(...item.bindings) as Record<
          string,
          string | number | null
        >[],
        changes: 0,
      };
    }
    const result = prepared.run(...item.bindings);
    return { success: true, results: [], changes: result.changes };
  }));
  const boundary: PrivateKwAuthenticatedOwnerDecisionD1Boundary = {
    async batch(statements) {
      calls += 1;
      return transaction(statements);
    },
  };
  return { boundary, calls: () => calls };
}

export async function createPrivateKwOwnerDossierProgressAuthorizationFixture(
  suffix: string,
) {
  const ownerDossier = await createPrivateKwOwnerDossierProgressFixture({
    suffix,
    now: new Date(Date.now() - 15 * 60_000),
  });
  const decidedAtMs = Date.parse(ownerDossier.acceptance.acceptedAt);
  const authenticatedSession = {
    sessionContractVersion: "better-auth-owner-session-v1",
    authenticationProvider: "BETTER_AUTH",
    authenticatedUserId: `user-owner-riley-${suffix}`,
    authenticatedSessionId: `session-owner-riley-${suffix}`,
    authenticatedEmail: "riley@getaxiom.ca",
    authenticatedEmailVerified: true,
    sessionCreatedAt: new Date(decidedAtMs - 60 * 60_000).toISOString(),
    sessionExpiresAt: new Date(decidedAtMs + 60 * 60_000).toISOString(),
  } as const;
  const dependencies = {
    bindingKey: SYNTHETIC_OWNER_PROGRESS_BINDING_KEY,
    bindingKeyVersion: SYNTHETIC_OWNER_PROGRESS_BINDING_KEY_VERSION,
  };
  const decision = buildPrivateKwAuthenticatedOwnerDecisionRecord({
    manifestValue: ownerDossier.manifest,
    contactReviewProgressCheckpointValue: ownerDossier.contactCheckpoint,
    ownerDossierValue: ownerDossier.ownerDossier,
    declarationValue: {
      declarationVersion:
        PRIVATE_KW_AUTHENTICATED_OWNER_DECISION_DECLARATION_VERSION,
      dossierDigest: ownerDossier.dossierDigest,
      businessId: ownerDossier.ownerDossier.lead.business.businessId,
      decision: "ACCEPTED_FOR_READ_ONLY_SHADOW_PROGRESS",
      rationale: "The exact synthetic dossier is accepted for authorization testing.",
      confirmation: PRIVATE_KW_AUTHENTICATED_OWNER_DECISION_CONFIRMATION,
      mode: "SHADOW",
    },
    authenticatedSessionValue: authenticatedSession,
  }, {
    ...dependencies,
    now: () => new Date(ownerDossier.acceptance.acceptedAt),
  });
  const database = migratedDatabase();
  insertBusiness(database, ownerDossier);
  const injected = createBoundary(database);
  const committed = await persistPrivateKwAuthenticatedOwnerDecisionD1(
    injected.boundary,
    decision,
    authenticatedSession,
    dependencies,
  );
  const durableReload = await loadPrivateKwAuthenticatedOwnerDecisionD1(
    injected.boundary,
    { recordId: decision.recordId, recordDigest: decision.recordDigest },
    dependencies,
  );
  return {
    ownerDossier,
    authenticatedSession,
    decision,
    committed,
    durableReload,
    dependencies,
    database,
    boundaryCalls: injected.calls,
  };
}
