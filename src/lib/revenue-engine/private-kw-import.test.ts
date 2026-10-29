import assert from "node:assert/strict";
import test from "node:test";

import {
  PRIVATE_KW_IMPORT_VERSION,
  preparePrivateKwImport,
  type PrivateKwImportInput,
} from "@/lib/revenue-engine/private-kw-import";

function inputFixture(): PrivateKwImportInput {
  return {
    importVersion: PRIVATE_KW_IMPORT_VERSION,
    importId: "kw-owner-seed-2026-08-22",
    adapter: "MANUAL_RESEARCH",
    queryText: "Owner-curated KW roofing, HVAC, and landscaping quality set",
    filters: { market: "KW", paidProvider: false },
    capturedAt: "2026-08-22T19:00:00.000Z",
    costUsd: 0,
    records: [
      {
        sourceOwnedId: "manual-002",
        sourceEvidenceUrl: "https://maps.google.ca/?cid=2",
        businessName: "Waterloo Heating Ltd.",
        city: "WATERLOO",
        region: "ON",
        country: "CA",
        niche: "HVAC",
        websiteUrl: "waterloo-heating.ca#contact",
        phone: "(519) 555-0102",
        addressLine: "20 King Street North",
        postalCode: "N2J 2W7",
        independenceStatus: "UNKNOWN",
        capturedAt: "2026-08-22T18:55:00.000Z",
        sourcePayload: { source: "manual", rating: 4.2 },
      },
      {
        sourceOwnedId: "manual-001",
        sourceEvidenceUrl: "https://maps.google.ca/?cid=1",
        businessName: "Cambridge Roofing Inc.",
        city: "CAMBRIDGE",
        region: "ON",
        country: "CA",
        niche: "ROOFING",
        websiteUrl: "https://www.cambridge-roofing.ca/services",
        phone: "+1 519 555 0101",
        addressLine: "10 Main Street",
        postalCode: "N1R5S2",
        independenceStatus: "INDEPENDENT",
        capturedAt: "2026-08-22T18:50:00.000Z",
        sourcePayload: { source: "manual", listingId: "1" },
      },
    ],
  };
}

test("prepares a deterministic, private, outreach-locked KW import plan", () => {
  const result = preparePrivateKwImport(inputFixture());
  assert.equal(result.planVersion, "kw-private-import-plan-v1");
  assert.deepEqual(result.records.map((record) => record.sourceOwnedId), ["manual-001", "manual-002"]);
  assert.equal(result.records[0]?.business.normalizedDomain, "cambridge-roofing.ca");
  assert.equal(result.records[0]?.business.normalizedPhone, "+15195550101");
  assert.equal(result.records[0]?.location.postalCode, "N1R 5S2");
  assert.equal(result.records[0]?.sourceRecord.websiteUrl, "https://www.cambridge-roofing.ca/services");
  assert.equal(result.sourceRuns.length, 2);
  assert.ok(result.sourceRuns.some((run) => run.city === "CAMBRIDGE" && run.niche === "ROOFING"));
  assert.ok(result.sourceRuns.some((run) => run.city === "WATERLOO" && run.niche === "HVAC"));
  assert.ok(result.sourceRuns.some((run) => run.id === result.records[0]?.sourceRecord.sourceRunId));
  assert.equal(result.summary.loaded, 2);
  assert.equal(result.summary.remaining, 48);
  assert.equal(result.summary.readyForAudit, false);
  assert.equal(result.summary.qualificationAuthorized, false);
  assert.equal(result.summary.outreachAuthorized, false);
  assert.equal(result.summary.providerCallsMade, 0);
  assert.equal(result.summary.costUsd, 0);
});

test("record order does not change canonical IDs or the prepared plan", () => {
  const first = inputFixture();
  const second = inputFixture();
  second.records.reverse();
  assert.deepEqual(preparePrivateKwImport(first), preparePrivateKwImport(second));
});

test("duplicate source and business identity signals fail closed", () => {
  const duplicateSource = inputFixture();
  duplicateSource.records[1]!.sourceOwnedId = duplicateSource.records[0]!.sourceOwnedId;
  assert.throws(() => preparePrivateKwImport(duplicateSource), /Duplicate sourceOwnedId/);

  const duplicateDomain = inputFixture();
  duplicateDomain.records[1]!.websiteUrl = duplicateDomain.records[0]!.websiteUrl;
  assert.throws(() => preparePrivateKwImport(duplicateDomain), /Potential duplicate businesses/);

  const duplicatePhone = inputFixture();
  duplicatePhone.records[1]!.phone = duplicatePhone.records[0]!.phone;
  assert.throws(() => preparePrivateKwImport(duplicatePhone), /Potential duplicate businesses/);
});

test("invalid contact-like fields and non-business website hosts are rejected", () => {
  const invalidPhone = inputFixture();
  invalidPhone.records[0]!.phone = "555";
  assert.throws(() => preparePrivateKwImport(invalidPhone), /invalid Canadian phone/);

  const invalidPostal = inputFixture();
  invalidPostal.records[0]!.postalCode = "12345";
  assert.throws(() => preparePrivateKwImport(invalidPostal), /invalid Canadian postal/);

  const socialWebsite = inputFixture();
  socialWebsite.records[0]!.websiteUrl = "https://facebook.com/public-roofer";
  assert.throws(() => preparePrivateKwImport(socialWebsite), /must be source evidence/);

  const withEmail = inputFixture() as PrivateKwImportInput & { records: Array<Record<string, unknown>> };
  withEmail.records[0]!.email = "owner@example.com";
  assert.throws(() => preparePrivateKwImport(withEmail as PrivateKwImportInput));
});

test("paid imports and out-of-market records are not accepted by the seed contract", () => {
  const paid = { ...inputFixture(), costUsd: 1 };
  assert.throws(() => preparePrivateKwImport(paid as unknown as PrivateKwImportInput));

  const wrongCity = inputFixture() as PrivateKwImportInput & { records: Array<Record<string, unknown>> };
  (wrongCity.records[0] as Record<string, unknown>).city = "TORONTO";
  assert.throws(() => preparePrivateKwImport(wrongCity as PrivateKwImportInput));

  const impossibleTimestamp = inputFixture();
  impossibleTimestamp.records[0]!.capturedAt = "2026-08-22T20:00:00.000Z";
  assert.throws(() => preparePrivateKwImport(impossibleTimestamp), /cannot be captured after/);
});
