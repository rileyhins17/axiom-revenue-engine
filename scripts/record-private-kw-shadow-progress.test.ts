import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  PRIVATE_KW_IMPORT_VERSION,
  preparePrivateKwImport,
} from "../src/lib/revenue-engine/private-kw-import";
import { buildPrivateKwPersistencePlan } from "../src/lib/revenue-engine/private-kw-persistence-plan";
import {
  PRIVATE_KW_SHADOW_SLICE_VERSION,
  buildPrivateKwShadowSliceManifest,
} from "../src/lib/revenue-engine/private-kw-shadow-slice";
import {
  PRIVATE_KW_SHADOW_PHASE_RECEIPT_VERSION,
  PrivateKwShadowSliceProgressCheckpointSchema,
} from "../src/lib/revenue-engine/private-kw-shadow-slice-progress";
import { resolvePrivateKwDataPath } from "./private-kw-files";
import { recordPrivateKwShadowProgressFile } from "./record-private-kw-shadow-progress";

const authority = {
  progressRecordingOnly: true as const,
  phaseExecutionAuthorized: false as const,
  liveSourceAuthorized: false as const,
  browserCaptureAuthorized: false as const,
  artifactStorageAuthorized: false as const,
  databaseMutationAuthorized: false as const,
  contactDiscoveryExecutionAuthorized: false as const,
  contactVerificationExecutionAuthorized: false as const,
  consentDecisionAuthorized: false as const,
  qualificationAuthorized: false as const,
  mailboxSyncAuthorized: false as const,
  outreachAuthorized: false as const,
  sendAuthorized: false as const,
  deploymentAuthorized: false as const,
  providerOperationsAuthorized: 0 as const,
  costAuthorizedUsd: 0 as const,
};

