import assert from "node:assert/strict";

import type { D1DatabaseLike, D1PreparedStatementLike } from "@/lib/cloudflare";
import {
  readOwnerLeadDetail,
} from "@/lib/revenue-engine/owner-lead-detail-read-model";
import {
  buildPrivateKwContactReviewProgressInput,
} from "@/lib/revenue-engine/private-kw-contact-review-progress";
import {
  appendPrivateKwContactReviewProgress,
} from "@/lib/revenue-engine/private-kw-contact-review-progress-append";
import {
  buildPrivateKwContactInvocationReceiptRow,
} from "@/lib/revenue-engine/private-kw-contact-invocation";
import {
  PRIVATE_KW_OWNER_DOSSIER_ACCEPTANCE_CONFIRMATION,
  PRIVATE_KW_OWNER_DOSSIER_ACCEPTANCE_DECISION_VERSION,
  privateKwOwnerDossierDigest,
} from "@/lib/revenue-engine/private-kw-owner-dossier-progress-proof";
import {
  privateKwShadowSliceProgressDigest,
} from "@/lib/revenue-engine/private-kw-shadow-slice-progress";
import {
  createPrivateKwContactReviewProgressProofFixture,
} from "@/lib/revenue-engine/test-support/private-kw-contact-review-progress-proof-fixture";

function fakeOwnerDossierDatabase(resultSets: unknown[][]): D1DatabaseLike {
  let index = 0;
  return {
    prepare(): D1PreparedStatementLike {
      let values: unknown[] = [];
      const statement: D1PreparedStatementLike = {
        bind(...bound: unknown[]) {
          values = bound;
          return statement;
        },
        async all<T>() {
          assert(values.length > 0);
          const rows = resultSets[index] ?? [];
          index += 1;
          return { results: rows as T[] };
        },
        async first<T>() {
          throw new Error("The synthetic owner-dossier reader uses bounded all queries only.") as T;
        },
        async run() {
          throw new Error("The synthetic owner-dossier reader must never mutate data.");
        },
      };
      return statement;
    },
  };
}

