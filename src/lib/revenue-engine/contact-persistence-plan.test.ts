import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import Database from "better-sqlite3";

import {
  REVENUE_CONTACT_DISCOVERY_VERSION,
  REVENUE_CONTACT_EVIDENCE_VERSION,
  buildFixtureContactDiscoveryResult,
  type RevenueContactDiscoveryRequest,
  type RevenueContactObservation,
} from "@/lib/revenue-engine/contact-discovery";
import {
  buildRevenueContactPersistencePlan,
  evaluateRevenueContactPersistencePlan,
  verifyContactPersistencePreflight,
} from "@/lib/revenue-engine/contact-persistence-plan";
import {
  REVENUE_CONTACT_VERIFICATION_VERSION,
  buildFixtureContactVerificationResult,
  type RevenueContactVerificationObservation,
  type RevenueContactVerificationRequest,
} from "@/lib/revenue-engine/contact-verification";

const BUSINESS_ID = "business-kw-roofing";

function discoveryRequest(hex = "a", requestedAt = "2026-08-27T12:50:00.000Z"): RevenueContactDiscoveryRequest {
  return {
    discoveryVersion: REVENUE_CONTACT_DISCOVERY_VERSION,
    requestId: `contact-discovery-request:${hex.repeat(64)}`,
    idempotencyKey: `kw-contact-discovery-${hex}`,
    businessId: BUSINESS_ID,
    websiteUrl: "https://kwroofing.ca/",
    sourceEvidenceUrl: "https://directory.example.ca/business/kw-roofing",
    requestedAt,
    mode: "SHADOW",
    adapterKind: "FIXTURE",
    limits: { maxCandidates: 10, maxProviderOperations: 0, maxCostUsd: 0 },
    authority: {
      runtimeConnected: false,
      contactPersistenceAuthorized: false,
      verificationAuthorized: false,
      outreachAuthorized: false,
      sendAuthorized: false,
      providerOperationsAuthorized: 0,
      costAuthorizedUsd: 0,
    },
  };
}

function contactObservation(channel: RevenueContactObservation["channel"]): RevenueContactObservation {
  const route = {
    EMAIL: { value: "estimates@kwroofing.ca", method: "HTML_MAILTO", role: "Estimator", recipientKind: "ROLE", socialPlatform: null },
    PHONE: { value: "+15195552345", method: "HTML_TEL", role: null, recipientKind: "BUSINESS", socialPlatform: null },
    FORM: { value: "https://kwroofing.ca/contact", method: "HTML_FORM", role: null, recipientKind: "BUSINESS", socialPlatform: null },
    SOCIAL: { value: "https://www.instagram.com/kwroofing/", method: "HTML_SOCIAL_LINK", role: null, recipientKind: "BUSINESS", socialPlatform: "INSTAGRAM" },
  }[channel] as Pick<RevenueContactObservation, "value" | "role" | "recipientKind" | "socialPlatform"> & { method: RevenueContactObservation["evidence"]["method"] };
  return {
    channel,
    value: route.value,
    label: `${channel} route`,
    personName: null,
    role: route.role,
    recipientKind: route.recipientKind,
    socialPlatform: route.socialPlatform,
    evidence: {
      evidenceVersion: REVENUE_CONTACT_EVIDENCE_VERSION,
      sourceUrl: "https://kwroofing.ca/contact",
      capturedAt: "2026-08-27T12:55:00.000Z",
      method: route.method,
      observation: `The public website exposes its ${channel.toLocaleLowerCase("en-CA")} route.`,
      confidence: 98,
      publication: {
        publiclyPublished: true,
        contraryContactStatement: "NOT_OBSERVED",
        roleRelevance: "RELEVANT",
        consentBasis: "UNASSESSED",
      },
    },
  };
}

function discovery(hex = "a", completedAt = "2026-08-27T13:00:00.000Z") {
  return buildFixtureContactDiscoveryResult({
    request: discoveryRequest(hex),
    observations: ["EMAIL", "PHONE", "FORM", "SOCIAL"].map((channel) => contactObservation(channel as RevenueContactObservation["channel"])),
    completedAt,
  });
}

