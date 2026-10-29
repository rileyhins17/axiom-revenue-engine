import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildM2WebsiteNeedAssessment, deriveM2WebsiteNeed, verifyM2WebsiteNeedAssessment } from "./m2-website-need-assessment";
import { currentM2WebsiteNeedAssessments, listM2WebsiteNeedAssessments, saveM2WebsiteNeedAssessment } from "./m2-website-need-local-store";
import { buildM2DelegatedTargets, identityDigest } from "./m2-delegated-targets";

const SITE = "https://synthetic.example.invalid/";
const TARGET = { reviewId: "M2-01" as const, businessName: "Synthetic Roofing", approvedWebsiteUrl: SITE, businessIdentityDigest: "a".repeat(64) };
const AT = "2026-09-23T20:00:00.000Z";

function issue(id: number, severity: "CRITICAL" | "MAJOR" | "MINOR", conversionCritical = false, viewport: "DESKTOP" | "PHONE" = "DESKTOP") {
  return { findingId: `F${id}`, pageUrl: SITE, viewport, category: "CONVERSION_PATH", kind: "ISSUE", severity, conversionCritical, confidence: "HIGH", finding: `Synthetic issue number ${id} observed on the homepage.` };
}

function command(overrides: Record<string, unknown> = {}) {
  return {
    commandId: "1b7f6d1e-8f59-4a42-9d0a-0d9b0b0f6a11",
    reviewId: "M2-01",
    pagesViewed: [{ url: SITE, viewedAt: "2026-09-23T19:59:00.000Z", viewports: ["DESKTOP", "PHONE"] }],
    findings: [issue(1, "CRITICAL", true, "PHONE"), issue(2, "MAJOR"), issue(3, "MAJOR")],
    websiteNeed: "REBUILD",
    evidenceConfidence: "HIGH",
    businessFitNote: "Synthetic established operator in the target niche.",
    rationale: "Three serious synthetic issues including one on the quote path.",
    noCopiedOrPersonalData: true,
    ...overrides,
  };
}

test("rebuild requires three serious findings including a conversion-critical one", () => {
  const pages = command().pagesViewed as never;
  assert.equal(deriveM2WebsiteNeed({ pagesViewed: pages, findings: [issue(1, "CRITICAL", true), issue(2, "MAJOR"), issue(3, "MAJOR")] as never }, SITE), "REBUILD");
  assert.equal(deriveM2WebsiteNeed({ pagesViewed: pages, findings: [issue(1, "MAJOR"), issue(2, "MAJOR"), issue(3, "MAJOR")] as never }, SITE), "MINOR_IMPROVEMENT");
  assert.equal(deriveM2WebsiteNeed({ pagesViewed: pages, findings: [issue(1, "MINOR"), issue(2, "MINOR")] as never }, SITE), "MINOR_IMPROVEMENT");
  assert.equal(deriveM2WebsiteNeed({ pagesViewed: pages, findings: [issue(1, "MINOR")] as never }, SITE), "NO_OPPORTUNITY");
  const desktopOnly = [{ url: SITE, viewedAt: AT, viewports: ["DESKTOP"] }] as never;
  assert.equal(deriveM2WebsiteNeed({ pagesViewed: desktopOnly, findings: [issue(1, "CRITICAL", true)] as never }, SITE), "INCOMPLETE");
});

test("a claimed need the findings do not support is rejected", () => {
  assert.throws(() => buildM2WebsiteNeedAssessment(command({ findings: [issue(1, "MINOR")] }), TARGET, AT), /support NO_OPPORTUNITY, not REBUILD/);
});

test("findings must cite a viewed page and width and stay free of contact details", () => {
  const unviewed = { ...issue(4, "MINOR"), pageUrl: `${SITE}about` };
  assert.throws(() => buildM2WebsiteNeedAssessment(command({ findings: [...command().findings as object[], unviewed] }), TARGET, AT), /actually viewed/);
  const withPhone = { ...issue(1, "CRITICAL", true, "PHONE"), finding: "Call the owner at 519-555-0100 for a quote today." };
  assert.throws(() => buildM2WebsiteNeedAssessment(command({ findings: [withPhone, issue(2, "MAJOR"), issue(3, "MAJOR")] }), TARGET, AT), /own words/);
  assert.throws(() => buildM2WebsiteNeedAssessment(command({ pagesViewed: [{ url: "https://other.example.invalid/", viewedAt: AT, viewports: ["DESKTOP", "PHONE"] }] }), TARGET, AT), /approved website origin/);
});

test("assessments stay research-only with delegated attribution and zero authority", () => {
  const record = buildM2WebsiteNeedAssessment(command(), TARGET, AT);
  assert.equal(record.assessedBy, "CLAUDE");
  assert.equal(record.delegatedBy, "RILEY");
  assert.equal(record.qualification, "RESEARCH");
  assert.equal(record.ownerReview, "PENDING_OWNER_CONFIRMATION");
  assert.equal(record.evidenceRetention, "DERIVED_FACTS_ONLY");
  assert.equal(record.authority.outreachAuthorized, false);
  assert.equal(record.authority.costAuthorizedCad, 0);
  assert.throws(() => verifyM2WebsiteNeedAssessment({ ...record, websiteNeed: "NO_OPPORTUNITY" }), /content digest/);
});

test("the store is append-only, idempotent per command and rejects tampering", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "m2-website-need-"));
  try {
    const first = await saveM2WebsiteNeedAssessment(command(), TARGET, { rootDir, clock: () => new Date(AT) });
    assert.equal(first.status, "SAVED");
    const retry = await saveM2WebsiteNeedAssessment(command(), TARGET, { rootDir, clock: () => new Date("2026-09-23T21:00:00.000Z") });
    assert.equal(retry.status, "ALREADY_SAVED");
    assert.equal(retry.assessment.assessmentId, first.assessment.assessmentId);
    await assert.rejects(saveM2WebsiteNeedAssessment(command({ rationale: "A different synthetic rationale for the same key." }), TARGET, { rootDir }), /different website-need assessment/);
    const current = currentM2WebsiteNeedAssessments(await listM2WebsiteNeedAssessments(rootDir), [TARGET, { ...TARGET, reviewId: "M2-02" }]);
    assert.equal(current.size, 1);
    const [file] = (await readdir(rootDir)).filter((name) => name.endsWith(".json"));
    const stored = JSON.parse(await readFile(path.join(rootDir, file!), "utf8")) as Record<string, unknown>;
    await writeFile(path.join(rootDir, file!), JSON.stringify({ ...stored, rationale: "Edited after sealing to change the story." }));
    await assert.rejects(listM2WebsiteNeedAssessments(rootDir), /content digest/);
  } finally { await rm(rootDir, { recursive: true, force: true }); }
});

test("delegated targets require the pinned ledger digest", () => {
  const packet = { status: "READY" as const, packetSha256: "b".repeat(64), supportedAlternates: [], selected: [
    { reviewId: "M2-01", name: "Synthetic Roofing", officialWebsite: SITE, primarySource: SITE, city: "KITCHENER" as const, niche: "ROOFING" as const, independenceClaim: "family owned", accessBlocked: false },
  ] };
  assert.throws(() => buildM2DelegatedTargets(packet, new TextEncoder().encode("{}"), "c".repeat(64)), /recorded digest/);
  assert.equal(identityDigest("M2-01", "Synthetic Roofing", SITE).length, 64);
});