export async function createPrivateKwOwnerDossierProgressFixture(options: {
  suffix?: string;
  now?: Date;
  dossierGeneratedAtOffsetMs?: number;
  staleContactReview?: boolean;
} = {}) {
  const contact = await createPrivateKwContactReviewProgressProofFixture({
    suffix: options.suffix ?? "owner-dossier-progress",
    now: options.now,
  });
  const contactInput = buildPrivateKwContactReviewProgressInput({
    manifestValue: contact.manifest,
    previousProgressValue: contact.assessmentCheckpoint,
    currentContactInvocationResultValue: contact.contactDurableReload,
  });
  const contactCheckpoint = appendPrivateKwContactReviewProgress({
    manifestValue: contact.manifest,
    previousProgressValue: contact.assessmentCheckpoint,
    phaseInputValue: contactInput,
  });
  const target = contact.source.records.find(
    (record) => record.business.id === contact.assessment.business.id,
  );
  const contactPointRecord = contact.contactPlan.records.find(
    (record) => record.entity === "CONTACT_POINT",
  );
  const verificationRecord = contact.contactPlan.records.find(
    (record) => record.entity === "VERIFICATION_RESULT",
  );
  if (!target || !contactPointRecord || !verificationRecord) {
    throw new Error("Synthetic owner-dossier fixture lost its current business or contact records.");
  }

  const assessment = contact.assessment;
  const audit = assessment.audit;
  const qualification = assessment.qualification;
  const staleWebsiteSnapshotId = `website:${privateKwShadowSliceProgressDigest({
    suffix: options.suffix ?? "owner-dossier-progress",
    kind: "stale-owner-dossier-website",
  })}`;
  const websiteSnapshotId = options.staleContactReview
    ? staleWebsiteSnapshotId
    : assessment.websiteSnapshotId;
  const candidateRow = {
    businessId: target.business.id,
    canonicalName: target.business.canonicalName,
    normalizedDomain: target.business.normalizedDomain,
    independenceStatus: target.business.independenceStatus,
    businessStatus: target.business.status,
    addressLine: target.location.addressLine,
    city: target.location.city,
    region: target.location.region,
    country: target.location.country,
    postalCode: target.location.postalCode,
    geoCell: target.location.geoCell,
    sourceRunId: target.sourceRecord.sourceRunId,
    sourceAdapter: "FIXTURE",
    sourceRawPayloadJson: JSON.stringify({
      sourceEvidenceUrl: target.sourceRecord.sourceEvidenceUrl,
      websiteUrl: target.sourceRecord.websiteUrl,
      niche: target.niche,
      synthetic: true,
    }),
    sourceCapturedAt: target.sourceRecord.capturedAt,
    websiteSnapshotId,
    websiteFinalUrl: audit.finalUrl,
    websiteClassification: audit.classification,
    websiteAuditVersion: audit.auditVersion,
    websiteDesktopArtifactRef: audit.desktopArtifactRef,
    websiteMobileArtifactRef: audit.mobileArtifactRef,
    websiteDomArtifactRef: audit.domArtifactRef,
    auditJson: JSON.stringify(audit),
    websiteCapturedAt: audit.capturedAt,
    websiteRefreshAfter: assessment.refreshAfter,
    qualificationSnapshotId: assessment.qualificationSnapshotId,
    qualificationBusinessId: target.business.id,
    qualificationPolicyVersion: qualification.policyVersion,
    qualificationShadowOnly: 1,
    qualificationTotalScore: qualification.totalScore,
    qualificationRebuildNeedScore: qualification.scores.rebuildNeed,
    qualificationBusinessFitScore: qualification.scores.businessFit,
    qualificationReachabilityScore: qualification.scores.reachability,
    qualificationTimingScore: qualification.scores.timing,
    qualificationEvidenceConfidenceScore: qualification.scores.evidenceConfidence,
    qualificationBand: qualification.band,
    qualificationRecommendedChannel: qualification.recommendedChannel,
    qualificationSupportedObservationCount: qualification.supportedObservationCount,
    qualificationConversionCriticalCount: qualification.conversionCriticalCount,
    qualificationFailedGatesJson: JSON.stringify(qualification.failedGates),
    qualificationEvidenceClaimIdsJson: JSON.stringify(qualification.evidenceClaimIds),
    qualificationCreatedAt: assessment.assessedAt,
  };

  const contactPoint = contactPointRecord.expected;
  const verification = verificationRecord.expected;
  const contactRow = {
    contactPointId: contactPoint.id,
    businessId: contactPoint.businessId,
    channel: contactPoint.channel,
    value: contactPoint.value,
    label: contactPoint.label,
    personName: contactPoint.personName,
    role: contactPoint.role,
    sourceUrl: contactPoint.sourceUrl,
    sourceCapturedAt: contactPoint.sourceCapturedAt,
    automationPermitted: contactPoint.automationPermitted,
    contactStatus: verification.ownerStatus,
    verificationStatus: verification.status,
    verificationCatchAll: verification.catchAll,
    verificationVerifiedAt: verification.verifiedAt,
    verificationStaleAfter: verification.staleAfter,
  };
  const invocationReceipt = buildPrivateKwContactInvocationReceiptRow(contact.invocation);
  const { id: invocationId, ...invocationReceiptWithoutId } = invocationReceipt;
  const invocationRow = {
    ...invocationReceiptWithoutId,
    invocationId,
  };
  const generatedAt = new Date(
    Date.parse(contact.contactDatabaseNow)
      + (options.dossierGeneratedAtOffsetMs ?? 60_000),
  ).toISOString();
  const ownerDossier = await readOwnerLeadDetail(
    fakeOwnerDossierDatabase([[candidateRow], [contactRow], [invocationRow], []]),
    target.business.id,
    generatedAt,
  );
  if (!ownerDossier) {
    throw new Error("Synthetic owner-dossier fixture did not produce its exact read model.");
  }
  const dossierDigest = privateKwOwnerDossierDigest(ownerDossier);
  const acceptance = {
    decisionVersion: PRIVATE_KW_OWNER_DOSSIER_ACCEPTANCE_DECISION_VERSION,
    dossierDigest,
    businessId: target.business.id,
    decision: "ACCEPTED_FOR_READ_ONLY_SHADOW_PROGRESS" as const,
    acceptedBy: "RILEY" as const,
    acceptedAt: new Date(Date.parse(generatedAt) + 60_000).toISOString(),
    rationale: "Accepted the exact synthetic read-only owner dossier for contract verification.",
    confirmation: PRIVATE_KW_OWNER_DOSSIER_ACCEPTANCE_CONFIRMATION,
    mode: "SHADOW" as const,
  };

  return {
    ...contact,
    contactInput,
    contactCheckpoint,
    ownerDossier,
    dossierDigest,
    acceptance,
  };
}