function verification(
  candidate: ReturnType<typeof discovery>["candidates"][number],
  hex: string,
  verifiedAt = "2026-08-27T13:03:00.000Z",
  completedAt = "2026-08-27T13:04:00.000Z",
) {
  const request: RevenueContactVerificationRequest = {
    verificationVersion: REVENUE_CONTACT_VERIFICATION_VERSION,
    requestId: `contact-verification-request:${hex.repeat(64)}`,
    idempotencyKey: `verification-${hex}-${candidate.candidateId}`,
    businessId: BUSINESS_ID,
    candidate,
    requestedAt: "2026-08-27T13:02:00.000Z",
    mode: "SHADOW",
    verifierKind: "FIXTURE",
    limits: { maxProviderOperations: 0, maxCostUsd: 0 },
    authority: {
      runtimeConnected: false,
      verificationPersistenceAuthorized: false,
      qualificationPersistenceAuthorized: false,
      outreachAuthorized: false,
      sendAuthorized: false,
      providerOperationsAuthorized: 0,
      costAuthorizedUsd: 0,
    },
  };
  const status = candidate.channel === "EMAIL" ? "DELIVERABLE"
    : candidate.channel === "PHONE" ? "PUBLISHED"
      : candidate.channel === "FORM" ? "AVAILABLE"
        : "ACTIVE";
  const observation = {
    channel: candidate.channel,
    status,
    ...(candidate.channel === "EMAIL" ? { catchAll: false } : {}),
    provider: "FIXTURE",
    method: "FIXTURE_RECEIPT",
    evidenceReceiptId: `fixture-verification:${candidate.channel.toLocaleLowerCase("en-CA")}-${hex}`,
    sourceUrl: `https://verification.example.ca/receipts/${hex}`,
    verifiedAt,
    staleAfter: "2026-09-26T13:03:00.000Z",
    confidence: 99,
  } as RevenueContactVerificationObservation;
  return buildFixtureContactVerificationResult({ request, observation, completedAt });
}

async function database() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(await readFile(new URL("../../../migrations/0054_revenue_shadow_kernel.sql", import.meta.url), "utf8"));
  db.exec(await readFile(new URL("../../../migrations/0062_append_only_contact_verification_records.sql", import.meta.url), "utf8"));
  db.exec(await readFile(new URL("../../../migrations/0063_harden_contact_record_lineage.sql", import.meta.url), "utf8"));
  db.prepare(`INSERT INTO "RevenueBusiness" ("id", "canonicalName") VALUES (?, ?)`).run(BUSINESS_ID, "KW Roofing");
  return db;
}

function observations(db: Database.Database, plan: ReturnType<typeof buildRevenueContactPersistencePlan>) {
  return plan.preflights.map((item) => ({
    preflightId: item.preflightId,
    rows: db.prepare(item.selectSql).all(...item.bindings) as Record<string, unknown>[],
  }));
}

function insertPlan(db: Database.Database, plan: ReturnType<typeof buildRevenueContactPersistencePlan>) {
  db.transaction(() => {
    for (const mutation of plan.mutations) {
      const preflight = plan.preflights.find((item) => item.entity === mutation.entity && item.recordId === mutation.recordId)!;
      const state = verifyContactPersistencePreflight(
        preflight,
        db.prepare(preflight.selectSql).all(...preflight.bindings) as Record<string, unknown>[],
      ).state;
      if (state === "CONFLICT") throw new Error(`Test fixture found a contact collision for ${mutation.recordId}.`);
      if (state === "MISSING") db.prepare(mutation.sql).run(...mutation.bindings);
    }
  })();
}

test("builds deterministic evidence-complete append-only rows with zero authority", () => {
  const source = discovery();
  const verifications = source.candidates.map((candidate, index) => verification(candidate, String.fromCharCode(98 + index)));
  const first = buildRevenueContactPersistencePlan({ discovery: source, verifications });
  const second = buildRevenueContactPersistencePlan({ discovery: source, verifications: [...verifications].reverse() });

  assert.deepEqual(first, second);
  assert.equal(first.summary.contactPointVersions, 4);
  assert.equal(first.summary.evidenceClaims, 4);
  assert.equal(first.summary.evidenceUses, 4);
  assert.equal(first.summary.verificationResults, 4);
  assert.equal(first.summary.consentRows, 0);
  assert.equal(first.executorImplemented, false);
  assert.equal(first.databaseAccessAuthorized, false);
  assert.equal(first.mutationAuthorized, false);
  assert.equal(first.outreachAuthorized, false);
  assert.equal(first.sendAuthorized, false);
  assert.ok(first.preflights.every((item) => item.rejectMultipleMatches && !/\bLIMIT\s+1\b/i.test(item.selectSql)));
  assert.ok(first.mutations.every((item) => !/\b(?:UPDATE|DELETE\s+FROM)\b/i.test(item.sql)));
});