test("the progress CLI appends one proof, preserves its parent, and never overwrites", async () => {
  const suffix = randomUUID();
  const manifestRelative = `data/kw-evaluation/test-progress-manifest-${suffix}.json`;
  const sourceReceiptRelative = `data/kw-evaluation/test-progress-source-receipt-${suffix}.json`;
  const sourceOutputRelative = `data/kw-evaluation/test-progress-source-${suffix}.json`;
  const websiteReceiptRelative = `data/kw-evaluation/test-progress-website-receipt-${suffix}.json`;
  const websiteOutputRelative = `data/kw-evaluation/test-progress-website-${suffix}.json`;
  const files = [manifestRelative, sourceReceiptRelative, sourceOutputRelative, websiteReceiptRelative, websiteOutputRelative]
    .map(resolvePrivateKwDataPath);
  const cities = ["KITCHENER", "WATERLOO", "CAMBRIDGE"] as const;
  const niches = ["ROOFING", "HVAC", "LANDSCAPING"] as const;
  const source = preparePrivateKwImport({
    importVersion: PRIVATE_KW_IMPORT_VERSION,
    importId: `progress-${suffix}`,
    adapter: "MANUAL_RESEARCH",
    queryText: "Synthetic progress command cohort",
    filters: { synthetic: true },
    capturedAt: "2026-08-01T15:00:00.000Z",
    costUsd: 0,
    records: Array.from({ length: 10 }, (_, index) => ({
      sourceOwnedId: `progress-${index}`,
      sourceEvidenceUrl: `https://directory.getaxiom.ca/progress-cli-${index}`,
      businessName: `Synthetic Progress CLI Business ${index}`,
      city: cities[index % cities.length],
      region: "ON" as const,
      country: "CA" as const,
      niche: niches[index % niches.length],
      websiteUrl: `https://progress-cli-${index}.getaxiom.ca`,
      phone: `519555${String(4000 + index)}`,
      addressLine: `${index + 1} Checkpoint Street`,
      postalCode: "N2G 1A1",
      independenceStatus: "INDEPENDENT" as const,
      capturedAt: "2026-08-01T14:00:00.000Z",
      sourcePayload: { synthetic: true },
    })),
  });
  const manifest = buildPrivateKwShadowSliceManifest(source, {
    sliceVersion: PRIVATE_KW_SHADOW_SLICE_VERSION,
    sliceKey: `progress-${suffix}`,
    sourceImportId: source.importId,
    sourcePlanDigest: buildPrivateKwPersistencePlan(source).sourcePlanDigest,
    createdAt: "2026-08-03T15:00:00.000Z",
    selections: source.records.map((record) => ({
      businessId: record.business.id,
      evaluationCandidateId: record.evaluationCandidateId,
      sourceReview: {
        decision: "APPROVED_FOR_BOUNDED_SHADOW_SLICE",
        reviewedBy: "RILEY",
        reviewedAt: "2026-08-02T15:00:00.000Z",
        rationale: "Synthetic identity, market, niche, and independence were checked.",
        identityConfirmed: true,
        marketAndNicheConfirmed: true,
        independenceConfirmed: true,
      },
    })),
    mode: "SHADOW",
    authority: {
      planOnly: true,
      liveSourceAuthorized: false,
      browserCaptureAuthorized: false,
      artifactStorageAuthorized: false,
      databaseMutationAuthorized: false,
      contactDiscoveryExecutionAuthorized: false,
      contactVerificationExecutionAuthorized: false,
      consentDecisionAuthorized: false,
      qualificationAuthorized: false,
      mailboxSyncAuthorized: false,
      outreachAuthorized: false,
      sendAuthorized: false,
      deploymentAuthorized: false,
      providerOperationsAuthorized: 0,
      costAuthorizedUsd: 0,
    },
  });
  const record = manifest.records[0];
  const sourceReceipt = {
    receiptVersion: PRIVATE_KW_SHADOW_PHASE_RECEIPT_VERSION,
    manifestId: manifest.manifestId,
    manifestDigest: manifest.manifestDigest,
    businessId: record.businessId,
    evaluationCandidateId: record.evaluationCandidateId,
    phase: "SOURCE_WORKFLOW",
    completedAt: "2026-08-04T15:00:00.000Z",
    proof: {
      proofKind: "SOURCE_WORKFLOW_MATERIALIZATION",
      primaryReceiptId: `kw-materialization:${"1".repeat(64)}`,
      primaryReceiptDigest: "1".repeat(64),
      supportingReceipts: [{
        receiptId: `workflow-receipt:${"3".repeat(64)}`,
        receiptDigest: "3".repeat(64),
      }],
    },
    previousPhaseReceipt: null,
    recordedBy: "CODEX_INTEGRATION_OWNER",
    recordedAt: "2026-08-04T15:05:00.000Z",
    authority,
  } as const;

  try {
    await mkdir(path.dirname(files[0]), { recursive: true });
    await writeFile(files[0], `${JSON.stringify(manifest)}\n`, { encoding: "utf8", flag: "wx" });
    await writeFile(files[1], `${JSON.stringify(sourceReceipt)}\n`, { encoding: "utf8", flag: "wx" });
    const firstResult = await recordPrivateKwShadowProgressFile([
      "--manifest", manifestRelative,
      "--receipt", sourceReceiptRelative,
      "--output", sourceOutputRelative,
    ]);
    assert.equal(firstResult.currentCheckpoint, "SOURCE_WORKFLOW_PERSISTED");
    assert.equal(firstResult.phaseExecutionAuthorized, false);
    const first = PrivateKwShadowSliceProgressCheckpointSchema.parse(JSON.parse(await readFile(files[2], "utf8")));
    assert.equal(first.records[0].phaseReceipts.length, 1);

    const firstPhase = first.records[0].phaseReceipts[0];
    const websiteReceipt = {
      ...sourceReceipt,
      phase: "CURRENT_WEBSITE_EVIDENCE" as const,
      completedAt: "2026-08-05T15:00:00.000Z",
      proof: {
        proofKind: "CURRENT_WEBSITE_EVIDENCE" as const,
        primaryReceiptId: `website-evidence:${"5".repeat(64)}`,
        primaryReceiptDigest: "5".repeat(64),
        supportingReceipts: [{
          receiptId: `website-evidence-eligibility:${"6".repeat(64)}`,
          receiptDigest: "6".repeat(64),
        }],
      },
      previousPhaseReceipt: {
        phaseReceiptId: firstPhase.phaseReceiptId,
        phaseReceiptDigest: firstPhase.phaseReceiptDigest,
      },
      recordedAt: "2026-08-05T15:05:00.000Z",
    };
    await writeFile(files[3], `${JSON.stringify(websiteReceipt)}\n`, { encoding: "utf8", flag: "wx" });
    const secondResult = await recordPrivateKwShadowProgressFile([
      "--manifest", manifestRelative,
      "--previous", sourceOutputRelative,
      "--receipt", websiteReceiptRelative,
      "--output", websiteOutputRelative,
    ]);
    assert.equal(secondResult.currentCheckpoint, "CURRENT_WEBSITE_EVIDENCE_PERSISTED");
    assert.equal(secondResult.parentCheckpointId, first.checkpointId);
    assert.equal(secondResult.completedPhaseReceipts, 2);
    const second = PrivateKwShadowSliceProgressCheckpointSchema.parse(JSON.parse(await readFile(files[4], "utf8")));
    assert.equal(second.records[0].phaseReceipts.length, 2);

    await assert.rejects(
      recordPrivateKwShadowProgressFile([
        "--manifest", manifestRelative,
        "--previous", sourceOutputRelative,
        "--receipt", websiteReceiptRelative,
        "--output", websiteOutputRelative,
      ]),
      /EEXIST/,
    );
    await assert.rejects(
      recordPrivateKwShadowProgressFile([
        "--manifest", manifestRelative,
        "--receipt", sourceReceiptRelative,
        "--output", sourceReceiptRelative,
      ]),
      /must be different files/,
    );
  } finally {
    await Promise.all(files.map((file) => rm(file, { force: true })));
  }
});
