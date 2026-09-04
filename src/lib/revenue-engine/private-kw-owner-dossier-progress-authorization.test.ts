import assert from "node:assert/strict";
import test from "node:test";

import {
  PRIVATE_KW_OWNER_DOSSIER_PROGRESS_AUTHORIZATION_VERSION,
  buildPrivateKwOwnerDossierProgressAuthorization,
  requireInProcessPrivateKwOwnerDossierProgressAuthorization,
} from "@/lib/revenue-engine/private-kw-owner-dossier-progress-authorization";
import {
  artifactReferenceCanonicalJson,
} from "@/lib/revenue-engine/artifact-reference-projection";
import {
  createPrivateKwOwnerDossierProgressAuthorizationFixture,
} from "@/lib/revenue-engine/test-support/private-kw-owner-dossier-progress-authorization-fixture";

function authorizationNow(databaseNow: string, offsetMs = 1_000) {
  return new Date(Date.parse(databaseNow) + offsetMs);
}

test("authorizes only an exact durable reload with the same current verified owner session", async () => {
  const fixture = await createPrivateKwOwnerDossierProgressAuthorizationFixture(
    "authorization-success",
  );
  const callsBeforeAuthorization = fixture.boundaryCalls();
  const authorization = buildPrivateKwOwnerDossierProgressAuthorization({
    durableDecisionResultValue: fixture.durableReload,
    currentServerSessionValue: fixture.authenticatedSession,
  }, {
    ...fixture.dependencies,
    now: () => authorizationNow(fixture.durableReload.databaseNow),
  });

  assert.equal(
    authorization.authorizationVersion,
    PRIVATE_KW_OWNER_DOSSIER_PROGRESS_AUTHORIZATION_VERSION,
  );
  assert.equal(authorization.authorizationKind, "OWNER_DOSSIER_PROGRESS_AUTHORIZATION");
  assert.equal(authorization.state, "VALIDATED_NOT_ACTIVATED");
  assert.equal(authorization.decision.executionPath, "DURABLE_RELOAD");
  assert.equal(authorization.decision.recordId, fixture.decision.recordId);
  assert.equal(authorization.businessId, fixture.decision.businessId);
  assert.equal(authorization.currentSession.authenticatedOwner, "RILEY");
  assert.equal(authorization.currentSession.emailVerified, true);
  assert.equal(authorization.currentSession.bindingIntegrityVerified, true);
  assert.equal(authorization.progress.phase, "OWNER_DOSSIER");
  assert.equal(
    authorization.progress.primaryReceiptId,
    fixture.decision.acceptanceProof.proofId,
  );
  assert.equal(authorization.authority.phaseInputCreationAuthorized, false);
  assert.equal(authorization.authority.progressReceiptCreationAuthorized, false);
  assert.equal(authorization.authority.phaseAdvancementAuthorized, false);
  assert.equal(authorization.authority.databaseReadAuthorized, false);
  assert.equal(authorization.authority.databaseMutationAuthorized, false);
  assert.equal(authorization.authority.outreachAuthorized, false);
  assert.equal(authorization.authority.sendAuthorized, false);
  assert.equal(authorization.authority.providerOperationsAuthorized, 0);
  assert.equal(authorization.authority.costAuthorizedUsd, 0);
  assert.equal(Object.isFrozen(authorization), true);
  assert.equal(Object.isFrozen(authorization.currentSession), true);
  assert.equal(
    requireInProcessPrivateKwOwnerDossierProgressAuthorization(authorization),
    authorization,
  );
  assert.equal(fixture.boundaryCalls(), callsBeforeAuthorization);

  const serialized = artifactReferenceCanonicalJson(authorization);
  assert.doesNotMatch(serialized, /user-owner-riley|session-owner-riley|riley@getaxiom\.ca/);
  assert.doesNotMatch(serialized, /synthetic-owner-progress-authorization-binding-key/);
  fixture.database.close();
});

test("rejects copied durable results, non-reload results, and copied authorizations", async () => {
  const fixture = await createPrivateKwOwnerDossierProgressAuthorizationFixture(
    "authorization-provenance",
  );
  const build = (durableDecisionResultValue: unknown) => (
    buildPrivateKwOwnerDossierProgressAuthorization({
      durableDecisionResultValue,
      currentServerSessionValue: fixture.authenticatedSession,
    }, {
      ...fixture.dependencies,
      now: () => authorizationNow(fixture.durableReload.databaseNow),
    })
  );

  assert.throws(() => build(structuredClone(fixture.durableReload)), /exact in-process.*durable.*reload/i);
  assert.throws(() => build(fixture.committed), /process-loss durable reload/i);
  const authorization = build(fixture.durableReload);
  assert.throws(
    () => requireInProcessPrivateKwOwnerDossierProgressAuthorization(
      structuredClone(authorization),
    ),
    /exact in-process owner-dossier progress authorization/i,
  );
  fixture.database.close();
});

test("rejects changed, unverified, unauthorized, expired, or wrongly bound sessions", async () => {
  const fixture = await createPrivateKwOwnerDossierProgressAuthorizationFixture(
    "authorization-session",
  );
  const build = (
    session: unknown,
    dependencies: typeof fixture.dependencies = fixture.dependencies,
  ) => buildPrivateKwOwnerDossierProgressAuthorization({
    durableDecisionResultValue: fixture.durableReload,
    currentServerSessionValue: session,
  }, {
    ...dependencies,
    now: () => authorizationNow(fixture.durableReload.databaseNow),
  });

  assert.throws(() => build({
    ...fixture.authenticatedSession,
    authenticatedSessionId: "changed-session",
  }), /session binding/i);
  assert.throws(() => build({
    ...fixture.authenticatedSession,
    authenticatedEmailVerified: false,
  }), /authenticatedEmailVerified|verified/i);
  assert.throws(() => build({
    ...fixture.authenticatedSession,
    authenticatedEmail: "intruder@getaxiom.ca",
  }), /authorized Axiom owner|binding/i);
  assert.throws(() => build(fixture.authenticatedSession, {
    ...fixture.dependencies,
    bindingKey: Buffer.from("different-synthetic-owner-progress-binding-key-v2"),
  }), /binding integrity|HMAC/i);
  assert.throws(() => build(fixture.authenticatedSession, {
    ...fixture.dependencies,
    bindingKeyVersion: "owner-progress-authorization-key-v2",
  }), /key version|binding/i);
  fixture.database.close();
});

test("requires authorization immediately after the durable reload and inside the session window", async () => {
  const fixture = await createPrivateKwOwnerDossierProgressAuthorizationFixture(
    "authorization-chronology",
  );
  const buildAt = (now: Date) => buildPrivateKwOwnerDossierProgressAuthorization({
    durableDecisionResultValue: fixture.durableReload,
    currentServerSessionValue: fixture.authenticatedSession,
  }, {
    ...fixture.dependencies,
    now: () => now,
  });

  assert.throws(
    () => buildAt(authorizationNow(fixture.durableReload.databaseNow, -1)),
    /cannot predate the durable reload/i,
  );
  assert.throws(
    () => buildAt(authorizationNow(fixture.durableReload.databaseNow, 61_000)),
    /fresh durable reload/i,
  );
  assert.throws(
    () => buildAt(new Date(fixture.authenticatedSession.sessionExpiresAt)),
    /current at authorization time/i,
  );
  fixture.database.close();
});