test("fresh planning and exact replay compile against schema 0063", async () => {
  const db = await database();
  try {
    const source = discovery();
    const plan = buildRevenueContactPersistencePlan({
      discovery: source,
      verifications: source.candidates.map((candidate, index) => verification(candidate, String.fromCharCode(98 + index))),
    });
    assert.equal(evaluateRevenueContactPersistencePlan(plan, observations(db, plan)).state, "FRESH_PLAN");
    insertPlan(db, plan);
    assert.equal(evaluateRevenueContactPersistencePlan(plan, observations(db, plan)).state, "EXACT_REPLAY");
    assert.equal((db.prepare(`SELECT COUNT(*) count FROM "RevenueContactPoint"`).get() as { count: number }).count, 4);
    assert.equal((db.prepare(`SELECT COUNT(*) count FROM "RevenueVerificationResult"`).get() as { count: number }).count, 4);
    assert.equal((db.prepare(`SELECT COUNT(*) count FROM "RevenueContactEvidenceUse"`).get() as { count: number }).count, 4);
  } finally {
    db.close();
  }
});

test("database guards reject loose inserts, forged verification state, updates, and deletes", async () => {
  const db = await database();
  try {
    assert.throws(() => db.prepare(`INSERT INTO "RevenueContactPoint" ("id", "businessId", "channel", "value") VALUES (?, ?, 'EMAIL', ?)`)
      .run("loose", BUSINESS_ID, "info@kwroofing.ca"), /REVENUE_CONTACT_(?:CONTRACT_REQUIRED|LINEAGE_MISMATCH)/);
    const source = discovery();
    const plan = buildRevenueContactPersistencePlan({ discovery: source, verifications: [verification(source.candidates[0]!, "b")] });
    insertPlan(db, plan);
    assert.throws(() => db.prepare(`UPDATE "RevenueContactPoint" SET "label" = 'changed'`).run(), /REVENUE_CONTACT_APPEND_ONLY/);
    assert.throws(() => db.prepare(`DELETE FROM "RevenueVerificationResult"`).run(), /REVENUE_CONTACT_APPEND_ONLY/);

    const verificationMutation = plan.mutations.find((item) => item.entity === "VERIFICATION_RESULT")!;
    const ownerStatusIndex = verificationMutation.sql.split("VALUES")[0]!.split(",").findIndex((column) => column.includes("ownerStatus"));
    const forged = [...verificationMutation.bindings];
    forged[0] = "forged-verification-row";
    forged[ownerStatusIndex] = "USABLE";
    assert.throws(() => db.prepare(verificationMutation.sql).run(...forged), /REVENUE_CONTACT_VERIFICATION_(?:MISMATCH|PAYLOAD_MISMATCH)/);

    const contactMutation = plan.mutations.find((item) => item.entity === "CONTACT_POINT")!;
    const contactColumns = contactMutation.sql.split("VALUES")[0]!.split(",");
    const forgedContact = [...contactMutation.bindings];
    forgedContact[0] = "forged-contact-version";
    forgedContact[contactColumns.findIndex((column) => column.includes("label"))] = "Forged label";
    assert.throws(() => db.prepare(contactMutation.sql).run(...forgedContact), /REVENUE_CONTACT_LINEAGE_MISMATCH/);

    const evidenceUseMutation = plan.mutations.find((item) => item.entity === "EVIDENCE_USE")!;
    const evidenceUseColumns = evidenceUseMutation.sql.split("VALUES")[0]!.split(",");
    const unrelatedEvidence = plan.mutations.find((item) => item.entity === "EVIDENCE_CLAIM" && item.recordId !== evidenceUseMutation.bindings[3])!;
    const forgedUse = [...evidenceUseMutation.bindings];
    forgedUse[0] = "forged-evidence-use";
    forgedUse[evidenceUseColumns.findIndex((column) => column.includes("evidenceClaimId"))] = unrelatedEvidence.recordId;
    assert.throws(() => db.prepare(evidenceUseMutation.sql).run(...forgedUse), /REVENUE_CONTACT_EVIDENCE_LINEAGE_MISMATCH/);

    const verificationColumns = verificationMutation.sql.split("VALUES")[0]!.split(",");
    const forgedPayload = [...verificationMutation.bindings];
    forgedPayload[0] = "forged-verification-payload";
    forgedPayload[verificationColumns.findIndex((column) => column.includes("detailsJson"))] = "{}";
    assert.throws(() => db.prepare(verificationMutation.sql).run(...forgedPayload), /REVENUE_CONTACT_VERIFICATION_PAYLOAD_MISMATCH/);
  } finally {
    db.close();
  }
});

