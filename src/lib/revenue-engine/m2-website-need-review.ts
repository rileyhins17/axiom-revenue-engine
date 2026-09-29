import { getCloudflareBindings } from "@/lib/cloudflare";

import { readM2DelegatedTargets } from "./m2-delegated-targets";
import { readLocalM2OwnerIdentityPacket } from "./m2-owner-identity-packet";
import type { WebsiteNeed } from "./m2-website-need-assessment";
import { currentM2WebsiteNeedAssessments, listM2WebsiteNeedAssessments } from "./m2-website-need-local-store";

export type M2WebsiteNeedReviewRow = {
  reviewId: string;
  businessName: string;
  websiteUrl: string;
  need: WebsiteNeed | "NOT_REVIEWED";
  evidenceConfidence: "LOW" | "MEDIUM" | "HIGH" | null;
  issues: { text: string; severity: "CRITICAL" | "MAJOR" | "MINOR"; onPhone: boolean; conversionCritical: boolean }[];
  strengths: string[];
  fitNote: string | null;
  rationale: string | null;
  assessedAt: string | null;
};
export type M2WebsiteNeedReview =
  | { status: "READY"; rows: M2WebsiteNeedReviewRow[]; counts: Record<WebsiteNeed | "NOT_REVIEWED", number> }
  | { status: "UNAVAILABLE"; reason: string };

const ORDER: Record<M2WebsiteNeedReviewRow["need"], number> = { REBUILD: 0, MINOR_IMPROVEMENT: 1, INCOMPLETE: 2, NOT_REVIEWED: 3, NO_OPPORTUNITY: 4 };
const SEVERITY = { CRITICAL: 0, MAJOR: 1, MINOR: 2 } as const;

/** Server-only, local-only owner projection. Nothing here authorizes contact. */
export async function readLocalM2WebsiteNeedReview(): Promise<M2WebsiteNeedReview> {
  if (getCloudflareBindings() !== null) return { status: "UNAVAILABLE", reason: "Website reviews are kept in the local workspace only." };
  try {
    const packet = await readLocalM2OwnerIdentityPacket();
    if (packet.status !== "READY") return { status: "UNAVAILABLE", reason: "The reviewed business list could not be verified." };
    const targets = await readM2DelegatedTargets(packet);
    const current = currentM2WebsiteNeedAssessments(await listM2WebsiteNeedAssessments(), targets);
    const rows = targets.map((target): M2WebsiteNeedReviewRow => {
      const record = current.get(target.reviewId);
      if (!record) {
        return { reviewId: target.reviewId, businessName: target.businessName, websiteUrl: target.approvedWebsiteUrl, need: "NOT_REVIEWED", evidenceConfidence: null, issues: [], strengths: [], fitNote: null, rationale: null, assessedAt: null };
      }
      const issues = record.findings
        .filter((finding) => finding.kind === "ISSUE" && finding.severity !== null)
        .map((finding) => ({ text: finding.finding, severity: finding.severity!, onPhone: finding.viewport === "PHONE", conversionCritical: finding.conversionCritical }))
        .sort((left, right) => SEVERITY[left.severity] - SEVERITY[right.severity]);
      return {
        reviewId: record.reviewId, businessName: record.businessName, websiteUrl: record.approvedWebsiteUrl, need: record.websiteNeed,
        evidenceConfidence: record.evidenceConfidence, issues,
        strengths: record.findings.filter((finding) => finding.kind === "STRENGTH").map((finding) => finding.finding),
        fitNote: record.businessFitNote, rationale: record.rationale, assessedAt: record.assessedAt,
      };
    }).sort((left, right) => ORDER[left.need] - ORDER[right.need] || left.reviewId.localeCompare(right.reviewId, "en"));
    const counts = { REBUILD: 0, MINOR_IMPROVEMENT: 0, NO_OPPORTUNITY: 0, INCOMPLETE: 0, NOT_REVIEWED: 0 };
    for (const row of rows) counts[row.need] += 1;
    return { status: "READY", rows, counts };
  } catch {
    return { status: "UNAVAILABLE", reason: "Saved website reviews could not be verified. Nothing was changed." };
  }
}