test("exact collision and incomplete receipt observations fail closed", async () => {
  const db = await database();
  try {
    const plan = buildRevenueContactPersistencePlan({ discovery: discovery() });
    const fresh = observations(db, plan);
    const receipt = plan.preflights.find((item) => item.entity === "DISCOVERY_RECEIPT")!;
    const multiple = fresh.map((item) => item.preflightId === receipt.preflightId
      ? { ...item, rows: [receipt.expected, receipt.expected] }
      : item);
    assert.equal(evaluateRevenueContactPersistencePlan(plan, multiple).state, "BLOCKED");
    assert.deepEqual(verifyContactPersistencePreflight(receipt, [receipt.expected, receipt.expected]), {
      state: "CONFLICT", matches: false, matchCount: 2,
    });

    insertPlan(db, plan);
    const incomplete = observations(db, plan);
    const contact = plan.preflights.find((item) => item.entity === "CONTACT_POINT")!;
    const missingChild = incomplete.map((item) => item.preflightId === contact.preflightId ? { ...item, rows: [] } : item);
    assert.equal(evaluateRevenueContactPersistencePlan(plan, missingChild).state, "BLOCKED");
  } finally {
    db.close();
  }
});

test("plan digest and SQL shape reject tampered control statements", () => {
  const plan = buildRevenueContactPersistencePlan({ discovery: discovery() });
  assert.throws(() => evaluateRevenueContactPersistencePlan({
    ...plan,
    preflights: plan.preflights.map((item, index) => index === 0 ? { ...item, bindings: ["other-business"] } : item),
  }, []), /plan digest/i);
  assert.throws(() => evaluateRevenueContactPersistencePlan({
    ...plan,
    mutations: plan.mutations.map((item, index) => index === 0 ? { ...item, sql: `DELETE FROM "RevenueContactDiscoveryReceipt"` } : item),
  }, []), /append-only INSERT/i);
});

test("stable candidates gain new immutable versions and verification refreshes append", () => {
  const firstDiscovery = discovery("a", "2026-08-27T13:00:00.000Z");
  const secondDiscovery = discovery("f", "2026-08-27T14:00:00.000Z");
  const firstPlan = buildRevenueContactPersistencePlan({ discovery: firstDiscovery });
  const secondPlan = buildRevenueContactPersistencePlan({ discovery: secondDiscovery });
  const firstCandidate = firstDiscovery.candidates[0]!;
  const secondCandidate = secondDiscovery.candidates[0]!;
  assert.equal(firstCandidate.candidateId, secondCandidate.candidateId);
  assert.notEqual(
    firstPlan.mutations.find((item) => item.entity === "CONTACT_POINT")!.recordId,
    secondPlan.mutations.find((item) => item.entity === "CONTACT_POINT")!.recordId,
  );

  const refreshPlan = buildRevenueContactPersistencePlan({
    discovery: firstDiscovery,
    verifications: [
      verification(firstCandidate, "b"),
      verification(firstCandidate, "c", "2026-08-27T13:05:00.000Z", "2026-08-27T13:06:00.000Z"),
    ],
  });
  assert.equal(refreshPlan.summary.verificationResults, 2);
  assert.equal(new Set(refreshPlan.mutations.filter((item) => item.entity === "VERIFICATION_RESULT").map((item) => item.recordId)).size, 2);
});

test("a later discovery reuses exact evidence while appending candidate versions", async () => {
  const db = await database();
  try {
    const firstPlan = buildRevenueContactPersistencePlan({ discovery: discovery("a", "2026-08-27T13:00:00.000Z") });
    const secondPlan = buildRevenueContactPersistencePlan({ discovery: discovery("f", "2026-08-27T14:00:00.000Z") });
    insertPlan(db, firstPlan);
    const decision = evaluateRevenueContactPersistencePlan(secondPlan, observations(db, secondPlan));
    assert.equal(decision.state, "FRESH_PLAN");
    insertPlan(db, secondPlan);
    assert.equal((db.prepare(`SELECT COUNT(*) count FROM "RevenueContactEvidenceClaim"`).get() as { count: number }).count, 4);
    assert.equal((db.prepare(`SELECT COUNT(*) count FROM "RevenueContactPoint"`).get() as { count: number }).count, 8);
  } finally {
    db.close();
  }
});

test("cross-business and pre-discovery verification bundles are rejected", () => {
  const source = discovery();
  const valid = verification(source.candidates[0]!, "b");
  assert.throws(() => buildRevenueContactPersistencePlan({
    discovery: source,
    verifications: [{ ...valid, businessId: "other-business" }],
  }), /verification result identity|exact discovery candidate/i);
  const lateDiscovery = discovery("f", "2026-08-27T13:10:00.000Z");
  assert.throws(() => buildRevenueContactPersistencePlan({
    discovery: lateDiscovery,
    verifications: [verification(lateDiscovery.candidates[0]!, "c")],
  }), /cannot predate contact discovery/i);
});
